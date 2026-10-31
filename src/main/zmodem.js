'use strict';
// Zmodem (rz / sz) file transfers inside a terminal, for the backends that expose their raw byte stream: the local
// pty, SSH shells, telnet and serial (Mosh runs its own client in a pty and carries no byte stream of its own).
//
// Every byte a terminal receives passes through a zmodem.js Sentry before it is decoded for xterm (TerminalRegistry
// .bytes → handle.rawSink). As long as nothing looks like ZMODEM, the bytes go on to the terminal exactly as before.
// When the remote side runs `sz` (it sends ZRQINIT: we receive) or `rz` (ZRINIT: we send), the Sentry raises a
// detection: the header line is held back, the question is answered — the download folder from the settings or a
// folder picker for sz, an Open dialog for the files rz asks for (both through dialogs.js, so test scripts can
// answer them) — and the detection is confirmed: from then on the Sentry routes every byte to the Session and
// xterm sees none of the binary stream; only one status line per transfer is written to it (and so to a session
// log). When the session ends (ZFIN / OO, a cancel or a failure) the Sentry hands the remainder of the stream back
// to the terminal, so the shell prompt appears as usual. Keystrokes typed into the pane during a transfer are
// dropped — MultiExec included — except Ctrl-C, which cancels it; Cancel in the transfers list and a dropped
// connection send ZMODEM's abort sequence (five CANs). Progress goes out as 'transfer' events in the shape of the
// SFTP transfers, so the files panel's transfer list, its Cancel button and the status bar count cover them too.
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

let Zmodem = null;
const zm = () => Zmodem || (Zmodem = require('zmodem.js')); // loaded on first use (unit tests of the pure parts need no library)
const DBG = !!process.env.MOBALT_ZMODEM_DEBUG;
const dbg = (...a) => DBG && console.log('[zmodem]', ...a);

const GREY = '\x1b[90m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const CHUNK = 64 * 1024; // file bytes handed to zmodem.js per step (it cuts them into 8 KiB subpackets)
const STALL_MS = 30000; // a session that makes no progress for this long is aborted
const HOLD_MAX = 4096; // bytes of terminal output held back while a detection waits for its answer
const ZM_START = Buffer.from([0x2a, 0x2a, 0x18, 0x42]); // "**" ZDLE "B": the hex header that starts every session
const CAN = 0x18;

/** Settings → Features → Transfers → "Zmodem transfers (rz/sz)"; on unless switched off. */
function zmodemEnabled(settings) {
  return !settings || settings.zmodem !== false;
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** The local name for an offered file: its base name without control characters; "", "." and ".." get a stand-in. */
function safeFileName(name) {
  let n = String(name == null ? '' : name).replace(/[\x00-\x1f\x7f]/g, '');
  n = n.split(/[\\/]/).pop() || '';
  if (/^\.{1,2}$/.test(n)) n = '';
  return n || 'zmodem-file';
}

/** `dir/name`, or `dir/name (n).ext` when that exists already (`exists` is injectable for tests). */
function uniquePath(dir, name, exists = fs.existsSync) {
  let p = path.join(dir, name);
  if (!exists(p)) return p;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    p = path.join(dir, `${base} (${i})${ext}`);
    if (!exists(p)) return p;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function fmtBytes(n) {
  if (n === undefined || n === null) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

/**
 * ZFILE parameters for a batch of local files in sending order: each offer carries how many files and bytes remain,
 * itself included. files: [{ path, size, mtime?: Date|number, mode? }] → [{ path, name, size, mtime, mode,
 * files_remaining, bytes_remaining }]. The mode keeps the permission bits only (zmodem.js adds the regular-file bit).
 */
function offerBatch(files) {
  let bytesLeft = 0;
  for (const f of files) bytesLeft += f.size || 0;
  return files.map((f, i) => {
    const o = {
      path: f.path,
      name: path.basename(f.path),
      size: f.size || 0,
      mtime: f.mtime instanceof Date ? Math.floor(f.mtime.getTime() / 1000) : typeof f.mtime === 'number' ? Math.floor(f.mtime) : undefined,
      mode: typeof f.mode === 'number' ? f.mode & 0o7777 : undefined,
      files_remaining: files.length - i,
      bytes_remaining: bytesLeft,
    };
    bytesLeft -= f.size || 0;
    return o;
  });
}

/**
 * What, of the output held back during a detection, still belongs on the terminal once the session is confirmed:
 * the bytes before the ZMODEM header (the command's echo), without the "rz\r" / "sz\r" line lrzsz prints first as
 * an auto-start hint for terminals that know it.
 */
function leadingText(held) {
  const b = Buffer.isBuffer(held) ? held : Buffer.from(held || []);
  const at = b.indexOf(ZM_START);
  let lead = at < 0 ? b : b.subarray(0, at);
  const s = lead.toString('latin1');
  const m = /[rs]z\r?\n?$/.exec(s);
  if (m && (m.index === 0 || /[\r\n]/.test(s[m.index - 1]))) lead = lead.subarray(0, m.index);
  return lead;
}

/** The reason shown for a session that failed: zmodem.js throws strings as well as its own Error class. */
function explainError(e) {
  const type = e && e.type;
  const s = String(e && e.message !== undefined ? e.message : e == null ? '' : e);
  if (type === 'peer_aborted' || /peer aborted/i.test(s)) return 'cancelled by the remote side';
  if (type === 'already_aborted' || type === 'aborted' || /session (already )?aborted/i.test(s)) return 'cancelled';
  if (/fallen back to YMODEM/i.test(s)) return 'the remote side fell back to YMODEM, which is not supported';
  if (/Half-duplex|Non-overlap|8-bit escaping|Buffer size/i.test(s)) return `the remote side needs an unsupported mode (${s.replace(/!$/, '')})`;
  if (/Unhandled header/i.test(s)) return `unexpected ZMODEM header (${s.replace(/^.*Unhandled header: ?/, '')})`;
  if (/Error correction is unimplemented|offset mismatch/i.test(s)) return 'data was lost on the way (ZMODEM error correction is not implemented) — try again';
  if (/CRC check failed/i.test(s)) return 'a block arrived damaged (CRC) — try again';
  return s.replace(/^PROTOCOL: /, '') || 'unknown error';
}

class ZmodemManager extends EventEmitter {
  /**
   * @param registry TerminalRegistry: 'register' attaches a Sentry to every handle with a writeRaw(), 'exit' detaches it
   * @param store Store (settings: zmodem, downloadDir)
   * @param opts { dialogs: dialogs.js (or a test double), getWin: () => BrowserWindow|null, downloadsDir: () => string }
   */
  constructor(registry, store, { dialogs = null, getWin = () => null, downloadsDir = () => path.join(os.homedir(), 'Downloads') } = {}) {
    super();
    this.registry = registry;
    this.store = store;
    this.dialogs = dialogs;
    this.getWin = getWin;
    this.downloadsDir = downloadsDir;
    this.guards = new Map(); // terminal id → guard (sentry + the state of its detection / session / transfer)
    this.transfers = new Map();
    registry.on('register', (id, h) => this.attach(id, h));
    registry.on('exit', (id) => this.detach(id));
  }

  /** Put a Sentry in front of a terminal's byte stream; handles without writeRaw (Mosh, SFTP-only) are left alone. */
  attach(id, handle) {
    if (!handle || typeof handle.writeRaw !== 'function' || this.guards.has(id)) return null;
    const g = { id, handle, sentry: null, detection: null, held: null, retracted: false, asking: false, role: null, session: null, transfer: null, timer: null, lastWrite: null, abortPromise: null, abortReject: null, lastError: null };
    g.sentry = this._newSentry(g);
    handle.rawSink = (buf) => this._feed(g, buf);
    handle.inputGate = (data) => this._gate(g, data);
    this.guards.set(id, g);
    return g;
  }

  /** The terminal is gone: a running transfer fails ("the connection closed"); nothing is written any more. */
  detach(id) {
    const g = this.guards.get(id);
    if (!g) return;
    this.guards.delete(id);
    g.handle.rawSink = null;
    g.handle.inputGate = null;
    g.handle.writeRaw = () => Promise.resolve();
    if (g.session) {
      g.lastError = 'the connection closed';
      this._abort(g);
    }
    g.detection = null;
    g.held = null;
    if (g.timer) clearTimeout(g.timer);
  }

  /** True while a transfer runs on the terminal (its keystrokes are dropped then). */
  isActive(id) {
    const g = this.guards.get(id);
    return !!(g && g.session);
  }

  /** Cancel a transfer from the list (sends the abort sequence to the peer). Returns false for an unknown / finished id. */
  cancel(tid) {
    const t = this.transfers.get(tid);
    if (!t || t.status !== 'running') return false;
    t.cancelled = true;
    const g = this.guards.get(t.connId);
    if (g && g.session) this._abort(g);
    else this._finish(t, 'cancelled');
    return true;
  }

  listTransfers() {
    return [...this.transfers.values()].map((t) => this._public(t));
  }

  // ---------------- the byte stream ----------------
  _newSentry(g) {
    return new (zm().Sentry)({
      to_terminal: (octets) => this._toTerminal(g, octets),
      sender: (octets) => { g.lastWrite = this._send(g, octets); },
      on_detect: (detection) => this._onDetect(g, detection),
      on_retract: () => { g.retracted = true; }, // a replacement detection or plain output follows within the same consume()
    });
  }

  /** Raw bytes from the backend. */
  _feed(g, buf) {
    if (!g.session && !g.detection && !zmodemEnabled(this.store.getSettings())) return this._out(g, buf); // off: the bytes reach xterm as they are
    if (DBG && (g.session || g.detection)) dbg('feed', buf.length, 'session?', !!g.session, JSON.stringify(Buffer.from(buf).toString('latin1').slice(0, 24)));
    try {
      g.sentry.consume(buf);
    } catch (e) {
      this._fail(g, e);
    }
    if (g.retracted) this._retract(g);
    if (g.session) this._touch(g);
  }

  /** Decode for xterm with the terminal's own UTF-8 decoder (shared with the bypass path, so split characters survive). */
  _out(g, bytes) {
    const h = g.handle;
    const text = (h.decoder || (h.decoder = new StringDecoder('utf8'))).write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    if (text) this.registry.data(g.id, text);
  }

  _toTerminal(g, octets) {
    if (g.retracted) this._retract(g); // the detection was not ZMODEM after all: its line goes to the terminal first
    if (g.detection) { // the header line waits with the detection: dropped when confirmed, shown when retracted
      if (g.held.length < HOLD_MAX) for (let i = 0; i < octets.length && g.held.length < HOLD_MAX; i++) g.held.push(octets[i]);
      return;
    }
    if (octets.length) this._out(g, octets);
  }

  _retract(g) {
    g.retracted = false;
    if (!g.detection) return;
    g.detection = null;
    const held = g.held;
    g.held = null;
    if (held && held.length) this._out(g, held);
  }

  _onDetect(g, detection) {
    if (g.detection) { // the peer repeated its first header while the answer is pending: the newer detection is the live one
      g.retracted = false;
      g.detection = detection;
      return;
    }
    if (g.retracted) this._retract(g);
    g.detection = detection;
    g.held = [];
    g.role = detection.get_session_role();
    if (g.asking) return; // the dialog of an earlier (retracted) detection is still open: its answer applies to this one
    g.asking = true;
    this._ask(g).then((answer) => this._start(g, answer)).catch((e) => { g.lastError = e.message; this._start(g, null); });
  }

  /** Where the files go (sz) or which files to send (rz): { dir } | { files } | null (declined). */
  async _ask(g) {
    const s = this.store.getSettings();
    const win = this.getWin();
    if (g.role === 'receive') {
      const dir = expandHome(s.downloadDir);
      if (dir) return { dir };
      if (!this.dialogs) return { dir: this.downloadsDir() };
      const r = await this.dialogs.showOpenDialog(win, { title: 'Receive files with Zmodem into…', defaultPath: this.downloadsDir(), buttonLabel: 'Receive here', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths[0] ? null : { dir: r.filePaths[0] };
    }
    if (!this.dialogs) return null;
    const r = await this.dialogs.showOpenDialog(win, { title: 'Send files with Zmodem (rz)', buttonLabel: 'Send', properties: ['openFile', 'multiSelections'] });
    return r.canceled || !r.filePaths.length ? null : { files: r.filePaths };
  }

  _start(g, answer) {
    g.asking = false;
    const det = g.detection;
    if (!det) return; // retracted meanwhile: the remote side gave up, or it was not ZMODEM after all
    const held = g.held;
    g.detection = null;
    g.held = null;
    const lead = leadingText(held);
    if (lead.length) this._out(g, lead);
    const what = g.role === 'receive' ? 'download' : 'upload';
    if (!answer || !det.is_valid()) {
      try { det.deny(); } catch {}
      this._line(g, GREY, `Zmodem ${what} declined${g.lastError ? ': ' + g.lastError : ''}`);
      g.lastError = null;
      return;
    }
    let session;
    try {
      session = det.confirm();
    } catch (e) {
      this._line(g, RED, `Zmodem: ${explainError(e)}`);
      return;
    }
    g.session = session;
    g.lastError = null;
    dbg('confirmed', g.role);
    // Resolves when the session ends normally, rejects when it is aborted (cancel / stall / drop / peer abort): the send
    // loop races every protocol promise against it, so a cancel stops reading at once and a normal end lets it finish.
    g.aborting = false;
    g.abortPromise = new Promise((res, rej) => { g.abortResolve = res; g.abortReject = rej; });
    g.abortPromise.catch(() => {});
    session.on('session_end', () => this._sessionEnd(g, session));
    this._touch(g);
    if (g.role === 'receive') {
      this._armLrzsz(session);
      session.on('offer', (offer) => this._receive(g, offer, answer.dir));
      try {
        session.start();
      } catch (e) {
        this._fail(g, e);
      }
    } else {
      this._sendFiles(g, session, answer.files).catch((e) => this._fail(g, e));
    }
  }

  /**
   * Make zmodem.js's receiver cope with how lrzsz actually sends a file. lrzsz does not stream one continuous ZDATA
   * frame: it ends a block with ZCRCW (frame end, ZACK expected) — always the first block, then periodically — waits
   * for the ZACK, and opens a NEW ZDATA frame for what follows. zmodem.js only ACKs non-frame-end blocks and, after a
   * ZDATA frame, expects nothing but ZEOF, so a lrzsz transfer stalls (no ZACK) or dies ("Unhandled header: ZDATA").
   * On every ZCRCW we send the ZACK ourselves and re-arm the session to accept the next ZDATA, reusing zmodem.js's own
   * ZEOF closure (which resolves the accept() promise and sends the next ZRINIT) so the rest of the flow is unchanged.
   */
  _armLrzsz(session) {
    const zack = () => { try { session._send_header('ZACK', zm().ENCODELIB.pack_u32_le(session._file_offset)); } catch (e) { dbg('ZACK failed', e.message); } };
    let zeof = null; // zmodem.js's own ZEOF closure (ends the file: resolves accept(), sends the next ZRINIT)
    // `this` is the session. zmodem.js clears _next_header_handler before calling a handler, so a new ZDATA frame
    // (what lrzsz opens after a ZCRCW) is set up here the way zmodem.js's accept() sets up the first one.
    const reZdata = function reZdata(hdr) {
      this._consume_ZDATA(hdr); // offset check: the new frame continues where the last acked block left off
      this._next_subpacket_handler = this._consume_ZDATA_data;
      this._next_header_handler = { ZEOF: zeof, ZDATA: reZdata };
    };
    session.on('data_in', (sp) => {
      if (!sp || !sp.frame_end || !sp.frame_end() || !sp.ack_expected || !sp.ack_expected()) return; // only ZCRCW
      zack();
      const h = session._next_header_handler; // the {ZEOF} zmodem.js set for this frame; capture it, allow a new ZDATA next
      if (h && h.ZEOF) { zeof = h.ZEOF; session._next_header_handler = { ZEOF: zeof, ZDATA: reZdata }; }
    });
  }

  // ---------------- receiving (the remote ran sz) ----------------
  _receive(g, offer, dir) {
    const d = offer.get_details();
    const name = safeFileName(d.name);
    let local, ws;
    try {
      fs.mkdirSync(dir, { recursive: true });
      local = uniquePath(dir, name);
      ws = fs.createWriteStream(local);
    } catch (e) {
      g.lastError = `cannot write to ${dir}: ${e.message}`;
      this._line(g, RED, `Zmodem: ${g.lastError}`);
      try { offer.skip(); } catch {}
      return;
    }
    const t = this._newTransfer(g, 'download', name, name, local, d.size || 0);
    t._ws = ws;
    t._partial = local;
    ws.on('error', (e) => {
      g.lastError = `cannot write ${local}: ${e.message}`;
      this._abort(g);
    });
    this._line(g, GREY, `Zmodem: receiving ${name}${d.size ? ` (${fmtBytes(d.size)})` : ''} → ${local}`);
    offer
      .accept({
        on_input: (payload) => {
          const b = Buffer.from(payload);
          ws.write(b);
          t.transferred += b.length;
          this._emit(t);
        },
      })
      .then(() => {
        t._complete = true; // ZEOF seen: the session may end before the file is closed
        ws.end(() => {
          if (d.mtime instanceof Date && !Number.isNaN(d.mtime.getTime())) {
            try { fs.utimesSync(local, d.mtime, d.mtime); } catch {}
          }
          t._partial = null;
          this._finish(t, 'done');
          this._line(g, GREY, `Zmodem: received ${name} (${fmtBytes(t.transferred)}) → ${local}`);
        });
      })
      .catch((e) => this._fail(g, e));
  }

  // ---------------- sending (the remote ran rz) ----------------
  async _sendFiles(g, session, files) {
    const stats = [];
    for (const p of files) {
      const st = fs.statSync(p);
      if (!st.isFile()) throw new Error(`${path.basename(p)} is not a file`);
      stats.push({ path: p, size: st.size, mtime: st.mtime, mode: st.mode });
    }
    const batch = offerBatch(stats);
    const total = batch.reduce((n, f) => n + f.size, 0);
    const t = this._newTransfer(g, 'upload', batch.length === 1 ? batch[0].name : `${batch.length} files`, batch[0].name, batch[0].path, total);
    t.filesTotal = batch.length;
    const buf = Buffer.allocUnsafe(CHUNK);
    for (const f of batch) {
      const xfer = await this._race(g, session.send_offer({ name: f.name, size: f.size, mtime: f.mtime, mode: f.mode, files_remaining: f.files_remaining, bytes_remaining: f.bytes_remaining }));
      if (!xfer) { // ZSKIP: the receiver has it already (rz without -y) or does not want it
        this._line(g, GREY, `Zmodem: ${f.name} skipped by the remote side`);
        t.filesDone++;
        t.transferred += f.size;
        this._emit(t);
        continue;
      }
      this._line(g, GREY, `Zmodem: sending ${f.name} (${fmtBytes(f.size)})`);
      dbg('send start', f.name, 'offerOffset', xfer.get_offset());
      const fd = fs.openSync(f.path, 'r');
      try {
        let off = xfer.get_offset() || 0; // rz may ask for the rest of a partial file
        t.transferred += Math.min(off, f.size);
        for (;;) {
          const n = fs.readSync(fd, buf, 0, CHUNK, off);
          off += n;
          const chunk = buf.subarray(0, n); // consumed synchronously by zmodem.js, so the buffer can be reused
          if (n === 0 || off >= f.size) {
            await this._race(g, xfer.end(chunk)); // resolves with the receiver's next ZRINIT after ZEOF
            t.transferred += n;
            t.filesDone++;
            this._emit(t, true);
            break;
          }
          xfer.send(chunk);
          t.transferred += n;
          this._emit(t);
          this._touch(g);
          await this._race(g, g.lastWrite); // the transport has taken the bytes: the next chunk is read only then
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    t._complete = true; // the close below ends the session; that is not a failure
    dbg('all files sent, closing');
    await this._race(g, session.close());
    dbg('closed');
    this._finish(t, 'done');
    this._line(g, GREY, `Zmodem: sent ${t.name} (${fmtBytes(t.transferred)})`);
  }

  /** Wait for a protocol promise, or for the session's abort (cancel, stall, dropped connection) — whichever comes first. */
  _race(g, p) {
    return Promise.race([p, g.abortPromise]);
  }

  // ---------------- session end, failures, cancel ----------------
  _sessionEnd(g, session) {
    if (g.session !== session) return;
    g.session = null;
    g.role = null;
    if (g.abortReject) {
      if (g.aborting) g.abortReject(new Error(g.lastError || 'cancelled')); // interrupt the send loop's awaits
      else g.abortResolve(); // normal end: let the protocol promise the loop is awaiting win, then _finish runs
      g.abortReject = null;
      g.abortResolve = null;
    }
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = null;
    }
    const t = g.transfer;
    g.transfer = null;
    setImmediate(() => this._settle(g, t)); // a peer abort throws its reason right after this event
  }

  _settle(g, t) {
    if (t && t.status === 'running' && !t._complete) {
      const why = t.cancelled ? null : g.lastError || 'the remote side ended the session';
      this._finish(t, t.cancelled ? 'cancelled' : 'error', why);
      this._line(g, t.cancelled ? GREY : RED, `Zmodem ${t.kind} of ${t.name} ${t.cancelled ? 'cancelled' : 'failed: ' + why}`);
    }
    g.lastError = null;
  }

  /** zmodem.js threw (from consume() or a protocol promise): the session, if still there, is aborted with that reason. */
  _fail(g, e) {
    if (!g.lastError) g.lastError = explainError(e);
    if (g.session) this._abort(g);
    else if (!g.detection) g.sentry = this._newSentry(g); // a sentry that threw outside a session starts over clean
  }

  _abort(g) {
    g.aborting = true;
    const s = g.session;
    if (s && !s.has_ended()) {
      try { s.abort(); } catch {} // sends CAN×5 + BS×5 and fires session_end
    }
    if (g.session) this._sessionEnd(g, g.session); // abort() did not get to fire it
  }

  /** Keystrokes while a session runs never reach the stream (MultiExec included); Ctrl-C cancels the transfer. */
  _gate(g, data) {
    if (!g.session) return false;
    if (String(data).includes('\x03')) {
      if (g.transfer) g.transfer.cancelled = true;
      this._abort(g);
    }
    return true;
  }

  _send(g, octets) {
    let p;
    try {
      p = Promise.resolve(g.handle.writeRaw(Buffer.from(octets)));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.catch((e) => {
      if (!g.session) return;
      g.lastError = `cannot write to the terminal: ${e.message}`;
      this._abort(g);
    });
  }

  _touch(g) {
    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(() => {
      g.timer = null;
      if (!g.session) return;
      g.lastError = `no progress for ${Math.round(STALL_MS / 1000)} s`;
      this._abort(g);
    }, STALL_MS);
    if (g.timer.unref) g.timer.unref();
  }

  _line(g, colour, text) {
    this.registry.data(g.id, `\r\x1b[K${colour}${text}${RESET}\r\n`);
  }

  // ---------------- transfers (the SFTP shape, plus proto: 'zmodem') ----------------
  _newTransfer(g, kind, name, remote, local, total) {
    const t = {
      id: 'z_' + crypto.randomBytes(5).toString('hex'), connId: g.id, proto: 'zmodem', kind, name, remote, local,
      transferred: 0, total, status: 'running', error: null, cancelled: false, startedAt: Date.now(), filesDone: 0, filesTotal: 1,
      _lastEmit: 0, _ws: null, _partial: null, _complete: false,
    };
    this.transfers.set(t.id, t);
    g.transfer = t;
    this._emit(t, true);
    return t;
  }

  _finish(t, status, error) {
    if (t.status !== 'running') return;
    t.status = status;
    t.error = error || null;
    if (t._ws) {
      try { t._ws.destroy(); } catch {}
      t._ws = null;
    }
    if (status !== 'done' && t._partial) {
      try { fs.unlinkSync(t._partial); } catch {}
    }
    t._partial = null;
    this._emit(t, true);
    const timer = setTimeout(() => this.transfers.delete(t.id), 60000);
    if (timer.unref) timer.unref();
  }

  _public(t) {
    return {
      id: t.id, connId: t.connId, proto: t.proto, kind: t.kind, name: t.name, remote: t.remote, local: t.local,
      transferred: t.transferred, total: t.total, status: t.status, error: t.error, startedAt: t.startedAt,
      filesDone: t.filesDone, filesTotal: t.filesTotal,
    };
  }

  _emit(t, force) {
    const now = Date.now();
    if (!force && now - t._lastEmit < 120) return;
    t._lastEmit = now;
    this.emit('transfer', this._public(t));
  }
}

module.exports = { ZmodemManager, zmodemEnabled, safeFileName, uniquePath, offerBatch, leadingText, explainError, fmtBytes, expandHome, STALL_MS, CAN };
