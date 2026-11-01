'use strict';
// TunnelManager: a bind that fails because the port is taken is worded for the user — on this Mac for a local or dynamic
// forward, on the server for a remote one — and stopForConnection counts the tunnels the Tunnels dialog started.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { TunnelManager, bindError } = require('../../src/main/tunnels');

test('bindError: EADDRINUSE names the port on this Mac; other errors pass through', () => {
  const e = bindError(Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:2223'), { code: 'EADDRINUSE' }), 2223);
  assert.equal(e.message, 'Port 2223 is already in use on this Mac');
  assert.equal(e.code, 'EADDRINUSE');
  const other = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });
  assert.equal(bindError(other, 80), other);
});

test('a local forward on a taken port fails with the worded error; a remote bind the server refuses names the server', async () => {
  const taken = net.createServer();
  await new Promise((r) => taken.listen(0, '127.0.0.1', r));
  const port = taken.address().port;
  const tm = new TunnelManager({ get: () => null }, {});
  const t = { id: 'tn_1', type: 'local', bindHost: '127.0.0.1', bindPort: port, destHost: 'h', destPort: 22 };
  await assert.rejects(tm._startOnClient(t, { forwardOut() {} }, null), (e) => e.message === `Port ${port} is already in use on this Mac` && e.code === 'EADDRINUSE');
  await new Promise((r) => taken.close(r));
  const remote = { id: 'tn_2', type: 'remote', bindHost: '127.0.0.1', bindPort: 8080, destHost: 'h', destPort: 80 };
  const client = { forwardIn: (_h, p, cb) => cb(new Error(`Unable to bind to 127.0.0.1:${p}`)) };
  await assert.rejects(tm._startOnClient(remote, client, { remoteForwards: new Map() }), (e) => e.message === 'Port 8080 is already in use on the server');
});

test('stopForConnection stops every tunnel of the connection and counts the ad-hoc ones', () => {
  const tm = new TunnelManager({ get: () => null }, {});
  tm.tunnels.set('a', { id: 'a', connId: 'c1', adhoc: true, status: 'active' });
  tm.tunnels.set('b', { id: 'b', connId: 'c1', status: 'active' }); // the session's own
  tm.tunnels.set('c', { id: 'c', connId: 'c2', adhoc: true, status: 'active' });
  assert.equal(tm.stopForConnection('c1'), 1);
  assert.deepEqual([...tm.tunnels.keys()], ['c']);
  assert.equal(tm.stopForConnection('c9'), 0);
});
