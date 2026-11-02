'use strict';
// SFTP operations on top of an SSH connection: listing, file ops, transfers with
// progress + cancel (own concurrent read/write loop), and "edit remote file locally".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const editor = require('./editor'); // the Edit command's temp copy and the external editor (no shell)
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()
const t_ = t; // where a transfer is called t

const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFLNK = 0o120000;
const SFTP_EOF = 1; // SSH_FX_EOF: what READDIR answers once a directory handle is exhausted
const READDIR_DEPTH = 8; // READDIR requests kept in flight on one handle (list)
const LINK_LOOKUPS = 16; // readlink + stat of symlinks resolved at a time (list)

function modeStr(mode) {
  const t = (mode & S_IFMT) === S_IFDIR ? 'd' : (mode & S_IFMT) === S_IFLNK ? 'l' : '-';
  const bits = ['r', 'w', 'x'];
  let s = t;
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? bits[(8 - i) % 3] : '-';
  return s;
}

function posixJoin(a, b) {
  if (b.startsWith('/')) return b;
  return (a.endsWith('/') ? a : a + '/') + b;
}

class SftpManager extends EventEmitter {
  constructor(sshManager, store) {
    super();
    this.ssh = sshManager;
    this.store = store;
    this.transfers = new Map();
    this.edits = new Map();
  }

  _sftp(connId) {
    return this.ssh.sftp(connId);
  }

  _p(sftp, method, ...args) {
    return new Promise((resolve, reject) => sftp[method](...args, (err, res) => (err ? reject(err) : resolve(res))));
  }

  async realpath(connId, p) {
    const sftp = await this._sftp(connId);
    return this._p(sftp, 'realpath', p || '.');
  }

  async home(connId) {
    return this.realpath(connId, '.');
  }

  /**
   * Read a directory with READDIR requests pipelined: ssh2's readdir(path) sends one READDIR at a time and waits for
   * each answer (≈100 entries per packet: 20 000 entries were 200 round trips, 1.8 s at 12 ms RTT), so the handle is
   * opened here and READDIR_DEPTH requests are kept in flight until EOF — the answers arrive in order, so the entries
   * come out in the server's order as before.
   */
  _readdirAll(sftp, abs) {
    return new Promise((resolve, reject) => {
      sftp.opendir(abs, (err, handle) => {
        if (err) return reject(err);
        const out = [];
        let inflight = 0, eof = false, failed = null;
        const done = () => sftp.close(handle, () => (failed ? reject(failed) : resolve(out)));
        const pump = () => {
          while (!eof && !failed && inflight < READDIR_DEPTH) {
            inflight++;
            sftp.readdir(handle, (err, list) => {
              inflight--;
              if (err && err.code === SFTP_EOF) eof = true;
              else if (err) failed = failed || err;
              else if (list === false) eof = true;
              else for (const e of list) out.push(e);
              if ((eof || failed) && inflight === 0) done();
              else pump();
            });
          }
        };
        pump();
      });
    });
  }

  async list(connId, dir) {
    const sftp = await this._sftp(connId);
    const abs = await this._p(sftp, 'realpath', dir || '.');
    const raw = await this._readdirAll(sftp, abs);
    const entries = [];
    // a symlink's target and what it points at: readlink first (it works for a dangling link too), then stat — when
    // that fails the link is broken and the panel says so; the lookups run a few at a time, not one after the other
    const links = [];
    for (const e of raw) {
      const a = e.attrs;
      const isLink = (a.mode & S_IFMT) === S_IFLNK;
      // owner/group names from longname ("-rw-r--r-- 1 user group size date name")
      const cols = (e.longname || '').split(/\s+/);
      const entry = {
        name: e.filename,
        type: (a.mode & S_IFMT) === S_IFDIR ? 'd' : 'f',
        link: isLink,
        target: undefined,
        size: a.size,
        mtime: a.mtime * 1000,
        mode: a.mode & 0o7777,
        modeStr: modeStr(a.mode),
        owner: cols[2] || String(a.uid),
        group: cols[3] || String(a.gid),
      };
      entries.push(entry);
      if (isLink) links.push(entry);
    }
    const resolveLink = async (entry) => {
      const p = posixJoin(abs, entry.name);
      entry.target = await this._p(sftp, 'readlink', p).catch(() => undefined);
      try {
        const st = await this._p(sftp, 'stat', p);
        entry.type = (st.mode & S_IFMT) === S_IFDIR ? 'd' : 'f';
      } catch {
        entry.broken = true;
      }
    };
    for (let i = 0; i < links.length; i += LINK_LOOKUPS) await Promise.all(links.slice(i, i + LINK_LOOKUPS).map(resolveLink));
    entries.sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'd' ? -1 : 1));
    return { path: abs, entries };
  }

  async stat(connId, p) {
    const sftp = await this._sftp(connId);
    const a = await this._p(sftp, 'stat', p);
    return { size: a.size, mtime: a.mtime * 1000, mode: a.mode & 0o7777, isDir: (a.mode & S_IFMT) === S_IFDIR };
  }

  async mkdir(connId, p) {
    const sftp = await this._sftp(connId);
    return this._p(sftp, 'mkdir', p);
  }

  async rename(connId, from, to) {
    const sftp = await this._sftp(connId);
    return this._p(sftp, 'rename', from, to);
  }

  async chmod(connId, p, mode) {
    const sftp = await this._sftp(connId);
    return this._p(sftp, 'chmod', p, mode);
  }

  async remove(connId, p, isDir) {
    const sftp = await this._sftp(connId);
    if (!isDir) return this._p(sftp, 'unlink', p);
    const items = await this._p(sftp, 'readdir', p);
    for (const e of items) {
      const child = posixJoin(p, e.filename);
      const d = (e.attrs.mode & S_IFMT) === S_IFDIR;
      await this.remove(connId, child, d);
    }
    return this._p(sftp, 'rmdir', p);
  }

  async readFile(connId, p, maxBytes = 5 * 1024 * 1024) {
    const sftp = await this._sftp(connId);
    const st = await this._p(sftp, 'stat', p);
    if (st.size > maxBytes) throw new Error(t('File too large ({size} bytes)', { size: st.size }));
    return new Promise((resolve, reject) => {
      const chunks = [];
      sftp.createReadStream(p).on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))).on('error', reject);
    });
  }

  async writeFile(connId, p, content) {
    const sftp = await this._sftp(connId);
    return new Promise((resolve, reject) => {
      const ws = sftp.createWriteStream(p);
      ws.on('error', reject).on('close', resolve);
      ws.end(Buffer.from(content, 'utf8'));
    });
  }

  // ---------------- transfers ----------------
  _emitTransfer(t) {
    const now = Date.now();
    if (t.status === 'running' && now - (t._lastEmit || 0) < 120) return;
    t._lastEmit = now;
    this.emit('transfer', {
      id: t.id, connId: t.connId, kind: t.kind, name: t.name, remote: t.remote, local: t.local,
      transferred: t.transferred, total: t.total, status: t.status, error: t.error, startedAt: t.startedAt,
      filesDone: t.filesDone, filesTotal: t.filesTotal, resumedFrom: t.resumedFrom || 0,
    });
  }

  _newTransfer(connId, kind, name, remote, local) {
    const t = {
      id: 'x_' + crypto.randomBytes(5).toString('hex'), connId, kind, name, remote, local,
      transferred: 0, total: 0, status: 'running', error: null, cancelled: false, startedAt: Date.now(),
      filesDone: 0, filesTotal: 1,
    };
    this.transfers.set(t.id, t);
    return t;
  }

  cancel(transferId) {
    const t = this.transfers.get(transferId);
    if (t) t.cancelled = true;
  }

  /**
   * The connection is being ended on purpose (Session → Disconnect, a closed pane, quit): its running transfers end as
   * "cancelled (disconnected)" instead of the "No response from server" the dying channel would report, and a download
   * keeps its .part for a resume (a user's Cancel removes it). Called before the client is ended.
   */
  abortForConnection(connId) {
    for (const t of this.transfers.values()) {
      if (t.connId === connId && t.status === 'running') {
        t.cancelled = true;
        t.disconnected = true;
      }
    }
  }

  /** The partial file a download writes beside its destination; the final name is taken only once every byte is in. */
  static partOf(local) {
    return local + '.part';
  }

  /** Size of the .part an earlier download of `local` left behind (0 when there is none). */
  static partSize(local) {
    try { return fs.statSync(SftpManager.partOf(local)).size; } catch { return 0; }
  }

  /**
   * Download a single file with concurrent reads; supports cancel. The bytes land in `<local>.part`, renamed to `local`
   * on completion, so a download that dies with the connection never leaves a truncated file under the final name: the
   * .part stays (a user's Cancel removes it) and `resume` continues it from its end — the remote is read from that
   * offset, t.transferred starts there and t.resumedFrom tells the row. A .part as long as the remote or longer is
   * not this download's and is replaced.
   */
  _getFile(sftp, t, remote, local, { resume = false } = {}) {
    return new Promise(async (resolve, reject) => {
      const part = SftpManager.partOf(local);
      let handle, fd, offset = 0;
      try {
        const st = await this._p(sftp, 'stat', remote);
        const size = st.size;
        if (resume) {
          const have = SftpManager.partSize(local);
          if (have > 0 && have < size) offset = have;
        }
        handle = await this._p(sftp, 'open', remote, 'r');
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fd = fs.openSync(part, offset ? 'r+' : 'w');
        if (offset) {
          fs.ftruncateSync(fd, offset);
          t.transferred += offset;
          t.resumedFrom = offset;
          t._lastEmit = 0;
          this._emitTransfer(t);
        }
        const CHUNK = 32768, CONC = 32;
        let next = offset, inflight = 0, failed = null;
        const finish = () => {
          try { fs.closeSync(fd); } catch {}
          sftp.close(handle, () => {});
          if (failed || t.cancelled) {
            if (t.cancelled && !t.disconnected) { try { fs.unlinkSync(part); } catch {} } // Cancel: nothing left behind; an error or a disconnect keeps the .part for a resume
            return reject(t.cancelled ? new Error('cancelled') : failed);
          }
          try { fs.renameSync(part, local); } catch (e) { return reject(e); }
          try { fs.utimesSync(local, new Date(), new Date(st.mtime * 1000)); } catch {}
          resolve();
        };
        if (size === 0 || next >= size) return finish();
        const pump = () => {
          if (failed || t.cancelled) {
            if (inflight === 0) finish();
            return;
          }
          while (inflight < CONC && next < size) {
            const pos = next;
            const len = Math.min(CHUNK, size - pos);
            next += len;
            inflight++;
            const buf = Buffer.allocUnsafe(len);
            sftp.read(handle, buf, 0, len, pos, (err, nread) => {
              inflight--;
              if (err) failed = err;
              else {
                try { fs.writeSync(fd, buf, 0, nread, pos); } catch (e) { failed = e; }
                t.transferred += nread;
                this._emitTransfer(t);
              }
              if (!failed && !t.cancelled && (next < size || inflight > 0)) pump();
              else if (inflight === 0) finish();
            });
          }
          if (inflight === 0 && next >= size) finish();
        };
        pump();
      } catch (e) {
        try { if (fd !== undefined) fs.closeSync(fd); } catch {}
        if (fd !== undefined && !offset) { try { fs.unlinkSync(part); } catch {} } // nothing was read into it
        if (handle) sftp.close(handle, () => {});
        reject(e);
      }
    });
  }

  /** Upload a single file with concurrent writes; supports cancel. */
  _putFile(sftp, t, local, remote) {
    return new Promise(async (resolve, reject) => {
      let handle, fd;
      try {
        const st = fs.statSync(local);
        const size = st.size;
        fd = fs.openSync(local, 'r');
        handle = await this._p(sftp, 'open', remote, 'w');
        const CHUNK = 32768, CONC = 32;
        let next = 0, inflight = 0, failed = null;
        const finish = () => {
          try { fs.closeSync(fd); } catch {}
          sftp.close(handle, () => {
            if (failed) return reject(failed);
            if (t.cancelled) {
              sftp.unlink(remote, () => {});
              return reject(new Error('cancelled'));
            }
            sftp.chmod(remote, st.mode & 0o777, () => resolve());
          });
        };
        if (size === 0) return finish();
        const pump = () => {
          if (failed || t.cancelled) {
            if (inflight === 0) finish();
            return;
          }
          while (inflight < CONC && next < size) {
            const pos = next;
            const len = Math.min(CHUNK, size - pos);
            next += len;
            inflight++;
            const buf = Buffer.allocUnsafe(len);
            let n;
            try { n = fs.readSync(fd, buf, 0, len, pos); } catch (e) { failed = e; inflight--; continue; }
            sftp.write(handle, buf, 0, n, pos, (err) => {
              inflight--;
              if (err) failed = err;
              else {
                t.transferred += n;
                this._emitTransfer(t);
              }
              if (!failed && !t.cancelled && (next < size || inflight > 0)) pump();
              else if (inflight === 0) finish();
            });
          }
          if (inflight === 0 && next >= size) finish();
        };
        pump();
      } catch (e) {
        try { if (fd !== undefined) fs.closeSync(fd); } catch {}
        if (handle) sftp.close(handle, () => {});
        reject(e);
      }
    });
  }

  async _walkRemote(sftp, dir) {
    const out = { files: [], dirs: [], total: 0 };
    const rec = async (d) => {
      out.dirs.push(d);
      const items = await this._p(sftp, 'readdir', d);
      for (const e of items) {
        const p = posixJoin(d, e.filename);
        if ((e.attrs.mode & S_IFMT) === S_IFDIR) await rec(p);
        else {
          out.files.push({ path: p, size: e.attrs.size });
          out.total += e.attrs.size;
        }
      }
    };
    await rec(dir);
    return out;
  }

  _walkLocal(dir) {
    const out = { files: [], dirs: [], total: 0 };
    const rec = (d) => {
      out.dirs.push(d);
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) rec(p);
        else if (e.isFile()) {
          const s = fs.statSync(p).size;
          out.files.push({ path: p, size: s });
          out.total += s;
        }
      }
    };
    rec(dir);
    return out;
  }

  /**
   * Download remote file or directory to a local path. Returns transfer id immediately. `resume` continues the .part an
   * earlier download of the same file left (see _getFile; main.js asks when one is there).
   */
  download(connId, remote, local, { resume = false } = {}) {
    const t = this._newTransfer(connId, 'download', path.posix.basename(remote), remote, local);
    (async () => {
      const sftp = await this._sftp(connId);
      const st = await this._p(sftp, 'stat', remote);
      if ((st.mode & S_IFMT) === S_IFDIR) {
        const plan = await this._walkRemote(sftp, remote);
        t.total = plan.total;
        t.filesTotal = plan.files.length;
        for (const d of plan.dirs) fs.mkdirSync(path.join(local, path.posix.relative(remote, d)), { recursive: true });
        for (const f of plan.files) {
          if (t.cancelled) throw new Error('cancelled');
          await this._getFile(sftp, t, f.path, path.join(local, path.posix.relative(remote, f.path)), { resume });
          t.filesDone++;
        }
      } else {
        t.total = st.size;
        await this._getFile(sftp, t, remote, local, { resume });
        t.filesDone = 1;
      }
      t.status = 'done';
    })()
      .catch((e) => this._failed(t, e))
      .finally(() => {
        t._lastEmit = 0;
        this._emitTransfer(t);
        setTimeout(() => this.transfers.delete(t.id), 60000);
      });
    return t.id;
  }

  /** Upload local file or directory to a remote path. */
  upload(connId, local, remote) {
    const t = this._newTransfer(connId, 'upload', path.basename(local), remote, local);
    (async () => {
      const sftp = await this._sftp(connId);
      const st = fs.statSync(local);
      if (st.isDirectory()) {
        const plan = this._walkLocal(local);
        t.total = plan.total;
        t.filesTotal = plan.files.length;
        for (const d of plan.dirs) {
          const rp = posixJoin(remote, path.relative(local, d).split(path.sep).join('/')).replace(/\/$/, '');
          await this._p(sftp, 'mkdir', rp).catch(() => {});
        }
        for (const f of plan.files) {
          if (t.cancelled) throw new Error('cancelled');
          const rp = posixJoin(remote, path.relative(local, f.path).split(path.sep).join('/'));
          await this._putFile(sftp, t, f.path, rp);
          t.filesDone++;
        }
      } else {
        t.total = st.size;
        await this._putFile(sftp, t, local, remote);
        t.filesDone = 1;
      }
      t.status = 'done';
    })()
      .catch((e) => this._failed(t, e))
      .finally(() => {
        t._lastEmit = 0;
        this._emitTransfer(t);
        setTimeout(() => this.transfers.delete(t.id), 60000);
      });
    return t.id;
  }

  /** A transfer that did not finish: cancelled (by the user, or by a Disconnect — the row says which), else an error. */
  _failed(t, e) {
    t.status = t.cancelled ? 'cancelled' : 'error';
    t.error = t.disconnected ? t_('disconnected') : t.cancelled ? null : e.message;
  }

  listTransfers() {
    return [...this.transfers.values()].map((t) => ({
      id: t.id, connId: t.connId, kind: t.kind, name: t.name, transferred: t.transferred, total: t.total, status: t.status, error: t.error,
    }));
  }

  // ---------------- remote edit ----------------
  /** Download to a temp file, open it in the local editor, re-upload on every save. */
  async editRemote(connId, remote) {
    const settings = this.store.getSettings();
    const { dir, local } = editor.editTarget(connId, remote); // the remote name is only ever a file name (editor.js)
    const sftp = await this._sftp(connId);
    const t = this._newTransfer(connId, 'download', path.posix.basename(remote), remote, local);
    try {
      const st = await this._p(sftp, 'stat', remote);
      t.total = st.size;
      await this._getFile(sftp, t, remote, local);
      t.status = 'done';
    } catch (e) {
      t.status = 'error';
      t.error = e.message;
      this._emitTransfer(t);
      throw e;
    }
    this._emitTransfer(t);

    editor.openInEditor(settings.editorCommand, local); // program + arguments, the path one argument: no shell

    let lastMtime = fs.statSync(local).mtimeMs;
    let timer = null;
    const key = `${connId}:${remote}`;
    const sync = async () => {
      let st;
      try {
        st = fs.statSync(local);
      } catch {
        return;
      }
      if (st.mtimeMs === lastMtime) return;
      lastMtime = st.mtimeMs;
      try {
        const ut = this._newTransfer(connId, 'upload', path.posix.basename(remote), remote, local);
        ut.total = st.size;
        await this._putFile(sftp, ut, local, remote);
        ut.status = 'done';
        this._emitTransfer(ut);
        this.emit('edit-synced', { connId, remote, ok: true });
      } catch (e) {
        this.emit('edit-synced', { connId, remote, ok: false, error: e.message });
      }
    };
    const watcher = fs.watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 400);
    });
    const poll = setInterval(sync, 2000);
    this.edits.set(key, { watcher, poll, local });
    return { local };
  }

  stopEdits(connId) {
    for (const [k, e] of this.edits) {
      if (!connId || k.startsWith(connId + ':')) {
        try { e.watcher.close(); } catch {}
        clearInterval(e.poll);
        this.edits.delete(k);
      }
    }
    if (!connId) editor.removeEditDirs(); // quitting: the local copies go too
  }
}

module.exports = { SftpManager, posixJoin };
