'use strict';
// SshManager.connectClient against real local sockets: every SSH socket runs with TCP_NODELAY (ssh2 never sets it and
// Electron's Node leaves Nagle on, so connectClient makes the socket itself — net.connect with noDelay — and hands it
// to ssh2 as `sock`; the host-key check's socket the same), a socket error still reaches the caller with its code, a
// server that closes before the banner fails the connection the way it always did, and a jump hop's failure is
// explained against the jump host.
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

test('EHOSTUNREACH to a local address: _explainError names the macOS Local Network setting (on a Mac) and marks the context', () => {
  const ssh = new SshManager(null, store, { status() {} });
  const error = Object.assign(new Error('connect EHOSTUNREACH 192.168.77.5:22 - Local (192.168.77.9:50000)'), { code: 'EHOSTUNREACH', level: 'client-socket' });
  const ctx = { out() {} };
  const msg = ssh._explainError(error, ctx, { host: '192.168.77.5', port: 22 });
  if (process.platform === 'darwin') {
    assert.match(msg, /Local Network/);
    assert.equal(ctx.localNetworkBlocked, '192.168.77.5', 'the host the dialog names');
  } else {
    assert.equal(msg, error.message);
    assert.equal(ctx.localNetworkBlocked, undefined);
  }
  // a jump server that cannot reach the target says the same words in the channel open failure — its routing, not this Mac's
  const hop = { out() {} };
  assert.equal(ssh._explainError(new Error('(SSH) Channel open failure: No route to host'), hop, { host: '192.168.1.1', port: 22 }), '(SSH) Channel open failure: No route to host');
  assert.equal(hop.localNetworkBlocked, undefined);
  // the same error to a public address, or a refused port on the LAN, is not the permission
  assert.equal(ssh._explainError(Object.assign(new Error('connect EHOSTUNREACH 203.0.113.5:22'), { code: 'EHOSTUNREACH' }), { out() {} }, { host: '203.0.113.5', port: 22 }), 'connect EHOSTUNREACH 203.0.113.5:22');
  assert.match(ssh._explainError(Object.assign(new Error('connect ECONNREFUSED 192.168.77.5:22'), { code: 'ECONNREFUSED' }), { out() {} }, { host: '192.168.77.5', port: 22 }), /nothing listens/);
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

test('a jump hop that times out is explained against the jump host: the nc hint names its host and port, not the target', async () => {
  const silent = net.createServer((s) => s.on('error', () => {})); // accepts and never speaks: the handshake limit ends it
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  const jumpPort = silent.address().port;
  const ssh = new SshManager(null, { getSettings: () => ({ readyTimeout: 400 }) }, { status() {}, hostKey: () => Promise.resolve(true) });
  const ctx = { out() {} };
  const cfg = { host: 'target.example', port: 2299, username: 'u', jumpHost: `u@127.0.0.1:${jumpPort}` };
  let error = null;
  await ssh.connectClient(cfg, ctx).catch((e) => (error = e));
  silent.close();
  assert.ok(error, 'failed');
  assert.equal(error.explained, true);
  const msg = ssh._explainError(error, ctx, cfg);
  assert.match(msg, /^Jump host failed: Timed out while waiting for handshake/);
  assert.match(msg, new RegExp(`nc -vz 127\\.0\\.0\\.1 ${jumpPort}`), 'the hint names the jump host and its port');
  assert.doesNotMatch(msg, /target\.example|2299/, 'never the target');
});

/** openShell over a stubbed connectClient: a fake client whose end() closes the connection (ctx.onClose), as ssh2's does. */
function shellHarness({ openShell = false } = {}) {
  const exits = [];
  let n = 0;
  const registry = { newId: () => 'ssh-' + ++n, register() {}, data() {}, bytes() {}, exit: (id, code, reason) => exits.push({ id, code, reason }) };
  const ssh = new SshManager(registry, store, { status() {} });
  const EventEmitter = require('events');
  ssh.connectClient = (cfg, ctx) => {
    const client = new EventEmitter();
    client.end = () => setImmediate(() => ctx.onClose());
    client.shell = (opts, sessOpts, cb) => {
      if (!openShell) return; // the server has not answered the shell request yet
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.write = () => true;
      stream.end = () => {};
      stream.setWindow = () => {};
      setImmediate(() => cb(null, stream));
    };
    return Promise.resolve({ client, jump: null });
  };
  return { ssh, exits };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('Disconnect after the login but before the shell opened ends as "cancelled", not as a session that ended', async () => {
  const { ssh, exits } = shellHarness();
  const { id } = ssh.openShell({ host: '127.0.0.1', port: 2222, username: 'u' });
  await tick();
  assert.ok(ssh.get(id) && ssh.get(id).client && !ssh.get(id).stream, 'client up, shell not open');
  ssh.disconnect(id);
  await tick();
  assert.deepEqual(exits.map((e) => e.reason), ['cancelled']);
});

test('Disconnect of an open shell still ends as "closed"', async () => {
  const { ssh, exits } = shellHarness({ openShell: true });
  const { id } = ssh.openShell({ host: '127.0.0.1', port: 2222, username: 'u' });
  await tick();
  assert.ok(ssh.get(id) && ssh.get(id).stream, 'shell open');
  ssh.disconnect(id);
  await tick();
  assert.deepEqual(exits.map((e) => e.reason), ['closed']);
});
