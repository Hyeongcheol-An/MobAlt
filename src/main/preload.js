'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const send = (ch, ...args) => ipcRenderer.send(ch, ...args);

// ---------- first paint in the saved theme ----------
// The chrome the renderer applied last time (main.js remembers it in the settings) goes on <html> as inline custom
// properties right now, while the document is still empty: styles.css defaults to the moba-dark tokens, and app.js
// re-applies the selected theme only after the settings arrived over IPC, which is after the first paint. Without
// this a saved light theme flashed the dark chrome at every launch. Synchronous on purpose: anything async lands
// after the paint. app.js overwrites every one of these once it runs.
let bootChrome = null;
try { bootChrome = ipcRenderer.sendSync('app:boot-chrome'); } catch {}
const applyBootChrome = () => {
  const root = document.documentElement;
  if (!root || !bootChrome || !bootChrome.vars) return false;
  for (const [k, v] of Object.entries(bootChrome.vars)) root.style.setProperty(k, v);
  root.style.colorScheme = bootChrome.scheme;
  if (bootChrome.theme) root.dataset.theme = bootChrome.theme;
  root.dataset.scheme = bootChrome.scheme;
  return true;
};
if (!applyBootChrome()) {
  // no <html> element yet: apply the moment the parser creates it (still before anything is painted)
  const mo = new MutationObserver(() => { if (applyBootChrome()) mo.disconnect(); });
  mo.observe(document, { childList: true });
}
// Test-only: what the first frames showed. A test script runs 500 ms after the load, too late to see them itself.
const firstFrames = [];
if (process.env.MOBALT_TEST_SCRIPT) {
  const rec = () => {
    const html = document.documentElement, body = document.body;
    firstFrames.push({ t: Math.round(performance.now()), html: html ? getComputedStyle(html).backgroundColor : null, body: body ? getComputedStyle(body).backgroundColor : null, scheme: html ? getComputedStyle(html).colorScheme : null });
    if (firstFrames.length < 12) requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
}

const EVENT_CHANNELS = [
  'term:data', 'term:exit', 'ssh:status', 'sftp:transfer', 'sftp:edit-synced', 'tunnels:changed',
  'prompt:request', 'menu:action', 'tools:output', 'tools:done', 'tools:scan', 'app:notice', 'app:bundle-updated',
  'detach:adopt', 'window:closing', 'settings:changed', 'sessions:changed', // several windows (detached tabs)
];
// A detached window is the same page with ?detached=<key>; main hands it the tabs for that key once (detach.payload).
let detachedKey = null;
try { detachedKey = new URLSearchParams(location.search).get('detached'); } catch {}
const on = (channel, fn) => {
  if (!EVENT_CHANNELS.includes(channel)) throw new Error('Unknown channel ' + channel);
  const wrapped = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('api', {
  on,
  promptReply: (reqId, result) => send('prompt:reply', { reqId, result }),

  app: {
    info: () => invoke('app:info'),
    quit: () => send('app:quit'),
    screenshot: (name) => invoke('app:screenshot', name),
    testDrag: (from, to) => invoke('test:drag', { from, to }),
    testResize: (w, h) => invoke('test:resize', w, h),
    testKey: (keyCode) => invoke('test:key', keyCode),
    testQuitCheck: (verb) => invoke('test:quit-check', verb),
    testBundleUpdated: (version) => invoke('test:bundle-updated', version),
    testNotice: (text) => invoke('test:notice', text),
    testNextDialog: (result) => invoke('test:next-dialog', result),
    testWolListen: (port) => invoke('test:wol-listen', port), // UDP listener on 127.0.0.1:<port> for magic packets (test mode only)
    testWolPackets: () => invoke('test:wol-packets'), // what it received: [{ from, port, length, hex }]
    checkUpdates: () => invoke('app:check-updates'),
    // main-process notices ({ level, text }): internal errors that would otherwise be lost in the console
    onNotice: (fn) => on('app:notice', fn),
    // a different MobAlt.app is on disk (brew upgrade / dragged DMG): { version, current }; relaunch() restarts into it
    onBundleUpdated: (fn) => on('app:bundle-updated', fn),
    relaunch: () => invoke('app:relaunch'),
    // the chrome palette the renderer applied ({ background: '#rrggbb', scheme: 'dark'|'light' }): window background + native theme
    chrome: (chrome) => send('app:chrome', chrome),
    // the chrome the preload put on <html> before the first paint (null on a first launch)
    bootChrome: () => bootChrome,
    testChrome: () => invoke('test:chrome'),
    testFirstFrames: () => firstFrames.slice(),
    // the key of a detached window (null in the main window)
    detachedKey: () => detachedKey,
    // test mode: every window ({ id, main, detached, title, bounds }), run code in one of them, close one
    testWindows: () => invoke('test:windows'),
    testEval: (id, code) => invoke('test:eval', id, code),
    testCloseWindow: (id) => invoke('test:window-close', id),
  },
  // a tab in a window of its own: open one for `payload` (the tabs, see app.js detachTab), fetch the payload of this
  // window, take over a live terminal (its buffered output comes back), hand the tabs back when the window closes
  detach: {
    open: (payload) => invoke('detach:open', payload),
    payload: (key) => invoke('detach:payload', key),
    attach: (id) => invoke('term:attach', id),
    returned: (payload) => send('detach:return', payload),
    closeDone: () => send('detach:close-done'),
  },
  term: {
    spawnLocal: (opts) => invoke('term:spawn-local', opts),
    spawnTelnet: (opts) => invoke('term:spawn-telnet', opts),
    spawnSerial: (opts) => invoke('term:spawn-serial', opts),
    spawnMosh: (opts) => invoke('term:spawn-mosh', opts),
    listSerialPorts: () => invoke('serial:list'),
    write: (id, data) => send('term:write', id, data),
    resize: (id, cols, rows) => send('term:resize', id, cols, rows),
    kill: (id) => send('term:kill', id),
    logStart: (id, name) => invoke('term:log-start', id, name),
    logStop: (id) => invoke('term:log-stop', id),
  },
  ftp: {
    connect: (cfg) => invoke('ftp:connect', cfg),
    disconnect: (id) => invoke('ftp:disconnect', id),
  },
  ssh: {
    connect: (cfg, size) => invoke('ssh:connect', cfg, size),
    connectSftp: (cfg) => invoke('ssh:connect-sftp', cfg),
    disconnect: (id) => invoke('ssh:disconnect', id),
    exec: (id, cmd) => invoke('ssh:exec', id, cmd),
    // { categories, labels, defaults, supported, legacy } for Advanced SSH → Algorithms
    algorithms: () => invoke('ssh:algorithms'),
  },
  keygen: {
    suggest: (type) => invoke('keygen:suggest', type), // next free ~/.ssh/id_<type>
    generate: (opts) => invoke('keygen:generate', opts), // { type, bits?, comment, passphrase, path }
    addToAgent: (keyPath, passphrase) => invoke('keygen:add-agent', keyPath, passphrase),
    install: (sessionId, publicKey, remoteFile) => invoke('keygen:install', sessionId, publicKey, remoteFile),
  },
  sftp: {
    list: (id, dir) => invoke('sftp:list', id, dir),
    home: (id) => invoke('sftp:home', id),
    realpath: (id, p) => invoke('sftp:realpath', id, p),
    stat: (id, p) => invoke('sftp:stat', id, p),
    mkdir: (id, p) => invoke('sftp:mkdir', id, p),
    rename: (id, a, b) => invoke('sftp:rename', id, a, b),
    remove: (id, p, isDir) => invoke('sftp:remove', id, p, isDir),
    chmod: (id, p, mode) => invoke('sftp:chmod', id, p, mode),
    read: (id, p) => invoke('sftp:read', id, p),
    write: (id, p, content) => invoke('sftp:write', id, p, content),
    download: (id, remote, local, isDir) => invoke('sftp:download', id, remote, local, isDir),
    upload: (id, locals, remoteDir) => invoke('sftp:upload', id, locals, remoteDir),
    cancel: (tid) => invoke('sftp:cancel', tid),
    transfers: () => invoke('sftp:transfers'),
    edit: (id, remote) => invoke('sftp:edit', id, remote),
  },
  tunnels: {
    start: (spec) => invoke('tunnel:start', spec),
    stop: (id) => invoke('tunnel:stop', id),
    list: () => invoke('tunnel:list'),
  },
  sessions: {
    list: () => invoke('sessions:list'),
    save: (s) => invoke('sessions:save', s),
    saveAll: (data) => invoke('sessions:save-all', data),
    remove: (id) => invoke('sessions:delete', id),
    importSshConfig: () => invoke('sessions:import-sshconfig'),
    importMoba: () => invoke('sessions:import-moba'),
    exportJson: () => invoke('sessions:export'),
    importJson: () => invoke('sessions:import-json'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  workspace: {
    get: () => invoke('workspace:get'),
    save: (data) => send('workspace:save', data),
  },
  dialog: {
    open: (opts) => invoke('dialog:open', opts),
    save: (opts) => invoke('dialog:save', opts),
    message: (opts) => invoke('dialog:message', opts),
  },
  shell: {
    openExternal: (url) => invoke('shell:open-external', url),
    showItem: (p) => invoke('shell:show-item', p),
    openPath: (p) => invoke('shell:open-path', p),
  },
  launch: {
    rdp: (cfg) => invoke('launch:rdp', cfg),
    vnc: (cfg) => invoke('launch:vnc', cfg),
  },
  tools: {
    ping: (host, count) => invoke('tools:ping', host, count),
    traceroute: (host) => invoke('tools:traceroute', host),
    portScan: (host, from, to) => invoke('tools:portscan', host, from, to),
    lookup: (host) => invoke('tools:lookup', host),
    netinfo: () => invoke('tools:netinfo'),
    stop: (id) => invoke('tools:stop', id),
    wake: (opts) => invoke('tools:wake', opts), // { mac, broadcast?, port? } → { ok, mac, broadcast, port, sent } | { ok: false, error }
    scanStart: (opts) => invoke('tools:scan-start', opts), // { target, method, ports, concurrency, timeout, reverseDns } → { id, total, ports } | { error }; events on tools:scan
    scanStop: (id) => invoke('tools:scan-stop', id),
  },
  clipboard: {
    write: (t) => invoke('clipboard:write', t),
    read: () => invoke('clipboard:read'),
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
