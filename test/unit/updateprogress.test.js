'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// src/renderer/updateprogress.js is an ES module in a CommonJS package (see theme.test.js for the notice it would print).
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const load = () => import('../../src/renderer/updateprogress.js');

// the renderer's t() without a dictionary: the source with its placeholders filled (an unknown one stays, as i18n.js does)
const t = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
const MB = 1024 * 1024;

test('mb(): one decimal, from bytes; nothing / garbage / negatives read 0.0', async () => {
  const { mb } = await load();
  assert.equal(mb(12.3 * MB), '12.3');
  assert.equal(mb(29.4 * MB), '29.4');
  assert.equal(mb(116962501), '111.5');
  assert.equal(mb(0), '0.0');
  assert.equal(mb(undefined), '0.0');
  assert.equal(mb('abc'), '0.0');
  assert.equal(mb(-5), '0.0');
  assert.equal(mb(Infinity), '0.0');
});

test('percent(): rounded and clamped to 0…100', async () => {
  const { percent } = await load();
  assert.equal(percent(41.8), 42);
  assert.equal(percent(41.4), 41);
  assert.equal(percent(0), 0);
  assert.equal(percent(100), 100);
  assert.equal(percent(104.2), 100);
  assert.equal(percent(-3), 0);
  assert.equal(percent(NaN), 0);
  assert.equal(percent(undefined), 0);
});

test('progressParts(): the four figures of an event, formatted as the sentence takes them', async () => {
  const { progressParts } = await load();
  assert.deepEqual(progressParts({ percent: 41.8, transferred: 12.3 * MB, total: 29.4 * MB, bytesPerSecond: 2.1 * MB }), { percent: 42, transferred: '12.3', total: '29.4', speed: '2.1' });
  assert.deepEqual(progressParts({}), { percent: 0, transferred: '0.0', total: '0.0', speed: '0.0' });
  assert.deepEqual(progressParts(null), { percent: 0, transferred: '0.0', total: '0.0', speed: '0.0' });
});

test('progressLine(): the line of each phase, the start before any byte, and nothing for no event', async () => {
  const { progressLine } = await load();
  const fig = { version: '0.17.0', percent: 41.8, transferred: 12.3 * MB, total: 29.4 * MB, bytesPerSecond: 2.1 * MB };
  assert.equal(progressLine({ phase: 'downloading', ...fig }, t), 'Downloading MobAlt 0.17.0 — 42 % (12.3 of 29.4 MB, 2.1 MB/s)');
  assert.equal(progressLine({ phase: 'downloading', version: '0.17.0', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, t), 'Downloading MobAlt 0.17.0…', 'the 0 % the updater sends at the start carries no size');
  assert.equal(progressLine({ phase: 'done', ...fig, percent: 100 }, t), 'MobAlt 0.17.0 downloaded — it is installed when you quit, or restart now');
  assert.equal(progressLine({ phase: 'error', version: '0.17.0', message: 'net::ERR_INTERNET_DISCONNECTED' }, t), 'Download of MobAlt 0.17.0 failed: net::ERR_INTERNET_DISCONNECTED');
  assert.equal(progressLine({ phase: 'error', version: '0.17.0' }, t), 'Download of MobAlt 0.17.0 failed: ', 'an error without a message still names the version');
  assert.equal(progressLine(null, t), '');
  assert.equal(progressLine({ phase: 'later', version: '0.17.0' }, t), '');
  assert.equal(progressLine({ phase: 'downloading', percent: 100, transferred: 10 * MB, total: 10 * MB, bytesPerSecond: 5 * MB }, t), 'Downloading MobAlt  — 100 % (10.0 of 10.0 MB, 5.0 MB/s)', 'a missing version is an empty placeholder, never "undefined"');
});
