#!/usr/bin/env node
'use strict';
// Misbehaving TCP servers for the SSH and telnet end-to-end checks (plain Node, no dependencies):
//   node test/tcpsrv.js --port N --mode close                              accept and close at once (no banner)
//   node test/tcpsrv.js --port N --mode banner-close                       send an SSH banner line, then close
//   node test/tcpsrv.js --port N --mode delayproxy --delay 6 --target 127.0.0.1:2222
//                                                 accept, say nothing for --delay s, then relay to the target: a slow
//                                                 sshd. A client that hangs up during the delay is never relayed, so
//                                                 the target sees nothing of a cancelled attempt (--log records both).
//   node test/tcpsrv.js --port N --mode telnet-login                       a telnet host: "login: " on connect, the
//                                                 line typed there answered with "Welcome <name>" and a prompt, every
//                                                 later line echoed as "you typed: <line>"
// --log FILE appends one line per event (listening, accepted #n, client gone before relay #n, relaying #n, relay end)
// so that a test running inside the app can read what the server saw; the same lines go to stderr.
const net = require('net');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const port = parseInt(opt('port', '0'), 10);
const mode = opt('mode', 'close');
const delay = parseFloat(opt('delay', '6'));
const target = opt('target', '127.0.0.1:2222');
const logFile = opt('log', '');
if (!port) { console.error('usage: tcpsrv.js --port N --mode close|banner-close|delayproxy|telnet-login [--delay S] [--target host:port] [--log FILE]'); process.exit(2); }

const stamp = () => new Date().toISOString().slice(11, 23);
function log(...a) {
  const line = `${stamp()} ${a.join(' ')}`;
  process.stderr.write(line + '\n');
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch {} }
}

let n = 0;
const srv = net.createServer((c) => {
  const id = ++n;
  c.on('error', (e) => log(`client #${id} error ${e.code || e.message}`));
  log(`accepted #${id} from ${c.remoteAddress}:${c.remotePort}`);
  if (mode === 'close') {
    c.destroy();
    log(`closed #${id} at once`);
  } else if (mode === 'banner-close') {
    c.write('SSH-2.0-QA-banner-then-close\r\n');
    setTimeout(() => { c.destroy(); log(`closed #${id} after the banner`); }, 200);
  } else if (mode === 'delayproxy') {
    // whatever the client says during the delay (ssh2 sends its banner at once) is kept for the target; a client that
    // hangs up meanwhile is seen (the socket keeps reading, so its EOF arrives) and never relayed
    let gone = false;
    const pending = [];
    const onData = (d) => pending.push(d);
    c.on('data', onData);
    c.once('end', () => { gone = true; });
    c.once('close', () => { gone = true; });
    setTimeout(() => {
      if (gone) return log(`client gone before relay #${id}`);
      const [host, p] = target.split(':');
      const t = net.connect({ host, port: parseInt(p, 10) });
      t.on('error', (e) => { log(`target connect failed #${id} ${e.code || e.message}`); c.destroy(); });
      t.once('connect', () => {
        log(`relaying #${id} to ${target} after ${delay}s`);
        c.removeListener('data', onData);
        if (pending.length) t.write(Buffer.concat(pending));
        c.pipe(t).pipe(c);
        c.once('close', () => { log(`relay end c->t#${id}`); t.destroy(); });
        t.once('close', () => { log(`relay end t->c#${id}`); c.destroy(); });
      });
    }, delay * 1000);
  } else if (mode === 'telnet-login') {
    // typed text only: IAC sequences (the client's WILL/WONT/DO/DONT answers, its NAWS / TTYPE subnegotiations) are
    // parsed away — a state machine like the app's own (src/main/terminals.js spawnTelnet)
    let buf = '', loggedIn = false, state = 0;
    c.write('QA telnet host\r\nlogin: ');
    c.on('data', (d) => {
      for (const b of d) {
        if (state === 1) { // after IAC
          if (b === 255) { buf += '\xff'; state = 0; } else if (b >= 251 && b <= 254) state = 2; else if (b === 250) state = 3; else state = 0;
          continue;
        }
        if (state === 2) { state = 0; continue; } // the option byte of WILL/WONT/DO/DONT
        if (state === 3) { if (b === 255) state = 4; continue; } // inside SB … until IAC SE
        if (state === 4) { state = b === 240 ? 0 : 3; continue; }
        if (b === 255) { state = 1; continue; }
        if (b === 13 || b === 10) {
          if (b === 10 && buf === '') continue; // the LF of a CR LF
          const line = buf.replace(/[^\x20-\x7e]/g, '');
          buf = '';
          if (!loggedIn) { loggedIn = true; log(`login #${id} <${line}>`); c.write(`\r\nWelcome ${line}\r\n$ `); }
          else { log(`line #${id} <${line}>`); c.write(`\r\nyou typed: ${line}\r\n$ `); }
        } else buf += String.fromCharCode(b);
      }
    });
  } else {
    log(`unknown mode ${mode}`);
    c.destroy();
  }
});
srv.on('error', (e) => { log(`listen error ${e.code || e.message}`); process.exit(1); });
srv.listen(port, '127.0.0.1', () => log(`listening ${port} ${mode}`));
