// Tabs and split-pane layout. Each tab owns a tree: {type:'pane', pane} | {type:'split', dir, children:[a,b], ratio}
import { h, contextMenu, promptDialog } from './ui.js';

let tabSeq = 0;

export class Tab {
  constructor(title) {
    this.id = 't' + ++tabSeq;
    this.title = title;
    this.autoTitle = true;
    this.color = null;
    this.root = null;
    this.activePane = null;
    this.pageEl = h('div', { class: 'tab-page' });
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
    const el = h('div', { class: 'tab', draggable: true, dataset: { tab: tab.id } },
      h('span', { class: 'dot' }),
      h('span', { class: 'title' }, tab.title),
      h('button', { class: 'close', title: 'Close (⌘W)', onclick: (e) => { e.stopPropagation(); this.app.closeTab(tab); } }, '✕')
    );
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); this.app.closeTab(tab); return; }
      if (e.button === 0) this.activate(tab);
    });
    el.addEventListener('dblclick', () => this.renameTab(tab));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.activate(tab);
      contextMenu(e.clientX, e.clientY, [
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
    });
    // drag reorder
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-mobalt-tab', tab.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-mobalt-tab')) e.preventDefault();
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
    });
    return el;
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
  }

  activate(tab) {
    if (this.active === tab) {
      tab.activePane && tab.activePane.focus();
      return;
    }
    if (this.active) {
      this.active.tabEl.classList.remove('active');
      this.active.pageEl.classList.remove('active');
    }
    this.active = tab;
    tab.tabEl.classList.add('active');
    tab.pageEl.classList.add('active');
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

  split(tab, pane, dir, newPane) {
    const node = this._nodeOf(tab, pane);
    if (!node) return;
    const parent = this._findParent(tab.root, node);
    const newNode = { type: 'pane', pane: newPane };
    const splitNode = { type: 'split', dir: dir === 'right' ? 'h' : 'v', children: [node, newNode], ratio: 0.5 };
    if (!parent) tab.root = splitNode;
    else parent.children[parent.children.indexOf(node)] = splitNode;
    newPane.tab = tab;
    this.render(tab);
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
  }

  allPanes() {
    return this.tabs.flatMap((t) => t.panes());
  }
}
