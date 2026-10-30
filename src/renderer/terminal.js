// A terminal pane: xterm.js instance bound to a backend terminal (local pty, ssh shell, telnet).
import { h, contextMenu, toast } from './ui.js';

const { Terminal } = window;
const FitAddon = window.FitAddon.FitAddon;
const WebLinksAddon = window.WebLinksAddon.WebLinksAddon;
const SearchAddon = window.SearchAddon.SearchAddon;
const WebglAddon = window.WebglAddon.WebglAddon;
const Unicode11Addon = window.Unicode11Addon.Unicode11Addon;

export const THEMES = {
  'moba-dark': { background: '#1e1e1e', foreground: '#ececec', cursor: '#b4b4c0', cursorAccent: '#1e1e1e', selectionBackground: 'rgba(78,161,255,.35)',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff' },
  'one-dark': { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: 'rgba(82,139,255,.3)',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: 'rgba(68,71,90,.8)',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  'solarized-dark': { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: 'rgba(7,54,66,.9)',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  'gruvbox-dark': { background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: 'rgba(80,73,69,.9)',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' },
  light: { background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: 'rgba(0,120,215,.25)',
    black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
    brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5' },
};

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

    const s = app.settings;
    this.term = new Terminal({
      allowProposedApi: true,
      fontFamily: s.fontFamily,
      fontSize: this.session?.fontSize || s.fontSize,
      lineHeight: s.lineHeight || 1,
      cursorBlink: s.cursorBlink,
      cursorStyle: s.cursorStyle || 'block',
      scrollback: s.scrollback || 10000,
      theme: THEMES[this.session?.theme || s.theme] || THEMES['moba-dark'],
      macOptionIsMeta: s.macOptionIsMeta !== false,
      rightClickSelectsWord: false,
      allowTransparency: false,
      minimumContrastRatio: 1,
    });
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
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
        h('button', { title: 'Split right', onclick: () => app.action('split', 'right', this) }, '◫'),
        h('button', { title: 'Split down', onclick: () => app.action('split', 'down', this) }, '▭'),
        h('button', { title: 'Close pane', onclick: () => app.closePane(this) }, '✕')
      )),
      (this.termEl = h('div', { class: 'pane-term' }))
    );
    if (this.session?.color) this.el.style.setProperty('--pane-color', this.session.color);
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
        if (this.kind === 'ssh' && this.status === 'connected') {
          const dir = this.remoteCwd || (await window.api.sftp.home(this.termId).catch(() => null));
          if (!dir) return toast('Remote folder unknown', 'warn');
          await window.api.sftp.upload(this.termId, paths, dir);
          toast(`Uploading ${paths.length} item(s) to ${dir}`, 'info');
          this.app.sftpPanel.show(this.termId);
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
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch (e) {
      console.warn('WebGL renderer unavailable, using DOM renderer', e);
    }
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
      }
      if (this.session?.logging) this.toggleLog(true);
    } catch (e) {
      this.term.write(`\r\n\x1b[31mFailed to start: ${e.message}\x1b[0m\r\n`);
      this.setStatus('failed', e.message);
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
    this.term.write(data);
  }

  onExit({ code, reason }) {
    const wasConnecting = this.status === 'connecting';
    this.app.unregisterPane(this);
    this.termId = null;
    this.setStatus(reason === 'failed' ? 'failed' : 'disconnected');
    if (this.kind === 'local' && code === 0 && !wasConnecting) {
      this.app.closePane(this, true);
      return;
    }
    this.markDead();
  }

  markDead() {
    this.dead = true;
    this.term.write(`\r\n\x1b[90m── Session ended. Press Enter to reconnect, ⌘W to close. ──\x1b[0m\r\n`);
    this.showOverlay();
  }

  showOverlay() {
    this.hideOverlay();
    this.overlay = h('div', { class: 'pane-overlay' },
      h('span', {}, this.kind === 'local' ? 'Shell exited.' : 'Session ended.'),
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
    }
    this.term.write('\r\n');
    await this.start();
    this.focus();
  }

  async disconnect() {
    if (!this.termId) return;
    const id = this.termId;
    if (this.kind === 'ssh') await window.api.ssh.disconnect(id);
    else window.api.term.kill(id);
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
    this.term.options.theme = THEMES[this.session?.theme || s.theme] || THEMES['moba-dark'];
    this.term.options.macOptionIsMeta = s.macOptionIsMeta !== false;
    this.fit();
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
      this.kind === 'ssh' ? { label: 'Open SFTP Browser', action: () => this.app.sftpPanel.show(this.termId) } : null,
      this.kind !== 'local' ? { label: this.dead ? 'Reconnect' : 'Disconnect', action: () => (this.dead ? this.reconnect() : this.disconnect()) } : null,
      '-',
      { label: 'Close Pane', key: '⇧⌘W', action: () => this.app.closePane(this) },
    ]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ro) this.ro.disconnect();
    if (this.termId) {
      const id = this.termId;
      if (this.kind === 'ssh') window.api.ssh.disconnect(id);
      else window.api.term.kill(id);
      this.app.unregisterPane(this);
      this.termId = null;
    }
    try {
      this.term.dispose();
    } catch {}
    this.el.remove();
  }
}
