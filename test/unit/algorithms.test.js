'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('ssh2/lib/protocol/constants');
const A = require('../../src/main/algorithms');

test('the tables are ssh2 1.x\'s own lists and the legacy additions are all supported', () => {
  assert.deepEqual(A.DEFAULTS.kex, C.DEFAULT_KEX);
  assert.deepEqual(A.DEFAULTS.serverHostKey, C.DEFAULT_SERVER_HOST_KEY);
  assert.deepEqual(A.DEFAULTS.cipher, C.DEFAULT_CIPHER);
  assert.deepEqual(A.DEFAULTS.hmac, C.DEFAULT_MAC);
  assert.deepEqual(A.SUPPORTED.kex, C.SUPPORTED_KEX);
  for (const cat of A.CATEGORIES) for (const a of A.LEGACY[cat]) assert.ok(A.SUPPORTED[cat].includes(a), `${a} is supported`);
  const d = A.describe();
  assert.deepEqual(Object.keys(d).sort(), ['categories', 'defaults', 'labels', 'legacy', 'supported']);
  assert.deepEqual(d.defaults.kex, [...C.DEFAULT_KEX]);
});

test('parseList splits on commas, whitespace and newlines and drops duplicates', () => {
  assert.deepEqual(A.parseList(' curve25519-sha256, ecdh-sha2-nistp256\n ecdh-sha2-nistp256 ;aes128-ctr '), ['curve25519-sha256', 'ecdh-sha2-nistp256', 'aes128-ctr']);
  assert.deepEqual(A.parseList(''), []);
  assert.deepEqual(A.parseList(null), []);
});

test('presetLists: the defaults, plus the legacy additions once each when the preset is on', () => {
  const plain = A.presetLists(false), legacy = A.presetLists(true);
  assert.deepEqual(plain.kex, [...C.DEFAULT_KEX]);
  assert.deepEqual(legacy.kex, [...C.DEFAULT_KEX, 'diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1']);
  assert.deepEqual(legacy.serverHostKey, [...C.DEFAULT_SERVER_HOST_KEY, 'ssh-dss']); // ssh-rsa is a default already: not twice
  assert.deepEqual(legacy.hmac, [...C.DEFAULT_MAC]);
  assert.equal(new Set(legacy.cipher).size, legacy.cipher.length);
});

test('validate: unknown names are a readable error per category, nothing else', () => {
  const ok = A.validate({ kex: 'curve25519-sha256', serverHostKey: ['ssh-ed25519', 'rsa-sha2-512'], cipher: '', hmac: 'hmac-sha2-256, hmac-sha2-512' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.value, { kex: ['curve25519-sha256'], serverHostKey: ['ssh-ed25519', 'rsa-sha2-512'], cipher: [], hmac: ['hmac-sha2-256', 'hmac-sha2-512'] });
  const bad = A.validate({ kex: 'curve25519-sha256, mlkem768x25519-sha256', cipher: 'aes128-ctr aes128-foo aes256-bar' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.kex, 'Unknown key exchange algorithm: mlkem768x25519-sha256');
  assert.equal(bad.errors.cipher, 'Unknown cipher algorithms: aes128-foo, aes256-bar');
  assert.equal(bad.errors.hmac, undefined);
});

test('normalize stores only lists that differ from the preset; nothing at all when none does', () => {
  assert.equal(A.normalize({ kex: C.DEFAULT_KEX.join(', '), cipher: '', hmac: '' }, false), undefined);
  assert.equal(A.normalize(A.presetLists(true), true), undefined);
  assert.deepEqual(A.normalize({ kex: 'curve25519-sha256' }, false), { kex: ['curve25519-sha256'] });
  // the legacy additions in a list are the preset when the toggle is on, an override when it is off
  const withLegacy = A.presetLists(true);
  assert.equal(A.normalize(withLegacy, true), undefined);
  assert.deepEqual(Object.keys(A.normalize(withLegacy, false)).sort(), ['cipher', 'kex', 'serverHostKey']);
  // order matters: the same names in another order are an override
  assert.deepEqual(A.normalize({ kex: [...C.DEFAULT_KEX].reverse() }, false).kex, [...C.DEFAULT_KEX].reverse());
});

test('connectOption: explicit lists win, the legacy toggle appends, nothing set means undefined', () => {
  assert.equal(A.connectOption({}), undefined);
  assert.equal(A.connectOption({ algorithms: { kex: [] } }), undefined);
  assert.deepEqual(A.connectOption({ legacyAlgorithms: true }), {
    kex: { append: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1'] },
    serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
    cipher: { append: ['aes128-cbc', 'aes256-cbc', '3des-cbc'] },
  });
  assert.deepEqual(A.connectOption({ algorithms: { kex: ['curve25519-sha256'], hmac: ['hmac-sha2-512'] } }), { kex: ['curve25519-sha256'], hmac: ['hmac-sha2-512'] });
  // a session with both: its own list for the categories it set, the legacy append for the rest
  const both = A.connectOption({ legacyAlgorithms: true, algorithms: { kex: ['curve25519-sha256', 'curve25519-sha256'] } });
  assert.deepEqual(both.kex, ['curve25519-sha256']);
  assert.deepEqual(both.cipher, { append: ['aes128-cbc', 'aes256-cbc', '3des-cbc'] });
  assert.deepEqual(A.offered({ legacyAlgorithms: true }, 'kex').slice(-1), ['diffie-hellman-group-exchange-sha1']);
  assert.deepEqual(A.offered({}, 'cipher'), [...C.DEFAULT_CIPHER]);
});

test('noteRemote collects the server\'s KEXINIT lists from ssh2\'s debug lines and ignores the rest', () => {
  let acc = A.noteRemote(undefined, 'Outbound: Sending KEXINIT');
  assert.equal(acc, undefined);
  acc = A.noteRemote(acc, 'Handshake: (remote) KEX method: sntrup761x25519-sha512@openssh.com,curve25519-sha256,ecdh-sha2-nistp256,ext-info-s,kex-strict-s-v00@openssh.com'); // the markers are not algorithms
  acc = A.noteRemote(acc, 'Handshake: (local) KEX method: curve25519-sha256');
  acc = A.noteRemote(acc, 'Handshake: (remote) C->S cipher: chacha20-poly1305@openssh.com,aes128-ctr');
  acc = A.noteRemote(acc, 'Handshake: (remote) S->C cipher: aes256-gcm@openssh.com'); // the first list per category stays
  acc = A.noteRemote(acc, 'Handshake: (remote) Host key format: ssh-ed25519,rsa-sha2-512');
  acc = A.noteRemote(acc, 'Handshake: (remote) C->S MAC: umac-64-etm@openssh.com,hmac-sha2-256');
  assert.deepEqual(acc, {
    kex: ['sntrup761x25519-sha512@openssh.com', 'curve25519-sha256', 'ecdh-sha2-nistp256'],
    cipher: ['chacha20-poly1305@openssh.com', 'aes128-ctr'],
    serverHostKey: ['ssh-ed25519', 'rsa-sha2-512'],
    hmac: ['umac-64-etm@openssh.com', 'hmac-sha2-256'],
  });
});

test('explainHandshake names both sides and the knob; other errors pass through as null', () => {
  const remote = { kex: ['mlkem768x25519-sha256', 'curve25519-sha256', 'ecdh-sha2-nistp256'], cipher: ['chacha20-poly1305@openssh.com', 'aes128-ctr'] };
  const cfg = { algorithms: { kex: ['diffie-hellman-group14-sha256'] } };
  const m = A.explainHandshake('Handshake failed: no matching key exchange algorithm', cfg, remote);
  assert.equal(m, 'no matching key exchange: this session offers diffie-hellman-group14-sha256; the server offers mlkem768x25519-sha256, curve25519-sha256, ecdh-sha2-nistp256. Advanced SSH → Algorithms: add curve25519-sha256, ecdh-sha2-nistp256 to the key exchange list or Reset to defaults');
  // a cipher mismatch of a session on the defaults against an old server: the legacy preset is the hint
  const old = A.explainHandshake('Handshake failed: no matching C->S cipher', {}, { cipher: ['aes128-cbc', '3des-cbc'] });
  assert.match(old, /^no matching cipher: this session offers aes128-gcm@openssh\.com, .*; the server offers aes128-cbc, 3des-cbc\. The server only speaks old algorithms: tick "Legacy algorithms \(old devices\)" in Advanced SSH$/);
  // the server's list unknown (no KEXINIT seen): still readable
  assert.match(A.explainHandshake('Handshake failed: no matching S->C MAC', { algorithms: { hmac: ['hmac-sha1'] } }, undefined), /^no matching MAC: this session offers hmac-sha1; the server offers nothing it told us about\. Advanced SSH → Algorithms: Reset to defaults$/);
  // a server speaking only what this ssh2 lacks
  assert.match(A.explainHandshake('Handshake failed: no matching key exchange algorithm', {}, { kex: ['mlkem768x25519-sha256'] }), /This version of MobAlt supports none of them$/);
  assert.match(A.explainHandshake('Handshake failed: no matching host key format', {}, { serverHostKey: ['ssh-ed25519'] }), /^no matching host key: .*add ssh-ed25519 to the host key list$/);
  assert.equal(A.explainHandshake('Timed out while waiting for handshake', {}, remote), null);
  assert.equal(A.explainHandshake('', {}, remote), null);
});
