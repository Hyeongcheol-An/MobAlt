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

test('validChrome: the remembered chrome keeps its background, scheme, theme name and well-formed CSS tokens only', () => {
  const { validChrome } = require('../../src/main/store');
  assert.equal(validChrome(null), null);
  assert.equal(validChrome({ background: 'red', scheme: 'dark' }), null);
  assert.equal(validChrome({ background: '#1e1f22', scheme: 'blue' }), null);
  assert.deepEqual(validChrome({ background: '#F5F6F8', scheme: 'light' }), { background: '#f5f6f8', scheme: 'light' }, 'the pre-0.12 shape still loads');
  const full = validChrome({
    background: '#f5f6f8', scheme: 'light', theme: 'light',
    vars: { '--bg': '#F5F6F8', '--shadow-a': '.18', '--backdrop-a': '0.3', '--term-bg': '#ffffff', 'bg': '#000000', '--x': 'url(evil)', '--bad': 'red', '--y': 1 },
  });
  assert.deepEqual(full, { background: '#f5f6f8', scheme: 'light', theme: 'light', vars: { '--bg': '#f5f6f8', '--shadow-a': '.18', '--backdrop-a': '0.3', '--term-bg': '#ffffff', '--y': '1' } });
  assert.deepEqual(validChrome({ background: '#1e1f22', scheme: 'dark', theme: 'Not a theme!', vars: 'nope' }), { background: '#1e1f22', scheme: 'dark' }, 'a bad name and a non-map are dropped');
  assert.deepEqual(validChrome({ background: '#1e1f22', scheme: 'dark', vars: { bad: 'x' } }), { background: '#1e1f22', scheme: 'dark' }, 'an empty map is dropped');
});
