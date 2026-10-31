// Tabs and split-pane layout. Each tab owns a tree: {type:'pane', pane} | {type:'split', dir, children:[a,b], ratio}
import { h, contextMenu, promptDialog, icon } from './ui.js';

let tabSeq = 0;

export class Tab {
  constructor(title) {
    this.id = 't' + ++tabSeq;
    this.title = title;
    this.autoTitle = true;
    this.color = null;
    this.icon = null;
    this.root = null;
    this.activePane = null;
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
    this.tabsEl.setAttribute('aria-label', 'Terminal tabs');
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
    const items = this.tabs.map((t) => ({
      label: h('span', { class: 'tab-menu-item' },
        h('span', { class: 'dot ' + (t.activePane ? t.activePane.status : '') }),
        t.icon ? h('span', { class: 'tabico' }, t.icon) : null,
        h('span', { class: 'title' }, t.title)),
      key: t === this.active ? '✓' : '',
      action: () => this.activate(t),
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
      h('button', { class: 'close', title: 'Close (⌘W)', 'aria-label': 'Close tab', tabindex: -1, onclick: (e) => { e.stopPropagation(); this.app.closeTab(tab); } }, icon('x'))
    );
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); this.app.closeTab(tab); }
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
      this.tabs.splice(this.tabs.indexOf(src), 1);
      const idx = this.tabs.indexOf(tab) + (before ? 0 : 1);
      this.tabs.splice(idx, 0, src);
      if (before) el.before(src.tabEl);
      else el.after(src.tabEl);
      this.app.saveWorkspaceSoon?.();
    });
    return el;
  }

  tabMenu(tab, x, y) {
    // opened from the focused tab (⇧F10): closing keeps the keyboard in the strip instead of dropping it on <body>
    const fromStrip = document.activeElement === tab.tabEl, i = this.tabs.indexOf(tab);
    const closing = (fn) => async () => { await fn(); if (fromStrip) this._refocusStrip(tab, i); };
    contextMenu(x, y, [
      { label: 'Rename Tab…', action: () => this.renameTab(tab) },
      { label: 'Duplicate', key: '⇧⌘T', action: () => this.app.action('duplicate') },
      { label: 'Tab Color', action: () => this.pickColor(tab) },
      '-',
      { label: 'Split Right', key: '⌘D', action: () => this.app.action('split', 'right') },
      { label: 'Split Down', key: '⇧⌘D', action: () => this.app.action('split', 'down') },
      '-',
      { label: 'Close', key: '⌘W', action: closing(() => this.app.closeTab(tab)) },
      { label: 'Close Others', action: closing(() => this.tabs.filter((t) => t !== tab).forEach((t) => this.app.closeTab(t))) },
      { label: 'Close All', action: closing(() => [...this.tabs].forEach((t) => this.app.closeTab(t))) },
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
    const name = await promptDialog('Rename tab', { value: tab.title });
    if (name === null) return;
    tab.autoTitle = !name.trim();
    tab.title = name.trim() || (tab.activePane ? tab.activePane.title : 'Terminal');
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
    tab.tabEl.title = tab.title;
    const pane = tab.activePane;
    const dot = tab.tabEl.querySelector('.dot');
    dot.className = 'dot ' + (pane ? pane.status : '');
    if (tab.color) tab.tabEl.style.setProperty('--tab-color', tab.color);
    else tab.tabEl.style.removeProperty('--tab-color');
    const ico = tab.tabEl.querySelector('.tabico');
    if (ico) {
      ico.textContent = tab.icon || '';
      ico.hidden = !tab.icon;
    }
    this.app.saveWorkspaceSoon?.();
  }

  activate(tab) {
    if (this.active === tab) {
      tab.activePane && tab.activePane.focus();
      return;
    }
    if (this.active) {
      this.active.tabEl.classList.remove('active');
      this.active.tabEl.setAttribute('aria-selected', 'false');
      this.active.pageEl.classList.remove('active');
    }
    this.active = tab;
    tab.tabEl.classList.add('active');
    tab.tabEl.setAttribute('aria-selected', 'true');
    tab.pageEl.classList.add('active');
    this._rove(tab);
    tab.tabEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    for (const p of tab.panes()) p.fit();
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
    this.render(tab);
    return true;
  }

  removePane(tab, pane) {
    const node = this._nodeOf(tab, pane);
    if (!node) return false;
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
    if (!tab.root) return;
    tab.pageEl.append(build(tab.root));
    const panes = tab.panes();
    for (const p of panes) {
      p.el.classList.toggle('show-head', panes.length > 1);
      p.mount();
      p.fit();
    }
    this.syncThemes(tab);
    this.app.saveWorkspaceSoon?.();
  }

  allPanes() {
    return this.tabs.flatMap((t) => t.panes());
  }
}
