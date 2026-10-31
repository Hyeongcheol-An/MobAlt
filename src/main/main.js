'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard, nativeTheme, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const { Store, validChrome } = require('./store');
const { TerminalRegistry, spawnLocal, spawnTelnet, spawnSerial, listSerialPorts, spawnMosh } = require('./terminals');
const { SshManager } = require('./ssh');
const { SftpManager } = require('./sftp');
const { FtpManager } = require('./ftp');
const { setupUpdater } = require('./updater');
const { TunnelManager } = require('./tunnels');
const importers = require('./importers');
const tools = require('./tools');
const wol = require('./wol');
const netscan = require('./netscan');
const x11 = require('./x11');
const knownhosts = require('./knownhosts');
const keygen = require('./keygen');
const algorithms = require('./algorithms');
const { liveConnections, quitQuestion } = require('./live');
const { startBundleWatch, relaunchOptions } = require('./bundlewatch');
const dialogs = require('./dialogs'); // native dialogs; answered from the queue in test mode
const { RemoteMonitor } = require('./monitor'); // the remote monitoring bar: one exec per poll on the pane's own connection
const { ZmodemManager } = require('./zmodem');

const pkg = require('../../package.json');
const scans = new Map(); // running network scans: id → { cancel, promise } (netscan.js); quitting cancels them
let wolListener = null; // test-only UDP listener for Wake-on-LAN packets (test:wol-listen)
let silentListener = null; // test-only TCP listener that accepts and never speaks (test:silent-listen)
app.setName('MobAlt');
if (process.env.MOBALT_USER_DATA) app.setPath('userData', process.env.MOBALT_USER_DATA); // test isolation
const store = new Store();
const registry = new TerminalRegistry();
let win = null; // the main window: the sidebar, the test hooks and the fallback for everything addressed to "the window"
// A tab can be detached into a window of its own (app.js detachTab): every window runs the same renderer, the
// backends stay here. A terminal's output goes to the window that spawned it or attached to it last.
const owners = new Map(); // terminal id → webContents id
const detachPayloads = new Map(); // key → the tabs a new detached window shows (its renderer fetches them once)
let wsMain = null; // the main window's part of the workspace file ({ v, activeTab, tabs })…
const wsParts = new Map(); // …and one { tabs, activeTab, bounds } per detached window, by window id (restored as windows)
let quitting = false; // a quit is under way (confirmed, test hook, update install or relaunch): no more questions, tear down
let bundleWatch = null; // notices a different MobAlt.app written over the running one (brew upgrade / dragged DMG)
let relaunchRequested = false; // test mode: app:relaunch records the request instead of restarting the test run

/**
 * Ask before the app goes away with live connections (SSH / Mosh / SFTP companions / FTP). Shared by the
 * window's close button, ⌘Q (app.quit → before-quit) and the relaunch banner. `verb` names what the user
 * chose ("Quit", "Relaunch"): it is the question's last word and the confirming button. Returns true when
 * quitting may proceed. No dialog when the setting is off, during a confirmed quit, or in the headless test
 * runs (their scripts must quit unattended).
 */
function confirmQuit(verb = 'Quit') {
  if (quitting) return true;
  if (process.env.MOBALT_TEST_SCRIPT || process.env.MOBALT_SCREENSHOT) return true;
  const live = liveConnections(registry, ftp);
  if (!live.total || !store.getSettings().confirmClose) return true;
  const r = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
    type: 'question',
    buttons: [verb, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: quitQuestion(live, verb),
  });
  return r === 0;
}

/**
 * Restart into the bundle now on disk (the relaunch banner, or the updater finding that version already
 * installed). The quit question is asked here, once, when connections are live; `quitting` keeps the
 * before-quit handler from asking again. app.quit() rather than app.exit() so that the window's beforeunload
 * saves the workspace and before-quit tears the connections down, exactly like ⌘Q. The new instance starts
 * through LaunchServices (`open -n -a`), which clears a Homebrew/DMG bundle's quarantine the way a Finder
 * launch does; a raw exec of the new binary could be refused (see relaunchOptions). Returns true when the
 * restart is under way (in test mode: recorded, not performed).
 */
function relaunch() {
  if (!confirmQuit('Relaunch')) return false;
  if (process.env.MOBALT_TEST_SCRIPT) {
    relaunchRequested = true;
    return true;
  }
  quitting = true;
  if (win && !win.isDestroyed() && !win.isFullScreen()) store.setSettings({ windowBounds: win.getBounds() }); // what the debounced resize/move save may still owe
  const opts = relaunchOptions();
  if (opts) app.relaunch(opts);
  else app.relaunch(); // no bundle (running from source)
  app.quit();
  return true;
}

// ---------- windows ----------
/** Every open window (the main one and the detached ones). */
function allWindows() {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
}
/** An event for every window: status changes, transfers and tunnels are keyed by connection id, a renderer ignores ids it does not show. */
function broadcast(channel, ...args) {
  for (const w of allWindows()) w.webContents.send(channel, ...args);
}
/** The window the user is in (a menu accelerator, a prompt), else the main window. */
function focusedWindow() {
  const f = BrowserWindow.getFocusedWindow();
  return f && !f.isDestroyed() ? f : win && !win.isDestroyed() ? win : null;
}
/** The window a terminal's output goes to: the one that spawned or attached it, else the main window (null while none is up). */
function ownerOf(id) {
  const wcId = owners.get(id);
  const wc = wcId !== undefined ? webContents.fromId(wcId) : null;
  if (wc && !wc.isDestroyed()) return wc;
  return win && !win.isDestroyed() ? win.webContents : null;
}

// ---------- renderer prompts (host key / password / keyboard-interactive) ----------
const pendingPrompts = new Map();
function prompt(kind, payload) {
  return new Promise((resolve) => {
    const target = focusedWindow(); // the window the user is working in; the prompt names the host either way
    if (!target) return resolve(null);
    const reqId = crypto.randomBytes(6).toString('hex');
    pendingPrompts.set(reqId, resolve);
    target.webContents.send('prompt:request', { reqId, kind, payload });
  });
}
ipcMain.on('prompt:reply', (_e, { reqId, result }) => {
  const r = pendingPrompts.get(reqId);
  if (r) {
    pendingPrompts.delete(reqId);
    r(result);
  }
});
const publicSession = (s) => {
  if (!s) return s;
  const { password, passphrase, jumpPassword, ...rest } = s;
  return { ...rest, hasPassword: !!password, hasPassphrase: !!passphrase, hasJumpPassword: !!jumpPassword };
};
const prompter = {
  hostKey: (info) => prompt('hostkey', info),
  password: (info) => prompt('password', { ...info, session: publicSession(info.session) }),
  keyboardInteractive: (info) => prompt('kbdint', { ...info, session: publicSession(info.session) }),
  status: (id, state, msg) => broadcast('ssh:status', { id, state, msg }),
};

const ssh = new SshManager(registry, store, prompter);
const monitor = new RemoteMonitor(ssh); // the monitoring bar's polls; keeps the previous sample per connection for the rates
const sftp = new SftpManager(ssh, store);
const ftp = new FtpManager(store, prompter);
// rz / sz inside a terminal: a sentry on every byte stream the registry registers; its dialogs go through dialogs.js
const zmodem = new ZmodemManager(registry, store, { dialogs, getWin: () => win, downloadsDir: () => app.getPath('downloads') });
let updater = null;
const tunnels = new TunnelManager(ssh, store);

// ---------- terminal output: coalesce chunks per terminal before IPC, each to the window showing that terminal ----------
const outBuf = new Map();
let flushTimer = null;
registry.on('data', (id, data) => {
  outBuf.set(id, (outBuf.get(id) || '') + data);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      for (const [tid, text] of outBuf) {
        const wc = ownerOf(tid);
        if (wc) wc.send('term:data', tid, text);
      }
      outBuf.clear();
    }, 4);
  }
});
registry.on('exit', (id, code, reason, detail) => {
  const wc = ownerOf(id), text = outBuf.get(id);
  if (text && wc) wc.send('term:data', id, text);
  outBuf.delete(id);
  tunnels.stopForConnection(id);
  sftp.stopEdits(id);
  monitor.forget(id); // the next connection starts its rates afresh
  if (wc) wc.send('term:exit', id, { code, reason, detail });
  owners.delete(id);
});
// transfers and synced edits belong to the window showing their connection (every window's panel would list them otherwise)
const toOwner = (channel) => (x) => {
  const wc = x && x.connId ? ownerOf(x.connId) : null;
  if (wc) wc.send(channel, x);
  else broadcast(channel, x);
};
sftp.on('transfer', toOwner('sftp:transfer'));
sftp.on('edit-synced', toOwner('sftp:edit-synced'));
zmodem.on('transfer', toOwner('sftp:transfer')); // same list, same Cancel
ftp.on('transfer', toOwner('sftp:transfer'));
ftp.on('edit-synced', toOwner('sftp:edit-synced'));
tunnels.on('changed', (list) => broadcast('tunnels:changed', list));

// ---------- workspace file: the main window's tabs plus one entry per detached window ----------
function writeWorkspace() {
  const base = wsMain || store.getWorkspace() || { v: 1, activeTab: 0, tabs: [] };
  const windows = [...wsParts.values()].filter((p) => Array.isArray(p.tabs) && p.tabs.length);
  store.saveWorkspace({ v: base.v || 1, activeTab: base.activeTab || 0, tabs: base.tabs || [], windows });
}

/** A detached window goes once its renderer handed its tabs back (detach:close-done), or when it never answers. */
function finishClose(w) {
  if (!w || w.isDestroyed() || w === win) return;
  clearTimeout(w._closeTimer);
  w._closeReady = true;
  w.close();
}

// ---------- window ----------
/** The chrome palette the renderer last applied (store.validChrome), remembered in the settings, so a new window, the native theme and the first paint start in it. */
const chromeOf = (settings) => validChrome(settings && settings.chrome) || { background: '#1e1f22', scheme: 'dark' };

/**
 * The main window, or (`detached` = payload key) a window for tabs moved out of another one: the same page with
 * `?detached=<key>`, started the size of the window it came from and offset like a new document window, or at the
 * bounds the workspace file saved for it. Closing the main window quits the app (its detached windows go with it;
 * their tabs are in the workspace file). Closing a detached window hands its tabs back to the main window: the
 * renderer releases its terminals (never ends them), the main window adopts them, and the window goes once the
 * renderer says so (detach:close-done) — or after 8 s should it never answer.
 */
function createWindow({ detached = null, bounds = null, from = null } = {}) {
  const settings = store.getSettings();
  const isMain = !detached;
  let b = isMain ? settings.windowBounds || { width: 1400, height: 880 } : bounds;
  if (!isMain && !b) {
    const src = from && !from.isDestroyed() ? from.getBounds() : win && !win.isDestroyed() ? win.getBounds() : { x: 80, y: 80, width: 1200, height: 760 };
    b = { x: (src.x || 0) + 40, y: (src.y || 0) + 40, width: src.width, height: src.height };
  }
  const w = new BrowserWindow({
    ...b,
    minWidth: 900,
    minHeight: 560,
    title: 'MobAlt',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: chromeOf(settings).background, // the applied theme's chrome: no dark flash behind a light theme
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  if (isMain) win = w;
  else w._detachKey = detached;
  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), detached ? { query: { detached } } : undefined);
  w.once('ready-to-show', () => w.show());
  if (isMain) {
    const saveBounds = () => {
      if (!win || win.isDestroyed() || win.isFullScreen()) return;
      store.setSettings({ windowBounds: win.getBounds() });
    };
    w.on('resize', debounce(saveBounds, 500));
    w.on('move', debounce(saveBounds, 500));
  }
  w.on('close', (e) => {
    if (quitting) return;
    if (isMain) {
      if (!confirmQuit()) {
        e.preventDefault();
        return;
      }
      quitting = true; // the main window going quits the app: no second question (window-all-closed, or app.quit with detached windows open)
      if (allWindows().length > 1) setImmediate(() => app.quit());
      return;
    }
    if (w._closeReady) return;
    e.preventDefault();
    if (w._closing) return;
    w._closing = true;
    w.webContents.send('window:closing');
    w._closeTimer = setTimeout(() => finishClose(w), 8000);
  });
  w.on('closed', () => {
    if (isMain) win = null;
    else if (!quitting) { // the tabs went back to the main window (or the window was closed by force): no longer a window of the workspace
      wsParts.delete(w.id);
      try { writeWorkspace(); } catch {}
    }
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isMain) w.webContents.on('did-finish-load', () => runTestHooks());
  if (process.env.MOBALT_SCREENSHOT || process.env.MOBALT_TEST_SCRIPT) {
    w.webContents.on('console-message', (e) => {
      const d = e.level !== undefined ? e : { level: e, message: arguments[2] };
      console.log(`[renderer${isMain ? '' : ':w' + w.id}:${d.level}] ${d.message}${d.sourceId ? ` (${d.sourceId}:${d.lineNumber})` : ''}`);
    });
  }
  return w;
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Headless verification hooks used by the test scripts (never set in normal use).
function runTestHooks() {
  const script = process.env.MOBALT_TEST_SCRIPT;
  const shot = process.env.MOBALT_SCREENSHOT;
  const delay = parseInt(process.env.MOBALT_SCREENSHOT_DELAY || '1500', 10);
  if (script) {
    setTimeout(() => {
      win.webContents.executeJavaScript(fs.readFileSync(script, 'utf8')).catch((e) => console.error('test script error:', e));
    }, 500);
  }
  if (shot) {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        console.log('screenshot written', shot);
      } catch (e) {
        console.error('screenshot failed', e);
      }
      if (process.env.MOBALT_QUIT_AFTER !== '0') {
        quitting = true;
        app.quit();
      }
    }, delay);
  }
}

// ---------- menu ----------
function sendAction(action, arg) {
  const w = focusedWindow(); // a menu accelerator acts in the window the user is in (a detached window too)
  if (w) w.webContents.send('menu:action', { action, arg });
}
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendAction('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Session',
      submenu: [
        { label: 'New Session…', accelerator: 'Cmd+N', click: () => sendAction('new-session') },
        { label: 'New Local Terminal', accelerator: 'Cmd+T', click: () => sendAction('new-local') },
        { label: 'Quick Connect…', accelerator: 'Cmd+Shift+N', click: () => sendAction('quick-connect') },
        { type: 'separator' },
        { label: 'Duplicate Session', accelerator: 'Cmd+Shift+T', click: () => sendAction('duplicate') },
        { label: 'Reconnect', accelerator: 'Cmd+R', click: () => sendAction('reconnect') },
        { label: 'Disconnect', click: () => sendAction('disconnect') },
        { type: 'separator' },
        { label: 'Rename Tab…', click: () => sendAction('rename-tab') },
        { label: 'Pin / Unpin Tab', accelerator: 'Cmd+Shift+P', click: () => sendAction('pin-tab') },
        { label: 'Detach Tab to New Window', accelerator: 'Cmd+Alt+N', click: () => sendAction('detach-tab') },
        { label: 'Close Tab', accelerator: 'Cmd+W', click: () => sendAction('close') },
        { label: 'Close Other Tabs', click: () => sendAction('close-others') },
        { label: 'Close Tabs to the Left', click: () => sendAction('close-left') },
        { label: 'Close Tabs to the Right', click: () => sendAction('close-right') },
        { type: 'separator' },
        { label: 'Import from ~/.ssh/config', click: () => sendAction('import-sshconfig') },
        { label: 'Import from MobaXterm.ini…', click: () => sendAction('import-moba') },
        { label: 'Import Sessions (JSON)…', click: () => sendAction('import-json') },
        { label: 'Export Sessions (JSON)…', click: () => sendAction('export-json') },
        { type: 'separator' },
        { label: 'Generate SSH Key…', click: () => sendAction('keygen') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'Cmd+F', click: () => sendAction('find') },
        { label: 'Clear Terminal', accelerator: 'Cmd+K', click: () => sendAction('clear') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'Cmd+B', click: () => sendAction('toggle-sidebar') },
        { label: 'Sessions Panel', accelerator: 'Cmd+1', click: () => sendAction('sidebar', 'sessions') },
        { label: 'SFTP Panel', accelerator: 'Cmd+2', click: () => sendAction('sidebar', 'sftp') },
        { label: 'Tools Panel', accelerator: 'Cmd+3', click: () => sendAction('sidebar', 'tools') },
        { label: 'Macros Panel', accelerator: 'Cmd+4', click: () => sendAction('sidebar', 'macros') },
        { type: 'separator' },
        { label: 'Split Right', accelerator: 'Cmd+D', click: () => sendAction('split', 'right') },
        { label: 'Split Down', accelerator: 'Cmd+Shift+D', click: () => sendAction('split', 'down') },
        {
          label: 'Grid Layout',
          submenu: [
            { label: '1 × 2 (2 side by side)', accelerator: 'Cmd+Alt+2', click: () => sendAction('layout', '2x1') },
            { label: '2 × 1 (2 stacked)', click: () => sendAction('layout', '1x2') },
            { label: '2 × 2 (4 panes)', accelerator: 'Cmd+Alt+4', click: () => sendAction('layout', '2x2') },
            { label: '2 × 3 (6 panes)', accelerator: 'Cmd+Alt+6', click: () => sendAction('layout', '2x3') },
            { label: '2 × 4 (8 panes)', accelerator: 'Cmd+Alt+8', click: () => sendAction('layout', '2x4') },
          ],
        },
        { label: 'Unsplit (keep active pane)', accelerator: 'Cmd+Alt+1', click: () => sendAction('unsplit') },
        { label: 'Close Pane', accelerator: 'Cmd+Shift+W', click: () => sendAction('close-pane') },
        { label: 'Focus Next Pane', accelerator: 'Cmd+]', click: () => sendAction('next-pane') },
        { label: 'Zoom Pane (fill the tab / restore)', accelerator: 'Cmd+Shift+Return', click: () => sendAction('zoom-pane') },
        { label: 'Remote Monitoring Bar', click: () => sendAction('toggle-monitor') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'Cmd+=', click: () => sendAction('zoom', 1) },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => sendAction('zoom', -1) },
        { label: 'Reset Zoom', accelerator: 'Cmd+0', click: () => sendAction('zoom', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'MultiExec (broadcast input)', accelerator: 'Cmd+Shift+M', click: () => sendAction('multiexec') },
        { label: 'Tunneling…', accelerator: 'Cmd+Shift+U', click: () => sendAction('tunnels') },
        { label: 'Start/Stop Session Log', click: () => sendAction('toggle-log') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendAction('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendAction('prev-tab') },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Check for Updates…', click: () => updater && updater.check(true) },
        { type: 'separator' },
        { label: 'MobAlt on disk', click: () => shell.showItemInFolder(app.getPath('userData')) },
        { label: 'Keyboard Shortcuts', click: () => sendAction('shortcuts') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
function sizeOf(size) {
  return { cols: Math.max(2, (size && size.cols) || 80), rows: Math.max(1, (size && size.rows) || 24) };
}

/** Merge secrets from the stored copy when the renderer sends a session without them. */
async function mergeSecrets(incoming) {
  const stored = incoming.id ? await store.getSession(incoming.id) : null;
  const out = { ...incoming };
  for (const f of ['password', 'passphrase', 'jumpPassword']) {
    if (out[f] === undefined && stored) out[f] = stored[f];
    if (out[f] === undefined) delete out[f];
  }
  delete out.hasPassword;
  delete out.hasPassphrase;
  delete out.hasJumpPassword;
  return out;
}

function registerIpc() {
  const wof = (e) => (e && BrowserWindow.fromWebContents(e.sender)) || win; // the window a call came from: parent of its dialogs, target of its tool output
  const own = (e, r) => { if (r && r.id) owners.set(r.id, e.sender.id); return r; }; // a new backend belongs to the window that asked for it
  const peers = (e, channel, ...args) => { for (const w of allWindows()) if (w.webContents.id !== e.sender.id) w.webContents.send(channel, ...args); }; // the other windows
  ipcMain.handle('app:info', () => ({
    version: pkg.version,
    platform: process.platform,
    home: os.homedir(),
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    x11Available: x11.isAvailable(),
    display: x11.findDisplay(),
    agent: !!process.env.SSH_AUTH_SOCK,
    electron: process.versions.electron,
    hostname: os.hostname(), // what the monitoring bar shows for a session to this Mac (test/e2e-monitor.js)
  }));
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle('app:relaunch', () => relaunch());
  // The renderer applied a theme (Settings → Theme, or at startup): the window background (the title-bar strip, what
  // shows through while resizing) and the native theme (menus, sheets, prefers-color-scheme) follow its chrome
  // palette, and the whole chrome (background, scheme, theme name, CSS tokens) is remembered so the next launch starts
  // in it: createWindow, app.whenReady, and the preload, which puts the tokens on <html> before the first paint.
  ipcMain.on('app:chrome', (_e, c) => {
    const chrome = validChrome(c);
    if (!chrome) return;
    if (win && !win.isDestroyed()) win.setBackgroundColor(chrome.background);
    nativeTheme.themeSource = chrome.scheme;
    const cur = store.getSettings().chrome;
    if (JSON.stringify(validChrome(cur)) !== JSON.stringify(chrome)) store.setSettings({ chrome });
  });
  // The preload asks for the remembered chrome synchronously while the page is still empty (see preload.js).
  ipcMain.on('app:boot-chrome', (e) => { e.returnValue = chromeOf(store.getSettings()); });
  // Test-only: what the window and the native theme were last told, and what the next launch would start in.
  ipcMain.handle('test:chrome', () => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return { background: win && !win.isDestroyed() ? win.getBackgroundColor() : null, scheme: nativeTheme.themeSource, stored: store.getSettings().chrome || null };
  });
  // Test-only: perform a REAL drag-and-drop through the Chrome DevTools Protocol so that the
  // browser's own drop rules (effectAllowed/dropEffect, dragover preventDefault) are exercised.
  ipcMain.handle('test:resize', (_e, w, h) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null; // test mode only
    win.setSize(Math.max(400, w | 0), Math.max(300, h | 0));
    return win.getSize();
  });
  // Test-only: one REAL (trusted) key press, so Chromium enters keyboard mode and draws :focus-visible
  // rings on programmatic focus the way it does once a user has touched the keyboard. :focus only
  // matches in the active window and macOS will not let a test steal activation, so the page is told
  // to behave as focused (what headless browsers do) instead.
  ipcMain.handle('test:key', async (_e, keyCode) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    return true;
  });
  ipcMain.handle('test:drag', async (_e, { from, to, steps = 8 }) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    const send = (m, p) => dbg.sendCommand(m, p);
    let data = null;
    const onEvent = (_ev, method, params) => {
      if (method === 'Input.dragIntercepted') data = params.data;
    };
    dbg.on('message', onEvent);
    try {
      await send('Input.setInterceptDrags', { enabled: true });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= steps && !data; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps, y = from.y + ((to.y - from.y) * i) / steps;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
        await new Promise((r) => setTimeout(r, 30));
      }
      if (!data) {
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
        return { ok: false, reason: 'drag did not start (no dragIntercepted event)' };
      }
      await send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data });
      await send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data });
      await new Promise((r) => setTimeout(r, 50));
      await send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
      return { ok: true, items: data.items.map((i) => i.mimeType), ops: data.dragOperationsMask };
    } finally {
      dbg.off('message', onEvent);
      await send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
    }
  });
  // Test-only: what the quit confirmation would do right now, without showing the native dialog (`verb` as in
  // confirmQuit: "Quit" by default, "Relaunch" for the banner's path), and whether app:relaunch was asked for
  // (test mode records it instead of restarting).
  ipcMain.handle('test:quit-check', (_e, verb) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    const live = liveConnections(registry, ftp);
    const wouldAsk = !quitting && live.total > 0 && !!store.getSettings().confirmClose;
    return { live, wouldAsk, question: wouldAsk ? quitQuestion(live, verb || 'Quit') : null, relaunchRequested };
  });
  // Test-only: pretend that MobAlt `version` is now on disk — the same renderer event the bundle watch sends
  // (no de-duplication here, so the renderer's own "Later" logic is what gets exercised).
  ipcMain.handle('test:bundle-updated', (_e, version) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return bundleWatch ? bundleWatch.send(String(version)) : false;
  });
  // Test-only: a few filesystem helpers the renderer test scripts have no bridge for — make a random file, hash a
  // file (sha256), read small text, stat, make a temp dir, remove. Only when a test script is injected; a release
  // never reaches this (the renderer has no fs access of its own).
  ipcMain.handle('test:fs', (_e, op, ...args) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    if (op === 'randomFile') { const [p, size] = args; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, crypto.randomBytes(size | 0)); return fs.statSync(p).size; }
    if (op === 'sha256') { return crypto.createHash('sha256').update(fs.readFileSync(args[0])).digest('hex'); }
    if (op === 'exists') { return fs.existsSync(args[0]); }
    if (op === 'readText') { return fs.readFileSync(args[0], 'utf8'); }
    if (op === 'writeText') { fs.mkdirSync(path.dirname(args[0]), { recursive: true }); fs.writeFileSync(args[0], args[1]); return true; }
    if (op === 'mkdtemp') { return fs.mkdtempSync(path.join(os.tmpdir(), args[0] || 'mobalt-test-')); }
    if (op === 'mkdirp') { fs.mkdirSync(args[0], { recursive: true }); return true; }
    if (op === 'rm') { fs.rmSync(args[0], { recursive: true, force: true }); return true; }
    return null;
  });
  // Test-only: a main-process notice (what the uncaughtException handler sends) with the given text.
  ipcMain.handle('test:notice', (_e, text) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    if (!win || win.isDestroyed()) return false;
    win.webContents.send('app:notice', { level: 'error', text: String(text) });
    return true;
  });
  // Test-only: the answer the next native file picker / sheet gives instead of opening ({ canceled, filePaths?,
  // filePath?, response? }); answers queue up in order and the real dialog is back once the queue is empty.
  // Without a result it only reports how many answers are still waiting.
  ipcMain.handle('test:next-dialog', (_e, result) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    if (result === undefined || result === null) return { pending: dialogs.pending() };
    return { pending: dialogs.enqueue(result) };
  });
  // Test-only: a UDP listener on 127.0.0.1:<port> (0 = any free port) for Wake-on-LAN packets, and what it has
  // received ({ from, port, length, hex }), so a test can assert the magic packet. Listening again replaces it.
  ipcMain.handle('test:wol-listen', (_e, port) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return new Promise((resolve, reject) => {
      if (wolListener) { try { wolListener.socket.close(); } catch {} wolListener = null; }
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const packets = [];
      socket.on('message', (msg, rinfo) => packets.push({ from: rinfo.address, port: rinfo.port, length: msg.length, hex: msg.toString('hex') }));
      socket.once('error', reject);
      socket.bind(port | 0, '127.0.0.1', () => {
        wolListener = { socket, packets };
        resolve({ port: socket.address().port });
      });
    });
  });
  ipcMain.handle('test:wol-packets', () => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return wolListener ? wolListener.packets.slice() : [];
  });
  // Test-only: a TCP listener on 127.0.0.1:<port> (0 = any free port) that accepts and never sends a byte — an SSH
  // connection to it waits for the banner until the handshake limit (how test/e2e-keygen.js holds the key
  // generator's "Installing…" state open). Listening again replaces it; quitting closes it with the app.
  ipcMain.handle('test:silent-listen', (_e, port) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return new Promise((resolve, reject) => {
      if (silentListener) { try { silentListener.close(); } catch {} silentListener = null; }
      const srv = require('net').createServer((sock) => sock.on('error', () => {}));
      srv.once('error', reject);
      srv.listen(port | 0, '127.0.0.1', () => {
        silentListener = srv;
        resolve({ port: srv.address().port });
      });
    });
  });
  // Test-only: the open windows, code run inside one of them (its resolved value comes back) and closing one — the
  // test script lives in the main window; a detached window is driven through these.
  ipcMain.handle('test:windows', () => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return allWindows().map((w) => ({ id: w.id, main: w === win, detached: !!w._detachKey, title: w.getTitle(), bounds: w.getBounds() }));
  });
  ipcMain.handle('test:eval', (_e, id, code) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    const w = BrowserWindow.fromId(id);
    if (!w || w.isDestroyed()) throw new Error(`no window ${id}`);
    return w.webContents.executeJavaScript(String(code));
  });
  ipcMain.handle('test:window-close', (_e, id) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    const w = BrowserWindow.fromId(id);
    if (!w || w.isDestroyed()) return false;
    w.close();
    return true;
  });
  // the monitoring bar's polling, counted (does it stop off screen?) and made to fail (the "unavailable" path)
  ipcMain.handle('test:monitor-stats', () => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    return { execCount: ssh.execCount, samples: monitor.samples };
  });
  ipcMain.handle('test:monitor-command', (_e, cmd) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null;
    monitor.setCommand(cmd);
    return true;
  });
  ipcMain.handle('app:screenshot', async (e, name) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null; // test mode only
    const dir = process.env.MOBALT_SHOT_DIR || os.tmpdir();
    const img = await wof(e).webContents.capturePage(); // the calling window (a detached window's script shoots itself)
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('screenshot', file);
    return file;
  });

  ipcMain.handle('term:spawn-local', (e, opts) => own(e, spawnLocal(registry, store.getSettings(), { ...opts, ...sizeOf(opts) })));
  ipcMain.handle('term:spawn-telnet', (e, opts) => own(e, spawnTelnet(registry, { ...opts, ...sizeOf(opts) })));
  ipcMain.handle('term:spawn-serial', (e, opts) => own(e, spawnSerial(registry, opts)));
  // Mosh bootstraps over an external ssh: the host key goes through the app's own prompt first and the
  // bootstrap then runs strictly against the app's known_hosts file (never ~/.ssh/known_hosts).
  ipcMain.handle('term:spawn-mosh', async (e, opts) => {
    // the session's Advanced SSH algorithm settings apply to this check (and to the SFTP companion), not to mosh's own ssh
    const v = await ssh.verifyHost({ name: opts.name, host: opts.host, port: opts.port || 22, username: opts.username, legacyAlgorithms: opts.legacyAlgorithms, algorithms: opts.algorithms });
    if (!v.ok) throw new Error(v.error || 'host key not accepted');
    return own(e, spawnMosh(registry, store.getSettings(), { ...opts, ...sizeOf(opts), knownHostsFile: knownhosts.file() }));
  });
  ipcMain.handle('ftp:connect', async (e, cfg) => own(e, await ftp.connect(await mergeSecrets(cfg))));
  // A window takes over a live terminal (a detached tab, or one coming back): from now on its output goes there; the
  // ring buffer (last 256 KB) redraws what the previous window showed. What is still queued for the old owner is in
  // the ring already, so it is dropped here rather than sent twice. ok: false when the backend has ended meanwhile
  // (the replay, if any, still shows its last screen).
  ipcMain.handle('term:attach', (e, id) => {
    outBuf.delete(id);
    owners.set(id, e.sender.id);
    const h = registry.get(id);
    return { ok: !!h || ftp.has(id), kind: h ? h.kind : ftp.has(id) ? 'ftp' : null, replay: registry.replay(id) };
  });
  ipcMain.handle('ftp:disconnect', (_e, id) => ftp.disconnect(id));
  // Settings → Updates "Check now": the outcome goes on the dialog's own status line, so this check is quiet (no
  // up-to-date / error / on-disk sheet; only a new release's "Download?" offer). Help → Check for Updates… keeps the sheets.
  ipcMain.handle('app:check-updates', () => updater && updater.check(true, { quiet: true }));
  ipcMain.handle('serial:list', () => listSerialPorts());
  ipcMain.on('term:write', (_e, id, data) => registry.write(id, data));
  ipcMain.on('term:resize', (_e, id, cols, rows) => registry.resize(id, cols, rows));
  ipcMain.on('term:kill', (_e, id) => registry.kill(id));
  ipcMain.handle('term:log-start', (_e, id, name) => {
    const s = store.getSettings();
    const dir = s.logDir || path.join(app.getPath('documents'), 'MobAlt Logs');
    const safe = String(name || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return registry.startLog(id, path.join(dir, `${safe}_${stamp}.log`), { plain: !!s.logPlainText });
  });
  ipcMain.handle('term:log-stop', (_e, id) => registry.stopLog(id));

  ipcMain.handle('ssh:connect', async (e, cfg, size) => own(e, await ssh.openShell(await mergeSecrets(cfg), sizeOf(size))));
  // shell-less connection for the Sftp panel of a Mosh pane (same prompts; ssh:status events carry its state)
  ipcMain.handle('ssh:connect-sftp', async (e, cfg) => own(e, await ssh.openSftpOnly(await mergeSecrets(cfg))));
  ipcMain.handle('ssh:disconnect', (_e, id) => ssh.disconnect(id));
  ipcMain.handle('ssh:exec', (_e, id, cmd) => ssh.exec(id, cmd));
  // Advanced SSH → Algorithms: ssh2's defaults, every name it supports, the legacy preset's additions.
  ipcMain.handle('ssh:algorithms', () => algorithms.describe());

  // ---------- SSH key generator (Session → Generate SSH Key…, the editor's Generate… button) ----------
  // The next free ~/.ssh/id_<type> (id_ed25519, id_ed25519_2, …), shown with ~ for the dialog.
  ipcMain.handle('keygen:suggest', (_e, type) => {
    const name = `id_${{ ed25519: 'ed25519', rsa: 'rsa', ecdsa: 'ecdsa' }[type] || 'ed25519'}`;
    return keygen.shortHome(keygen.nextFreePath(path.join(os.homedir(), '.ssh', name)));
  });
  // { type, bits?, comment?, passphrase?, path } → { privateKeyPath, publicKeyPath, publicKey, fingerprint }; errors are readable
  ipcMain.handle('keygen:generate', (_e, opts) => keygen.generate(opts || {}));
  ipcMain.handle('keygen:add-agent', (_e, keyPath, passphrase) => keygen.addToAgent(keyPath, passphrase));
  // Install on a server: the saved session's own authentication (prompts included); { ok, added } or { ok: false, error }
  ipcMain.handle('keygen:install', async (_e, sessionId, publicKey, remoteFile) => {
    const s = await store.getSession(sessionId);
    if (!s) return { ok: false, error: 'That session no longer exists' };
    if (s.type !== 'ssh') return { ok: false, error: `${s.name} is not an SSH session` };
    return ssh.installPublicKey(s, publicKey, remoteFile);
  });
  // one poll of the remote monitoring bar (src/main/monitor.js): { sample } or { error, fatal }
  ipcMain.handle('ssh:monitor', (_e, id) => monitor.sample(id));

  // FTP sessions share the sftp:* API; the connection id decides which backend serves it.
  const files = (id) => (ftp.has(id) ? ftp : sftp);
  ipcMain.handle('sftp:list', (_e, id, dir) => files(id).list(id, dir));
  ipcMain.handle('sftp:home', (_e, id) => files(id).home(id));
  ipcMain.handle('sftp:realpath', (_e, id, p) => files(id).realpath(id, p));
  ipcMain.handle('sftp:stat', (_e, id, p) => files(id).stat(id, p));
  ipcMain.handle('sftp:mkdir', (_e, id, p) => files(id).mkdir(id, p));
  ipcMain.handle('sftp:rename', (_e, id, a, b) => files(id).rename(id, a, b));
  ipcMain.handle('sftp:remove', (_e, id, p, isDir) => files(id).remove(id, p, isDir));
  ipcMain.handle('sftp:chmod', (_e, id, p, mode) => files(id).chmod(id, p, mode));
  ipcMain.handle('sftp:read', (_e, id, p) => files(id).readFile(id, p));
  ipcMain.handle('sftp:write', (_e, id, p, c) => files(id).writeFile(id, p, c));
  ipcMain.handle('sftp:download', async (e, id, remote, local, isDir) => {
    if (!local) {
      const s = store.getSettings();
      const base = s.downloadDir || app.getPath('downloads');
      const name = path.posix.basename(remote);
      if (isDir) {
        const r = await dialogs.showOpenDialog(wof(e), { title: `Download folder "${name}" into…`, defaultPath: base, properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths[0]) return null;
        local = path.join(r.filePaths[0], name);
      } else {
        const r = await dialogs.showSaveDialog(wof(e), { title: 'Download to…', defaultPath: path.join(base, name) });
        if (r.canceled || !r.filePath) return null;
        local = r.filePath;
      }
    }
    return files(id).download(id, remote, local);
  });
  ipcMain.handle('sftp:upload', async (e, id, locals, remoteDir) => {
    if (!locals || !locals.length) {
      const r = await dialogs.showOpenDialog(wof(e), { title: `Upload to ${remoteDir}`, properties: ['openFile', 'openDirectory', 'multiSelections'] });
      if (r.canceled) return [];
      locals = r.filePaths;
    }
    return locals.map((l) => files(id).upload(id, l, remoteDir.replace(/\/$/, '') + '/' + path.basename(l)));
  });
  ipcMain.handle('sftp:cancel', (_e, tid) => { sftp.cancel(tid); ftp.cancel(tid); zmodem.cancel(tid); });
  ipcMain.handle('sftp:transfers', () => [...sftp.listTransfers(), ...ftp.listTransfers(), ...zmodem.listTransfers()]);
  ipcMain.handle('sftp:edit', (_e, id, remote) => files(id).editRemote(id, remote));

  ipcMain.handle('tunnel:start', (_e, spec) => (spec.connId ? tunnels.startForConnection(spec.connId, spec) : tunnels.startStandalone(spec)));
  ipcMain.handle('tunnel:stop', (_e, id) => tunnels.stop(id));
  ipcMain.handle('tunnel:list', () => tunnels.list());

  ipcMain.handle('sessions:list', async () => {
    const d = await store.getSessions();
    return { folders: d.folders, sessions: d.sessions.map(publicSession) };
  });
  // every change to the session tree is announced to the other windows (sessions:changed): they reload the list
  ipcMain.handle('sessions:save', async (e, s) => { const r = publicSession(await store.upsertSession(await mergeSecrets(s))); peers(e, 'sessions:changed'); return r; });
  ipcMain.handle('sessions:save-all', async (e, { sessions, folders }) => {
    const merged = await Promise.all(sessions.map((s) => mergeSecrets(s)));
    const d = await store.saveSessions({ sessions: merged, folders });
    peers(e, 'sessions:changed');
    return { folders: d.folders, sessions: d.sessions.map(publicSession) };
  });
  ipcMain.handle('sessions:delete', async (e, id) => { const r = await store.deleteSession(id); peers(e, 'sessions:changed'); return r; });
  ipcMain.handle('sessions:import-sshconfig', async (e) => {
    const found = importers.parseSshConfig();
    const d = store.loadSessions();
    const existing = new Set(d.sessions.map((s) => `${s.folder}|${s.name}`));
    let n = 0;
    for (const s of found) {
      if (existing.has(`${s.folder}|${s.name}`)) continue;
      await store.upsertSession(s);
      n++;
    }
    if (n) peers(e, 'sessions:changed');
    return { imported: n, found: found.length };
  });
  // Both importers answer { imported, updated, skipped, errors, file } (errors: one line per skipped entry, or the
  // single reason when the file could not be used at all — then imported and skipped are 0; file: the chosen file's
  // name, for "No sessions found in …") for one summary toast.
  ipcMain.handle('sessions:import-moba', async (e) => {
    const r = await dialogs.showOpenDialog(wof(e), { title: 'Select MobaXterm.ini', filters: [{ name: 'MobaXterm settings', extensions: ['ini', 'mxtsessions'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = path.basename(r.filePaths[0]);
    let parsed;
    try {
      parsed = importers.parseMobaXtermIniDetailed(r.filePaths[0]);
    } catch (e) {
      return { imported: 0, updated: 0, skipped: 0, errors: [e.message], file };
    }
    // A bookmark imported before (same folder, name and host) is refreshed in place rather than added again: its
    // connection facts follow the .ini, while its id, saved secrets, icon, colour, tunnels, auth method and a key
    // path set by hand stay. Re-importing the same file is therefore a no-op.
    const keyOf = (s) => `${s.folder}|${s.name}|${s.host || ''}`; // a Shell bookmark (Local session) has no host
    const existing = new Map((await store.getSessions()).sessions.map((s) => [keyOf(s), s]));
    let imported = 0, updated = 0;
    for (const s of parsed.sessions) {
      const old = existing.get(keyOf(s));
      if (!old) {
        existing.set(keyOf(s), await store.upsertSession(s));
        imported++;
        continue;
      }
      const facts = { type: s.type, host: s.host, port: s.port, username: s.username, x11: s.x11, compression: s.compression };
      if (s.privateKeyPath) Object.assign(facts, { privateKeyPath: s.privateKeyPath, notes: s.notes });
      await store.upsertSession({ ...old, ...facts });
      updated++;
    }
    if (imported || updated) peers(e, 'sessions:changed');
    return { imported, updated, skipped: parsed.skipped.length, errors: parsed.skipped.map((x) => `${x.entry}: ${x.reason}`), file };
  });
  // The chosen path on success, null when cancelled, { error } when the file could not be written (a read-only or
  // vanished folder): the renderer shows the reason instead of an unhandled rejection in the console.
  ipcMain.handle('sessions:export', async (e) => {
    const r = await dialogs.showSaveDialog(wof(e), { title: 'Export sessions', defaultPath: path.join(app.getPath('documents'), 'mobalt-sessions.json') });
    if (r.canceled || !r.filePath) return null;
    const d = await store.getSessions();
    try {
      fs.writeFileSync(r.filePath, JSON.stringify({ folders: d.folders, sessions: d.sessions.map(publicSession) }, null, 2));
    } catch (e) {
      return { error: `Could not write ${r.filePath}: ${String(e.message).replace(/, open '[^']*'$/, '')}` }; // "EPERM: operation not permitted"
    }
    return r.filePath;
  });
  ipcMain.handle('sessions:import-json', async (e) => {
    const r = await dialogs.showOpenDialog(wof(e), { title: 'Import sessions JSON', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = path.basename(r.filePaths[0]);
    let parsed;
    try {
      parsed = importers.parseSessionsJson(importers.decodeText(fs.readFileSync(r.filePaths[0]))); // BOM / UTF-16 files like the .ini importer
    } catch (e) {
      parsed = { error: e.message }; // unreadable file
    }
    if (parsed.error) return { imported: 0, updated: 0, skipped: 0, errors: [parsed.error], file };
    let imported = 0, updated = 0;
    for (const s of parsed.sessions) {
      // mergeSecrets drops the exporter's hasPassword/… flags (an export carries no secret) and, for a session already
      // here with the same id that the file has no secret for, keeps the saved one; a password written into the file
      // by hand is taken as is and stored encrypted by the store.
      const known = store.loadSessions().sessions.some((x) => x.id === s.id);
      await store.upsertSession(await mergeSecrets(s));
      if (known) updated++;
      else imported++;
    }
    if (parsed.folders.length) {
      const d = await store.getSessions();
      await store.saveSessions({ sessions: d.sessions, folders: [...new Set([...d.folders, ...parsed.folders])] });
    }
    if (imported || updated || parsed.folders.length) peers(e, 'sessions:changed');
    return { imported, updated, skipped: parsed.skipped.length, errors: parsed.skipped.map((x) => `${x.entry}: ${x.reason}`), file };
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  // the other windows follow a settings change at once (theme, fonts, terminal options): settings:changed carries the result
  ipcMain.handle('settings:set', (e, patch) => { const s = store.setSettings(patch); peers(e, 'settings:changed', s); return s; });

  // The workspace file is written here from two kinds of parts: the main window's tabs (v, activeTab, tabs) and one
  // entry per detached window under `windows` (tabs, activeTab, bounds), each sent by its own renderer; the renderer
  // of a detached window only ever sees its own tabs.
  ipcMain.handle('workspace:get', () => store.getWorkspace());
  ipcMain.on('workspace:save', (e, data) => {
    if (!data || !Array.isArray(data.tabs)) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== win) wsParts.set(w.id, { tabs: data.tabs, activeTab: data.activeTab || 0, bounds: w.isDestroyed() ? undefined : w.getBounds() });
    else wsMain = { v: data.v || 1, activeTab: data.activeTab || 0, tabs: data.tabs };
    try { writeWorkspace(); } catch {}
  });

  // ---------- detached windows (app.js detachTab / adoptTabs) ----------
  // Open a window for `payload` ({ tabs, activeTab, bounds?, restore? }: the serialised tabs, each pane with the id
  // of its live terminal unless `restore`); the payload is handed to that window's renderer once (detach:payload).
  // The window's part of the workspace file is seeded right away: a quit before the new window saves keeps the tabs.
  ipcMain.handle('detach:open', (e, payload) => {
    const key = crypto.randomBytes(6).toString('hex');
    const p = payload && typeof payload === 'object' ? payload : { tabs: [] };
    detachPayloads.set(key, p);
    const w = createWindow({ detached: key, bounds: p.bounds || null, from: wof(e) });
    wsParts.set(w.id, { tabs: Array.isArray(p.tabs) ? p.tabs : [], activeTab: p.activeTab || 0, bounds: w.getBounds() });
    try { writeWorkspace(); } catch {}
    return w.id;
  });
  ipcMain.handle('detach:payload', (_e, key) => {
    const p = detachPayloads.get(key) || null;
    detachPayloads.delete(key);
    return p;
  });
  // A closing detached window hands its tabs back: the main window adopts them (the terminals keep running, their
  // owner switches on term:attach) and the window goes once the renderer confirms (detach:close-done).
  ipcMain.on('detach:return', (e, payload) => {
    const w = wof(e);
    if (w && w !== win) {
      wsParts.delete(w.id);
      try { writeWorkspace(); } catch {}
    }
    if (win && !win.isDestroyed() && payload && Array.isArray(payload.tabs) && payload.tabs.length) {
      win.webContents.send('detach:adopt', payload);
      win.focus();
    }
  });
  ipcMain.on('detach:close-done', (e) => finishClose(wof(e)));

  ipcMain.handle('dialog:open', (e, opts) => dialogs.showOpenDialog(wof(e), opts));
  ipcMain.handle('dialog:save', (e, opts) => dialogs.showSaveDialog(wof(e), opts));
  ipcMain.handle('dialog:message', (e, opts) => dialogs.showMessageBox(wof(e), opts));
  ipcMain.handle('shell:open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:show-item', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:open-path', (_e, p) => shell.openPath(p));

  ipcMain.handle('launch:rdp', (_e, cfg) => {
    const dir = path.join(os.tmpdir(), 'mobalt-rdp');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(cfg.name || cfg.host).replace(/[^\w.-]+/g, '_')}.rdp`);
    const lines = [
      `full address:s:${cfg.host}${cfg.port && cfg.port !== 3389 ? ':' + cfg.port : ''}`,
      `username:s:${cfg.username || ''}`,
      'screen mode id:i:2',
      'use multimon:i:0',
      'session bpp:i:32',
      'audiomode:i:0',
      'redirectclipboard:i:1',
      'authentication level:i:2',
      'prompt for credentials:i:1',
    ];
    fs.writeFileSync(file, lines.join('\r\n') + '\r\n');
    return shell.openPath(file);
  });
  ipcMain.handle('launch:vnc', (_e, cfg) => {
    const user = cfg.username ? encodeURIComponent(cfg.username) + '@' : '';
    return shell.openExternal(`vnc://${user}${cfg.host}:${cfg.port || 5900}`);
  });

  ipcMain.handle('tools:ping', (e, host, count) => tools.ping(wof(e), host, count));
  ipcMain.handle('tools:traceroute', (e, host) => tools.traceroute(wof(e), host));
  ipcMain.handle('tools:portscan', (_e, host, from, to) => tools.portScan(host, from, to));
  ipcMain.handle('tools:lookup', (_e, host) => tools.lookup(host));
  ipcMain.handle('tools:netinfo', () => tools.netinfo());
  ipcMain.handle('tools:stop', (_e, id) => tools.stop(id));
  // Wake-on-LAN and the network scanner (src/main/wol.js, src/main/netscan.js). What fails validation comes back as
  // { error } instead of a rejection, so the renderer shows the message as it is.
  ipcMain.handle('tools:wake', (_e, opts) => wol.wake(opts || {}).then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: e.message })));
  ipcMain.handle('tools:scan-start', (_e, opts = {}) => {
    // one scan at a time: a second start (a double click before the first answered) would run untracked, with no Stop
    if (scans.size) return { error: 'A scan is already running — stop it first' };
    let targets, ports;
    try {
      targets = netscan.expandTargets(opts.target);
      ports = netscan.parsePorts(opts.ports);
    } catch (e) {
      return { error: e.message };
    }
    const clamp = (v, def, min, max) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : def);
    const id = 'scan_' + crypto.randomBytes(4).toString('hex');
    const send = (ev) => win && !win.isDestroyed() && win.webContents.send('tools:scan', { id, ...ev });
    const s = netscan.scan(targets, {
      method: ['ping', 'tcp', 'both'].includes(opts.method) ? opts.method : 'both',
      ports,
      concurrency: clamp(opts.concurrency, 64, 1, 512),
      timeout: clamp(opts.timeout, 600, 50, 10000),
      reverseDns: opts.reverseDns !== false,
    }, send);
    scans.set(id, s);
    s.promise.finally(() => scans.delete(id));
    return { id, total: s.total, ports };
  });
  ipcMain.handle('tools:scan-stop', (_e, id) => {
    const s = scans.get(id);
    if (s) s.cancel();
    return !!s;
  });

  ipcMain.handle('clipboard:write', (_e, t) => clipboard.writeText(t));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

// ---------- lifecycle ----------
// A bug in a background path (e.g. a library throwing synchronously after a connection dropped) must not
// take the whole app down with Electron's crash dialog: log it and tell the renderer.
process.on('uncaughtException', (e) => {
  console.error('uncaught exception:', e);
  try {
    if (win && !win.isDestroyed()) win.webContents.send('app:notice', { level: 'error', text: `Internal error: ${e.message}` });
  } catch {}
});
app.whenReady().then(() => {
  nativeTheme.themeSource = chromeOf(store.getSettings()).scheme; // the applied theme's chrome (app:chrome keeps it current)
  // `npm start` runs the bare Electron binary, which shows Electron's own icon in the Dock; the packaged
  // app gets build/icon.icns from electron-builder. Point the dev Dock tile at the rendered PNG.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const devIcon = path.join(__dirname, '..', '..', 'build', 'icon.png');
    if (fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  }
  registerIpc();
  buildMenu();
  createWindow();
  bundleWatch = startBundleWatch({ getWin: () => win });
  updater = setupUpdater(store, () => win, {
    beforeInstall: () => { quitting = true; }, // "Restart now" never asks again
    diskVersion: () => bundleWatch.diskVersion(), // a release already on disk is not downloaded again…
    bundleOnDisk: (v) => bundleWatch.announce(v), // …the relaunch banner is shown instead
    afterCheck: () => bundleWatch.check(),
    relaunch: () => relaunch(),
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
// ⌘Q / app.quit(): the question is asked here (the window's close handler sees `quitting` already set and
// stays silent); declining cancels the quit and keeps every connection.
app.on('before-quit', (e) => {
  if (!quitting && !confirmQuit()) {
    e.preventDefault();
    return;
  }
  quitting = true;
  for (const s of scans.values()) s.cancel();
  tunnels.stopAll();
  ssh.disconnectAll();
  ftp.disconnectAll();
  registry.killAll();
});
app.on('window-all-closed', () => app.quit());
