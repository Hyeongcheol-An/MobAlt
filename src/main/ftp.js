'use strict';
// FTP / FTPS (explicit TLS) sessions exposed through the same file API as SFTP, so the Sftp panel
// works unchanged. One control connection per session runs listing/rename/delete; every transfer
// opens its own data client so browsing keeps working while a download runs and cancel just closes it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable, Writable } = require('stream');
const { spawn } = require('child_process');
const { Client } = require('basic-ftp');

const FILE = 1, DIR = 2, LINK = 3; // basic-ftp FileType

function posixJoin(a, b) {
  return path.posix.normalize(b.startsWith('/') ? b : path.posix.join(a, b));
}

function rwx(m) {
  return `${m & 4 ? 'r' : '-'}${m & 2 ? 'w' : '-'}${m & 1 ? 'x' : '-'}`;
}

function modeOf(info) {
  const p = info.permissions;
  if (!p) return info.type === DIR ? 0o755 : 0o644;
  return ((p.user & 7) << 6) | ((p.group & 7) << 3) | (p.world & 7);
}

function mtimeOf(info) {
  if (info.modifiedAt instanceof Date && !isNaN(info.modifiedAt)) return info.modifiedAt.getTime();
  const raw = info.rawModifiedAt || '';
  if (!raw) return 0;
  let d = new Date(raw);
  if (isNaN(d)) d = new Date(`${raw} ${new Date().getFullYear()}`);
  return isNaN(d) ? 0 : d.getTime();
}

class FtpManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.conns = new Map();
    this.transfers = new Map();
    this.edits = new Map();
  }

  has(id) {
    return this.conns.has(id);
  }

  _accessOptions(cfg) {
    const anonymous = !cfg.username;
    return {
      host: cfg.host,
      port: cfg.port || 21,
      user: anonymous ? 'anonymous' : cfg.username,
      password: anonymous ? 'anonymous@' : cfg.password || '',
      secure: !!cfg.ftps,
      secureOptions: cfg.ftps ? { rejectUnauthorized: !cfg.ftpsInsecure, servername: cfg.host } : undefined,
    };
  }

  async _newClient(cfg) {
    const client = new Client(30000);
    client.ftp.verbose = false;
    await client.access(this._accessOptions(cfg));
    return client;
  }

  async connect(cfg) {
    const client = await this._newClient(cfg);
    const home = await client.pwd();
    const id = 'ftp_' + crypto.randomBytes(6).toString('hex');
    this.conns.set(id, { cfg, client, home, queue: Promise.resolve() });
    return { id, home, features: { tls: !!cfg.ftps } };
  }

  disconnect(id) {
    const c = this.conns.get(id);
    if (!c) return;
    this.conns.delete(id);
    try { c.client.close(); } catch {}
    this.stopEdits(id);
  }

  disconnectAll() {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
  }

  /** Serialize commands on the control connection; reconnect transparently if the server dropped it. */
  _run(id, fn) {
    const c = this.conns.get(id);
    if (!c) return Promise.reject(new Error('FTP session is closed'));
    const task = c.queue.then(async () => {
      if (c.client.closed) c.client = await this._newClient(c.cfg);
      return fn(c.client, c);
    });
    c.queue = task.catch(() => {});
    return task;
  }

  _abs(c, p) {
    if (!p || p === '.' || p === '~') return c.home;
    return p.startsWith('/') ? path.posix.normalize(p) : posixJoin(c.home, p);
  }

  async realpath(id, p) {
    const c = this.conns.get(id);
    if (!c) throw new Error('FTP session is closed');
    return this._abs(c, p);
  }

  async home(id) {
    return this.realpath(id, '.');
  }

  async list(id, dir) {
    return this._run(id, async (client, c) => {
      const abs = this._abs(c, dir);
      const raw = await client.list(abs);
      const entries = raw
        .filter((e) => e.name !== '.' && e.name !== '..')
        .map((e) => {
          const isDir = e.type === DIR;
          const isLink = e.type === LINK;
          const mode = modeOf(e);
          return {
            name: e.name, type: isDir ? 'd' : 'f', link: isLink, target: isLink ? e.link : undefined,
            size: e.size || 0, mtime: mtimeOf(e), mode, modeStr: (isLink ? 'l' : isDir ? 'd' : '-') + rwx(mode >> 6) + rwx(mode >> 3) + rwx(mode),
            owner: e.user || '', group: e.group || '',
          };
        });
      entries.sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'd' ? -1 : 1));
      return { path: abs, entries };
    });
  }

  async stat(id, p) {
    const dir = path.posix.dirname(p), base = path.posix.basename(p);
    const { entries } = await this.list(id, dir);
    const e = entries.find((x) => x.name === base);
    if (!e) throw new Error(`No such file: ${p}`);
    return { size: e.size, mtime: e.mtime, mode: e.mode, isDir: e.type === 'd' };
  }

  async mkdir(id, p) {
    return this._run(id, (client) => client.send('MKD ' + p));
  }

  async rename(id, from, to) {
    return this._run(id, (client) => client.rename(from, to));
  }

  async chmod(id, p, mode) {
    return this._run(id, (client) => client.send(`SITE CHMOD ${(mode & 0o7777).toString(8)} ${p}`));
  }

  async remove(id, p, isDir) {
    return this._run(id, async (client) => (isDir ? client.removeDir(p) : client.remove(p)));
  }

  async readFile(id, p, maxBytes = 5 * 1024 * 1024) {
    return this._run(id, async (client) => {
      const size = await client.size(p).catch(() => 0);
      if (size > maxBytes) throw new Error(`File too large (${size} bytes)`);
      const chunks = [];
      await client.downloadTo(new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } }), p);
      return Buffer.concat(chunks).toString('utf8');
    });
  }

  async writeFile(id, p, content) {
    return this._run(id, (client) => client.uploadFrom(Readable.from([Buffer.from(content, 'utf8')]), p));
  }

  // ---------------- transfers (own data client each) ----------------
  _emitTransfer(t) {
    const now = Date.now();
    if (t.status === 'running' && now - (t._lastEmit || 0) < 120) return;
    t._lastEmit = now;
    this.emit('transfer', {
      id: t.id, connId: t.connId, kind: t.kind, name: t.name, remote: t.remote, local: t.local,
      transferred: t.transferred, total: t.total, status: t.status, error: t.error, startedAt: t.startedAt,
      filesDone: t.filesDone, filesTotal: t.filesTotal,
    });
  }

  _newTransfer(connId, kind, name, remote, local) {
    const t = {
      id: 'x_' + crypto.randomBytes(5).toString('hex'), connId, kind, name, remote, local,
      transferred: 0, total: 0, status: 'running', error: null, cancelled: false, startedAt: Date.now(),
      filesDone: 0, filesTotal: 1, client: null,
    };
    this.transfers.set(t.id, t);
    return t;
  }

  cancel(transferId) {
    const t = this.transfers.get(transferId);
    if (!t) return;
    t.cancelled = true;
    try { t.client && t.client.close(); } catch {}
  }

  async _transferClient(t, cfg) {
    const client = await this._newClient(cfg);
    t.client = client;
    client.trackProgress((info) => {
      t.transferred = info.bytesOverall;
      this._emitTransfer(t);
    });
    return client;
  }

  async _walkRemote(connId, dir) {
    const out = { files: [], dirs: [], total: 0 };
    const rec = async (d) => {
      out.dirs.push(d);
      const { entries } = await this.list(connId, d);
      for (const e of entries) {
        const p = posixJoin(d, e.name);
        if (e.type === 'd') await rec(p);
        else {
          out.files.push({ path: p, size: e.size });
          out.total += e.size;
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

  _finish(t, run) {
    run()
      .then(() => { t.status = 'done'; })
      .catch((e) => {
        t.status = t.cancelled ? 'cancelled' : 'error';
        t.error = e.message;
      })
      .finally(() => {
        try { t.client && t.client.close(); } catch {}
        t.client = null;
        t._lastEmit = 0;
        this._emitTransfer(t);
        setTimeout(() => this.transfers.delete(t.id), 60000);
      });
    return t.id;
  }

  /** Download a remote file or directory to a local path. Returns the transfer id immediately. */
  download(connId, remote, local) {
    const c = this.conns.get(connId);
    const t = this._newTransfer(connId, 'download', path.posix.basename(remote), remote, local);
    return this._finish(t, async () => {
      if (!c) throw new Error('FTP session is closed');
      const st = await this.stat(connId, remote);
      const client = await this._transferClient(t, c.cfg);
      if (st.isDir) {
        const plan = await this._walkRemote(connId, remote);
        t.total = plan.total;
        t.filesTotal = plan.files.length;
        for (const d of plan.dirs) fs.mkdirSync(path.join(local, path.posix.relative(remote, d)), { recursive: true });
        for (const f of plan.files) {
          if (t.cancelled) throw new Error('cancelled');
          await client.downloadTo(path.join(local, path.posix.relative(remote, f.path)), f.path);
          t.filesDone++;
        }
      } else {
        t.total = st.size;
        fs.mkdirSync(path.dirname(local), { recursive: true });
        try {
          await client.downloadTo(local, remote);
        } catch (e) {
          if (t.cancelled) { try { fs.unlinkSync(local); } catch {} }
          throw e;
        }
        t.filesDone = 1;
      }
    });
  }

  /** Upload a local file or directory to a remote path. */
  upload(connId, local, remote) {
    const c = this.conns.get(connId);
    const t = this._newTransfer(connId, 'upload', path.basename(local), remote, local);
    return this._finish(t, async () => {
      if (!c) throw new Error('FTP session is closed');
      const st = fs.statSync(local);
      const client = await this._transferClient(t, c.cfg);
      if (st.isDirectory()) {
        const plan = this._walkLocal(local);
        t.total = plan.total;
        t.filesTotal = plan.files.length;
        for (const d of plan.dirs) {
          const rp = posixJoin(remote, path.relative(local, d).split(path.sep).join('/')).replace(/\/$/, '');
          await client.send('MKD ' + rp).catch(() => {});
        }
        for (const f of plan.files) {
          if (t.cancelled) throw new Error('cancelled');
          await client.uploadFrom(f.path, posixJoin(remote, path.relative(local, f.path).split(path.sep).join('/')));
          t.filesDone++;
        }
      } else {
        t.total = st.size;
        await client.uploadFrom(local, remote);
        t.filesDone = 1;
      }
    });
  }

  listTransfers() {
    return [...this.transfers.values()].map((t) => ({
      id: t.id, connId: t.connId, kind: t.kind, name: t.name, transferred: t.transferred, total: t.total, status: t.status, error: t.error,
    }));
  }

  // ---------------- remote edit ----------------
  /** Download to a temp file, open it in the local editor, re-upload on every save. */
  async editRemote(connId, remote) {
    const c = this.conns.get(connId);
    if (!c) throw new Error('FTP session is closed');
    const settings = this.store.getSettings();
    const dir = path.join(os.tmpdir(), 'mobalt-edit', connId, crypto.randomBytes(3).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const local = path.join(dir, path.posix.basename(remote));
    const t = this._newTransfer(connId, 'download', path.posix.basename(remote), remote, local);
    try {
      const st = await this.stat(connId, remote);
      t.total = st.size;
      const client = await this._transferClient(t, c.cfg);
      await client.downloadTo(local, remote);
      client.close();
      t.client = null;
      t.status = 'done';
    } catch (e) {
      t.status = 'error';
      t.error = e.message;
      this._emitTransfer(t);
      throw e;
    }
    this._emitTransfer(t);

    const cmd = (settings.editorCommand || '').trim();
    if (cmd) {
      const parts = cmd.includes('{file}') ? cmd.replace('{file}', JSON.stringify(local)) : `${cmd} ${JSON.stringify(local)}`;
      spawn('/bin/sh', ['-c', parts], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('open', ['-t', local], { detached: true, stdio: 'ignore' }).unref();
    }

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
      const ut = this._newTransfer(connId, 'upload', path.posix.basename(remote), remote, local);
      ut.total = st.size;
      try {
        const client = await this._transferClient(ut, c.cfg);
        await client.uploadFrom(local, remote);
        client.close();
        ut.client = null;
        ut.status = 'done';
        this._emitTransfer(ut);
        this.emit('edit-synced', { connId, remote, ok: true });
      } catch (e) {
        ut.status = 'error';
        ut.error = e.message;
        this._emitTransfer(ut);
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
  }
}

module.exports = { FtpManager };
