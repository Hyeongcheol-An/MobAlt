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

test('ensure() copies a key into the app file only when it is missing there, replacing a stale one', () => {
  const file = path.join(process.env.MOBALT_USER_DATA, 'known_hosts');
  const k1 = fakeKey();
  const k2 = fakeKey();
  assert.equal(kh.file(), file);
  assert.equal(kh.ensure('mosh.test', 2200, k1), true);
  assert.equal(kh.ensure('mosh.test', 2200, k1), false, 'already there: nothing appended');
  const lines = () => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('[mosh.test]:2200 '));
  assert.equal(lines().length, 1);
  assert.match(lines()[0], /^\[mosh\.test\]:2200 ssh-ed25519 [A-Za-z0-9+/=]+$/, 'OpenSSH known_hosts line');
  assert.equal(kh.ensure('mosh.test', 2200, k2), true, 'a changed key replaces the old entry');
  assert.equal(lines().length, 1);
  assert.equal(kh.check('mosh.test', 2200, k2, [file]), 'ok');
  assert.equal(kh.check('mosh.test', 2200, k1, [file]), 'mismatch');
});

// From the 1.0 security review (khpoc.js): @revoked lines, keys of another type, case and wildcard patterns.
function khFile(text) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-khf-')), 'known_hosts');
  fs.writeFileSync(f, text);
  return [f];
}

test('an @revoked key is refused, even when a plain line also holds it', () => {
  const k = fakeKey();
  const b = k.toString('base64');
  assert.equal(kh.check('host.example.com', 22, k, khFile(`@revoked host.example.com ssh-ed25519 ${b}\n`)), 'revoked');
  assert.equal(kh.check('host.example.com', 22, k, khFile(`host.example.com ssh-ed25519 ${b}\n@revoked * ssh-ed25519 ${b}\n`)), 'revoked');
  // another key revoked: this one is still judged on its own
  const other = fakeKey();
  assert.equal(kh.check('host.example.com', 22, k, khFile(`@revoked * ssh-ed25519 ${other.toString('base64')}\nhost.example.com ssh-ed25519 ${b}\n`)), 'ok');
});

test('a known host offering a key of another type is a changed key, not an unknown host', () => {
  const ed = fakeKey('ssh-ed25519');
  const rsa = fakeKey('ssh-rsa');
  const list = khFile(`host.example.com ssh-ed25519 ${ed.toString('base64')}\n`);
  assert.equal(kh.check('host.example.com', 22, rsa, list), 'mismatch');
  assert.deepEqual(kh.knownTypes('host.example.com', 22, list), ['ssh-ed25519']);
  // known with both types: either key passes
  const both = khFile(`host.example.com ssh-ed25519 ${ed.toString('base64')}\nhost.example.com ssh-rsa ${rsa.toString('base64')}\n`);
  assert.equal(kh.check('host.example.com', 22, rsa, both), 'ok');
  assert.equal(kh.check('host.example.com', 22, ed, both), 'ok');
});

test('host names match without regard to case, plain and hashed', () => {
  const k = fakeKey();
  const b = k.toString('base64');
  assert.equal(kh.check('host.example.com', 22, k, khFile(`Host.Example.com ssh-ed25519 ${b}\n`)), 'ok');
  assert.equal(kh.check('HOST.example.com', 2222, k, khFile(`[host.example.COM]:2222 ssh-ed25519 ${b}\n`)), 'ok');
  const salt = crypto.randomBytes(20);
  const hash = crypto.createHmac('sha1', salt).update('host.example.com').digest();
  assert.equal(kh.check('Host.Example.com', 22, k, khFile(`|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-ed25519 ${b}\n`)), 'ok');
});

test('wildcard and negated patterns follow OpenSSH', () => {
  const k = fakeKey();
  const b = k.toString('base64');
  assert.equal(kh.check('host.example.com', 22, k, khFile(`*.example.com ssh-ed25519 ${b}\n`)), 'ok');
  assert.equal(kh.check('host.example.com', 22, fakeKey(), khFile(`*.example.com ssh-ed25519 ${b}\n`)), 'mismatch');
  assert.equal(kh.check('host1.example.com', 22, k, khFile(`host?.example.com ssh-ed25519 ${b}\n`)), 'ok');
  assert.equal(kh.check('bad.example.com', 22, k, khFile(`*.example.com,!bad.example.com ssh-ed25519 ${b}\n`)), 'unknown');
  assert.equal(kh.check('host.example.com', 2222, k, khFile(`[*.example.com]:2222 ssh-ed25519 ${b}\n`)), 'ok');
  assert.equal(kh.check('host.example.com', 2222, k, khFile(`*.example.com ssh-ed25519 ${b}\n`)), 'unknown', 'a pattern without a port names port 22 only');
  assert.equal(kh.check('hostXexample.com', 22, k, khFile(`host.example.com ssh-ed25519 ${b}\n`)), 'unknown', 'a dot is not a wildcard');
});

test('@cert-authority lines neither accept a key nor make the host known', () => {
  const k = fakeKey();
  assert.equal(kh.check('host.example.com', 22, k, khFile(`@cert-authority *.example.com ssh-ed25519 ${k.toString('base64')}\n`)), 'unknown');
});

test('forget() removes an entry whatever its case', () => {
  const file = path.join(process.env.MOBALT_USER_DATA, 'known_hosts');
  const k = fakeKey();
  fs.appendFileSync(file, `Mixed.Example.com ssh-ed25519 ${k.toString('base64')}\n`);
  assert.equal(kh.check('mixed.example.com', 22, k, [file]), 'ok');
  kh.forget('mixed.example.com', 22);
  assert.equal(kh.check('mixed.example.com', 22, k, [file]), 'unknown');
});
