'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startFailure, forPane } = require('../../src/main/paneerror');

// main.js term:spawn-mosh / ftp:connect: a failed start is a reply, never a rejection (Electron prints every rejected
// handler to stderr) and never one string with a control character joining the two texts.

test('forPane: a thrown error with a terminal-language text → { ok: false, error, terminalError }', async () => {
  const h = forPane(async () => { throw Object.assign(new Error('تعذّر الاتصال (ECONNREFUSED)'), { terminalMessage: 'connect ECONNREFUSED 127.0.0.1:1' }); });
  const r = await h({}, {});
  assert.deepEqual(r, { ok: false, error: 'تعذّر الاتصال (ECONNREFUSED)', terminalError: 'connect ECONNREFUSED 127.0.0.1:1' });
  assert.ok(!/[\u0000-\u001f]/.test(r.error + r.terminalError));
});

test('forPane: an error without a terminal text → terminalError is the same text', async () => {
  const r = await forPane(() => { throw new Error('host key not accepted'); })();
  assert.deepEqual(r, { ok: false, error: 'host key not accepted', terminalError: 'host key not accepted' });
});

test('forPane: a success goes through untouched (the handler\'s own shape, no ok field added)', async () => {
  const ok = { id: 't7', home: '/srv' };
  assert.equal(await forPane(async (_e, cfg) => ({ ...ok, cfg }))(null, 1).then((r) => r.home), '/srv');
  assert.equal(await forPane(() => ok)(), ok);
});

test('forPane: arguments reach the handler; a non-Error throw still makes a reply', async () => {
  let seen;
  await forPane((...a) => { seen = a; })('e', { host: 'h' });
  assert.deepEqual(seen, ['e', { host: 'h' }]);
  assert.deepEqual(await forPane(() => { throw 'plain'; })(), { ok: false, error: 'plain', terminalError: 'plain' }); // eslint-disable-line no-throw-literal
  assert.deepEqual(startFailure(null), { ok: false, error: '', terminalError: '' });
});
