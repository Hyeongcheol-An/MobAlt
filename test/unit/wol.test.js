'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');

const { parseMac, magicPacket, wake } = require('../../src/main/wol');

const MAGIC = 'ff'.repeat(6) + 'aabbccddeeff'.repeat(16);

test('parseMac takes the colon, dash, Cisco dot and bare spellings in any case and normalises them', () => {
  for (const s of ['aa:bb:cc:dd:ee:ff', 'AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'AA-bb-CC-dd-EE-ff', 'aabb.ccdd.eeff', 'AABB.CCDD.EEFF', 'aabbccddeeff', 'AABBCCDDEEFF', '  AaBbCcDdEeFf  ', '\taa:bb:cc:dd:ee:ff\n']) {
    assert.equal(parseMac(s), 'aa:bb:cc:dd:ee:ff', JSON.stringify(s));
  }
  assert.equal(parseMac('00:11:22:33:44:55'), '00:11:22:33:44:55');
  assert.equal(parseMac('0011.2233.4455'), '00:11:22:33:44:55');
});

test('parseMac is null for anything that is not a MAC', () => {
  for (const s of ['', '   ', 'aa:bb:cc:dd:ee', 'aa:bb:cc:dd:ee:ff:00', 'gg:bb:cc:dd:ee:ff', 'aa:bb-cc:dd:ee:ff', 'aa:bb:cc:dd:ee:f', 'aabb.ccdd.eef', 'aabb.ccdd.eeff.0011', 'aabbccddeef', 'aabbccddeeff0', '192.168.1.1', 'aa bb cc dd ee ff', 'aa:bb:cc:dd:ee:ff x', null, undefined, 42, {}]) {
    assert.equal(parseMac(s), null, JSON.stringify(s));
  }
});

test('magicPacket is 6 × 0xFF followed by the MAC 16 times: 102 bytes', () => {
  const p = magicPacket('01-23-45-67-89-AB');
  assert.ok(Buffer.isBuffer(p));
  assert.equal(p.length, 102);
  assert.equal(p.subarray(0, 6).toString('hex'), 'ffffffffffff');
  assert.equal(p.subarray(6).toString('hex'), '0123456789ab'.repeat(16));
  assert.equal(magicPacket('aabb.ccdd.eeff').toString('hex'), MAGIC);
  assert.throws(() => magicPacket('nope'), /^Error: Invalid MAC address: nope$/);
  assert.throws(() => magicPacket(''), /Invalid MAC address: \(empty\)/);
  assert.throws(() => magicPacket(undefined), /Invalid MAC address: \(empty\)/);
});

test('wake sends the magic packet 3 times, 100 ms apart, to the given address and port', async () => {
  const listener = dgram.createSocket('udp4');
  const got = [];
  listener.on('message', (msg, rinfo) => got.push({ t: Date.now(), hex: msg.toString('hex'), length: msg.length, from: rinfo.address }));
  await new Promise((r) => listener.bind(0, '127.0.0.1', r));
  const port = listener.address().port;
  const t0 = Date.now();
  const r = await wake({ mac: 'AABB.CCDD.EEFF', broadcast: '127.0.0.1', port });
  const took = Date.now() - t0;
  assert.deepEqual(r, { mac: 'aa:bb:cc:dd:ee:ff', broadcast: '127.0.0.1', port, sent: 3 });
  assert.ok(took >= 180 && took < 2000, `two 100 ms gaps: ${took} ms`);
  await new Promise((r) => setTimeout(r, 80));
  listener.close();
  assert.equal(got.length, 3);
  for (const g of got) {
    assert.equal(g.length, 102);
    assert.equal(g.hex, MAGIC);
    assert.equal(g.from, '127.0.0.1');
  }
  assert.ok(got[2].t - got[0].t >= 150, 'spaced out, not a burst');
});

test('wake takes the port as a string (from a form) and resolves with the normalised MAC', async () => {
  const listener = dgram.createSocket('udp4');
  let n = 0;
  listener.on('message', () => n++);
  await new Promise((r) => listener.bind(0, '127.0.0.1', r));
  const port = listener.address().port;
  const r = await wake({ mac: ' 00-11-22-33-44-55 ', broadcast: ' 127.0.0.1 ', port: String(port), repeat: 2, interval: 10 });
  await new Promise((r) => setTimeout(r, 50));
  listener.close();
  assert.deepEqual(r, { mac: '00:11:22:33:44:55', broadcast: '127.0.0.1', port, sent: 2 });
  assert.equal(n, 2);
});

test('wake rejects a bad MAC, broadcast address or port before sending anything', async () => {
  await assert.rejects(wake({ mac: 'zz:zz:zz:zz:zz:zz', broadcast: '127.0.0.1', port: 9 }), /Invalid MAC address: zz:zz:zz:zz:zz:zz/);
  await assert.rejects(wake({}), /Invalid MAC address/);
  await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: 'not-an-address', port: 9 }), /Invalid broadcast address: not-an-address/);
  await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: '::1', port: 9 }), /Invalid broadcast address/);
  for (const port of [0, 65536, -1, 1.5, 'nine']) await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: '127.0.0.1', port }), /between 1 and 65535/, `port ${port}`);
});

test('wake refuses 0.0.0.0 as a broadcast address and a port that is not a whole number, each with its own sentence', async () => {
  await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: '0.0.0.0', port: 9 }), /^Error: Invalid broadcast address: 0\.0\.0\.0 — use 255\.255\.255\.255 or the subnet's broadcast such as 192\.168\.1\.255$/);
  await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: '127.0.0.1', port: '1.5' }), /^Error: The port must be a whole number between 1 and 65535$/);
  await assert.rejects(wake({ mac: 'aabbccddeeff', broadcast: '127.0.0.1', port: 70000 }), /^Error: The port must be between 1 and 65535$/);
});

test('describeSendError: a socket error names the address to check instead of "send EHOSTUNREACH 0.0.0.0:9"', () => {
  const { describeSendError } = require('../../src/main/wol');
  assert.equal(describeSendError(Object.assign(new Error('send EHOSTUNREACH 192.168.9.255:9'), { code: 'EHOSTUNREACH' }), '192.168.9.255', 9).message, 'No route to 192.168.9.255; check the broadcast address (EHOSTUNREACH)');
  assert.equal(describeSendError({ code: 'ENETUNREACH' }, '10.9.9.255', 7).message, 'No route to 10.9.9.255; check the broadcast address (ENETUNREACH)');
  assert.equal(describeSendError({ code: 'EACCES' }, '255.255.255.255', 9).message, 'Sending to 255.255.255.255:9 is not allowed on this Mac (EACCES)');
  assert.equal(describeSendError({ code: 'EADDRNOTAVAIL' }, '1.2.3.255', 9).message, 'Cannot send to 1.2.3.255:9; check the broadcast address (EADDRNOTAVAIL)');
  assert.equal(describeSendError({ code: 'EWHATEVER', message: 'x' }, '1.2.3.255', 9).message, 'Cannot send to 1.2.3.255:9: EWHATEVER');
  assert.equal(describeSendError(new Error('boom'), '1.2.3.255', 9).message, 'Cannot send to 1.2.3.255:9: boom');
});
