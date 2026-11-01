#!/usr/bin/env node
'use strict';
// A virtual serial device for the serial end-to-end check (test/e2e-serial.sh): a pty pair whose slave is the "port"
// MobAlt opens and whose master is a chatty device — every line it receives comes back as "DEVICE> <LINE>" in upper
// case — with a command file through which the test makes the device vanish (both sides of the pair are closed: what
// an unplugged adapter looks like to the open descriptor). node-pty's pty.open is built for Electron (postinstall),
// so the helper runs under Electron as Node:
//   ELECTRON_RUN_AS_NODE=1 npx electron test/serial-device.js --announce <dir>/device.json --cmdfile <dir>/device.cmd
// --announce FILE   written once the device is up: {"path":"/dev/ttysNNN","pid":N}
// --cmdfile FILE    polled every 200 ms for one command; the answer goes to FILE.out and FILE is removed
//                   drop   close both sides of the pair (the device node goes away, reads and writes to it fail)
//                   quit   exit
// Everything the device sees and does is logged to stderr with timestamps.
const fs = require('fs');
const tty = require('tty');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const announce = opt('announce', '');
const cmdfile = opt('cmdfile', '');
const log = (...a) => process.stderr.write(`${new Date().toISOString().slice(11, 23)} ${a.join(' ')}\n`);

let native;
try {
  native = require(path.join(__dirname, '..', 'node_modules', 'node-pty')).native;
} catch (e) {
  log('node-pty is built for Electron: run this helper as ELECTRON_RUN_AS_NODE=1 npx electron test/serial-device.js (' + e.message + ')');
  process.exit(2);
}
const pair = native.open(80, 24); // { master, slave, pty } — the slave stays open here like a device would keep its line
const devPath = pair.pty;
const master = new tty.ReadStream(pair.master);
master.setEncoding('latin1');
let buf = '';
let dropped = false;
master.on('data', (d) => {
  buf += d;
  for (;;) {
    const i = buf.search(/[\r\n]/);
    if (i < 0) break;
    let line = '';
    for (const ch of buf.slice(0, i)) line = ch === '\x7f' || ch === '\b' ? line.slice(0, -1) : line + ch; // a line editor: Backspace erases
    buf = buf.slice(i + 1);
    if (!line) continue;
    log(`got <${line}>`);
    try { fs.writeSync(pair.master, `DEVICE> ${line.toUpperCase()}\r\n`); } catch (e) { log('write failed', e.code || e.message); }
  }
});
master.on('error', (e) => { if (!dropped) log('master error', e.code || e.message); });

function drop() {
  if (dropped) return 'already dropped';
  dropped = true;
  try { master.destroy(); } catch {}
  try { fs.closeSync(pair.master); } catch {}
  try { fs.closeSync(pair.slave); } catch {}
  log('DROP', devPath);
  return 'dropped ' + devPath;
}
function command(line) {
  const c = line.trim().split(/\s+/)[0];
  if (c === 'drop') return drop();
  if (c === 'quit') { log('QUIT'); setTimeout(() => process.exit(0), 50); return 'bye'; }
  return 'unknown ' + c;
}
if (cmdfile) {
  setInterval(() => {
    if (!fs.existsSync(cmdfile)) return;
    let line = '';
    try { line = fs.readFileSync(cmdfile, 'utf8'); fs.unlinkSync(cmdfile); } catch (e) { return log('cmdfile error', e.message); }
    const ans = command(line);
    try { fs.writeFileSync(cmdfile + '.out', ans + '\n'); } catch {}
    log('cmd', line.trim(), '->', ans);
  }, 200);
}
const info = { path: devPath, pid: process.pid };
process.stdout.write(JSON.stringify(info) + '\n');
if (announce) {
  fs.mkdirSync(path.dirname(announce), { recursive: true });
  fs.writeFileSync(announce, JSON.stringify(info));
}
log('device up on', devPath);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
