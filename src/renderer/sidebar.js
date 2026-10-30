// Sessions tree (left panel): folders, filter, drag to folder, context menus.
import { $, h, contextMenu, confirmDialog, promptDialog, toast } from './ui.js';

const ICON = { ssh: 'ico-ssh', local: 'ico-local', telnet: 'ico-telnet', rdp: 'ico-rdp', vnc: 'ico-vnc', serial: 'ico-telnet' };

export class SessionTree {
  constructor(app) {
    this.app = app;
    this.el = $('#session-tree');
    this.filterEl = $('#session-filter');
    this.selected = null;
    try {
      this.collapsed = new Set(JSON.parse(localStorage.getItem('mobalt.collapsed') || '[]'));
    } catch {
      this.collapsed = new Set();
    }
    this.filterEl.addEventListener('input', () => this.render());
    this.filterEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = this.el.querySelector('.tree-row[data-session]');
        if (first) this.app.openSession(this.sessionById(first.dataset.session));
      }
      if (e.key === 'Escape') {
        this.filterEl.value = '';
        this.render();
      }
    });
    this.el.addEventListener('contextmenu', (e) => {
      if (e.target === this.el || e.target.classList.contains('tree-empty')) {
        e.preventDefault();
        this.rootMenu(e.clientX, e.clientY);
      }
    });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.tabIndex = 0;
    // drop onto root (empty area) -> move to root folder
    this.el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-mobalt-session')) e.preventDefault();
    });
    this.el.addEventListener('drop', (e) => {
      if (e.target !== this.el) return;
      const id = e.dataTransfer.getData('text/x-mobalt-session');
      if (id) this.moveToFolder(id, '');
    });
  }

  sessionById(id) {
    return this.app.sessions.sessions.find((s) => s.id === id);
  }

  saveCollapsed() {
    localStorage.setItem('mobalt.collapsed', JSON.stringify([...this.collapsed]));
  }

  buildTree() {
    const root = { name: '', path: '', children: new Map(), sessions: [] };
    const ensure = (p) => {
      if (!p) return root;
      let node = root;
      let acc = '';
      for (const part of p.split('/').filter(Boolean)) {
        acc = acc ? acc + '/' + part : part;
        if (!node.children.has(part)) node.children.set(part, { name: part, path: acc, children: new Map(), sessions: [] });
        node = node.children.get(part);
      }
      return node;
    };
    for (const f of this.app.sessions.folders || []) ensure(f);
    const q = this.filterEl.value.trim().toLowerCase();
    for (const s of this.app.sessions.sessions) {
      if (q && !`${s.name} ${s.host || ''} ${s.username || ''} ${s.folder || ''}`.toLowerCase().includes(q)) continue;
      ensure(s.folder || '').sessions.push(s);
    }
    return root;
  }

  render() {
    const root = this.buildTree();
    this.el.replaceChildren();
    const q = this.filterEl.value.trim();
    const renderNode = (node, depth, container) => {
      const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const f of folders) {
        const hasContent = f.sessions.length || f.children.size;
        if (q && !hasContent) continue;
        const collapsed = !q && this.collapsed.has(f.path);
        const wrap = h('div', { class: 'tree-folder' + (collapsed ? ' collapsed' : '') });
        const row = h('div', { class: 'tree-row folder', dataset: { folder: f.path } },
          h('span', { class: 'caret' }, '▼'),
          h('span', { class: 'ico' }, '📁'),
          h('span', { class: 'label' }, f.name),
          h('span', { class: 'sub' }, String(this.countSessions(f)))
        );
        row.addEventListener('click', () => this.toggleFolder(f.path, wrap));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.folderMenu(e.clientX, e.clientY, f);
        });
        row.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('text/x-mobalt-session')) {
            e.preventDefault();
            row.classList.add('drop-target');
          }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          const id = e.dataTransfer.getData('text/x-mobalt-session');
          if (id) this.moveToFolder(id, f.path);
        });
        const children = h('div', { class: 'tree-children' });
        wrap.append(row, children);
        container.append(wrap);
        renderNode(f, depth + 1, children);
      }
      for (const s of node.sessions.sort((a, b) => a.name.localeCompare(b.name))) container.append(this.sessionRow(s));
    };
    renderNode(root, 0, this.el);
    if (!this.el.children.length) {
      this.el.append(h('div', { class: 'tree-empty' }, q ? 'No sessions match.' : 'No saved sessions yet.', h('br'), h('button', { class: 'link-btn', onclick: () => this.app.action('new-session') }, 'Create a session'), ' or ', h('button', { class: 'link-btn', onclick: () => this.app.action('import-sshconfig') }, 'import ~/.ssh/config')));
    }
  }

  countSessions(node) {
    let n = node.sessions.length;
    for (const c of node.children.values()) n += this.countSessions(c);
    return n;
  }

  sessionRow(s) {
    const open = this.app.workspace.allPanes().some((p) => p.session && p.session.id === s.id && p.status === 'connected');
    const sub = s.type === 'local' ? 'local'
      : s.type === 'serial' ? `${(s.serialPath || '').replace('/dev/', '')} @ ${s.baudRate || ''}`
      : `${s.username ? s.username + '@' : ''}${s.host || ''}${s.port && s.port !== { ssh: 22, telnet: 23, rdp: 3389, vnc: 5900 }[s.type] ? ':' + s.port : ''}`;
    const row = h('div', { class: 'tree-row' + (this.selected === s.id ? ' selected' : ''), dataset: { session: s.id }, draggable: true, title: `${s.name}\n${sub}` },
      h('span', { class: 'ico ' + (ICON[s.type] || '') }, '●'),
      h('span', { class: 'label' }, s.name),
      open ? h('span', { class: 'dot', title: 'connected' }) : null,
      h('span', { class: 'sub' }, sub)
    );
    row.addEventListener('click', () => this.select(s.id));
    row.addEventListener('dblclick', () => this.app.openSession(s));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.select(s.id);
      this.sessionMenu(e.clientX, e.clientY, s);
    });
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-mobalt-session', s.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    return row;
  }

  select(id) {
    this.selected = id;
    for (const r of this.el.querySelectorAll('.tree-row[data-session]')) r.classList.toggle('selected', r.dataset.session === id);
  }

  toggleFolder(path, wrap) {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    wrap.classList.toggle('collapsed', this.collapsed.has(path));
    this.saveCollapsed();
  }

  onKey(e) {
    if (!this.selected) return;
    const s = this.sessionById(this.selected);
    if (!s) return;
    if (e.key === 'Enter') this.app.openSession(s);
    else if (e.key === 'Backspace' || e.key === 'Delete') this.deleteSession(s);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...this.el.querySelectorAll('.tree-row[data-session]')];
      const i = rows.findIndex((r) => r.dataset.session === this.selected);
      const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) {
        this.select(n.dataset.session);
        n.scrollIntoView({ block: 'nearest' });
      }
      e.preventDefault();
    }
  }

  async moveToFolder(id, folder) {
    const s = this.sessionById(id);
    if (!s || (s.folder || '') === folder) return;
    await this.app.saveSession({ ...s, folder });
  }

  async deleteSession(s) {
    if (!(await confirmDialog(`Delete session "${s.name}"?`, { title: 'Delete session', okLabel: 'Delete', danger: true }))) return;
    await this.app.deleteSession(s.id);
    toast(`Deleted ${s.name}`, 'info');
  }

  sessionMenu(x, y, s) {
    contextMenu(x, y, [
      { label: 'Open', key: '⏎', action: () => this.app.openSession(s) },
      { label: 'Open in Split Right', action: () => this.app.openSession(s, { split: 'right' }) },
      { label: 'Open in Split Down', action: () => this.app.openSession(s, { split: 'down' }) },
      '-',
      { label: 'Edit…', action: () => this.app.editSession(s) },
      { label: 'Duplicate', action: () => this.app.saveSession({ ...s, id: undefined, name: s.name + ' copy' }) },
      { label: 'Move to Folder…', action: () => this.moveDialog(s) },
      s.type === 'ssh' ? { label: 'Start Tunnel via this Session…', action: () => this.app.action('tunnels', { sessionId: s.id }) } : null,
      '-',
      { label: 'Delete', key: '⌫', danger: true, action: () => this.deleteSession(s) },
    ]);
  }

  folderMenu(x, y, f) {
    contextMenu(x, y, [
      { label: 'New Session Here…', action: () => this.app.editSession({ folder: f.path, type: 'ssh' }) },
      { label: 'New Subfolder…', action: () => this.newFolder(f.path) },
      { label: 'Rename Folder…', action: () => this.renameFolder(f) },
      { label: 'Open All in Grid (2 columns)', action: () => this.app.openSessionsInGrid(this.collectSessions(f)) },
      { label: 'Connect All Sessions (tabs)', action: () => this.connectAll(f) },
      '-',
      { label: 'Delete Folder', danger: true, action: () => this.deleteFolder(f) },
    ]);
  }

  rootMenu(x, y) {
    contextMenu(x, y, [
      { label: 'New Session…', key: '⌘N', action: () => this.app.action('new-session') },
      { label: 'New Folder…', action: () => this.newFolder('') },
      '-',
      { label: 'Import ~/.ssh/config', action: () => this.app.action('import-sshconfig') },
      { label: 'Import MobaXterm.ini…', action: () => this.app.action('import-moba') },
      { label: 'Import JSON…', action: () => this.app.action('import-json') },
      { label: 'Export JSON…', action: () => this.app.action('export-json') },
      '-',
      { label: 'Expand All', action: () => { this.collapsed.clear(); this.saveCollapsed(); this.render(); } },
      { label: 'Collapse All', action: () => { this.collectFolders().forEach((p) => this.collapsed.add(p)); this.saveCollapsed(); this.render(); } },
    ]);
  }

  collectFolders() {
    const out = new Set(this.app.sessions.folders || []);
    for (const s of this.app.sessions.sessions) {
      const parts = (s.folder || '').split('/').filter(Boolean);
      let acc = '';
      for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        out.add(acc);
      }
    }
    return [...out];
  }

  async newFolder(parent) {
    const name = await promptDialog('New folder', { label: parent ? `Inside "${parent}"` : 'Folder name', placeholder: 'Production' });
    if (!name || !name.trim()) return;
    const path = (parent ? parent + '/' : '') + name.trim().replace(/\//g, '-');
    const folders = new Set(this.app.sessions.folders || []);
    folders.add(path);
    await this.app.saveAllSessions({ sessions: this.app.sessions.sessions, folders: [...folders] });
  }

  async renameFolder(f) {
    const name = await promptDialog('Rename folder', { value: f.name });
    if (!name || !name.trim() || name.trim() === f.name) return;
    const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const np = (parent ? parent + '/' : '') + name.trim().replace(/\//g, '-');
    const re = (p) => (p === f.path ? np : p.startsWith(f.path + '/') ? np + p.slice(f.path.length) : p);
    const sessions = this.app.sessions.sessions.map((s) => ({ ...s, folder: re(s.folder || '') }));
    const folders = [...new Set((this.app.sessions.folders || []).map(re))];
    await this.app.saveAllSessions({ sessions, folders });
  }

  async deleteFolder(f) {
    const n = this.countSessions(f);
    const ok = await confirmDialog(n ? `Delete folder "${f.name}" and its ${n} session(s)?` : `Delete folder "${f.name}"?`, { title: 'Delete folder', okLabel: 'Delete', danger: true });
    if (!ok) return;
    const inside = (p) => p === f.path || (p || '').startsWith(f.path + '/');
    const sessions = this.app.sessions.sessions.filter((s) => !inside(s.folder || ''));
    const folders = (this.app.sessions.folders || []).filter((p) => !inside(p));
    await this.app.saveAllSessions({ sessions, folders });
  }

  collectSessions(f) {
    const all = [];
    const walk = (n) => { all.push(...n.sessions); n.children.forEach(walk); };
    walk(f);
    return all;
  }

  connectAll(f) {
    for (const s of this.collectSessions(f)) this.app.openSession(s);
  }

  async moveDialog(s) {
    const folders = this.collectFolders().sort();
    const sel = h('select', {}, h('option', { value: '' }, '(root)'), folders.map((p) => h('option', { value: p, selected: p === (s.folder || '') }, p)));
    const { showModal } = await import('./ui.js');
    const m = showModal({
      title: 'Move to folder',
      width: 'narrow',
      body: h('div', { class: 'form-grid' }, h('label', {}, 'Folder'), sel),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Move', primary: true, action: (api) => api.close(sel.value) }],
    });
    const r = await m.promise;
    if (r !== null) await this.moveToFolder(s.id, r);
  }
}
