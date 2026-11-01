'use strict';
// Every SSH socket runs with TCP_NODELAY: ssh2 never sets it and Electron's Node leaves Nagle on, so connectClient makes
// the socket itself (net.connect with noDelay) and hands it to ssh2 as `sock`; the host-key check's socket the same.
// A socket error still reaches the caller as before (ssh2 relays it with its code), and a server that closes before
// the banner fails the connection the way it always did.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-nodelay-'));
const { SshManager } = require('../../src/main/ssh');

const store = { getSettings: () => ({ readyTimeout: 5000 }) };
const noDelayOf = (sock) => { const sym = Object.getOwnPropertySymbols(sock).find((x) => x.description === 'kSetNoDelay'); return sym ? !!sock[sym] : null; };

/** net.connect with a spy around it: every socket it makes and the options it was called with. */
async function spyConnect(run) {
  const calls = [];
  const orig = net.connect;
  net.connect = function (opts, ...rest) { const sock = orig.call(net, opts, ...rest); calls.push({ opts, sock }); return sock; };
  try { await run(); } finally { net.connect = orig; }
  return calls;
}

test('connectClient makes the socket with noDelay and hands it to ssh2; a server closing before the banner still fails the connection', async () => {
  const server = net.createServer((s) => s.end()); // accepts and closes at once: "Connection lost before handshake"
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ssh = new SshManager(null, store, { status() {} });
  const ctx = { out() {} };
  let error = null;
  const calls = await spyConnect(async () => {
    await ssh.connectClient({ host: '127.0.0.1', port, username: 'u', authMethod: 'key', privateKeyPath: '/nonexistent' }, ctx).catch((e) => (error = e));
  });
  server.close();
  assert.ok(error, 'the connection failed');
  assert.match(error.message, /Connection lost before handshake|closed|ECONNRESET/i);
  assert.equal(calls.length, 1, 'one TCP socket, made by connectClient');
  assert.deepEqual(calls[0].opts, { host: '127.0.0.1', port, noDelay: true });
  assert.equal(noDelayOf(calls[0].sock), true, 'TCP_NODELAY on the socket Node made');
  assert.equal(calls[0].sock.getMaxListeners(), 0, 'no listener limit, as ssh2 sets on its own socket');
});

test('a refused port reads as ECONNREFUSED through the socket ssh2 was given (the hint in _explainError keys on it)', async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r)); // a port nothing listens on any more
  const ssh = new SshManager(null, store, { status() {} });
  const ctx = { out() {} };
  let error = null;
  const calls = await spyConnect(async () => {
    await ssh.connectClient({ host: '127.0.0.1', port, username: 'u' }, ctx).catch((e) => (error = e));
  });
  assert.equal(calls.length, 1);
  assert.equal(error && error.code, 'ECONNREFUSED');
  assert.equal(error.level, 'client-socket');
  assert.match(ssh._explainError(error, ctx, { host: '127.0.0.1', port }), /nothing listens on that port/);
});

test('verifyHost connects through a noDelay socket too', async () => {
  const server = net.createServer((s) => s.end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ssh = new SshManager(null, store, { status() {}, hostKey: () => Promise.resolve(false) });
  let result = null;
  const calls = await spyConnect(async () => { result = await ssh.verifyHost({ host: '127.0.0.1', port, username: 'u' }); });
  server.close();
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.noDelay, true);
  assert.equal(calls[0].opts.port, port);
});
