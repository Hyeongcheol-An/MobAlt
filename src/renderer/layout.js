// Tabs and split-pane layout. Each tab owns a tree: {type:'pane', pane} | {type:'split', dir, children:[a,b], ratio}
import { h, contextMenu, promptDialog } from './ui.js';

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
      h('button', { class: 'close', title: 'Close (⌘W)', 'aria-label': 'Close tab', tabindex: -1, onclick: (e) => { e.stopPropagation(); this.app.closeTab(tab); } }, '✕')
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
    contextMenu(x, y, [
      { label: 'Rename Tab…', action: () => this.renameTab(tab) },
      { label: 'Duplicate', key: '⇧⌘T', action: () => this.app.action('duplicate') },
      { label: 'Tab Color', action: () => this.pickColor(tab) },
      '-',
      { label: 'Split Right', key: '⌘D', action: () => this.app.action('split', 'right') },
      { label: 'Split Down', key: '⇧⌘D', action: () => this.app.action('split', 'down') },
      '-',
      { label: 'Close', key: '⌘W', action: () => this.app.closeTab(tab) },
      { label: 'Close Others', action: () => this.tabs.filter((t) => t !== tab).forEach((t) => this.app.closeTab(t)) },
      { label: 'Close All', action: () => [...this.tabs].forEach((t) => this.app.closeTab(t)) },
    ]);
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
    const focusTab = (t) => { t.tabEl.focus(); t.tabEl.scrollIntoView({ inline: 'nearest', block: 'nearest' }); };
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
    const next = this.tabs.includes(tab) ? tab : this.tabs[Math.min(i, this.tabs.length - 1)];
    if (next) next.tabEl.focus();
  }

  async renameTab(tab) {
    const name = await promptDialog('Rename tab', { value: tab.title });
    if (name === null) return;
    tab.autoTitle = !name.trim();
    tab.title = name.trim() || (tab.activePane ? tab.activePane.title : 'Terminal');
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
      if (first) this.app.focusPane(first, true);
    }
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
    this.app.saveWorkspaceSoon?.();
  }

  allPanes() {
    return this.tabs.flatMap((t) => t.panes());
  }
}
