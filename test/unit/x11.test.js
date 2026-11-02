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

// Regression for the 1.0 security review: the proxy used to swap in the real local cookie whatever cookie the remote
// X client presented, so any user on the remote host could reach the Mac's X server through the forwarded display.
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const REAL = 'a'.repeat(32);
const FAKE = 'b'.repeat(32);

function setupRequest(cookieHex, protocol = 'MIT-MAGIC-COOKIE-1', le = true) {
  const name = Buffer.from(protocol, 'latin1');
  const data = cookieHex ? Buffer.from(cookieHex, 'hex') : Buffer.alloc(0);
  const pad = (x) => Buffer.alloc((4 - (x % 4)) % 4);
  const hdr = Buffer.alloc(12);
  hdr[0] = le ? 0x6c : 0x42;
  const w = (v, o) => (le ? hdr.writeUInt16LE(v, o) : hdr.writeUInt16BE(v, o));
  w(11, 2);
  w(name.length, 6);
  w(data.length, 8);
  return Buffer.concat([hdr, name, pad(name.length), data, pad(data.length)]);
}

// A fake local X server on a unix socket that records every byte it receives, plus a fake ssh2 channel.
async function run(request, x11opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-x11-'));
  const sockPath = path.join(dir, 'X.sock');
  const received = [];
  const conns = [];
  const server = net.createServer((s) => {
    conns.push(s);
    s.on('data', (d) => received.push(d));
    s.on('error', () => {});
  });
  await new Promise((r) => server.listen(sockPath, r));
  const ch = new EventEmitter();
  ch.closed = false;
  ch.write = () => {};
  ch.end = () => {};
  ch.close = () => { ch.closed = true; };
  const errors = [];
  x11.proxy(ch, { socketPath: sockPath, realCookie: REAL, fakeCookie: FAKE, ...x11opts }, (m) => errors.push(m));
  // split the request in two to exercise the header buffering
  ch.emit('data', request.slice(0, 7));
  ch.emit('data', request.slice(7));
  await new Promise((r) => setTimeout(r, 150));
  ch.emit('close'); // tears down the proxy's own socket
  for (const c of conns) c.destroy();
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  return { got: Buffer.concat(received), closed: ch.closed, errors };
}

test('x11 proxy: a client with the wrong cookie is refused and never sees the real cookie', async () => {
  const { got, closed, errors } = await run(setupRequest('c'.repeat(32)));
  assert.equal(closed, true);
  assert.equal(got.includes(Buffer.from(REAL, 'hex')), false);
  assert.equal(got.length, 0);
  assert.equal(errors.length, 1);
});

test('x11 proxy: no authorisation or another protocol is refused while a fake cookie exists', async () => {
  for (const req of [setupRequest(null, ''), setupRequest('b'.repeat(32), 'XDM-AUTHORIZATION-1'), setupRequest('bbbb')]) {
    const { got, closed } = await run(req);
    assert.equal(closed, true);
    assert.equal(got.length, 0);
  }
});

test('x11 proxy: the fake cookie is swapped for the real one (both byte orders)', async () => {
  for (const le of [true, false]) {
    const { got, closed, errors } = await run(setupRequest(FAKE, 'MIT-MAGIC-COOKIE-1', le));
    assert.equal(closed, false);
    assert.deepEqual(errors, []);
    assert.deepEqual(got, setupRequest(REAL, 'MIT-MAGIC-COOKIE-1', le));
  }
});

test('x11 proxy: the right cookie without a local cookie is passed through unchanged', async () => {
  const req = setupRequest(FAKE);
  const { got, closed } = await run(req, { realCookie: null });
  assert.equal(closed, false);
  assert.deepEqual(got, req);
});

test('cookieMatches compares in constant time and rejects other lengths', () => {
  assert.equal(x11.cookieMatches(Buffer.from(FAKE, 'hex'), FAKE), true);
  assert.equal(x11.cookieMatches(Buffer.from(REAL, 'hex'), FAKE), false);
  assert.equal(x11.cookieMatches(Buffer.from('bb', 'hex'), FAKE), false);
  assert.equal(x11.cookieMatches(Buffer.from(FAKE, 'hex'), null), false);
});
