// A terminal pane: xterm.js instance bound to a backend terminal (local pty, ssh shell, telnet).
import { h, contextMenu, toast, icon } from './ui.js';
import { connIdOf, errMsg } from './sftp.js';
import { THEMES, searchDecorations } from './theme.js';

/** Text for a failed start: the IPC wrapper stripped and FTP replies translated (see sftp.js errMsg). */
const startErrorText = (e) => errMsg(e);
/** A Mosh client that exits this soon after its spawn never got past the ssh bootstrap. */
const MOSH_BOOTSTRAP_MS = 3000;

const { Terminal } = window;
const FitAddon = window.FitAddon.FitAddon;
const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;
const SearchAddon = window.SearchAddon.SearchAddon;
const WebglAddon = window.WebglAddon.WebglAddon;
const Unicode11Addon = window.Unicode11Addon.Unicode11Addon;

export { THEMES, searchDecorations }; // the palettes live in theme.js; app.js and dialogs.js keep importing them from here

let seq = 0;

export class TermPane {
  /**
   * @param app  application controller
   * @param opts {kind:'local'|'ssh'|'telnet', session: object|null, cwd?: string}
   */
  constructor(app, opts) {
    this.app = app;
    this.id = 'p' + ++seq;
    this.kind = opts.kind; // 'local' | 'ssh' | 'telnet' | 'serial' | 'empty'
    this.session = opts.session || null;
    this.from = opts.from || null; // pane this one was split from (for "duplicate")
    this.cwd = opts.cwd || null;
    this.termId = null;
    this.status = 'idle';
    this.title = this.session ? this.session.name : this.kind === 'empty' ? 'Empty' : 'Local';
    this.remoteCwd = null;
    this.logging = false;
    this.tab = null;
    this.dead = false;
    this.disposed = false;
    this.connectedAt = null;
    this.sftpConnId = null; // Mosh: companion SSH connection the Sftp panel browses through
    this.sftpStatus = 'idle'; // idle | connecting | connected | failed | disconnected

    const s = app.settings;
    const theme = this.themeFor(s);
    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: s.fontFamily,
      fontSize: this.session?.fontSize || s.fontSize,
      lineHeight: s.lineHeight || 1,
      cursorBlink: s.cursorBlink,
      cursorStyle: s.cursorStyle || 'block',
      scrollback: s.scrollback || 10000,
      theme: { ...theme },
      macOptionIsMeta: s.macOptionIsMeta !== false,
      rightClickSelectsWord: false,
      allowTransparency: false,
      minimumContrastRatio: 1,
    });
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.searchAddon.onDidChangeResults((r) => this.app.onFindResults && this.app.onFindResults(this, r));
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new WebLinksAddon((e, uri) => window.api.shell.openExternal(uri)));
    try {
      this.term.loadAddon(new Unicode11Addon());
      this.term.unicode.activeVersion = '11';
    } catch {}

    this.el = h('div', { class: 'pane', dataset: { pane: this.id } },
      (this.headEl = h('div', { class: 'pane-head' },
        h('span', { class: 'dot' }),
        this.session?.icon ? h('span', { class: 'picon' }, this.session.icon) : null,
        (this.headTitle = h('span', { class: 'title' }, this.title)),
        h('button', { title: 'Split right', 'aria-label': 'Split right', onclick: () => app.action('split', 'right', this) }, icon('split')),
        h('button', { title: 'Split down', 'aria-label': 'Split down', onclick: () => app.action('split', 'down', this) }, icon('split-down')),
        h('button', { title: 'Close pane', 'aria-label': 'Close pane', onclick: () => app.closePane(this) }, icon('x'))
      )),
      (this.termEl = h('div', { class: 'pane-term' }))
    );
    if (this.session?.color) this.el.style.setProperty('--pane-color', this.session.color);
    this.el.style.setProperty('--term-bg', theme.background || '#1e1e1e'); // chrome around the cell grid matches the palette from the first paint
    this.el.addEventListener('mousedown', () => app.focusPane(this), true);
    this._wireDnD();

    this.term.onData((d) => this._onInput(d));
    this.term.onBinary((d) => this._onInput(d));
    this.term.onResize(({ cols, rows }) => {
      if (this.termId) window.api.term.resize(this.termId, cols, rows);
    });
    this.term.onTitleChange((t) => {
      this.title = t || this.title;
      this.updateTitle();
    });
    this.term.onSelectionChange(() => {
      if (this.app.settings.copyOnSelect && this.term.hasSelection()) window.api.clipboard.write(this.term.getSelection());
    });
    this.term.parser.registerOscHandler(7, (data) => {
      try {
        const u = new URL(data);
        this.remoteCwd = decodeURIComponent(u.pathname);
        if (this.kind === 'local') this.cwd = this.remoteCwd;
        this.app.onPaneCwd(this);
      } catch {}
      return true;
    });
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (this.dead && e.key === 'Enter') {
        this.reconnect();
        return false;
      }
      // Let macOS menu accelerators (⌘…) through; xterm ignores them anyway.
      if (e.metaKey) return false;
      // Shift+Enter → ESC CR (iTerm2-style): newline in Claude Code and other TUIs
      // instead of submitting. Skip while an IME composition (Korean etc.) is active.
      if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey
          && !e.isComposing && e.keyCode !== 229) {
        this._onInput('\x1b\r');
        return false;
      }
      return true;
    });
  }

  /** Which drop zone the pointer is in: center (replace) or an edge (split in that direction). */
  _dropZone(e) {
    const r = this.el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (this.kind === 'empty') return 'center';
    const edge = 0.22;
    if (x < edge) return 'left';
    if (x > 1 - edge) return 'right';
    if (y < edge) return 'up';
    if (y > 1 - edge) return 'down';
    return 'center';
  }

  _showZone(zone, label) {
    if (!this.zoneEl) {
      this.zoneEl = h('div', { class: 'drop-zone' }, h('span'));
      this.el.append(this.zoneEl);
    }
    this.zoneEl.className = 'drop-zone ' + zone;
    this.zoneEl.firstChild.textContent = label;
  }

  _hideZone() {
    if (this.zoneEl) {
      this.zoneEl.remove();
      this.zoneEl = null;
    }
  }

  _wireDnD() {
    const el = this.el;
    const isPaneDrag = (e) => e.dataTransfer.types.includes('text/x-mobalt-session') || e.dataTransfer.types.includes('text/x-mobalt-tab');
    el.addEventListener('dragover', (e) => {
      if (isPaneDrag(e)) {
        e.preventDefault();
        const isTab = e.dataTransfer.types.includes('text/x-mobalt-tab');
        e.dataTransfer.dropEffect = isTab ? 'move' : 'copy';
        const zone = this._dropZone(e);
        const what = isTab ? 'Move terminal' : 'Open session';
        this._showZone(zone, zone === 'center' ? (this.kind === 'empty' ? `${what} here` : `${what} here (replace)`) : `${what} ${zone}`);
        return;
      }
      if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        el.classList.add('drop-hover');
      }
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove('drop-hover');
        this._hideZone();
      }
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop-hover');
      this._hideZone();
      const sessionId = e.dataTransfer.getData('text/x-mobalt-session');
      const tabId = e.dataTransfer.getData('text/x-mobalt-tab');
      if (sessionId || tabId) {
        this.app.dropOnPane(this, { sessionId, tabId }, this._dropZone(e));
        return;
      }
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) {
        const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean);
        const connId = connIdOf(this);
        if (connId) {
          const dir = this.remoteCwd || (this.kind === 'mosh' && this.app.sftpPanel.states.get(connId)?.path) || (await window.api.sftp.home(connId).catch(() => null));
          if (!dir) return toast('Remote folder unknown', 'warn');
          await this.app.sftpPanel.uploadTo(connId, paths, dir);
          this.app.sftpPanel.show(connId);
        } else if (this.kind === 'mosh' && this.status === 'connected') {
          toast('Open the SFTP browser for this Mosh session first (Sftp panel)', 'warn');
        } else {
          // local terminal: paste the paths (quoted)
          this.write(paths.map((p) => (/[\s'"]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p)).join(' '));
        }
        return;
      }
      const text = e.dataTransfer.getData('text/plain');
      if (text) this.term.paste(text);
    });
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.term.open(this.termEl);
    if (this.kind !== 'empty') this._loadWebgl(); // placeholder panes do not need a GPU context
    this.termEl.addEventListener('contextmenu', (e) => this._contextMenu(e));
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.termEl);
    this.fit();
  }

  fit() {
    if (!this.mounted || this.disposed || !this.el.isConnected || this.termEl.clientWidth < 20 || this.termEl.clientHeight < 20) return;
    try {
      this.fitAddon.fit();
    } catch {}
  }

  focus() {
    this.term.focus();
  }

  /** GPU renderer; a browser keeps only ~16 WebGL contexts, so each pane frees its own on dispose. */
  _loadWebgl() {
    if (this.webgl || !this.mounted) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        this.webgl = null;
        this.applyTheme(); // the DOM renderer that takes over must paint with this pane's palette, not a stale one
      });
      this.term.loadAddon(webgl);
      this.webgl = webgl;
    } catch (e) {
      console.warn('WebGL renderer unavailable, using DOM renderer', e);
    }
  }

  updateTitle() {
    this.headTitle.textContent = this.title;
    this.app.onPaneTitle(this);
  }

  setStatus(status, msg) {
    this.status = status;
    if (status === 'connected') {
      this.connectedAt = Date.now();
      this.dead = false;
      this.hideOverlay();
    }
    this.headEl.querySelector('.dot').className = 'dot ' + status;
    this.app.onPaneStatus(this, msg);
  }

  // ---------- empty pane (split target) ----------
  showPlaceholder() {
    this.hidePlaceholder();
    const from = this.from;
    const dupLabel = from && from.kind !== 'empty' ? `Duplicate "${from.session ? from.session.name : 'Local'}"` : null;
    this.placeholder = h('div', { class: 'pane-placeholder' },
      h('div', { class: 'big' }, 'Empty pane'),
      h('div', { class: 'hint' }, 'Drag a session from the Sessions panel here, or:'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => this.becomeLocal() }, '>_ Local terminal'),
        dupLabel ? h('button', { class: 'btn small', onclick: () => this.app.duplicateInto(this, from) }, dupLabel) : null,
        h('button', { class: 'btn small', onclick: () => this.app.showPanel('sessions') }, 'Show sessions'),
        h('button', { class: 'btn small', onclick: () => this.app.closePane(this, true) }, 'Close')
      )
    );
    this.el.append(this.placeholder);
    this.app.onPaneStatus(this);
  }

  /**
   * FTP sessions have no terminal: the pane shows a card instead. state: 'connecting' | 'connected' |
   * 'failed' (msg = why) | 'disconnected'. Only a live connection offers the card's buttons; a dead one
   * is handled by the overlay (Reconnect / Close) like any other pane.
   */
  showFtpInfo(state = 'connected', msg) {
    this.hidePlaceholder();
    const s = this.session || {};
    const where = `${s.username ? s.username + '@' : 'anonymous@'}${s.host}${s.port && s.port !== 21 ? ':' + s.port : ''}`;
    const live = state === 'connected';
    const hint = live ? `${where} — browse, transfer and edit files in the Sftp panel.`
      : state === 'connecting' ? `Connecting to ${where}…`
      : state === 'failed' ? `Connection to ${where} failed.`
      : `Disconnected from ${where}.`;
    this.placeholder = h('div', { class: `pane-placeholder ftp-info ${state}` },
      h('div', { class: 'big' }, `FTP${s.ftps ? 'S' : ''} · ${s.name || s.host}`),
      h('div', { class: 'hint' }, hint),
      state === 'failed' && msg ? h('div', { class: 'ftp-err' }, msg) : null,
      live ? h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => this.app.sftpPanel.show(this.termId) }, 'Open file browser'),
        h('button', { class: 'btn small', onclick: () => this.app.closePane(this) }, 'Disconnect & close')
      ) : null
    );
    this.el.append(this.placeholder);
    this.termEl.style.visibility = 'hidden'; // no stray cursor behind the info card
  }

  hidePlaceholder() {
    if (this.placeholder) {
      this.placeholder.remove();
      this.placeholder = null;
    }
  }

  async becomeLocal(cwd) {
    this.kind = 'local';
    this.session = null;
    this.cwd = cwd || (this.from && this.from.kind === 'local' ? this.from.cwd : null);
    this.title = 'Local';
    this.hidePlaceholder();
    this.updateTitle();
    this._loadWebgl();
    await this.start();
    this.focus();
  }

  /** Type the session's startup commands into a local/telnet/serial terminal once it is up (SSH does this in main). */
  _sendStartup() {
    const cmd = this.session?.startupCommand;
    if (!cmd) return;
    const id = this.termId;
    setTimeout(() => {
      if (this.termId === id && !this.dead) window.api.term.write(id, cmd + '\r');
    }, 700);
  }

  // ---------- backend ----------
  async start() {
    if (this.kind === 'empty') {
      this.setStatus('idle');
      this.showPlaceholder();
      return;
    }
    const size = { cols: this.term.cols, rows: this.term.rows };
    this.dead = false;
    this.hideOverlay();
    try {
      if (this.kind === 'local') {
        const r = await window.api.term.spawnLocal({ ...size, cwd: this.cwd || undefined, shell: this.session?.shell || undefined });
        this.termId = r.id;
        this.app.registerPane(this);
        this.setStatus('connected');
        this._sendStartup();
      } else if (this.kind === 'ssh') {
        this.setStatus('connecting');
        const r = await window.api.ssh.connect(this.session, size);
        this.termId = r.id;
        this.app.registerPane(this);
      } else if (this.kind === 'telnet') {
        this.setStatus('connecting');
        const r = await window.api.term.spawnTelnet({ host: this.session.host, port: this.session.port || 23, ...size });
        this.termId = r.id;
        this.app.registerPane(this);
        this.setStatus('connected');
        this._sendStartup();
      } else if (this.kind === 'serial') {
        this.setStatus('connecting');
        const s = this.session;
        const r = await window.api.term.spawnSerial({
          path: s.serialPath, baudRate: s.baudRate, dataBits: s.dataBits, stopBits: s.stopBits, parity: s.parity,
          flow: s.flow, localEcho: s.localEcho, newline: s.newline,
        });
        this.termId = r.id;
        this.app.registerPane(this);
        this.setStatus('connected');
        this._sendStartup();
      } else if (this.kind === 'mosh') {
        this.setStatus('connecting');
        const s = this.session;
        // main verifies the host key (app prompt) before the client is spawned; a declined key rejects here
        const r = await window.api.term.spawnMosh({ name: s.name, host: s.host, port: s.port || 22, username: s.username, privateKeyPath: s.privateKeyPath, moshServer: s.moshServer, moshPredict: s.moshPredict, legacyAlgorithms: !!s.legacyAlgorithms, ...size });
        this.termId = r.id;
        this.app.registerPane(this);
        this._moshStartedAt = Date.now();
        this._moshScreen = false; // set once mosh-client takes over the terminal (alternate screen)
        this._killed = false;
        this.setStatus('connected');
        this._startupOnData = !!s.startupCommand; // typed once mosh-client has drawn the remote screen
        // files: a companion SSH connection feeds the Sftp panel — automatically like SSH sessions, else on demand
        if (s.sftpAuto !== false && this.app.settings.sftpAutoOpen !== false) this.openSftpCompanion();
        else if (this.app.activePane() === this) this.app.sftpPanel.setPane(this);
      } else if (this.kind === 'ftp') {
        this.setStatus('connecting');
        this.showFtpInfo('connecting');
        const r = await window.api.ftp.connect(this.session);
        this.termId = r.id;
        this.app.registerPane(this);
        this.remoteCwd = r.home;
        this.setStatus('connected');
        this.showFtpInfo();
        if (this.session?.sftpAuto !== false && this.app.settings.sftpAutoOpen !== false) this.app.sftpPanel.show(this.termId);
        else if (this.app.activePane() === this) this.app.sftpPanel.setPane(this);
      }
      if (this.session?.logging && this.kind !== 'ftp') this.toggleLog(true);
    } catch (e) {
      const why = startErrorText(e);
      this.term.write(`\r\n\x1b[31mFailed to start: ${why}\x1b[0m\r\n`);
      if (this.kind === 'ftp') this.showFtpInfo('failed', why); // the card covers the terminal text
      this.setStatus('failed', why);
      this.markDead();
    }
  }

  _onInput(d) {
    if (this.dead || this.kind === 'empty') return;
    if (this.app.macroRecorder) this.app.macroRecorder.text += d;
    if (this.app.multiexec) this.app.broadcast(d, this);
    else this.write(d);
  }

  write(d) {
    if (this.termId) window.api.term.write(this.termId, d);
  }

  onData(data) {
    if (this.kind === 'mosh' && !this._moshScreen && data.includes('\x1b[?1049h')) this._moshScreen = true; // mosh-client is up
    if (this._startupOnData) {
      this._startupOnData = false;
      setTimeout(() => this._sendStartup(), 800);
    }
    this.term.write(data);
  }

  /** Toast / terminal line for a connection the server or the network ended (exit reason 'lost'). */
  lostMessage(detail) {
    const s = this.session || {};
    const where = s.name || `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;
    return detail ? `Connection to ${where} was lost: ${detail}` : `Connection to ${where} was closed by the server`;
  }

  onExit({ id, code, reason, detail }) {
    if (id && this.termId && id !== this.termId) return; // stale exit of a backend we already replaced
    const wasConnecting = this.status === 'connecting';
    this.app.unregisterPane(this);
    this.termId = null;
    this.closeSftpCompanion();
    let failed = reason === 'failed';
    let msg;
    // A Mosh client that quits without ever drawing the remote screen (or within seconds of its spawn)
    // never connected: that is a failure, not a session that ended.
    if (this.kind === 'mosh' && !this._killed && (!this._moshScreen || Date.now() - (this._moshStartedAt || 0) < MOSH_BOOTSTRAP_MS)) {
      failed = true;
      msg = `mosh exited${code ? ' with code ' + code : ''}`;
      this.term.write('\r\n\x1b[31mMosh could not connect — see the output above; is mosh-server installed on the host and UDP 60000-61000 open?\x1b[0m\r\n');
    }
    const lost = reason === 'lost'; // not a Disconnect, ⌘W or `exit`: say so in the terminal (app.js toasts it too)
    this.setStatus(failed ? 'failed' : 'disconnected', lost ? 'connection lost' : msg);
    if (this.kind === 'local' && code === 0 && !wasConnecting) {
      this.app.closePane(this, true);
      return;
    }
    this.markDead(lost ? this.lostMessage(detail) + '.' : null);
  }

  /** The pane is over: a dim line (what = why, default "Session ended.") and the Reconnect / Close overlay. */
  markDead(what) {
    this.dead = true;
    this.term.write(`\r\n\x1b[2m── ${what || 'Session ended.'} Press Enter to reconnect, ⌘W to close. ──\x1b[0m\r\n`);
    this.showOverlay(what ? 'Connection lost.' : null);
  }

  showOverlay(label) {
    this.hideOverlay();
    this.overlay = h('div', { class: 'pane-overlay' },
      h('span', {}, label || (this.kind === 'local' ? 'Shell exited.' : 'Session ended.')),
      h('button', { onclick: () => this.reconnect() }, '↻ Reconnect'),
      h('button', { onclick: () => this.app.closePane(this) }, 'Close')
    );
    this.el.append(this.overlay);
  }

  hideOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  async reconnect() {
    if (this.termId) {
      await this.disconnect();
      // the old backend's exit event may still be in flight: forget its id now so it cannot be
      // mistaken for the new connection (see onExit)
      this.app.unregisterPane(this);
      this.termId = null;
    }
    this.term.write('\r\n');
    await this.start();
    this.focus();
  }

  async disconnect() {
    if (!this.termId) return;
    const id = this.termId;
    if (this.kind === 'ssh') await window.api.ssh.disconnect(id);
    else if (this.kind === 'ftp') {
      // FTP has no exit event: the pane goes through the same motions itself (status, dots, panel state, card)
      await window.api.ftp.disconnect(id);
      this.app.sftpPanel.dropConnection(id);
      if (this.termId !== id) return; // reconnected meanwhile
      this.app.unregisterPane(this);
      this.termId = null;
      this.showFtpInfo('disconnected');
      this.setStatus('disconnected');
      this.markDead();
    } else {
      this._killed = true; // a Mosh client ending on request is a disconnect, never a failure
      this.closeSftpCompanion();
      window.api.term.kill(id);
    }
  }

  // ---------- Mosh: files through a companion SSH connection ----------
  /**
   * A Mosh pane has no SSH channel in the app, so the Sftp panel uses a separate shell-less SSH
   * connection to the same host (same key/agent/prompts as an SSH session). The panel is shown
   * once it is connected; calling this again while connected just shows the panel.
   */
  async openSftpCompanion() {
    if (this.kind !== 'mosh' || this.dead || this.disposed || !this.session) return;
    if (this.sftpConnId || this.sftpStatus === 'connecting') {
      if (this.sftpStatus === 'connected') this.app.sftpPanel.show(this.sftpConnId);
      return;
    }
    const s = this.session;
    // id lets main merge the stored passphrase/password; ssh.js drops it before connecting, so this
    // SSH-typed copy can never be written back over the Mosh session
    const cfg = { id: s.id, name: s.name, type: 'ssh', host: s.host, port: s.port || 22, username: s.username, authMethod: s.authMethod || 'auto', privateKeyPath: s.privateKeyPath };
    const gen = (this._sftpGen = (this._sftpGen || 0) + 1);
    this.sftpStatus = 'connecting';
    this.sftpError = null;
    this.app.onPaneStatus(this);
    if (this.app.activePane() === this) this.app.sftpPanel.setPane(this); // empty state shows "connecting"
    try {
      const r = await window.api.ssh.connectSftp(cfg);
      if (this._sftpGen !== gen || this.disposed) { // pane closed or reconnected meanwhile
        window.api.ssh.disconnect(r.id);
        return;
      }
      this.sftpConnId = r.id;
    } catch (e) {
      if (this._sftpGen === gen) this.onCompanionStatus('failed', e.message);
    }
  }

  /** ssh:status of the companion connection (routed here by the app). */
  onCompanionStatus(state, msg) {
    if (state === 'connecting') return;
    this.sftpStatus = state;
    if (state === 'connected') this.app.sftpPanel.show(this.sftpConnId);
    else {
      const id = this.sftpConnId;
      this.sftpConnId = null;
      if (id) this.app.sftpPanel.dropConnection(id);
      if (state === 'failed') {
        this.sftpError = msg || 'connection failed';
        toast(`SFTP for Mosh session "${this.session?.name || this.title}" (via SSH): ${this.sftpError}`, 'error', 6000);
      }
      if (this.app.activePane() === this) this.app.sftpPanel.setPane(this);
    }
    this.app.onPaneStatus(this);
  }

  /** Drop the companion connection (pane closed, disconnected or reconnecting). */
  closeSftpCompanion() {
    this._sftpGen = (this._sftpGen || 0) + 1; // a connect still in flight is discarded on arrival
    const id = this.sftpConnId;
    this.sftpConnId = null;
    this.sftpStatus = 'idle';
    this.sftpError = null;
    if (!id) return;
    this.app.sftpPanel.dropConnection(id);
    window.api.ssh.disconnect(id);
  }

  async toggleLog(force) {
    const on = force !== undefined ? force : !this.logging;
    if (!this.termId) return;
    if (on) {
      const file = await window.api.term.logStart(this.termId, this.title);
      this.logging = true;
      this.logFile = file;
      toast(`Logging to ${file}`, 'success');
    } else {
      await window.api.term.logStop(this.termId);
      this.logging = false;
      toast('Logging stopped', 'info');
    }
    this.app.onPaneStatus(this);
  }

  clear() {
    this.term.clear();
  }

  zoom(delta) {
    const s = this.app.settings;
    if (delta === 0) this.term.options.fontSize = s.fontSize;
    else this.term.options.fontSize = Math.max(8, Math.min(40, this.term.options.fontSize + delta));
    this.fit();
  }

  applySettings(s) {
    this.term.options.fontFamily = s.fontFamily;
    this.term.options.fontSize = this.session?.fontSize || s.fontSize;
    this.term.options.lineHeight = s.lineHeight || 1;
    this.term.options.cursorBlink = s.cursorBlink;
    this.term.options.cursorStyle = s.cursorStyle;
    this.term.options.scrollback = s.scrollback;
    this.applyTheme(s);
    this.term.options.macOptionIsMeta = s.macOptionIsMeta !== false;
    this.fit();
  }

  /** The palette this pane should show: the session's own theme, else the global one. */
  themeFor(s = this.app.settings) {
    return THEMES[this.session?.theme || s.theme] || THEMES['moba-dark'];
  }

  /**
   * (Re)apply the palette to xterm and the pane chrome (`--term-bg`) so the two always agree. A fresh
   * theme object is handed to xterm on purpose: it only repaints when the object changes, and after a
   * re-mount (split / layout change) or a WebGL → DOM renderer fallback we want a repaint even when the
   * theme did not change.
   */
  applyTheme(s = this.app.settings) {
    if (this.disposed) return;
    const theme = this.themeFor(s);
    this.term.options.theme = { ...theme };
    this.el.style.setProperty('--term-bg', theme.background || '#1e1e1e');
    this.el.style.setProperty('--term-fg', theme.foreground || '#ececec');
  }

  async paste() {
    const t = await window.api.clipboard.read();
    if (t) this.term.paste(t);
  }

  copy() {
    if (this.term.hasSelection()) window.api.clipboard.write(this.term.getSelection());
  }

  _contextMenu(e) {
    e.preventDefault();
    if (this.app.settings.rightClickPaste && !e.shiftKey) {
      if (this.term.hasSelection()) {
        this.copy();
        this.term.clearSelection();
      } else this.paste();
      return;
    }
    contextMenu(e.clientX, e.clientY, [
      { label: 'Copy', key: '⌘C', action: () => this.copy(), disabled: !this.term.hasSelection() },
      { label: 'Paste', key: '⌘V', action: () => this.paste() },
      { label: 'Select All', action: () => this.term.selectAll() },
      '-',
      { label: 'Find…', key: '⌘F', action: () => this.app.action('find') },
      { label: 'Clear', key: '⌘K', action: () => this.clear() },
      '-',
      { label: 'Split Right', key: '⌘D', action: () => this.app.action('split', 'right', this) },
      { label: 'Split Down', key: '⇧⌘D', action: () => this.app.action('split', 'down', this) },
      '-',
      { label: this.logging ? 'Stop Session Log' : 'Start Session Log…', action: () => this.toggleLog() },
      this.kind === 'ssh' || this.kind === 'ftp' ? { label: this.kind === 'ftp' ? 'Open file browser' : 'Open SFTP Browser', action: () => this.app.sftpPanel.show(this.termId) } : null,
      this.kind === 'mosh' ? { label: 'Open SFTP Browser', action: () => this.openSftpCompanion(), disabled: this.dead } : null,
      this.kind !== 'local' ? { label: this.dead ? 'Reconnect' : 'Disconnect', action: () => (this.dead ? this.reconnect() : this.disconnect()) } : null,
      '-',
      { label: 'Close Pane', key: '⇧⌘W', action: () => this.app.closePane(this) },
    ]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ro) this.ro.disconnect();
    this.closeSftpCompanion();
    if (this.termId) {
      const id = this.termId;
      if (this.kind === 'ssh') window.api.ssh.disconnect(id);
      else if (this.kind === 'ftp') window.api.ftp.disconnect(id); // not a terminal backend: term.kill would miss it
      else {
        this._killed = true;
        window.api.term.kill(id);
      }
      this.app.unregisterPane(this);
      this.app.sftpPanel.dropConnection(id);
      this.termId = null;
    }
    try { this.webgl && this.webgl.dispose(); } catch {}
    this.webgl = null;
    try {
      this.term.dispose();
    } catch {}
    this.el.remove();
  }
}
