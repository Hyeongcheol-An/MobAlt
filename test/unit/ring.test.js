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
