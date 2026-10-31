'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Store } = require('./store');
const { TerminalRegistry, spawnLocal, spawnTelnet, spawnSerial, listSerialPorts, spawnMosh } = require('./terminals');
const { SshManager } = require('./ssh');
const { SftpManager } = require('./sftp');
const { FtpManager } = require('./ftp');
const { setupUpdater } = require('./updater');
const { TunnelManager } = require('./tunnels');
const importers = require('./importers');
const tools = require('./tools');
const x11 = require('./x11');
const knownhosts = require('./knownhosts');
const { liveConnections, quitQuestion } = require('./live');
const { startBundleWatch, relaunchOptions } = require('./bundlewatch');
const dialogs = require('./dialogs'); // native dialogs; answered from the queue in test mode

const pkg = require('../../package.json');
app.setName('MobAlt');
if (process.env.MOBALT_USER_DATA) app.setPath('userData', process.env.MOBALT_USER_DATA); // test isolation
const store = new Store();
const registry = new TerminalRegistry();
let win = null;
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

// ---------- renderer prompts (host key / password / keyboard-interactive) ----------
const pendingPrompts = new Map();
function prompt(kind, payload) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const reqId = crypto.randomBytes(6).toString('hex');
    pendingPrompts.set(reqId, resolve);
    win.webContents.send('prompt:request', { reqId, kind, payload });
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
  status: (id, state, msg) => win && !win.isDestroyed() && win.webContents.send('ssh:status', { id, state, msg }),
};

const ssh = new SshManager(registry, store, prompter);
const sftp = new SftpManager(ssh, store);
const ftp = new FtpManager(store, prompter);
let updater = null;
const tunnels = new TunnelManager(ssh, store);

// ---------- terminal output: coalesce chunks per terminal before IPC ----------
const outBuf = new Map();
let flushTimer = null;
registry.on('data', (id, data) => {
  outBuf.set(id, (outBuf.get(id) || '') + data);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!win || win.isDestroyed()) return outBuf.clear();
      for (const [tid, text] of outBuf) win.webContents.send('term:data', tid, text);
      outBuf.clear();
    }, 4);
  }
});
registry.on('exit', (id, code, reason, detail) => {
  const flush = () => {
    const text = outBuf.get(id);
    if (text && win && !win.isDestroyed()) {
      win.webContents.send('term:data', id, text);
      outBuf.delete(id);
    }
  };
  flush();
  tunnels.stopForConnection(id);
  sftp.stopEdits(id);
  if (win && !win.isDestroyed()) win.webContents.send('term:exit', id, { code, reason, detail });
});
sftp.on('transfer', (t) => win && !win.isDestroyed() && win.webContents.send('sftp:transfer', t));
sftp.on('edit-synced', (e) => win && !win.isDestroyed() && win.webContents.send('sftp:edit-synced', e));
ftp.on('transfer', (t) => win && !win.isDestroyed() && win.webContents.send('sftp:transfer', t));
ftp.on('edit-synced', (e) => win && !win.isDestroyed() && win.webContents.send('sftp:edit-synced', e));
tunnels.on('changed', (list) => win && !win.isDestroyed() && win.webContents.send('tunnels:changed', list));

// ---------- window ----------
function createWindow() {
  const settings = store.getSettings();
  const bounds = settings.windowBounds || { width: 1400, height: 880 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 560,
    title: 'MobAlt',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#1e1f22',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    store.setSettings({ windowBounds: win.getBounds() });
  };
  win.on('resize', debounce(saveBounds, 500));
  win.on('move', debounce(saveBounds, 500));
  win.on('close', (e) => {
    if (quitting) return;
    if (!confirmQuit()) {
      e.preventDefault();
      return;
    }
    quitting = true; // closing the only window quits the app (window-all-closed): no second question
  });
  win.on('closed', () => (win = null));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => runTestHooks());
  if (process.env.MOBALT_SCREENSHOT || process.env.MOBALT_TEST_SCRIPT) {
    win.webContents.on('console-message', (e) => {
      const d = e.level !== undefined ? e : { level: e, message: arguments[2] };
      console.log(`[renderer:${d.level}] ${d.message}${d.sourceId ? ` (${d.sourceId}:${d.lineNumber})` : ''}`);
    });
  }
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
  if (win && !win.isDestroyed()) win.webContents.send('menu:action', { action, arg });
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
        { label: 'Close Tab', accelerator: 'Cmd+W', click: () => sendAction('close') },
        { type: 'separator' },
        { label: 'Import from ~/.ssh/config', click: () => sendAction('import-sshconfig') },
        { label: 'Import from MobaXterm.ini…', click: () => sendAction('import-moba') },
        { label: 'Import Sessions (JSON)…', click: () => sendAction('import-json') },
        { label: 'Export Sessions (JSON)…', click: () => sendAction('export-json') },
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
  }));
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle('app:relaunch', () => relaunch());
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
  ipcMain.handle('app:screenshot', async (_e, name) => {
    if (!process.env.MOBALT_TEST_SCRIPT) return null; // test mode only
    const dir = process.env.MOBALT_SHOT_DIR || os.tmpdir();
    const img = await win.webContents.capturePage();
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('screenshot', file);
    return file;
  });

  ipcMain.handle('term:spawn-local', (_e, opts) => spawnLocal(registry, store.getSettings(), { ...opts, ...sizeOf(opts) }));
  ipcMain.handle('term:spawn-telnet', (_e, opts) => spawnTelnet(registry, { ...opts, ...sizeOf(opts) }));
  ipcMain.handle('term:spawn-serial', (_e, opts) => spawnSerial(registry, opts));
  // Mosh bootstraps over an external ssh: the host key goes through the app's own prompt first and the
  // bootstrap then runs strictly against the app's known_hosts file (never ~/.ssh/known_hosts).
  ipcMain.handle('term:spawn-mosh', async (_e, opts) => {
    const v = await ssh.verifyHost({ name: opts.name, host: opts.host, port: opts.port || 22, username: opts.username, legacyAlgorithms: opts.legacyAlgorithms });
    if (!v.ok) throw new Error(v.error || 'host key not accepted');
    return spawnMosh(registry, store.getSettings(), { ...opts, ...sizeOf(opts), knownHostsFile: knownhosts.file() });
  });
  ipcMain.handle('ftp:connect', async (_e, cfg) => ftp.connect(await mergeSecrets(cfg)));
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

  ipcMain.handle('ssh:connect', async (_e, cfg, size) => ssh.openShell(await mergeSecrets(cfg), sizeOf(size)));
  // shell-less connection for the Sftp panel of a Mosh pane (same prompts; ssh:status events carry its state)
  ipcMain.handle('ssh:connect-sftp', async (_e, cfg) => ssh.openSftpOnly(await mergeSecrets(cfg)));
  ipcMain.handle('ssh:disconnect', (_e, id) => ssh.disconnect(id));
  ipcMain.handle('ssh:exec', (_e, id, cmd) => ssh.exec(id, cmd));

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
  ipcMain.handle('sftp:download', async (_e, id, remote, local, isDir) => {
    if (!local) {
      const s = store.getSettings();
      const base = s.downloadDir || app.getPath('downloads');
      const name = path.posix.basename(remote);
      if (isDir) {
        const r = await dialogs.showOpenDialog(win, { title: `Download folder "${name}" into…`, defaultPath: base, properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths[0]) return null;
        local = path.join(r.filePaths[0], name);
      } else {
        const r = await dialogs.showSaveDialog(win, { title: 'Download to…', defaultPath: path.join(base, name) });
        if (r.canceled || !r.filePath) return null;
        local = r.filePath;
      }
    }
    return files(id).download(id, remote, local);
  });
  ipcMain.handle('sftp:upload', async (_e, id, locals, remoteDir) => {
    if (!locals || !locals.length) {
      const r = await dialogs.showOpenDialog(win, { title: `Upload to ${remoteDir}`, properties: ['openFile', 'openDirectory', 'multiSelections'] });
      if (r.canceled) return [];
      locals = r.filePaths;
    }
    return locals.map((l) => files(id).upload(id, l, remoteDir.replace(/\/$/, '') + '/' + path.basename(l)));
  });
  ipcMain.handle('sftp:cancel', (_e, tid) => { sftp.cancel(tid); ftp.cancel(tid); });
  ipcMain.handle('sftp:transfers', () => [...sftp.listTransfers(), ...ftp.listTransfers()]);
  ipcMain.handle('sftp:edit', (_e, id, remote) => files(id).editRemote(id, remote));

  ipcMain.handle('tunnel:start', (_e, spec) => (spec.connId ? tunnels.startForConnection(spec.connId, spec) : tunnels.startStandalone(spec)));
  ipcMain.handle('tunnel:stop', (_e, id) => tunnels.stop(id));
  ipcMain.handle('tunnel:list', () => tunnels.list());

  ipcMain.handle('sessions:list', async () => {
    const d = await store.getSessions();
    return { folders: d.folders, sessions: d.sessions.map(publicSession) };
  });
  ipcMain.handle('sessions:save', async (_e, s) => publicSession(await store.upsertSession(await mergeSecrets(s))));
  ipcMain.handle('sessions:save-all', async (_e, { sessions, folders }) => {
    const merged = await Promise.all(sessions.map((s) => mergeSecrets(s)));
    const d = await store.saveSessions({ sessions: merged, folders });
    return { folders: d.folders, sessions: d.sessions.map(publicSession) };
  });
  ipcMain.handle('sessions:delete', (_e, id) => store.deleteSession(id));
  ipcMain.handle('sessions:import-sshconfig', async () => {
    const found = importers.parseSshConfig();
    const d = store.loadSessions();
    const existing = new Set(d.sessions.map((s) => `${s.folder}|${s.name}`));
    let n = 0;
    for (const s of found) {
      if (existing.has(`${s.folder}|${s.name}`)) continue;
      await store.upsertSession(s);
      n++;
    }
    return { imported: n, found: found.length };
  });
  // Both importers answer { imported, updated?, skipped, errors } (errors: one line per skipped entry, or the single
  // reason when the file could not be used at all — then imported and skipped are 0) for one summary toast.
  ipcMain.handle('sessions:import-moba', async () => {
    const r = await dialogs.showOpenDialog(win, { title: 'Select MobaXterm.ini', filters: [{ name: 'MobaXterm settings', extensions: ['ini', 'mxtsessions'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let parsed;
    try {
      parsed = importers.parseMobaXtermIniDetailed(r.filePaths[0]);
    } catch (e) {
      return { imported: 0, updated: 0, skipped: 0, errors: [e.message] };
    }
    // A bookmark imported before (same folder, name and host) is refreshed in place rather than added again: its
    // connection facts follow the .ini, while its id, saved secrets, icon, colour, tunnels, auth method and a key
    // path set by hand stay. Re-importing the same file is therefore a no-op.
    const keyOf = (s) => `${s.folder}|${s.name}|${s.host}`;
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
    return { imported, updated, skipped: parsed.skipped.length, errors: parsed.skipped.map((x) => `${x.entry}: ${x.reason}`) };
  });
  ipcMain.handle('sessions:export', async () => {
    const r = await dialogs.showSaveDialog(win, { title: 'Export sessions', defaultPath: path.join(app.getPath('documents'), 'mobalt-sessions.json') });
    if (r.canceled || !r.filePath) return null;
    const d = await store.getSessions();
    fs.writeFileSync(r.filePath, JSON.stringify({ folders: d.folders, sessions: d.sessions.map(publicSession) }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('sessions:import-json', async () => {
    const r = await dialogs.showOpenDialog(win, { title: 'Import sessions JSON', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let parsed;
    try {
      parsed = importers.parseSessionsJson(fs.readFileSync(r.filePaths[0], 'utf8'));
    } catch (e) {
      parsed = { error: e.message }; // unreadable file
    }
    if (parsed.error) return { imported: 0, skipped: 0, errors: [parsed.error] };
    let n = 0;
    for (const s of parsed.sessions) {
      // mergeSecrets drops the exporter's hasPassword/… flags (an export carries no secret) and, for a session already
      // here with the same id that the file has no secret for, keeps the saved one; a password written into the file
      // by hand is taken as is and stored encrypted by the store.
      await store.upsertSession(await mergeSecrets(s));
      n++;
    }
    if (parsed.folders.length) {
      const d = await store.getSessions();
      await store.saveSessions({ sessions: d.sessions, folders: [...new Set([...d.folders, ...parsed.folders])] });
    }
    return { imported: n, skipped: parsed.skipped.length, errors: parsed.skipped.map((x) => `${x.entry}: ${x.reason}`) };
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));

  ipcMain.handle('workspace:get', () => store.getWorkspace());
  ipcMain.on('workspace:save', (_e, data) => {
    try { store.saveWorkspace(data); } catch {}
  });

  ipcMain.handle('dialog:open', (_e, opts) => dialogs.showOpenDialog(win, opts));
  ipcMain.handle('dialog:save', (_e, opts) => dialogs.showSaveDialog(win, opts));
  ipcMain.handle('dialog:message', (_e, opts) => dialogs.showMessageBox(win, opts));
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

  ipcMain.handle('tools:ping', (_e, host, count) => tools.ping(win, host, count));
  ipcMain.handle('tools:traceroute', (_e, host) => tools.traceroute(win, host));
  ipcMain.handle('tools:portscan', (_e, host, from, to) => tools.portScan(host, from, to));
  ipcMain.handle('tools:lookup', (_e, host) => tools.lookup(host));
  ipcMain.handle('tools:netinfo', () => tools.netinfo());
  ipcMain.handle('tools:stop', (_e, id) => tools.stop(id));

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
nativeTheme.themeSource = 'dark';
app.whenReady().then(() => {
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
  tunnels.stopAll();
  ssh.disconnectAll();
  ftp.disconnectAll();
  registry.killAll();
});
app.on('window-all-closed', () => app.quit());
