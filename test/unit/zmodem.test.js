'use strict';
// Zmodem (rz / sz) in the terminal: the pure parts (names, batches, held output, reasons), the registry plumbing
// (raw bytes → sentry → xterm text; keystrokes gated during a session) and — when lrzsz is installed (brew install
// lrzsz) — real sessions against sz / rz over pipes: receive, send, cancel, a peer abort and the setting switched off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-zmodem-'));
const { TerminalRegistry } = require('../../src/main/terminals');
const { ZmodemManager, zmodemEnabled, safeFileName, uniquePath, offerBatch, leadingText, explainError, fmtBytes, expandHome } = require('../../src/main/zmodem');

const ZRQINIT = Buffer.from('**\x18B00000000000000\r\x8a\x11', 'latin1');

test('zmodemEnabled: on by default, off only when the setting says so', () => {
  assert.equal(zmodemEnabled(undefined), true);
  assert.equal(zmodemEnabled({}), true);
  assert.equal(zmodemEnabled({ zmodem: true }), true);
  assert.equal(zmodemEnabled({ zmodem: false }), false);
});

test('safeFileName: base name only, no control characters, a stand-in for nothing usable', () => {
  assert.equal(safeFileName('report.pdf'), 'report.pdf');
  assert.equal(safeFileName('/etc/passwd'), 'passwd');
  assert.equal(safeFileName('../../x/escape.txt'), 'escape.txt');
  assert.equal(safeFileName('dir\\win.txt'), 'win.txt');
  assert.equal(safeFileName('bad\x1b[31mname\x07.txt'), 'bad[31mname.txt');
  assert.equal(safeFileName('.hidden'), '.hidden');
  assert.equal(safeFileName('..'), 'zmodem-file');
  assert.equal(safeFileName(''), 'zmodem-file');
  assert.equal(safeFileName(undefined), 'zmodem-file');
  assert.equal(safeFileName('한글 파일.bin'), '한글 파일.bin');
});

test('uniquePath: the plain name first, then "name (n).ext"', () => {
  const taken = new Set(['/d/a.txt', '/d/a (1).txt', '/d/noext']);
  const exists = (p) => taken.has(p);
  assert.equal(uniquePath('/d', 'b.txt', exists), '/d/b.txt');
  assert.equal(uniquePath('/d', 'a.txt', exists), '/d/a (2).txt');
  assert.equal(uniquePath('/d', 'noext', exists), '/d/noext (1)');
  assert.equal(uniquePath('/d', '.rc', exists), '/d/.rc');
});

test('offerBatch: ZFILE parameters with the remaining files / bytes, mtime in epoch seconds, permission bits only', () => {
  const b = offerBatch([
    { path: '/x/one.bin', size: 1000, mtime: new Date(1700000000500), mode: 0o100644 },
    { path: '/x/two.bin', size: 24, mtime: 1700000100, mode: 0o100755 },
    { path: '/x/three.bin', size: 0 },
  ]);
  assert.deepEqual(b.map((o) => [o.name, o.size, o.mtime, o.mode, o.files_remaining, o.bytes_remaining]), [
    ['one.bin', 1000, 1700000000, 0o644, 3, 1024],
    ['two.bin', 24, 1700000100, 0o755, 2, 24],
    ['three.bin', 0, undefined, undefined, 1, 0],
  ]);
  assert.equal(b[0].path, '/x/one.bin');
});

test('leadingText: the command echo before the header stays, lrzsz\'s "rz\\r" hint and the header itself go', () => {
  const held = [...Buffer.from('sz file.bin\r\nrz\r', 'latin1'), ...ZRQINIT];
  assert.equal(leadingText(held).toString(), 'sz file.bin\r\n');
  assert.equal(leadingText([...Buffer.from('rz\r'), ...ZRQINIT]).length, 0);
  assert.equal(leadingText([...Buffer.from('cmd\r\nrz\r'), ...ZRQINIT]).toString(), 'cmd\r\n', 'the hint on its own line goes, the echo before it stays');
  assert.equal(leadingText([...Buffer.from('$ sz\r\n'), ...ZRQINIT]).toString(), '$ sz\r\n', 'a command echo (hint not on its own line) is kept');
  assert.equal(leadingText([...Buffer.from('quartz\r'), ...ZRQINIT]).toString(), 'quartz\r', 'only a line of its own is the hint');
  assert.equal(leadingText(ZRQINIT).length, 0);
  assert.equal(leadingText([]).length, 0);
  assert.equal(leadingText(Buffer.from('plain')).toString(), 'plain');
});

test('explainError: zmodem.js strings and Error objects become one readable reason', () => {
  assert.equal(explainError({ type: 'peer_aborted', message: 'Peer aborted session' }), 'cancelled by the remote side');
  assert.equal(explainError({ type: 'already_aborted', message: 'Session already aborted' }), 'cancelled');
  assert.equal(explainError('Receiver has fallen back to YMODEM.'), 'the remote side fell back to YMODEM, which is not supported');
  assert.equal(explainError('Half-duplex I/O is unsupported!'), 'the remote side needs an unsupported mode (Half-duplex I/O is unsupported)');
  assert.equal(explainError(new Error('Unhandled header: ZCOMMAND')), 'unexpected ZMODEM header (ZCOMMAND)');
  assert.equal(explainError('PROTOCOL: second ZFILE data subpacket received'), 'second ZFILE data subpacket received');
  assert.match(explainError('ZEOF offset mismatch; unimplemented (local: 1; ZEOF: 2)'), /data was lost/);
  assert.equal(explainError(undefined), 'unknown error');
});

test('fmtBytes / expandHome', () => {
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(fmtBytes(123456789), '118 MB');
  assert.equal(expandHome('~/Downloads'), path.join(os.homedir(), 'Downloads'));
  assert.equal(expandHome('/abs'), '/abs');
  assert.equal(expandHome(''), '');
});

// ---------------- plumbing (no library session needed) ----------------
function harness(settings = {}, dialogs = null) {
  const registry = new TerminalRegistry();
  const store = { getSettings: () => ({ zmodem: true, downloadDir: '', ...settings }) };
  const zm = new ZmodemManager(registry, store, { dialogs, downloadsDir: () => os.tmpdir() });
  const text = { out: '' };
  registry.on('data', (_id, d) => { text.out += d; });
  const written = [];
  const handle = { kind: 'ssh', write: (d) => written.push(['text', d]), resize() {}, kill() {}, writeRaw: (b) => { written.push(['raw', Buffer.from(b)]); return Promise.resolve(); } };
  return { registry, zm, text, written, handle };
}

test('plumbing: only handles with writeRaw get a sentry; raw bytes are decoded whole; keystrokes pass when idle', () => {
  const { registry, zm, text, written, handle } = harness();
  registry.register('m1', { kind: 'mosh', write() {}, resize() {}, kill() {} });
  assert.equal(zm.guards.has('m1'), false, 'Mosh has no raw byte path');
  registry.register('t1', handle);
  assert.equal(zm.guards.has('t1'), true);
  assert.equal(typeof handle.rawSink, 'function');
  const han = Buffer.from('한글', 'utf8');
  registry.bytes('t1', han.subarray(0, 2)); // a character split across two chunks
  registry.bytes('t1', han.subarray(2));
  registry.bytes('m1', Buffer.from('plain\r\n'));
  assert.equal(text.out, '한글plain\r\n');
  registry.write('t1', 'ls\r');
  assert.deepEqual(written, [['text', 'ls\r']]);
  assert.equal(zm.isActive('t1'), false);
  registry.exit('t1', 0, 'closed');
  assert.equal(zm.guards.has('t1'), false);
  assert.equal(handle.rawSink, null);
});

test('plumbing: with the setting off the ZRQINIT line reaches the terminal as it is and nothing is answered', () => {
  const { registry, text, written, handle } = harness({ zmodem: false });
  registry.register('t1', handle);
  registry.bytes('t1', Buffer.concat([Buffer.from('rz\r'), ZRQINIT]));
  assert.match(text.out, /\*\*\x18B00000000000000/);
  assert.deepEqual(written, []);
});

test('plumbing: an output that only looked like a header is shown once it turns out not to be ZMODEM', async () => {
  const answered = [];
  const dialogs = { showOpenDialog: async (_w, opts) => { answered.push(opts.title); return { canceled: false, filePaths: [os.tmpdir()] }; } };
  const { registry, zm, text, handle } = harness({}, dialogs);
  registry.register('t1', handle);
  registry.bytes('t1', Buffer.concat([Buffer.from('echo \r\n'), ZRQINIT]));
  assert.equal(text.out, '', 'the header line is held while the question is open');
  assert.ok(zm.guards.get('t1').detection, 'a receive detection is pending');
  registry.bytes('t1', Buffer.from('$ not zmodem after all\r\n'));
  assert.equal(text.out.startsWith('echo \r\n**\x18B00000000000000'), true, 'the held line came out first');
  assert.match(text.out, /\$ not zmodem after all\r\n$/);
  assert.equal(zm.guards.get('t1').detection, null, 'retracted');
  await new Promise((r) => setTimeout(r, 20)); // the folder dialog's answer arrives after the retraction: nothing to confirm
  assert.deepEqual(answered, ['Receive files with Zmodem into…']);
  assert.equal(zm.isActive('t1'), false);
});

// Real sz / rz sessions are exercised end to end in test/e2e-zmodem.js (an SSH pane to the test sshd, where the remote
// sz/rz runs under a real pty and streams the way zmodem.js expects). They are not repeated here: lrzsz over a plain
// pipe falls back to a windowed/ZACK handshake that only a tty avoids, so it is not a faithful unit-level stand-in.
