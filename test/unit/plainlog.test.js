'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-log-'));
const { PlainTextFilter, TerminalRegistry } = require('../../src/main/terminals');

test('plain log filter: strips CSI/OSC/single-ESC sequences and normalises CR', () => {
  const f = new PlainTextFilter();
  assert.equal(f.push('\x1b[31mred\x1b[0m\r\n'), 'red\n');
  assert.equal(f.push('\x1b]7;file://host/tmp/x\x07$ '), '$ '); // OSC 7 cwd hook (BEL)
  assert.equal(f.push('\x1b]0;title\x1b\\ok'), 'ok'); // OSC with ST
  assert.equal(f.push('a\x1b(Bb\x1b=c\x1b7d\x1bMe'), 'abcde'); // charset, keypad, save cursor, reverse index
  assert.equal(f.push('\x1b[?2004h\x1b[1;5H\x1b[K'), '');
  assert.equal(f.push('50%\r100%\r\n'), '50%\n100%\n'); // lone CR = new line, CR LF = LF
  assert.equal(f.push('\x07bell\x08\ttab'), 'bell\ttab');
  assert.equal(f.push('\x1bP+q544e\x1b\\dcs'), 'dcs');
  assert.equal(f.flush(), '');
});

test('plain log filter: sequences and CR LF split across chunks', () => {
  const f = new PlainTextFilter();
  assert.equal(f.push('x\x1b['), 'x');
  assert.equal(f.push('32'), '');
  assert.equal(f.push('mgreen\x1b'), 'green');
  assert.equal(f.push(']7;file:///a'), '');
  assert.equal(f.push('\x07z\r'), 'z');
  assert.equal(f.push('\nnext\x1b]0;t\x1b'), '\nnext'); // ESC that may start ST waits
  assert.equal(f.push('\\!'), '!');
  assert.equal(f.push('end\r'), 'end');
  assert.equal(f.flush(), '\n');
  assert.equal(f.push('after'), 'after');
});

test('registry: plain log file has text without ESC bytes and keeps the footers', async () => {
  const reg = new TerminalRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-logdir-'));
  const plain = path.join(dir, 'sub', 'plain.log'), raw = path.join(dir, 'raw.log');
  reg.register('a', { write() {}, resize() {}, kill() {} });
  reg.register('b', { write() {}, resize() {}, kill() {} });
  reg.startLog('a', plain, { plain: true });
  reg.startLog('b', raw);
  for (const id of ['a', 'b']) {
    reg.data(id, '\x1b]7;file://h/tmp\x07$ \x1b[1mhi\x1b[0m\r\n');
    reg.data(id, 'tail\r');
  }
  reg.stopLog('a');
  reg.exit('b', 0, 'exit');
  const wait = (f) => new Promise((r) => { const t = setInterval(() => { if (fs.existsSync(f) && /---\n$/.test(fs.readFileSync(f, 'utf8'))) { clearInterval(t); r(); } }, 20); });
  await Promise.all([wait(plain), wait(raw)]);
  const p = fs.readFileSync(plain, 'utf8'), r = fs.readFileSync(raw, 'utf8');
  assert.match(p, /^--- session log started .* ---\n\$ hi\ntail\n\n--- log stopped .* ---\n$/);
  assert.ok(!p.includes('\x1b'));
  assert.ok(r.includes('\x1b[1mhi\x1b[0m\r\n'));
  assert.match(r, /\n--- session ended .* ---\n$/);
});
