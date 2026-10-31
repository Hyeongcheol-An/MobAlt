'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-ws-'));
const { Store } = require('../../src/main/store');

test('workspace: round-trips tabs + layout, ignores bad shapes', () => {
  const store = new Store();
  assert.equal(store.getWorkspace(), null);

  const ws = {
    v: 1,
    activeTab: 0,
    tabs: [{
      title: '작업대',
      autoTitle: false,
      color: '#4ea1ff',
      active: 1,
      root: {
        t: 'split', dir: 'h', ratio: 0.5,
        children: [
          { t: 'pane', kind: 'ssh', sessionId: 'abc' },
          { t: 'pane', kind: 'local', cwd: '/tmp' },
        ],
      },
    }],
  };
  store.saveWorkspace(ws);
  assert.deepEqual(store.getWorkspace(), ws);

  // invalid payloads must not clobber the stored workspace
  store.saveWorkspace(null);
  store.saveWorkspace({});
  store.saveWorkspace({ tabs: 'nope' });
  assert.deepEqual(store.getWorkspace(), ws);
});

test('settings: every toggle the Settings dialog shows has a default, so app.settings matches the dialog before the first Save', () => {
  const { DEFAULT_SETTINGS } = require('../../src/main/store');
  for (const k of ['rightClickPaste', 'copyOnSelect', 'macOptionIsMeta', 'cursorBlink', 'localShellIntegration', 'confirmClose', 'sftpAutoOpen', 'restoreWorkspace', 'autoUpdate', 'logPlainText']) {
    assert.equal(typeof DEFAULT_SETTINGS[k], 'boolean', k);
  }
  assert.equal(DEFAULT_SETTINGS.macOptionIsMeta, true); // the dialog shows "Option key acts as Meta/Alt" checked unless it was saved off
});
