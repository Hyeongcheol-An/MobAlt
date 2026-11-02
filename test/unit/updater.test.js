'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

// updater.js takes `electron` and `electron-updater` at load time; outside Electron, require('electron') is the
// binary's path, so both are stubbed in the require cache before the module is loaded. The sheets it would show
// are collected in `dialogs` (every one is answered with its cancel button).
const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const dialogs = [];
const electron = {
  app: { isPackaged: true, getVersion: () => '0.10.1' },
  dialog: { showMessageBox: async (_win, opts) => { dialogs.push(opts); return { response: 1 }; } },
};
stub('electron', electron);
const autoUpdater = new EventEmitter();
autoUpdater.checkForUpdates = async () => {}; // the outcome arrives as an event, like the real one
stub('electron-updater', { autoUpdater });
const { setupUpdater } = require('../../src/main/updater');

const store = { getSettings: () => ({ autoUpdate: false }) }; // no startup check (its timer would keep the test alive)
const settle = () => new Promise((r) => setImmediate(r));
const fresh = (hooks = {}) => {
  dialogs.length = 0;
  autoUpdater.removeAllListeners();
  return setupUpdater(store, () => null, hooks);
};

test('up to date / failed: a quiet manual check (Settings "Check now") reports through its result only; a loud one (Help menu) also shows the sheet', async () => {
  const u = fresh();
  let p = u.check(true, { quiet: true });
  autoUpdater.emit('update-not-available');
  assert.deepEqual(await p, { status: 'up-to-date', version: '0.10.1', message: 'MobAlt 0.10.1 is up to date' });
  assert.equal(dialogs.length, 0, 'the Settings line is the report');
  p = u.check(true);
  autoUpdater.emit('update-not-available');
  await p;
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].message, 'MobAlt is up to date');
  p = u.check(true, { quiet: true });
  autoUpdater.emit('error', new Error('offline'));
  assert.deepEqual(await p, { status: 'error', message: 'Update check failed: offline' });
  assert.equal(dialogs.length, 1, 'no error sheet for a quiet check');
  p = u.check(true);
  autoUpdater.emit('error', new Error('offline'));
  await p;
  assert.equal(dialogs.length, 2);
  assert.equal(dialogs[1].message, 'Update check failed');
  p = u.check(false);
  autoUpdater.emit('error', new Error('offline'));
  await p;
  assert.equal(dialogs.length, 2, 'the startup check is silent');
});

test('a new release is offered in a sheet for quiet and loud checks alike (nothing downloads without consent)', async () => {
  const u = fresh();
  const p = u.check(true, { quiet: true });
  autoUpdater.emit('update-available', { version: '0.11.0' });
  assert.deepEqual(await p, { status: 'available', version: '0.11.0', message: 'MobAlt 0.11.0 is available' });
  await settle();
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].message, 'MobAlt 0.11.0 is available');
  assert.deepEqual(dialogs[0].buttons, ['Download', 'Later']);
});

test('a release already on disk: the quiet check tells the banner and its caller; the loud one also asks to relaunch', async () => {
  const onDisk = [];
  const u = fresh({ diskVersion: async () => '0.11.0', bundleOnDisk: (v) => onDisk.push(v) });
  let p = u.check(true, { quiet: true });
  autoUpdater.emit('update-available', { version: '0.11.0' });
  assert.deepEqual(await p, { status: 'on-disk', version: '0.11.0', message: '0.11.0 is already installed on disk; relaunch to use it' });
  await settle();
  assert.deepEqual(onDisk, ['0.11.0']);
  assert.equal(dialogs.length, 0, 'the banner and the Settings line say to relaunch; no sheet');
  p = u.check(true);
  autoUpdater.emit('update-available', { version: '0.11.0' });
  await p;
  await settle();
  assert.equal(dialogs.length, 1);
  assert.deepEqual(dialogs[0].buttons, ['Relaunch', 'Later']);
});

test('a check under way is shared: the second caller gets the same promise, and the first caller decides the loudness', async () => {
  const u = fresh();
  const loud = u.check(true);
  const quiet = u.check(true, { quiet: true });
  assert.equal(quiet, loud);
  autoUpdater.emit('update-not-available');
  await loud;
  assert.equal(dialogs.length, 1);
  const q2 = u.check(true, { quiet: true });
  assert.notEqual(q2, loud, 'a finished check does not stick');
  autoUpdater.emit('update-not-available');
  await q2;
  assert.equal(dialogs.length, 1);
});

test('running from source: the manual check answers on the Settings line; only a loud one shows the sheet', async () => {
  electron.app.isPackaged = false;
  try {
    const u = fresh();
    assert.deepEqual(await u.check(true, { quiet: true }), { status: 'source', version: '0.10.1', message: 'Updates are only checked in packaged builds' });
    assert.equal(dialogs.length, 0);
    await u.check(true);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].message, 'Updates are only checked in packaged builds');
    await u.check(false);
    assert.equal(dialogs.length, 1);
  } finally {
    electron.app.isPackaged = true;
  }
});

test('electron-updater is wired on the first check, not at setup (its require is off the start-up path), and once only', async () => {
  const u = fresh();
  assert.equal(autoUpdater.listenerCount('update-available'), 0, 'nothing registered before a check');
  let p = u.check(true, { quiet: true });
  assert.equal(autoUpdater.listenerCount('update-available'), 1, 'wired by the first check');
  autoUpdater.emit('update-not-available');
  await p;
  p = u.check(true, { quiet: true });
  assert.equal(autoUpdater.listenerCount('update-available'), 1, 'not wired twice');
  autoUpdater.emit('update-not-available');
  await p;
});

// ---------- the download's progress (hooks.progress → app:update-progress) and install() ----------
const settled = async () => { for (let i = 0; i < 4; i++) await settle(); };
// the "Download?" sheet answered with its first button, every other sheet with its last (Later / Cancel)
const answerDownload = () => { electron.dialog.showMessageBox = async (_w, opts) => { dialogs.push(opts); return { response: opts.buttons && opts.buttons[0] === 'Download' ? 0 : 1 }; }; };
const answerLater = () => { electron.dialog.showMessageBox = async (_w, opts) => { dialogs.push(opts); return { response: 1 }; }; };

test('Download: the progress hook hears the start (0 %, no size), every download-progress event, the end with the size, and nothing outside a download', async () => {
  const progress = [];
  const u = fresh({ progress: (p) => progress.push(p) });
  autoUpdater.downloadUpdate = async () => {};
  answerDownload();
  try {
    const p = u.check(true, { quiet: true });
    autoUpdater.emit('update-available', { version: '0.17.0' });
    await p;
    await settled();
    assert.deepEqual(dialogs.map((d) => d.message), ['MobAlt 0.17.0 is available']);
    assert.deepEqual(progress, [{ phase: 'downloading', version: '0.17.0', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }], 'the line appears before the first byte');
    autoUpdater.emit('download-progress', { percent: 41.8, transferred: 12900000, total: 30800000, bytesPerSecond: 2200000, delta: 12900000 });
    assert.deepEqual(progress[1], { phase: 'downloading', version: '0.17.0', percent: 41.8, transferred: 12900000, total: 30800000, bytesPerSecond: 2200000 }, 'the figures as electron-updater sends them, with the version (delta dropped)');
    autoUpdater.emit('update-downloaded', { version: '0.17.0' });
    await settled();
    assert.deepEqual(progress[2], { phase: 'done', version: '0.17.0', percent: 100, transferred: 30800000, total: 30800000, bytesPerSecond: 2200000 }, 'done repeats the size');
    assert.equal(dialogs[dialogs.length - 1].message, 'MobAlt 0.17.0 is ready to install', 'the sheet still comes (answered Later here)');
    autoUpdater.emit('download-progress', { percent: 50, transferred: 1, total: 2, bytesPerSecond: 1 });
    assert.equal(progress.length, 3, 'nothing is downloading any more');
    // a second check that finds the same release: no second "Download?" offer, the Settings line gets its answer
    const again = u.check(true, { quiet: true });
    autoUpdater.emit('update-available', { version: '0.17.0' });
    assert.deepEqual(await again, { status: 'available', version: '0.17.0', message: 'MobAlt 0.17.0 is available' });
    await settled();
    assert.equal(dialogs.filter((d) => d.message === 'MobAlt 0.17.0 is available').length, 1);
  } finally {
    answerLater();
  }
});

test('a download that breaks off: one error report with the message (the error event and the rejection are the same failure), then the "Download failed" sheet', async () => {
  const progress = [];
  const u = fresh({ progress: (p) => progress.push(p) });
  let reject;
  autoUpdater.downloadUpdate = () => new Promise((_r, rj) => { reject = rj; });
  answerDownload();
  try {
    const p = u.check(true, { quiet: true });
    autoUpdater.emit('update-available', { version: '0.17.0' });
    await p;
    await settled();
    assert.equal(progress.length, 1);
    const e = new Error('net::ERR_INTERNET_DISCONNECTED');
    autoUpdater.emit('error', e); // electron-updater dispatches the event…
    reject(e); // …and rejects the download promise
    await settled();
    assert.deepEqual(progress[1], { phase: 'error', version: '0.17.0', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: 'net::ERR_INTERNET_DISCONNECTED' });
    assert.equal(progress.length, 2, 'reported once');
    assert.equal(dialogs[dialogs.length - 1].message, 'Download failed');
    assert.equal(dialogs.filter((d) => d.message === 'Update check failed').length, 0, 'a quiet check never shows the check-failed sheet');
    // a cancellation rejects without an event: still reported once
    const p2 = u.check(true, { quiet: true });
    autoUpdater.emit('update-available', { version: '0.17.0' });
    await p2;
    await settled();
    assert.equal(progress.length, 3);
    reject(new Error('cancelled'));
    await settled();
    assert.equal(progress[3].phase, 'error');
    assert.equal(progress[3].message, 'cancelled');
  } finally {
    answerLater();
  }
});

test('install(): nothing before a download completed; afterwards the beforeInstall hook, then quitAndInstall', async () => {
  const calls = [];
  const u = fresh({ beforeInstall: () => calls.push('beforeInstall') });
  autoUpdater.downloadUpdate = async () => {};
  autoUpdater.quitAndInstall = () => calls.push('quitAndInstall');
  assert.equal(u.install(), false, 'nothing downloaded yet');
  answerDownload();
  try {
    const p = u.check(true, { quiet: true });
    autoUpdater.emit('update-available', { version: '0.17.0' });
    await p;
    await settled();
    assert.equal(u.install(), false, 'still downloading');
    autoUpdater.emit('update-downloaded', { version: '0.17.0' });
    await settled();
    assert.deepEqual(calls, [], 'the sheet was answered Later: nothing installed by itself');
    assert.equal(u.install(), true);
    await settled();
    assert.deepEqual(calls, ['beforeInstall', 'quitAndInstall']);
  } finally {
    answerLater();
  }
});

test('running from source: install() is a no-op', async () => {
  electron.app.isPackaged = false;
  try {
    assert.equal(fresh().install(), false);
  } finally {
    electron.app.isPackaged = true;
  }
});
