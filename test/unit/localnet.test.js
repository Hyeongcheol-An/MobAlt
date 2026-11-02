'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const localnet = require('../../src/main/localnet');
const { isLocalAddress, isHostUnreachable, unreachableAddress, hint } = localnet;

const unreachable = (addr = '192.168.77.5', port = 22) => Object.assign(new Error(`connect EHOSTUNREACH ${addr}:${port} - Local (192.168.77.9:49790)`), { code: 'EHOSTUNREACH', errno: -65, syscall: 'connect', address: addr, port });

test('isLocalAddress: private and link-local IPv4, ULA and link-local IPv6, .local names', () => {
  for (const h of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.255', '192.168.77.5', '192.168.255.1', '169.254.1.9', 'fe80::1', 'FE80::1%en0', 'fd12:3456::1', 'fc00::1', '[fe80::1]', '::ffff:192.168.77.5', 'nas.local', 'Portal.LOCAL', 'printer.local.', ' 192.168.77.5 ']) {
    assert.equal(isLocalAddress(h), true, h);
  }
});

test('isLocalAddress: public addresses, loopback (exempt from the check) and ordinary names are not local', () => {
  for (const h of ['8.8.8.8', '203.0.113.7', '198.51.100.20', '192.0.2.1', '198.51.100.254', '127.0.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', 'example.com', 'portal.example.local.com', 'localhost', '', null, undefined, 42]) {
    assert.equal(isLocalAddress(h), false, String(h));
  }
});

test('isHostUnreachable: the code, the code in the text, OpenSSH\'s wording; not the other connect failures', () => {
  assert.equal(isHostUnreachable(unreachable()), true);
  assert.equal(isHostUnreachable(new Error('connect EHOSTUNREACH 10.0.0.5:22')), true);
  assert.equal(isHostUnreachable(new Error('ssh: connect to host 192.168.77.5 port 22: No route to host')), true);
  assert.equal(isHostUnreachable('No route to host'), true);
  for (const e of [Object.assign(new Error('connect ECONNREFUSED 192.168.77.5:22'), { code: 'ECONNREFUSED' }), new Error('Timed out while waiting for handshake'), new Error('connect ENETUNREACH 10.0.0.5:22'), null, undefined, '']) {
    assert.equal(isHostUnreachable(e), false, String(e && e.message));
  }
});

test('unreachableAddress reads the address out of Node\'s message, IPv6 and brackets included', () => {
  assert.equal(unreachableAddress(unreachable()), '192.168.77.5');
  assert.equal(unreachableAddress(new Error('connect EHOSTUNREACH 10.1.2.3:2222')), '10.1.2.3');
  assert.equal(unreachableAddress(new Error('connect EHOSTUNREACH fe80::1:22')), 'fe80::1');
  assert.equal(unreachableAddress(new Error('connect EHOSTUNREACH [fe80::1]:22 - Local ([fe80::2]:5)')), 'fe80::1');
  assert.equal(unreachableAddress(Object.assign(new Error('connect EHOSTUNREACH'), { address: '10.7.7.7' })), '10.7.7.7', 'Node\'s address field first');
  assert.equal(unreachableAddress(Object.assign(new Error('x'), { address: '[fe80::9]' })), 'fe80::9');
  assert.equal(unreachableAddress(new Error('No route to host')), null);
  assert.equal(unreachableAddress(null), null);
});

test('hint: on a Mac, EHOSTUNREACH to a local address names the Local Network setting', () => {
  const h = hint(unreachable(), '192.168.77.5', 'darwin');
  assert.equal(typeof h, 'string');
  assert.match(h, /Local Network/);
  assert.match(h, /System Settings/);
  // the address in the message decides, so a name that resolved to a LAN address is covered too
  assert.equal(hint(unreachable('10.0.0.5'), 'portal.example.com', 'darwin'), h);
  // OpenSSH's wording in a pty (Mosh's bootstrap) with the host from the session
  assert.equal(hint(new Error('ssh: connect to host nas.local port 22: No route to host'), 'nas.local', 'darwin'), h);
});

test('hint: nothing before macOS 15 (Darwin 24), on other platforms, for other errors, or for hosts outside the local network', () => {
  assert.equal(hint(unreachable(), '192.168.77.5', 'darwin', '23.6.0'), null); // macOS 14: no such setting
  assert.equal(hint(unreachable(), '192.168.77.5', 'darwin', '22.6.0'), null);
  assert.equal(typeof hint(unreachable(), '192.168.77.5', 'darwin', '24.0.0'), 'string'); // macOS 15.0
  assert.equal(hint(unreachable(), '192.168.77.5', 'linux'), null);
  assert.equal(hint(unreachable(), '192.168.77.5', 'win32'), null);
  assert.equal(hint(Object.assign(new Error('connect ECONNREFUSED 192.168.77.5:22'), { code: 'ECONNREFUSED' }), '192.168.77.5', 'darwin'), null);
  assert.equal(hint(new Error('Timed out while waiting for handshake'), '192.168.77.5', 'darwin'), null);
  assert.equal(hint(unreachable('203.0.113.7', 20022), 'portal.example.com', 'darwin'), null); // a public address: not the permission
  assert.equal(hint(unreachable('127.0.0.1'), '127.0.0.1', 'darwin'), null); // loopback is exempt from the check
  assert.equal(hint(new Error('No route to host'), 'example.com', 'darwin'), null); // no address to judge by
  assert.equal(hint(null, '192.168.77.5', 'darwin'), null);
});

test('hint defaults to this platform and release', () => {
  const expected = process.platform === 'darwin' && Number(require('os').release().split('.')[0]) >= 24 ? 'string' : 'object';
  assert.equal(typeof hint(unreachable(), '192.168.77.5'), expected);
});

test('onBlocked / notify: the listener hears the host; a throwing listener is contained; null clears it', () => {
  const seen = [];
  localnet.onBlocked((host) => seen.push(host));
  localnet.notify('192.168.77.5');
  assert.deepEqual(seen, ['192.168.77.5']);
  localnet.onBlocked(() => { throw new Error('boom'); });
  assert.doesNotThrow(() => localnet.notify('x'));
  localnet.onBlocked(async () => { throw new Error('later'); }); // an async listener's rejection is not left unhandled
  assert.doesNotThrow(() => localnet.notify('y'));
  localnet.onBlocked(null);
  assert.doesNotThrow(() => localnet.notify('y'));
  assert.deepEqual(seen, ['192.168.77.5']);
});

test('SETTINGS_URL opens System Settings at Privacy & Security', () => {
  assert.match(localnet.SETTINGS_URL, /^x-apple\.systempreferences:com\.apple\.preference\.security\?Privacy_LocalNetwork$/);
});
