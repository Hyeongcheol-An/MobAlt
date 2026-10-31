'use strict';
// Terminal registry (shared by local pty, ssh shell and telnet) + local pty + telnet.
const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { ensureZdotdir } = require('./zdotdir');

/**
 * Streaming filter that turns terminal output into plain text for session logs: drops CSI, OSC (incl.
 * the OSC 7 folder hook), DCS/APC strings and single-ESC sequences — also when a sequence is split
 * across data chunks — turns CR LF and lone CR into LF and strips the remaining control characters
 * (TAB and LF stay).
 */
class PlainTextFilter {
  constructor() {
    this.pending = ''; // tail of the previous chunk that may continue in the next one
    this.line = ''; // the line being built, with terminal semantics: CR → column 0, BS → back one, text overwrites
    this.col = 0;
  }

  /** Index just past the escape sequence that starts at s[i] (an ESC), or -1 when it is not complete yet. */
  static seqEnd(s, i) {
    const n = s.length;
    if (i + 1 >= n) return -1;
    const k = s[i + 1];
    if (k === '[') { // CSI: parameter bytes 0x30-0x3f, intermediates 0x20-0x2f, final 0x40-0x7e
      let j = i + 2;
      while (j < n && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++;
      while (j < n && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
      if (j >= n) return -1;
      const f = s.charCodeAt(j);
      return f >= 0x40 && f <= 0x7e ? j + 1 : j; // malformed: drop the prefix, resume at the odd byte
    }
    if (k === ']' || k === 'P' || k === 'X' || k === '^' || k === '_') { // OSC / DCS / SOS / PM / APC: until BEL or ST
      for (let j = i + 2; j < n; j++) {
        const c = s.charCodeAt(j);
        if (c === 0x07 || c === 0x9c) return j + 1;
        if (c === 0x1b) {
          if (j + 1 >= n) return -1; // may be the first half of ST
          return s[j + 1] === '\\' ? j + 2 : j; // another ESC aborts the string
        }
      }
      return -1;
    }
    // ESC with intermediates (0x20-0x2f) and one final byte: ESC ( B, ESC = , ESC 7, ESC M …
    let j = i + 1;
    while (j < n && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
    return j >= n ? -1 : j + 1;
  }

  _put(ch) {
    if (this.col < this.line.length) this.line = this.line.slice(0, this.col) + ch + this.line.slice(this.col + 1);
    else this.line += ' '.repeat(this.col - this.line.length) + ch;
    this.col++;
  }

  _endLine() {
    const out = this.line.replace(/\s+$/, '') + '\n';
    this.line = '';
    this.col = 0;
    return out;
  }

  /** A few CSI editing sequences change what the user saw on the line; everything else is dropped. */
  _csi(body, fin) {
    const n = parseInt(body, 10);
    if (fin === 'K') { // erase in line
      if (!body || n === 0) this.line = this.line.slice(0, this.col);
      else if (n === 1) this.line = ' '.repeat(Math.min(this.col, this.line.length)) + this.line.slice(this.col);
      else if (n === 2) this.line = '';
    } else if (fin === 'J') { // erase in display: the rest of this line goes too
      if (!body || n === 0) this.line = this.line.slice(0, this.col);
      else if (n === 2 || n === 3) { this.line = ''; this.col = 0; }
    } else if (fin === 'D') this.col = Math.max(0, this.col - (n || 1));
    else if (fin === 'C') this.col += n || 1;
    else if (fin === 'G') this.col = Math.max(0, (n || 1) - 1);
    else if (fin === 'P') this.line = this.line.slice(0, this.col) + this.line.slice(this.col + (n || 1)); // delete chars
    else if (fin === '@') this.line = this.line.slice(0, this.col) + ' '.repeat(n || 1) + this.line.slice(this.col); // insert blanks
  }

  /** Feed a chunk; returns the plain text of the lines completed so far. */
  push(chunk) {
    const s = this.pending + String(chunk);
    this.pending = '';
    const n = s.length;
    let out = '';
    let i = 0;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 0x1b) {
        const end = PlainTextFilter.seqEnd(s, i);
        if (end < 0) {
          if (n - i < 4096) this.pending = s.slice(i); // wait for the rest (bounded: a runaway string is dropped)
          break;
        }
        if (s[i + 1] === '[' && end > i + 2) this._csi(s.slice(i + 2, end - 1).replace(/[^0-9]/g, ''), s[end - 1]);
        i = end;
      } else if (c === 0x0d) { this.col = 0; i++; } // CR: back to the start of the line (the shell will overwrite it)
      else if (c === 0x0a) { out += this._endLine(); i++; }
      else if (c === 0x08) { this.col = Math.max(0, this.col - 1); i++; } // backspace: the next char replaces the erased one
      else if (c === 0x09) { this._put('\t'); i++; }
      else if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) i++; // other C0/C1 controls (BEL, …)
      else { this._put(s[i]); i++; }
    }
    return out;
  }

  /** Text still held back at the end of the session (an unfinished line is written as one line). */
  flush() {
    this.pending = '';
    if (!this.line.length && this.col === 0) return '';
    return this._endLine();
  }
}

class TerminalRegistry extends EventEmitter {
  constructor() {
    super();
    this.map = new Map();
    this.logs = new Map();
  }

  newId() {
    return 't_' + crypto.randomBytes(6).toString('hex');
  }

  register(id, handle) {
    this.map.set(id, handle);
  }

  get(id) {
    return this.map.get(id);
  }

  /** Number of registered backends of a kind ('ssh', 'mosh', 'sftp', 'local', …). */
  countKind(kind) {
    let n = 0;
    for (const [, h] of this.map) if (h && h.kind === kind) n++;
    return n;
  }

  data(id, data) {
    const log = this.logs.get(id);
    if (log) {
      const text = log.filter ? log.filter.push(data) : data;
      if (text) log.ws.write(text);
    }
    this.emit('data', id, data);
  }

  /** reason: 'exit' | 'closed' | 'failed' | 'cancelled' | 'lost' (SSH: dropped by the server/network; detail = the error seen, if any). */
  exit(id, code, reason, detail) {
    this._endLog(id, `\n--- session ended ${new Date().toISOString()} ---\n`);
    this.map.delete(id);
    this.emit('exit', id, code, reason, detail);
  }

  write(id, data) {
    const h = this.map.get(id);
    if (h) h.write(data);
  }

  resize(id, cols, rows) {
    const h = this.map.get(id);
    if (h && cols > 0 && rows > 0) h.resize(cols, rows);
  }

  kill(id) {
    const h = this.map.get(id);
    if (h) h.kill();
  }

  killAll() {
    for (const [, h] of this.map) {
      try {
        h.kill();
      } catch {}
    }
  }

  /** Append the terminal's output to `file`; `plain` strips colours/control sequences (see PlainTextFilter). */
  startLog(id, file, { plain = false } = {}) {
    this.stopLog(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ws = fs.createWriteStream(file, { flags: 'a' });
    ws.write(`--- session log started ${new Date().toISOString()} ---\n`);
    this.logs.set(id, { ws, filter: plain ? new PlainTextFilter() : null });
    return file;
  }

  stopLog(id) {
    this._endLog(id, `\n--- log stopped ${new Date().toISOString()} ---\n`);
  }

  _endLog(id, footer) {
    const log = this.logs.get(id);
    if (!log) return;
    this.logs.delete(id);
    log.ws.end((log.filter ? log.filter.flush() : '') + footer);
  }
}

function defaultShell(settings) {
  if (settings && settings.localShell) return settings.localShell;
  if (process.env.SHELL) return process.env.SHELL;
  try {
    const s = os.userInfo().shell;
    if (s) return s;
  } catch {}
  return '/bin/zsh';
}

function buildEnv(settings, shell) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Don't leak markers inherited when MobAlt itself was launched from a dev shell
  // (e.g. CLAUDE_CODE_CHILD_SESSION disables transcript saving in Claude Code).
  delete env.CLAUDECODE;
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_')) delete env[k];
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'MobAlt';
  env.TERM_PROGRAM_VERSION = require('../../package.json').version;
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  if (!env.HOME) env.HOME = os.homedir();
  if (settings.localShellIntegration !== false && /zsh$/.test(shell)) {
    const dir = ensureZdotdir();
    if (dir) {
      env.MOBALT_ORIG_ZDOTDIR = env.ZDOTDIR || env.HOME;
      env.ZDOTDIR = dir;
    }
  }
  if (settings.localShellIntegration !== false && /bash$/.test(shell)) {
    env.PROMPT_COMMAND = `printf '\\033]7;file://%s%s\\a' "$HOSTNAME" "$PWD"${env.PROMPT_COMMAND ? ';' + env.PROMPT_COMMAND : ''}`;
  }
  return env;
}

function spawnLocal(registry, settings, { cols = 80, rows = 24, cwd, shell, args } = {}) {
  const pty = require('node-pty');
  const id = registry.newId();
  const sh = shell || defaultShell(settings);
  const shArgs = args || settings.localShellArgs || ['-l'];
  const env = buildEnv(settings, sh);
  const proc = pty.spawn(sh, shArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env,
  });
  proc.onData((d) => registry.data(id, d));
  proc.onExit(({ exitCode }) => registry.exit(id, exitCode, 'exit'));
  registry.register(id, {
    kind: 'local',
    write: (d) => proc.write(d),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill(),
    pid: proc.pid,
  });
  return { id, pid: proc.pid, shell: sh };
}

// ---------------- Mosh ----------------
function findMosh() {
  const fs = require('fs');
  for (const p of ['/opt/homebrew/bin/mosh', '/usr/local/bin/mosh', '/opt/local/bin/mosh', '/usr/bin/mosh']) if (fs.existsSync(p)) return p;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const out = require('child_process').execFileSync('/bin/zsh', ['-lc', 'command -v mosh'], { encoding: 'utf8', timeout: 5000, env }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return null;
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Mosh session: runs the mosh client in a pty. It bootstraps over ssh (password prompts appear in the
 * terminal), then switches to the UDP state-sync protocol. The host key is NOT left to that ssh: the caller
 * verifies it first through the app's own known-hosts flow (SshManager.verifyHost) and passes the app's
 * known_hosts file, which the bootstrap uses with StrictHostKeyChecking=yes — nothing is accepted blindly
 * and ~/.ssh/known_hosts is never written. The option value is double-quoted for ssh's own parser (the
 * user-data folder may contain spaces: "Application Support") and single-quoted for mosh's shellwords.
 */
function spawnMosh(registry, settings, { cols = 80, rows = 24, host, port, username, privateKeyPath, moshServer, moshPredict, knownHostsFile } = {}) {
  const pty = require('node-pty');
  const bin = findMosh();
  if (!bin) throw new Error('mosh client not found — install it with "brew install mosh"');
  if (!host) throw new Error('host is required');
  const keyFile = privateKeyPath ? privateKeyPath.replace(/^~(?=\/|$)/, os.homedir()) : '';
  const hostKeyOpts = knownHostsFile
    ? ['-o', 'StrictHostKeyChecking=yes', '-o', shQuote(`UserKnownHostsFile="${String(knownHostsFile).replace(/"/g, '')}"`)]
    : ['-o', 'StrictHostKeyChecking=yes']; // no app file given: only keys ssh itself already knows
  const sshCmd = ['ssh', '-p', String(port || 22), ...hostKeyOpts, ...(keyFile ? ['-i', shQuote(keyFile)] : [])].join(' ');
  const args = [`--ssh=${sshCmd}`];
  if (moshServer) args.push(`--server=${moshServer}`);
  if (moshPredict && moshPredict !== 'adaptive') args.push(`--predict=${moshPredict}`);
  args.push(`${username ? username + '@' : ''}${host}`);
  const env = buildEnv({ ...settings, localShellIntegration: false }, '/bin/sh');
  env.PATH = [require('path').dirname(bin), '/usr/bin', '/bin', '/usr/sbin', '/sbin', env.PATH || ''].filter(Boolean).join(':');
  env.MOSH_TITLE_NOPREFIX = '1';
  const id = registry.newId();
  const proc = pty.spawn(bin, args, { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env });
  proc.onData((d) => registry.data(id, d));
  proc.onExit(({ exitCode }) => registry.exit(id, exitCode, 'exit'));
  registry.register(id, {
    kind: 'mosh',
    write: (d) => proc.write(d),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill(),
    pid: proc.pid,
  });
  return { id, pid: proc.pid, client: bin };
}

// ---------------- Telnet ----------------
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const OPT_ECHO = 1, OPT_SGA = 3, OPT_TTYPE = 24, OPT_NAWS = 31;

function spawnTelnet(registry, { host, port = 23, cols = 80, rows = 24 }) {
  const id = registry.newId();
  const sock = net.connect({ host, port });
  let curCols = cols, curRows = rows;
  let state = 0, cmd = 0, sb = [];

  const sendNaws = () => {
    const b = Buffer.from([IAC, SB, OPT_NAWS, (curCols >> 8) & 255, curCols & 255, (curRows >> 8) & 255, curRows & 255, IAC, SE]);
    sock.write(b);
  };

  const { StringDecoder } = require('string_decoder');
  const decoder = new StringDecoder('utf8');
  sock.on('connect', () => registry.data(id, `\x1b[90mConnected to ${host}:${port}\x1b[0m\r\n`));
  sock.on('data', (buf) => {
    const out = [];
    for (const b of buf) {
      switch (state) {
        case 0:
          if (b === IAC) state = 1;
          else out.push(b);
          break;
        case 1: // after IAC
          if (b === IAC) { out.push(255); state = 0; }
          else if (b === DO || b === DONT || b === WILL || b === WONT) { cmd = b; state = 2; }
          else if (b === SB) { sb = []; state = 3; }
          else state = 0;
          break;
        case 2: { // option byte
          const opt = b;
          if (cmd === DO) {
            if (opt === OPT_NAWS) { sock.write(Buffer.from([IAC, WILL, opt])); sendNaws(); }
            else if (opt === OPT_TTYPE || opt === OPT_SGA) sock.write(Buffer.from([IAC, WILL, opt]));
            else sock.write(Buffer.from([IAC, WONT, opt]));
          } else if (cmd === WILL) {
            if (opt === OPT_ECHO || opt === OPT_SGA) sock.write(Buffer.from([IAC, DO, opt]));
            else sock.write(Buffer.from([IAC, DONT, opt]));
          }
          state = 0;
          break;
        }
        case 3: // inside SB
          if (b === IAC) state = 4;
          else sb.push(b);
          break;
        case 4:
          if (b === SE) {
            if (sb[0] === OPT_TTYPE && sb[1] === 1) {
              sock.write(Buffer.concat([Buffer.from([IAC, SB, OPT_TTYPE, 0]), Buffer.from('XTERM-256COLOR'), Buffer.from([IAC, SE])]));
            }
            state = 0;
          } else { sb.push(b); state = 3; }
          break;
      }
    }
    if (out.length) registry.data(id, decoder.write(Buffer.from(out)));
  });
  sock.on('error', (e) => registry.data(id, `\r\n\x1b[31mTelnet error: ${e.message}\x1b[0m\r\n`));
  sock.on('close', () => registry.exit(id, 0, 'closed'));

  registry.register(id, {
    kind: 'telnet',
    write: (d) => {
      const raw = Buffer.from(d, 'utf8');
      const parts = [];
      for (const b of raw) {
        if (b === 255) parts.push(255, 255);
        else if (b === 13) parts.push(13, 10);
        else parts.push(b);
      }
      sock.write(Buffer.from(parts));
    },
    resize: (c, r) => { curCols = c; curRows = r; sendNaws(); },
    kill: () => sock.destroy(),
  });
  return { id };
}

// ---------------- Serial ----------------
/**
 * Open a serial console (USB-serial adapters, routers, embedded boards).
 * opts: {path, baudRate, dataBits, stopBits, parity, flow:'none'|'rtscts'|'xonxoff', localEcho, newline:'cr'|'lf'|'crlf'}
 */
function spawnSerial(registry, opts) {
  const { SerialPort } = require('serialport');
  const { StringDecoder } = require('string_decoder');
  const id = registry.newId();
  const baudRate = parseInt(opts.baudRate, 10) || 9600;
  const port = new SerialPort({
    path: opts.path,
    baudRate,
    dataBits: parseInt(opts.dataBits, 10) || 8,
    stopBits: parseFloat(opts.stopBits) || 1,
    parity: opts.parity || 'none',
    rtscts: opts.flow === 'rtscts',
    xon: opts.flow === 'xonxoff',
    xoff: opts.flow === 'xonxoff',
    autoOpen: false,
  });
  const decoder = new StringDecoder('utf8');
  const nl = { cr: '\r', lf: '\n', crlf: '\r\n' }[opts.newline || 'cr'];
  let closed = false;
  const finish = (code, reason) => {
    if (closed) return;
    closed = true;
    registry.exit(id, code, reason);
  };
  port.open((err) => {
    if (err) {
      registry.data(id, `\r\n\x1b[31mCannot open ${opts.path}: ${err.message}\x1b[0m\r\n`);
      return finish(1, 'failed');
    }
    registry.data(id, `\x1b[90mConnected to ${opts.path} @ ${baudRate} ${port.settings.dataBits}${(port.settings.parity || 'none')[0].toUpperCase()}${port.settings.stopBits}\x1b[0m\r\n`);
  });
  port.on('data', (b) => registry.data(id, decoder.write(b)));
  port.on('error', (e) => registry.data(id, `\r\n\x1b[31mSerial error: ${e.message}\x1b[0m\r\n`));
  port.on('close', () => finish(0, 'closed'));
  registry.register(id, {
    kind: 'serial',
    write: (d) => {
      if (!port.isOpen) return;
      if (opts.localEcho) registry.data(id, d.replace(/\r/g, '\r\n'));
      port.write(d.replace(/\r/g, nl));
    },
    resize: () => {},
    kill: () => (port.isOpen ? port.close(() => finish(0, 'closed')) : finish(0, 'closed')),
  });
  return { id };
}

async function listSerialPorts() {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  return ports
    .filter((p) => !/Bluetooth-Incoming|debug-console/.test(p.path))
    .map((p) => ({ path: p.path.replace('/dev/tty.', '/dev/cu.'), manufacturer: p.manufacturer || '', serialNumber: p.serialNumber || '', vendorId: p.vendorId, productId: p.productId }))
    .filter((p, i, a) => a.findIndex((x) => x.path === p.path) === i);
}

module.exports = { TerminalRegistry, PlainTextFilter, spawnLocal, spawnTelnet, spawnSerial, listSerialPorts, defaultShell, spawnMosh, findMosh };
