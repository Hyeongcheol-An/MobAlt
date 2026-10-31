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
