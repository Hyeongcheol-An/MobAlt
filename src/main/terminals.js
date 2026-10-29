'use strict';
// Terminal registry (shared by local pty, ssh shell and telnet) + local pty + telnet.
const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { ensureZdotdir } = require('./zdotdir');

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

  data(id, data) {
    const log = this.logs.get(id);
    if (log) log.write(data);
    this.emit('data', id, data);
  }

  exit(id, code, reason) {
    const log = this.logs.get(id);
    if (log) {
      log.end(`\n--- session ended ${new Date().toISOString()} ---\n`);
      this.logs.delete(id);
    }
    this.map.delete(id);
    this.emit('exit', id, code, reason);
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

  startLog(id, file) {
    this.stopLog(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ws = fs.createWriteStream(file, { flags: 'a' });
    ws.write(`--- session log started ${new Date().toISOString()} ---\n`);
    this.logs.set(id, ws);
    return file;
  }

  stopLog(id) {
    const log = this.logs.get(id);
    if (log) {
      log.end();
      this.logs.delete(id);
    }
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

module.exports = { TerminalRegistry, spawnLocal, spawnTelnet, defaultShell };
