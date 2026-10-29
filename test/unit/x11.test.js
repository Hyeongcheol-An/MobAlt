'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const x11 = require('../../src/main/x11');

test('displayNumber parses common DISPLAY forms', () => {
  assert.equal(x11.displayNumber(':0'), 0);
  assert.equal(x11.displayNumber(':1.0'), 1);
  assert.equal(x11.displayNumber('localhost:10.0'), 10);
  assert.equal(x11.displayNumber('/private/tmp/com.apple.launchd.abc/org.xquartz:0'), 0);
  assert.equal(x11.displayNumber(''), 0);
});

test('socketPathFor maps launchd paths and display numbers', () => {
  assert.equal(x11.socketPathFor('/private/tmp/com.apple.launchd.abc/org.xquartz:0'), '/private/tmp/com.apple.launchd.abc/org.xquartz:0');
  assert.equal(x11.socketPathFor(':2'), '/tmp/.X11-unix/X2');
});

test('findDisplay honours DISPLAY env', () => {
  const old = process.env.DISPLAY;
  process.env.DISPLAY = 'localhost:3';
  assert.equal(x11.findDisplay(), 'localhost:3');
  if (old === undefined) delete process.env.DISPLAY;
  else process.env.DISPLAY = old;
});
