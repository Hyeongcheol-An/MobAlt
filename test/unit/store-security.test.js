'use strict';
// The 1.0 security review, N3/N4: the user-data files are 0600, a secret saved without safeStorage still works and
// warns once. Outside Electron safeStorage is missing, which is exactly the fallback path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-storesec-'));
const store = require('../../src/main/store');
const kh = require('../../src/main/knownhosts');
const { TerminalRegistry } = require('../../src/main/terminals');
const mode = (f) => fs.statSync(f).mode & 0o777;

test('without safeStorage a secret is stored base64-encoded, still decrypts, and the warning comes once', async () => {
  let warned = 0;
  store.setPlaintextWarning(() => warned++);
  const a = await store.encrypt('s3cret');
  const b = await store.encrypt('other');
  assert.match(a, /^b64:/);
  assert.equal(await store.decrypt(a), 's3cret');
  assert.match(b, /^b64:/);
  assert.equal(warned, 1);
  assert.equal(await store.encrypt(''), '');
});

test('sessions.json, settings.json and known_hosts are written 0600 (an older 0644 file is tightened)', async () => {
  const s = new store.Store();
  const sessions = path.join(process.env.MOBALT_USER_DATA, 'sessions.json');
  fs.writeFileSync(sessions, '{"sessions":[],"folders":[]}', { mode: 0o644 });
  fs.chmodSync(sessions, 0o644);
  await s.upsertSession({ name: 'x', type: 'ssh', host: '192.0.2.10', password: 'pw' });
  assert.equal(mode(sessions), 0o600);
  s.setSettings({ fontSize: 13 });
  assert.equal(mode(path.join(process.env.MOBALT_USER_DATA, 'settings.json')), 0o600);
  const khFile = kh.file();
  fs.writeFileSync(khFile, '', { mode: 0o644 });
  fs.chmodSync(khFile, 0o644);
  kh.remember('host.example.com', 22, Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.alloc(36)]));
  assert.equal(mode(khFile), 0o600);
});

test('a session log is created 0600', async () => {
  const reg = new TerminalRegistry();
  const file = path.join(process.env.MOBALT_USER_DATA, 'MobAlt Logs', 'x.log');
  reg.startLog('t1', file);
  reg.stopLog('t1');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(mode(file), 0o600);
});
