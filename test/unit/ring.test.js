'use strict';
// TerminalRegistry keeps the last 256 KB of every terminal's output so that a window taking the terminal over
// (a detached tab) can draw what the previous window showed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TerminalRegistry } = require('../../src/main/terminals');

test('ring: replay returns the output in order and nothing for an unknown id', () => {
  const r = new TerminalRegistry();
  r.register('a', { kind: 'local', write() {}, resize() {}, kill() {} });
  r.data('a', 'hello ');
  r.data('a', 'world\r\n');
  assert.equal(r.replay('a'), 'hello world\r\n');
  assert.equal(r.replay('nope'), '');
});

test('ring: only the last 256 KB are kept, whole chunks first, then a cut at a line start', () => {
  const r = new TerminalRegistry();
  r.register('a', { kind: 'local', write() {}, resize() {}, kill() {} });
  for (let i = 0; i < 300; i++) r.data('a', `line ${String(i).padStart(4, '0')} ${'x'.repeat(1000)}\n`);
  const out = r.replay('a');
  assert.ok(out.length <= 256 * 1024, 'bounded');
  assert.ok(out.length > 250 * 1024, 'nearly full');
  assert.ok(out.startsWith('line '), 'starts at a line');
  assert.ok(out.endsWith('line 0299 ' + 'x'.repeat(1000) + '\n'), 'ends with the newest output');
  // one chunk larger than the ring is cut to its tail
  const r2 = new TerminalRegistry();
  r2.data('b', 'y'.repeat(300 * 1024));
  assert.equal(r2.replay('b').length, 256 * 1024);
});

test('ring: the output of a terminal that ended stays replayable for a while, then goes', async () => {
  const r = new TerminalRegistry();
  r.register('a', { kind: 'local', write() {}, resize() {}, kill() {} });
  r.data('a', 'bye\n');
  r.exit('a', 0, 'exit');
  assert.equal(r.replay('a'), 'bye\n', 'still there right after the exit');
  const ring = r.rings.get('a');
  assert.ok(ring && ring.timer, 'a timer will drop it');
  clearTimeout(ring.timer);
});

test('ring: terminal queries are left out of the replay (a fresh xterm would answer them into the shell), even split across chunks', () => {
  const r = new TerminalRegistry();
  r.register('a', { kind: 'local', write() {}, resize() {}, kill() {} });
  r.data('a', 'vim\x1b]11;?\x07\x1b[?12$p\x1b[c\x1b[>c\x1b[6n\x1b[?6n\x1b[>0q\x1b[?u\x1b[18t\x1b[21;2t\x1bP$qm\x1b\\\x1bP+q544e\x1b\\\x1b]4;1;?\x1b\\\x1bZ ok');
  assert.equal(r.replay('a'), 'vim ok');
  r.data('a', 'a\x1b]1');
  assert.equal(r.replay('a'), 'vim oka\x1b]1', 'the start of a sequence is held back from the ring but replayed as is: the live stream completes it');
  r.data('a', '1;?\x1b\\b');
  assert.equal(r.replay('a'), 'vim okab', 'a query split across two chunks goes too');
  r.data('a', 'x\x1b[3');
  r.data('a', '1mz');
  assert.equal(r.replay('a'), 'vim okabx\x1b[31mz', 'a split non-query is kept whole');
  // what is not a query stays: SGR, the alternate screen, OSC 7 (the folder hook), the status marker, DECSET, a title
  const keep = '\x1b[?1049h\x1b]7;file://h/p\x07\x1b]7704;dim\x07t\x1b[0m\x1b[?2004h\x1b]0;title\x07\x1b[22;0t\x1b[2J';
  r.data('b', keep);
  assert.equal(r.replay('b'), keep);
});
