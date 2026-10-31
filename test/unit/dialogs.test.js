'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// dialogs.js resolves Electron's dialog lazily; outside Electron it is stubbed in the require cache so that the
// pass-through (empty queue / not in test mode) can be observed.
const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const shown = [];
stub('electron', {
  dialog: {
    showOpenDialog: async (_w, o) => { shown.push(['open', o]); return { canceled: true, filePaths: [] }; },
    showSaveDialog: async (_w, o) => { shown.push(['save', o]); return { canceled: true, filePath: '' }; },
    showMessageBox: async (_w, o) => { shown.push(['message', o]); return { response: 1, checkboxChecked: false }; },
  },
});
const dialogs = require('../../src/main/dialogs');
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };

test('outside test mode nothing is queued and every call reaches the native dialog', async () => {
  delete process.env.MOBALT_TEST_SCRIPT;
  shown.length = 0;
  assert.equal(dialogs.enqueue({ canceled: false, filePaths: ['/x'] }), null);
  assert.equal(dialogs.pending(), 0);
  assert.deepEqual(await dialogs.showOpenDialog(null, { title: 'a' }), { canceled: true, filePaths: [] });
  assert.deepEqual(await dialogs.showSaveDialog(null, { title: 'b' }), { canceled: true, filePath: '' });
  assert.deepEqual(await dialogs.showMessageBox(null, { message: 'c' }), { response: 1, checkboxChecked: false });
  assert.deepEqual(shown.map((s) => s[0]), ['open', 'save', 'message']);
});

test('test mode: queued answers are consumed in order, normalised to Electron shapes, then the real dialog returns', async () => {
  process.env.MOBALT_TEST_SCRIPT = '/dev/null';
  shown.length = 0;
  try {
    assert.equal(dialogs.enqueue({ canceled: false, filePaths: ['/one', '/two'] }), 1);
    assert.equal(dialogs.enqueue({ canceled: false, filePath: '/save.json' }), 2);
    assert.equal(dialogs.enqueue({ canceled: true }), 3);
    assert.equal(dialogs.enqueue({ response: 0 }), 4);
    assert.equal(dialogs.enqueue({ canceled: true }), 5);
    assert.equal(dialogs.enqueue(null), 6); // a non-object answer counts as a cancel
    assert.equal(dialogs.pending(), 6);
    await quiet(async () => {
      assert.deepEqual(await dialogs.showOpenDialog(null, { title: 'open' }), { canceled: false, filePaths: ['/one', '/two'] });
      assert.deepEqual(await dialogs.showSaveDialog(null, { title: 'save' }), { canceled: false, filePath: '/save.json' });
      assert.deepEqual(await dialogs.showOpenDialog(null, { title: 'open-cancel' }), { canceled: true, filePaths: [] });
      assert.deepEqual(await dialogs.showMessageBox(null, { buttons: ['Download', 'Later'], cancelId: 1 }), { response: 0, checkboxChecked: false });
      // a cancelled sheet picks cancelId (Esc), falling back to a Cancel/No/Later button, else 0
      assert.deepEqual(await dialogs.showMessageBox(null, { buttons: ['Restart now', 'Later'], cancelId: 1 }), { response: 1, checkboxChecked: false });
      assert.deepEqual(await dialogs.showMessageBox(null, { buttons: ['OK', 'No'] }), { response: 1, checkboxChecked: false });
    });
    assert.equal(dialogs.pending(), 0);
    assert.equal(shown.length, 0, 'no native dialog while answers were queued');
    // the queue is empty: back to the real dialog
    assert.deepEqual(await dialogs.showSaveDialog(null, { title: 'real' }), { canceled: true, filePath: '' });
    assert.equal(shown.length, 1);
    // a save answer without a path is a cancel, an open answer may name its file with filePath
    dialogs.enqueue({ canceled: false });
    dialogs.enqueue({ canceled: false, filePath: '/key' });
    await quiet(async () => {
      assert.deepEqual(await dialogs.showSaveDialog(null, {}), { canceled: true, filePath: '' });
      assert.deepEqual(await dialogs.showOpenDialog(null, {}), { canceled: false, filePaths: ['/key'] });
    });
  } finally {
    delete process.env.MOBALT_TEST_SCRIPT;
  }
});
