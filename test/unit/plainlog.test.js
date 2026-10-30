'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-log-'));
const { PlainTextFilter, TerminalRegistry } = require('../../src/main/terminals');

test('plain log filter: strips sequences and reproduces the line as the user saw it', () => {
  const f = new PlainTextFilter();
  assert.equal(f.push('\x1b[31mred\x1b[0m\r\n'), 'red\n');
  assert.equal(f.push('\x1b]7;file://host/tmp/x\x07$ \x1b]0;title\x1b\\ok\n'), '$ ok\n'); // OSC 7 (BEL) and OSC with ST
  assert.equal(f.push('a\x1b(Bb\x1b=c\x1b7d\x1bMe\n'), 'abcde\n'); // charset, keypad, save cursor, reverse index
  assert.equal(f.push('\x1b[?2004h\x1b[1;5H\x1b[K\n'), '\n');
  assert.equal(f.push('50%\r100%\r\n'), '100%\n'); // CR returns to column 0: a progress line keeps its final state
  assert.equal(f.push('p\x08printf hi\n'), 'printf hi\n'); // zsh echoes "p", backspace, then re-draws the line
  assert.equal(f.push('\x1b[7m%\x1b[27m' + ' '.repeat(20) + '\r \r\x1b[0m\x1b[J$ ls\n'), '$ ls\n'); // zsh end-of-line marker
  assert.equal(f.push('\x07bell\ttab\x1bP+q544e\x1b\\dcs\n'), 'bell\ttabdcs\n');
  assert.equal(f.push('abcdef\x1b[3D\x1b[KX\n'), 'abcX\n'); // cursor left + erase to end of line
  assert.equal(f.flush(), '');
});

test('plain log filter: sequences, CR LF and lines split across chunks', () => {
  const f = new PlainTextFilter();
  assert.equal(f.push('x\x1b['), '');
  assert.equal(f.push('32'), '');
  assert.equal(f.push('mgreen\x1b'), '');
  assert.equal(f.push(']7;file:///a'), '');
  assert.equal(f.push('\x07z\r'), '');
  assert.equal(f.push('\nnext\x1b]0;t\x1b'), 'xgreenz\n'); // ESC that may start ST waits
  assert.equal(f.push('\\!'), '');
  assert.equal(f.push('end\r'), '');
  assert.equal(f.flush(), 'next!end\n'); // an unfinished line is written out at the end
  assert.equal(f.push('after\n'), 'after\n');
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
