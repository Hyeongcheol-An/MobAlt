'use strict';
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Store } = require('./store');
const { TerminalRegistry, spawnLocal, spawnTelnet, spawnSerial, listSerialPorts } = require('./terminals');
const { SshManager } = require('./ssh');
const { SftpManager } = require('./sftp');
const { TunnelManager } = require('./tunnels');
const importers = require('./importers');
const tools = require('./tools');
const x11 = require('./x11');

const pkg = require('../../package.json');
app.setName('MobAlt');
if (process.env.MOBALT_USER_DATA) app.setPath('userData', process.env.MOBALT_USER_DATA); // test isolation
const store = new Store();
const registry = new TerminalRegistry();
let win = null;
let quitting = false;

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
registry.on('exit', (id, code, reason) => {
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
  if (win && !win.isDestroyed()) win.webContents.send('term:exit', id, { code, reason });
});
sftp.on('transfer', (t) => win && !win.isDestroyed() && win.webContents.send('sftp:transfer', t));
sftp.on('edit-synced', (e) => win && !win.isDestroyed() && win.webContents.send('sftp:edit-synced', e));
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
    const active = ssh.conns.size;
    if (active > 0 && store.getSettings().confirmClose) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${active} SSH session${active > 1 ? 's are' : ' is'} still connected. Quit anyway?`,
      });
      if (r === 1) {
        e.preventDefault();
        return;
      }
    }
    quitting = true;
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
    userData: app.getPath('userData'),
    x11Available: x11.isAvailable(),
    display: x11.findDisplay(),
    agent: !!process.env.SSH_AUTH_SOCK,
    electron: process.versions.electron,
  }));
  ipcMain.on('app:quit', () => app.quit());
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
  ipcMain.handle('serial:list', () => listSerialPorts());
  ipcMain.on('term:write', (_e, id, data) => registry.write(id, data));
  ipcMain.on('term:resize', (_e, id, cols, rows) => registry.resize(id, cols, rows));
  ipcMain.on('term:kill', (_e, id) => registry.kill(id));
  ipcMain.handle('term:log-start', (_e, id, name) => {
    const s = store.getSettings();
    const dir = s.logDir || path.join(app.getPath('documents'), 'MobAlt Logs');
    const safe = (name || id).replace(/[^\w.-]+/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return registry.startLog(id, path.join(dir, `${safe}_${stamp}.log`));
  });
  ipcMain.handle('term:log-stop', (_e, id) => registry.stopLog(id));

  ipcMain.handle('ssh:connect', async (_e, cfg, size) => ssh.openShell(await mergeSecrets(cfg), sizeOf(size)));
  ipcMain.handle('ssh:disconnect', (_e, id) => ssh.disconnect(id));
  ipcMain.handle('ssh:exec', (_e, id, cmd) => ssh.exec(id, cmd));

  ipcMain.handle('sftp:list', (_e, id, dir) => sftp.list(id, dir));
  ipcMain.handle('sftp:home', (_e, id) => sftp.home(id));
  ipcMain.handle('sftp:realpath', (_e, id, p) => sftp.realpath(id, p));
  ipcMain.handle('sftp:stat', (_e, id, p) => sftp.stat(id, p));
  ipcMain.handle('sftp:mkdir', (_e, id, p) => sftp.mkdir(id, p));
  ipcMain.handle('sftp:rename', (_e, id, a, b) => sftp.rename(id, a, b));
  ipcMain.handle('sftp:remove', (_e, id, p, isDir) => sftp.remove(id, p, isDir));
  ipcMain.handle('sftp:chmod', (_e, id, p, mode) => sftp.chmod(id, p, mode));
  ipcMain.handle('sftp:read', (_e, id, p) => sftp.readFile(id, p));
  ipcMain.handle('sftp:write', (_e, id, p, c) => sftp.writeFile(id, p, c));
  ipcMain.handle('sftp:download', async (_e, id, remote, local, isDir) => {
    if (!local) {
      const s = store.getSettings();
      const base = s.downloadDir || app.getPath('downloads');
      const name = path.posix.basename(remote);
      if (isDir) {
        const r = await dialog.showOpenDialog(win, { title: `Download folder "${name}" into…`, defaultPath: base, properties: ['openDirectory', 'createDirectory'] });
        if (r.canceled || !r.filePaths[0]) return null;
        local = path.join(r.filePaths[0], name);
      } else {
        const r = await dialog.showSaveDialog(win, { title: 'Download to…', defaultPath: path.join(base, name) });
        if (r.canceled || !r.filePath) return null;
        local = r.filePath;
      }
    }
    return sftp.download(id, remote, local);
  });
  ipcMain.handle('sftp:upload', async (_e, id, locals, remoteDir) => {
    if (!locals || !locals.length) {
      const r = await dialog.showOpenDialog(win, { title: `Upload to ${remoteDir}`, properties: ['openFile', 'openDirectory', 'multiSelections'] });
      if (r.canceled) return [];
      locals = r.filePaths;
    }
    return locals.map((l) => sftp.upload(id, l, remoteDir.replace(/\/$/, '') + '/' + path.basename(l)));
  });
  ipcMain.handle('sftp:cancel', (_e, tid) => sftp.cancel(tid));
  ipcMain.handle('sftp:transfers', () => sftp.listTransfers());
  ipcMain.handle('sftp:edit', (_e, id, remote) => sftp.editRemote(id, remote));

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
  ipcMain.handle('sessions:import-moba', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Select MobaXterm.ini', filters: [{ name: 'MobaXterm settings', extensions: ['ini', 'mxtsessions'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const found = importers.parseMobaXtermIni(r.filePaths[0]);
    let n = 0;
    for (const s of found) {
      await store.upsertSession(s);
      n++;
    }
    return { imported: n, found: found.length };
  });
  ipcMain.handle('sessions:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export sessions', defaultPath: path.join(app.getPath('documents'), 'mobalt-sessions.json') });
    if (r.canceled || !r.filePath) return null;
    const d = await store.getSessions();
    fs.writeFileSync(r.filePath, JSON.stringify({ folders: d.folders, sessions: d.sessions.map(publicSession) }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('sessions:import-json', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import sessions JSON', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    let n = 0;
    for (const s of data.sessions || []) {
      if (!s.name) continue;
      await store.upsertSession({ ...s, id: s.id || crypto.randomUUID() });
      n++;
    }
    const d = await store.getSessions();
    const folders = new Set([...(d.folders || []), ...((data.folders || []).filter(Boolean))]);
    await store.saveSessions({ sessions: d.sessions, folders: [...folders] });
    return { imported: n };
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));

  ipcMain.handle('dialog:open', (_e, opts) => dialog.showOpenDialog(win, opts));
  ipcMain.handle('dialog:save', (_e, opts) => dialog.showSaveDialog(win, opts));
  ipcMain.handle('dialog:message', (_e, opts) => dialog.showMessageBox(win, opts));
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
nativeTheme.themeSource = 'dark';
app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', () => {
  quitting = true;
  tunnels.stopAll();
  ssh.disconnectAll();
  registry.killAll();
});
app.on('window-all-closed', () => app.quit());
