// Tabs and split-pane layout. Each tab owns a tree: {type:'pane', pane} | {type:'split', dir, children:[a,b], ratio}
import { h, contextMenu, promptDialog, showModal, icon } from './ui.js';
import { t, tn, onChange } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()

let tabSeq = 0;

export class Tab {
  constructor(title) {
    this.id = 't' + ++tabSeq;
    this.title = title;
    this.autoTitle = true;
    this.color = null;
    this.icon = null;
    this.pinned = false; // sits at the left of the strip in a fixed order, no ✕, left alone by Close Others / Left / Right / All
    this.root = null;
    this.activePane = null;
    this.zoomed = null; // the pane filling the tab (⇧⌘⏎) while its siblings stay alive but hidden; null = the split layout
    this.pageEl = h('div', { class: 'tab-page', role: 'tabpanel' });
    this.tabEl = null;
  }

  panes() {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (n.type === 'pane') out.push(n.pane);
      else n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }
}

export class Workspace {
  constructor(app) {
    this.app = app;
    this.tabs = [];
    this.active = null;
    this.tabsEl = document.getElementById('tabs');
    this.contentEl = document.getElementById('tab-content');
    document.getElementById('tab-add').addEventListener('click', () => app.action('new-local'));
    this.tabsEl.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) this.tabsEl.scrollLeft += e.deltaY;
    }, { passive: true });
    this.tabsEl.addEventListener('dblclick', (e) => {
      if (e.target === this.tabsEl) app.action('new-local');
    });
    // keyboard: the tab strip is one Tab stop (roving tabindex); arrows move between tabs
    this.tabsEl.setAttribute('role', 'tablist');
    this.tabsEl.setAttribute('aria-label', t('Terminal tabs'));
    onChange(() => this.relabel()); // a language switch: the strip's own words again (the tab titles are the tabs')
    this.tabsEl.addEventListener('keydown', (e) => this._onTabKey(e));
    this.tabsEl.addEventListener('focusin', (e) => {
      const t = this.tabs.find((t) => t.tabEl === e.target);
      if (t) this._rove(t);
    });
    this._wireTabOverflow();
  }

  // ---------- tab strip overflow (scroll arrows, edge fades, "all tabs" menu) ----------
  _wireTabOverflow() {
    this.barEl = document.getElementById('tabbar');
    this.scrollLeftBtn = document.getElementById('tab-scroll-left');
    this.scrollRightBtn = document.getElementById('tab-scroll-right');
    this.tabListBtn = document.getElementById('tab-list');
    if (!this.barEl || !this.scrollLeftBtn || !this.scrollRightBtn || !this.tabListBtn) return;
    // the "all tabs" button toggles its menu: remember whether the menu was open before the global
    // mousedown handler of the context menu closes it (registered first, so this capture runs first)
    document.addEventListener('mousedown', (e) => {
      if (this.tabListBtn.contains(e.target)) this._tabListWasOpen = !!(this._tabListMenu && this._tabListMenu.isConnected);
    }, true);
    for (const b of [this.scrollLeftBtn, this.scrollRightBtn, this.tabListBtn]) b.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus in the terminal
    this.scrollLeftBtn.addEventListener('click', () => this.scrollTabs(-1));
    this.scrollRightBtn.addEventListener('click', () => this.scrollTabs(1));
    this.tabListBtn.addEventListener('click', () => {
      if (this._tabListWasOpen) { this._tabListWasOpen = false; return; }
      this.showTabList();
    });
    this.tabsEl.addEventListener('scroll', () => this.syncTabOverflow(), { passive: true });
    new ResizeObserver(() => this.syncTabOverflow()).observe(this.tabsEl); // window / sidebar resizes
    new MutationObserver(() => this.syncTabOverflow()).observe(this.tabsEl, { childList: true, subtree: true, characterData: true }); // tabs added, removed, retitled
    this.syncTabOverflow();
  }

  /**
   * Arrows and fades exist only while the strip overflows; an arrow is disabled at its end. The DOM writes are
   * deferred to the next frame (coalesced): showing/hiding an arrow resizes #tabs, and doing that inside the
   * ResizeObserver callback itself logs "ResizeObserver loop completed with undelivered notifications".
   */
  syncTabOverflow() {
    if (this._ovfRaf) return;
    this._ovfRaf = requestAnimationFrame(() => { this._ovfRaf = 0; this._syncTabOverflowNow(); });
  }

  _syncTabOverflowNow() {
    if (!this.barEl || !this.scrollLeftBtn) return;
    const el = this.tabsEl;
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 1;
    const atStart = el.scrollLeft <= 1, atEnd = el.scrollLeft >= max - 1;
    const focused = document.activeElement;
    this.scrollLeftBtn.hidden = this.scrollRightBtn.hidden = !overflow;
    this.scrollLeftBtn.disabled = !overflow || atStart;
    this.scrollRightBtn.disabled = !overflow || atEnd;
    this.barEl.classList.toggle('ovf-left', overflow && !atStart);
    this.barEl.classList.toggle('ovf-right', overflow && !atEnd);
    this.tabListBtn.hidden = this.tabs.length === 0;
    if (focused === this.scrollLeftBtn || focused === this.scrollRightBtn) this._keepArrowFocus(focused);
    if (overflow !== this._wasOverflow) {
      this._wasOverflow = overflow;
      if (overflow && this.active && this.active.tabEl) this.revealTab(this.active); // the arrows just took space: keep the active tab in view
    }
  }

  /** A focused arrow that just got disabled or hidden must not drop focus on <body>: the other arrow if it can scroll, else the active tab, else ＋. */
  _keepArrowFocus(arrow) {
    if (!arrow.disabled && !arrow.hidden) return;
    const other = arrow === this.scrollLeftBtn ? this.scrollRightBtn : this.scrollLeftBtn;
    const to = !other.hidden && !other.disabled ? other : this.active?.tabEl || document.getElementById('tab-add');
    to?.focus({ preventScroll: true });
  }

  /** Scroll the strip by one tab: the first tab cut off on that side becomes fully visible. */
  scrollTabs(dir) {
    const el = this.tabsEl;
    const base = el.getBoundingClientRect().left - el.scrollLeft; // content x → scroll offset
    const tabs = [...el.querySelectorAll('.tab')].map((t) => { const r = t.getBoundingClientRect(); return { left: r.left - base, right: r.right - base }; });
    const left = el.scrollLeft, right = left + el.clientWidth;
    let target;
    if (dir > 0) {
      const t = tabs.find((t) => t.right > right + 1);
      target = t ? t.right - el.clientWidth : left + el.clientWidth;
    } else {
      const t = [...tabs].reverse().find((t) => t.left < left - 1);
      target = t ? t.left : left - el.clientWidth;
    }
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }

  /** Menu listing every tab (status dot, icon, title; ✓ marks the active one); picking one activates it. */
  showTabList(anchor = this.tabListBtn) {
    if (!this.tabs.length || !anchor) return null;
    const items = this.tabs.map((tab) => ({
      label: h('span', { class: 'tab-menu-item' },
        h('span', { class: 'dot ' + (tab.activePane ? tab.activePane.status : '') }),
        tab.icon ? h('span', { class: 'tabico' }, tab.icon) : null,
        h('span', { class: 'title' }, tab.title),
        tab.zoomed ? h('span', { class: 'zoomico', title: t('A pane is zoomed') }, icon('zoom')) : null,
        tab.pinned ? h('span', { class: 'pinico', title: t('Pinned') }, icon('pin')) : null),
      key: tab === this.active ? '✓' : '',
      action: () => this.activate(tab),
    }));
    const r = anchor.getBoundingClientRect();
    const menu = contextMenu(r.left, r.bottom + 4, items);
    menu.classList.add('tab-list');
    // .tab-list caps the height at 60vh (scrolling): place the menu again with that size, not the full list's that
    // contextMenu measured (40 tabs put the box above the window and its first entries out of reach)
    menu.style.top = Math.max(6, Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 6)) + 'px';
    menu.style.left = Math.max(6, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 6)) + 'px'; // right-aligned under the button
    // the active tab's entry is in view and holds the keyboard cursor (↑/↓ start from it; Home still reaches the first tab)
    const current = menu.querySelectorAll('.ctx-item')[this.tabs.indexOf(this.active)];
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
      current.focus({ preventScroll: true });
    }
    this._tabListMenu = menu;
    return menu;
  }

  /** Every pane of the tab repaints with its own palette (a re-mounted terminal must never keep a stale one). */
  syncThemes(tab) {
    for (const p of tab.panes()) if (typeof p.applyTheme === 'function') p.applyTheme(this.app.settings);
    this.syncTabTheme(tab);
  }

  /**
   * The active tab is painted in its terminal's colours (.tab.active reads --term-bg / --term-fg): a pane with its own
   * theme hands them to its tab, so the tab blends into the pane below it instead of keeping the global theme's colours
   * (a white tab over a Dracula pane on the light chrome); a pane on the global theme leaves the tab on the root tokens.
   */
  syncTabTheme(tab) {
    if (!tab.tabEl) return;
    const pane = tab.activePane;
    const own = pane && pane.session && pane.session.theme && typeof pane.themeFor === 'function' ? pane.themeFor() : null;
    if (own) {
      tab.tabEl.style.setProperty('--term-bg', own.background || '#1e1e1e');
      tab.tabEl.style.setProperty('--term-fg', own.foreground || '#ececec');
    } else {
      tab.tabEl.style.removeProperty('--term-bg');
      tab.tabEl.style.removeProperty('--term-fg');
    }
  }

  // ---------- tabs ----------
  newTab(pane, title) {
    const tab = new Tab(title || pane.title);
    tab.root = { type: 'pane', pane };
    pane.tab = tab;
    tab.activePane = pane;
    tab.tabEl = this._buildTabEl(tab);
    this.tabsEl.append(tab.tabEl);
    this.contentEl.append(tab.pageEl);
    this.tabs.push(tab);
    this.render(tab);
    this.activate(tab);
    return tab;
  }

  _buildTabEl(tab) {
    const el = h('div', { class: 'tab', draggable: true, dataset: { tab: tab.id }, role: 'tab', tabindex: -1, 'aria-selected': 'false' },
      h('span', { class: 'dot' }),
      h('span', { class: 'tabico', hidden: !tab.icon }, tab.icon || ''),
      h('span', { class: 'title' }, tab.title),
      h('span', { class: 'zoomico', hidden: !tab.zoomed }, icon('zoom')),
      h('span', { class: 'pinico', hidden: !tab.pinned }, icon('pin')),
      h('button', { class: 'close', tabindex: -1, onclick: (e) => { e.stopPropagation(); this.app.closeTab(tab); } }, icon('x'))
    );
    this._relabelTab(tab, el); // the tooltips and the close button's name, in the current language
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); if (!tab.pinned) this.app.closeTab(tab); } // a pinned tab has no accidental close: ⌘W, the menu or ⌫ on the focused tab
    });
    // Activate on click, not mousedown: a tab being dragged onto another tab's pane must not become
    // the visible tab mid-drag (that made tab → pane moves impossible with the mouse).
    el.addEventListener('click', (e) => { if (e.button === 0) this.activate(tab); });
    el.addEventListener('dblclick', () => this.renameTab(tab));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.activate(tab);
      this.tabMenu(tab, e.clientX, e.clientY);
    });
    // drag reorder
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-mobalt-tab', tab.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-mobalt-tab')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-mobalt-tab');
      const src = this.tabs.find((t) => t.id === id);
      if (!src || src === tab) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      let idx = this.tabs.indexOf(tab) + (before ? 0 : 1);
      if (this.tabs.indexOf(src) < idx) idx--; // the hole src leaves behind
      this.moveTab(src, idx);
    });
    return el;
  }

  /** The strip's own words on a tab — the tooltips, the close button's name — in the current language; the title is the tab's. */
  _relabelTab(tab, el = tab.tabEl) {
    if (!el) return;
    el.title = tab.pinned ? t('{title} (pinned)', { title: tab.title }) : tab.title;
    el.querySelector('.zoomico').title = t('A pane is zoomed (⇧⌘⏎ restores the layout)');
    el.querySelector('.pinico').title = t('Pinned (⇧⌘P unpins)');
    const close = el.querySelector('.close');
    close.title = t('Close (⌘W)');
    close.setAttribute('aria-label', t('Close tab'));
  }

  /** A language switch (i18n:changed): every label the strip keeps on screen, again; nothing else moves. */
  relabel() {
    this.tabsEl.setAttribute('aria-label', t('Terminal tabs'));
    for (const tab of this.tabs) this._relabelTab(tab);
  }

  /** Number of pinned tabs; they are always the prefix of `tabs` (moveTab keeps it so). */
  pinnedCount() {
    return this.tabs.filter((t) => t.pinned).length;
  }

  /**
   * Put `tab` at index `idx` of the strip (drag reorder, pinning), clamped to its group: a pinned tab never goes
   * past an unpinned one and an unpinned tab never before a pinned one. Returns the index it landed on.
   */
  moveTab(tab, idx) {
    const cur = this.tabs.indexOf(tab);
    if (cur < 0) return -1;
    this.tabs.splice(cur, 1);
    const pinned = this.pinnedCount(); // without `tab`
    idx = tab.pinned ? Math.min(idx, pinned) : Math.max(idx, pinned);
    idx = Math.max(0, Math.min(idx, this.tabs.length));
    this.tabs.splice(idx, 0, tab);
    const next = this.tabs[idx + 1];
    // re-inserting the element blurs it: a tab moved from the keyboard (⇧⌘P, the ⇧F10 menu's Pin / Unpin) keeps the focus
    const hadFocus = document.activeElement === tab.tabEl;
    if (next && next.tabEl) next.tabEl.before(tab.tabEl);
    else this.tabsEl.append(tab.tabEl);
    if (hadFocus) {
      tab.tabEl.focus({ preventScroll: true });
      this.revealTab(tab);
    }
    this.app.onTabsChanged?.(); // the native Session menu follows the strip (Close Tabs to the Left / Right)
    this.app.saveWorkspaceSoon?.();
    return idx;
  }

  /**
   * Pin a tab (it joins the end of the pinned block at the left) or unpin it (it becomes the first unpinned tab, right
   * after the block), so the strip always reads pinned tabs first. Returns true when the state changed.
   */
  setPinned(tab, on) {
    on = !!on;
    if (tab.pinned === on) return false;
    tab.pinned = on;
    this.moveTab(tab, this.tabs.filter((t) => t !== tab && t.pinned).length);
    this.updateTab(tab);
    return true;
  }

  /** Restored tabs come in saved order; a workspace edited by hand may interleave them: pinned tabs go first (stable). */
  sortPinnedFirst() {
    const order = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)];
    if (order.every((t, i) => t === this.tabs[i])) return;
    this.tabs = order;
    for (const t of order) this.tabsEl.append(t.tabEl); // append moves an existing child: the DOM follows the array
    this.app.onTabsChanged?.();
  }

  /**
   * The tabs a bulk close acts on: 'others' (every other tab), 'left' / 'right' (the tabs on that side of `tab`) or
   * 'all'. Pinned tabs are never among them — unpin one (or ⌘W it) to close it.
   */
  closeTargets(tab, which) {
    const i = this.tabs.indexOf(tab);
    const list = which === 'left' ? this.tabs.slice(0, i)
      : which === 'right' ? this.tabs.slice(i + 1)
      : which === 'others' ? this.tabs.filter((t) => t !== tab)
      : [...this.tabs];
    return list.filter((t) => !t.pinned);
  }

  tabMenu(tab, x, y) {
    // opened from the focused tab (⇧F10): closing keeps the keyboard in the strip instead of dropping it on <body>
    const fromStrip = document.activeElement === tab.tabEl, i = this.tabs.indexOf(tab);
    const closing = (fn) => async () => { await fn(); if (fromStrip) this._refocusStrip(tab, i); };
    // the bulk closes name their targets up front: an item with nothing to close is disabled (pinned tabs never count)
    const bulk = (which) => this.closeTargets(tab, which);
    const closeItem = (label, which) => ({ label, action: closing(() => this.app.closeTabs(bulk(which))), disabled: !bulk(which).length });
    contextMenu(x, y, [
      { label: t('Rename Tab…'), action: () => this.renameTab(tab) },
      { label: t('Duplicate'), key: '⇧⌘T', action: () => this.app.action('duplicate') },
      { label: t('Tab Color'), action: () => this.pickColor(tab) },
      { label: tab.pinned ? t('Unpin Tab') : t('Pin Tab'), key: '⇧⌘P', action: () => this.app.togglePin(tab) },
      '-',
      { label: t('Split Right'), key: '⌘D', action: () => this.app.action('split', 'right') },
      { label: t('Split Down'), key: '⇧⌘D', action: () => this.app.action('split', 'down') },
      '-',
      { label: t('Detach to New Window'), key: '⌥⌘N', action: () => this.app.detachTab(tab) },
      '-',
      { label: t('Close'), key: '⌘W', action: closing(() => this.app.closeTab(tab)) },
      closeItem(t('Close Others'), 'others'),
      closeItem(t('Close Tabs to the Left'), 'left'),
      closeItem(t('Close Tabs to the Right'), 'right'),
      closeItem(t('Close All'), 'all'),
    ]);
  }

  /** After closing from the strip: `tab` if it survived (cancelled), else the tab now at its place, else ＋. */
  _refocusStrip(tab, i) {
    const next = this.tabs.includes(tab) ? tab : this.tabs[Math.min(i, this.tabs.length - 1)];
    (next ? next.tabEl : document.getElementById('tab-add')).focus();
  }

  /** Scroll a tab fully into view, clear of the 18px edge fades (scrollIntoView alone leaves it under the fade). */
  revealTab(tab) {
    const el = this.tabsEl, r = tab.tabEl.getBoundingClientRect(), b = el.getBoundingClientRect(), fade = 18;
    if (r.left < b.left + fade) el.scrollLeft -= b.left + fade - r.left;
    else if (r.right > b.right - fade) el.scrollLeft += r.right - (b.right - fade);
  }

  /** Roving tabindex: only `tab` is reachable with the Tab key; arrows move between the others. */
  _rove(tab) {
    for (const t of this.tabs) if (t.tabEl) t.tabEl.tabIndex = t === tab ? 0 : -1;
  }

  /** Keys on a focused tab: ←/→ (↑/↓) move, Home/End, Enter/Space activate, ⌫/Delete close, ⇧F10 menu. */
  _onTabKey(e) {
    const el = e.target;
    const tab = el.classList?.contains('tab') && this.tabs.find((t) => t.tabEl === el);
    if (!tab || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = this.tabs.indexOf(tab), n = this.tabs.length;
    const focusTab = (t) => { t.tabEl.focus({ preventScroll: true }); this.revealTab(t); };
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowUp': focusTab(this.tabs[(i - 1 + n) % n]); break;
      case 'ArrowRight': case 'ArrowDown': focusTab(this.tabs[(i + 1) % n]); break;
      case 'Home': focusTab(this.tabs[0]); break;
      case 'End': focusTab(this.tabs[n - 1]); break;
      case 'Enter': case ' ': this.activate(tab); break;
      case 'Backspace': case 'Delete': this._closeTabFromKeyboard(tab); break;
      case 'F10': case 'ContextMenu': { // ⇧F10 and the Menu key open the tab's context menu
        if (e.key === 'F10' && !e.shiftKey) return;
        const r = el.getBoundingClientRect();
        this.activate(tab);
        el.focus(); // the menu returns focus to the tab, not to the terminal
        this.tabMenu(tab, r.left + 8, r.bottom);
        break;
      }
      default: return;
    }
    e.preventDefault();
  }

  async _closeTabFromKeyboard(tab) {
    const i = this.tabs.indexOf(tab);
    await this.app.closeTab(tab); // may ask for confirmation (live connections)
    this._refocusStrip(tab, i); // the last tab closed: ＋ gets the focus, never <body>
  }

  async renameTab(tab) {
    const name = await promptDialog(t('Rename tab'), { value: tab.title });
    if (name === null) return;
    tab.autoTitle = !name.trim();
    tab.title = name.trim() || (tab.activePane ? tab.activePane.title : t('Terminal'));
    if (tab.autoTitle) this.app.deriveTabTitle?.(tab); // back to automatic: the session's name and icon again
    this.updateTab(tab);
  }

  pickColor(tab) {
    const colors = [null, '#e5534b', '#e6b422', '#4caf50', '#4ea1ff', '#bd93f9', '#ff79c6'];
    const idx = colors.indexOf(tab.color);
    tab.color = colors[(idx + 1) % colors.length];
    this.updateTab(tab);
  }

  updateTab(tab) {
    if (!tab.tabEl) return;
    tab.tabEl.querySelector('.title').textContent = tab.title;
    tab.tabEl.title = tab.pinned ? t('{title} (pinned)', { title: tab.title }) : tab.title;
    tab.tabEl.classList.toggle('pinned', !!tab.pinned);
    const pin = tab.tabEl.querySelector('.pinico');
    if (pin) pin.hidden = !tab.pinned;
    const pane = tab.activePane;
    const dot = tab.tabEl.querySelector('.dot');
    dot.className = 'dot ' + (pane ? pane.status : '');
    if (tab.color) tab.tabEl.style.setProperty('--tab-color', tab.color);
    else tab.tabEl.style.removeProperty('--tab-color');
    this.syncTabTheme(tab);
    const ico = tab.tabEl.querySelector('.tabico');
    if (ico) {
      ico.textContent = tab.icon || '';
      ico.hidden = !tab.icon;
    }
    this._syncZoomIndicator(tab);
    this.app.onTabUpdated?.(tab); // a detached window is titled after its active tab
    this.app.saveWorkspaceSoon?.();
  }

  // ---------- pane zoom ----------
  /**
   * Zoom `pane` to fill its tab (its siblings stay alive but hidden), or restore the split layout with null.
   * A pane that is not in the tab, or a tab with a single pane, cannot be zoomed. Returns true when the
   * state changed. The zoomed pane is the tab's active pane; the caller focuses it.
   */
  setZoom(tab, pane) {
    const panes = tab.panes();
    const next = pane && panes.length > 1 && panes.includes(pane) ? pane : null;
    if (tab.zoomed === next) return false;
    tab.zoomed = next;
    if (next) tab.activePane = next;
    this._applyZoom(tab);
    for (const p of panes) p.fit(); // the zoomed pane grows to the tab, the restored ones shrink back to their cells
    for (const p of panes) p.syncWebgl?.(); // hidden siblings give their GPU context back, restored ones take one (terminal.js WEBGL_BUDGET)
    this.app.updateMultiexec?.(); // the broadcast set is the zoomed pane alone
    this.app.saveWorkspaceSoon?.();
    return true;
  }

  /** DOM state of a tab's zoom: the page class (styles.css "pane zoom"), each pane's head and the tab's indicator. */
  _applyZoom(tab) {
    tab.pageEl.classList.toggle('zoomed', !!tab.zoomed);
    for (const p of tab.panes()) p.setZoomed?.(p === tab.zoomed);
    this._syncZoomIndicator(tab);
  }

  _syncZoomIndicator(tab) {
    if (!tab.tabEl) return;
    const z = tab.tabEl.querySelector('.zoomico');
    if (z) z.hidden = !tab.zoomed;
    tab.tabEl.classList.toggle('zoomed', !!tab.zoomed);
  }

  activate(tab) {
    if (this.active === tab) {
      tab.activePane && tab.activePane.focus();
      return;
    }
    const prev = this.active;
    if (prev) {
      prev.tabEl.classList.remove('active');
      prev.tabEl.setAttribute('aria-selected', 'false');
      prev.pageEl.classList.remove('active');
    }
    this.active = tab;
    if (prev) for (const p of prev.panes()) p.syncWebgl?.(); // off screen now: their GPU contexts go back to the budget first…
    tab.tabEl.classList.add('active');
    tab.tabEl.setAttribute('aria-selected', 'true');
    tab.pageEl.classList.add('active');
    this._rove(tab);
    tab.tabEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    for (const p of tab.panes()) p.fit();
    for (const p of tab.panes()) p.syncWebgl?.(); // …and the panes shown now take theirs (terminal.js WEBGL_BUDGET)
    if (tab.activePane) this.app.focusPane(tab.activePane, true);
    this.app.onActiveTabChanged(tab);
  }

  removeTab(tab) {
    const idx = this.tabs.indexOf(tab);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);
    tab.tabEl.remove();
    tab.pageEl.remove();
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      if (next) this.activate(next);
      else this.app.onActiveTabChanged(null);
    }
    this.app.onTabsChanged?.();
    this.app.saveWorkspaceSoon?.();
  }

  nextTab(dir = 1) {
    if (!this.active || this.tabs.length < 2) return;
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }

  // ---------- splits ----------
  _findParent(node, target, parent = null) {
    if (node === target) return parent;
    if (node.type === 'split') {
      for (const c of node.children) {
        const r = this._findParent(c, target, node);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }

  _nodeOf(tab, pane) {
    let found = null;
    const walk = (n) => {
      if (found) return;
      if (n.type === 'pane' && n.pane === pane) found = n;
      else if (n.type === 'split') n.children.forEach(walk);
    };
    walk(tab.root);
    return found;
  }

  /** Split `pane` and place `newPane` to the right/left/down/up of it. */
  split(tab, pane, dir, newPane) {
    const node = this._nodeOf(tab, pane);
    if (!node) return;
    this.setZoom(tab, null); // a new pane must be seen: the layout comes back first
    const parent = this._findParent(tab.root, node);
    const newNode = { type: 'pane', pane: newPane };
    const before = dir === 'left' || dir === 'up';
    const splitNode = { type: 'split', dir: dir === 'right' || dir === 'left' ? 'h' : 'v', children: before ? [newNode, node] : [node, newNode], ratio: 0.5 };
    if (!parent) tab.root = splitNode;
    else parent.children[parent.children.indexOf(node)] = splitNode;
    newPane.tab = tab;
    this.render(tab);
  }

  /** Swap a pane in place (used when a session is dropped onto a pane). */
  replace(tab, pane, newPane) {
    const node = this._nodeOf(tab, pane);
    if (!node) return false;
    node.pane = newPane;
    newPane.tab = tab;
    if (tab.activePane === pane) tab.activePane = newPane;
    if (tab.zoomed === pane) tab.zoomed = newPane; // the replacement takes the zoomed pane's place on screen too
    this.render(tab);
    return true;
  }

  removePane(tab, pane) {
    const node = this._nodeOf(tab, pane);
    if (!node) return false;
    this.setZoom(tab, null); // closing or moving a pane (zoomed or hidden) shows the layout that remains
    const parent = this._findParent(tab.root, node);
    if (!parent) {
      tab.root = null;
      return true; // tab now empty
    }
    const sibling = parent.children.find((c) => c !== node);
    const grand = this._findParent(tab.root, parent);
    if (!grand) tab.root = sibling;
    else grand.children[grand.children.indexOf(parent)] = sibling;
    this.render(tab);
    if (tab.activePane === pane) {
      const first = tab.panes()[0];
      tab.activePane = first || null;
      if (first) {
        this.app.focusPane(first, true);
        this.app.onPaneTitle(first); // an auto-titled tab follows the pane it shows now, not the one that left (closed or moved to another tab)
      }
    }
    this.app.syncTabTitle?.(tab); // the pane the tab was named after may be the one that went
    return false;
  }

  /**
   * Arrange the tab's panes into a cols×rows grid (row-major), creating empty panes for the
   * missing cells with `makeEmpty()`. Extra panes beyond cols×rows add rows. Returns the new panes.
   */
  applyGrid(tab, cols, rows, makeEmpty) {
    this.setZoom(tab, null); // a grid is a layout: every pane is on screen again
    const existing = tab.panes();
    const total = Math.max(cols * rows, existing.length);
    rows = Math.ceil(total / cols);
    const cells = [...existing];
    const created = [];
    while (cells.length < cols * rows) {
      const p = makeEmpty();
      p.tab = tab;
      cells.push(p);
      created.push(p);
    }
    const chain = (items, dir) => (items.length === 1 ? items[0] : { type: 'split', dir, children: [items[0], chain(items.slice(1), dir)], ratio: 1 / items.length });
    const rowNodes = [];
    for (let r = 0; r < rows; r++) rowNodes.push(chain(cells.slice(r * cols, (r + 1) * cols).map((p) => ({ type: 'pane', pane: p })), 'h'));
    tab.root = chain(rowNodes, 'v');
    if (!tab.activePane || !cells.includes(tab.activePane)) tab.activePane = cells[0];
    this.render(tab);
    return created;
  }

  /** Move a live pane from its tab next to `targetPane` in another tab (drag a tab onto a pane). */
  movePane(pane, targetPane, dir) {
    const srcTab = pane.tab, dstTab = targetPane.tab;
    if (!srcTab || !dstTab || pane === targetPane) return;
    pane.el.remove();
    const empty = this.removePane(srcTab, pane);
    if (empty) this.removeTab(srcTab);
    if (dir === 'center' && targetPane.kind === 'empty') {
      this.replace(dstTab, targetPane, pane);
      targetPane.dispose();
    } else {
      this.split(dstTab, targetPane, dir === 'center' ? 'right' : dir, pane);
    }
    this.activate(dstTab);
    this.app.focusPane(pane, true);
    this.app.onPaneTitle(pane); // the moved pane is the target tab's active pane now: an auto-titled target takes its name
  }

  // ---------- unsplit (⌥⌘1, View → Unsplit, Split ▾ → Unsplit): what becomes of the other panes ----------
  /**
   * The verb an unsplit applies, from Settings → Terminal → Unsplit or a caller's explicit choice: 'tabs' or 'active'
   * as given; 'ask' puts the question for `tab` — "Move panes to tabs" / "Keep only this pane" / Cancel — and
   * resolves 'tabs' | 'active', or null when cancelled (the split stays). The question names the live connections
   * that closing would drop, so it is the confirmation too (app.js unsplit asks nothing more). Anything else (an
   * older settings file) is the default, 'tabs'.
   */
  async resolveUnsplitMode(mode, tab) {
    if (mode === 'tabs' || mode === 'active') return mode;
    if (mode !== 'ask') return 'tabs';
    const others = tab ? tab.panes().filter((p) => p !== tab.activePane) : [];
    const n = Math.max(1, others.length);
    const live = others.filter((p) => p.status === 'connected' && p.kind !== 'local' && !p.dead).length;
    const m = showModal({
      title: t('Unsplit this tab'),
      width: 'narrow',
      body: h('div', {},
        tn('The other pane can become a tab of its own right after this one, its terminal as it is — or close.', 'The {n} other panes can become tabs of their own right after this one, their terminals as they are — or close.', n),
        live ? ' ' + tn('Closing drops {n} live connection.', 'Closing drops {n} live connections.', live) : ''),
      buttons: [
        { label: t('Cancel'), value: null },
        { label: t('Keep only this pane'), value: 'active', danger: live > 0 },
        { label: t('Move panes to tabs'), primary: true, value: 'tabs' },
      ],
    });
    const r = await m.promise;
    return r === 'tabs' || r === 'active' ? r : null;
  }

  /**
   * Unsplit → tabs: every pane of `tab` but `keep` (the active pane) leaves for a tab of its own, placed right after
   * `tab` in pane order — behind the pinned block when `tab` is pinned, as the new tabs are not — with its terminal,
   * title, status and monitoring bar as they are: nothing restarts or reconnects. The zoom is cleared, `keep` stays
   * the active pane and gets the focus. Returns the new tabs (none for a tab with a single pane).
   */
  unsplitToTabs(tab, keep) {
    const panes = tab.panes();
    keep = keep && panes.includes(keep) ? keep : tab.activePane || panes[0];
    const others = panes.filter((p) => p !== keep);
    if (!others.length) return [];
    tab.activePane = keep; // removePane never has to pick a replacement: the pane staying is the active one
    const made = [];
    let at = this.tabs.indexOf(tab) + 1;
    for (const p of others) {
      const nt = this.paneToTab(p, at);
      if (!nt) continue;
      made.push(nt);
      at = this.tabs.indexOf(nt) + 1; // the next one goes right after it (the pinned block may have pushed it)
    }
    this.app.focusPane(keep, true);
    this.app.updateMultiexec?.(); // the broadcast set is the one pane on screen now
    return made;
  }

  /**
   * Move a live pane out of its tab into a new tab of its own at strip index `idx` (never inside the pinned block:
   * the new tab is not pinned), the way a tab dragged onto a pane moves one between tabs: the pane's element, xterm
   * and backend travel with it. The tab is titled like one opened for the pane (its session's name, icon and colour,
   * else the pane's title) and is not activated. Returns the new tab; null for a pane that is alone in its tab.
   */
  paneToTab(pane, idx) {
    const src = pane.tab;
    if (!src || src.panes().length < 2 || !this._nodeOf(src, pane)) return null;
    pane.el.remove();
    this.removePane(src, pane); // never empties src: another pane stays there
    const tab = new Tab(pane.session ? pane.session.name : pane.title);
    tab.root = { type: 'pane', pane };
    pane.tab = tab;
    tab.activePane = pane;
    tab.color = pane.session?.color || null;
    tab.icon = pane.session?.icon || null;
    tab.tabEl = this._buildTabEl(tab);
    idx = Math.max(this.pinnedCount(), Math.min(idx, this.tabs.length));
    this.tabs.splice(idx, 0, tab);
    const next = this.tabs[idx + 1];
    if (next && next.tabEl) next.tabEl.before(tab.tabEl);
    else this.tabsEl.append(tab.tabEl);
    this.contentEl.append(tab.pageEl);
    this.render(tab); // the pane is mounted already: it is only placed; it fits when the tab is shown
    this.app.deriveTabTitle?.(tab);
    this.updateTab(tab);
    this.app.onTabsChanged?.();
    return tab;
  }

  render(tab) {
    const build = (n) => {
      if (n.type === 'pane') {
        const p = n.pane;
        return p.el;
      }
      const el = h('div', { class: 'split ' + n.dir });
      const a = h('div', { class: 'split-child', style: { flex: `${n.ratio} 1 0` } }, build(n.children[0]));
      const b = h('div', { class: 'split-child', style: { flex: `${1 - n.ratio} 1 0` } }, build(n.children[1]));
      const splitter = h('div', { class: 'splitter' });
      splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const move = (ev) => {
          const r = n.dir === 'h' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
          n.ratio = Math.min(0.9, Math.max(0.1, r));
          a.style.flex = `${n.ratio} 1 0`;
          b.style.flex = `${1 - n.ratio} 1 0`;
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          for (const p of tab.panes()) p.fit();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      el.append(a, splitter, b);
      return el;
    };
    tab.pageEl.replaceChildren();
    if (!tab.root) {
      tab.zoomed = null;
      this._applyZoom(tab);
      return;
    }
    tab.pageEl.append(build(tab.root));
    const panes = tab.panes();
    if (tab.zoomed && (panes.length < 2 || !panes.includes(tab.zoomed))) tab.zoomed = null; // the zoomed pane left, or nothing is left to hide
    this._applyZoom(tab);
    for (const p of panes) {
      p.el.classList.toggle('show-head', panes.length > 1);
      p.mount();
      p.fit();
      p.syncWebgl?.(); // a re-layout may have shown or hidden the pane (zoom, split): the renderer follows
    }
    this.syncThemes(tab);
    this.app.saveWorkspaceSoon?.();
  }

  allPanes() {
    return this.tabs.flatMap((t) => t.panes());
  }
}
