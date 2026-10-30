// Application controller: wires main-process events, toolbar/menu actions, panes, panels and dialogs.
import { $, $$, h, toast, confirmDialog, promptDialog, parseQuickConnect, anyModalOpen, modalsShown, contextMenu, icon, applyIcons } from './ui.js';
import { TermPane, THEMES } from './terminal.js';
import { Workspace } from './layout.js';
import { SessionTree } from './sidebar.js';
import { SftpPanel } from './sftp.js';
import { ToolsPanel, MacrosPanel } from './panels.js';
import { sessionEditor, settingsDialog, tunnelsDialog, hostKeyDialog, passwordDialog, kbdIntDialog, shortcutsDialog } from './dialogs.js';

/** Long paths keep their tail (the leaf folder is what matters in a status bar). */
const shortPath = (p) => (!p ? '' : p.length > 56 ? '…' + p.slice(-55) : p);

/** Pane kind for a session type (rdp/vnc never get a pane). */
const kindOf = (type) => ({ local: 'local', telnet: 'telnet', serial: 'serial', mosh: 'mosh', ftp: 'ftp' }[type] || 'ssh');

class App {
  constructor() {
    this.settings = null;
    this.sessions = { sessions: [], folders: [] };
    this.info = {};
    this.panesByTerm = new Map();
    this.multiexec = false;
    this.macroRecorder = null;
    this.focused = null;
  }

  async init() {
    applyIcons(); // static toolbar / panel buttons carry data-icon hooks
    [this.settings, this.sessions, this.info] = await Promise.all([window.api.settings.get(), window.api.sessions.list(), window.api.app.info()]);
    this._applyThemeVar();
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
    $('#st-x11').title = this.info.x11Available ? `Local X server: ${this.info.display}` : 'No X server found (install XQuartz for X11 forwarding)';
    if (!this.settings.sidebarVisible) $('#sidebar').classList.add('collapsed');
    this._syncSidebarToggle();
    this.showPanel(this.settings.sidebarTab || 'sessions');
    let restored = false;
    if (this.settings.restoreWorkspace !== false) {
      try { restored = await this.restoreWorkspace(); } catch (e) { console.error('workspace restore failed', e); }
    }
    if (!restored) await this.newLocalTab();
    this._wsReady = true;
    this.saveWorkspaceSoon();
    setInterval(() => this.saveWorkspaceNow(), 20000);
    window.addEventListener('beforeunload', () => this.saveWorkspaceNow());
  }

  // ---------- workspace persistence (tabs + split layout; survives restarts/updates) ----------
  serializeWorkspace() {
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
      return d;
    };
    const ser = (n) => n.type === 'pane'
      ? { t: 'pane', ...serPane(n.pane) }
      : { t: 'split', dir: n.dir, ratio: n.ratio, children: n.children.map(ser) };
    return {
      v: 1,
      activeTab: Math.max(0, this.workspace.tabs.indexOf(this.workspace.active)),
      tabs: this.workspace.tabs.filter((t) => t.root).map((t) => ({
        title: t.title,
        autoTitle: t.autoTitle,
        color: t.color || null,
        icon: t.icon || null,
        active: Math.max(0, t.panes().indexOf(t.activePane)),
        root: ser(t.root),
      })),
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

  /** Rebuild tabs/panes from the saved workspace. Terminals reconnect (SSH) or start fresh shells (local). */
  async restoreWorkspace() {
    const saved = await window.api.workspace.get();
    if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return false;
    const makePane = (d) => {
      let session = null;
      if (d.sessionId) session = this.sessions.sessions.find((s) => s.id === d.sessionId) || null;
      else if (d.session) session = d.session;
      let kind = d.kind;
      if (kind !== 'local' && kind !== 'empty' && !session) kind = 'empty'; // session was deleted
      if (kind === 'rdp' || kind === 'vnc') kind = 'empty';
      return new TermPane(this, { kind, session, cwd: d.cwd || session?.cwd || undefined });
    };
    const build = (n) => (n.t === 'split' && Array.isArray(n.children) && n.children.length === 2)
      ? { type: 'split', dir: n.dir === 'v' ? 'v' : 'h', ratio: Math.min(0.9, Math.max(0.1, n.ratio || 0.5)), children: n.children.map(build) }
      : { type: 'pane', pane: makePane(n) };
    let any = false;
    const starts = [];
    for (const td of saved.tabs) {
      if (!td || !td.root) continue;
      let root;
      try { root = build(td.root); } catch { continue; }
      const panes = [];
      (function walk(n) { n.type === 'pane' ? panes.push(n.pane) : n.children.forEach(walk); })(root);
      if (!panes.length) continue;
      const tab = this.workspace.newTab(panes[0], td.title || panes[0].title);
      tab.autoTitle = td.autoTitle !== false;
      tab.color = td.color || null;
      tab.icon = td.icon || null;
      tab.root = root;
      for (const p of panes) p.tab = tab;
      tab.activePane = panes[Math.min(td.active || 0, panes.length - 1)];
      this.workspace.render(tab);
      this.workspace.updateTab(tab);
      for (const p of panes) starts.push(p.start().catch(() => {}));
      any = true;
    }
    if (!any) return false;
    const at = this.workspace.tabs[saved.activeTab];
    if (at) this.workspace.activate(at);
    const ap = this.activePane();
    if (ap) this.focusPane(ap, true);
    this.updateMultiexec();
    Promise.allSettled(starts);
    return true;
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
      if (p) p.onExit(info);
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
    window.api.on('sftp:edit-synced', (e) => toast(e.ok ? `Uploaded ${e.remote.split('/').pop()}` : `Upload failed: ${e.error}`, e.ok ? 'success' : 'error'));
    window.api.on('menu:action', ({ action, arg }) => this.action(action, arg));
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
      const panelInput = b.dataset.action === 'sidebar' && $(`#panel-${b.dataset.arg} input`);
      if (panelInput) panelInput.focus();
      else this.activePane()?.focus();
    });
    // toolbar clicks must not steal keyboard focus from the terminal
    for (const b of $$('#toolbar .tb-btn, #side-strip .strip-btn')) b.addEventListener('mousedown', (e) => e.preventDefault());
    // empty workspace accepts a dropped session
    const tc = $('#tab-content');
    tc.addEventListener('dragover', (e) => { if (!this.workspace.tabs.length && e.dataTransfer.types.includes('text/x-mobalt-session')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    tc.addEventListener('drop', (e) => {
      if (this.workspace.tabs.length) return;
      const id = e.dataTransfer.getData('text/x-mobalt-session');
      const s = id && this.sessions.sessions.find((x) => x.id === id);
      if (s) { e.preventDefault(); this.openSession(s); }
    });
    for (const b of $$('.strip-btn[data-panel]')) b.addEventListener('click', () => this.showPanel(b.dataset.panel));
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
    const opts = () => ({ caseSensitive: $('#find-case').checked, regex: $('#find-regex').checked, decorations: { matchBackground: '#515c6a', activeMatchBackground: '#e6b422', activeMatchBorder: '#e6b422', matchOverviewRuler: '#888', activeMatchColorOverviewRuler: '#e6b422' } });
    const research = () => {
      const p = this.activePane();
      if (!p) return;
      p.searchAddon.clearDecorations();
      if (fi.value) p.searchAddon.findNext(fi.value, opts());
      else this.onFindResults(p, { resultCount: 0, resultIndex: -1 });
    };
    fi.addEventListener('input', () => {
      const p = this.activePane();
      if (!p) return;
      if (!fi.value) return research();
      p.searchAddon.findNext(fi.value, { ...opts(), incremental: true });
    });
    for (const id of ['#find-case', '#find-regex']) $(id).addEventListener('change', research); // toggles re-run the search
    fi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.activePane()?.searchAddon.findPrevious(fi.value, opts()) : this.activePane()?.searchAddon.findNext(fi.value, opts()); }
      if (e.key === 'Escape') this.action('find-close');
    });
    for (const b of $$('[data-find]')) b.addEventListener('click', () => {
      const k = b.dataset.find;
      if (k === 'next') this.activePane()?.searchAddon.findNext(fi.value, opts());
      else if (k === 'prev') this.activePane()?.searchAddon.findPrevious(fi.value, opts());
      else this.action('find-close');
    });
    window.addEventListener('resize', () => this.workspace.allPanes().forEach((p) => p.fit()));
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
    for (const b of $$('.strip-btn[data-panel]')) b.classList.toggle('active', b.dataset.panel === name);
    for (const p of $$('.panel')) p.classList.toggle('active', p.id === 'panel-' + name);
    $('#sidebar').classList.remove('collapsed');
    this.saveSettings({ sidebarTab: name, sidebarVisible: true }, true);
    if (name === 'sftp') this.sftpPanel.setPane(this.activePane());
    this.workspace.allPanes().forEach((p) => p.fit());
  }

  toggleSidebar() {
    const sb = $('#sidebar');
    sb.classList.toggle('collapsed');
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
    btn.title = collapsed ? 'Show sidebar (⌘B)' : 'Hide sidebar (⌘B)';
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
    if (pane && pane.tab) queueMicrotask(() => pane.tab.tabEl && this.workspace.updateTab(pane.tab)); // tab dot follows the active pane
    if (this.focused && this.focused !== pane) this.focused.el.classList.remove('focused');
    this.focused = pane;
    pane.el.classList.add('focused');
    if (pane.tab) {
      pane.tab.activePane = pane;
      if (!viaTab && this.workspace.active !== pane.tab) this.workspace.activate(pane.tab);
    }
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
      toast(`Opening ${s.name || s.host} in ${s.type === 'rdp' ? 'Windows App / Remote Desktop' : 'Screen Sharing'}…`, 'info');
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

  async quickConnect(str) {
    const q = parseQuickConnect(str);
    if (!q) return toast('Use user@host[:port] (optionally ssh:// telnet:// rdp:// vnc://)', 'warn');
    const existing = this.sessions.sessions.find((s) => s.type === q.type && s.host === q.host && (s.port || 22) === q.port && (!q.username || s.username === q.username));
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
      if (!(await confirmDialog(`Close "${pane.title}"? The connection will be dropped.`, { okLabel: 'Close', danger: true }))) return;
    }
    const tab = pane.tab;
    pane.dispose();
    this.sftpPanel.dropConnection(pane.termId);
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

  async closeTab(tab) {
    const panes = tab.panes();
    const live = panes.filter((p) => p.status === 'connected' && p.kind !== 'local');
    if (live.length && this.settings.confirmClose) {
      if (!(await confirmDialog(`Close tab "${tab.title}" with ${live.length} live connection(s)?`, { okLabel: 'Close', danger: true }))) return;
    }
    for (const p of panes) {
      p.dispose();
      this.sftpPanel.dropConnection(p.termId);
    }
    this.workspace.removeTab(tab);
    const ap = this.activePane();
    if (ap) this.focusPane(ap, true);
    else this.updateStatus(null);
    this.updateMultiexec();
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
    if (created.length) toast(`${created.length} empty pane(s) added — drag sessions onto them`, 'info');
  }

  /** Open several sessions at once in a new tab laid out as a 2-column grid. */
  async openSessionsInGrid(sessions, cols = 2) {
    const list = sessions.filter((s) => s && s.type !== 'rdp' && s.type !== 'vnc');
    if (!list.length) return;
    const first = await this.openSession(list[0]);
    const tab = first.tab;
    tab.title = `${list.length} sessions`;
    tab.autoTitle = false;
    this.workspace.updateTab(tab);
    const empties = this.workspace.applyGrid(tab, cols, Math.ceil(list.length / cols), () => new TermPane(this, { kind: 'empty' }));
    for (let i = 0; i < empties.length; i++) {
      if (list[i + 1]) await this.replacePane(empties[i], list[i + 1], true);
      else await empties[i].start();
    }
    this.focusPane(first, true);
  }

  /** Close every other pane in the active tab. */
  async unsplit() {
    const ap = this.activePane();
    if (!ap || !ap.tab) return;
    const others = ap.tab.panes().filter((p) => p !== ap);
    const live = others.filter((p) => p.status === 'connected' && p.kind !== 'local' && !p.dead);
    if (live.length && this.settings.confirmClose && !(await confirmDialog(`Close ${others.length} other pane(s)? ${live.length} live connection(s) will be dropped.`, { okLabel: 'Close panes', danger: true }))) return;
    for (const p of others) await this.closePane(p, true);
    this.focusPane(ap, true);
  }

  splitMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const ap = this.activePane();
    const n = ap && ap.tab ? ap.tab.panes().length : 0;
    contextMenu(r.left, r.bottom + 4, [
      { label: 'Split Right (side by side)', key: '⌘D', action: () => this.action('split', 'right') },
      { label: 'Split Down (top / bottom)', key: '⇧⌘D', action: () => this.action('split', 'down') },
      '-',
      { label: 'Layout 1 × 2  (2 side by side)', action: () => this.applyLayout('2x1') },
      { label: 'Layout 2 × 1  (2 stacked)', action: () => this.applyLayout('1x2') },
      { label: 'Layout 2 × 2  (4 panes)', action: () => this.applyLayout('2x2') },
      { label: 'Layout 2 × 3  (6 panes)', action: () => this.applyLayout('2x3') },
      { label: 'Layout 2 × 4  (8 panes)', action: () => this.applyLayout('2x4') },
      '-',
      { label: 'Re-arrange current panes as grid', action: () => this.applyLayout(`2x${Math.max(1, Math.ceil(n / 2))}`), disabled: n < 2 },
      { label: 'Unsplit (keep active pane)', action: () => this.unsplit(), disabled: n < 2 },
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
      if (!(await confirmDialog(`Replace "${pane.title}" with "${session.name}"? The current connection will be dropped.`, { okLabel: 'Replace', danger: true }))) return;
    }
    const kind = kindOf(session.type);
    const next = new TermPane(this, { kind, session, cwd: session.cwd || undefined });
    const tab = pane.tab;
    this.workspace.replace(tab, pane, next);
    pane.dispose();
    this.sftpPanel.dropConnection(pane.termId);
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
    el.textContent = resultCount > 0 ? `${resultIndex >= 0 ? resultIndex + 1 : '–'} / ${resultCount}` : fi.value ? 'No matches' : '';
    $('#find-bar').classList.toggle('no-match', !!fi.value && resultCount === 0);
  }

  /** Hint panel shown in the content area while no tab is open. */
  _syncEmptyState() {
    const host = $('#tab-content');
    const el = host.querySelector('.workspace-empty');
    const empty = !this.workspace.tabs.length;
    if (empty && !el) {
      host.append(h('div', { class: 'workspace-empty' },
        h('div', { class: 'big' }, 'No terminal open'),
        h('div', { class: 'hint' }, 'Drag a session from the Sessions panel here, or:'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small', onclick: () => this.action('new-session') }, '＋ New session  ⌘N'),
          h('button', { class: 'btn small', onclick: () => this.action('new-local') }, '>_ Local terminal  ⌘T'),
          h('button', { class: 'btn small', onclick: () => this.action('quick-connect') }, 'Quick connect  ⇧⌘N'))));
    } else if (!empty && el) el.remove();
  }

  onActiveTabChanged(tab) {
    this._syncEmptyState();
    this.updateStatus(tab ? tab.activePane : null);
    if (tab && tab.activePane) this.sftpPanel.setPane(tab.activePane);
    this.saveWorkspaceSoon();
  }

  onPaneTitle(pane) {
    if (pane.tab && pane.tab.autoTitle && pane.tab.activePane === pane) {
      pane.tab.title = pane.session ? pane.session.name : pane.title;
      pane.tab.icon = pane.session?.icon || null;
      this.workspace.updateTab(pane.tab);
    }
  }

  onPaneStatus(pane, msg) {
    if (pane.tab) this.workspace.updateTab(pane.tab);
    if (this.activePane() === pane) this.updateStatus(pane, msg);
    this.sessionTree.render(); // connected dot / failure state in the tree
  }

  onPaneCwd(pane) {
    if (this.activePane() === pane) this.setStatusCwd(pane.remoteCwd);
    // local shells: the tab/pane title follows the folder (until the shell or the user sets a title)
    if (pane.kind === 'local' && !pane.session && pane.remoteCwd && (pane.title === 'Local' || pane._cwdTitled)) {
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
    if (!pane) {
      el.textContent = 'No session';
      $('#st-cwd').textContent = '';
    } else {
      const s = pane.session;
      const where = pane.kind === 'local' ? 'local shell'
        : pane.kind === 'empty' ? 'empty pane — drag a session here'
        : pane.kind === 'serial' ? `${s?.serialPath} @ ${s?.baudRate}`
        : pane.kind === 'ftp' ? `${s?.username ? s.username + '@' : 'anonymous@'}${s?.host}${s?.port && s.port !== 21 ? ':' + s.port : ''}`
        : `${s?.username ? s.username + '@' : ''}${s?.host}${s?.port && s.port !== 22 ? ':' + s.port : ''}`;
      el.textContent = `${pane.kind.toUpperCase()} · ${where} · ${pane.status}${msg ? ' (' + msg + ')' : ''}`;
      if (pane.kind === 'mosh' && pane.sftpStatus && pane.sftpStatus !== 'idle') el.textContent += ` · SFTP: ${pane.sftpStatus}`;
      const browsing = this.sftpPanel.states.get(pane.kind === 'mosh' ? pane.sftpConnId : pane.termId);
      $('#st-cwd').textContent = pane.dead ? '' : shortPath(pane.remoteCwd || pane.cwd || (browsing && browsing.path) || '');
    }
    $('#st-log').textContent = pane && pane.logging ? '● LOG' : '';
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
    const x = parseInt(el.dataset.xfers || '0', 10), t = parseInt(el.dataset.tunnels || '0', 10);
    el.textContent = [x ? `⇅ ${x} transfer${x > 1 ? 's' : ''}` : '', t ? `⇄ ${t} tunnel${t > 1 ? 's' : ''}` : ''].filter(Boolean).join('  ');
  }

  // ---------- MultiExec ----------
  broadcast(data, from) {
    for (const p of this.workspace.allPanes()) if (!p.dead && p.termId) p.write(data);
  }

  updateMultiexec() {
    $('#multiexec-banner').hidden = !this.multiexec;
    $('#btn-multiexec').classList.toggle('on', this.multiexec);
    $('#multiexec-count').textContent = String(this.workspace.allPanes().filter((p) => !p.dead && p.termId).length);
    this.workspace.allPanes().forEach((p) => p.fit());
  }

  async startSessionTunnels(pane) {
    const list = (pane.session?.tunnels || []).filter((t) => t.enabled !== false);
    const ids = [];
    for (const t of list) {
      try {
        ids.push(await window.api.tunnels.start({ ...t, connId: pane.termId }));
      } catch (e) {
        toast(`Tunnel ${t.bindPort}: ${e.message}`, 'error');
      }
    }
    if (!list.length) return;
    // start() resolves even when the bind failed; report what actually came up
    const all = await window.api.tunnels.list().catch(() => []);
    const mine = all.filter((x) => ids.includes(x.id));
    const failed = mine.filter((x) => x.status === 'error');
    const ok = mine.length - failed.length;
    if (failed.length) toast(`${failed.length} of ${mine.length} tunnel(s) failed for ${pane.title}: ${failed.map((x) => `${x.bindPort} (${x.error || 'error'})`).join('; ')}`, 'error', 7000);
    if (ok) toast(`${ok} tunnel(s) started for ${pane.title}`, 'success');
  }

  // ---------- sessions / settings persistence ----------
  async reloadSessions() {
    this.sessions = await window.api.sessions.list();
    this.sessionTree.render();
  }

  async saveSession(s) {
    const saved = await window.api.sessions.save(s);
    await this.reloadSessions();
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
    const saved = await this.saveSession(r);
    if (connect) this.openSession(saved);
  }

  async saveSettings(patch, quiet = false) {
    this.settings = await window.api.settings.set(patch);
    this._applyThemeVar();
    if (!quiet) this.workspace.allPanes().forEach((p) => p.applySettings(this.settings));
  }

  /** The active tab and the content area take the terminal theme's background. */
  _applyThemeVar() {
    const t = THEMES[this.settings.theme] || THEMES['moba-dark'];
    document.documentElement.style.setProperty('--term-bg', t.background || '#1e1e1e');
    document.documentElement.style.setProperty('--term-fg', t.foreground || '#ececec'); // empty-state text stays readable on light themes
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
      case 'split': return this.splitActive(arg || 'right', pane);
      case 'split-menu': return this.splitMenu($('#btn-split'));
      case 'layout': return this.applyLayout(arg);
      case 'unsplit': return this.unsplit();
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
      case 'multiexec':
        this.multiexec = !this.multiexec;
        this.updateMultiexec();
        toast(this.multiexec ? 'MultiExec ON: input goes to all terminals' : 'MultiExec OFF', this.multiexec ? 'warn' : 'info');
        return;
      case 'tunnels': return tunnelsDialog(this, typeof arg === 'object' ? arg : {});
      case 'toggle-log': return ap && ap.toggleLog();
      case 'settings': {
        const r = await settingsDialog(this);
        if (r) {
          await this.saveSettings(r);
          toast('Settings saved', 'success');
        }
        return;
      }
      case 'new-folder': return this.sessionTree.newFolder('');
      case 'import-sshconfig': {
        const r = await window.api.sessions.importSshConfig();
        await this.reloadSessions();
        toast(`Imported ${r.imported} of ${r.found} host(s) from ~/.ssh/config`, 'success');
        return;
      }
      case 'import-moba': {
        const r = await window.api.sessions.importMoba();
        if (!r) return;
        await this.reloadSessions();
        toast(`Imported ${r.imported} session(s) from MobaXterm.ini`, 'success');
        return;
      }
      case 'import-json': {
        const r = await window.api.sessions.importJson();
        if (!r) return;
        await this.reloadSessions();
        toast(`Imported ${r.imported} session(s)`, 'success');
        return;
      }
      case 'export-json': {
        const f = await window.api.sessions.exportJson();
        if (f) toast(`Exported to ${f}`, 'success');
        return;
      }
      case 'shortcuts': return shortcutsDialog(this);
      default:
        console.warn('unknown action', name);
    }
  }
}

const app = new App();
window.app = app;
app.init().catch((e) => {
  console.error(e);
  toast('Startup error: ' + e.message, 'error', 10000);
});
