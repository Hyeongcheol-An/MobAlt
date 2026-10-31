'use strict';
// Persistence for sessions, settings, macros. Secrets are encrypted at rest
// with Electron safeStorage (backed by the macOS Keychain) using the async API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// Outside Electron (unit tests) require('electron') yields the binary path string, or throws when the
// Electron binary is not installed (CI runners without the download); neither is needed there.
let electron = null;
try { electron = require('electron'); } catch { electron = null; }
const { app, safeStorage } = electron && typeof electron === 'object' ? electron : {};

const SECRET_FIELDS = ['password', 'passphrase', 'jumpPassword'];

function userDataFile(name) {
  const dir = app ? app.getPath('userData') : process.env.MOBALT_USER_DATA || path.join(os.tmpdir(), 'mobalt-userdata');
  return path.join(dir, name);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let encryptionAvailable = null;
async function canEncrypt() {
  if (!safeStorage) return false;
  if (encryptionAvailable === null) {
    try {
      encryptionAvailable = typeof safeStorage.isAsyncEncryptionAvailable === 'function'
        ? await safeStorage.isAsyncEncryptionAvailable()
        : safeStorage.isEncryptionAvailable();
    } catch {
      encryptionAvailable = false;
    }
  }
  return encryptionAvailable;
}

async function encrypt(plain) {
  if (!plain) return '';
  if (await canEncrypt()) {
    const buf = typeof safeStorage.encryptStringAsync === 'function' ? await safeStorage.encryptStringAsync(plain) : safeStorage.encryptString(plain);
    return 'enc:' + buf.toString('base64');
  }
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}

async function decrypt(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    if (!safeStorage) return '';
    try {
      const buf = Buffer.from(stored.slice(4), 'base64');
      if (typeof safeStorage.decryptStringAsync === 'function') {
        const r = await safeStorage.decryptStringAsync(buf);
        return typeof r === 'string' ? r : r.result;
      }
      return safeStorage.decryptString(buf);
    } catch {
      return '';
    }
  }
  if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  return stored; // legacy plain
}

const DEFAULT_SETTINGS = {
  fontFamily: 'Menlo, "SF Mono", "JetBrains Mono", "Fira Code", monospace',
  fontSize: 13,
  lineHeight: 1.0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  theme: 'moba-dark',
  rightClickPaste: true,
  copyOnSelect: true,
  macOptionIsMeta: true, // Option key acts as Meta/Alt (xterm macOptionIsMeta); what Settings shows before the first Save
  pasteConfirmMultiline: true, // Settings → Terminal → Paste guard: ask before a multi-line or very long paste reaches a terminal
  pasteWarnSuspicious: true, // … and show what a paste hides (invisible characters, curl | sh, profile writes…) with "Paste cleaned"
  bell: 'none',
  localShell: '',
  localShellArgs: ['-l'],
  localShellIntegration: true,
  editorCommand: '',
  confirmClose: true,
  sidebarWidth: 280,
  sidebarVisible: true,
  sidebarTab: 'sessions',
  sftpAutoOpen: true,
  restoreWorkspace: true,
  autoUpdate: true,
  downloadDir: '',
  logDir: '',
  logPlainText: false,
  keepAliveInterval: 30,
  readyTimeout: 20000,
  monitorBar: true, // remote monitoring bar under SSH panes (a session's own setting wins; a pane can be toggled by hand)
  monitorInterval: 3, // seconds between two polls of the bar (2–30)
  highlightEnabled: true, // Settings → Terminal → Keyword highlighting (a session can override it: on / off)
  highlightRules: null, // the rule table; null = the built-in rules (src/renderer/highlight.js DEFAULT_RULES), so a fresh install follows their updates
  macros: [],
  tunnels: [],
  windowBounds: null,
  chrome: null, // { background, scheme } of the applied theme's chrome palette: the window and the native theme start in it (main.js)
  recentSessions: [],
};

class Store {
  constructor() {
    this._sessions = null;
    this._settings = null;
  }

  // Resolved lazily so app.setPath('userData') can run first.
  get sessionsFile() {
    return userDataFile('sessions.json');
  }

  get settingsFile() {
    return userDataFile('settings.json');
  }

  get workspaceFile() {
    return userDataFile('workspace.json');
  }

  // ---- workspace (open tabs / split layout; no secrets, session refs by id) ----
  getWorkspace() {
    return readJson(this.workspaceFile, null);
  }

  saveWorkspace(data) {
    if (!data || !Array.isArray(data.tabs)) return;
    writeJson(this.workspaceFile, data);
  }

  // ---- sessions (stored form: secrets encrypted) ----
  loadSessions() {
    if (!this._sessions) {
      const data = readJson(this.sessionsFile, { sessions: [], folders: [] });
      this._sessions = {
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        folders: Array.isArray(data.folders) ? data.folders : [],
      };
    }
    return this._sessions;
  }

  /** Sessions with secrets decrypted (for in-memory use). */
  async getSessions() {
    const d = this.loadSessions();
    return {
      folders: d.folders.slice(),
      sessions: await Promise.all(d.sessions.map((s) => this._decryptSession(s))),
    };
  }

  async getSession(id) {
    const s = this.loadSessions().sessions.find((x) => x.id === id);
    return s ? this._decryptSession(s) : null;
  }

  /** Replace all sessions/folders. Input sessions carry plain secrets (or none). */
  async saveSessions({ sessions, folders }) {
    const enc = await Promise.all(sessions.map((s) => this._encryptSession(s)));
    this._sessions = { sessions: enc, folders: folders || [] };
    writeJson(this.sessionsFile, this._sessions);
    return this.getSessions();
  }

  async upsertSession(session) {
    const d = this.loadSessions();
    if (!session.id) session.id = crypto.randomUUID();
    const idx = d.sessions.findIndex((s) => s.id === session.id);
    const enc = await this._encryptSession(session);
    if (idx >= 0) d.sessions[idx] = enc;
    else d.sessions.push(enc);
    writeJson(this.sessionsFile, d);
    return this._decryptSession(enc);
  }

  deleteSession(id) {
    const d = this.loadSessions();
    d.sessions = d.sessions.filter((s) => s.id !== id);
    writeJson(this.sessionsFile, d);
  }

  async _encryptSession(s) {
    const out = { ...s };
    for (const f of SECRET_FIELDS) {
      if (out[f]) out[f] = await encrypt(out[f]);
      else delete out[f];
    }
    return out;
  }

  async _decryptSession(s) {
    const out = { ...s };
    for (const f of SECRET_FIELDS) {
      if (out[f]) out[f] = await decrypt(out[f]);
    }
    return out;
  }

  // ---- settings (no secrets, synchronous) ----
  getSettings() {
    if (!this._settings) {
      this._settings = { ...DEFAULT_SETTINGS, ...readJson(this.settingsFile, {}) };
    }
    return this._settings;
  }

  setSettings(patch) {
    this._settings = { ...this.getSettings(), ...patch };
    writeJson(this.settingsFile, this._settings);
    return this._settings;
  }
}

/**
 * The chrome the renderer applied (app:chrome), as it is remembered in the settings and handed to the next launch:
 * `{ background: '#rrggbb', scheme: 'dark'|'light', theme?: name, vars?: { '--bg': '#rrggbb', … } }`. `vars` are the
 * palette's CSS custom properties (colours, or the two alphas like '.4'); the preload puts them on <html> before the
 * first paint. Anything that is not a chrome is null; a `vars` map keeps only well-formed entries.
 */
function validChrome(c) {
  if (!c || typeof c !== 'object' || !/^#[0-9a-f]{6}$/i.test(String(c.background)) || (c.scheme !== 'dark' && c.scheme !== 'light')) return null;
  const out = { background: String(c.background).toLowerCase(), scheme: c.scheme };
  if (typeof c.theme === 'string' && /^[a-z0-9-]{1,40}$/.test(c.theme)) out.theme = c.theme;
  if (c.vars && typeof c.vars === 'object' && !Array.isArray(c.vars)) {
    const vars = {};
    for (const [k, v] of Object.entries(c.vars)) {
      if (/^--[a-z][a-z0-9-]{0,40}$/.test(k) && /^(#[0-9a-f]{6}|0?\.\d{1,3}|[01])$/i.test(String(v))) vars[k] = String(v).toLowerCase();
    }
    if (Object.keys(vars).length) out.vars = vars;
  }
  return out;
}

module.exports = { Store, DEFAULT_SETTINGS, encrypt, decrypt, userDataFile, validChrome };
