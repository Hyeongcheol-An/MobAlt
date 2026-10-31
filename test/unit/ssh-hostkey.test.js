'use strict';
// SshManager's host-key prompt handling without a connection: several first connections to one unknown host share
// one prompt, a declined key declines the ones waiting, the handshake timer pauses while a prompt is open, and
// ssh2's raw "Unknown DH group" gets its hint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-sshkh-'));
const knownhosts = require('../../src/main/knownhosts');
const { SshManager } = require('../../src/main/ssh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
function fakeKey(type = 'ssh-ed25519') {
  const t = Buffer.from(type);
  const body = crypto.randomBytes(32);
  return Buffer.concat([Buffer.from([0, 0, 0, t.length]), t, Buffer.from([0, 0, 0, body.length]), body]);
}
const store = { getSettings: () => ({ readyTimeout: 20000 }) };
const timerCtx = () => { const ctx = { paused: 0, resumed: 0 }; ctx.readyTimer = { pause: () => ctx.paused++, resume: () => ctx.resumed++, stop() {} }; return ctx; };

test('four first connections to one unknown host raise one prompt; accepting it passes them all and remembers the key', async () => {
  const prompts = [];
  let answer = null;
  const ssh = new SshManager(null, store, { hostKey: (info) => new Promise((r) => { prompts.push(info); answer = r; }), status() {} });
  const key = fakeKey();
  const cfg = { host: 'grid.test', port: 2222, name: 'grid-1' };
  const results = [], ctxs = [];
  for (let i = 0; i < 4; i++) {
    const ctx = timerCtx();
    ctxs.push(ctx);
    ssh._hostVerifier({ ...cfg, name: `grid-${i + 1}` }, ctx)(key, (ok) => results.push(ok));
  }
  await settle();
  assert.equal(prompts.length, 1, 'one dialog');
  assert.equal(prompts[0].name, 'grid-1');
  assert.deepEqual([prompts[0].host, prompts[0].port, prompts[0].status], ['grid.test', 2222, 'unknown']);
  assert.equal(ssh.hostKeyPrompts.size, 1);
  assert.deepEqual(results, [], 'everyone waits');
  assert.deepEqual(ctxs.map((c) => c.paused), [1, 1, 1, 1], 'every handshake timer is paused while the dialog is open');
  answer(true);
  await settle();
  assert.deepEqual(results, [true, true, true, true]);
  assert.deepEqual(ctxs.map((c) => c.resumed), [1, 1, 1, 1]);
  assert.equal(knownhosts.check('grid.test', 2222, key), 'ok', 'remembered once');
  assert.equal(ssh.hostKeyPrompts.size, 0);
  // the next connection finds the key known: no prompt, no pause
  const ctx = timerCtx();
  let later = null;
  ssh._hostVerifier(cfg, ctx)(key, (ok) => (later = ok));
  assert.equal(later, true);
  assert.equal(prompts.length, 1);
  assert.equal(ctx.paused, 0);
});

test('a declined key declines the connections waiting behind the prompt; a different key gets a prompt of its own', async () => {
  const prompts = [];
  const answers = [];
  const ssh = new SshManager(null, store, { hostKey: (info) => new Promise((r) => { prompts.push(info); answers.push(r); }), status() {} });
  const keyA = fakeKey(), keyB = fakeKey();
  const cfg = { host: 'declined.test', port: 22, name: 'x' };
  const results = {};
  ssh._hostVerifier(cfg, {})(keyA, (ok) => (results.first = ok));
  ssh._hostVerifier(cfg, {})(keyA, (ok) => (results.sameKey = ok));
  ssh._hostVerifier(cfg, {})(keyB, (ok) => (results.otherKey = ok));
  await settle();
  assert.equal(prompts.length, 1);
  answers[0](false);
  await settle();
  assert.equal(results.first, false);
  assert.equal(results.sameKey, false, 'the same key, declined once, is declined for the follower too');
  assert.equal(results.otherKey, undefined, 'another key asks for itself');
  assert.equal(prompts.length, 2);
  assert.equal(knownhosts.check('declined.test', 22, keyA), 'unknown', 'nothing remembered');
  answers[1](true);
  await settle();
  assert.equal(results.otherKey, true);
  assert.equal(knownhosts.check('declined.test', 22, keyB), 'ok');
  assert.equal(ssh.hostKeyPrompts.size, 0);
});

test('a prompt that throws counts as declined and frees the slot', async () => {
  const ssh = new SshManager(null, store, { hostKey: () => Promise.reject(new Error('renderer gone')), status() {} });
  let ok = null;
  ssh._hostVerifier({ host: 'throws.test', port: 22 }, {})(fakeKey(), (v) => (ok = v));
  await settle();
  assert.equal(ok, false);
  assert.equal(ssh.hostKeyPrompts.size, 0);
});

test('_readyTimer fails the handshake with ssh2\'s own message after the limit, pauses for a prompt, stops on ready', async () => {
  const ssh = new SshManager(null, store, { status() {} });
  // runs out
  let err = null;
  const c1 = new EventEmitter();
  ssh._readyTimer(c1, 60, (e) => (err = e));
  await sleep(120);
  assert.ok(err, 'fired');
  assert.equal(err.message, 'Timed out while waiting for handshake');
  assert.equal(err.level, 'client-timeout');
  // paused: time spent in the dialog does not count; resumed: the rest of the limit (at least the limit itself when short)
  err = null;
  const c2 = new EventEmitter();
  const t2 = ssh._readyTimer(c2, 80, (e) => (err = e));
  await sleep(20);
  t2.pause();
  await sleep(200);
  assert.equal(err, null, 'nothing fires while paused');
  t2.resume();
  await sleep(30);
  assert.equal(err, null, 'the remainder is granted');
  await sleep(120);
  assert.ok(err, 'fires after the remainder');
  // ready / close stop it for good
  err = null;
  const c3 = new EventEmitter();
  ssh._readyTimer(c3, 40, (e) => (err = e));
  c3.emit('ready');
  await sleep(80);
  assert.equal(err, null);
  const c4 = new EventEmitter();
  const t4 = ssh._readyTimer(c4, 40, (e) => (err = e));
  t4.pause();
  c4.emit('close');
  t4.resume();
  await sleep(80);
  assert.equal(err, null, 'a resume after the end is a no-op');
});

test('_explainError: "Unknown DH group" says which group this build lacks and where the knob is', () => {
  const ssh = new SshManager(null, store, { status() {} });
  const msg = ssh._explainError(new Error('Unknown DH group'), {}, { host: 'h', port: 22 });
  assert.match(msg, /^Unknown DH group — this build cannot do diffie-hellman-group1-sha1 \(1024-bit Diffie-Hellman was removed from its crypto\); Advanced SSH → Algorithms: take it out of the key exchange list or Reset to defaults$/);
  assert.equal(ssh._explainError(new Error('something else'), {}, { host: 'h' }), 'something else');
});
