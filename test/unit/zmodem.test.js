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
const { ZmodemManager, zmodemEnabled, safeFileName, uniquePath, offerBatch, leadingText, trailingText, explainError, fmtBytes, expandHome, CANISTR } = require('../../src/main/zmodem');
const { STATUS_DIM, STATUS_FAIL } = require('../../src/main/terminals');

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

test('trailingText: the text-looking tail of a stream remainder, whole UTF-8 characters, without the cancel string\'s backspaces', () => {
  const junk = Buffer.from([0x00, 0xff, 0x9a, 0x18, 0x58, 0x7f]);
  const t = (b) => trailingText(b).toString('utf8');
  assert.equal(t(Buffer.concat([junk, CANISTR, Buffer.from('sz: Transfer incomplete\r\n$ ')])), 'sz: Transfer incomplete\r\n$ ', 'after lrzsz\'s CAN string: the message and the prompt, the backspaces dropped');
  assert.equal(t(Buffer.concat([junk, Buffer.from('\r\n\x1b[1m\x1b[7m%\x1b[27m\r\r안녕 % ', 'utf8')])), '\r\n\x1b[1m\x1b[7m%\x1b[27m\r\r안녕 % ', 'zsh\'s partial-line marker, escapes and Hangul count as text');
  assert.equal(t(Buffer.concat([junk, Buffer.from([0x80, 0x80]), Buffer.from('ok')])), 'ok', 'stray continuation bytes are not a character');
  assert.equal(t(Buffer.from([0xe1, 0x84, 0x80, 0x41])), '\u1100A', 'a three-byte character before the text is kept whole');
  assert.equal(t(Buffer.alloc(0)), '');
  assert.equal(t(junk), '');
  assert.equal(trailingText(Buffer.from('x'.repeat(5000)), 100).length, 100, 'bounded');
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

// ---------------- the aftermath of an abort (a stand-in session; real lrzsz sessions run in test/e2e-zmodem.js) ----------------
const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JUNK = Buffer.from([0x2a, 0x18, 0x41, 0x00, 0xff, 0x9a, 0x1b, 0x5d, 0x12, 0x8e, 0x7f, 0x18, 0x58, 0x01]); // frame bytes, with an ESC ] that would open an OSC on xterm
function midTransfer(zm, registry, handle, id = 't1') {
  registry.register(id, handle);
  const g = zm.guards.get(id);
  let ended = false;
  const session = { _input_buffer: [], has_ended: () => ended, abort() { ended = true; }, _sender: () => { throw new Error('the library must not send: the lrzsz string goes out instead'); } };
  g.session = session;
  g.role = 'receive';
  g.sentry = { consume: (buf) => session._input_buffer.push(...buf) }; // what the session cannot parse stays in its buffer
  const t = zm._newTransfer(g, 'download', 'big.bin', 'big.bin', path.join(os.tmpdir(), 'mobalt-zmodem-test-big.bin'), 1000);
  return { g, session, t };
}

test('abort: the peer gets lrzsz\'s cancel string; the status line goes out at once; the rest of the stream is swallowed until it is quiet, then the text after the peer\'s own CAN string (its message, the prompt) shows; the log keeps the text only', async () => {
  const { registry, zm, text, written, handle } = harness();
  zm.drainIdleMs = 80;
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-zmodem-log-')), 'session.log');
  registry.startLog('t1', logFile);
  const { g, session, t } = midTransfer(zm, registry, handle);
  session._input_buffer.push(...JUNK); // the rest of a frame the session had not parsed
  t.cancelled = true;
  zm._abort(g);
  assert.equal(session.has_ended(), true);
  assert.deepEqual(written.filter((w) => w[0] === 'raw').map((w) => w[1]), [CANISTR], 'eight CANs and ten backspaces went to the peer');
  assert.ok(g.drain && !g.session, 'draining, no session');
  assert.equal(zm.listTransfers()[0].status, 'cancelled', 'settled synchronously');
  assert.ok(text.out.includes('\x1b\\'), 'an ST closes whatever a stray byte opened');
  assert.ok(text.out.endsWith(`\r\x1b[K${STATUS_DIM}Zmodem download of big.bin cancelled\x1b[0m\r\n`), 'the status line, in the dim status colour, with nothing of the frame before it: ' + JSON.stringify(text.out));
  const before = text.out;
  registry.bytes('t1', JUNK); // frames still in flight
  registry.bytes('t1', Buffer.concat([JUNK, JUNK]));
  assert.equal(text.out, before, 'nothing of the remainder reached the terminal');
  assert.equal(registry.write('t1', 'ls\r'), undefined);
  assert.deepEqual(written.filter((w) => w[0] === 'text'), [], 'typing during the drain is dropped');
  registry.write('t1', '\x03');
  assert.deepEqual(written.filter((w) => w[0] === 'text'), [['text', '\x03']], 'Ctrl-C goes through (it ends a stuck sz)');
  // the peer's canit, split across two chunks, then the few frame bytes lrzsz's stdio buffer flushes at exit, then its message
  registry.bytes('t1', Buffer.concat([JUNK, Buffer.from([0x18, 0x18, 0x18])]));
  registry.bytes('t1', Buffer.concat([Buffer.from([0x18, 0x18, 0x18, 0x18, 0x18, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08]), Buffer.from('h'), Buffer.from([0x9a, 0x06, 0x6b, 0x18, 0xe2]), Buffer.from('sz: Transfer incomplete\r\n')]));
  assert.ok(g.drain && g.drain.peerCancel, 'the peer\'s CAN string is noted, the drain goes on until the stream is quiet');
  assert.equal(text.out, before, 'still nothing');
  await wait(60);
  registry.bytes('t1', Buffer.from('$ ')); // the prompt, a moment later
  await wait(200);
  assert.equal(g.drain, null, 'quiet: the drain is over');
  assert.equal(text.out.slice(before.length), 'sz: Transfer incomplete\r\n$ ', 'the message and the prompt, nothing of the frames around the CAN string');
  registry.bytes('t1', Buffer.from('ls\r\n'));
  assert.ok(text.out.endsWith('$ ls\r\n'), 'the stream is live again');
  registry.stopLog('t1');
  await wait(50);
  const log = fs.readFileSync(logFile, 'latin1');
  assert.ok(log.includes('Zmodem download of big.bin cancelled') && log.includes('sz: Transfer incomplete') && log.includes('$ ls'), 'the status line and the text after the drain are logged');
  assert.equal((log.match(/[\x00-\x06\x0e-\x1a\x1c-\x1f\x7f-\xff]/g) || []).length, 0, 'no byte of the stream\'s remainder is in the log');
});

test('abort: a peer that stays quiet after the cancel — the drain ends on idle and the text-looking tail (the prompt) is handed back', async () => {
  const { registry, zm, text, handle } = harness();
  zm.drainIdleMs = 60;
  const { g, t } = midTransfer(zm, registry, handle);
  t.cancelled = true;
  zm._abort(g);
  await tick();
  const before = text.out;
  registry.bytes('t1', Buffer.concat([JUNK, Buffer.from('\r\n% ')]));
  assert.equal(text.out, before);
  await wait(150);
  assert.equal(g.drain, null);
  assert.equal(text.out.slice(before.length), '\r\n% ', 'the prompt, not the frame bytes');
  assert.equal(zm.isActive('t1'), false);
});

test('a peer abort (its CAN string ended the session) is settled as cancelled by the remote side and drained the same way', async () => {
  const { registry, zm, text, written, handle } = harness();
  zm.drainIdleMs = 50;
  const { g, t } = midTransfer(zm, registry, handle);
  // what zmodem.js leaves once it found CAN×5: the session aborted, the bytes after the five CANs still in its buffer
  const session = { _input_buffer: [0x18, 0x18, 0x18, ...Buffer.from('\b'.repeat(10) + 'rz: canceled\r\n$ ')], has_ended: () => true, aborted: () => true };
  g.session = session;
  zm._sessionEnd(g, session);
  const pub = zm.listTransfers().find((x) => x.id === t.id);
  assert.equal(pub.status, 'error');
  assert.equal(pub.error, 'cancelled by the remote side');
  assert.ok(text.out.includes(`${STATUS_FAIL}Zmodem download of big.bin failed: cancelled by the remote side`), text.out);
  assert.deepEqual(written.filter((w) => w[0] === 'raw'), [], 'no cancel string back to a peer that cancelled');
  await wait(150);
  assert.ok(text.out.endsWith('rz: canceled\r\n$ '), 'its message and the prompt follow the status line: ' + JSON.stringify(text.out.slice(-60)));
  assert.equal(g.lastError, null);
});

test('abort: a drain that never goes quiet is capped, and the cancel string is sent once more meanwhile', async () => {
  const { registry, zm, written, handle } = harness();
  zm.drainIdleMs = 50;
  zm.drainMaxMs = 120;
  const { g, t } = midTransfer(zm, registry, handle);
  t.cancelled = true;
  zm._abort(g);
  g.drain.since -= 1500; // pretend the stream has been flowing for a while
  registry.bytes('t1', JUNK);
  assert.equal(written.filter((w) => w[0] === 'raw').length, 2, 'the cancel string went out again');
  const t0 = Date.now();
  while (g.drain && Date.now() - t0 < 1000) { registry.bytes('t1', JUNK); await wait(20); }
  assert.equal(g.drain, null, 'the cap ended it');
});

test('silence: unparsed bytes and then nothing for silenceMs end the session as "the remote side stopped" and hand those bytes back', async () => {
  const { registry, zm, text, written, handle } = harness();
  zm.silenceMs = 60;
  zm.drainIdleMs = 40;
  const { g, session, t } = midTransfer(zm, registry, handle);
  registry.bytes('t1', Buffer.from([0x2a, 0x18])); // a frame start that never completes…
  assert.ok(g.silence, 'armed while bytes wait unparsed');
  session._input_buffer.length = 0; // …parsed after all
  registry.bytes('t1', Buffer.alloc(0));
  assert.equal(g.silence, null, 'nothing waiting: not armed');
  registry.bytes('t1', Buffer.from('\r\n\x1b[7m%\x1b[27m\r\nuser@host ~ % ')); // the shell's prompt after sz was killed
  await wait(200);
  assert.equal(session.has_ended(), true);
  assert.equal(zm.listTransfers().find((x) => x.id === t.id).status, 'error');
  assert.equal(zm.listTransfers().find((x) => x.id === t.id).error, 'the remote side stopped');
  assert.ok(text.out.includes(`${STATUS_FAIL}Zmodem download of big.bin failed: the remote side stopped`), text.out);
  assert.ok(text.out.endsWith('\r\n\x1b[7m%\x1b[27m\r\nuser@host ~ % '), 'the prompt follows the status line: ' + JSON.stringify(text.out.slice(-40)));
  assert.deepEqual(written.filter((w) => w[0] === 'raw').map((w) => w[1]), [CANISTR]);
  registry.write('t1', 'echo ok\r');
  assert.deepEqual(written.filter((w) => w[0] === 'text'), [['text', 'echo ok\r']], 'the input gate is released');
});

test('a download is listed under its local name when the folder already has the file; the offered name stays in `remote`', () => {
  const { registry, zm, handle } = harness();
  registry.register('t1', handle);
  const g = zm.guards.get('t1');
  g.session = { has_ended: () => false, _input_buffer: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-zmodem-dl-'));
  fs.writeFileSync(path.join(dir, 'one.bin'), 'x');
  const offer = { get_details: () => ({ name: 'one.bin', size: 10 }), accept: () => new Promise(() => {}), skip() {} };
  zm._receive(g, offer, dir);
  const t = zm.listTransfers()[0];
  assert.equal(t.name, 'one (1).bin');
  assert.equal(t.remote, 'one.bin');
  assert.equal(t.local, path.join(dir, 'one (1).bin'));
  zm._finish(zm.transfers.get(t.id), 'cancelled');
  fs.rmSync(dir, { recursive: true, force: true });
});
