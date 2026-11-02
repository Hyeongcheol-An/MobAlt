// A browser pane: a web page in a pane of its own, next to the terminals that manage it (session type `browser` —
// a router's admin page, Grafana, a device's web UI, a tunnelled localhost). An ordinary pane of the workspace: it
// lives in a tab, splits with terminals, zooms, closes, moves to another window and comes back with the workspace
// at the page it was on. It duck-types what app.js / layout.js ask of a pane (el, tab, kind, session, title, status,
// mount / fit / focus / dispose, setZoomed, transferState / release / attach…) without a terminal behind it.
//
// The page is an Electron <webview>. It does not sit inside the pane element: a <webview> that is moved in the DOM
// destroys its guest and loads the page again, and the split layout (layout.js render) re-places every pane on each
// change. So every pane's webview lives in #webview-layer (index.html), a fixed layer over the window, and is
// positioned over the pane's body (place) whenever that moves or resizes; a pane that is not on screen (another tab,
// behind a zoomed sibling) keeps its webview hidden. The main process hardens every guest (main.js hardenWebviews):
// sandboxed, isolated, no preload, http(s) only, popups into the same pane, no permissions.
import { h, contextMenu, closeContextMenu, contextMenuAnchor, toast, icon, promptDialog, isRtl } from './ui.js';
import { t, onChange } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()
import { normalizeBrowserUrl, browserHost } from './browserurl.js';

let seq = 0;
let layerWired = false;
const faviconCache = new Map(); // favicon URL → data: URL (or null: nothing usable there), per window
const FAVICON_CACHE_MAX = 200;
/** Chromium's net error for a load that was stopped or replaced (webview did-fail-load): not a failure of the page. */
const ERR_ABORTED = -3;
/** ⌘= / ⌘- step the page's zoom level by this (Chromium: 0.5 = one of the browser's own zoom steps). */
const ZOOM_STEP = 0.5;

/** The layer the webviews live in (index.html; made here should the markup lack it), with the drag hooks it needs, once. */
function layer() {
  let el = document.getElementById('webview-layer');
  if (!el) {
    el = h('div', { id: 'webview-layer' });
    document.body.append(el);
  }
  if (!layerWired) {
    layerWired = true;
    // a session or a tab dragged anywhere in the window: the web pages let the drag through to the panes under them
    // (styles.css: body.pane-drag), or a drop onto a browser pane could never reach it
    const ours = (e) => !!e.dataTransfer && (e.dataTransfer.types.includes('text/x-mobalt-session') || e.dataTransfer.types.includes('text/x-mobalt-tab'));
    document.addEventListener('dragstart', (e) => { if (ours(e)) document.body.classList.add('pane-drag'); });
    const done = () => document.body.classList.remove('pane-drag');
    document.addEventListener('dragend', done);
    document.addEventListener('drop', done);
  }
  return el;
}

/** The label of a drop zone while a tab (isTab) or a session is dragged over the pane (the same words as terminal.js). */
function zoneLabel(isTab, zone) {
  if (isTab) {
    switch (zone) {
      case 'replace': return t('Move terminal here (replace)');
      case 'left': return t('Move terminal left');
      case 'right': return t('Move terminal right');
      case 'up': return t('Move terminal up');
      default: return t('Move terminal down');
    }
  }
  switch (zone) {
    case 'replace': return t('Open session here (replace)');
    case 'left': return t('Open session left');
    case 'right': return t('Open session right');
    case 'up': return t('Open session up');
    default: return t('Open session down');
  }
}

/** A partition name from a session id: letters, digits, - and _ only (main.js accepts nothing else). */
const partitionOf = (session) => session && session.isolated && session.id ? `persist:browser-${String(session.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}` : 'persist:browser';

export class BrowserPane {
  /**
   * @param app  application controller
   * @param opts { session, url?: the page to open (default: the session's), title?: a name of the user's (workspace restore) }
   */
  constructor(app, opts) {
    this.app = app;
    this.id = 'b' + ++seq;
    this.kind = 'browser';
    this.session = opts.session || null;
    this.url = opts.url || this.session?.url || 'about:blank'; // the page the pane is on (every navigation updates it)
    this.partition = partitionOf(this.session);
    // what the rest of the app reads off any pane (terminal.js has the same fields)
    this.termId = null;
    this.cwd = null;
    this.remoteCwd = null;
    this.status = 'idle'; // idle | connecting (loading) | connected (loaded) | failed
    this.dead = false;
    this.disposed = false;
    this.released = false;
    this.logging = false;
    this.readOnly = false;
    this.overrides = {};
    this.badge = null;
    this.multiexecExcluded = false;
    this.zoomed = false;
    this.tab = null;
    this.from = opts.from || null;
    this.sftpConnId = null;
    this.sftpStatus = 'idle';
    this.connectedAt = null;
    this.pageTitle = ''; // what the page calls itself (page-title-updated)
    this.titleLocked = false; // Rename Pane…: the page's title no longer renames the pane
    this.title = this.session?.name || browserHost(this.url) || this.url;
    this.zoomLevel = 0; // ⌘= / ⌘- on this pane: the page's zoom, kept with the pane (transferState)
    this.loading = false;
    this.failed = null; // { code, description, url } while the last load failed (the error view is up)
    this.ready = false; // dom-ready happened once: the webview's methods may be called
    this.canBack = false; // the page's history, as the main process last told it (_syncNav)
    this.canFwd = false;
    this.mounted = false;
    this._dragOver = false; // a session / tab is dragged over the pane: the page steps aside for the drop zone

    this.el = h('div', { class: 'pane browser', dataset: { pane: this.id } },
      // the same head as a terminal pane (shown while the tab is split): status dot, icon, title, zoom chip, ⚙, ⤢, splits, ✕
      (this.headEl = h('div', { class: 'pane-head' },
        h('span', { class: 'dot' }),
        (this.picon = h('span', { class: 'picon', hidden: !this.session?.icon }, this.session?.icon || '')),
        (this.headTitle = h('span', { class: 'title' }, this.title)),
        (this.zoomBadge = h('span', { class: 'zoom-badge', hidden: true }, t('zoomed'))),
        (this.menuBtn = h('button', { class: 'pane-menu', title: t('Pane menu'), 'aria-label': t('Pane menu'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', onmousedown: (e) => e.preventDefault(), onclick: () => this.openHeaderMenu() }, icon('settings'))),
        (this.zoomBtn = h('button', { class: 'zoom', title: t('Zoom pane (⇧⌘⏎)'), 'aria-label': t('Zoom pane'), 'aria-pressed': 'false', onclick: () => app.action('zoom-pane', undefined, this) }, icon('zoom'))),
        (this.splitRightBtn = h('button', { class: 'split-right', title: t('Split right'), 'aria-label': t('Split right'), onclick: () => app.action('split', 'right', this) }, icon('split'))),
        (this.splitDownBtn = h('button', { class: 'split-down', title: t('Split down'), 'aria-label': t('Split down'), onclick: () => app.action('split', 'down', this) }, icon('split-down'))),
        (this.closeBtn = h('button', { class: 'pane-close', title: t('Close pane'), 'aria-label': t('Close pane'), onclick: () => app.closePane(this) }, icon('x')))
      )),
      // the browser toolbar: history, reload / stop, the address (the page's favicon in front of it), open outside
      (this.barEl = h('div', { class: 'bt-bar', role: 'toolbar', 'aria-label': t('Browser toolbar'), oncontextmenu: (e) => this._barMenu(e) },
        (this.backBtn = h('button', { class: 'bt-btn bt-back', type: 'button', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => this.back() }, icon('chevron-left'))),
        (this.fwdBtn = h('button', { class: 'bt-btn bt-fwd', type: 'button', disabled: true, onmousedown: (e) => e.preventDefault(), onclick: () => this.forward() }, icon('chevron-right'))),
        (this.reloadBtn = h('button', { class: 'bt-btn bt-reload', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => (this.loading ? this.stop() : this.reload()) }, icon('refresh'))),
        h('div', { class: 'bt-urlwrap' },
          (this.favEl = h('img', { class: 'bt-favicon', alt: '', 'aria-hidden': 'true', hidden: true })),
          (this.urlEl = h('input', { class: 'bt-url', type: 'text', value: this.url, dir: 'ltr', spellcheck: false, autocomplete: 'off', autocapitalize: 'off',
            onkeydown: (e) => this._urlKey(e), onfocus: () => this.urlEl.select() }))),
        (this.openBtn = h('button', { class: 'bt-btn bt-open', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => this.openExternal() }, icon('external'))),
        (this.progressEl = h('div', { class: 'bt-progress', 'aria-hidden': 'true' }))
      )),
      // the body: the webview is placed over it (place); the error view sits in it while a load failed
      (this.bodyEl = h('div', { class: 'pane-browser' },
        (this.errorEl = h('div', { class: 'bt-error', role: 'alert', hidden: true },
          h('div', { class: 'big' }),
          h('div', { class: 'url', dir: 'ltr' }),
          h('div', { class: 'why' }),
          h('div', { class: 'btns' },
            (this.retryBtn = h('button', { class: 'btn small', type: 'button', onclick: () => this.retry() })),
            h('button', { class: 'btn small bt-error-open', type: 'button', onclick: () => this.openExternal() }))))))
    );
    this.webview = this._makeWebview();
    this._relabel();
    if (this.session?.color) this.el.style.setProperty('--pane-color', this.session.color);
    this.el.addEventListener('mousedown', () => app.focusPane(this), true);
    this._wireDnD();
    this._i18nOff = onChange(() => this._relabel()); // a language switch: the labels this pane keeps on screen (dispose() unsubscribes)
    if (opts.title) { // a renamed pane coming back (workspace restore, a window transfer)
      this.title = opts.title;
      this.titleLocked = true;
    }
    this.updateTitle();
  }

  /** The <webview>, wired; appended to the layer by mount() (the page starts loading then). */
  _makeWebview() {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', this.partition); // before src: the partition cannot change once the guest exists
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no'); // main.js forces these anyway
    // Chromium's own user agent: a site that sniffs "Electron" may refuse or degrade the page
    wv.setAttribute('useragent', navigator.userAgent.replace(/ ?(MobAlt|Electron)\/\S+/g, ''));
    // a popup (window.open, target=_blank) is decided by the main process's window-open handler on the guest, which
    // never opens a window: an http(s) one goes into this pane, anything else is dropped. Without this attribute
    // Electron blocks popups before that handler sees them, and a target=_blank link would do nothing at all.
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', this.url);
    wv.classList.add('off');
    wv.addEventListener('did-start-loading', () => this._onLoadStart());
    wv.addEventListener('did-stop-loading', () => this._onLoadStop());
    wv.addEventListener('did-fail-load', (e) => this._onFailLoad(e));
    wv.addEventListener('did-navigate', (e) => this._onNavigate(e.url, true));
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame !== false) this._onNavigate(e.url, false); });
    wv.addEventListener('page-title-updated', (e) => this._onPageTitle(e.title));
    wv.addEventListener('page-favicon-updated', (e) => this._onFavicon(e.favicons));
    wv.addEventListener('dom-ready', () => this._onDomReady());
    wv.addEventListener('found-in-page', (e) => this._onFound(e.result));
    wv.addEventListener('context-menu', (e) => this._pageMenu(e.params));
    wv.addEventListener('render-process-gone', (e) => this._onGone(e.details));
    wv.addEventListener('focus', () => { if (this.app.focused !== this && !this.disposed) this.app.focusPane(this); }); // a click into the page: this pane is the active one
    return wv;
  }

  // ---------- life cycle (what layout.js / app.js call on every pane) ----------
  mount() {
    if (this.mounted || this.disposed) return;
    this.mounted = true;
    layer().append(this.webview); // the guest is created and the page starts loading now
    this.ro = new ResizeObserver(() => this.place());
    this.ro.observe(this.bodyEl);
    this.place();
  }

  /** The page starts when the webview is attached (mount); here the state follows: loading, or as it is. */
  async start() {
    if (this.disposed) return;
    if (this.status === 'idle') this.setStatus(this.loading ? 'connecting' : this.status);
  }

  fit() {
    this.place();
  }

  /** On screen: mounted, in the window's active tab and not behind a zoomed sibling (what the terminals call visible). */
  visibleInTab() {
    if (this.disposed || !this.mounted || !this.tab || !this.el.isConnected) return false;
    const ws = this.app.workspace;
    return !!ws && ws.active === this.tab && (!this.tab.zoomed || this.tab.zoomed === this);
  }

  /**
   * Put the webview over the pane's body, clipped to the content area, and show it only while the pane is on screen,
   * its page did not fail (the error view is up then) and no drop zone is being shown. Called on every change that
   * can move the body: layout, zoom, tab switch, window / sidebar / splitter resize (ResizeObserver), banners.
   */
  place() {
    if (this.disposed) return false;
    let on = this.visibleInTab() && !this.failed && !this._dragOver;
    if (on) {
      const r = this.bodyEl.getBoundingClientRect();
      const host = this.app.workspace && this.app.workspace.contentEl ? this.app.workspace.contentEl.getBoundingClientRect() : r;
      const left = Math.max(r.left, host.left), top = Math.max(r.top, host.top);
      const width = Math.min(r.right, host.right) - left, height = Math.min(r.bottom, host.bottom) - top;
      if (width < 4 || height < 4) on = false;
      else Object.assign(this.webview.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    }
    this.webview.classList.toggle('off', !on);
    return on;
  }

  /** The name layout.js calls on every visibility change (a terminal's GPU renderer follows it; here the webview does). */
  syncWebgl() {
    return this.place();
  }

  focus() {
    if (this.disposed) return;
    if (!this.webview.classList.contains('off')) this.webview.focus();
    else if (this.failed) this.retryBtn.focus();
  }

  /** ⌘L: the address field, its text selected. */
  focusUrl() {
    this.urlEl.focus();
    this.urlEl.select();
  }

  setStatus(status, msg) {
    this.status = status;
    if (status === 'connected') this.connectedAt = Date.now();
    this.headEl.querySelector('.dot').className = 'dot ' + status;
    this.app.onPaneStatus(this, msg);
  }

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

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this._i18nOff) { this._i18nOff(); this._i18nOff = null; }
    if (this.ro) this.ro.disconnect();
    this.webview.remove(); // the guest goes with it
    this.el.remove();
  }

  // ---------- moving to another window (app.js detachTab / adoptTabs) ----------
  /** What another window needs to show this pane again: the page it is on and the state the page does not carry (no live guest moves between windows: the page loads again there). */
  transferState() {
    return { url: this.url, title: this.title, titleLocked: !!this.titleLocked, pageTitle: this.pageTitle, zoomLevel: this.zoomLevel, status: this.status };
  }

  release() {
    this.released = true;
    this.dispose();
  }

  /** Take the state over from another window (d = its transferState); the page itself was given to the constructor as `url` and loads afresh. */
  async attach(d) {
    if (d.titleLocked && d.title) { this.title = d.title; this.titleLocked = true; }
    this.pageTitle = d.pageTitle || '';
    this.zoomLevel = typeof d.zoomLevel === 'number' ? d.zoomLevel : 0;
    this.updateTitle();
    return this.start();
  }

  // ---------- navigation ----------
  /** Open an address typed by the user (the URL field, a script): normalised, refused when it is not http(s). True when a load started. */
  navigate(input) {
    const r = normalizeBrowserUrl(input);
    if (!r.url) {
      toast(r.error === 'empty' ? t('Type an address first') : r.error === 'scheme' ? t('Only http:// and https:// addresses can be opened in a browser pane') : t('That is not a valid URL'), 'warn');
      return false;
    }
    this.loadUrl(r.url);
    return true;
  }

  /** Load a URL that is already in the form normalizeBrowserUrl gives (callers that typed one go through navigate). */
  loadUrl(url) {
    if (this.disposed) return;
    this.url = url;
    this.failed = null;
    this._showError(false);
    this.urlEl.value = url;
    if (this.ready) this.webview.loadURL(url).catch(() => {}); // a failed load is reported by did-fail-load; the promise's rejection says the same
    else this.webview.setAttribute('src', url); // not attached yet: the attribute is what the guest will open
    this.setStatus('connecting');
    this.app.saveWorkspaceSoon?.();
  }

  back() { return this._nav('back'); }
  forward() { return this._nav('forward'); }
  reload() {
    if (!this.ready) return;
    if (this.failed) return this.retry();
    this.failed = null;
    this.webview.reload();
  }
  stop() { if (this.ready) this.webview.stop(); }
  /** The error view's Retry: the address that failed, once more. */
  retry() { this.loadUrl(this.failed ? this.failed.url : this.url); }
  /** Reconnect / Disconnect on a page: load it again / stop loading. */
  reconnect() { return this.reload(); }
  disconnect() { return this.stop(); }

  /** The current page in the Mac's default browser (about:blank has nothing to open). */
  openExternal() {
    if (!/^https?:/i.test(this.url)) return;
    window.api.shell.openExternal(this.url);
  }

  copyUrl() {
    window.api.clipboard.write(this.url);
    toast(t('URL copied'), 'success', 1500);
  }

  /** The page the guest is on, '' before it exists. */
  _pageUrl() {
    try { return this.ready ? String(this.webview.getURL() || '') : ''; } catch { return ''; }
  }

  /**
   * The page's history lives in the main process (webContents.navigationHistory; the tag's own methods are gone):
   * one round trip asks it, or moves and asks. The toolbar's Back / Forward follow the answer.
   */
  async _nav(op) {
    if (!this.ready || this.disposed) return null;
    let id;
    try { id = this.webview.getWebContentsId(); } catch { return null; }
    let st = null;
    try { st = await window.api.browser.nav(id, op); } catch {}
    if (this.disposed) return null;
    if (st) {
      this.canBack = !!st.canGoBack;
      this.canFwd = !!st.canGoForward;
      this.backBtn.disabled = !this.canBack;
      this.fwdBtn.disabled = !this.canFwd;
    }
    return st;
  }

  _urlKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.navigate(this.urlEl.value)) this.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.urlEl.value = this.url; // what was typed is dropped
      this.focus();
    }
  }

  // ---------- webview events ----------
  _onDomReady() {
    this.ready = true;
    if (this.zoomLevel) { try { this.webview.setZoomLevel(this.zoomLevel); } catch {} }
    this._syncNav();
  }

  _onLoadStart() {
    this.loading = true;
    this.failed = null;
    this._showError(false);
    this.el.classList.add('loading');
    this.bodyEl.setAttribute('aria-busy', 'true');
    this._syncReload();
    this.setStatus('connecting');
  }

  _onLoadStop() {
    this.loading = false;
    this.el.classList.remove('loading');
    this.bodyEl.removeAttribute('aria-busy');
    this._syncReload();
    this._syncNav();
    if (!this.failed) { // a load that was stopped (or replaced) before it committed: the address is the page that stayed
      const cur = this._pageUrl();
      if (cur && cur !== this.url) { this.url = cur; if (document.activeElement !== this.urlEl) this.urlEl.value = cur; }
    }
    if (this.failed) this.setStatus('failed', this.failed.description);
    else this.setStatus('connected');
    this.place(); // the error view may have gone (a retry that worked): the page comes back on screen
  }

  _onFailLoad(e) {
    if (e.isMainFrame === false) return; // a frame or a subresource: the page itself is there
    if (e.errorCode === ERR_ABORTED) { // Stop, or a navigation that replaced this one: the page stays what it was (did-stop-loading settles the state)
      const cur = this._pageUrl();
      if (cur && cur !== this.url) { this.url = cur; this.urlEl.value = cur; } // the address field shows the page that stayed, not the one that was stopped
      return;
    }
    const code = e.errorCode, description = String(e.errorDescription || '').replace(/^net::/, '');
    this.failed = { code, description, url: e.validatedURL || this.url };
    this._showError(true);
    this.place(); // the webview steps aside for the error view
    this.setStatus('failed', description);
  }

  /** The guest's renderer went away (a crash, the system killing it): an error view with a Retry, like a failed load. */
  _onGone(details) {
    if (this.disposed) return;
    const reason = details && details.reason ? String(details.reason) : 'gone';
    this.failed = { code: 0, description: t('The page\'s process ended ({reason})', { reason }), url: this.url };
    this.ready = false;
    this.loading = false;
    this.el.classList.remove('loading');
    this._showError(true);
    this.place();
    this.setStatus('failed', reason);
  }

  _onNavigate(url, newDocument) {
    if (!url) return;
    this.url = url;
    if (document.activeElement !== this.urlEl) this.urlEl.value = url; // never over what the user is typing
    if (newDocument) {
      this.pageTitle = '';
      this._setFavicon(null); // the next page's own, when it has one
      if (!this.titleLocked) this.updateTitle();
    }
    this._syncNav();
    if (this.app.activePane() === this) this.app.updateStatus(this);
    this.app.saveWorkspaceSoon?.(); // the workspace remembers the page the pane is on
  }

  _onPageTitle(title) {
    this.pageTitle = String(title || '').trim();
    if (this.titleLocked) return; // Rename Pane…: the name stands
    this.title = this.pageTitle || this.session?.name || browserHost(this.url) || this.url;
    this.updateTitle();
  }

  /** The page's icon: fetched by the main process through this pane's partition (the window's CSP allows data: images only), cached per URL. */
  async _onFavicon(favicons) {
    const src = Array.isArray(favicons) ? favicons.find((u) => /^https?:\/\//i.test(u)) : null;
    if (!src) return this._setFavicon(null);
    const pageUrl = this.url;
    let data = faviconCache.get(src);
    if (data === undefined) {
      data = null;
      try { data = (window.api.browser && await window.api.browser.favicon(this.partition, src)) || null; } catch {}
      if (faviconCache.size >= FAVICON_CACHE_MAX) faviconCache.delete(faviconCache.keys().next().value);
      faviconCache.set(src, data);
    }
    if (this.disposed || this.url !== pageUrl) return; // the pane moved on meanwhile
    this._setFavicon(data);
  }

  _setFavicon(dataUrl) {
    this.favicon = dataUrl || null;
    this.favEl.hidden = !dataUrl;
    this.favEl.src = dataUrl || '';
    // the pane head shows it in the icon slot when the session has no emoji of its own
    if (!this.session?.icon) {
      this.picon.replaceChildren(dataUrl ? h('img', { src: dataUrl, alt: '', class: 'picon-img' }) : '');
      this.picon.hidden = !dataUrl;
    }
  }

  _syncNav() {
    return this._nav('state');
  }

  /** The one button is Reload, or Stop while the page loads. */
  _syncReload() {
    const stop = this.loading;
    this.reloadBtn.replaceChildren(icon(stop ? 'x' : 'refresh'));
    this.reloadBtn.title = stop ? t('Stop loading') : t('Reload page');
    this.reloadBtn.setAttribute('aria-label', stop ? t('Stop') : t('Reload'));
  }

  _showError(on) {
    this.errorEl.hidden = !on;
    if (!on) return;
    const f = this.failed || {};
    this.errorEl.querySelector('.big').textContent = t('This page could not be loaded');
    this.errorEl.querySelector('.url').textContent = f.url || this.url;
    this.errorEl.querySelector('.why').textContent = f.code ? `${f.description} (${f.code})` : f.description || '';
    this.retryBtn.textContent = t('↻ Retry');
    this.errorEl.querySelector('.bt-error-open').textContent = t('Open in Browser');
    this.errorEl.querySelector('.bt-error-open').hidden = !/^https?:/i.test(f.url || this.url);
  }

  // ---------- title ----------
  updateTitle() {
    this.headTitle.textContent = this.title;
    this.app.onPaneTitle(this);
  }

  /** True while the pane is named automatically (the page's title, else the session's name): not renamed by the user. */
  titleIsDefault() {
    return !this.titleLocked;
  }

  /** Rename Pane…: the pane's own name, locked against the page's titles; empty = automatic again. */
  async renamePrompt() {
    const name = await promptDialog(t('Rename pane'), { value: this.title, label: t('Shown in the pane head and used for the tab title; leave empty to go back to the automatic title') });
    if (name === null) return;
    this.setTitle(name.trim());
  }

  setTitle(name) {
    if (name) {
      this.title = name;
      this.titleLocked = true;
    } else {
      this.titleLocked = false;
      this.title = this.pageTitle || this.session?.name || browserHost(this.url) || this.url;
    }
    this.updateTitle();
    this.app.saveWorkspaceSoon?.();
  }

  /** A language switch (i18n:changed): every label this pane keeps on screen, again. */
  _relabel() {
    if (this.disposed) return;
    this.zoomBadge.textContent = t('zoomed');
    this.zoomBtn.title = this.zoomed ? t('Restore panes (⇧⌘⏎)') : t('Zoom pane (⇧⌘⏎)');
    this.zoomBtn.setAttribute('aria-label', t('Zoom pane'));
    for (const [btn, label] of [[this.menuBtn, t('Pane menu')], [this.splitRightBtn, t('Split right')], [this.splitDownBtn, t('Split down')], [this.closeBtn, t('Close pane')],
      [this.backBtn, t('Back')], [this.fwdBtn, t('Forward')], [this.openBtn, t('Open in default browser')]]) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    this.barEl.setAttribute('aria-label', t('Browser toolbar'));
    this.urlEl.setAttribute('aria-label', t('Address'));
    this.urlEl.placeholder = t('Address (⌘L)');
    this._syncReload();
    if (this.failed) this._showError(true);
  }

  // ---------- what the terminal panes do and a page does not ----------
  multiexecCandidate() { return false; } // MultiExec never types into a page
  syncMultiexecStrip() {}
  setMultiexecExcluded() {}
  monitorResume() {}
  monitorAllowed() { return false; }
  applySettings() {} // the toolbar follows the chrome tokens (styles.css); nothing of the terminal settings applies
  write() {} // keystrokes broadcast to the tab, a macro played into it: a page takes none
  clear() {}
  setReadOnly() {}
  pasteText() { return false; }
  toggleLog() { toast(t('Session logs need a terminal pane'), 'info'); }
  toggleMonitor() { toast(t('The remote monitoring bar needs an SSH or Mosh session'), 'info'); }

  /** ⌘= / ⌘- / ⌘0 on this pane: the page's zoom level (Chromium's steps), not the terminal font. */
  zoom(delta) {
    this.zoomLevel = delta === 0 ? 0 : Math.max(-4, Math.min(4, this.zoomLevel + delta * ZOOM_STEP));
    if (this.ready) { try { this.webview.setZoomLevel(this.zoomLevel); } catch {} }
    this.app.saveWorkspaceSoon?.();
  }

  // ---------- find (⌘F: the window's find bar, app.js) ----------
  /** Search the page: a new search (findNext false) or the next / previous hit of the current one; an empty text ends it. */
  find(text, { forward = true, findNext = false, matchCase = false } = {}) {
    if (!this.ready) return;
    if (!text) { // the field emptied: no highlights, no count
      this.stopFind();
      this.app.onFindResults?.(this, { resultCount: 0, resultIndex: -1 });
      return;
    }
    try { this.webview.findInPage(text, { forward, findNext, matchCase }); } catch {}
  }

  stopFind() {
    if (!this.ready) return;
    try { this.webview.stopFindInPage('clearSelection'); } catch {}
  }

  _onFound(result) {
    if (!result) return;
    this.app.onFindResults?.(this, { resultCount: result.matches || 0, resultIndex: (result.activeMatchOrdinal || 0) - 1 });
  }

  // ---------- copy / paste (the Edit menu's roles act on the focused page themselves; these are the pane menu's) ----------
  copy() { if (this.ready) this.webview.copy(); }
  paste() { if (this.ready) this.webview.paste(); }

  // ---------- menus ----------
  /** The ⚙ button of the pane head: the pane menu under it (see terminal.js openHeaderMenu for the focus rules). */
  openHeaderMenu() {
    if (contextMenuAnchor() === this.menuBtn) { closeContextMenu(); return; }
    const r = this.menuBtn.getBoundingClientRect();
    this.menuBtn.setAttribute('aria-expanded', 'true');
    this.openPaneMenu(isRtl() ? r.right : r.left, r.bottom + 2, { anchor: this.menuBtn, above: r.top - 2, onClose: () => this.menuBtn.setAttribute('aria-expanded', 'false') });
  }

  /** Right-click on the toolbar's own surface (not on a button or the field): the pane menu, like ⇧-right-click on a terminal. */
  _barMenu(e) {
    if (e.target.closest('input, button')) return;
    e.preventDefault();
    this.openPaneMenu(e.clientX, e.clientY);
  }

  /** Right-click inside the page (the guest's context-menu event, coordinates in the page): the pane menu with the page's own items first. */
  _pageMenu(params) {
    const r = this.webview.getBoundingClientRect();
    this.openPaneMenu(r.left + (params.x || 0), r.top + (params.y || 0), { page: params });
  }

  /**
   * The pane menu: the page's navigation, its address, what the right-click hit (a link, a selection, a text
   * field), the pane's own name, zoom, split and close — the same shape as the terminal pane's menu.
   */
  openPaneMenu(x, y, opts = {}) {
    const p = opts.page || null;
    const link = p && p.linkURL && /^https?:/i.test(p.linkURL) ? p.linkURL : '';
    const sel = p && p.selectionText ? String(p.selectionText) : '';
    contextMenu(x, y, [
      { label: t('Back'), action: () => this.back(), disabled: !this.canBack },
      { label: t('Forward'), action: () => this.forward(), disabled: !this.canFwd },
      { label: this.loading ? t('Stop') : t('Reload'), action: () => (this.loading ? this.stop() : this.reload()) },
      '-',
      link ? { label: t('Open Link in Browser'), action: () => window.api.shell.openExternal(link) } : null,
      link ? { label: t('Copy Link'), action: () => window.api.clipboard.write(link) } : null,
      sel ? { label: t('Copy'), key: '⌘C', action: () => this.copy() } : null,
      p && p.isEditable ? { label: t('Paste'), key: '⌘V', action: () => this.paste() } : null,
      link || sel || (p && p.isEditable) ? '-' : null,
      { label: t('Copy URL'), action: () => this.copyUrl() },
      { label: t('Open in Browser'), action: () => this.openExternal(), disabled: !/^https?:/i.test(this.url) },
      { label: t('Find…'), key: '⌘F', action: () => this.app.action('find') },
      '-',
      { label: t('Rename Pane…'), action: () => this.renamePrompt() },
      { label: t('Page Zoom'), items: [
        { label: t('Increase'), key: '⌘=', action: () => this.zoom(1) },
        { label: t('Decrease'), key: '⌘-', action: () => this.zoom(-1) },
        { label: t('Reset'), key: '⌘0', action: () => this.zoom(0) },
      ] },
      '-',
      { label: t('Split Right'), key: '⌘D', action: () => this.app.action('split', 'right', this) },
      { label: t('Split Down'), key: '⇧⌘D', action: () => this.app.action('split', 'down', this) },
      { label: this.zoomed ? t('Restore Panes') : t('Zoom Pane'), key: '⇧⌘⏎', action: () => this.app.action('zoom-pane', undefined, this), disabled: !this.tab || this.tab.panes().length < 2 },
      '-',
      { label: t('Close Pane'), key: '⇧⌘W', action: () => this.app.closePane(this) },
    ], { anchor: opts.anchor, above: opts.above, onClose: opts.onClose });
  }

  // ---------- drag and drop: a session or a tab dropped on the pane (replace, or split in that direction) ----------
  _dropZone(e) {
    const r = this.el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
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
    if (this._dragOver) {
      this._dragOver = false;
      this.place(); // the page comes back
    }
  }

  _wireDnD() {
    const el = this.el;
    const isPaneDrag = (e) => e.dataTransfer.types.includes('text/x-mobalt-session') || e.dataTransfer.types.includes('text/x-mobalt-tab');
    el.addEventListener('dragover', (e) => {
      if (!isPaneDrag(e)) return;
      e.preventDefault();
      const isTab = e.dataTransfer.types.includes('text/x-mobalt-tab');
      e.dataTransfer.dropEffect = isTab ? 'move' : 'copy';
      const zone = this._dropZone(e);
      if (!this._dragOver) { this._dragOver = true; this.place(); } // the page steps aside: the zone is drawn in the pane, under the webview layer
      this._showZone(zone, zoneLabel(isTab, zone === 'center' ? 'replace' : zone));
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) this._hideZone(); });
    el.addEventListener('drop', (e) => {
      const sessionId = e.dataTransfer.getData('text/x-mobalt-session');
      const tabId = e.dataTransfer.getData('text/x-mobalt-tab');
      const zone = this._dropZone(e);
      this._hideZone();
      if (!sessionId && !tabId) return;
      e.preventDefault();
      this.app.dropOnPane(this, { sessionId, tabId }, zone);
    });
  }
}
