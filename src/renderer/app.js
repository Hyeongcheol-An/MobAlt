// Application controller: wires main-process events, toolbar/menu actions, panes, panels and dialogs.
import { TYPE_LABEL, $, $$, h, toast, confirmDialog, promptDialog, parseQuickConnect, anyModalOpen, modalsShown, contextMenu, icon, applyIcons, ipcMessage, fillNodes } from './ui.js';
import { TermPane, THEMES, searchDecorations } from './terminal.js';
import { chromePalette, cssVars } from './theme.js';
import { Workspace } from './layout.js';
import { SessionTree } from './sidebar.js';
import { SftpPanel } from './sftp.js';
import { ToolsPanel, MacrosPanel } from './panels.js';
import { sessionEditor, settingsDialog, tunnelsDialog, hostKeyDialog, passwordDialog, kbdIntDialog, shortcutsDialog, pasteGuardDialog, keygenDialog } from './dialogs.js';
import { analysePaste, pasteGuardMode } from './pasteguard.js';
import { t, tn, translateDom, setLocale, locale as currentLocale, resolveSetting } from './i18n.js';

translateDom(document); // the static labels of index.html, before anything else is rendered (the preload fetched the dictionary)

/** Long paths keep their tail (the leaf folder is what matters in a status bar). */
const shortPath = (p) => (!p ? '' : p.length > 56 ? '…' + p.slice(-55) : p);

/** Pane kind for a session type (rdp/vnc never get a pane). */
const kindOf = (type) => ({ local: 'local', telnet: 'telnet', serial: 'serial', mosh: 'mosh', ftp: 'ftp' }[type] || 'ssh');

/** A pane's / SFTP companion's state (terminal.js: idle | connecting | connected | failed | disconnected) as the status bar words it. */
const stateLabel = (s) => s === 'connected' ? t('connected') : s === 'connecting' ? t('connecting') : s === 'failed' ? t('failed') : s === 'disconnected' ? t('disconnected') : s === 'idle' ? t('idle') : String(s || '');

class App {
  constructor() {
    this.settings = null;
    this.sessions = { sessions: [], folders: [] };
    this.info = {};
    this.panesByTerm = new Map();
    this.multiexec = false;
    this.macroRecorder = null;
    this.focused = null;
    this.updateOnDisk = null; // version of the MobAlt.app on disk when it differs from the running one
    this.updateDismissed = null; // "Later" on the banner: that version stays quiet until another shows up
    this.detached = false; // a window opened for tabs moved out of another one (detachTab): same page, sidebar out of the way
  }

  async init() {
    applyIcons(); // static toolbar / panel buttons carry data-icon hooks
    document.addEventListener('i18n:changed', () => this.onLanguageChanged()); // a switch at run time: what app.js renders itself
    // algorithms: ssh2's defaults / supported names / legacy additions for the session editor's Advanced SSH lists
    [this.settings, this.sessions, this.info, this.algorithms] = await Promise.all([window.api.settings.get(), window.api.sessions.list(), window.api.app.info(), window.api.ssh.algorithms().catch(() => null)]);
    const detachedKey = typeof window.api.app.detachedKey === 'function' ? window.api.app.detachedKey() : null;
    this.detached = !!detachedKey;
    if (this.detached) document.body.classList.add('detached');
    this._applyTheme();
    document.documentElement.style.setProperty('--sidebar-w', (this.settings.sidebarWidth || 280) + 'px');
    this.workspace = new Workspace(this);
    this.sessionTree = new SessionTree(this);
    this.sftpPanel = new SftpPanel(this);
    this.toolsPanel = new ToolsPanel(this);
    this.macrosPanel = new MacrosPanel(this);
    this.sessionTree.render();
    this.wireEvents();
    this.wireUi();
    $('#st-version').textContent = `MobAlt ${this.info.version}`;
    $('#st-x11').classList.toggle('on', !!this.info.x11Available);
    $('#st-x11').title = this.info.x11Available ? t('Local X server: {display}', { display: this.info.display }) : t('No X server found (install XQuartz for X11 forwarding)');
    if (!this.settings.sidebarVisible) $('#sidebar').classList.add('collapsed');
    this._syncSidebarToggle();
    this.showPanel(this.settings.sidebarTab || 'sessions');
    if (this.detached) { // a detached window starts with the sidebar out of the way (⌘B brings it back, in this window only)
      $('#sidebar').classList.add('collapsed');
      this._syncSidebarToggle();
    }
    let restored = false;
    if (this.detached) {
      // the tabs this window was opened for: live terminals to take over (detachTab), or saved tabs to start afresh (restore)
      const payload = await window.api.detach.payload(detachedKey).catch(() => null);
      if (payload) {
        try { restored = await this.adoptTabs(payload, { attach: !payload.restore, quiet: true }); } catch (e) { console.error('detached tabs failed', e); }
      }
    } else if (this.settings.restoreWorkspace !== false) {
      try { restored = await this.restoreWorkspace(); } catch (e) { console.error('workspace restore failed', e); }
    }
    if (!restored) await this.newLocalTab();
    this._wsReady = true;
    this.saveWorkspaceSoon();
    setInterval(() => this.saveWorkspaceNow(), 20000);
    window.addEventListener('beforeunload', () => this.saveWorkspaceNow());
  }

  // ---------- workspace persistence (tabs + split layout; survives restarts/updates) ----------
  /**
   * A tab as the workspace file describes it (sessions by id, an ad-hoc session inline without its secrets, a local
   * shell's folder, the split tree, the pin, the zoomed pane). `live` adds what another window needs to take the tab
   * over (TermPane.transferState: the terminal ids and the state the backend does not know).
   */
  serializeTab(t, live = false) {
    const serPane = (p) => {
      const d = { kind: p.kind };
      if (p.session) {
        if (p.session.id) d.sessionId = p.session.id;
        else {
          // ad-hoc (quick connect) session: inline it, never its secrets
          const c = { ...p.session };
          delete c.password; delete c.passphrase; delete c.jumpPassword;
          d.session = c;
        }
      }
      if (p.kind === 'local' && p.cwd) d.cwd = p.cwd;
      if (live) Object.assign(d, p.transferState());
      return d;
    };
    const ser = (n) => n.type === 'pane'
      ? { t: 'pane', ...serPane(n.pane) }
      : { t: 'split', dir: n.dir, ratio: n.ratio, children: n.children.map(ser) };
    return {
      title: t.title,
      autoTitle: t.autoTitle,
      color: t.color || null,
      icon: t.icon || null,
      ...(t.pinned ? { pinned: true } : {}),
      active: Math.max(0, t.panes().indexOf(t.activePane)),
      ...(t.zoomed && t.panes().includes(t.zoomed) ? { zoomed: t.panes().indexOf(t.zoomed) } : {}), // the pane filling the tab (⇧⌘⏎)
      root: ser(t.root),
    };
  }

  /** This window's tabs; main merges the main window's part with one entry per detached window (`windows`). */
  serializeWorkspace() {
    return {
      v: 1,
      activeTab: Math.max(0, this.workspace.tabs.indexOf(this.workspace.active)),
      tabs: this.workspace.tabs.filter((t) => t.root).map((t) => this.serializeTab(t)),
    };
  }

  saveWorkspaceSoon() {
    if (!this._wsReady) return;
    clearTimeout(this._wsTimer);
    this._wsTimer = setTimeout(() => this.saveWorkspaceNow(), 800);
  }

  saveWorkspaceNow() {
    if (!this._wsReady) return;
    clearTimeout(this._wsTimer);
    this._wsTimer = null;
    try { window.api.workspace.save(this.serializeWorkspace()); } catch {}
  }

  /**
   * Rebuild tabs/panes from the saved workspace: terminals reconnect (SSH) or start fresh shells (local). Tabs that
   * were in windows of their own (`windows`) come back as windows, started afresh the same way. True when this
   * window got a tab.
   */
  async restoreWorkspace() {
    const saved = await window.api.workspace.get();
    if (!saved) return false;
    const any = Array.isArray(saved.tabs) && saved.tabs.length ? await this.buildTabs(saved) : false;
    const windows = Array.isArray(saved.windows) ? saved.windows.filter((w) => w && Array.isArray(w.tabs) && w.tabs.length) : [];
    for (const w of windows) window.api.detach.open({ tabs: w.tabs, activeTab: w.activeTab || 0, bounds: w.bounds || null, restore: true }).catch((e) => console.error('detached window restore failed', e));
    return any;
  }

  /**
   * Make tabs from their descriptions (serializeTab: the workspace file, or the tabs of a window transfer). Every
   * pane starts its terminal afresh, unless `attach`: then a pane names a live terminal and takes it over
   * (TermPane.attach), and a dead one stays dead. Returns true when a tab was made.
   */
  async buildTabs(desc, { attach = false } = {}) {
    const makePane = (d) => {
      let session = null;
      if (d.sessionId) session = this.sessions.sessions.find((s) => s.id === d.sessionId) || null;
      else if (d.session) session = d.session;
      let kind = d.kind;
      if (!attach && kind !== 'local' && kind !== 'empty' && !session) kind = 'empty'; // session was deleted (a live terminal keeps its pane)
      if (kind === 'rdp' || kind === 'vnc') kind = 'empty';
      const pane = new TermPane(this, { kind, session, cwd: d.cwd || session?.cwd || undefined });
      if (attach && kind !== 'empty') pane._transfer = d;
      return pane;
    };
    const build = (n) => (n.t === 'split' && Array.isArray(n.children) && n.children.length === 2)
      ? { type: 'split', dir: n.dir === 'v' ? 'v' : 'h', ratio: Math.min(0.9, Math.max(0.1, n.ratio || 0.5)), children: n.children.map(build) }
      : { type: 'pane', pane: makePane(n) };
    const made = [];
    const starts = [];
    for (const td of desc.tabs) {
      if (!td || !td.root) continue;
      let root;
      try { root = build(td.root); } catch { continue; }
      const panes = [];
      (function walk(n) { n.type === 'pane' ? panes.push(n.pane) : n.children.forEach(walk); })(root);
      if (!panes.length) continue;
      const tab = this.workspace.newTab(panes[0], td.title || panes[0].title);
      tab.autoTitle = td.autoTitle !== false;
      if (td.title) tab.title = td.title; // newTab's focus may have named the tab after panes[0]'s session: the saved name stands (for good when it was typed)
      tab.color = td.color || null;
      tab.icon = td.icon || null;
      tab.pinned = td.pinned === true;
      tab.root = root;
      for (const p of panes) p.tab = tab;
      tab.activePane = panes[Math.min(td.active || 0, panes.length - 1)];
      // a session tab is named after its session again (its current name and icon), whichever pane was focused at the
      // save; a shell-only tab keeps the saved folder title until its shell reports one
      if (tab.autoTitle && this.tabTitlePane(tab)?.session) this.deriveTabTitle(tab);
      this.workspace.render(tab);
      this.workspace.updateTab(tab);
      if (Number.isInteger(td.zoomed) && panes[td.zoomed]) this.workspace.setZoom(tab, panes[td.zoomed]); // zoomed at the save: zoomed again
      for (const p of panes) starts.push((p._transfer ? p.attach(p._transfer) : p.start()).catch((e) => console.error('pane start failed', e)));
      made.push(tab);
    }
    if (!made.length) return false;
    this.workspace.sortPinnedFirst(); // pinned tabs are the prefix of the strip, whatever order the file had
    const at = made[Math.min(desc.activeTab || 0, made.length - 1)];
    if (at) this.workspace.activate(at);
    const ap = this.activePane();
    if (ap) this.focusPane(ap, true);
    this.updateMultiexec();
    Promise.allSettled(starts);
    return true;
  }

  // ---------- a tab in a window of its own ----------
  /**
   * Move a tab into a new window (tab menu, ⌥⌘N). The panes hand their terminals over without ending them: the
   * new window attaches to the same terminal ids, main switches each terminal's owner to it and replays the last
   * 256 KB of output there (TermPane.attach). The sidebar, menus and shortcuts work in both windows; MultiExec
   * is per window. Should the window fail to open, the tab comes back here.
   */
  async detachTab(tab) {
    tab = tab || this.workspace.active;
    if (!tab || !tab.root) return false;
    const payload = { tabs: [this.serializeTab(tab, true)], activeTab: 0 };
    this._detaching = true; // a detached window emptied by this must not close before the new window is known to exist
    for (const p of tab.panes()) p.release();
    this.workspace.removeTab(tab);
    if (this.focused && this.focused.disposed) this.focused = null;
    this._afterClose();
    try {
      await window.api.detach.open(payload);
      return true;
    } catch (e) {
      toast(t('Could not open a window: {error}', { error: ipcMessage(e) }), 'error');
      await this.adoptTabs(payload, { quiet: true });
      return false;
    } finally {
      this._detaching = false;
      this._closeWhenEmpty();
    }
  }

  /**
   * A detached window whose last tab went (⌘W, Close All, detached again) closes: its reason to exist is gone, and it
   * has nothing to hand back. The main window keeps its empty state instead — it is the app. Deferred a tick so the
   * close that emptied the strip finishes first (status bar, MultiExec banner), and never while a detach is in flight.
   */
  _closeWhenEmpty() {
    if (!this.detached || this._closingEmpty || this._emptyCloseTimer) return;
    this._emptyCloseTimer = setTimeout(() => {
      this._emptyCloseTimer = null;
      if (this._detaching || this._closingEmpty || this.workspace.tabs.length) return;
      this._closingEmpty = true;
      this.handOverAndClose();
    }, 0);
  }

  /** Tabs handed to this window (its own on open, or the tabs of a detached window that closed): `attach` takes their live terminals over. */
  async adoptTabs(payload, { attach = true, quiet = false } = {}) {
    if (!payload || !Array.isArray(payload.tabs) || !payload.tabs.length) return false;
    const ok = await this.buildTabs(payload, { attach });
    if (ok && !quiet) toast(tn('{n} tab back from the closed window', '{n} tabs back from the closed window', payload.tabs.length), 'info');
    return ok;
  }

  /** This (detached) window is closing: its tabs go back to the main window with their terminals alive, then the window may go. */
  handOverAndClose() {
    const tabs = this.workspace.tabs.filter((t) => t.root);
    const payload = { tabs: tabs.map((t) => this.serializeTab(t, true)), activeTab: Math.max(0, tabs.indexOf(this.workspace.active)) };
    this._wsReady = false; // nothing more to save from here: the tabs belong to the main window now
    clearTimeout(this._wsTimer);
    for (const t of [...this.workspace.tabs]) {
      for (const p of t.panes()) p.release();
      this.workspace.removeTab(t);
    }
    if (payload.tabs.length) window.api.detach.returned(payload);
    window.api.detach.closeDone();
  }

  /** Another window saved settings: take them, repaint the chrome and, when a terminal option changed, every pane. */
  onSettingsChanged(s) {
    if (!s || typeof s !== 'object') return;
    const TERM_KEYS = ['theme', 'fontFamily', 'fontSize', 'lineHeight', 'cursorBlink', 'cursorStyle', 'scrollback', 'macOptionIsMeta'];
    const termChanged = TERM_KEYS.some((k) => JSON.stringify(s[k]) !== JSON.stringify(this.settings[k]));
    const local = this.detached ? { sidebarVisible: this.settings.sidebarVisible, sidebarTab: this.settings.sidebarTab } : {}; // this window's own
    const same = (k) => JSON.stringify(s[k]) === JSON.stringify(this.settings[k]);
    const macrosChanged = !same('macros'), wolChanged = !same('wolHistory');
    this.settings = { ...s, ...local };
    this._applyTheme();
    if (termChanged) {
      this.workspace.allPanes().forEach((p) => p.applySettings(this.settings));
      if (this._findResearch) this._findResearch();
    }
    // the panels that list settings follow too: a macro or a Wake-on-LAN address saved in the other window shows up here
    if (macrosChanged) this.macrosPanel.render();
    if (wolChanged) this.toolsPanel.renderWolHistory();
    this._applyLanguage(); // another window chose a language: this one follows
  }

  // ---------- main-process events ----------
  wireEvents() {
    window.api.on('term:data', (id, data) => {
      const p = this.panesByTerm.get(id);
      if (p) p.onData(data);
    });
    window.api.on('term:exit', (id, info) => {
      const p = this.panesByTerm.get(id);
      this.sftpPanel.dropConnection(id);
      if (!p) return;
      const lost = info && info.reason === 'lost' && p.termId === id; // the server or the network ended it (never a Disconnect, ⌘W or `exit`)
      p.onExit(info);
      if (lost) toast(p.lostMessage(info.detail), 'warn', 6000); // the pane may be in another tab, or its terminal full-screen
    });
    window.api.on('ssh:status', ({ id, state, msg }) => {
      const p = this.panesByTerm.get(id);
      if (!p) {
        const owner = this.workspace.allPanes().find((x) => x.sftpConnId === id); // a Mosh pane's SFTP companion
        if (owner) owner.onCompanionStatus(state, msg);
        return;
      }
      p.setStatus(state, msg);
      if (state === 'connected') {
        this.sessionTree.render();
        this.startSessionTunnels(p);
        if (p.session?.sftpAuto !== false && this.settings.sftpAutoOpen !== false) this.sftpPanel.show(id);
        else if (this.activePane() === p) this.sftpPanel.setPane(p);
      }
    });
    window.api.on('sftp:transfer', (t) => this.sftpPanel.onTransfer(t));
    window.api.on('sftp:edit-synced', (e) => toast(e.ok ? t('Uploaded {name}', { name: e.remote.split('/').pop() }) : t('Upload failed: {error}', { error: e.error }), e.ok ? 'success' : 'error'));
    window.api.on('menu:action', ({ action, arg }) => this.action(action, arg));
    // several windows: tabs coming back from a closed detached window, this window being closed, the other window's changes
    window.api.on('detach:adopt', (payload) => this.adoptTabs(payload).catch((e) => console.error('adopt failed', e)));
    window.api.on('window:closing', () => this.handOverAndClose());
    window.api.on('settings:changed', (s) => this.onSettingsChanged(s));
    window.api.on('sessions:changed', () => this.reloadSessions().catch(() => {}));
    window.api.on('prompt:request', async ({ reqId, kind, payload }) => {
      let result = null;
      try {
        if (kind === 'hostkey') result = await hostKeyDialog(payload);
        else if (kind === 'password') result = await passwordDialog(payload);
        else if (kind === 'kbdint') result = await kbdIntDialog(payload);
      } catch (e) {
        console.error(e);
      }
      window.api.promptReply(reqId, result);
    });
    window.api.on('tunnels:changed', (list) => {
      const active = list.filter((t) => t.status === 'active').length;
      $('#st-transfers').dataset.tunnels = active;
      this.updateStatusRight();
    });
    window.api.app.onBundleUpdated((info) => this.onBundleUpdated(info));
    // main-process errors (uncaughtException) reach the user instead of only the terminal that launched the app.
    // A notice is {text, level} or a bare string; one without text shows nothing (never "[object Object]").
    window.api.app.onNotice((n) => {
      const text = String((n && typeof n === 'object' ? n.text : n) ?? '').trim();
      if (text) toast(text, (n && n.level) || 'error', 8000);
    });
  }

  // ---------- UI wiring ----------
  wireUi() {
    for (const b of $$('[data-action]')) b.addEventListener('click', async (e) => {
      const viaKeyboard = e.detail === 0; // Enter/Space on the focused button
      const shown = modalsShown();
      await this.action(b.dataset.action, b.dataset.arg);
      // a dialog that opened (and maybe already closed) during the action placed focus itself (back on this button)
      if (!viaKeyboard || anyModalOpen() || modalsShown() !== shown || document.activeElement !== b) return;
      // keyboard flow: an action that opened no dialog/menu hands focus to the panel it showed, else to the terminal
      if (b.dataset.action === 'sidebar') this.focusPanel(b.dataset.arg);
      else this.activePane()?.focus();
    });
    // toolbar clicks must not steal keyboard focus from the terminal
    for (const b of $$('#toolbar .tb-btn, #side-strip .strip-btn')) b.addEventListener('mousedown', (e) => e.preventDefault());
    // on-disk update banner: Relaunch restarts into the bundle on disk (the main process asks about live
    // connections first); Later hides it until another version appears. Both are ordinary Tab stops; like
    // the toolbar, a mouse click leaves the keyboard focus in the terminal.
    $('#update-relaunch').addEventListener('click', () => {
      this.saveWorkspaceNow(); // sent before app:relaunch on the same channel, so it lands first
      window.api.app.relaunch();
    });
    $('#update-later').addEventListener('click', () => {
      this.updateDismissed = this.updateOnDisk;
      this.showUpdateBanner(false);
      this.activePane()?.focus();
    });
    for (const b of $$('#update-banner button')) b.addEventListener('mousedown', (e) => e.preventDefault());
    // empty workspace accepts a dropped session
    const tc = $('#tab-content');
    tc.addEventListener('dragover', (e) => { if (!this.workspace.tabs.length && e.dataTransfer.types.includes('text/x-mobalt-session')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    tc.addEventListener('drop', (e) => {
      if (this.workspace.tabs.length) return;
      const id = e.dataTransfer.getData('text/x-mobalt-session');
      const s = id && this.sessions.sessions.find((x) => x.id === id);
      if (s) { e.preventDefault(); this.openSession(s); }
    });
    for (const b of $$('.strip-btn[data-panel]')) b.addEventListener('click', (e) => {
      this.showPanel(b.dataset.panel);
      if (e.detail === 0) this.focusPanel(b.dataset.panel); // Enter / Space on the focused strip button: into the panel
    });
    $('#quick-connect').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#qc-input').value.trim();
      if (!v) return;
      this.quickConnect(v);
      $('#qc-input').blur();
      this.activePane()?.focus();
    });
    $('#qc-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); this.activePane()?.focus(); } // like the session filter: Esc clears and leaves
    });
    // sidebar resize
    const rs = $('#sidebar-resizer');
    rs.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const start = e.clientX, w0 = $('#sidebar').getBoundingClientRect().width;
      const move = (ev) => document.documentElement.style.setProperty('--sidebar-w', Math.max(180, Math.min(700, window.innerWidth - 520, w0 + ev.clientX - start)) + 'px');
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        this.saveSettings({ sidebarWidth: Math.round($('#sidebar').getBoundingClientRect().width) });
        this.workspace.allPanes().forEach((p) => p.fit());
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // find bar
    const fb = $('#find-bar'), fi = $('#find-input');
    // highlight colours follow the active terminal's palette (a light theme needs a pale tint under its dark text)
    this.findDecorations = () => searchDecorations(this.activePane()?.themeFor?.() || THEMES[this.settings.theme] || THEMES['moba-dark']);
    const opts = () => ({ caseSensitive: $('#find-case').checked, regex: $('#find-regex').checked, decorations: this.findDecorations() });
    // an unfinished regex (e.g. "h[ae") throws inside the search addon: show it as an invalid pattern instead
    const safeFind = (fn) => {
      try { fn(); fb.classList.remove('bad-pattern'); return true; }
      catch { fb.classList.add('bad-pattern'); $('#find-count').textContent = t('Invalid pattern'); return false; }
    };
    const research = () => {
      const p = this.activePane();
      if (!p) return;
      p.searchAddon.clearDecorations();
      if (fi.value) safeFind(() => p.searchAddon.findNext(fi.value, opts()));
      else this.onFindResults(p, { resultCount: 0, resultIndex: -1 });
    };
    this._findResearch = () => { if (!fb.hidden) research(); };
    fi.addEventListener('input', () => {
      const p = this.activePane();
      if (!p) return;
      if (!fi.value) return research();
      safeFind(() => p.searchAddon.findNext(fi.value, { ...opts(), incremental: true }));
    });
    for (const id of ['#find-case', '#find-regex']) $(id).addEventListener('change', research); // toggles re-run the search
    fi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); safeFind(() => (e.shiftKey ? this.activePane()?.searchAddon.findPrevious(fi.value, opts()) : this.activePane()?.searchAddon.findNext(fi.value, opts()))); }
      if (e.key === 'Escape') this.action('find-close');
    });
    for (const b of $$('[data-find]')) b.addEventListener('click', () => {
      const k = b.dataset.find;
      if (k === 'next') safeFind(() => this.activePane()?.searchAddon.findNext(fi.value, opts()));
      else if (k === 'prev') safeFind(() => this.activePane()?.searchAddon.findPrevious(fi.value, opts()));
      else this.action('find-close');
    });
    window.addEventListener('resize', () => this.workspace.allPanes().forEach((p) => p.fit()));
    // the window shown again (un-minimised, un-hidden, no longer covered): the monitoring bars that paused off screen poll again
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.workspace.allPanes().forEach((p) => p.monitorResume()); });
    document.addEventListener('modal-closed', () => this.activePane()?.focus());
    document.addEventListener('ctx-closed', () => { if (document.activeElement === document.body) this.activePane()?.focus(); }); // menu opened from a non-focusable spot
    // keyboard shortcuts not covered by the menu
    window.addEventListener('keydown', (e) => {
      if (anyModalOpen()) return;
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9' && e.ctrlKey) {
        const t = this.workspace.tabs[parseInt(e.key, 10) - 1];
        if (t) this.workspace.activate(t);
        e.preventDefault();
      }
    });
  }

  showPanel(name) {
    // the keyboard is inside the panel being hidden (⌘1-4, a strip button): remember where, so that coming back
    // restores it, and move it into the shown panel instead of dropping it on <body>
    const from = this._panelFocusLeaving(name);
    for (const b of $$('.strip-btn[data-panel]')) b.classList.toggle('active', b.dataset.panel === name);
    for (const p of $$('.panel')) p.classList.toggle('active', p.id === 'panel-' + name);
    $('#sidebar').classList.remove('collapsed');
    this.saveSettings({ sidebarTab: name, sidebarVisible: true }, true);
    if (name === 'sftp') this.sftpPanel.setPane(this.activePane());
    this.workspace.allPanes().forEach((p) => p.fit());

    this._syncSidebarToggle();
    if (from) this.focusPanel(name);
  }

  /** Remember the focused control of a sidebar panel that is about to be hidden (not `name`); returns that panel's name. */
  _panelFocusLeaving(name) {
    const a = document.activeElement, panel = a && a.closest('#sidebar .panel');
    if (!panel || panel.id === 'panel-' + name) return null;
    const from = panel.id.slice('panel-'.length);
    (this._panelFocus ||= {})[from] = a;
    return from;
  }

  /**
   * Keyboard into a sidebar panel: back on the control it left (while that is still shown), else the panel's Tab
   * stop — the tree's / list's cursor row, the tools host box, the macros ● Rec button —, else the terminal.
   */
  focusPanel(name) {
    const ok = (el) => !!el && el.isConnected && !el.hidden && !el.disabled && el.offsetParent !== null;
    const stop = {
      sessions: () => this.sessionTree.el.querySelector('.tree-row[tabindex="0"]') || this.sessionTree.el.querySelector('.tree-empty .link-btn') || $('#session-filter'),
      sftp: () => this.sftpPanel.cursorRow() || $('#sftp-list'),
      tools: () => $('#tool-host'),
      macros: () => this.macrosPanel.list.querySelector('.tree-row[tabindex="0"]') || $('#macro-record'),
    }[name];
    const back = this._panelFocus && this._panelFocus[name];
    const el = ok(back) ? back : stop && stop();
    if (ok(el)) el.focus();
    else this.activePane()?.focus();
  }

  toggleSidebar() {
    const sb = $('#sidebar');
    const a = document.activeElement, inside = a && a.closest('#sidebar .panel');
    sb.classList.toggle('collapsed');
    if (inside && sb.classList.contains('collapsed')) { // the keyboard never stays on a hidden control
      (this._panelFocus ||= {})[inside.id.slice('panel-'.length)] = a;
      this.activePane()?.focus();
    }
    this.saveSettings({ sidebarVisible: !sb.classList.contains('collapsed') }, true);
    this._syncSidebarToggle();
    this.workspace.allPanes().forEach((p) => p.fit());
  }

  /** The strip's collapse button mirrors the sidebar state (‹ hide / › show). */
  _syncSidebarToggle() {
    const collapsed = $('#sidebar').classList.contains('collapsed');
    const btn = document.querySelector('.strip-btn[data-action="toggle-sidebar"]');
    if (!btn) return;
    btn.querySelector('span').replaceChildren(icon(collapsed ? 'chevron-right' : 'chevron-left'));
    btn.title = collapsed ? t('Show sidebar (⌘B)') : t('Hide sidebar (⌘B)');
    for (const b of document.querySelectorAll('.strip-btn[data-action="sidebar"]')) b.classList.toggle('active', !collapsed && b.dataset.arg === this.settings.sidebarTab);
  }

  // ---------- panes / tabs ----------
  activePane() {
    return this.workspace.active ? this.workspace.active.activePane : null;
  }

  paneByTerm(id) {
    return this.panesByTerm.get(id);
  }

  /** Pane behind a connection id: its own terminal, or (Mosh) its SFTP companion connection. */
  paneByConn(id) {
    return this.panesByTerm.get(id) || this.workspace.allPanes().find((p) => p.sftpConnId === id) || null;
  }

  registerPane(pane) {
    this.panesByTerm.set(pane.termId, pane);
  }

  unregisterPane(pane) {
    if (pane.termId) this.panesByTerm.delete(pane.termId);
  }

  focusPane(pane, viaTab = false) {
    if (pane && pane.tab && pane.tab.zoomed && pane.tab.zoomed !== pane) this.workspace.setZoom(pane.tab, null); // a hidden pane that gets the focus (⌘], reconnect, a drop) must be seen
    if (pane && pane.tab) queueMicrotask(() => pane.tab.tabEl && this.workspace.updateTab(pane.tab)); // tab dot follows the active pane
    if (this.focused && this.focused !== pane) this.focused.el.classList.remove('focused');
    this.focused = pane;
    pane.el.classList.add('focused');
    if (pane.tab) {
      pane.tab.activePane = pane;
      if (this.tabTitlePane(pane.tab)?.session) this.syncTabTitle(pane.tab); // a session tab keeps its session's name and icon whichever pane is used
      if (!viaTab && this.workspace.active !== pane.tab) this.workspace.activate(pane.tab);
    }
    if (typeof pane.syncWebgl === 'function') pane.syncWebgl(); // on screen now (a split, a drop, an un-zoom): a GPU context within the budget
    pane.focus();
    this.updateStatus(pane);
    this.sftpPanel.setPane(pane);
  }

  async newLocalTab(opts = {}) {
    const pane = new TermPane(this, { kind: 'local', session: opts.session || null, cwd: opts.cwd });
    this.workspace.newTab(pane, opts.title);
    await pane.start();
    pane.focus();
    return pane;
  }

  /** Open a saved/ad-hoc session. opts.split = 'right'|'left'|'down'|'up' opens next to opts.target (or the active pane). */
  async openSession(s, opts = {}) {
    if (!s) return;
    if (s.type === 'rdp' || s.type === 'vnc') {
      toast(t('Opening {name} in {app}…', { name: s.name || s.host, app: s.type === 'rdp' ? t('Windows App / Remote Desktop') : t('Screen Sharing') }), 'info');
      return s.type === 'rdp' ? window.api.launch.rdp(s) : window.api.launch.vnc(s);
    }
    const kind = kindOf(s.type);
    const pane = new TermPane(this, { kind, session: s, cwd: s.cwd || undefined });
    const target = opts.target || this.activePane();
    if (opts.split && target && target.tab) {
      this.workspace.split(target.tab, target, opts.split, pane);
    } else {
      const tab = this.workspace.newTab(pane, s.name);
      if (s.color) tab.color = s.color;
      if (s.icon) tab.icon = s.icon;
      if (s.color || s.icon) this.workspace.updateTab(tab);
    }
    this.focusPane(pane);
    await pane.start();
    pane.focus();
    this.pushRecent(s);
    return pane;
  }

  /** Quick connect reuses a saved session only when type, host, port AND user name agree (an empty user on
   *  both sides counts as agreement): "ftp://host" means anonymous, not the saved "demo@host". */
  quickConnect(str) {
    const q = parseQuickConnect(str);
    if (!q) return toast(t('Use user@host[:port], optionally with ssh:// mosh:// telnet:// ftp:// ftps:// rdp:// vnc://'), 'warn');
    const defPort = { ssh: 22, mosh: 22, telnet: 23, ftp: 21, rdp: 3389, vnc: 5900 };
    const existing = this.sessions.sessions.find((s) => s.type === q.type && s.host === q.host && (s.port || defPort[s.type] || 22) === q.port && (s.username || '') === (q.username || ''));
    $('#qc-input').value = '';
    return this.openSession(existing || { ...q, authMethod: 'auto', sftpAuto: true });
  }

  pushRecent(s) {
    if (!s.id) return;
    const recent = [s.id, ...(this.settings.recentSessions || []).filter((x) => x !== s.id)].slice(0, 10);
    this.saveSettings({ recentSessions: recent }, true);
  }

  async closePane(pane, silent = false) {
    if (!silent && pane.status === 'connected' && pane.kind !== 'local' && this.settings.confirmClose) {
      if (!(await confirmDialog(t('Close "{title}"? The connection will be dropped.', { title: pane.title }), { okLabel: t('Close'), danger: true }))) return;
    }
    const tab = pane.tab;
    const connId = pane.termId; // dispose() clears it: drop the panel state by the id it had
    pane.dispose();
    this.sftpPanel.dropConnection(connId);
    if (tab) {
      const empty = this.workspace.removePane(tab, pane);
      if (empty) this.workspace.removeTab(tab);
    }
    if (this.focused === pane) this.focused = null;
    const ap = this.activePane();
    if (ap) this.focusPane(ap, true);
    else this.updateStatus(null);
    this.updateMultiexec();
  }

  /** The panes of `tabs` whose connection would drop (a local shell is not a connection). */
  liveIn(tabs) {
    return tabs.flatMap((t) => t.panes()).filter((p) => p.status === 'connected' && p.kind !== 'local');
  }

  async closeTab(tab) {
    const live = this.liveIn([tab]);
    if (live.length && this.settings.confirmClose) {
      if (!(await confirmDialog(tn('Close tab "{title}" with {n} live connection?', 'Close tab "{title}" with {n} live connections?', live.length, { title: tab.title }), { okLabel: t('Close'), danger: true }))) return false;
    }
    this._disposeTab(tab);
    this._afterClose();
    return true;
  }

  /**
   * Close several tabs at once (Close Others / to the Left / to the Right / All): the live connections of every tab in
   * the list are counted and one question covers them all — "Close 3 tabs with 2 live connections?" — then the tabs
   * go without further prompts. Tabs no longer in the strip are skipped; a single tab gets closeTab's wording.
   */
  async closeTabs(list) {
    const tabs = (list || []).filter((t, i, a) => this.workspace.tabs.includes(t) && a.indexOf(t) === i);
    if (!tabs.length) return false;
    if (tabs.length === 1) return this.closeTab(tabs[0]);
    const live = this.liveIn(tabs);
    if (live.length && this.settings.confirmClose) {
      const conns = tn('{n} live connection', '{n} live connections', live.length);
      if (!(await confirmDialog(tn('Close {n} tab with {conns}?', 'Close {n} tabs with {conns}?', tabs.length, { conns }), { okLabel: t('Close tabs'), danger: true }))) return false;
    }
    const active = this.workspace.active;
    for (const t of tabs) if (t !== active) this._disposeTab(t); // the active tab last: no neighbour is activated only to be closed
    if (tabs.includes(active)) this._disposeTab(active);
    this._afterClose();
    return true;
  }

  /** Tear a tab down without asking: every pane's backend ends and the tab leaves the strip. */
  _disposeTab(tab) {
    for (const p of tab.panes()) {
      const connId = p.termId;
      p.dispose();
      this.sftpPanel.dropConnection(connId);
    }
    this.workspace.removeTab(tab);
  }

  _afterClose() {
    const ap = this.activePane();
    if (ap) this.focusPane(ap, true);
    else this.updateStatus(null);
    this.updateMultiexec();
  }

  /** Pin a tab to the left of the strip, or unpin it (tab menu, ⇧⌘P on the active tab). */
  togglePin(tab) {
    if (!tab) return;
    const on = !tab.pinned;
    this.workspace.setPinned(tab, on);
    toast(on ? t('Pinned "{title}" — it stays at the left and Close Others / Left / Right leave it alone', { title: tab.title }) : t('Unpinned "{title}"', { title: tab.title }), 'info', on ? 3500 : 1800);
  }

  /** Split the active pane and open an empty pane next to it (drop a session onto it to connect). */
  async splitActive(dir, fromPane) {
    const target = fromPane || this.activePane();
    if (!target) return this.newLocalTab();
    const pane = new TermPane(this, { kind: 'empty', from: target });
    this.workspace.split(target.tab, target, dir, pane);
    this.focusPane(pane, true);
    await pane.start();
    this.updateMultiexec();
  }

  /** Arrange the active tab as a cols×rows grid ("2x4" = 2 per row, 4 rows = 8 panes), like MobaXterm's split modes. */
  async applyLayout(spec) {
    const m = /^(\d)x(\d)$/.exec(String(spec));
    if (!m) return;
    const cols = parseInt(m[1], 10), rows = parseInt(m[2], 10);
    let tab = this.workspace.active;
    if (!tab) {
      await this.newLocalTab();
      tab = this.workspace.active;
    }
    const from = this.activePane();
    const created = this.workspace.applyGrid(tab, cols, rows, () => new TermPane(this, { kind: 'empty', from }));
    for (const p of created) await p.start();
    const ap = tab.activePane || tab.panes()[0];
    if (ap) this.focusPane(ap, true);
    this.updateMultiexec();
    if (created.length) toast(tn('{n} empty pane added — drag sessions onto them', '{n} empty panes added — drag sessions onto them', created.length), 'info');
  }

  /** Open several sessions at once in a new tab laid out as a 2-column grid. */
  async openSessionsInGrid(sessions, cols = 2) {
    const list = sessions.filter((s) => s && s.type !== 'rdp' && s.type !== 'vnc');
    if (!list.length) return;
    const first = await this.openSession(list[0]);
    const tab = first.tab;
    tab.title = tn('{n} session', '{n} sessions', list.length);
    tab.autoTitle = false;
    this.workspace.updateTab(tab);
    const empties = this.workspace.applyGrid(tab, cols, Math.ceil(list.length / cols), () => new TermPane(this, { kind: 'empty' }));
    for (let i = 0; i < empties.length; i++) {
      if (list[i + 1]) await this.replacePane(empties[i], list[i + 1], true);
      else await empties[i].start();
    }
    this.focusPane(first, true);
  }

  /**
   * ⌥⌘1, View → Unsplit, Split ▾ → Unsplit: what becomes of the other panes of the active tab follows Settings →
   * Terminal → Unsplit, or `mode` ('tabs' | 'active' | 'ask') when the caller names one. 'tabs' moves each of them
   * into a tab of its own right after this one, terminals and all (layout.js unsplitToTabs: nothing reconnects);
   * 'active' closes them, asking first when live connections would drop; 'ask' puts the question each time and
   * Cancel keeps the split. A tab with a single pane: nothing happens, no question.
   */
  async unsplit(mode) {
    const ap = this.activePane();
    if (!ap || !ap.tab) return;
    if (ap.tab.panes().length < 2) return;
    const asked = (mode || this.settings.unsplitMode) === 'ask'; // the question names the connections that would drop: no second one
    mode = await this.workspace.resolveUnsplitMode(mode || this.settings.unsplitMode, ap.tab);
    if (!mode || ap.tab.panes().length < 2) return;
    if (mode === 'tabs') return this.workspace.unsplitToTabs(ap.tab, ap);
    const others = ap.tab.panes().filter((p) => p !== ap);
    const live = others.filter((p) => p.status === 'connected' && p.kind !== 'local' && !p.dead);
    const conns = tn('{n} live connection', '{n} live connections', live.length);
    if (live.length && this.settings.confirmClose && !asked && !(await confirmDialog(tn('Close {n} other pane? {conns} will be dropped.', 'Close {n} other panes? {conns} will be dropped.', others.length, { conns }), { okLabel: t('Close panes'), danger: true }))) return;
    for (const p of others) await this.closePane(p, true);
    this.focusPane(ap, true);
  }

  /**
   * Zoom the pane (default: the active one) to fill its tab, or restore the tab's layout when one is zoomed.
   * The siblings stay alive but hidden; MultiExec then writes to the zoomed pane only (multiexecTargets).
   */
  toggleZoom(pane) {
    const ap = pane || this.activePane();
    if (!ap || !ap.tab) return toast(t('Nothing to zoom — open a session first'), 'info');
    const tab = ap.tab;
    if (tab.zoomed) {
      this.workspace.setZoom(tab, null);
      this.focusPane(tab.activePane, true);
      return;
    }
    if (tab.panes().length < 2) return toast(t('Only one pane in this tab'), 'info');
    this.workspace.setZoom(tab, ap);
    this.focusPane(ap, true);
  }

  splitMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const ap = this.activePane();
    const n = ap && ap.tab ? ap.tab.panes().length : 0;
    const zoomed = !!(ap && ap.tab && ap.tab.zoomed);
    contextMenu(r.left, r.bottom + 4, [
      { label: t('Split Right (side by side)'), key: '⌘D', action: () => this.action('split', 'right') },
      { label: t('Split Down (top / bottom)'), key: '⇧⌘D', action: () => this.action('split', 'down') },
      '-',
      { label: zoomed ? t('Restore Panes (unzoom)') : t('Zoom Pane (fill the tab)'), key: '⇧⌘⏎', action: () => this.toggleZoom(), disabled: n < 2 },
      '-',
      { label: t('Layout 1 × 2  (2 side by side)'), action: () => this.applyLayout('2x1') },
      { label: t('Layout 2 × 1  (2 stacked)'), action: () => this.applyLayout('1x2') },
      { label: t('Layout 2 × 2  (4 panes)'), action: () => this.applyLayout('2x2') },
      { label: t('Layout 2 × 3  (6 panes)'), action: () => this.applyLayout('2x3') },
      { label: t('Layout 2 × 4  (8 panes)'), action: () => this.applyLayout('2x4') },
      '-',
      { label: t('Re-arrange current panes as grid'), action: () => this.applyLayout(`2x${Math.max(1, Math.ceil(n / 2))}`), disabled: n < 2 },
      { label: t('Unsplit'), key: '⌥⌘1', action: () => this.unsplit(), disabled: n < 2 }, // the other panes go to tabs of their own, or close: Settings → Terminal → Unsplit
    ]);
  }

  /** Fill an empty pane with a copy of another pane's session (or a local shell). */
  async duplicateInto(pane, from) {
    if (!from || from.kind === 'empty' || from.kind === 'local') return pane.becomeLocal(from && from.cwd);
    return this.replacePane(pane, from.session, true);
  }

  /** Replace a pane's terminal with a new one for `session` (confirming if a live connection would drop). */
  async replacePane(pane, session, silent = false) {
    if (!pane.tab || !session) return;
    if (session.type === 'rdp' || session.type === 'vnc') return this.openSession(session);
    if (!silent && pane.status === 'connected' && pane.kind !== 'local' && !pane.dead && this.settings.confirmClose) {
      if (!(await confirmDialog(t('Replace "{title}" with "{name}"? The current connection will be dropped.', { title: pane.title, name: session.name }), { okLabel: t('Replace'), danger: true }))) return;
    }
    const kind = kindOf(session.type);
    const next = new TermPane(this, { kind, session, cwd: session.cwd || undefined });
    const tab = pane.tab;
    this.workspace.replace(tab, pane, next);
    const connId = pane.termId;
    pane.dispose();
    this.sftpPanel.dropConnection(connId);
    if (this.focused === pane) this.focused = null;
    this.focusPane(next, true);
    next.updateTitle(); // the tab title follows the new session
    await next.start();
    next.focus();
    this.pushRecent(session);
    this.updateMultiexec();
    return next;
  }

  /** A session (from the sidebar) or a tab was dropped on a pane. zone: center|left|right|up|down. */
  async dropOnPane(pane, { sessionId, tabId }, zone) {
    if (sessionId) {
      const s = this.sessionTree.sessionById(sessionId);
      if (!s) return;
      if (zone === 'center' || pane.kind === 'empty') return this.replacePane(pane, s);
      return this.openSession(s, { split: zone, target: pane });
    }
    if (tabId) {
      const tab = this.workspace.tabs.find((t) => t.id === tabId);
      if (!tab || tab === pane.tab) return;
      const src = tab.activePane || tab.panes()[0];
      if (!src) return;
      this.workspace.movePane(src, pane, zone);
      this.updateMultiexec();
    }
  }

  /** Search addon result counter for the find bar (only the active pane's numbers are shown). */
  onFindResults(pane, { resultCount, resultIndex }) {
    if (pane !== this.activePane()) return;
    const el = $('#find-count'), fi = $('#find-input');
    if (!el) return;
    this._findLast = { resultCount, resultIndex }; // redone in the new language on a switch (onLanguageChanged)
    el.textContent = resultCount > 0 ? `${resultIndex >= 0 ? resultIndex + 1 : '–'} / ${resultCount}` : fi.value ? t('No matches') : '';
    $('#find-bar').classList.toggle('no-match', !!fi.value && resultCount === 0);
  }

  /** Hint panel shown in the content area while no tab is open. */
  _syncEmptyState() {
    const host = $('#tab-content');
    const el = host.querySelector('.workspace-empty');
    const empty = !this.workspace.tabs.length;
    if (empty && !el) {
      host.append(h('div', { class: 'workspace-empty' },
        h('div', { class: 'big' }, t('No terminal open')),
        h('div', { class: 'hint' }, t('Drag a session from the Sessions panel here, or:')),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small', onclick: () => this.action('new-session') }, t('＋ New session  ⌘N')),
          h('button', { class: 'btn small', onclick: () => this.action('new-local') }, t('>_ Local terminal  ⌘T')),
          h('button', { class: 'btn small', onclick: () => this.action('quick-connect') }, t('Quick connect  ⇧⌘N')))));
    } else if (!empty && el) el.remove();
  }

  /** A detached window is titled after its active tab (Mission Control, the Window menu). */
  onTabUpdated(tab) {
    if (this.detached && tab === this.workspace.active) document.title = tab ? t('{title} — MobAlt', { title: tab.title }) : 'MobAlt';
  }

  onActiveTabChanged(tab) {
    if (this.detached) document.title = tab ? t('{title} — MobAlt', { title: tab.title }) : 'MobAlt';
    this._syncEmptyState();
    this.updateMultiexec(); // the broadcast set is the new tab's panes
    if (this._findResearch) this._findResearch(); // the find counter belongs to the new terminal
    this.updateStatus(tab ? tab.activePane : null);
    if (tab && tab.activePane) this.sftpPanel.setPane(tab.activePane);
    this.onTabsChanged();
    if (!tab) this._closeWhenEmpty(); // a detached window with no tab left goes
    this.saveWorkspaceSoon();
  }

  /**
   * The strip changed (a tab added, removed, moved, pinned or activated): the native Session menu's tab items follow,
   * enabled exactly like the tab context menu's (layout.js tabMenu) — nothing to pin, detach or close without a tab,
   * nothing to the left of the first tab. One IPC per change, coalesced, and only when the state differs.
   */
  onTabsChanged() {
    if (this._menuStateQueued) return;
    this._menuStateQueued = true;
    queueMicrotask(() => {
      this._menuStateQueued = false;
      const state = this.menuTabState();
      const key = JSON.stringify(state);
      if (key === this._menuStateKey) return;
      this._menuStateKey = key;
      if (typeof window.api.app.tabState === 'function') window.api.app.tabState(state);
    });
  }

  /** What the Session menu needs: is there a tab, is it pinned, and how many tabs each bulk close would take. */
  menuTabState() {
    const ws = this.workspace, tab = ws.active;
    return {
      tab: !!tab,
      pinned: !!(tab && tab.pinned),
      others: tab ? ws.closeTargets(tab, 'others').length : 0,
      left: tab ? ws.closeTargets(tab, 'left').length : 0,
      right: tab ? ws.closeTargets(tab, 'right').length : 0,
    };
  }

  /**
   * The pane an auto-titled tab is named after: its first session pane (a tab opened for a session keeps that
   * session's name and icon, like its colour, while a helper shell or another session is split into it), else the
   * active pane (a shell-only tab shows the folder of the shell being used).
   */
  tabTitlePane(tab) {
    return tab.panes().find((p) => p.session) || tab.activePane || null;
  }

  /** Set an auto-titled tab's title and icon from the pane it is named after; true when either changed. */
  deriveTabTitle(tab) {
    if (!tab.autoTitle) return false;
    const owner = this.tabTitlePane(tab);
    if (!owner) return false;
    const title = owner.session ? owner.session.name : owner.title, icon = owner.session?.icon || null;
    if (tab.title === title && tab.icon === icon) return false;
    tab.title = title;
    tab.icon = icon;
    return true;
  }

  syncTabTitle(tab) {
    if (tab && this.deriveTabTitle(tab)) this.workspace.updateTab(tab);
  }

  onPaneTitle(pane) {
    if (pane.tab && pane.tab.autoTitle && this.tabTitlePane(pane.tab) === pane) this.syncTabTitle(pane.tab);
  }

  onPaneStatus(pane, msg) {
    if (pane.tab) this.workspace.updateTab(pane.tab);
    this.updateMultiexec(); // a shell that connected, died or came back changes the broadcast count
    if (this.activePane() === pane) this.updateStatus(pane, msg);
    this.sessionTree.render(); // connected dot / failure state in the tree
  }

  onPaneCwd(pane) {
    if (this.activePane() === pane) this.setStatusCwd(pane.remoteCwd);
    // local shells: the tab/pane title follows the folder (until the shell or the user sets a title)
    if (pane.kind === 'local' && !pane.session && pane.remoteCwd && (pane.title === 'Local' || pane.title === t('Local') || pane._cwdTitled)) { // the untitled shell (terminal.js's fallback, in either language)
      const cwd = pane.remoteCwd.replace(/\/+$/, '');
      pane.title = cwd === this.info.home ? '~' : cwd.split('/').pop() || '/';
      pane._cwdTitled = true;
      pane.updateTitle();
    }
    this.sftpPanel.onPaneCwd(pane);
    if (pane.kind === 'local') this.saveWorkspaceSoon(); // keep restored shells in their folder
  }

  updateStatus(pane, msg) {
    const el = $('#st-session');
    this._statusMsg = msg; // shown again in the new language on a switch (onLanguageChanged)
    if (!pane) {
      el.textContent = t('No session');
      $('#st-cwd').textContent = '';
    } else {
      const s = pane.session;
      // the protocol tag (SSH, LOCAL, …), where, and the state: the glyphs between them are punctuation, each part is translated on its own
      const where = pane.kind === 'local' ? t('local shell')
        : pane.kind === 'empty' ? t('empty pane — drag a session here')
        : pane.kind === 'serial' ? `${s?.serialPath} @ ${s?.baudRate}`
        : pane.kind === 'ftp' ? `${s?.username ? s.username + '@' : 'anonymous@'}${s?.host}${s?.port && s.port !== 21 ? ':' + s.port : ''}`
        : `${s?.username ? s.username + '@' : ''}${s?.host}${s?.port && s.port !== 22 ? ':' + s.port : ''}`;
      el.textContent = `${(TYPE_LABEL[pane.kind] || pane.kind).toUpperCase()} · ${where} · ${stateLabel(pane.status)}${msg ? ' (' + msg + ')' : ''}`; // the kind's label follows the interface language (LOCAL / SERIAL)
      if (pane.kind === 'mosh' && pane.sftpStatus && pane.sftpStatus !== 'idle') el.textContent += ' · ' + t('SFTP: {state}', { state: stateLabel(pane.sftpStatus) });
      const browsing = this.sftpPanel.states.get(pane.kind === 'mosh' ? pane.sftpConnId : pane.termId);
      $('#st-cwd').textContent = pane.dead ? '' : shortPath(pane.remoteCwd || pane.cwd || (browsing && browsing.path) || '');
    }
    $('#st-log').textContent = pane && pane.logging ? t('● LOG') : '';
    $('#st-log').classList.toggle('on', !!(pane && pane.logging));
  }

  setStatusCwd(p) {
    $('#st-cwd').textContent = shortPath(p);
  }

  setStatusTransfers(n) {
    $('#st-transfers').dataset.xfers = n;
    this.updateStatusRight();
  }

  updateStatusRight() {
    const el = $('#st-transfers');
    const x = parseInt(el.dataset.xfers || '0', 10), tun = parseInt(el.dataset.tunnels || '0', 10);
    el.textContent = [x ? tn('⇅ {n} transfer', '⇅ {n} transfers', x) : '', tun ? tn('⇄ {n} tunnel', '⇄ {n} tunnels', tun) : ''].filter(Boolean).join('  ');
  }

  // ---------- MultiExec ----------
  /**
   * The terminals MultiExec writes to: the ones on screen, i.e. the live shells of the active tab — only the
   * zoomed pane while one fills the tab (other tabs are never touched; empty placeholders, FTP cards and dead
   * sessions are skipped).
   */
  multiexecTargets() {
    const tab = this.workspace.active;
    if (!tab) return [];
    const shown = tab.zoomed ? [tab.zoomed] : tab.panes();
    return shown.filter((p) => !p.dead && p.termId && p.kind !== 'ftp' && p.kind !== 'empty');
  }

  broadcast(data, from) {
    const targets = this.multiexecTargets();
    for (const p of targets) p.write(data);
    if (from && !targets.includes(from)) from.write(data); // input into a terminal that is not on screen still reaches its own shell (once)
  }

  // ---------- paste guard ----------
  /**
   * Every paste into a terminal (terminal.js pasteText: ⌘V / Edit → Paste, right-click and the pane menu, text
   * dropped on a pane) comes through here before xterm sees it. With Settings → Features → Paste guard on (both
   * toggles are, by default) a multi-line or very long paste asks first, and a suspicious one shows what it hides and
   * offers a cleaned copy (src/renderer/pasteguard.js). Resolves with the text to paste — as given, edited in the
   * dialog or cleaned — or null when the user cancelled. With MultiExec on, the one dialog names the broadcast set;
   * the paste then goes out through onData like keystrokes, once per visible terminal.
   */
  async guardPaste(pane, text) {
    const analysis = analysePaste(text);
    const mode = pasteGuardMode(analysis, this.settings);
    if (!mode.ask) return text;
    let where = pane.title;
    if (this.multiexec) {
      const targets = this.multiexecTargets();
      const n = targets.length + (targets.includes(pane) ? 0 : 1); // broadcast() also writes to a pane that is not on screen
      if (n > 1) where = t('{n} terminals (MultiExec)', { n });
    }
    return pasteGuardDialog({ text, analysis, where, warn: mode.warn });
  }

  /** Wording for an empty broadcast set: no tab at all, or a tab whose panes are empty cards, FTP cards or dead shells. */
  multiexecNoneText() {
    const tab = this.workspace.active;
    if (tab && tab.zoomed) return t('the zoomed pane has no live terminal — restore the panes (⇧⌘⏎) or reconnect');
    return tab ? t('no terminal is visible in this tab — connect a session first') : t('no terminal is visible — open a session first');
  }

  /** Banner, toolbar state and the visible-terminal count; called whenever the active tab or a pane's life changes. */
  updateMultiexec() {
    const banner = $('#multiexec-banner');
    const wasHidden = banner.hidden;
    banner.hidden = !this.multiexec;
    $('#btn-multiexec').classList.toggle('on', this.multiexec);
    const n = this.multiexecTargets().length;
    // #multiexec-count always exists (scripts read it); with nothing to write to, the sentence says so instead of "0 visible terminal(s)".
    // The banner is rendered here, never through a data-i18n hook on the static element (index.html): one sentence
    // per case, the count element put where {count} is, so a translation can move it.
    const count = h('b', { id: 'multiexec-count', hidden: n === 0 }, String(n));
    const zoomed = !!(this.workspace.active && this.workspace.active.zoomed);
    const text = n === 0 ? t('MultiExec is ON — {reason}', { reason: this.multiexecNoneText() })
      : zoomed ? t('MultiExec is ON — keystrokes go to {count} visible terminal(s) in this tab (the zoomed pane only)')
      : t('MultiExec is ON — keystrokes go to {count} visible terminal(s) in this tab');
    banner.replaceChildren(...fillNodes(text, { count }), ...(n === 0 ? [count] : []));
    if (wasHidden !== banner.hidden) this.workspace.allPanes().forEach((p) => p.fit()); // the banner takes a row from the terminals
  }

  // ---------- on-disk update (brew upgrade / dragged DMG while MobAlt runs) ----------
  /** The main process found a different MobAlt.app on disk: offer a relaunch, unless "Later" silenced that version. */
  onBundleUpdated({ version, current }) {
    if (!version || version === this.updateDismissed) return;
    this.updateOnDisk = version;
    this._updateCurrent = current || this.info.version;
    this._renderUpdateBanner();
    this.showUpdateBanner(true);
  }

  /** The banner's sentence (test/e2e-update.js asserts the English): the two versions in bold wherever the translation puts them. */
  _renderUpdateBanner() {
    if (!this.updateOnDisk) return;
    const versions = { version: h('b', {}, this.updateOnDisk), current: h('b', {}, this._updateCurrent) };
    $('#update-banner-text').replaceChildren(...fillNodes(t('MobAlt {version} is installed on disk — you are running {current}.'), versions), ' ', h('span', { class: 'keep' }, t('Relaunch to use it.')));
  }

  showUpdateBanner(on) {
    const el = $('#update-banner');
    if (el.hidden === !on) return;
    el.hidden = !on;
    this.workspace.allPanes().forEach((p) => p.fit()); // terminals re-measure around the bar, like the MultiExec banner
  }

  async startSessionTunnels(pane) {
    const list = (pane.session?.tunnels || []).filter((t) => t.enabled !== false);
    const ids = [];
    for (const tun of list) {
      try {
        ids.push(await window.api.tunnels.start({ ...tun, connId: pane.termId }));
      } catch (e) {
        toast(t('Tunnel {port}: {error}', { port: tun.bindPort, error: e.message }), 'error');
      }
    }
    if (!list.length) return;
    // start() resolves even when the bind failed; report what actually came up
    const all = await window.api.tunnels.list().catch(() => []);
    const mine = all.filter((x) => ids.includes(x.id));
    const failed = mine.filter((x) => x.status === 'error');
    const ok = mine.length - failed.length;
    if (failed.length) toast(tn('{failed} of {n} tunnel failed for {title}: {list}', '{failed} of {n} tunnels failed for {title}: {list}', mine.length, { failed: failed.length, title: pane.title, list: failed.map((x) => `${x.bindPort} (${x.error || t('error')})`).join('; ') }), 'error', 7000);
    if (ok) toast(tn('{n} tunnel started for {title}', '{n} tunnels started for {title}', ok, { title: pane.title }), 'success');
  }

  // ---------- sessions / settings persistence ----------
  /**
   * One toast for an importer's { imported, updated?, skipped, errors, file? }: a file that could not be used at all
   * (nothing imported or skipped, one reason) is an error — "<refused>: <reason>"; a file with nothing in it is a
   * warning — "No sessions found in <file>"; anything else is a summary — "Imported 5 sessions from MobaXterm.ini,
   * updated 2 already in the tree, skipped 1: …" — shown as a warning when entries were skipped, with up to three
   * of their reasons. The summary is a head clause and up to two tail clauses, each translated whole (with its
   * leading comma), since the eight combinations would otherwise be sixteen sentences.
   */
  importToast(r, { from = '', refused = t('Import failed') } = {}) {
    const errors = r.errors || [];
    if (!r.imported && !r.updated && !r.skipped && errors.length) return toast(`${refused}: ${errors[0]}`, 'error', 8000);
    const file = r.file || from;
    if (!r.imported && !r.updated && !r.skipped) return toast(file ? t('No sessions found in {file}', { file }) : t('No sessions found'), 'warn');
    let msg = from ? tn('Imported {n} session from {from}', 'Imported {n} sessions from {from}', r.imported, { from }) : tn('Imported {n} session', 'Imported {n} sessions', r.imported);
    if (r.updated) msg += t(', updated {n} already in the tree', { n: r.updated });
    if (r.skipped) msg += t(', skipped {n}: {reasons}', { n: r.skipped, reasons: errors.slice(0, 3).join('; ') + (errors.length > 3 ? '; …' : '') });
    return toast(msg, r.skipped ? 'warn' : 'success', r.skipped ? 8000 : undefined);
  }

  async reloadSessions() {
    this.sessions = await window.api.sessions.list();
    this.sessionTree.render();
  }

  async saveSession(s) {
    const saved = await window.api.sessions.save(s);
    await this.reloadSessions();
    // an open pane of this session takes its new keyword-highlighting override at once (the rest applies on the next connect)
    for (const p of this.workspace.allPanes()) {
      if (p.session && p.session.id === saved.id && (p.session.highlight || '') !== (saved.highlight || '')) {
        p.session.highlight = saved.highlight;
        p._syncHighlight(this.settings);
      }
    }
    return saved;
  }

  async saveAllSessions(data) {
    this.sessions = await window.api.sessions.saveAll(data);
    this.sessionTree.render();
  }

  async deleteSession(id) {
    await window.api.sessions.remove(id);
    await this.reloadSessions();
  }

  async editSession(s) {
    const r = await sessionEditor(this, s || {});
    if (!r) return;
    const connect = r._connect;
    delete r._connect;
    const inTree = this.sessionTree.el.contains(document.activeElement); // the dialog handed the focus back to a row
    const saved = await this.saveSession(r);
    this.sessionTree.reveal(saved, inTree); // the saved session is the selection (and the cursor, from the keyboard)
    if (connect) this.openSession(saved);
  }

  async saveSettings(patch, quiet = false) {
    if (this.detached) { // a detached window's sidebar state is its own: kept here, never written over the main window's
      patch = { ...patch };
      for (const k of ['sidebarVisible', 'sidebarTab', 'sidebarWidth', 'windowBounds']) if (k in patch) { this.settings[k] = patch[k]; delete patch[k]; }
      if (!Object.keys(patch).length) return;
    }
    this.settings = await window.api.settings.set(patch);
    this._applyTheme();
    if (!quiet) this.workspace.allPanes().forEach((p) => p.applySettings(this.settings));
    if (!quiet && this._findResearch) this._findResearch(); // open find highlights take the new theme's colours
    await this._applyLanguage();
  }

  /**
   * Settings → General → Language: the window switches at once. The dictionary comes from the main process (which
   * rebuilt the menu already), src/renderer/i18n.js re-translates the static hooks of index.html and fires
   * `i18n:changed`, on which every component that keeps rendered labels renders itself again (onLanguageChanged
   * here, the tree / tabs / panels in their own modules). Terminal output is never touched.
   */
  async _applyLanguage() {
    const code = resolveSetting(this.settings.language);
    if (code === currentLocale()) return false;
    let dict = {};
    try { dict = await window.api.i18n.dict(code); } catch (e) { console.error('[i18n]', e); }
    setLocale(code, dict);
    return true;
  }

  /**
   * The labels app.js writes itself, redone in the new language (components do their own on the same event): the
   * status bar, the MultiExec and update banners, the empty-workspace card, the find counter, a detached window's
   * title. Terminal output is never touched.
   */
  onLanguageChanged() {
    if (!this.info) return;
    $('#st-x11').title = this.info.x11Available ? t('Local X server: {display}', { display: this.info.display }) : t('No X server found (install XQuartz for X11 forwarding)');
    this._syncSidebarToggle();
    if (!this.workspace) return; // before init() finished: nothing else is on screen yet
    this.updateStatus(this.activePane(), this._statusMsg);
    this.updateStatusRight();
    this.updateMultiexec();
    this._renderUpdateBanner();
    const empty = $('#tab-content .workspace-empty');
    if (empty) { empty.remove(); this._syncEmptyState(); }
    if (this.detached) this.onTabUpdated(this.workspace.active);
    const fb = $('#find-bar');
    if (!fb.hidden) {
      if (fb.classList.contains('bad-pattern')) $('#find-count').textContent = t('Invalid pattern');
      else if (this._findLast) this.onFindResults(this.activePane(), this._findLast);
    }
  }

  /**
   * The selected theme colours the whole program: its chrome palette (theme.js) goes on <html> as the CSS custom
   * properties styles.css reads, `color-scheme` makes the native widgets (selects, checkboxes, scrollbars) follow,
   * and the main process gets the window background so the title-bar strip matches, plus the whole token set, which
   * the preload puts on <html> before the first paint of the next launch (no dark flash behind a saved light theme).
   * The active tab, the content area and the empty-state cards take the terminal theme's own colours
   * (`--term-bg/--term-fg`); a session's own theme stays with its pane (TermPane.applyTheme) and its tab (layout.js).
   */
  _applyTheme() {
    const name = THEMES[this.settings.theme] ? this.settings.theme : 'moba-dark';
    const t = THEMES[name], palette = chromePalette(t, name);
    const root = document.documentElement;
    const vars = { ...cssVars(palette), '--term-bg': t.background || '#1e1e1e', '--term-fg': t.foreground || '#ececec' }; // empty-state text stays readable on light themes
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.style.colorScheme = palette.scheme;
    root.dataset.theme = name;
    root.dataset.scheme = palette.scheme;
    this.palette = palette;
    const chrome = { background: palette.bg, scheme: palette.scheme, theme: name, vars };
    const key = JSON.stringify(chrome);
    if (this._chromeKey === key) return;
    this._chromeKey = key;
    window.api.app.chrome(chrome);
  }

  // ---------- actions ----------
  async action(name, arg, pane) {
    const ap = pane || this.activePane();
    switch (name) {
      case 'new-session': return this.editSession(null);
      case 'new-local': return this.newLocalTab();
      case 'quick-connect': return $('#qc-input').focus();
      case 'duplicate': {
        if (!ap || ap.kind === 'empty') return;
        if (ap.kind === 'local') return this.newLocalTab({ cwd: ap.cwd || undefined });
        return this.openSession(ap.session);
      }
      case 'reconnect': return ap && ap.reconnect();
      case 'disconnect': return ap && ap.disconnect();
      case 'rename-tab': return ap && ap.tab && this.workspace.renameTab(ap.tab);
      case 'close': return ap ? (ap.tab.panes().length > 1 ? this.closePane(ap) : this.closeTab(ap.tab)) : null;
      case 'close-pane': return ap && this.closePane(ap);
      case 'close-others': case 'close-left': case 'close-right': case 'close-all': {
        const tab = this.workspace.active;
        return tab ? this.closeTabs(this.workspace.closeTargets(tab, name.slice('close-'.length))) : null;
      }
      case 'pin-tab': return this.togglePin(this.workspace.active);
      case 'detach-tab': return this.detachTab(ap && ap.tab);
      case 'split': return this.splitActive(arg || 'right', pane);
      case 'split-menu': return this.splitMenu($('#btn-split'));
      case 'layout': return this.applyLayout(arg);
      case 'unsplit': return this.unsplit(arg); // arg: 'tabs' | 'active' | 'ask' overrides Settings → Terminal → Unsplit
      case 'next-pane': {
        if (!ap || !ap.tab) return;
        const panes = ap.tab.panes();
        const n = panes[(panes.indexOf(ap) + 1) % panes.length];
        if (n) this.focusPane(n);
        return;
      }
      case 'next-tab': return this.workspace.nextTab(1);
      case 'prev-tab': return this.workspace.nextTab(-1);
      case 'zoom': return ap && ap.zoom(arg === 0 ? 0 : arg > 0 ? 1 : -1);
      case 'zoom-pane': return this.toggleZoom(pane); // ⇧⌘⏎: the pane fills its tab / the layout comes back
      case 'toggle-monitor': return ap && ap.toggleMonitor(arg === undefined ? undefined : !!arg); // View menu / pane head: the remote monitoring bar of this pane
      case 'find': {
        if (!ap) return;
        $('#find-bar').hidden = false;
        document.body.classList.add('find-open');
        $('#find-input').focus();
        $('#find-input').select();
        return;
      }
      case 'find-close':
        $('#find-bar').hidden = true;
        document.body.classList.remove('find-open');
        ap && ap.searchAddon.clearDecorations();
        ap && ap.focus();
        return;
      case 'clear': return ap && ap.clear();
      case 'toggle-sidebar': return this.toggleSidebar();
      case 'sidebar': return this.showPanel(arg);
      case 'multiexec': {
        this.multiexec = !this.multiexec;
        this.updateMultiexec();
        const n = this.multiexecTargets().length;
        toast(!this.multiexec ? t('MultiExec OFF')
          : n === 0 ? t('MultiExec ON: {reason}', { reason: this.multiexecNoneText() })
          : n === 1 && this.workspace.active?.zoomed ? t('MultiExec ON: only the zoomed pane is visible — restore the panes (⇧⌘⏎) to broadcast')
          : n === 1 ? t('MultiExec ON: only 1 terminal is visible — split the tab to broadcast')
          : t('MultiExec ON: input goes to every visible terminal in this tab'), this.multiexec ? 'warn' : 'info');
        return;
      }
      case 'tunnels': return tunnelsDialog(this, typeof arg === 'object' ? arg : {});
      case 'toggle-log': return ap && ap.toggleLog();
      case 'settings': {
        const r = await settingsDialog(this);
        if (r) {
          await this.saveSettings(r);
          toast(t('Settings saved'), 'success');
        }
        return;
      }
      case 'new-folder': return this.sessionTree.newFolder('');
      case 'import-sshconfig': {
        const r = await window.api.sessions.importSshConfig();
        await this.reloadSessions();
        toast(tn('Imported {imported} of {n} host from ~/.ssh/config', 'Imported {imported} of {n} hosts from ~/.ssh/config', r.found, { imported: r.imported }), 'success');
        return;
      }
      case 'import-moba': {
        const r = await window.api.sessions.importMoba().catch((e) => ({ imported: 0, skipped: 0, errors: [ipcMessage(e)] }));
        if (!r) return;
        await this.reloadSessions();
        this.importToast(r, { from: 'MobaXterm.ini', refused: t('Not a MobaXterm.ini file') });
        return;
      }
      case 'import-json': {
        const r = await window.api.sessions.importJson().catch((e) => ({ imported: 0, skipped: 0, errors: [ipcMessage(e)] }));
        if (!r) return;
        await this.reloadSessions();
        this.importToast(r, { refused: t('Not a MobAlt sessions file') });
        return;
      }
      case 'export-json': {
        let f;
        try {
          f = await window.api.sessions.exportJson(); // the path, null when cancelled, { error } when the file could not be written
        } catch (e) {
          return toast(t('Export failed: {error}', { error: ipcMessage(e) }), 'error', 8000);
        }
        if (!f) return;
        if (f.error) return toast(t('Export failed: {error}', { error: f.error }), 'error', 8000);
        toast(t('Exported to {file}', { file: f }), 'success');
        return;
      }
      case 'shortcuts': return shortcutsDialog(this);
      case 'keygen': return keygenDialog(this); // Session → Generate SSH Key…, the Tools panel button
      default:
        console.warn('unknown action', name);
    }
  }
}

const app = new App();
window.app = app;
app.init().catch((e) => {
  console.error(e);
  toast(t('Startup error: {error}', { error: e.message }), 'error', 10000);
});
