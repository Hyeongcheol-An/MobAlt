'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-kh-'));
const kh = require('../../src/main/knownhosts');

function fakeKey(type = 'ssh-ed25519') {
  const t = Buffer.from(type);
  const body = crypto.randomBytes(32);
  return Buffer.concat([Buffer.from([0, 0, 0, t.length]), t, Buffer.from([0, 0, 0, body.length]), body]);
}

test('readKeyType and fingerprint formats', () => {
  const k = fakeKey('ssh-rsa');
  assert.equal(kh.readKeyType(k), 'ssh-rsa');
  const fp = kh.fingerprint(k);
  assert.match(fp.sha256, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.match(fp.md5, /^MD5:([0-9a-f]{2}:){15}[0-9a-f]{2}$/);
});

test('unknown -> remember -> ok -> mismatch -> forget', () => {
  const k1 = fakeKey();
  const k2 = fakeKey();
  assert.equal(kh.check('example.test', 2222, k1), 'unknown');
  kh.remember('example.test', 2222, k1);
  assert.equal(kh.check('example.test', 2222, k1), 'ok');
  assert.equal(kh.check('example.test', 2222, k2), 'mismatch');
  assert.equal(kh.check('example.test', 22, k1), 'unknown', 'port-specific entry must not match default port');
  kh.forget('example.test', 2222);
  assert.equal(kh.check('example.test', 2222, k1), 'unknown');
});

test('default port entries are stored without brackets and matched', () => {
  const k = fakeKey('ecdsa-sha2-nistp256');
  kh.remember('plain.test', 22, k);
  const text = fs.readFileSync(path.join(process.env.MOBALT_USER_DATA, 'known_hosts'), 'utf8');
  assert.match(text, /^plain\.test ecdsa-sha2-nistp256 /m);
  assert.equal(kh.check('plain.test', 22, k), 'ok');
  assert.equal(kh.check('plain.test', undefined, k), 'ok');
});
