// Sessions tree (left panel): folders, filter, drag to folder, context menus.
import { $, h, contextMenu, confirmDialog, promptDialog, toast } from './ui.js';

const ICON = { ssh: 'ico-ssh', mosh: 'ico-ssh', local: 'ico-local', telnet: 'ico-telnet', ftp: 'ico-rdp', rdp: 'ico-rdp', vnc: 'ico-vnc', serial: 'ico-telnet' };

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
      if (e.key === 'ArrowDown') {
        this.focusRow(this.visibleRows()[0]);
        e.preventDefault();
      }
    });
    // Rows stop propagation, so anything that reaches here (background, gutter, empty state) is "root".
    this.el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tree-row')) return;
      e.preventDefault();
      this.rootMenu(e.clientX, e.clientY);
    });
    // keyboard: rows are tree items with a roving tabindex (one Tab stop), see onKey()
    this.el.setAttribute('role', 'tree');
    this.el.setAttribute('aria-label', 'Saved sessions');
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('focusin', (e) => {
      const r = e.target.closest('.tree-row');
      if (r) this._rove(r);
    });
    // drop onto root (empty area) -> move to root folder
    this.el.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('text/x-mobalt-session') || t.includes('text/x-mobalt-folder')) e.preventDefault();
    });
    this.el.addEventListener('drop', (e) => {
      if (e.target !== this.el) return;
      const id = e.dataTransfer.getData('text/x-mobalt-session');
      if (id) return this.moveToFolder(id, '');
      const src = e.dataTransfer.getData('text/x-mobalt-folder');
      if (src) this.moveFolder(src, '');
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
    // a re-render while the keyboard is in the tree (status dot, delete…) must not drop focus on <body>
    const fa = document.activeElement;
    const focused = fa && fa.classList.contains('tree-row') && this.el.contains(fa) ? { session: fa.dataset.session, folder: fa.dataset.folder, index: this.visibleRows().indexOf(fa) } : null;
    this.el.replaceChildren();
    const q = this.filterEl.value.trim();
    const renderNode = (node, depth, container) => {
      const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const f of folders) {
        if (q && !this.countSessions(f)) continue; // filtering: only folders with matching sessions
        const collapsed = !q && this.collapsed.has(f.path);
        const wrap = h('div', { class: 'tree-folder' + (collapsed ? ' collapsed' : '') });
        const row = h('div', { class: 'tree-row folder', dataset: { folder: f.path }, draggable: true, role: 'treeitem', tabindex: -1, 'aria-expanded': String(!collapsed) },
          h('span', { class: 'caret' }, '▼'),
          h('span', { class: 'ico' }, '📁'),
          h('span', { class: 'label' }, f.name),
          h('span', { class: 'sub' }, String(this.countSessions(f)))
        );
        row._folder = f;
        row.addEventListener('click', () => this.toggleFolder(f.path, wrap));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.folderMenu(e.clientX, e.clientY, f);
        });
        row.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/x-mobalt-folder', f.path);
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragover', (e) => {
          const t = e.dataTransfer.types;
          if (t.includes('text/x-mobalt-session') || t.includes('text/x-mobalt-folder')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('drop-target');
          }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          const id = e.dataTransfer.getData('text/x-mobalt-session');
          const src = id ? '' : e.dataTransfer.getData('text/x-mobalt-folder');
          if (!id && !src) return;
          if (this.collapsed.delete(f.path)) this.saveCollapsed(); // show where the drop went
          if (id) return this.moveToFolder(id, f.path);
          this.moveFolder(src, f.path);
        });
        const children = h('div', { class: 'tree-children', role: 'group' });
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
    this._syncRoving();
    if (focused) {
      const rows = this.visibleRows();
      const again = rows.find((r) => (focused.session ? r.dataset.session === focused.session : r.dataset.folder === focused.folder)) || rows[Math.min(focused.index, rows.length - 1)];
      if (again) { again.focus({ preventScroll: true }); this._rove(again); }
    }
  }

  /** Rows the keyboard can reach: every row not inside a collapsed folder, in display order. */
  visibleRows() {
    const hidden = (r) => !!(r.classList.contains('folder') ? r.parentElement.parentElement : r.parentElement).closest('.tree-folder.collapsed');
    return [...this.el.querySelectorAll('.tree-row')].filter((r) => !hidden(r));
  }

  /** Roving tabindex: `row` is the tree's single Tab stop. */
  _rove(row) {
    for (const r of this.el.querySelectorAll('.tree-row')) r.tabIndex = r === row ? 0 : -1;
  }

  _syncRoving() {
    const rows = this.visibleRows();
    this._rove(rows.find((r) => r.dataset.session && r.dataset.session === this.selected) || rows[0] || null);
  }

  /** Keyboard cursor: focus the row (the ring is drawn by :focus-visible); selection follows it. */
  focusRow(row) {
    if (!row) return;
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
    this.select(row.dataset.session || null);
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
      : `${s.username ? s.username + '@' : ''}${s.host || ''}${s.port && s.port !== { ssh: 22, mosh: 22, telnet: 23, ftp: 21, rdp: 3389, vnc: 5900 }[s.type] ? ':' + s.port : ''}`;
    const row = h('div', { class: 'tree-row' + (this.selected === s.id ? ' selected' : ''), dataset: { session: s.id }, draggable: true, title: `${s.name}\n${sub}`, role: 'treeitem', tabindex: -1 },
      s.icon
        ? h('span', { class: 'ico emoji', style: s.color ? { color: s.color } : null }, s.icon)
        : h('span', { class: 'ico ' + (ICON[s.type] || ''), style: s.color ? { color: s.color } : null }, '●'),
      h('span', { class: 'label' }, s.name),
      open ? h('span', { class: 'dot', title: 'connected' }) : null,
      h('span', { class: 'sub' }, sub)
    );
    row._session = s;
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
      // folders accept "move", panes accept "copy": both must be allowed or Chromium refuses the drop
      e.dataTransfer.effectAllowed = 'copyMove';
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
    wrap.firstElementChild.setAttribute('aria-expanded', String(!this.collapsed.has(path)));
    this.saveCollapsed();
  }

  /**
   * Keys on a focused row: ↑/↓ move over folders and sessions alike, → expands a folder / enters it,
   * ← collapses / goes to the parent folder, Enter opens a session (⌘/⌃/⇧Enter: in a split right) or
   * toggles a folder, Space toggles a folder, ⌫/Delete deletes (with the usual confirmation), ⇧F10 menu.
   */
  onKey(e) {
    if (e.altKey) return;
    const rows = this.visibleRows();
    const row = e.target.closest('.tree-row');
    const i = rows.indexOf(row);
    if (i < 0) {
      // no row focused yet: ↓/Home start at the first row, ↑/End at the last one
      if (e.key === 'ArrowDown' || e.key === 'Home') this.focusRow(rows[0]);
      else if (e.key === 'ArrowUp' || e.key === 'End') this.focusRow(rows[rows.length - 1]);
      else return;
      return e.preventDefault();
    }
    const f = row._folder, s = row._session;
    const wrap = f ? row.parentElement : null; // .tree-folder
    const parentFolderRow = () => (f ? wrap.parentElement : row.parentElement).closest('.tree-folder')?.firstElementChild || null;
    switch (e.key) {
      case 'ArrowDown': this.focusRow(rows[i + 1]); break;
      case 'ArrowUp': i === 0 ? this.filterEl.focus() : this.focusRow(rows[i - 1]); break; // ↑ from the first row: back to the filter (↓ from it comes here)
      case 'Home': this.focusRow(rows[0]); break;
      case 'End': this.focusRow(rows[rows.length - 1]); break;
      case 'ArrowRight':
        if (!f) return;
        if (wrap.classList.contains('collapsed')) this.toggleFolder(f.path, wrap);
        else if (rows[i + 1] && wrap.contains(rows[i + 1])) this.focusRow(rows[i + 1]);
        break;
      case 'ArrowLeft':
        if (f && !wrap.classList.contains('collapsed')) this.toggleFolder(f.path, wrap);
        else this.focusRow(parentFolderRow());
        break;
      case 'Enter':
        if (f) this.toggleFolder(f.path, wrap);
        else this.app.openSession(s, e.metaKey || e.ctrlKey || e.shiftKey ? { split: 'right' } : {});
        break;
      case ' ':
        if (f) this.toggleFolder(f.path, wrap);
        else this.select(s.id);
        break;
      case 'Backspace': case 'Delete':
        this._deleteRow(row);
        break;
      case 'F10': case 'ContextMenu': { // ⇧F10 and the Menu key open the row's context menu
        if (e.key === 'F10' && !e.shiftKey) return;
        const r = row.getBoundingClientRect();
        if (f) this.folderMenu(r.left + 24, r.bottom, f);
        else { this.select(s.id); this.sessionMenu(r.left + 24, r.bottom, s); }
        break;
      }
      default: return;
    }
    e.preventDefault();
  }

  /** The row currently showing session `s` / folder `f` (null when filtered out or collapsed away). */
  rowFor(s, f) {
    return [...this.el.querySelectorAll('.tree-row')].find((r) => (s ? r._session === s || r.dataset.session === s.id : r._folder?.path === f.path)) || null;
  }

  /**
   * Delete the row's session or folder (after the usual confirmation) and keep the keyboard in the tree: on the
   * row that followed the deleted one — found again by identity, since a folder that only existed through the
   * deleted session disappears with it and shifts the indexes — else the previous row, else by index.
   */
  async _deleteRow(row) {
    const rows = this.visibleRows();
    const i = rows.indexOf(row);
    const neighbour = rows[i + 1] || rows[i - 1] || null;
    const key = neighbour ? { session: neighbour.dataset.session, folder: neighbour.dataset.folder } : null;
    const deleted = row._folder ? await this.deleteFolder(row._folder) : await this.deleteSession(row._session);
    if (!deleted) return; // cancelled: the dialog handed focus back to the row
    const now = this.visibleRows();
    const again = (key && now.find((r) => (key.session ? r.dataset.session === key.session : r.dataset.folder === key.folder))) || now[Math.min(Math.max(i, 0), now.length - 1)];
    if (again) this.focusRow(again);
    else (this.el.querySelector('.tree-empty .link-btn') || this.filterEl).focus(); // the tree is empty now: its "Create a session" link
  }

  /** Re-parent a folder (drag-drop): "a/b" into "c" becomes "c/b"; descendants and sessions follow. */
  async moveFolder(srcPath, destPath) {
    if (!srcPath || srcPath === destPath) return;
    if (destPath && (destPath + '/').startsWith(srcPath + '/')) return toast('Cannot move a folder into itself', 'warn');
    const name = srcPath.split('/').pop();
    const target = destPath ? destPath + '/' + name : name;
    if (target === srcPath) return;
    const re = (p) => (p === srcPath ? target : (p || '').startsWith(srcPath + '/') ? target + p.slice(srcPath.length) : p);
    const sessions = this.app.sessions.sessions.map((s) => ({ ...s, folder: re(s.folder || '') }));
    const folders = [...new Set([...(this.app.sessions.folders || []).map(re), target])];
    if (this.collapsed.delete(srcPath)) this.collapsed.add(target);
    this.saveCollapsed();
    await this.app.saveAllSessions({ sessions, folders });
  }

  async moveToFolder(id, folder) {
    const s = this.sessionById(id);
    if (!s || (s.folder || '') === folder) return;
    const from = s.folder || '';
    const known = this.app.sessions.folders || [];
    // keep a folder that only existed through this session (typed into the editor) instead of dropping it silently
    if (from && !known.includes(from)) await this.app.saveAllSessions({ sessions: this.app.sessions.sessions, folders: [...known, from] });
    await this.app.saveSession({ ...s, folder });
  }

  async deleteSession(s) {
    if (!(await confirmDialog(`Delete session "${s.name}"?`, { title: 'Delete session', okLabel: 'Delete', danger: true }))) return false;
    await this.app.deleteSession(s.id);
    toast(`Deleted ${s.name}`, 'info');
    return true;
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
      { label: 'Delete', key: '⌫', danger: true, action: () => { const row = this.rowFor(s); return row ? this._deleteRow(row) : this.deleteSession(s); } },
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
      { label: 'Delete Folder', danger: true, action: () => { const row = this.rowFor(null, f); return row ? this._deleteRow(row) : this.deleteFolder(f); } },
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
    if (name.includes('/')) return toast('Folder names cannot contain "/" — use New Subfolder to nest folders', 'warn');
    const path = (parent ? parent + '/' : '') + name.trim();
    const folders = new Set(this.app.sessions.folders || []);
    folders.add(path);
    if (parent && this.collapsed.delete(parent)) this.saveCollapsed(); // show where the new folder went
    await this.app.saveAllSessions({ sessions: this.app.sessions.sessions, folders: [...folders] });
  }

  async renameFolder(f) {
    const name = await promptDialog('Rename folder', { value: f.name });
    if (!name || !name.trim() || name.trim() === f.name) return;
    const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (name.includes('/')) return toast('Folder names cannot contain "/"', 'warn');
    const np = (parent ? parent + '/' : '') + name.trim();
    const re = (p) => (p === f.path ? np : p.startsWith(f.path + '/') ? np + p.slice(f.path.length) : p);
    const sessions = this.app.sessions.sessions.map((s) => ({ ...s, folder: re(s.folder || '') }));
    const folders = [...new Set((this.app.sessions.folders || []).map(re))];
    this.collapsed = new Set([...this.collapsed].map(re)); // collapsed state follows the renamed folder
    this.saveCollapsed();
    await this.app.saveAllSessions({ sessions, folders });
  }

  async deleteFolder(f) {
    const n = this.countSessions(f);
    const ok = await confirmDialog(n ? `Delete folder "${f.name}" and its ${n} session(s)?` : `Delete folder "${f.name}"?`, { title: 'Delete folder', okLabel: 'Delete', danger: true });
    if (!ok) return false;
    const inside = (p) => p === f.path || (p || '').startsWith(f.path + '/');
    const sessions = this.app.sessions.sessions.filter((s) => !inside(s.folder || ''));
    const folders = (this.app.sessions.folders || []).filter((p) => !inside(p));
    await this.app.saveAllSessions({ sessions, folders });
    return true;
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
