// Application controller: wires main-process events, toolbar/menu actions, panes, panels and dialogs.
import { $, $$, h, toast, confirmDialog, promptDialog, parseQuickConnect, anyModalOpen } from './ui.js';
import { TermPane } from './terminal.js';
import { Workspace } from './layout.js';
import { SessionTree } from './sidebar.js';
import { SftpPanel } from './sftp.js';
import { ToolsPanel, MacrosPanel } from './panels.js';
import { sessionEditor, settingsDialog, tunnelsDialog, hostKeyDialog, passwordDialog, kbdIntDialog, shortcutsDialog } from './dialogs.js';

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
    [this.settings, this.sessions, this.info] = await Promise.all([window.api.settings.get(), window.api.sessions.list(), window.api.app.info()]);
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
    this.showPanel(this.settings.sidebarTab || 'sessions');
    await this.newLocalTab();
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
      if (!p) return;
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
    for (const b of $$('[data-action]')) b.addEventListener('click', () => this.action(b.dataset.action, b.dataset.arg));
    for (const b of $$('.strip-btn[data-panel]')) b.addEventListener('click', () => this.showPanel(b.dataset.panel));
    $('#quick-connect').addEventListener('submit', (e) => {
      e.preventDefault();
      this.quickConnect($('#qc-input').value);
    });
    // sidebar resize
    const rs = $('#sidebar-resizer');
    rs.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const start = e.clientX, w0 = $('#sidebar').getBoundingClientRect().width;
      const move = (ev) => document.documentElement.style.setProperty('--sidebar-w', Math.max(180, Math.min(700, w0 + ev.clientX - start)) + 'px');
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
    const opts = () => ({ caseSensitive: $('#find-case').checked, regex: $('#find-regex').checked, decorations: { matchBackground: '#515c6a', activeMatchBackground: '#e6b422', matchOverviewRuler: '#888', activeMatchColorOverviewRuler: '#e6b422' } });
    fi.addEventListener('input', () => this.activePane()?.searchAddon.findNext(fi.value, { ...opts(), incremental: true }));
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
    this.workspace.allPanes().forEach((p) => p.fit());
  }

  // ---------- panes / tabs ----------
  activePane() {
    return this.workspace.active ? this.workspace.active.activePane : null;
  }

  paneByTerm(id) {
    return this.panesByTerm.get(id);
  }

  registerPane(pane) {
    this.panesByTerm.set(pane.termId, pane);
  }

  unregisterPane(pane) {
    if (pane.termId) this.panesByTerm.delete(pane.termId);
  }

  focusPane(pane, viaTab = false) {
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

  /** Open a saved/ad-hoc session. opts.split = 'right'|'down' to open next to the active pane. */
  async openSession(s, opts = {}) {
    if (!s) return;
    if (s.type === 'rdp') return window.api.launch.rdp(s);
    if (s.type === 'vnc') return window.api.launch.vnc(s);
    const kind = s.type === 'local' ? 'local' : s.type === 'telnet' ? 'telnet' : 'ssh';
    const pane = new TermPane(this, { kind, session: s, cwd: s.cwd || undefined });
    if (opts.split && this.activePane()) {
      const target = this.activePane();
      this.workspace.split(target.tab, target, opts.split, pane);
    } else {
      const tab = this.workspace.newTab(pane, s.name);
      if (s.color) { tab.color = s.color; this.workspace.updateTab(tab); }
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
      if (!(await confirmDialog(`Close "${pane.title}"? The connection will be dropped.`, { okLabel: 'Close' }))) return;
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
      if (!(await confirmDialog(`Close tab "${tab.title}" with ${live.length} live connection(s)?`, { okLabel: 'Close' }))) return;
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

  async splitActive(dir, fromPane) {
    const target = fromPane || this.activePane();
    if (!target) return this.newLocalTab();
    let pane;
    if (target.kind === 'local') pane = new TermPane(this, { kind: 'local', cwd: target.cwd || undefined });
    else pane = new TermPane(this, { kind: target.kind, session: target.session });
    this.workspace.split(target.tab, target, dir, pane);
    this.focusPane(pane);
    await pane.start();
    pane.focus();
    this.updateMultiexec();
  }

  onActiveTabChanged(tab) {
    this.updateStatus(tab ? tab.activePane : null);
    if (tab && tab.activePane) this.sftpPanel.setPane(tab.activePane);
  }

  onPaneTitle(pane) {
    if (pane.tab && pane.tab.autoTitle && pane.tab.activePane === pane) {
      pane.tab.title = pane.session ? pane.session.name : pane.title;
      this.workspace.updateTab(pane.tab);
    }
  }

  onPaneStatus(pane, msg) {
    if (pane.tab) this.workspace.updateTab(pane.tab);
    if (this.activePane() === pane) this.updateStatus(pane, msg);
    if (pane.status !== 'connected') this.sessionTree.render();
  }

  onPaneCwd(pane) {
    if (this.activePane() === pane) this.setStatusCwd(pane.remoteCwd);
    this.sftpPanel.onPaneCwd(pane);
  }

  updateStatus(pane, msg) {
    const el = $('#st-session');
    if (!pane) {
      el.textContent = 'No session';
      $('#st-cwd').textContent = '';
    } else {
      const s = pane.session;
      const where = pane.kind === 'local' ? 'local shell' : `${s?.username ? s.username + '@' : ''}${s?.host}${s?.port && s.port !== 22 ? ':' + s.port : ''}`;
      el.textContent = `${pane.kind.toUpperCase()} · ${where} · ${pane.status}${msg ? ' (' + msg + ')' : ''}`;
      $('#st-cwd').textContent = pane.remoteCwd || pane.cwd || '';
    }
    $('#st-log').textContent = pane && pane.logging ? '● LOG' : '';
    $('#st-log').classList.toggle('on', !!(pane && pane.logging));
  }

  setStatusCwd(p) {
    $('#st-cwd').textContent = p || '';
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
    $('#multiexec-count').textContent = String(this.workspace.allPanes().filter((p) => !p.dead).length);
    this.workspace.allPanes().forEach((p) => p.fit());
  }

  async startSessionTunnels(pane) {
    const list = (pane.session?.tunnels || []).filter((t) => t.enabled !== false);
    for (const t of list) {
      try {
        await window.api.tunnels.start({ ...t, connId: pane.termId });
      } catch (e) {
        toast(`Tunnel ${t.bindPort}: ${e.message}`, 'error');
      }
    }
    if (list.length) toast(`${list.length} tunnel(s) started for ${pane.title}`, 'success');
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
    if (!quiet) this.workspace.allPanes().forEach((p) => p.applySettings(this.settings));
  }

  // ---------- actions ----------
  async action(name, arg, pane) {
    const ap = pane || this.activePane();
    switch (name) {
      case 'new-session': return this.editSession(null);
      case 'new-local': return this.newLocalTab();
      case 'quick-connect': return $('#qc-input').focus();
      case 'duplicate': {
        if (!ap) return;
        if (ap.kind === 'local') return this.newLocalTab({ cwd: ap.cwd || undefined });
        return this.openSession(ap.session);
      }
      case 'reconnect': return ap && ap.reconnect();
      case 'disconnect': return ap && ap.disconnect();
      case 'rename-tab': return ap && ap.tab && this.workspace.renameTab(ap.tab);
      case 'close': return ap ? (ap.tab.panes().length > 1 ? this.closePane(ap) : this.closeTab(ap.tab)) : null;
      case 'close-pane': return ap && this.closePane(ap);
      case 'split': return this.splitActive(arg || 'right', pane);
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
        $('#find-input').focus();
        $('#find-input').select();
        return;
      }
      case 'find-close':
        $('#find-bar').hidden = true;
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
      case 'shortcuts': return shortcutsDialog();
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
