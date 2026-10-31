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
const i18n = require('./i18n'); // interface language: every message shown to the user goes through i18n.t() (`t` names the transfer in this file)

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

/**
 * Turn a basic-ftp / socket error into one the user can act on. Server replies arrive as
 * FTPError("NNN text") with a numeric .code; socket and TLS errors carry a string code. Anything not
 * recognised keeps its message. The result is an Error (numeric .code kept) so callers can rethrow it.
 */
function explainFtpError(e) {
  const raw = ((e && e.message) || String(e)).trim().replace(/^FTPError:\s*/, '');
  const m = /^(\d{3})[ -]?([\s\S]*)$/.exec(raw);
  const code = m ? parseInt(m[1], 10) : null;
  const detail = m ? m[2].trim().replace(/[.\s]+$/, '') : raw;
  const scode = e && typeof e.code === 'string' ? e.code : '';
  let msg = null;
  const t = i18n.t;
  if (code === 530) msg = t('Login failed (530): check the username/password');
  else if (code === 332) msg = t('The server wants an account name (332) — not supported');
  else if (code !== null && code >= 500 && code <= 504 && /\bAUTH\b/i.test(detail)) msg = t('The server does not support FTPS (explicit TLS); untick FTPS');
  else if (code === 550 || code === 553 || code === 450 || code === 452 || code === 501) {
    if (/exist/i.test(detail)) msg = t('The name already exists on the server ({code} {detail})', { code, detail });
    else if (/no such|not found|failed to open|cannot find|does not exist|not a directory|is a directory/i.test(detail)) msg = t('Path not found on the server ({code} {detail})', { code, detail });
    else if (/not empty/i.test(detail)) msg = t('The folder is not empty ({code} {detail})', { code, detail });
    else if (/privilege|permission|denied|not allowed|forbidden/i.test(detail)) msg = t('Permission denied on the server ({code} {detail})', { code, detail });
    else if (/space|quota/i.test(detail)) msg = t('No space left on the server ({code} {detail})', { code, detail });
    else if (code === 501) msg = t('The server rejected the request (501 {detail})', { detail });
    else msg = t('The server refused the operation ({code} {detail})', { code, detail });
  } else if (code === 421) msg = t('The server closed the connection (421 {detail})', { detail });
  else if (code === 425 || code === 426) msg = t('Data connection failed ({code} {detail}) — is passive mode blocked by a firewall?', { code, detail });
  else if (code !== null && code >= 400) msg = t('Server error {code}: {detail}', { code, detail });
  else if (scode === 'ECONNREFUSED') msg = t('Connection refused ({where}) — the host is reachable but no FTP server listens on that port', { where: raw.replace(/^connect ECONNREFUSED\s*/, '') });
  else if (scode === 'ETIMEDOUT' || /timeout \((control|data) socket\)/i.test(raw)) msg = t('Connection timed out ({error}) — check the host/port, VPN or firewall', { error: raw });
  else if (scode === 'ENOTFOUND' || scode === 'EAI_AGAIN') msg = t('Host not found ({host}) — check the host name', { host: raw.replace(/^getaddrinfo \w+\s*/, '') });
  else if (scode === 'ECONNRESET' || scode === 'EPIPE') msg = t('The server dropped the connection ({code})', { code: scode });
  else if (/certificate|altname|self.signed|^CERT_|UNABLE_TO_VERIFY/i.test(raw + ' ' + scode)) msg = t('TLS certificate not trusted ({error}) — tick "Accept untrusted / self-signed certificate" in the session if you trust this server', { error: raw });
  if (!msg) return e instanceof Error ? e : new Error(raw);
  const out = new Error(msg);
  if (code !== null) out.code = code;
  else if (scode) out.code = scode;
  out.cause = e;
  return out;
}

class FtpManager extends EventEmitter {
  /**
   * @param store Store (saved password on request)
   * @param prompter {password(info)->Promise<{password,save}|null>} the app's password dialog
   */
  constructor(store, prompter) {
    super();
    this.store = store;
    this.prompter = prompter;
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
    try {
      await client.access(this._accessOptions(cfg));
    } catch (e) {
      try { client.close(); } catch {} // a refused login must not leave its control socket open
      throw e;
    }
    return client;
  }

  /**
   * Open the control connection. A session with a user name but no password asks for it with the app's
   * password dialog (up to three tries on a 530; "save in session" stores it like SSH does); no user name
   * means anonymous. Errors are rethrown with readable text (see explainFtpError).
   */
  async connect(cfg) {
    cfg = { ...cfg };
    let prompted = null;
    let client;
    for (let attempt = 1; ; attempt++) {
      if (cfg.username && !cfg.password) {
        if (!this.prompter) throw new Error(i18n.t('No password set for this FTP session'));
        const account = `${cfg.username}@${cfg.host}`;
        const ans = await this.prompter.password({
          kind: 'password',
          title: i18n.t('FTP password'),
          message: attempt > 1 ? i18n.t("Login failed. {account}'s FTP password (attempt {n})", { account, n: attempt }) : i18n.t("{account}'s FTP password", { account }),
          session: cfg,
        });
        if (!ans) throw new Error(i18n.t('authentication cancelled'));
        prompted = ans;
        cfg.password = ans.password;
      }
      try {
        client = await this._newClient(cfg);
        break;
      } catch (e) {
        const err = explainFtpError(e);
        if (prompted && err.code === 530 && attempt < 3) { // a typed password was wrong: ask again
          cfg.password = '';
          continue;
        }
        throw err;
      }
    }
    if (prompted && prompted.save && cfg.id) this.store.upsertSession({ ...cfg }).catch(() => {});
    let home;
    try {
      home = await client.pwd();
    } catch (e) {
      try { client.close(); } catch {}
      throw explainFtpError(e);
    }
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
    if (!c) return Promise.reject(new Error(i18n.t('FTP session is closed')));
    const task = c.queue
      .then(async () => {
        if (c.client.closed) c.client = await this._newClient(c.cfg);
        return fn(c.client, c);
      })
      .catch((e) => { throw explainFtpError(e); });
    c.queue = task.catch(() => {});
    return task;
  }

  _abs(c, p) {
    if (!p || p === '.' || p === '~') return c.home;
    return p.startsWith('/') ? path.posix.normalize(p) : posixJoin(c.home, p);
  }

  async realpath(id, p) {
    const c = this.conns.get(id);
    if (!c) throw new Error(i18n.t('FTP session is closed'));
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
    if (!e) throw new Error(i18n.t('No such file: {path}', { path: p }));
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
      if (size > maxBytes) throw new Error(i18n.t('File too large ({size} bytes)', { size }));
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
    if (t.cancelled) { // cancelled while the data client was still logging in
      try { client.close(); } catch {}
      throw new Error('cancelled');
    }
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
        t.error = t.cancelled ? 'cancelled' : explainFtpError(e).message;
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
      if (!c) throw new Error(i18n.t('FTP session is closed'));
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
        if (t.cancelled) throw new Error('cancelled');
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

  /**
   * Upload a local file or directory to a remote path. Cancelling closes the data client, which leaves
   * the file being written truncated on the server: that partial file is deleted over the control
   * connection so a cancel never leaves half a file behind.
   */
  upload(connId, local, remote) {
    const c = this.conns.get(connId);
    const t = this._newTransfer(connId, 'upload', path.basename(local), remote, local);
    return this._finish(t, async () => {
      if (!c) throw new Error(i18n.t('FTP session is closed'));
      const st = fs.statSync(local);
      const client = await this._transferClient(t, c.cfg);
      let current = null; // remote path of the file in flight
      try {
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
            current = posixJoin(remote, path.relative(local, f.path).split(path.sep).join('/'));
            await client.uploadFrom(f.path, current);
            current = null;
            t.filesDone++;
          }
        } else {
          t.total = st.size;
          if (t.cancelled) throw new Error('cancelled');
          current = remote;
          await client.uploadFrom(local, remote);
          current = null;
          t.filesDone = 1;
        }
      } catch (e) {
        if (t.cancelled && current) await this.remove(connId, current, false).catch(() => {});
        throw e;
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
    if (!c) throw new Error(i18n.t('FTP session is closed'));
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

module.exports = { FtpManager, explainFtpError };
