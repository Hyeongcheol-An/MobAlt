// SFTP browser panel (left sidebar "Sftp" tab) bound to the active SSH pane's connection.
import { $, h, contextMenu, confirmDialog, promptDialog, toast, fmtSize, fmtDate, fmtDuration, showModal } from './ui.js';

const TEXT_EXT = /\.(txt|md|json|ya?ml|toml|ini|cfg|conf|config|sh|bash|zsh|py|js|ts|jsx|tsx|mjs|cjs|rb|go|rs|java|kt|c|h|cpp|hpp|cc|cs|php|pl|lua|sql|xml|html?|css|scss|less|env|log|csv|tsv|gitignore|dockerfile|service|properties|tf|hcl|nix|vim|el|lisp|r|jl|dart|swift|m|mm|gradle|cmake|mk|makefile)$/i;

/** Human-readable error text: strip Electron's IPC wrapper and translate bare SFTP status codes. */
function errMsg(e) {
  let m = (e && e.message) || String(e);
  m = m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (/^Failure$/i.test(m)) m = 'The server refused the operation (does the name already exist?)';
  else if (/^No such file$/i.test(m)) m = 'Path not found';
  else if (/^Permission denied$/i.test(m)) m = 'Permission denied';
  return m;
}

/** Connection id the panel binds to for a pane: SSH/FTP panes own one, a Mosh pane uses its SFTP companion. */
export function connIdOf(pane) {
  if (!pane) return null;
  if (pane.kind === 'mosh') return pane.sftpStatus === 'connected' ? pane.sftpConnId : null;
  return (pane.kind === 'ssh' || pane.kind === 'ftp') && pane.status === 'connected' ? pane.termId : null;
}

export class SftpPanel {
  constructor(app) {
    this.app = app;
    this.states = new Map(); // connId -> {path, entries, selected:Set, hidden, follow, pane}
    this.connId = null;
    this.transfers = new Map();
    this.els = {
      empty: $('#sftp-empty'), ui: $('#sftp-ui'), conn: $('#sftp-conn'), path: $('#sftp-path'), pathForm: $('#sftp-path-form'),
      follow: $('#sftp-follow'), hidden: $('#sftp-hidden'), list: $('#sftp-list'), transfers: $('#sftp-transfers'),
    };
    for (const b of document.querySelectorAll('[data-sftp]')) b.addEventListener('click', () => this.cmd(b.dataset.sftp));
    this.els.pathForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.navigate(this.els.path.value.trim());
    });
    this.els.follow.addEventListener('change', () => {
      const st = this.state();
      if (st) {
        st.follow = this.els.follow.checked;
        if (st.follow && st.pane && st.pane.remoteCwd) this.navigate(st.pane.remoteCwd);
      }
    });
    this.els.hidden.addEventListener('change', () => {
      const st = this.state();
      if (st) {
        st.hidden = this.els.hidden.checked;
        this.renderList();
      }
    });
    const list = this.els.list;
    list.addEventListener('contextmenu', (e) => {
      if (e.target === list || e.target.classList.contains('sftp-msg')) {
        e.preventDefault();
        this.menu(e.clientX, e.clientY, null);
      }
    });
    list.addEventListener('keydown', (e) => this.onKey(e));
    list.addEventListener('click', (e) => {
      if (e.target === list) this.clearSelection();
    });
    list.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        list.classList.add('drop-hover');
      }
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('drop-hover');
    });
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drop-hover');
      const paths = Array.from(e.dataTransfer.files || []).map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (paths.length) this.upload(paths);
    });
  }

  state() {
    return this.connId ? this.states.get(this.connId) : null;
  }

  /** Called by the app whenever the active pane changes. */
  setPane(pane) {
    this.renderMoshHint(pane);
    const connId = connIdOf(pane);
    if (!connId) {
      this.setConnection(null);
      return;
    }
    if (!this.states.has(connId)) {
      this.states.set(connId, { path: null, entries: [], selected: new Set(), hidden: false, follow: !!pane.session?.followCwd, pane, loading: false });
    } else this.states.get(connId).pane = pane;
    this.setConnection(connId);
  }

  setConnection(connId) {
    this.connId = connId;
    const st = this.state();
    this.els.empty.hidden = !!st;
    this.els.ui.hidden = !st;
    if (!st) return;
    const s = st.pane.session || {};
    const defPort = s.type === 'ftp' ? 21 : 22;
    this.els.conn.replaceChildren(h('b', {}, s.name || st.pane.title), ' ', `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== defPort ? ':' + s.port : ''}`, s.type === 'mosh' ? ' · via SSH' : '');
    this.els.follow.checked = st.follow;
    this.els.hidden.checked = st.hidden;
    if (st.path === null && !st.loading) this.navigate(st.pane.remoteCwd || '.');
    else this.renderList();
  }

  show(connId) {
    this.app.showPanel('sftp');
    const pane = this.app.paneByConn(connId);
    if (pane) this.setPane(pane);
  }

  dropConnection(connId) {
    this.states.delete(connId);
    if (this.connId === connId) this.setConnection(null);
  }

  /** Mosh panes have no SSH channel of their own: the empty state offers the companion SSH connection. */
  renderMoshHint(pane) {
    if (this.moshEl) {
      this.moshEl.remove();
      this.moshEl = null;
    }
    if (!pane || pane.kind !== 'mosh' || pane.dead || pane.status !== 'connected' || pane.sftpStatus === 'connected') return;
    const s = pane.session || {};
    const where = `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;
    const connecting = pane.sftpStatus === 'connecting';
    this.moshEl = h('div', { class: 'sftp-mosh' },
      h('p', {}, `Mosh session "${s.name || where}": files are browsed over a separate SSH connection to ${where}.`),
      h('button', { class: 'btn small', disabled: connecting, onclick: () => pane.openSftpCompanion() }, connecting ? 'Connecting via SSH…' : 'Open SFTP for this host (via SSH)'),
      pane.sftpStatus === 'failed' && pane.sftpError ? h('div', { class: 'sftp-mosh-err' }, pane.sftpError) : null
    );
    this.els.empty.append(this.moshEl);
  }

  onPaneCwd(pane) {
    const connId = connIdOf(pane);
    const st = connId && this.states.get(connId);
    if (st && st.follow && pane.remoteCwd && pane.remoteCwd !== st.path) {
      if (this.connId === connId) this.navigate(pane.remoteCwd);
      else st.path = null; // reload on next show
    }
  }

  async navigate(path) {
    const connId = this.connId;
    const st = this.state();
    if (!st || !connId) return;
    st.loading = true;
    if (st.path === null) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, 'Loading…'));
    try {
      if (path === '~' || (path || '').startsWith('~/')) path = (await window.api.sftp.home(connId)) + path.slice(1);
      const r = await window.api.sftp.list(connId, path || '.');
      if (this.connId !== connId) return;
      st.path = r.path;
      st.entries = r.entries;
      st.selected.clear();
      this.els.path.value = r.path;
      this.els.path.scrollLeft = this.els.path.scrollWidth; // long paths: keep the tail visible
      this.renderList();
      this.app.setStatusCwd(r.path);
    } catch (e) {
      if (this.connId !== connId) return;
      toast(`${path || '.'}: ${errMsg(e)}`, 'error');
      if (st.path === null) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, errMsg(e)));
      else {
        this.els.path.value = st.path; // revert to the folder that is actually shown
        this.renderList();
      }
    } finally {
      st.loading = false;
    }
  }

  renderList() {
    const st = this.state();
    if (!st) return;
    const list = this.els.list;
    list.replaceChildren();
    st.sort = st.sort || { key: 'name', dir: 1 };
    const cmp = (a, b) => {
      if (a.type !== b.type) return a.type === 'd' ? -1 : 1; // folders first, whatever the sort key
      const k = st.sort.key;
      const d = k === 'size' ? a.size - b.size : k === 'mtime' ? a.mtime - b.mtime : a.name.localeCompare(b.name);
      return (d || a.name.localeCompare(b.name)) * st.sort.dir;
    };
    const entries = st.entries.filter((e) => st.hidden || !e.name.startsWith('.')).sort(cmp);
    const headCell = (key, label, cls) => {
      const active = st.sort.key === key;
      return h('span', { class: cls + (active ? ' sorted' : ''), title: 'Sort by ' + label.toLowerCase(), onclick: () => {
        st.sort = { key, dir: active ? -st.sort.dir : 1 };
        this.renderList();
      } }, label + (active ? (st.sort.dir > 0 ? ' ▲' : ' ▼') : ''));
    };
    list.append(h('div', { class: 'sftp-row sftp-head' }, h('span', {}), headCell('name', 'Name', 'name'), headCell('size', 'Size', 'size'), headCell('mtime', 'Modified', 'date')));
    if (st.path !== '/') {
      const up = h('div', { class: 'sftp-row dir', dataset: { name: '..' } }, h('span', {}, '📁'), h('span', { class: 'name' }, '..'), h('span', { class: 'size' }), h('span', { class: 'date' }));
      up.addEventListener('dblclick', () => this.cmd('up'));
      list.append(up);
    }
    if (!entries.length) list.append(h('div', { class: 'sftp-msg' }, 'Empty folder'));
    for (const e of entries) {
      const row = h('div', {
        class: 'sftp-row' + (e.type === 'd' ? ' dir' : '') + (e.link ? ' link' : '') + (e.name.startsWith('.') ? ' hidden-file' : '') + (st.selected.has(e.name) ? ' selected' : ''),
        dataset: { name: e.name }, title: `${e.modeStr} ${e.owner}:${e.group}${e.target ? ' → ' + e.target : ''}`,
      },
        h('span', {}, e.type === 'd' ? '📁' : fileGlyph(e.name)),
        h('span', { class: 'name' }, e.name),
        h('span', { class: 'size' }, e.type === 'd' ? '' : fmtSize(e.size)),
        h('span', { class: 'date' }, fmtDate(e.mtime))
      );
      row.addEventListener('click', (ev) => this.select(e, ev));
      row.addEventListener('dblclick', () => this.open(e));
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (!st.selected.has(e.name)) this.select(e, ev);
        this.menu(ev.clientX, ev.clientY, e);
      });
      list.append(row);
    }
  }

  select(e, ev) {
    const st = this.state();
    if (!st) return;
    if (ev && (ev.metaKey || ev.ctrlKey)) {
      if (st.selected.has(e.name)) st.selected.delete(e.name);
      else st.selected.add(e.name);
    } else if (ev && ev.shiftKey && st.lastSel) {
      const names = st.entries.filter((x) => st.hidden || !x.name.startsWith('.')).map((x) => x.name);
      const a = names.indexOf(st.lastSel), b = names.indexOf(e.name);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) st.selected.add(names[i]);
    } else {
      st.selected.clear();
      st.selected.add(e.name);
    }
    st.lastSel = e.name;
    for (const r of this.els.list.querySelectorAll('.sftp-row')) r.classList.toggle('selected', st.selected.has(r.dataset.name));
    this.els.list.focus();
  }

  clearSelection() {
    const st = this.state();
    if (!st) return;
    st.selected.clear();
    for (const r of this.els.list.querySelectorAll('.sftp-row')) r.classList.remove('selected');
  }

  selectedEntries() {
    const st = this.state();
    return st ? st.entries.filter((e) => st.selected.has(e.name)) : [];
  }

  join(name) {
    const st = this.state();
    return (st.path === '/' ? '' : st.path) + '/' + name;
  }

  onKey(e) {
    const st = this.state();
    if (!st) return;
    const sel = this.selectedEntries();
    if (e.key === 'Enter' && sel.length === 1) this.open(sel[0]);
    else if (e.key === 'Backspace' && !e.metaKey) this.cmd('up');
    else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && sel.length) this.cmd('delete');
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const names = st.entries.filter((x) => st.hidden || !x.name.startsWith('.')).map((x) => x.name);
      const i = names.indexOf(st.lastSel);
      const n = names[Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) {
        this.select(st.entries.find((x) => x.name === n), e.shiftKey ? e : null);
        const row = this.els.list.querySelector(`.sftp-row[data-name="${CSS.escape(n)}"]`);
        row && row.scrollIntoView({ block: 'nearest' });
      }
      e.preventDefault();
    } else if (e.key === 'a' && e.metaKey) {
      st.entries.forEach((x) => (st.hidden || !x.name.startsWith('.')) && st.selected.add(x.name));
      this.renderList();
      e.preventDefault();
    }
  }

  async open(e) {
    if (e.type === 'd') return this.navigate(this.join(e.name));
    if (e.size <= 2 * 1024 * 1024 && (TEXT_EXT.test(e.name) || !/\./.test(e.name) || e.size < 64 * 1024)) return this.editBuiltin(e);
    return this.download([e]);
  }

  async cmd(name) {
    const st = this.state();
    if (!st) return;
    const sel = this.selectedEntries();
    switch (name) {
      case 'up': {
        if (st.path === '/') return;
        const parent = st.path.replace(/\/[^/]+\/?$/, '') || '/';
        return this.navigate(parent);
      }
      case 'home': return this.navigate('.');
      case 'refresh': return this.navigate(st.path);
      case 'mkdir': {
        const n = await promptDialog('New folder', { placeholder: 'folder name' });
        if (!n || !n.trim()) return;
        try {
          await window.api.sftp.mkdir(this.connId, this.join(n.trim()));
          await this.navigate(st.path);
        } catch (err) {
          toast(errMsg(err), 'error');
        }
        return;
      }
      case 'upload': return this.upload(null);
      case 'download': return sel.length ? this.download(sel) : toast('Select files to download', 'warn');
      case 'delete': return sel.length ? this.remove(sel) : toast('Select files to delete', 'warn');
      case 'terminal-cd': {
        if (st.pane) {
          st.pane.write(`cd ${shellQuote(st.path)}\r`);
          st.pane.focus();
        }
        return;
      }
    }
  }

  async upload(paths) {
    const st = this.state();
    if (!st) return;
    return this.uploadTo(this.connId, paths, st.path, st.entries);
  }

  /** Upload with an overwrite check (used by the panel and by drops on a terminal). */
  async uploadTo(connId, paths, dir, entries) {
    if (!paths || !paths.length) {
      try {
        const ids = await window.api.sftp.upload(connId, [], dir); // native picker
        if (ids && ids.length) toast(`Uploading ${ids.length} item(s)`, 'info');
      } catch (e) {
        toast(errMsg(e), 'error');
      }
      return;
    }
    try {
      if (!entries) entries = (await window.api.sftp.list(connId, dir)).entries;
      const names = new Set(entries.map((e) => e.name));
      const base = (p) => p.replace(/\/+$/, '').split('/').pop();
      const conflicts = paths.filter((p) => names.has(base(p)));
      let todo = paths;
      if (conflicts.length) {
        const what = conflicts.length === 1 ? `"${base(conflicts[0])}" already exists` : `${conflicts.length} items already exist`;
        const ok = await confirmDialog(`${what} in ${dir}. Overwrite?`, { title: 'Overwrite?', okLabel: 'Overwrite', danger: true });
        if (!ok) todo = paths.filter((p) => !names.has(base(p)));
        if (!todo.length) return toast('Upload skipped', 'info');
      }
      const ids = await window.api.sftp.upload(connId, todo, dir);
      if (ids && ids.length) toast(`Uploading ${ids.length} item(s)`, 'info');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async download(entries) {
    for (const e of entries) {
      try {
        await window.api.sftp.download(this.connId, this.join(e.name), null, e.type === 'd');
      } catch (err) {
        toast(errMsg(err), 'error');
      }
    }
  }

  async remove(entries) {
    const dirs = entries.filter((e) => e.type === 'd').length;
    const what = entries.length === 1 ? (dirs ? `folder "${entries[0].name}" and everything inside it` : `"${entries[0].name}"`) : `${entries.length} items${dirs ? ` (including ${dirs} folder${dirs > 1 ? 's' : ''} with their contents)` : ''}`;
    const ok = await confirmDialog(`Delete ${what} on the remote host? This cannot be undone.`, { title: 'Delete', okLabel: 'Delete', danger: true });
    if (!ok) return;
    const st = this.state();
    for (const e of entries) {
      try {
        await window.api.sftp.remove(this.connId, this.join(e.name), e.type === 'd');
      } catch (err) {
        toast(`${e.name}: ${errMsg(err)}`, 'error');
      }
    }
    this.navigate(st.path);
  }

  async rename(e) {
    const n = await promptDialog('Rename', { value: e.name });
    if (!n || n === e.name) return;
    try {
      await window.api.sftp.rename(this.connId, this.join(e.name), this.join(n));
      this.navigate(this.state().path);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }

  async chmod(e) {
    const cur = (e.mode & 0o777).toString(8).padStart(3, '0');
    const v = await promptDialog(`Permissions for ${e.name}`, { label: `Octal mode (current ${cur}, ${e.modeStr.slice(1)})`, value: cur });
    if (!v || !/^[0-7]{3,4}$/.test(v)) return;
    try {
      if (!/^[0-7]{3,4}$/.test(v.trim())) return toast('Enter an octal mode such as 755 or 0644', 'warn');
      await window.api.sftp.chmod(this.connId, this.join(e.name), parseInt(v.trim(), 8));
      this.navigate(this.state().path);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }

  async editBuiltin(e) {
    const connId = this.connId;
    const remote = this.join(e.name);
    let content;
    try {
      content = await window.api.sftp.read(connId, remote);
    } catch (err) {
      return toast(errMsg(err), 'error');
    }
    const ta = h('textarea', { class: 'editor-area', spellcheck: false });
    ta.value = content;
    let dirty = false;
    ta.addEventListener('input', () => (dirty = true));
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const s = ta.selectionStart;
        ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        dirty = true;
      }
      if (ev.key === 's' && ev.metaKey) {
        ev.preventDefault();
        save();
      }
    });
    const save = async () => {
      try {
        await window.api.sftp.write(connId, remote, ta.value);
        dirty = false;
        toast(`Saved ${e.name}`, 'success');
        this.navigate(this.state()?.path);
      } catch (err) {
        toast(errMsg(err), 'error');
      }
    };
    const m = showModal({
      title: `${e.name} — ${remote}`,
      width: 'wide',
      closeOnBackdrop: false,
      body: ta,
      buttons: [
        { label: 'Open in External Editor', action: async (api) => { api.close(); this.editExternal(e); } },
        { label: 'Close', action: async (api) => { if (dirty && !(await confirmDialog('Discard unsaved changes?', { okLabel: 'Discard', danger: true }))) return; api.close(); } },
        { label: 'Save (⌘S)', primary: true, action: () => save() },
      ],
    });
    m.el.querySelector('.modal-body').style.padding = '8px';
    setTimeout(() => ta.focus(), 20);
  }

  async editExternal(e) {
    try {
      const r = await window.api.sftp.edit(this.connId, this.join(e.name));
      toast(`Opened ${e.name} in editor; saves are uploaded automatically`, 'info', 5000);
      return r;
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  }

  menu(x, y, e) {
    const st = this.state();
    const sel = this.selectedEntries();
    const items = [];
    if (e) {
      items.push(
        e.type === 'd' ? { label: 'Open', action: () => this.open(e) } : { label: 'Edit (built-in)', action: () => this.editBuiltin(e) },
        e.type === 'f' ? { label: 'Edit in External Editor', action: () => this.editExternal(e) } : null,
        { label: `Download${sel.length > 1 ? ` (${sel.length})` : ''}`, action: () => this.download(sel.length ? sel : [e]) },
        '-',
        { label: 'Rename…', action: () => this.rename(e) },
        { label: 'Permissions…', action: () => this.chmod(e) },
        { label: 'Copy Path', action: () => window.api.clipboard.write(this.join(e.name)) },
        e.type === 'd' ? { label: 'cd Terminal Here', action: () => { st.pane.write(`cd ${shellQuote(this.join(e.name))}\r`); st.pane.focus(); } } : null,
        '-',
        { label: `Delete${sel.length > 1 ? ` (${sel.length})` : ''}`, danger: true, action: () => this.remove(sel.length ? sel : [e]) },
        '-'
      );
    }
    items.push(
      { label: 'Upload Files Here…', action: () => this.upload(null) },
      { label: 'New Folder…', action: () => this.cmd('mkdir') },
      { label: 'Refresh', action: () => this.cmd('refresh') },
      { label: st.hidden ? 'Hide Hidden Files' : 'Show Hidden Files', action: () => { this.els.hidden.checked = !st.hidden; this.els.hidden.dispatchEvent(new Event('change')); } },
      { label: 'Copy Current Path', action: () => window.api.clipboard.write(st.path) }
    );
    contextMenu(x, y, items);
  }

  // ---------- transfers ----------
  onTransfer(t) {
    const prev = this.transfers.get(t.id);
    if (t.status !== 'running' && !(prev && prev.finishedAt)) t.finishedAt = Date.now();
    else if (prev && prev.finishedAt) t.finishedAt = prev.finishedAt;
    this.transfers.set(t.id, t);
    if (t.status !== 'running') {
      if (t.status === 'done') {
        const st = this.states.get(t.connId);
        if (st && this.connId === t.connId && t.kind === 'upload') this.navigate(st.path);
        setTimeout(() => { this.transfers.delete(t.id); this.renderTransfers(); }, 30000);
      } else if (t.status === 'error') toast(`${t.kind} ${t.name}: ${t.error}`, 'error', 6000);
    }
    this.renderTransfers();
    this.app.setStatusTransfers([...this.transfers.values()].filter((x) => x.status === 'running').length);
  }

  renderTransfers() {
    const el = this.els.transfers;
    el.replaceChildren();
    const list = [...this.transfers.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
    for (const t of list) {
      const pct = t.total ? Math.min(100, Math.round((t.transferred / t.total) * 100)) : t.status === 'done' ? 100 : 0;
      const elapsed = (t.finishedAt || Date.now()) - t.startedAt;
      const speed = elapsed > 300 ? fmtSize((t.transferred / elapsed) * 1000) + '/s' : '';
      el.append(h('div', { class: 'xfer ' + t.status },
        h('div', { class: 'l1' }, h('span', {}, t.kind === 'upload' ? '⇪' : '⇩'), h('span', { class: 'n', title: t.remote }, t.name),
          t.status === 'running' ? h('button', { title: 'Cancel', onclick: () => window.api.sftp.cancel(t.id) }, '✕') : null,
          t.status === 'done' && t.kind === 'download' ? h('button', { title: 'Show in Finder', onclick: () => window.api.shell.showItem(t.local) }, '📂') : null),
        h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })),
        h('div', { class: 'l2' }, h('span', {}, t.status === 'running' ? `${fmtSize(t.transferred)} / ${fmtSize(t.total)}${t.filesTotal > 1 ? ` · ${t.filesDone}/${t.filesTotal} files` : ''}` : t.status === 'error' ? t.error : t.status), h('span', {}, t.status === 'running' ? speed : fmtDuration(elapsed)))
      ));
    }
  }
}

function fileGlyph(name) {
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(name)) return '🖼';
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name)) return '🗜';
  if (/\.(sh|bash|zsh|py|js|ts|go|rs|rb|java|c|cpp|h)$/i.test(name)) return '📜';
  if (/\.(pdf|docx?|xlsx?|pptx?)$/i.test(name)) return '📑';
  return '📄';
}

export function shellQuote(p) {
  return /^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}
