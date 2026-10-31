'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { expandTargets, parsePorts, scan, MAX_HOSTS, MAX_PORTS, DEFAULT_PORTS } = require('../../src/main/netscan');

test('expandTargets: a CIDR lists the host addresses (network and broadcast left out below /31)', () => {
  const c = expandTargets('192.168.1.0/24');
  assert.equal(c.length, 254);
  assert.equal(c[0], '192.168.1.1');
  assert.equal(c[253], '192.168.1.254');
  assert.deepEqual(expandTargets('10.0.0.5/30'), ['10.0.0.5', '10.0.0.6'], 'network .4 and broadcast .7 are left out');
  assert.deepEqual(expandTargets('10.0.0.5/31'), ['10.0.0.4', '10.0.0.5'], 'a /31 is a point-to-point pair');
  assert.deepEqual(expandTargets('10.0.0.5/32'), ['10.0.0.5']);
  assert.deepEqual(expandTargets(' 127.0.0.1/32 '), ['127.0.0.1']);
  assert.deepEqual(expandTargets('10.1.2.3/24').slice(0, 2), ['10.1.2.1', '10.1.2.2'], 'the host bits of the address do not matter');
  const big = expandTargets('172.16.0.0/16');
  assert.equal(big.length, 65534);
  assert.equal(big[0], '172.16.0.1');
  assert.equal(big[65533], '172.16.255.254');
  assert.equal(expandTargets('10.1.2.3/16')[0], '10.1.0.1');
  assert.equal(expandTargets('255.255.255.255/32')[0], '255.255.255.255', 'the top of the address space does not overflow');
});

test('expandTargets: ranges, inclusive, also over the last octet', () => {
  assert.deepEqual(expandTargets('10.0.0.1-10.0.0.3'), ['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  assert.deepEqual(expandTargets('10.0.0.254 - 10.0.1.1'), ['10.0.0.254', '10.0.0.255', '10.0.1.0', '10.0.1.1']);
  assert.deepEqual(expandTargets('10.0.0.1-3'), ['10.0.0.1', '10.0.0.2', '10.0.0.3'], 'last-octet shorthand');
  assert.deepEqual(expandTargets('10.0.0.1-10.0.0.1'), ['10.0.0.1']);
  assert.equal(expandTargets('10.0.0.0-10.0.255.255').length, MAX_HOSTS, 'exactly a /16 worth is allowed');
});

test('expandTargets: a single address or host name is passed through', () => {
  assert.deepEqual(expandTargets('10.0.0.7'), ['10.0.0.7']);
  assert.deepEqual(expandTargets('web-01.example.com'), ['web-01.example.com'], 'a dash in a name is not a range');
  assert.deepEqual(expandTargets('localhost'), ['localhost']);
  assert.deepEqual(expandTargets('nas.'), ['nas.']);
  assert.deepEqual(expandTargets('::1'), ['::1']);
  assert.deepEqual(expandTargets('fe80::1'), ['fe80::1']);
});

test('expandTargets refuses nonsense, reversed ranges and anything beyond a /16, with a message for the toast', () => {
  assert.throws(() => expandTargets(''), /Enter a target: a CIDR \(192\.168\.1\.0\/24\), a range \(10\.0\.0\.1-10\.0\.0\.50\) or a host/);
  assert.throws(() => expandTargets('   '), /Enter a target/);
  assert.throws(() => expandTargets(undefined), /Enter a target/);
  assert.throws(() => expandTargets('10.0.0.0/8'), /^Error: Range too large: 16,777,216 addresses; the limit is a \/16 \(65,536\)$/);
  assert.throws(() => expandTargets('10.0.0.0/15'), /Range too large: 131,072 addresses/);
  assert.throws(() => expandTargets('10.0.0.0/0'), /Range too large/);
  assert.throws(() => expandTargets('10.0.0.0-10.1.0.0'), /Range too large: 65,537 addresses/);
  assert.throws(() => expandTargets('10.0.0.9-10.0.0.1'), /The range ends before it starts: 10\.0\.0\.9-10\.0\.0\.1/);
  assert.throws(() => expandTargets('10.0.0.9-1'), /ends before it starts/);
  assert.throws(() => expandTargets('10.0.0.1-300'), /Not a valid range/);
  assert.throws(() => expandTargets('10.0.0.1-foo'), /Not a valid range/);
  assert.throws(() => expandTargets('10.0.0.0/33'), /Not a valid CIDR: 10\.0\.0\.0\/33/);
  assert.throws(() => expandTargets('10.0.0/24'), /Not a valid CIDR/);
  assert.throws(() => expandTargets('example.com/24'), /Not a valid CIDR/);
  assert.throws(() => expandTargets('999.1.1.1'), /Not a CIDR, an address range or a host name: 999\.1\.1\.1/);
  assert.throws(() => expandTargets('a b'), /Not a CIDR/);
  assert.throws(() => expandTargets('-bad-'), /Not a CIDR/);
  assert.throws(() => expandTargets('host_name'), /Not a CIDR/);
});

test('parsePorts: a comma / space separated list with ranges, sorted and unique; empty means the default list', () => {
  assert.deepEqual(parsePorts(''), DEFAULT_PORTS);
  assert.deepEqual(parsePorts(undefined), [22, 80, 443, 3389, 5900]);
  assert.notEqual(parsePorts(''), DEFAULT_PORTS, 'a copy, not the shared list');
  assert.deepEqual(parsePorts('443, 22,80 2222;22'), [22, 80, 443, 2222]);
  assert.deepEqual(parsePorts('8000-8003'), [8000, 8001, 8002, 8003]);
  assert.deepEqual(parsePorts(' 22 '), [22]);
  assert.throws(() => parsePorts('22,http'), /Not a port: http/);
  assert.throws(() => parsePorts('0'), /Ports must be between 1 and 65535: 0/);
  assert.throws(() => parsePorts('70000'), /between 1 and 65535/);
  assert.throws(() => parsePorts('80-22'), /between 1 and 65535: 80-22/);
  assert.throws(() => parsePorts('1-1000'), new RegExp(`Too many ports; the limit is ${MAX_PORTS}`));
});

test('scan: a listening TCP port on 127.0.0.1 is a hit with its rtt and open ports; progress and done follow', async () => {
  const srv = net.createServer(() => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const events = [];
  const s = scan(['127.0.0.1'], { method: 'tcp', ports: [1, port], timeout: 500, reverseDns: false }, (e) => events.push(e));
  assert.equal(s.total, 1);
  await s.promise;
  srv.close();
  const hit = events.find((e) => e.type === 'hit');
  assert.ok(hit, 'a hit');
  assert.equal(hit.ip, '127.0.0.1');
  assert.equal(hit.host, '127.0.0.1');
  assert.deepEqual(hit.ports, [port], 'port 1 is closed');
  assert.equal(typeof hit.rtt, 'number');
  assert.equal(hit.hostname, null, 'no reverse lookup asked');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.deepEqual([done.done, done.total, done.hits, done.cancelled], [1, 1, 1, false]);
  assert.ok(events.some((e) => e.type === 'progress' && e.done === 1 && e.total === 1), 'the final progress');
});

test('scan: a closed host is no hit; a host name that does not resolve is an error event', async () => {
  const events = [];
  await scan(['127.0.0.1', 'no-such-host.invalid'], { method: 'tcp', ports: [1], timeout: 500, reverseDns: false }, (e) => events.push(e)).promise;
  assert.equal(events.filter((e) => e.type === 'hit').length, 0);
  const err = events.find((e) => e.type === 'error');
  assert.ok(err && err.host === 'no-such-host.invalid' && /Cannot resolve no-such-host\.invalid/.test(err.message));
  const done = events.at(-1);
  assert.deepEqual([done.type, done.done, done.total, done.hits], ['done', 2, 2, 0]);
});

test('scan: ping finds 127.0.0.1 (the system ping, no root) and the reverse lookup names it', { skip: process.platform === 'win32' }, async () => {
  const events = [];
  await scan(['127.0.0.1'], { method: 'ping', timeout: 1000 }, (e) => events.push(e)).promise;
  const hit = events.find((e) => e.type === 'hit');
  assert.ok(hit, 'loopback answers a ping: ' + JSON.stringify(events));
  assert.deepEqual(hit.ports, []);
  assert.ok(typeof hit.rtt === 'number' && hit.rtt >= 0 && hit.rtt < 1000, 'rtt from ping: ' + hit.rtt);
  assert.ok(hit.hostname === null || typeof hit.hostname === 'string');
});

test('scan: cancel() ends a run at once — the probes in flight are dropped and done says cancelled', async () => {
  const targets = expandTargets('127.0.0.2-127.0.0.40'); // loopback addresses nothing listens on: the connects time out (nothing leaves the machine)
  const events = [];
  const t0 = Date.now();
  const s = scan(targets, { method: 'tcp', ports: [1, 2], timeout: 5000, concurrency: 4, reverseDns: false }, (e) => events.push(e));
  setTimeout(() => s.cancel(), 150);
  await s.promise;
  const took = Date.now() - t0;
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.cancelled, true);
  assert.ok(done.done < targets.length, `stopped early: ${done.done}/${targets.length}`);
  assert.ok(took < 1500, `the 5 s connects did not hold it up: ${took} ms`);
  s.cancel(); // a second cancel is harmless
});
