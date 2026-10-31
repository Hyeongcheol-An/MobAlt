// A terminal pane: xterm.js instance bound to a backend terminal (local pty, ssh shell, telnet).
import { h, contextMenu, toast, icon } from './ui.js';
import { connIdOf, errMsg } from './sftp.js';
import { THEMES, searchDecorations, terminalTheme } from './theme.js';
import { formatBytes, formatRate, formatUptime, formatLoad, memPercent, meterLevel } from './monitor.js';
import { TermHighlighter, DEFAULT_RULES, highlightPalette } from './highlight.js';
import { t, tn, onChange } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()

/** The marker the main process puts in front of its status lines (terminals.js STATUS_DIM / STATUS_FAIL): painted in _paint, where the pane's palette is known. */
const STATUS_RE = /\x1b\]7704;(dim|fail)\x07/g;

/**
 * The label of a drop zone while a tab (isTab) or a session is dragged over the pane: 'center' (an empty pane takes
 * it), 'replace' (a pane in use is replaced), or the edge the pane would be split at. One literal per case: a sentence
 * is never assembled from pieces.
 */
function zoneLabel(isTab, zone) {
  if (isTab) {
    switch (zone) {
      case 'center': return t('Move terminal here');
      case 'replace': return t('Move terminal here (replace)');
      case 'left': return t('Move terminal left');
      case 'right': return t('Move terminal right');
      case 'up': return t('Move terminal up');
      default: return t('Move terminal down');
    }
  }
  switch (zone) {
    case 'center': return t('Open session here');
    case 'replace': return t('Open session here (replace)');
    case 'left': return t('Open session left');
    case 'right': return t('Open session right');
    case 'up': return t('Open session up');
    default: return t('Open session down');
  }
}

/** The notes the monitoring strip shows instead of a sample, by the key _monitorRender() is called with. */
const MONITOR_NOTES = {
  'monitoring…': () => t('monitoring…'),
  'monitor unavailable': () => t('monitor unavailable'),
};

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

/**
 * WebGL budget. Chromium keeps at most 16 live WebGL contexts per renderer process and silently loses the oldest when a
 * 17th is created (the pane painted white for 3 s, then fell back to DOM rendering for good). So a pane holds a GPU
 * context only while it is on screen — a pane of the active tab that is not hidden behind a zoomed sibling — and at
 * most this many panes of a window do at once (a 2 × 4 grid is 8); the rest draw with xterm's DOM renderer, which
 * keeps the buffer and takes over invisibly. layout.js calls syncWebgl() on every visibility change.
 */
export const WEBGL_BUDGET = 12;

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
    this._defaultTitle = this.session ? null : this._kindTitle(); // the kind's own title, re-labelled on a language switch while the title is still it
    this.title = this.session ? this.session.name : this._defaultTitle;
    this.remoteCwd = null;
    this.logging = false;
    this.tab = null;
    this.zoomed = false; // filling its tab (layout.js setZoom → setZoomed)
    this.multiexecExcluded = false; // the Exclude box under the terminal (MobaXterm's per-terminal MultiExec switch): runtime only, reset when the mode goes off
    this.dead = false;
    this.disposed = false;
    this.connectedAt = null;
    this.sftpConnId = null; // Mosh: companion SSH connection the Sftp panel browses through
    this.sftpStatus = 'idle'; // idle | connecting | connected | failed | disconnected
    // remote monitoring bar (SSH: this connection; Mosh: the SFTP companion while it is up)
    this.monitorOverride = null; // the pane-head / View menu toggle: null follows the session's setting (then Settings), else true | false
    this.monitorOn = false; // polling: a timer is pending, a poll is in flight or the pane waits off screen
    this.monitorTimer = null;
    this.monitorPaused = false; // the pane was not on screen at the last tick; monitorResume() polls again
    this.monitorFailed = false; // "monitor unavailable": no polling until the next connection or a manual toggle
    this.monitorErrors = 0;
    this.monitorSample = null; // the last sample shown (tests read it)
    this.webgl = null; // the WebGL addon while this pane is on screen (syncWebgl), null while the DOM renderer draws
    this.webglLost = false; // the GPU took the context away: no new one until the pane is hidden and shown again
    this.webglLosses = 0; // context-loss events so far (tests assert 0 under the budget)

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
      theme: terminalTheme(theme), // the palette plus a selection band that is visible on it (theme.js)
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
    this.highlighter = new TermHighlighter(this.term); // keyword highlighting (highlight.js): rules, colours and on/off from _syncHighlight
    this._syncHighlight(s);

    this.el = h('div', { class: 'pane', dataset: { pane: this.id } },
      (this.headEl = h('div', { class: 'pane-head' },
        h('span', { class: 'dot' }),
        this.session?.icon ? h('span', { class: 'picon' }, this.session.icon) : null,
        (this.headTitle = h('span', { class: 'title' }, this.title)),
        (this.zoomBadge = h('span', { class: 'zoom-badge', hidden: true }, t('zoomed'))),
        (this.zoomBtn = h('button', { class: 'zoom', title: t('Zoom pane (⇧⌘⏎)'), 'aria-label': t('Zoom pane'), 'aria-pressed': 'false', onclick: () => app.action('zoom-pane', undefined, this) }, icon('zoom'))),
        // the monitoring bar toggle: an ARIA toggle like ⤢ (a stable name, aria-pressed carries the state); SSH / Mosh panes only
        (this.monBtn = h('button', { class: 'monitor', title: t('Show remote monitoring bar'), 'aria-label': t('Remote monitoring bar'), 'aria-pressed': 'false', hidden: !this.monitorAllowed(), onclick: () => app.action('toggle-monitor', undefined, this) }, icon('monitor'))),
        (this.splitRightBtn = h('button', { title: t('Split right'), 'aria-label': t('Split right'), onclick: () => app.action('split', 'right', this) }, icon('split'))),
        (this.splitDownBtn = h('button', { title: t('Split down'), 'aria-label': t('Split down'), onclick: () => app.action('split', 'down', this) }, icon('split-down'))),
        (this.closeBtn = h('button', { title: t('Close pane'), 'aria-label': t('Close pane'), onclick: () => app.closePane(this) }, icon('x')))
      )),
      // the remote monitoring strip: a status region that is never announced (it changes every few seconds)
      (this.monitorEl = h('div', { class: 'pane-monitor', role: 'status', 'aria-live': 'off', 'aria-label': t('Remote monitoring'), hidden: true })),
      (this.termEl = h('div', { class: 'pane-term' })),
      // MobaXterm's per-terminal MultiExec switch: a strip under the terminal, shown while the mode is on
      // (syncMultiexecStrip), with the one checkbox `Exclude "<title>" from MultiExec mode` — ticked, the pane stays on
      // screen and connected but gets no broadcast keystrokes. Right-click / ⇧F10 on it: the mode's bulk menu (app.js).
      (this.mxEl = h('div', { class: 'pane-mx', role: 'group', hidden: true, oncontextmenu: (e) => this._mxMenu(e), onkeydown: (e) => this._mxKey(e) },
        h('label', { class: 'mx-label' },
          (this.mxBox = h('input', { type: 'checkbox', class: 'mx-box', onchange: () => this.setMultiexecExcluded(this.mxBox.checked) })),
          (this.mxCaption = h('span', { class: 'mx-caption' })))))
    );
    this._mxRelabel();
    if (this.session?.color) this.el.style.setProperty('--pane-color', this.session.color);
    this.el.style.setProperty('--term-bg', theme.background || '#1e1e1e'); // chrome around the cell grid matches the palette from the first paint
    this.el.addEventListener('mousedown', () => app.focusPane(this), true);
    this._wireDnD();
    this._i18nOff = onChange(() => this._relabel()); // a language switch: the labels this pane keeps on screen (dispose() unsubscribes)

    this.term.onData((d) => this._onInput(d));
    this.term.onBinary((d) => this._onInput(d));
    this.term.onScroll((y) => this._onScroll(y)); // "Synchronize mouse wheel scrolling" (MultiExec bulk menu)
    this.term.onResize(({ cols, rows }) => {
      if (this.termId) window.api.term.resize(this.termId, cols, rows);
    });
    this.term.onTitleChange((title) => {
      this.title = title || this.title;
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
        this._showZone(zone, zoneLabel(isTab, zone === 'center' && this.kind !== 'empty' ? 'replace' : zone));
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
          if (!dir) return toast(t('Remote folder unknown'), 'warn');
          await this.app.sftpPanel.uploadTo(connId, paths, dir);
          this.app.sftpPanel.show(connId);
        } else if (this.kind === 'mosh' && this.status === 'connected') {
          toast(t('Open the SFTP browser for this Mosh session first (Sftp panel)'), 'warn');
        } else {
          // local terminal: paste the paths (quoted)
          this.write(paths.map((p) => (/[\s'"]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p)).join(' '));
        }
        return;
      }
      const text = e.dataTransfer.getData('text/plain');
      if (text) this.pasteText(text); // dropped text is a paste: the guard sees it first
    });
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.term.open(this.termEl);
    // A lost context is handled here, before the addon's own listener: that one would preventDefault() and wait 3 s for
    // a restore that never comes (the pane white meanwhile). Capture phase, because the event does not bubble and the
    // canvas is the addon's. Disposing the addon drops its listener, so the wait is never started.
    this.termEl.addEventListener('webglcontextlost', () => this._onWebglLost(), true);
    this.termEl.addEventListener('contextmenu', (e) => this._contextMenu(e));
    this.termEl.addEventListener('wheel', () => { this._wheelAt = performance.now(); }, { capture: true, passive: true }); // _onScroll tells a wheel scroll from output arriving
    // ⌘V, Edit → Paste and the native context menu all land as a `paste` event on xterm's textarea (or its element);
    // taking it in the capture phase on the pane keeps xterm's own listeners from sending the clipboard straight to
    // the shell, so the paste guard (app.js guardPaste) sees every paste before the terminal does.
    this.termEl.addEventListener('paste', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (text) this.pasteText(text);
    }, true);
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.termEl);
    this.fit();
    this.syncWebgl(); // a GPU context only when this pane is on screen (and the budget allows)
  }

  fit() {
    if (!this.mounted || this.disposed || !this.el.isConnected || this.termEl.clientWidth < 20 || this.termEl.clientHeight < 20) return;
    try {
      this.fitAddon.fit();
    } catch {}
    this.monitorResume(); // a pane that just came on screen (tab switch, un-zoom, layout) polls again
  }

  focus() {
    this.term.focus();
  }

  // ---------- WebGL budget (see WEBGL_BUDGET) ----------
  /** On screen: mounted, a terminal (not a placeholder or FTP card), in the window's active tab and not behind a zoomed sibling. */
  visibleInTab() {
    if (this.disposed || !this.mounted || this.kind === 'empty' || this.kind === 'ftp' || !this.tab || !this.el.isConnected) return false;
    const ws = this.app.workspace;
    return !!ws && ws.active === this.tab && (!this.tab.zoomed || this.tab.zoomed === this);
  }

  /** Live GPU contexts in this window. */
  static webglCount(app) {
    return app.workspace ? app.workspace.allPanes().filter((p) => p.webgl).length : 0;
  }

  /**
   * Match the renderer to the pane's visibility: a pane that just came on screen takes a GPU context (budget allowing,
   * and unless its last one was lost while it was on screen — the retry waits for the next activation), a pane that
   * went off screen gives its own back so the panes shown next can have one. Called by layout.js on tab activation,
   * zoom, re-layout and mount; idempotent. Returns true while the pane draws with WebGL.
   *
   * The context is taken a few frames after the pane came on screen, not at once: xterm pauses a hidden terminal's
   * rendering (an IntersectionObserver) and resumes it only after the first paint, so a renderer swapped in right
   * away would show an empty canvas for a frame or two. Meanwhile the DOM rows drawn when the pane went off screen
   * are shown; then, between two paints, the WebGL renderer takes over and draws before the next one — no blank.
   */
  syncWebgl() {
    if (this.visibleInTab()) {
      if (!this.webgl && !this.webglLost) this._scheduleWebgl();
    } else {
      this.webglLost = false; // shown again later = a new try
      if (this.webgl) this._dropWebgl();
    }
    return !!this.webgl;
  }

  /** Two animation frames (xterm's observer has resumed the terminal by then) and a task: the swap lands between paints. */
  _scheduleWebgl() {
    if (this._webglPending) return;
    this._webglPending = true;
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      this._webglPending = false;
      if (this.visibleInTab() && !this.webgl && !this.webglLost) this._loadWebgl();
    }, 0)));
  }

  /** GPU renderer, within the budget; false when the DOM renderer stays (no budget, no WebGL, not mounted). */
  _loadWebgl() {
    if (this.webgl || !this.mounted || this.disposed || this.kind === 'empty' || this.kind === 'ftp') return !!this.webgl;
    if (TermPane.webglCount(this.app) >= WEBGL_BUDGET) return false;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => this._onWebglLost()); // the addon's own 3 s path, should the capture listener ever miss the event
      this.term.loadAddon(webgl);
      this.webgl = webgl;
    } catch (e) {
      console.warn('WebGL renderer unavailable, using DOM renderer', e);
    }
    return !!this.webgl;
  }

  /** Back to the DOM renderer at once: it has the buffer and repaints in this pane's palette (no blank frame). */
  _dropWebgl() {
    const webgl = this.webgl;
    if (!webgl) return;
    this.webgl = null;
    try { webgl.dispose(); } catch (e) { console.warn('WebGL addon dispose failed', e); }
    if (this.disposed) return;
    this.applyTheme(); // the DOM renderer that takes over must paint with this pane's palette, not a stale one
    try { this.term.refresh(0, this.term.rows - 1); } catch {}
  }

  /** The GPU took this pane's context (16 contexts in the process, a GPU reset): DOM renderer now, WebGL again on the next activation. */
  _onWebglLost() {
    if (!this.webgl) return;
    this.webglLosses++;
    this.webglLost = true;
    console.warn(`WebGL context lost on pane ${this.id}: DOM renderer until the pane is shown again`);
    this._dropWebgl();
  }

  updateTitle() {
    this.headTitle.textContent = this.title;
    this._mxRelabel(); // the Exclude box names the pane (MobaXterm v21.5: the terminal title is written in the checkbox)
    this.app.onPaneTitle(this);
  }

  /** The title a pane without a session starts with: the placeholder's "Empty", a shell's "Local" (until the shell or the folder names it). */
  _kindTitle() {
    return this.kind === 'empty' ? t('Empty') : t('Local');
  }

  /** True while the title is still the kind's own (no session, no OSC title, not yet named after the folder): app.js may compare against this instead of the English "Local". */
  titleIsDefault() {
    return !!this._defaultTitle && this.title === this._defaultTitle;
  }

  /**
   * A language switch (i18n:changed): every label this pane keeps on screen is drawn again in the new language — the
   * default title, the head's badge and buttons, the monitoring strip (its note or the meter labels of the last
   * sample), the Reconnect / Close overlay, the empty-pane placeholder and the FTP card. Lines already written into
   * the terminal stay as they were: a buffer is never rewritten.
   */
  _relabel() {
    if (this.disposed) return;
    if (this.titleIsDefault()) {
      this.title = this._defaultTitle = this._kindTitle();
      this.updateTitle();
    }
    this.zoomBadge.textContent = t('zoomed');
    this.zoomBtn.title = this.zoomed ? t('Restore panes (⇧⌘⏎)') : t('Zoom pane (⇧⌘⏎)');
    this.zoomBtn.setAttribute('aria-label', t('Zoom pane'));
    this.monBtn.setAttribute('aria-label', t('Remote monitoring bar'));
    this.monBtn.title = this.monitorEnabled() ? t('Hide remote monitoring bar') : t('Show remote monitoring bar');
    for (const [btn, label] of [[this.splitRightBtn, t('Split right')], [this.splitDownBtn, t('Split down')], [this.closeBtn, t('Close pane')]]) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    this.monitorEl.setAttribute('aria-label', t('Remote monitoring'));
    this._mxRelabel();
    if (!this.monitorEl.hidden) {
      if (this._monitorNote) this._monitorRender(null, this._monitorNote.note, this._monitorNote.detail);
      else if (this.monitorSample) this._monitorRender(this.monitorSample);
    }
    if (this.overlay) this.showOverlay(this._overlayReason);
    if (this.placeholder) {
      if (this.kind === 'ftp' && this._ftpInfo) this.showFtpInfo(this._ftpInfo.state, this._ftpInfo.msg);
      else if (this.kind === 'empty') this.showPlaceholder();
    }
  }

  /**
   * Head state while this pane fills its tab (layout.js setZoom): badge, pressed ⤢/⤡ button, `.zoomed` on the pane.
   * The button is an ARIA toggle: its accessible name stays "Zoom pane" and aria-pressed carries the state (a changing
   * name would be read as "Restore panes, pressed"); only the tooltip says what the next press does.
   */
  setZoomed(on) {
    on = !!on;
    if (this.zoomed === on) return;
    this.zoomed = on;
    this.el.classList.toggle('zoomed', on);
    this.zoomBadge.hidden = !on;
    this.zoomBtn.replaceChildren(icon(on ? 'unzoom' : 'zoom'));
    this.zoomBtn.title = on ? t('Restore panes (⇧⌘⏎)') : t('Zoom pane (⇧⌘⏎)');
    this.zoomBtn.setAttribute('aria-pressed', String(on));
  }

  // ---------- MultiExec: the per-terminal switch ----------
  /** A terminal MultiExec could write to: live, not a placeholder or an FTP card (app.js multiexecCandidates adds "on screen"). */
  multiexecCandidate() {
    return !this.disposed && !this.dead && !!this.termId && this.kind !== 'empty' && this.kind !== 'ftp';
  }

  /** The strip's caption, tooltip and group name follow the title (updateTitle) and the language (_relabel). */
  _mxRelabel() {
    const caption = t('Exclude "{title}" from MultiExec mode', { title: this.title });
    this.mxCaption.textContent = caption;
    this.mxEl.title = caption; // the caption is clipped to the pane's width, never wrapped: the tooltip carries it whole
    this.mxEl.setAttribute('aria-label', t('MultiExec: {title}', { title: this.title }));
  }

  /**
   * Show the strip while MultiExec is on and this pane is a candidate, hide it otherwise (app.js updateMultiexec calls
   * this on every change); the terminal re-fits around it like around the monitoring bar. The box always shows the flag.
   */
  syncMultiexecStrip() {
    if (this.disposed) return;
    const on = !!this.app.multiexec && this.multiexecCandidate();
    this.mxBox.checked = this.multiexecExcluded;
    if (this.mxEl.hidden === !on) return;
    this.mxEl.hidden = !on;
    this.fit(); // the strip takes a row from the terminal
  }

  /**
   * Tick / untick the Exclude box: the pane stays on screen and connected, out of (or back in) the broadcast set at
   * once — no dialog, no disconnect. Typing into an excluded pane still reaches its own shell (app.js broadcast).
   * `update: false` lets a bulk action (Activate all / none, Invert) recount the banner once.
   */
  setMultiexecExcluded(on, { update = true } = {}) {
    on = !!on;
    this.multiexecExcluded = on;
    this.mxBox.checked = on;
    this.el.classList.toggle('mx-excluded', on);
    if (update) this.app.updateMultiexec();
  }

  /** Right-click on the strip: MobaXterm's bulk menu of the mode (Activate all / none, Invert selection, synchronised scrolling). */
  _mxMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    this.app.multiexecMenu(e.clientX, e.clientY);
  }

  /** ⇧F10 / the Menu key on the focused box: the same menu, under the box; Esc hands the focus back to it (ui.js). */
  _mxKey(e) {
    if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return;
    e.preventDefault();
    e.stopPropagation();
    const r = this.mxBox.getBoundingClientRect();
    this.app.multiexecMenu(r.left, r.bottom + 2);
  }

  /**
   * The viewport moved (xterm onScroll, y = the new top line). With "Synchronize mouse wheel scrolling" on, a wheel
   * scroll of this pane moves the other MultiExec terminals by the same number of lines (app.js syncScroll); output
   * arriving at the bottom, a search hit or a scroll done on another pane's behalf moves this viewport too and is not
   * passed on — only a scroll right after a wheel event in this pane is.
   */
  _onScroll(y) {
    const prev = this._ydisp ?? y;
    this._ydisp = y;
    if (y === prev || !this.app.multiexec || !this.app.multiexecSyncScroll || this.app._syncingScroll) return;
    if (performance.now() - (this._wheelAt || 0) > 250) return;
    this.app.syncScroll(this, y - prev);
  }

  /** Scroll the viewport by `delta` lines on behalf of another pane (clamped by xterm; never fed back: syncScroll guards). */
  scrollBy(delta) {
    try { this.term.scrollLines(delta); } catch {}
  }

  setStatus(status, msg) {
    this.status = status;
    if (status === 'connected') {
      this.connectedAt = Date.now();
      this.dead = false;
      this.hideOverlay();
    }
    this.headEl.querySelector('.dot').className = 'dot ' + status;
    if (status === 'connected') this.monitorFailed = false; // a new connection gets a new try
    this.syncMonitor(); // the bar polls a connected pane and hides on anything else
    this.app.onPaneStatus(this, msg);
  }

  // ---------- empty pane (split target) ----------
  showPlaceholder() {
    this.hidePlaceholder();
    const from = this.from;
    const dupLabel = from && from.kind !== 'empty' ? t('Duplicate "{name}"', { name: from.session ? from.session.name : t('Local') }) : null;
    this.placeholder = h('div', { class: 'pane-placeholder' },
      h('div', { class: 'big' }, t('Empty pane')),
      h('div', { class: 'hint' }, t('Drag a session from the Sessions panel here, or:')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => this.becomeLocal() }, t('>_ Local terminal')),
        dupLabel ? h('button', { class: 'btn small', onclick: () => this.app.duplicateInto(this, from) }, dupLabel) : null,
        h('button', { class: 'btn small', onclick: () => this.app.showPanel('sessions') }, t('Show sessions')),
        h('button', { class: 'btn small', onclick: () => this.app.closePane(this, true) }, t('Close'))
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
    this._ftpInfo = { state, msg }; // drawn again in the new language on a switch (_relabel)
    const s = this.session || {};
    const where = `${s.username ? s.username + '@' : 'anonymous@'}${s.host}${s.port && s.port !== 21 ? ':' + s.port : ''}`;
    const live = state === 'connected';
    const hint = live ? t('{where} — browse, transfer and edit files in the Sftp panel.', { where })
      : state === 'connecting' ? t('Connecting to {where}…', { where })
      : state === 'failed' ? t('Connection to {where} failed.', { where })
      : t('Disconnected from {where}.', { where });
    this.placeholder = h('div', { class: `pane-placeholder ftp-info ${state}` },
      h('div', { class: 'big' }, `FTP${s.ftps ? 'S' : ''} · ${s.name || s.host}`), // the protocol and the session's name: no words to translate
      h('div', { class: 'hint' }, hint),
      state === 'failed' && msg ? h('div', { class: 'ftp-err' }, msg) : null,
      live ? h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => this.app.sftpPanel.show(this.termId) }, t('Open file browser')),
        h('button', { class: 'btn small', onclick: () => this.app.closePane(this) }, t('Disconnect & close'))
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
    this.title = this._defaultTitle = this._kindTitle();
    this.hidePlaceholder();
    this.updateTitle();
    this.syncWebgl(); // a terminal now: a GPU context when it is on screen
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
        const r = await window.api.term.spawnMosh({ name: s.name, host: s.host, port: s.port || 22, username: s.username, privateKeyPath: s.privateKeyPath, moshServer: s.moshServer, moshPredict: s.moshPredict, legacyAlgorithms: !!s.legacyAlgorithms, algorithms: s.algorithms, ...size });
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
      this.term.write(`\r\n\x1b[31m${t('Failed to start: {why}', { why })}\x1b[0m\r\n`);
      if (this.kind === 'ftp') this.showFtpInfo('failed', why); // the card covers the terminal text
      this.setStatus('failed', why);
      this.markDead();
    }
  }

  _onInput(d) {
    if (this.dead || this.kind === 'empty' || this._replaying) return; // a replay's answers to terminal queries are not keystrokes
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
    this.term.write(this._paint(data));
  }

  /**
   * Colour the status lines main writes (Zmodem progress, "Connecting to…", failures): their OSC 7704 marker becomes a
   * true-colour SGR from this pane's theme — the dim text and the red of highlight.js's palette, both pushed until they
   * read at 4.5:1 on the terminal background (SGR 90 was invisible on Solarized Dark, SGR 31 under 4.5:1 on most).
   */
  _paint(data) {
    if (data.indexOf('\x1b]7704;') < 0) return data;
    if (!this._statusSgr) {
      const p = highlightPalette(this.themeFor());
      const sgr = (hex) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
      this._statusSgr = { dim: sgr(p.dim), fail: sgr(p.red) };
    }
    const c = this._statusSgr;
    return data.replace(STATUS_RE, (_, k) => c[k] || '');
  }

  /** Toast / terminal line for a connection the server or the network ended (exit reason 'lost'); `sentence`: with its full stop (the dead line). */
  lostMessage(detail, sentence = false) {
    const s = this.session || {};
    const where = s.name || `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;
    if (sentence) return detail ? t('Connection to {where} was lost: {detail}.', { where, detail }) : t('Connection to {where} was closed by the server.', { where });
    return detail ? t('Connection to {where} was lost: {detail}', { where, detail }) : t('Connection to {where} was closed by the server', { where });
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
      msg = code ? t('mosh exited with code {code}', { code }) : t('mosh exited');
      this.term.write(`\r\n\x1b[31m${t('Mosh could not connect — see the output above; is mosh-server installed on the host and UDP 60000-61000 open?')}\x1b[0m\r\n`);
    }
    const lost = reason === 'lost'; // not a Disconnect, ⌘W or `exit`: say so in the terminal (app.js toasts it too)
    this.setStatus(failed ? 'failed' : 'disconnected', lost ? t('connection lost') : msg);
    if (this.kind === 'local' && code === 0 && !wasConnecting) {
      this.app.closePane(this, true);
      return;
    }
    this.markDead(lost ? this.lostMessage(detail, true) : null);
  }

  /** The pane is over: a dim line (what = why, a sentence; default "Session ended.") and the Reconnect / Close overlay. */
  markDead(what) {
    this.dead = true;
    this.term.write(`\r\n\x1b[2m${t('── {what} Press Enter to reconnect, ⌘W to close. ──', { what: what || t('Session ended.') })}\x1b[0m\r\n`);
    this.showOverlay(what ? 'lost' : null);
  }

  /** The Reconnect / Close overlay; reason 'lost' says the connection was lost, anything else that the session (or the shell) ended. */
  showOverlay(reason) {
    this.hideOverlay();
    this._overlayReason = reason || null; // drawn again in the new language on a switch (_relabel)
    this.overlay = h('div', { class: 'pane-overlay' },
      h('span', {}, reason === 'lost' ? t('Connection lost.') : this.kind === 'local' ? t('Shell exited.') : t('Session ended.')),
      h('button', { onclick: () => this.reconnect() }, t('↻ Reconnect')),
      h('button', { onclick: () => this.app.closePane(this) }, t('Close'))
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
    // the session's Advanced SSH settings (legacy preset, algorithm lists, jump host) travel along, as for the host-key check
    const cfg = { id: s.id, name: s.name, type: 'ssh', host: s.host, port: s.port || 22, username: s.username, authMethod: s.authMethod || 'auto', privateKeyPath: s.privateKeyPath,
      legacyAlgorithms: !!s.legacyAlgorithms, algorithms: s.algorithms, jumpSessionId: s.jumpSessionId || '', jumpHost: s.jumpHost || '' };
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
        this.sftpError = msg || t('connection failed');
        toast(t('SFTP for Mosh session "{name}" (via SSH): {error}', { name: this.session?.name || this.title, error: this.sftpError }), 'error', 6000);
      }
      if (this.app.activePane() === this) this.app.sftpPanel.setPane(this);
    }
    if (state === 'connected') this.monitorFailed = false;
    this.syncMonitor(); // a Mosh pane's monitoring bar lives on the companion connection
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
    this.syncMonitor();
  }

  // ---------- remote monitoring bar ----------
  /** SSH panes poll their own connection; a Mosh pane has no SSH channel in the app and uses its SFTP companion while that is up. */
  monitorAllowed() {
    return this.kind === 'ssh' || this.kind === 'mosh';
  }

  /** Whether the bar is wanted: the pane's own toggle, else the session's "Show remote monitoring bar", else Settings. */
  monitorEnabled() {
    if (!this.monitorAllowed()) return false;
    if (this.monitorOverride !== null) return this.monitorOverride;
    if (this.session && typeof this.session.monitor === 'boolean') return this.session.monitor;
    return this.app.settings.monitorBar !== false;
  }

  /** The connection polled: the pane's own (SSH) or the Mosh companion's id; null while there is none. */
  monitorConnId() {
    if (this.kind === 'mosh') return this.sftpStatus === 'connected' ? this.sftpConnId : null;
    return this.kind === 'ssh' && this.status === 'connected' && this.termId ? this.termId : null;
  }

  /** On screen: the window is visible and the pane is laid out (a hidden tab page or a zoomed sibling has no size). */
  monitorVisible() {
    return document.visibilityState === 'visible' && this.mounted && this.el.isConnected && this.termEl.clientWidth > 0 && this.termEl.clientHeight > 0;
  }

  monitorInterval() {
    const s = Number(this.app.settings.monitorInterval);
    return (Number.isFinite(s) ? Math.min(30, Math.max(2, s)) : 3) * 1000;
  }

  /**
   * Start or stop polling to match the state (connection, companion, toggle, settings) and keep the head button in
   * step. A pane whose host could not run the snippet keeps its dim "monitor unavailable" line without polling until
   * it reconnects or is toggled by hand.
   */
  syncMonitor() {
    if (this.disposed) return;
    const enabled = this.monitorEnabled();
    const want = enabled && !!this.monitorConnId();
    if (!want) this._monitorStop();
    else if (!this.monitorFailed && !this.monitorOn) this._monitorStart();
    this.monBtn.setAttribute('aria-pressed', String(enabled));
    this.monBtn.title = enabled ? t('Hide remote monitoring bar') : t('Show remote monitoring bar');
  }

  /** The head button, the View menu and the context menu: show / hide the bar of this pane (force: true | false). */
  toggleMonitor(force) {
    if (!this.monitorAllowed()) {
      toast(t('The remote monitoring bar needs an SSH or Mosh session'), 'info');
      return;
    }
    const on = force !== undefined ? !!force : !this.monitorEnabled();
    this.monitorOverride = on;
    this.monitorFailed = false;
    this.syncMonitor();
    if (on && !this.monitorConnId()) toast(this.kind === 'mosh' ? t('The monitoring bar appears once the SFTP companion connection is up') : t('The monitoring bar appears once the session is connected'), 'info');
  }

  _monitorStart() {
    this.monitorOn = true;
    this.monitorErrors = 0;
    this.monitorSample = null;
    this._monitorFresh();
    this._monitorRender(null, 'monitoring…');
    this._monitorShow(true);
    if (!this.monitorRo) { // the strip folds its items to the pane's width (see _monitorFit)
      this.monitorRo = new ResizeObserver(() => this._monitorFit());
      this.monitorRo.observe(this.monitorEl);
    }
    this._monitorTick();
  }

  _monitorStop() {
    this.monitorOn = false;
    this.monitorPaused = false;
    if (this.monitorTimer) {
      clearTimeout(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.monitorRo) {
      this.monitorRo.disconnect();
      this.monitorRo = null;
    }
    this._monitorFresh();
    this._monitorShow(false);
  }

  _monitorShow(on) {
    if (this.monitorEl.hidden === !on) return;
    this.monitorEl.hidden = !on;
    this.fit(); // the strip takes a row from the terminal, like the banners
  }

  _monitorSchedule(ms) {
    if (this.monitorTimer) clearTimeout(this.monitorTimer);
    this.monitorTimer = setTimeout(() => {
      this.monitorTimer = null;
      this._monitorTick();
    }, ms);
  }

  /** Poll again after a pause off screen (tab switch, un-zoom, the window shown again); a no-op otherwise. */
  monitorResume() {
    if (this.monitorOn && this.monitorPaused && !this.monitorTimer && this.monitorVisible()) {
      this.monitorPaused = false;
      this._monitorTick();
    }
  }

  async _monitorTick() {
    if (!this.monitorOn || this.disposed || this.monitorTimer) return;
    if (!this.monitorVisible()) { // nothing is polled off screen; fit() / visibilitychange resume it
      this.monitorPaused = true;
      return;
    }
    const id = this.monitorConnId();
    if (!id) return this.syncMonitor();
    let r;
    try {
      r = await window.api.ssh.monitor(id);
    } catch (e) {
      r = { error: errMsg(e) };
    }
    if (!this.monitorOn || this.disposed || this.monitorConnId() !== id) return; // stopped or reconnected meanwhile
    if (r && r.sample) {
      const first = !this.monitorSample;
      this.monitorErrors = 0;
      this.monitorSample = r.sample;
      this._monitorFresh();
      this._monitorRender(r.sample);
      // rates need two samples: the second one comes after a second, then every interval
      this._monitorSchedule(first && (r.sample.cpu === null || r.sample.rx === null) ? 1000 : this.monitorInterval());
    } else {
      this.monitorErrors++;
      if ((r && r.fatal) || this.monitorErrors >= 3) { // no sh, permission denied, a shell that cannot run it: stop asking
        this.monitorFailed = true;
        this.monitorOn = false;
        this._monitorFresh();
        this._monitorRender(null, 'monitor unavailable', r && r.error ? t('Remote monitoring: {error}', { error: r.error }) : '');
      } else {
        this._monitorStale(r && r.error); // the last sample stays, dimmed and dated, until a poll succeeds again
        this._monitorSchedule(this.monitorInterval());
      }
    }
  }

  /**
   * Paint a sample (small labelled meters + text), or a note with a tooltip: `note` is one of the MONITOR_NOTES keys
   * ('monitoring…', 'monitor unavailable' — the English text, shown translated). Both are drawn again on a language
   * switch (_relabel).
   */
  _monitorRender(sample, note, detail) {
    const el = this.monitorEl;
    el.classList.toggle('unavailable', !sample && note === 'monitor unavailable');
    this.monitorItems = null;
    this.monitorLine = '';
    this._monitorNote = sample ? null : { note, detail };
    el.title = '';
    delete el.dataset.fit;
    if (!sample) {
      el.replaceChildren(h('span', { class: 'mon-note', title: detail || undefined }, MONITOR_NOTES[note] ? MONITOR_NOTES[note]() : note || ''));
      if (this.monitorStaleEl) el.append(this.monitorStaleEl);
      return;
    }
    const bars = [];
    const meter = (label, pct, text, title) => {
      const bar = h('span', { class: 'mon-bar ' + meterLevel(pct), 'aria-hidden': 'true' }, h('i', { style: { width: `${pct === null ? 0 : Math.round(pct)}%` } }));
      bars.push(bar);
      return h('span', { class: 'mon-item', title }, h('span', { class: 'mon-label' }, label), bar, h('span', { class: 'mon-val' }, text));
    };
    const memPct = memPercent(sample);
    const cpu = sample.cpu === null ? '—' : `${Math.round(sample.cpu)}%`;
    const mem = sample.memTotal ? `${formatBytes(sample.memUsed)} / ${formatBytes(sample.memTotal)}` : '—';
    const disk = sample.diskPct === null ? '—' : `${Math.round(sample.diskPct)}%`;
    const rx = `↓ ${formatRate(sample.rx)}`, tx = `↑ ${formatRate(sample.tx)}`;
    const load = formatLoad(sample.load), up = formatUptime(sample.uptime);
    const cpuTitle = sample.cpu === null ? t('CPU: measured between two polls')
      : sample.os === 'darwin' ? t('CPU {pct}% (sum of the processes over the cores)', { pct: sample.cpu })
      : t('CPU {pct}% (busy time between the last two polls)', { pct: sample.cpu });
    const items = {
      cpu: meter('CPU', sample.cpu, cpu, cpuTitle),
      mem: meter(t('Mem'), memPct, mem, memPct === null ? t('Memory: unknown') : t('Memory in use: {pct}% of {total}', { pct: Math.round(memPct), total: formatBytes(sample.memTotal) })),
      disk: meter(t('Disk'), sample.diskPct, disk, t('Root filesystem (/) in use')),
      net: h('span', { class: 'mon-item', title: t('Network: received ↓ / sent ↑, every interface but loopback, averaged since the last poll') }, h('span', { class: 'mon-val' }, rx), h('span', { class: 'mon-val' }, tx)),
      load: h('span', { class: 'mon-item', title: t('Load average over 1, 5 and 15 minutes') }, h('span', { class: 'mon-label' }, t('load')), h('span', { class: 'mon-val' }, load)),
      up: h('span', { class: 'mon-item', title: t('Uptime') }, h('span', { class: 'mon-label' }, t('up')), h('span', { class: 'mon-val' }, up)),
      host: h('span', { class: 'mon-host', title: sample.host ? t('Host: {host}', { host: sample.host }) : undefined }, sample.host || ''),
    };
    this.monitorItems = { ...items, bars };
    // the whole strip as one line: the tooltip of a folded strip (see _monitorFit)
    this.monitorLine = [t('CPU {value}', { value: cpu }), t('Mem {value}', { value: mem }), t('Disk {value}', { value: disk }), `${rx} ${tx}`, t('load {value}', { value: load }), t('up {value}', { value: up }), sample.host ? t('host {host}', { host: sample.host }) : ''].filter(Boolean).join(' · ');
    el.replaceChildren(items.cpu, items.mem, items.disk, items.net, items.load, items.up, items.host);
    if (this.monitorStaleEl) el.insertBefore(this.monitorStaleEl, items.host);
    this._monitorFit();
  }

  /**
   * A narrow pane (a split, the 900 px window) cannot show the whole strip, which used to clip silently: items go by
   * priority — host name, uptime, load, the three meters' bars, network — until the rest fits, and the full line
   * moves into the strip's tooltip. data-fit counts the hidden items (0: everything shown).
   */
  _monitorFit() {
    const el = this.monitorEl, it = this.monitorItems;
    if (!it || el.hidden || !el.isConnected) return;
    const order = [it.host, it.up, it.load, ...it.bars, it.net];
    for (const x of order) x.hidden = false;
    let n = 0;
    while (n < order.length && el.scrollWidth > el.clientWidth) order[n++].hidden = true;
    el.dataset.fit = String(n);
    el.title = n ? this.monitorLine : '';
  }

  /**
   * A failed poll (a timeout, a transient error) that is not yet the third: the last sample stays, dimmed, with its
   * age — "stale (14 s)", counted up every second — and the error in the tooltip. The next good sample clears it
   * (_monitorFresh); the third failure in a row turns it into "monitor unavailable".
   */
  _monitorStale(error) {
    const el = this.monitorEl;
    el.classList.add('stale');
    this.monitorStaleError = error || '';
    if (!this.monitorStaleEl) this.monitorStaleEl = h('span', { class: 'mon-item mon-stale' }, h('span', { class: 'mon-val' }));
    if (!this.monitorStaleEl.isConnected) {
      if (this.monitorItems) el.insertBefore(this.monitorStaleEl, this.monitorItems.host);
      else el.append(this.monitorStaleEl); // no sample yet: next to the "monitoring…" note
    }
    const tick = () => {
      const age = this.monitorSample ? Math.max(0, Math.round((Date.now() - this.monitorSample.at) / 1000)) : null;
      this.monitorStaleEl.firstChild.textContent = age === null ? t('stale') : t('stale ({n} s)', { n: age });
      const error = this.monitorStaleError;
      this.monitorStaleEl.title = age === null
        ? (error ? t('No sample yet; the last poll failed: {error}', { error }) : t('No sample yet'))
        : (error ? t('Last sample {n} s ago; the last poll failed: {error}', { n: age, error }) : t('Last sample {n} s ago', { n: age }));
    };
    tick();
    if (!this.monitorStaleTimer) this.monitorStaleTimer = setInterval(tick, 1000);
    this._monitorFit();
  }

  /** Back to a fresh strip: no stale item, no dimming, no age timer. */
  _monitorFresh() {
    this.monitorEl.classList.remove('stale');
    if (this.monitorStaleTimer) {
      clearInterval(this.monitorStaleTimer);
      this.monitorStaleTimer = null;
    }
    if (this.monitorStaleEl) {
      this.monitorStaleEl.remove();
      this.monitorStaleEl = null;
    }
    this.monitorStaleError = '';
  }

  async toggleLog(force) {
    const on = force !== undefined ? force : !this.logging;
    if (!this.termId) return;
    if (on) {
      const file = await window.api.term.logStart(this.termId, this.title);
      this.logging = true;
      this.logFile = file;
      toast(t('Logging to {file}', { file }), 'success');
    } else {
      await window.api.term.logStop(this.termId);
      this.logging = false;
      toast(t('Logging stopped'), 'info');
    }
    this.app.onPaneStatus(this);
  }

  clear() {
    this.term.clear(); // drops every marker, and with them the keyword decorations; the highlighter forgets its records too
    this.highlighter.reset();
  }

  zoom(delta) {
    const s = this.app.settings;
    if (delta === 0) this.term.options.fontSize = s.fontSize;
    else this.term.options.fontSize = Math.max(8, Math.min(40, this.term.options.fontSize + delta));
    this.highlighter.fontChanged();
    this.fit();
  }

  applySettings(s) {
    this.term.options.fontFamily = s.fontFamily;
    this.term.options.fontSize = this.session?.fontSize || s.fontSize;
    this.term.options.lineHeight = s.lineHeight || 1;
    this.term.options.cursorBlink = s.cursorBlink;
    this.term.options.cursorStyle = s.cursorStyle;
    this.term.options.scrollback = s.scrollback;
    this.applyTheme(s); // also hands the highlighter the rules, the on/off state and the palette
    this.highlighter.fontChanged();
    this.term.options.macOptionIsMeta = s.macOptionIsMeta !== false;
    this.syncMonitor(); // Settings → Features: the bar's default and interval
    this.fit();
  }

  /**
   * Keyword highlighting for this pane (Settings → Features → Keyword highlighting): the session's override (on / off)
   * wins over the global switch; the rules are the saved ones or the built-in set, coloured from this pane's palette.
   * A rule whose regex does not compile is skipped and said so once per pane (never thrown into the data path).
   */
  _syncHighlight(s = this.app.settings) {
    if (!this.highlighter) return;
    const o = this.session?.highlight;
    const enabled = o === 'on' || (o !== 'off' && s.highlightEnabled !== false);
    const invalid = this.highlighter.configure({ enabled, rules: s.highlightRules || DEFAULT_RULES, theme: this.themeFor(s) });
    const key = invalid.map((i) => i.rule.pattern).join('\n');
    if (key && key !== this._hlInvalid) for (const { rule, error } of invalid) toast(t('Keyword highlighting: "{pattern}" is not a valid regex ({error}) — rule skipped', { pattern: rule.pattern, error }), 'warn', 6000);
    this._hlInvalid = key;
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
    this._statusSgr = null; // the status-line colours follow the palette (_paint)
    this.term.options.theme = terminalTheme(theme); // always a fresh object (see above); the selection band is derived per palette
    this.el.style.setProperty('--term-bg', theme.background || '#1e1e1e');
    this.el.style.setProperty('--term-fg', theme.foreground || '#ececec');
    this._syncHighlight(s); // the keyword colours follow the palette (a no-op when nothing changed)
  }

  /** Right-click / pane menu paste: the clipboard text, through the guard. */
  async paste() {
    const text = await window.api.clipboard.read();
    if (text) this.pasteText(text);
  }

  /**
   * Every path that hands text from outside the terminal to it (⌘V and Edit → Paste, right-click and the pane menu,
   * text dropped on the pane) ends here: the paste guard may ask first (multi-line, long or suspicious text; Settings →
   * Terminal → Paste guard) and may hand back an edited or cleaned text. What it returns goes through xterm's own
   * paste — line endings normalised, bracketed paste when the application asked for it — and from there through
   * onData like typed input, so MultiExec broadcasts a paste exactly as it broadcasts keystrokes. Macros and the
   * quoted paths of a file drop are not pastes and do not come here.
   */
  async pasteText(text) {
    if (!text || this.dead || this.kind === 'empty' || this.kind === 'ftp') return false;
    const final = await this.app.guardPaste(this, text);
    if (!final || this.disposed) return false;
    this.term.paste(final);
    return true;
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
      { label: t('Copy'), key: '⌘C', action: () => this.copy(), disabled: !this.term.hasSelection() },
      { label: t('Paste'), key: '⌘V', action: () => this.paste() },
      { label: t('Select All'), action: () => this.term.selectAll() },
      '-',
      { label: t('Find…'), key: '⌘F', action: () => this.app.action('find') },
      { label: t('Clear'), key: '⌘K', action: () => this.clear() },
      '-',
      { label: t('Split Right'), key: '⌘D', action: () => this.app.action('split', 'right', this) },
      { label: t('Split Down'), key: '⇧⌘D', action: () => this.app.action('split', 'down', this) },
      { label: this.zoomed ? t('Restore Panes') : t('Zoom Pane'), key: '⇧⌘⏎', action: () => this.app.action('zoom-pane', undefined, this), disabled: !this.tab || this.tab.panes().length < 2 },
      // while MultiExec is on: the same switch as the box under the terminal, as a checkable item
      this.app.multiexec && this.multiexecCandidate() ? { label: t('Exclude from MultiExec'), checked: this.multiexecExcluded, action: () => this.setMultiexecExcluded(!this.multiexecExcluded) } : null,
      '-',
      { label: this.logging ? t('Stop Session Log') : t('Start Session Log…'), action: () => this.toggleLog() },
      this.monitorAllowed() ? { label: this.monitorEnabled() ? t('Hide Remote Monitoring Bar') : t('Show Remote Monitoring Bar'), action: () => this.toggleMonitor() } : null,
      this.kind === 'ssh' || this.kind === 'ftp' ? { label: this.kind === 'ftp' ? t('Open file browser') : t('Open SFTP Browser'), action: () => this.app.sftpPanel.show(this.termId) } : null,
      this.kind === 'mosh' ? { label: t('Open SFTP Browser'), action: () => this.openSftpCompanion(), disabled: this.dead } : null,
      this.kind !== 'local' ? { label: this.dead ? t('Reconnect') : t('Disconnect'), action: () => (this.dead ? this.reconnect() : this.disconnect()) } : null,
      '-',
      { label: t('Close Pane'), key: '⇧⌘W', action: () => this.app.closePane(this) },
    ]);
  }

  // ---------- moving to another window (app.js detachTab / adoptTabs) ----------
  /** What another window needs to take this pane over: the terminal id and the state the backend does not know. */
  transferState() {
    return {
      termId: this.termId || null, status: this.status, title: this.title, remoteCwd: this.remoteCwd || null, dead: !!this.dead,
      logging: !!this.logging, logFile: this.logFile || null, sftpConnId: this.sftpConnId || null, sftpStatus: this.sftpStatus,
      cwdTitled: !!this._cwdTitled, connectedAt: this.connectedAt || null, fontSize: this.term.options.fontSize,
    };
  }

  /** Hand the backend to another window: forget the terminal (and a Mosh companion) without ending it, then dispose the xterm. */
  release() {
    this.released = true;
    const id = this.termId;
    this.app.unregisterPane(this);
    this.termId = null;
    this.sftpConnId = null; // goes with the terminal: closeSftpCompanion (in dispose) finds nothing to end
    this.dispose();
    if (id) this.app.sftpPanel.dropConnection(id); // this window's panel state only; the connection lives on
  }

  /**
   * Take over a live terminal from another window (d = its transferState): main makes this window its owner and
   * hands back the last 256 KB of its output, which is drawn before live data streams in. A backend that ended
   * meanwhile leaves a dead pane with its last screen, like any session that ended.
   */
  async attach(d) {
    this.title = d.title || this.title;
    this.remoteCwd = d.remoteCwd || null;
    if (this.kind === 'local' && this.remoteCwd) this.cwd = this.remoteCwd;
    this._cwdTitled = !!d.cwdTitled;
    this.logging = !!d.logging;
    this.logFile = d.logFile || null;
    this.connectedAt = d.connectedAt || null;
    if (d.fontSize && d.fontSize !== this.term.options.fontSize) this.term.options.fontSize = d.fontSize; // ⌘= / ⌘- travel with the pane
    this.dead = false;
    this.hideOverlay();
    let r = { ok: false, replay: '' };
    if (d.termId) {
      try { r = await window.api.detach.attach(d.termId); } catch (e) { console.warn('attach failed', e); }
    }
    if (this.disposed) return;
    if (r.replay) {
      // the replay is drawn through a fresh xterm, whose answers to any terminal query left in it (DA, DSR, OSC colour
      // queries…) would go to the shell as keystrokes — the ring strips the known ones (terminals.js), and input is
      // muted until the replay is parsed for whatever else answers
      this._replaying = true;
      const done = () => { this._replaying = false; };
      const guard = setTimeout(done, 3000);
      this.term.write(this._paint(r.replay), () => { clearTimeout(guard); done(); });
    }
    this.updateTitle();
    if (!r.ok) {
      this.setStatus(d.status === 'failed' ? 'failed' : 'disconnected');
      this.markDead(d.dead ? null : t('The session ended while the tab was moved.'));
      return;
    }
    this.termId = d.termId;
    this.app.registerPane(this);
    if (this.kind === 'mosh') { this._moshScreen = true; this._moshStartedAt = 0; this._killed = false; } // an attached client is up
    if (d.sftpConnId) { this.sftpConnId = d.sftpConnId; this.sftpStatus = d.sftpStatus === 'connected' ? 'connected' : 'connecting'; }
    if (this.kind === 'ftp') this.showFtpInfo('connected');
    this.setStatus(d.status === 'connecting' ? 'connecting' : 'connected');
    // the terminal was sized for the old window: the backend learns this one's size (xterm's onResize fires on a change only)
    this.fit();
    if (this.kind !== 'ftp') window.api.term.resize(this.termId, this.term.cols, this.term.rows);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this._i18nOff) { this._i18nOff(); this._i18nOff = null; } // no re-labelling of a pane that is gone
    this._monitorStop();
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
    const webgl = this.webgl; // its GPU context goes back to the budget
    this.webgl = null;
    try { webgl && webgl.dispose(); } catch {}
    try { this.highlighter.dispose(); } catch {}
    try {
      this.term.dispose();
    } catch {}
    this.el.remove();
  }
}
