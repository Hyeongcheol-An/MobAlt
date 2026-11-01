// SFTP browser panel (left sidebar "Sftp" tab) bound to the active SSH pane's connection.
import { $, h, contextMenu, confirmDialog, promptDialog, toast, fmtSize, fmtDate, fmtDuration, showModal, icon, typeAhead, repointOpeners } from './ui.js';
import { t, tn, onChange } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()

const TEXT_EXT = /\.(txt|md|json|ya?ml|toml|ini|cfg|conf|config|sh|bash|zsh|py|js|ts|jsx|tsx|mjs|cjs|rb|go|rs|java|kt|c|h|cpp|hpp|cc|cs|php|pl|lua|sql|xml|html?|css|scss|less|env|log|csv|tsv|gitignore|dockerfile|service|properties|tf|hcl|nix|vim|el|lisp|r|jl|dart|swift|m|mm|gradle|cmake|mk|makefile)$/i;

/**
 * Human-readable error text for toasts, the status bar and a pane's failure line: strips Electron's IPC
 * wrapper, translates bare SFTP status codes and any raw FTP reply ("FTPError: 550 …") that reaches the
 * renderer (the main process already explains most of them, see ftp.js explainFtpError).
 */
export function errMsg(e) {
  let m = (e && e.message) || String(e);
  m = m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^FTPError:\s*/, '');
  if (/^Failure$/i.test(m)) m = t('The server refused the operation (does the name already exist?)');
  else if (/^No such file$/i.test(m)) m = t('Path not found');
  else if (/^Permission denied$/i.test(m)) m = t('Permission denied');
  else {
    const f = /^(\d{3})[ -]?([\s\S]*)$/.exec(m.trim()); // FTP reply code that was not explained in main
    if (f) {
      const code = parseInt(f[1], 10), detail = f[2].trim().replace(/[.\s]+$/, '');
      if (code === 530) m = t('Login failed (530): check the username/password');
      else if (code >= 500 && code <= 504 && /\bAUTH\b/i.test(detail)) m = t('The server does not support FTPS (explicit TLS); untick FTPS');
      else if ((code === 550 || code === 553) && /exist/i.test(detail)) m = t('The name already exists on the server ({code} {detail})', { code, detail });
      else if ((code === 550 || code === 553) && /no such|not found|failed to open|does not exist/i.test(detail)) m = t('Path not found on the server ({code} {detail})', { code, detail });
      else if ((code === 550 || code === 553) && /privilege|permission|denied|not allowed/i.test(detail)) m = t('Permission denied on the server ({code} {detail})', { code, detail });
      else if (code === 550 || code === 553) m = t('The server refused the operation ({code} {detail})', { code, detail });
      else if (code === 421) m = t('The server closed the connection (421 {detail})', { detail });
      else if (code >= 400) m = t('Server error {code}: {detail}', { code, detail });
    }
  }
  return m;
}

/** A listing error that says the folder is not there (SFTP's "No such file", an FTP 550 of that kind). */
export function isNotFound(e) {
  const m = ((e && e.message) || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^FTPError:\s*/, '');
  return /^No such file$/i.test(m) || /^Path not found/i.test(m) || /^(550|553)\b.*(no such|not found|failed to open|does not exist)/i.test(m);
}

/** Overwrite / Skip existing / Cancel for an upload that would replace `names` in `dir` (null = cancel the whole upload). */
function overwriteDialog(names, dir) {
  const what = names.length === 1 ? t('"{name}" already exists in {dir}.', { name: names[0], dir }) : tn('{n} item already exists in {dir}.', '{n} items already exist in {dir}.', names.length, { dir });
  const m = showModal({
    title: t('Overwrite?'),
    width: 'narrow',
    body: h('div', {}, what, h('div', { style: { marginTop: '6px', color: 'var(--fg-dim)' } }, t('Overwrite replaces the existing files; "Skip existing" uploads only the others.'))),
    buttons: [
      { label: t('Cancel'), value: null },
      { label: t('Skip existing'), value: 'skip' },
      { label: t('Overwrite'), primary: true, danger: true, value: 'overwrite' },
    ],
  });
  return m.promise;
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
    this.states = new Map(); // connId -> {path, entries, selected:Set, hidden, follow, pane, off}
    this.wanted = new Set(); // connIds whose listing was asked for (show(), navigate()): a session with the SFTP browser off is listed only then
    this.connId = null;
    this.transfers = new Map();
    // the folder last shown for a session (by id) or a pane without one: a reconnected connection starts there again
    // when it still exists, instead of at the home folder
    this.lastPaths = new Map();
    this.lastPathsByPane = new WeakMap();
    this.els = {
      empty: $('#sftp-empty'), ui: $('#sftp-ui'), conn: $('#sftp-conn'), path: $('#sftp-path'), pathForm: $('#sftp-path-form'),
      follow: $('#sftp-follow'), hidden: $('#sftp-hidden'), filter: $('#sftp-filter'), list: $('#sftp-list'), transfers: $('#sftp-transfers'),
    };
    // the filter box above the list (like the one over the sessions): names containing the text, per connection;
    // Enter / ↓ move to the first match, Esc clears and goes back to the terminal
    this.els.filter.addEventListener('input', () => {
      const st = this.state();
      if (!st) return;
      st.filter = this.els.filter.value;
      this.renderList();
    });
    this.els.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        const first = this.visibleEntries()[0]; // the first match (its row is always among the first drawn)
        if (first) { e.preventDefault(); this.select(first); }
      } else if (e.key === 'Escape') {
        const st = this.state();
        this.els.filter.value = '';
        if (st) { st.filter = ''; this.renderList(); }
        this.els.filter.blur();
        this.app.activePane()?.focus();
      }
    });
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
        // an entry that is no longer displayed must never stay selected (Enter / Delete would act on it unseen)
        const shown = new Set(this.visibleEntries(st).map((e) => e.name));
        for (const n of [...st.selected]) if (!shown.has(n)) st.selected.delete(n);
        if (st.lastSel && !shown.has(st.lastSel)) st.lastSel = null;
        this.renderList();
      }
    });
    const list = this.els.list;
    // the rows carry no listeners of their own (20 000 of them would): click, double-click and the context menu are
    // read off the list and resolved to the row under the pointer
    const rowOf = (e) => e.target.closest('.sftp-row[data-name]');
    const entryOf = (row) => { const st = this.state(); return st && row.dataset.name !== '..' ? st.entries.find((x) => x.name === row.dataset.name) || null : null; };
    list.addEventListener('contextmenu', (e) => {
      const row = rowOf(e), entry = row && entryOf(row);
      if (entry) {
        e.preventDefault();
        if (!this.state().selected.has(entry.name)) this.select(entry, e);
        this.menu(e.clientX, e.clientY, entry);
      } else if (e.target === list || e.target.classList.contains('sftp-msg')) {
        e.preventDefault();
        this.menu(e.clientX, e.clientY, null);
      }
    });
    list.addEventListener('dblclick', (e) => {
      const row = rowOf(e);
      if (!row) return;
      if (row.dataset.name === '..') return this.cmd('up');
      const entry = entryOf(row);
      if (entry) this.open(entry);
    });
    // keyboard: the rows are options of a multi-select listbox with one Tab stop (roving tabindex), see onKey()
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-label', t('Files'));
    list.addEventListener('keydown', (e) => this.onKey(e));
    list.addEventListener('focusin', (e) => {
      const r = e.target.closest('.sftp-row[data-name]');
      if (r && r.dataset.name !== '..') this._rove(r);
    });
    this._typeAhead = typeAhead(); // letters typed on a row jump to the next entry whose name starts with them
    list.addEventListener('click', (e) => {
      const row = rowOf(e), entry = row && entryOf(row);
      if (entry) this.select(entry, e);
      else if (e.target === list) this.clearSelection();
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
    onChange(() => this.relabel()); // a language switch: what the panel keeps on screen is rendered again
  }

  /** Everything rendered with labels that stays on screen, in the current language (the list names, sizes and dates are values). */
  relabel() {
    this.els.list.setAttribute('aria-label', t('Files'));
    const st = this.state();
    if (st) {
      this.renderConn(st);
      if (st.path !== null) this.renderList();
      else if (st.loading) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, t('Loading…')));
      else if (st.error) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, errMsg(st.error)));
      else if (st.off) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, t('SFTP browser is off for this session — Refresh lists its files anyway')));
    }
    this.renderMoshHint(this.pane);
    this.renderTransfers();
  }

  state() {
    return this.connId ? this.states.get(this.connId) : null;
  }

  /** Called by the app whenever the active pane changes. */
  setPane(pane) {
    this.pane = pane;
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
    this.renderConn(st);
    this.els.follow.checked = st.follow;
    const noTerminal = st.pane.kind === 'ftp';
    this.els.follow.closest('label').hidden = noTerminal || st.pane.kind === 'mosh'; // FTP has no terminal to follow; Mosh reports no folder
    const cdBtn = document.querySelector('[data-sftp="terminal-cd"]');
    if (cdBtn) cdBtn.hidden = noTerminal; // nothing to cd in
    this.els.hidden.checked = st.hidden;
    this.els.filter.value = st.filter || '';
    if (st.path === null && !st.loading) {
      // a session whose "Open SFTP browser automatically" is off is not listed until asked for (Open SFTP Browser in
      // the pane menu, Refresh): a server without the sftp subsystem would otherwise report an error on every pane switch
      if (st.pane.kind !== 'ftp' && st.pane.session?.sftpAuto === false && !this.wanted.has(connId)) { // an FTP pane is nothing but this list
        st.off = true; // the note is drawn again on a language switch (relabel)
        this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, t('SFTP browser is off for this session — Refresh lists its files anyway')));
      } else {
        // the folder this pane showed before a reconnect comes back first (the fresh shell starts at home and would
        // otherwise pull the panel there); a new pane follows the shell's folder when it is known, else the session's
        const remembered = this.lastPathsByPane.get(st.pane) || (st.pane.remoteCwd ? null : this.remembered(st.pane));
        if (remembered) { st.lastCwd = st.pane.remoteCwd || null; st.skipFirstCwd = !st.pane.remoteCwd; } // the shell's starting folder is not a cd (onPaneCwd)
        this.navigate(remembered || st.pane.remoteCwd || '.', { remembered: !!remembered });
      }
    } else this.renderList();
  }

  /** The folder this pane (its session) showed last, if any. */
  remembered(pane) {
    return (pane.session?.id && this.lastPaths.get(pane.session.id)) || this.lastPathsByPane.get(pane) || null;
  }

  _remember(pane, path) {
    if (pane.session?.id) this.lastPaths.set(pane.session.id, path);
    this.lastPathsByPane.set(pane, path);
  }

  /** The connection line above the toolbar: session name, the "via SSH" badge of a Mosh companion, user@host[:port]. */
  renderConn(st) {
    const s = st.pane.session || {};
    const defPort = s.type === 'ftp' ? 21 : 22;
    // the "via SSH" marker of a Mosh companion sits before the host as a badge, so a long host name is
    // what gets truncated, never the marker
    this.els.conn.replaceChildren(...[h('b', {}, s.name || st.pane.title), ' ',
      s.type === 'mosh' ? h('span', { class: 'sftp-via', title: t('Files are browsed over a separate SSH connection to this host') }, t('via SSH')) : null,
      `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== defPort ? ':' + s.port : ''}`].filter(Boolean));
  }

  show(connId) {
    this.wanted.add(connId); // asked for: listed even when the session's SFTP browser is off
    this.app.showPanel('sftp');
    const pane = this.app.paneByConn(connId);
    if (pane) this.setPane(pane);
  }

  dropConnection(connId) {
    this.states.delete(connId);
    this.wanted.delete(connId);
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
      h('p', {}, t('Mosh session "{name}": files are browsed over a separate SSH connection to {where}.', { name: s.name || where, where })),
      h('button', { class: 'btn small', disabled: connecting, onclick: () => pane.openSftpCompanion() }, connecting ? t('Connecting via SSH…') : t('Open SFTP for this host (via SSH)')),
      pane.sftpStatus === 'failed' && pane.sftpError ? h('div', { class: 'sftp-mosh-err' }, pane.sftpError) : null
    );
    this.els.empty.append(this.moshEl);
  }

  onPaneCwd(pane) {
    const connId = connIdOf(pane);
    const st = connId && this.states.get(connId);
    if (!st || !pane.remoteCwd) return;
    // the shell reports its folder at every prompt: only a change is a cd to follow — a folder the user browsed to in
    // the panel is not pulled back by the next prompt, and the folder a (re)connected shell starts in is not a cd
    if (st.skipFirstCwd) { st.skipFirstCwd = false; st.lastCwd = pane.remoteCwd; return; }
    if (pane.remoteCwd === st.lastCwd) return;
    st.lastCwd = pane.remoteCwd;
    if (!st.follow || pane.remoteCwd === st.path) return;
    if (this.connId === connId) this.navigate(pane.remoteCwd);
    else st.path = null; // reload on next show
  }

  /**
   * Show `path`. `remembered`: the folder a reconnected session showed last — when it is gone the home folder is shown
   * without a word. `walkUp`: a step of the climb below. A folder that no longer exists under the panel (a refresh,
   * a listing after an operation) is announced once — a toast and a line in the list — and the panel climbs to the
   * nearest parent that still exists instead of keeping stale rows and repeating "Path not found".
   */
  async navigate(path, { remembered = false, walkUp = false } = {}) {
    const connId = this.connId;
    const st = this.state();
    if (!st || !connId) return;
    st.loading = true;
    st.error = null;
    st.off = false;
    this.wanted.add(connId);
    const seq = st.navSeq = (st.navSeq || 0) + 1; // a listing still in flight when a newer one starts is dropped when it lands (the last request wins, not the last answer)
    if (st.path === null) this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, t('Loading…')));
    try {
      if (path === '~' || (path || '').startsWith('~/')) path = (await window.api.sftp.home(connId)) + path.slice(1);
      const r = await window.api.sftp.list(connId, path || '.');
      if (this.connId !== connId || st.navSeq !== seq) return;
      const from = st.path;
      // keyboard cursor: stays put on a refresh, lands on the folder just left when going up, else on the first entry
      if (from !== r.path) st.lastSel = from && parentPath(from) === r.path ? from.replace(/\/$/, '').split('/').pop() : null;
      st.path = r.path;
      st.entries = r.entries;
      st.selected.clear();
      if (!walkUp) st.notice = null; // the "no longer exists" line stays over the parent it led to, until the next folder
      if (from !== r.path && st.filter) { st.filter = ''; this.els.filter.value = ''; } // the filter was about the folder just left
      this.els.path.value = r.path;
      this.els.path.scrollLeft = this.els.path.scrollWidth; // long paths: keep the tail visible
      this.renderList();
      this.app.setStatusCwd(r.path);
      this._remember(st.pane, r.path);
    } catch (e) {
      if (this.connId !== connId || st.navSeq !== seq) return;
      st.loading = false;
      if (remembered && isNotFound(e)) return this.navigate('.'); // the remembered folder is gone: home, quietly
      const gone = isNotFound(e) && (walkUp || st.path === null || path === st.path) && path && path !== '/' && path !== '.' && !path.startsWith('~');
      if (gone) {
        if (!walkUp) {
          st.notice = t('"{path}" no longer exists', { path });
          toast(t('"{path}" no longer exists — showing the nearest folder that does', { path }), 'warn');
        }
        return this.navigate(parentPath(path), { walkUp: true });
      }
      // the first listing failing is the connection's problem (no sftp subsystem, a shell that talks): name the session
      if (st.path === null) toast(t('SFTP unavailable on {session}: {error}', { session: st.pane.session?.name || st.pane.title, error: errMsg(e) }), 'error');
      else toast(t('{path}: {error}', { path: path || '.', error: errMsg(e) }), 'error');
      if (st.path === null) {
        st.error = e; // the message stays on screen: relabel() explains it again after a language switch
        this.els.list.replaceChildren(h('div', { class: 'sftp-msg' }, errMsg(e)));
      } else {
        this.els.path.value = st.path; // revert to the folder that is actually shown
        this.renderList();
      }
    } finally {
      st.loading = false;
    }
  }

  /** Entries as shown: hidden files left out unless asked for, folders first, then the chosen sort. */
  visibleEntries(st = this.state()) {
    if (!st) return [];
    st.sort = st.sort || { key: 'name', dir: 1 };
    const byName = new Intl.Collator().compare; // localeCompare's order, without its per-call cost (20 000 entries sort in a few ms)
    const cmp = (a, b) => {
      if (a.type !== b.type) return a.type === 'd' ? -1 : 1; // folders first, whatever the sort key
      const k = st.sort.key;
      const d = k === 'size' ? a.size - b.size : k === 'mtime' ? a.mtime - b.mtime : byName(a.name, b.name);
      return (d || byName(a.name, b.name)) * st.sort.dir;
    };
    const q = (st.filter || '').trim().toLowerCase();
    return st.entries.filter((e) => (st.hidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))).sort(cmp);
  }

  /**
   * Draw the listing. The first screenful of rows is appended now, the rest in animation frames of a few milliseconds
   * each: 20 000 entries are 100 000 nodes — 770 ms in one go, which a sort click or a refresh must not cost. What
   * needs every row (a dialog looking for its row, ⌘A) calls rows() / rowFor(), which finish the fill first; the keyboard
   * resolves against the data (onKey) and its cursor moves to the row once that row is in (_focusName).
   */
  renderList() {
    const st = this.state();
    if (!st) return;
    const list = this.els.list;
    const hadFocus = list.contains(document.activeElement); // keep the keyboard in the list across a re-render
    const headFocus = document.activeElement?.closest('.sftp-head button')?.dataset.sort; // …or on the header cell that sorted
    this._stopFill();
    list.replaceChildren();
    const entries = this.visibleEntries(st);
    // sortable header cells are buttons: Tab reaches them, Enter / Space sort (a click re-renders, so a focused
    // cell is focused again below), aria-sort tells the state
    const headCell = (key, label, title, cls) => {
      const active = st.sort.key === key;
      return h('button', { type: 'button', class: cls + (active ? ' sorted' : ''), dataset: { sort: key }, title,
        'aria-sort': active ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none',
        onmousedown: (ev) => ev.preventDefault(), // a mouse click sorts without taking the keyboard from the terminal (like the toolbar)
        onclick: () => {
          st.sort = { key, dir: active ? -st.sort.dir : 1 };
          this.renderList();
        } }, label + (active ? (st.sort.dir > 0 ? ' ▲' : ' ▼') : ''));
    };
    list.append(h('div', { class: 'sftp-row sftp-head', role: 'presentation' }, h('span', {}), headCell('name', t('Name'), t('Sort by name'), 'name'), headCell('size', t('Size'), t('Sort by size'), 'size'), headCell('mtime', t('Modified'), t('Sort by modified'), 'date')));
    if (st.path !== '/') list.append(h('div', { class: 'sftp-row dir', dataset: { name: '..' }, role: 'option', tabindex: -1, 'aria-selected': 'false' }, h('span', {}, '📁'), h('span', { class: 'name' }, '..'), h('span', { class: 'size' }), h('span', { class: 'date' })));
    if (st.notice) list.append(h('div', { class: 'sftp-msg sftp-notice' }, st.notice)); // the folder that vanished under the panel (navigate)
    if (!entries.length) list.append(h('div', { class: 'sftp-msg' }, (st.filter || '').trim() ? t('No names contain "{text}"', { text: st.filter.trim() }) : t('Empty folder')));
    const makeRow = (e) => {
      const sel = st.selected.has(e.name);
      const row = ROW.cloneNode(true);
      row.className = 'sftp-row' + (e.type === 'd' ? ' dir' : '') + (e.link ? ' link' : '') + (e.name.startsWith('.') ? ' hidden-file' : '') + (sel ? ' selected' : '');
      row.dataset.name = e.name;
      // the tooltip: the full name first (the column clips long ones), then mode, owner and a link's target
      row.title = `${e.name}\n${e.modeStr} ${e.owner}:${e.group}${e.target ? ' → ' + e.target + (e.broken ? ' ' + t('(broken)') : '') : ''}`;
      if (sel) row.setAttribute('aria-selected', 'true');
      const c = row.children;
      c[0].textContent = e.type === 'd' ? '📁' : fileGlyph(e.name);
      c[1].textContent = e.name;
      c[2].textContent = e.type === 'd' ? '' : fmtSize(e.size);
      c[3].textContent = fmtDate(e.mtime);
      return row;
    };
    const first = Math.min(entries.length, Math.max(80, Math.ceil(list.clientHeight / 24) * 2)); // two screens: scrolling a little never shows a gap
    const frag = document.createDocumentFragment();
    for (let i = 0; i < first; i++) frag.append(makeRow(entries[i]));
    list.append(frag);
    if (first < entries.length) {
      let i = first;
      const step = (budgetMs) => {
        const t0 = performance.now();
        const f = document.createDocumentFragment();
        while (i < entries.length) {
          f.append(makeRow(entries[i++]));
          if ((i & 127) === 0 && performance.now() - t0 > budgetMs) break;
        }
        list.append(f);
        if (this._pendingFocus) { // the keyboard asked for a row this batch may have drawn
          const r = this._rowNow(this._pendingFocus);
          if (r) { this._pendingFocus = null; this.focusRow(r); }
        }
        if (i < entries.length) this._fillRaf = requestAnimationFrame(() => step(6));
        else {
          this._fill = null;
          this._syncRoving(document.activeElement === list); // the cursor row may have arrived with a late batch: the Tab stop (and the focus, while it still waits on the list) moves to it
        }
      };
      this._fill = { step };
      this._fillRaf = requestAnimationFrame(() => step(6));
    }
    this._syncRoving(hadFocus);
    if (headFocus) list.querySelector(`.sftp-head button[data-sort="${headFocus}"]`)?.focus({ preventScroll: true });
    // a dialog opened from a row that was just replaced (the built-in editor after ⌘S, a confirm while a transfer
    // landed…) hands the focus back to the row with the same name when it closes
    repointOpeners((o) => (o.classList?.contains('sftp-row') && o.dataset.name ? this.rowFor(o.dataset.name) : null));
  }

  /** A chunked fill still running (renderList) is dropped: the listing is being drawn again. */
  _stopFill() {
    this._pendingFocus = null;
    if (!this._fill) return;
    cancelAnimationFrame(this._fillRaf);
    this._fill = null;
  }

  /** The row of `name` as drawn so far (no fill completed for it). */
  _rowNow(name) {
    return name == null ? null : this.els.list.querySelector(`.sftp-row[data-name="${CSS.escape(name)}"]`);
  }

  /**
   * Focus the row of `name`: now when it is drawn, else — while a chunked fill is still on its way to it — as soon as
   * its batch lands (the fill checks after every batch), so End, PageDown and type-ahead on a 20 000-entry listing
   * never wait for the whole DOM.
   */
  _focusName(name) {
    const row = this._rowNow(name);
    if (row) {
      this._pendingFocus = null;
      this.focusRow(row);
    } else if (this._fill) this._pendingFocus = name;
  }

  /** Finish a chunked fill now, so every row is in the DOM for whoever asked. */
  _flushFill() {
    if (!this._fill) return;
    const f = this._fill;
    this._fill = null;
    cancelAnimationFrame(this._fillRaf);
    f.step(Infinity);
  }

  /** Rows the keyboard cursor moves over, in display order (".." is focusable but outside the sequence); a fill in progress is completed first. */
  rows() {
    this._flushFill();
    return this._rowsNow();
  }

  _rowsNow() {
    return [...this.els.list.querySelectorAll('.sftp-row[data-name]')].filter((r) => r.dataset.name !== '..');
  }

  rowFor(name) {
    if (name == null) return null;
    const sel = `.sftp-row[data-name="${CSS.escape(name)}"]`;
    let row = this.els.list.querySelector(sel);
    if (!row && this._fill) { // not drawn yet: the rest of the listing is, then
      this._flushFill();
      row = this.els.list.querySelector(sel);
    }
    return row;
  }

  /**
   * The keyboard cursor's row: the last selected entry while it is shown, else the first entry. Null while the last
   * selected entry's row is still to be drawn by a fill in progress (the list itself takes the Tab stop meanwhile).
   */
  cursorRow() {
    const st = this.state();
    if (!st) return null;
    const rows = this._rowsNow();
    if (st.lastSel != null) {
      const row = rows.find((r) => r.dataset.name === st.lastSel);
      if (row) return row;
      if (this._fill && st.entries.some((e) => e.name === st.lastSel)) return null;
    }
    return rows[0] || null;
  }

  /** Roving tabindex: `row` is the list's single Tab stop; the list itself is one only while it has no rows. */
  _rove(row) {
    for (const r of this.els.list.querySelectorAll('.sftp-row[data-name]')) r.tabIndex = r === row ? 0 : -1;
    this.els.list.tabIndex = row ? -1 : 0;
  }

  _syncRoving(focus) {
    const row = this.cursorRow();
    this._rove(row);
    if (focus) (row || this.els.list).focus({ preventScroll: true });
  }

  /** Move the keyboard cursor (DOM focus and the Tab stop) to `row`, keeping it clear of the sticky header. */
  focusRow(row) {
    if (!row) return;
    this._rove(row);
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
    const head = this.els.list.querySelector('.sftp-head');
    const hb = head ? head.getBoundingClientRect().bottom : 0, rt = row.getBoundingClientRect().top;
    if (rt < hb) this.els.list.scrollTop -= hb - rt;
  }

  select(e, ev) {
    const st = this.state();
    if (!st) return;
    if (ev && (ev.metaKey || ev.ctrlKey)) {
      if (st.selected.has(e.name)) st.selected.delete(e.name);
      else st.selected.add(e.name);
    } else if (ev && ev.shiftKey && st.lastSel) {
      const names = this.visibleEntries(st).map((x) => x.name); // the data, in display order: a fill still drawing is not waited for
      const a = names.indexOf(st.lastSel), b = names.indexOf(e.name);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) st.selected.add(names[i]);
    } else {
      st.selected.clear();
      st.selected.add(e.name);
    }
    st.lastSel = e.name;
    this._paintSelection(st);
    this._focusName(e.name);
  }

  _paintSelection(st) {
    for (const r of this.els.list.querySelectorAll('.sftp-row[data-name]')) {
      const on = st.selected.has(r.dataset.name);
      r.classList.toggle('selected', on);
      r.setAttribute('aria-selected', String(on));
    }
  }

  clearSelection() {
    const st = this.state();
    if (!st) return;
    st.selected.clear();
    this._paintSelection(st);
  }

  selectedEntries() {
    const st = this.state();
    return st ? st.entries.filter((e) => st.selected.has(e.name)) : [];
  }

  /**
   * After a listing refresh, make the entry called `name` the cursor row and the selection (Finder: a new or renamed
   * item is what you act on next); the focus follows only while the keyboard is in the list — a toolbar button that
   * opened the dialog keeps it.
   */
  _cursorTo(name) {
    const st = this.state();
    const row = st && name !== '..' ? this.rowFor(name) : null;
    if (!row) return;
    st.lastSel = name;
    st.selected.clear();
    st.selected.add(name);
    this._paintSelection(st);
    this._rove(row);
    if (this.els.list.contains(document.activeElement)) this.focusRow(row);
  }

  join(name) {
    const st = this.state();
    return (st.path === '/' ? '' : st.path) + '/' + name;
  }

  /**
   * Keys on the list or a focused row: ↑/↓, Home/End, PgUp/PgDn move the cursor (⇧ extends the selection), Enter
   * opens the focused row (".." goes up; from the list itself the single selected entry; with several selected
   * nothing), ⌫ goes up, Delete / ⌘⌫ deletes the selection — or the focused row when nothing is selected —, Space
   * toggles the focused row's selection, ⌘A selects all, ⇧F10 / Menu key open the row's menu; letters (no modifier)
   * are Finder-style type-ahead over the shown names (a space inside the prefix included).
   */
  onKey(e) {
    const st = this.state();
    if (!st || e.target.matches('input, textarea, select')) return;
    const head = e.target.closest('.sftp-head button');
    if (head) { // a sort header cell: Enter / Space sort (one click: the prevented keydown cancels the button's own activation)
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); }
      return;
    }
    const sel = this.selectedEntries();
    // the names in display order come from the data, not the DOM: a 20 000-entry listing still being drawn in batches
    // answers End, PageDown and type-ahead at once, and the focus moves to the row once its batch is in (_focusName)
    const names = this.visibleEntries(st).map((x) => x.name);
    const focused = e.target.closest('.sftp-row[data-name]');
    const onUp = !!focused && focused.dataset.name === '..';
    const curName = this._pendingFocus || (focused && !onUp ? focused.dataset.name : null); // a focus still on its way counts as the cursor
    const i = curName ? names.indexOf(curName) : -1; // -1: the list itself has the focus, no cursor yet
    const cur = i >= 0 ? st.entries.find((x) => x.name === names[i]) : null; // the row with the focus ring
    const go = (j, extend) => { // cursor to row j (clamped); ⇧ extends the selection from the last selected entry
      const n = names[Math.max(0, Math.min(names.length - 1, j))];
      if (n !== undefined) this.select(st.entries.find((x) => x.name === n), extend ? e : null);
      e.preventDefault();
    };
    const page = () => { const r0 = this._rowsNow()[0]; return Math.max(1, Math.floor(this.els.list.clientHeight / ((r0 && r0.offsetHeight) || 24)) - 1); };
    if (e.key === 'Enter') {
      if (onUp) this.cmd('up');
      else if (cur && sel.length <= 1) this.open(cur);
      else if (!cur && sel.length === 1) this.open(sel[0]);
    } else if (e.key === 'Backspace' && !e.metaKey) this.cmd('up');
    else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
      e.preventDefault();
      if (sel.length) this.cmd('delete');
      else if (cur) this.remove([cur]);
    } else if (e.key === ' ') {
      e.preventDefault(); // never lets the list page-scroll
      if (this._typeAhead.active()) { // "my f…": the space belongs to the prefix being typed
        const j = this._typeAhead(e, names, i);
        if (j >= 0) go(j, false);
      } else if (cur) this.select(cur, { metaKey: true }); // toggles the focused row in the selection
    } else if (e.key === 'ArrowDown') go(i + 1, e.shiftKey);
    else if (e.key === 'ArrowUp') go(i < 0 ? names.length - 1 : i - 1, e.shiftKey);
    else if (e.key === 'Home') go(0, e.shiftKey);
    else if (e.key === 'End') go(names.length - 1, e.shiftKey);
    else if (e.key === 'PageDown') go(i < 0 ? 0 : i + page(), e.shiftKey); // from the list itself: the first row, like ↓
    else if (e.key === 'PageUp') go(i < 0 ? names.length - 1 : i - page(), e.shiftKey);
    else if (e.key === 'a' && e.metaKey) {
      this.visibleEntries(st).forEach((x) => st.selected.add(x.name));
      this.renderList();
      e.preventDefault();
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { // ⇧F10 / Menu key, like a right-click
      e.preventDefault();
      this.menuFromKeyboard(i >= 0 ? focused : null);
    } else {
      const j = this._typeAhead(e, names, i);
      if (j >= 0) go(j, false);
    }
  }

  /** Context menu of the focused row (selecting it first, like a right-click), else of the last selected entry, else the background menu. */
  menuFromKeyboard(row) {
    const st = this.state();
    let cur = row ? st.entries.find((x) => x.name === row.dataset.name) : null;
    if (cur && !st.selected.has(cur.name)) this.select(cur);
    const sel = this.selectedEntries();
    if (!cur) {
      cur = sel.find((x) => x.name === st.lastSel) || sel[0] || null;
      row = cur && this.rowFor(cur.name);
    }
    const r = (row || this.els.list).getBoundingClientRect();
    this.menu(document.documentElement.dir === 'rtl' ? r.right - 24 : r.left + 24, row ? r.bottom : r.top + 30, cur); // from the start edge
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
        return this.navigate(parentPath(st.path));
      }
      case 'home': return this.navigate('.');
      case 'refresh': return this.navigate(st.path);
      case 'mkdir': {
        const n = await promptDialog(t('New folder'), { placeholder: t('folder name') });
        if (!n || !n.trim()) return;
        try {
          await window.api.sftp.mkdir(this.connId, this.join(n.trim()));
          await this.navigate(st.path);
          this._cursorTo(n.trim()); // the new folder is what the user acts on next (open, rename…)
        } catch (err) {
          this._opFailed(err);
        }
        return;
      }
      case 'upload': return this.upload(null);
      case 'download': return sel.length ? this.download(sel) : toast(t('Select files to download'), 'warn');
      case 'delete': return sel.length ? this.remove(sel) : toast(t('Select files to delete'), 'warn');
      case 'terminal-cd': {
        if (st.pane && st.pane.kind !== 'ftp') {
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

  /**
   * An operation failed: say so, and when the failure says the path is not there, list the folder again — a folder
   * deleted under the panel is then announced and climbed out of (navigate), a vanished entry drops off the list —
   * instead of leaving the stale rows. `folder`: the folder the operation worked in, when it is not the one shown.
   */
  _opFailed(err, connId = this.connId, folder = null) {
    toast(errMsg(err), 'error');
    const st = this.state();
    if (st && this.connId === connId && st.path && (!folder || folder === st.path) && isNotFound(err)) this.navigate(st.path);
  }

  /** Upload with an overwrite check (used by the panel and by drops on a terminal). */
  async uploadTo(connId, paths, dir, entries) {
    if (!paths || !paths.length) {
      try {
        const ids = await window.api.sftp.upload(connId, [], dir); // native picker
        if (ids && ids.length) toast(tn('Uploading {n} item to {dir}', 'Uploading {n} items to {dir}', ids.length, { dir }), 'info');
      } catch (e) {
        this._opFailed(e, connId, dir);
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
        const choice = await overwriteDialog(conflicts.map(base), dir);
        if (!choice) return toast(t('Upload cancelled'), 'info');
        if (choice === 'skip') todo = paths.filter((p) => !names.has(base(p)));
        if (!todo.length) return toast(t('Nothing to upload: every item already exists'), 'info');
      }
      const ids = await window.api.sftp.upload(connId, todo, dir);
      if (ids && ids.length) toast(tn('Uploading {n} item to {dir}', 'Uploading {n} items to {dir}', ids.length, { dir }), 'info');
    } catch (e) {
      this._opFailed(e, connId, dir);
    }
  }

  async download(entries) {
    for (const e of entries) {
      try {
        await window.api.sftp.download(this.connId, this.join(e.name), null, e.type === 'd');
      } catch (err) {
        this._opFailed(err);
      }
    }
  }

  async remove(entries) {
    const dirs = entries.filter((e) => e.type === 'd').length;
    const name = entries[0].name, n = entries.length;
    const what = n === 1
      ? (dirs ? t('Delete folder "{name}" and everything inside it on the remote host? This cannot be undone.', { name }) : t('Delete "{name}" on the remote host? This cannot be undone.', { name }))
      : dirs ? tn('Delete {count} items (including {n} folder with its contents) on the remote host? This cannot be undone.', 'Delete {count} items (including {n} folders with their contents) on the remote host? This cannot be undone.', dirs, { count: n })
      : tn('Delete {n} item on the remote host? This cannot be undone.', 'Delete {n} items on the remote host? This cannot be undone.', n);
    const ok = await confirmDialog(what, { title: t('Delete'), okLabel: t('Delete'), danger: true });
    if (!ok) return;
    const st = this.state();
    // the keyboard cursor moves to the row after the deleted ones (else the one before them)
    const names = this.visibleEntries(st).map((x) => x.name), gone = new Set(entries.map((e) => e.name)); // display order, from the data
    const after = names.slice(names.findLastIndex((n) => gone.has(n)) + 1).find((n) => !gone.has(n));
    const before = names.slice(0, Math.max(0, names.findIndex((n) => gone.has(n)))).reverse().find((n) => !gone.has(n));
    for (const e of entries) {
      try {
        await window.api.sftp.remove(this.connId, this.join(e.name), e.type === 'd');
      } catch (err) {
        toast(t('{path}: {error}', { path: e.name, error: errMsg(err) }), 'error');
      }
    }
    if (gone.has(st.lastSel)) st.lastSel = after ?? before ?? null;
    this.navigate(st.path);
  }

  async rename(e) {
    const n = await promptDialog(t('Rename'), { value: e.name });
    if (!n || n === e.name) return;
    const connId = this.connId, st = this.state();
    if (!st || !connId) return;
    if (/\//.test(n)) return toast(t('A name cannot contain "/"'), 'warn');
    try {
      // never silently replace another entry (FTP servers overwrite on RNTO): check a fresh listing first
      const current = await window.api.sftp.list(connId, st.path).then((r) => r.entries, () => st.entries);
      const taken = current.find((x) => x.name === n);
      if (taken) {
        const q = taken.type === 'd' ? t('A folder named "{name}" already exists here. Replace it with "{from}"? The server may refuse this.', { name: n, from: e.name }) : t('A file named "{name}" already exists here. Replace it with "{from}"?', { name: n, from: e.name });
        const ok = await confirmDialog(q, { title: t('Replace?'), okLabel: t('Replace'), danger: true });
        if (!ok) return;
      }
      if (this.connId !== connId) return;
      await window.api.sftp.rename(connId, this.join(e.name), this.join(n));
      if (st.lastSel === e.name) st.lastSel = n; // the keyboard cursor follows the renamed entry
      await this.navigate(st.path);
      if (this.connId === connId && st.lastSel === n) this._cursorTo(n); // …and so does the selection
    } catch (err) {
      this._opFailed(err, connId);
    }
  }

  async chmod(e) {
    const cur = (e.mode & 0o777).toString(8).padStart(3, '0');
    const v = await promptDialog(t('Permissions for {name}', { name: e.name }), { label: t('Octal mode (current {mode}, {rwx})', { mode: cur, rwx: e.modeStr.slice(1) }), value: cur });
    if (!v || !/^[0-7]{3,4}$/.test(v)) return;
    try {
      if (!/^[0-7]{3,4}$/.test(v.trim())) return toast(t('Enter an octal mode such as 755 or 0644'), 'warn');
      await window.api.sftp.chmod(this.connId, this.join(e.name), parseInt(v.trim(), 8));
      this.navigate(this.state().path);
    } catch (err) {
      this._opFailed(err);
    }
  }

  async editBuiltin(e) {
    const connId = this.connId;
    const remote = this.join(e.name);
    let content;
    try {
      content = await window.api.sftp.read(connId, remote);
    } catch (err) {
      return this._opFailed(err, connId);
    }
    const ta = h('textarea', { class: 'editor-area', spellcheck: false, 'aria-label': t('Contents of {name}', { name: e.name }) });
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
        toast(t('Saved {name}', { name: e.name }), 'success');
        await this.navigate(this.state()?.path); // re-renders the list; renderList re-points this dialog's opener row
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
        { label: t('Open in External Editor'), action: async (api) => { api.close(); this.editExternal(e); } },
        { label: t('Close'), action: async (api) => { if (dirty && !(await confirmDialog(t('Discard unsaved changes?'), { okLabel: t('Discard'), danger: true }))) return; api.close(); } },
        { label: t('Save (⌘S)'), primary: true, action: () => save() },
      ],
    });
    m.el.querySelector('.modal-body').style.padding = '8px';
    setTimeout(() => ta.focus(), 20);
  }

  async editExternal(e) {
    try {
      const r = await window.api.sftp.edit(this.connId, this.join(e.name));
      toast(t('Opened {name} in editor; saves are uploaded automatically', { name: e.name }), 'info', 5000);
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
      const n = sel.length; // "Download (3)" / "Delete (3)" when several entries are selected
      items.push(
        e.type === 'd' ? { label: t('Open'), action: () => this.open(e) } : { label: t('Edit (built-in)'), action: () => this.editBuiltin(e) },
        e.type === 'f' ? { label: t('Edit in External Editor'), action: () => this.editExternal(e) } : null,
        { label: n > 1 ? t('Download ({n})', { n }) : t('Download'), action: () => this.download(sel.length ? sel : [e]) },
        '-',
        { label: t('Rename…'), action: () => this.rename(e) },
        { label: t('Permissions…'), action: () => this.chmod(e) },
        { label: t('Copy Path'), action: () => window.api.clipboard.write(this.join(e.name)) },
        e.type === 'd' && st.pane && st.pane.kind !== 'ftp' ? { label: t('cd Terminal Here'), action: () => { st.pane.write(`cd ${shellQuote(this.join(e.name))}\r`); st.pane.focus(); } } : null,
        '-',
        { label: n > 1 ? t('Delete ({n})', { n }) : t('Delete'), danger: true, action: () => this.remove(sel.length ? sel : [e]) },
        '-'
      );
    }
    items.push(
      { label: t('Upload Files Here…'), action: () => this.upload(null) },
      { label: t('New Folder…'), action: () => this.cmd('mkdir') },
      { label: t('Refresh'), action: () => this.cmd('refresh') },
      { label: st.hidden ? t('Hide Hidden Files') : t('Show Hidden Files'), action: () => { this.els.hidden.checked = !st.hidden; this.els.hidden.dispatchEvent(new Event('change')); } },
      { label: t('Copy Current Path'), action: () => window.api.clipboard.write(st.path) }
    );
    contextMenu(x, y, items);
  }

  // ---------- transfers ----------
  onTransfer(x) {
    const prev = this.transfers.get(x.id);
    if (x.status !== 'running' && !(prev && prev.finishedAt)) x.finishedAt = Date.now();
    else if (prev && prev.finishedAt) x.finishedAt = prev.finishedAt;
    this.transfers.set(x.id, x);
    if (x.status !== 'running') {
      // the end of a transfer is announced: a toast (the toast root is a polite live region; an error one an alert)
      // for failures and for Zmodem, whose only other trace is a line in the terminal; a visually hidden live region
      // for the rest, so a batch of panel uploads does not stack toasts
      const p = { name: x.name, size: x.total ? fmtSize(x.total) : '' };
      const what = x.kind === 'upload' ? (x.total ? t('{name} uploaded ({size})', p) : t('{name} uploaded', p)) : (x.total ? t('{name} downloaded ({size})', p) : t('{name} downloaded', p));
      if (x.status === 'done') {
        const st = this.states.get(x.connId);
        if (st && this.connId === x.connId && x.kind === 'upload') this.navigate(st.path);
        setTimeout(() => { this.transfers.delete(x.id); this.renderTransfers(); }, 30000);
        if (x.proto === 'zmodem') toast(t('Zmodem: {what}', { what }), 'info');
        else this._announce(what);
      } else if (x.status === 'error') toast(x.kind === 'upload' ? t('upload {name}: {error}', { name: x.name, error: x.error }) : t('download {name}: {error}', { name: x.name, error: x.error }), 'error', 6000);
      else this._announce(x.kind === 'upload' ? t('upload of {name} {status}', { name: x.name, status: x.status }) : t('download of {name} {status}', { name: x.name, status: x.status }));
    }
    this.renderTransfers();
    this.app.setStatusTransfers([...this.transfers.values()].filter((v) => v.status === 'running').length);
  }

  /** One sentence per finished transfer for screen readers (styles.css .xfer-live); the list itself re-renders on every progress tick, so it cannot be the live region. */
  _announce(text) {
    if (!this.live) {
      this.live = h('div', { class: 'xfer-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
      this.els.transfers.insertAdjacentElement('afterend', this.live);
    }
    this.live.textContent = text;
  }

  renderTransfers() {
    const el = this.els.transfers;
    el.replaceChildren();
    const list = [...this.transfers.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
    for (const x of list) {
      const pct = x.total ? Math.min(100, Math.round((x.transferred / x.total) * 100)) : x.status === 'done' ? 100 : 0;
      const elapsed = (x.finishedAt || Date.now()) - x.startedAt;
      const speed = elapsed > 300 ? t('{size}/s', { size: fmtSize(((x.transferred - (x.resumedFrom || 0)) / elapsed) * 1000) }) : ''; // the bytes of this run, not of the .part resumed
      const sizes = { sent: fmtSize(x.transferred), size: fmtSize(x.total), done: x.filesDone, total: x.filesTotal };
      let progress = x.filesTotal > 1 ? t('{sent} / {size} · {done}/{total} files', sizes) : t('{sent} / {size}', sizes);
      if (x.resumedFrom) progress = t('resuming at {size}', { size: fmtSize(x.resumedFrom) }) + ' · ' + progress; // a .part continued
      // a cancelled transfer says why when a Disconnect ended it (main marks those; a plain cancel carries no reason, or
      // "cancelled" itself from the FTP manager); an error shows its message
      const status = x.status === 'done' ? t('done') : x.status === 'error' ? x.error : x.status === 'cancelled' && x.error && x.error !== 'cancelled' ? t('cancelled ({why})', { why: x.error }) : x.status;
      el.append(h('div', { class: 'xfer ' + x.status },
        h('div', { class: 'l1' }, h('span', { class: 'xfer-kind' }, icon(x.kind === 'upload' ? 'upload' : 'download')), h('span', { class: 'n', title: x.remote }, x.name),
          x.proto === 'zmodem' ? h('span', { class: 'xfer-proto', title: t('Zmodem transfer in the terminal (rz / sz)') }, 'zmodem') : null, // from a terminal, not the Sftp panel
          x.status === 'running' ? h('button', { title: t('Cancel'), 'aria-label': t('Cancel transfer'), onclick: () => window.api.sftp.cancel(x.id) }, icon('x')) : null,
          x.status === 'done' && x.kind === 'download' ? h('button', { title: t('Show in Finder'), onclick: () => window.api.shell.showItem(x.local) }, icon('folder')) : null),
        h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })),
        h('div', { class: 'l2' }, h('span', {}, x.status === 'running' ? progress : status), h('span', {}, x.status === 'running' ? speed : fmtDuration(elapsed)))
      ));
    }
  }
}

/** The row every entry is cloned from (renderList): cloning beats building five elements through h() 20 000 times over. */
const ROW = h('div', { class: 'sftp-row', role: 'option', tabindex: -1, 'aria-selected': 'false' }, h('span'), h('span', { class: 'name' }), h('span', { class: 'size' }), h('span', { class: 'date' }));

function fileGlyph(name) {
  // U+FE0F forces colour-emoji presentation for the two glyphs that default to text style
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(name)) return '🖼️';
  if (/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name)) return '🗜️';
  if (/\.(sh|bash|zsh|py|js|ts|go|rs|rb|java|c|cpp|h)$/i.test(name)) return '📜';
  if (/\.(pdf|docx?|xlsx?|pptx?)$/i.test(name)) return '📑';
  return '📄';
}

export function shellQuote(p) {
  return /^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

function parentPath(p) {
  return p.replace(/\/[^/]+\/?$/, '') || '/';
}
