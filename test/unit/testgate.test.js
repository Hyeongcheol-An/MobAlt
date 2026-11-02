'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testHooksAllowed, applyTestGate, TEST_VARS } = require('../../src/main/testgate');
const pkg = require('../../package.json');

test('test hooks: allowed from source and in pack:qa builds only', () => {
  assert.equal(testHooksAllowed({ isPackaged: false }), true);
  assert.equal(testHooksAllowed({ isPackaged: true }), false);
  assert.equal(testHooksAllowed({ isPackaged: true, testHooks: false }), false);
  assert.equal(testHooksAllowed({ isPackaged: true, testHooks: 'true' }), false); // only the boolean the build writes
  assert.equal(testHooksAllowed({ isPackaged: true, testHooks: true }), true);
});

test('test hooks: a packaged release build strips every test variable', () => {
  const env = { MOBALT_USER_DATA: '/tmp/x', MOBALT_LANG: 'ko', PATH: '/usr/bin' };
  for (const v of TEST_VARS) env[v] = '1';
  assert.equal(applyTestGate({ isPackaged: true }, { name: 'mobalt' }, env), false);
  for (const v of TEST_VARS) assert.equal(v in env, false, v);
  assert.equal(env.MOBALT_USER_DATA, '/tmp/x');
  assert.equal(env.MOBALT_LANG, 'ko');
  assert.equal(env.PATH, '/usr/bin');
});

test('test hooks: a pack:qa build and a source run keep them', () => {
  const env = { MOBALT_TEST_SCRIPT: '/tmp/s.js' };
  assert.equal(applyTestGate({ isPackaged: true }, { testHooks: true }, env), true);
  assert.equal(env.MOBALT_TEST_SCRIPT, '/tmp/s.js');
  assert.equal(applyTestGate({ isPackaged: false }, {}, env), true);
  assert.equal(env.MOBALT_TEST_SCRIPT, '/tmp/s.js');
});

test('package.json: release builds never carry testHooks; pack:qa sets it in a separate output folder', () => {
  assert.equal(pkg.testHooks, undefined);
  assert.equal((pkg.build.extraMetadata || {}).testHooks, undefined);
  assert.match(pkg.scripts['pack:qa'], /extraMetadata\.testHooks=true/);
  assert.doesNotMatch(pkg.scripts.dist, /testHooks/);
  assert.doesNotMatch(pkg.scripts.pack, /testHooks/);
  const fuses = pkg.build.electronFuses;
  assert.equal(fuses.runAsNode, false);
  assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(fuses.onlyLoadAppFromAsar, true);
});
