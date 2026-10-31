// Small DOM helpers, context menus, modals and toasts (no framework).
import { t, tn, locale } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') {
      try { el[k] = v; } catch { el.setAttribute(k, v); }
    } else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * Finder-style type-ahead for a list of names. Printable keys typed within `ms` of each other form a prefix and the
 * cursor moves to the next item whose name starts with it (case-insensitive, wrapping; a prefix that grows refines
 * the current match, the same letter typed again cycles through the items starting with it). Returns the index to
 * move to, or -1 when nothing matches or the key is not type-ahead at all (a modifier is held, a non-printable key,
 * IME composition) — the caller then treats the key as before. A space counts only inside a prefix being typed
 * ("my f…"); on its own it is never type-ahead. `fn.active()` tells whether a prefix is being typed right now, so a
 * caller can hand Space to the prefix instead of its own Space binding.
 */
export function typeAhead(ms = 700) {
  let prefix = '', at = 0;
  const active = () => prefix !== '' && Date.now() - at <= ms;
  const fn = (e, names, cur) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.key.length !== 1 || (e.key === ' ' && !active())) return -1;
    const now = Date.now();
    if (now - at > ms) prefix = '';
    at = now;
    prefix += e.key.toLowerCase();
    const n = names.length;
    if (!n) return -1;
    const same = prefix.length > 1 && [...prefix].every((c) => c === prefix[0]);
    const q = same ? prefix[0] : prefix;
    const from = same || prefix.length === 1 ? cur + 1 : cur;
    for (let k = 0; k < n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (String(names[i]).toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };
  fn.active = active;
  return fn;
}

/** The message of an error thrown by an ipcMain.handle handler, without Electron's "Error invoking remote method" wrapper. */
export const ipcMessage = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtSize(n) {
  if (n === undefined || n === null) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

/**
 * A file date for a listing, in the interface language's order (10/31, 14:05 · 31.10., 14:05 · 10. 31. 14:05):
 * month, day and time within this year, the full date (year first or last as the language has it) otherwise.
 */
export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const opts = d.getFullYear() === now.getFullYear()
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  try { return new Intl.DateTimeFormat(locale(), opts).format(d); } catch { return new Intl.DateTimeFormat('en', opts).format(d); }
}

export function fmtDuration(ms) {
  if (ms < 10000) return t('{s}s', { s: (Math.max(0, ms) / 1000).toFixed(1) }); // a quick transfer or cancel is not "0s"
  const s = Math.round(ms / 1000);
  if (s < 60) return t('{s}s', { s });
  const m = Math.floor(s / 60);
  return t('{m}m {s}s', { m, s: s % 60 });
}

/**
 * A translated sentence with elements in it: fillNodes(t('MobAlt {version} is installed'), { version: h('b', {}, v) })
 * → ['MobAlt ', <b>, ' is installed'], for replaceChildren / h(). A placeholder without a part stays as text.
 */
export function fillNodes(text, parts) {
  const out = [];
  const re = /\{(\w+)\}/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (!(m[1] in parts)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(parts[m[1]]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- monochrome UI icons (16px inline SVG, currentColor) ----------
// Toolbar, side strip and panel buttons share this set so the chrome never mixes emoji with text glyphs.
// Each entry is a path `d` (24×24 grid, stroked) or, when it starts with '<', raw inner SVG markup.
const gearTicks = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return `M${(12 + 6.2 * c).toFixed(2)} ${(12 + 6.2 * s).toFixed(2)}L${(12 + 9.6 * c).toFixed(2)} ${(12 + 9.6 * s).toFixed(2)}`;
}).join('');
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  tunnel: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  multiexec: 'M5 3v5a7 7 0 0 0 14 0V3M12 3v18',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  'split-down': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>',
  tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  settings: `<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2.2"/><path d="${gearTicks}"/>`,
  'chevron-left': 'm15 6-6 6 6 6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-up': 'm6 15 6-6 6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  refresh: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  'folder-plus': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  // pane zoom: corners pointing out (fill the tab) / corners pointing in (restore the split layout)
  zoom: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  unzoom: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  // pushpin: a pinned tab (head, shaft and the point)
  pin: 'M9 3h6M10 3v6l-3 3v1h10v-1l-3-3V3M12 13v8',
  monitor: 'M3 12h4l3-7 4 14 3-7h4', // the remote monitoring bar: a pulse line
};
/** An inline SVG icon element (class "i"); unknown names render an empty 16px box rather than throwing. */
export function icon(name) {
  const d = ICONS[name] || '';
  const t = document.createElement('template');
  t.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" data-name="${name}">${d.startsWith('<') ? d : `<path d="${d}"/>`}</svg>`;
  return t.content.firstElementChild;
}
/** Fill every `[data-icon]` element under root with its icon (static markup in index.html). */
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.replaceChildren(icon(el.dataset.icon));
}

export const TYPE_ICON = { ssh: '●', local: '●', telnet: '●', rdp: '●', vnc: '●', serial: '●' };
export const TYPE_LABEL = { ssh: 'SSH', mosh: 'Mosh', local: 'Local', telnet: 'Telnet', serial: 'Serial', ftp: 'FTP', rdp: 'RDP', vnc: 'VNC' };

// ---------- context menu ----------
let ctxOpen = null;
let ctxOpener = null; // element that had focus when the menu opened; focus goes back to it on close
export function closeContextMenu() {
  if (ctxOpen) {
    const menu = ctxOpen;
    ctxOpen = null;
    const a = document.activeElement;
    const inMenu = !a || a === document.body || menu.contains(a);
    menu.remove();
    const back = ctxOpener;
    ctxOpener = null;
    if (!inMenu) return; // focus already went somewhere else (e.g. into a dialog)
    if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else document.dispatchEvent(new CustomEvent('ctx-closed')); // app.js hands focus to the terminal
  }
}
/** items: [{label, key, action, disabled, danger}] or '-' separators */
export function contextMenu(x, y, items) {
  closeContextMenu();
  const root = $('#ctx-root');
  const menu = h('div', { class: 'ctx', role: 'menu', tabindex: -1 });
  for (const it of items) {
    if (it === '-') {
      menu.append(h('div', { class: 'ctx-sep', role: 'separator' }));
      continue;
    }
    if (!it) continue;
    const row = h('div', { class: 'ctx-item' + (it.disabled ? ' disabled' : ''), role: 'menuitem', tabindex: -1, 'aria-disabled': it.disabled ? 'true' : null, onclick: () => { closeContextMenu(); it.action && it.action(); } }, it.label, it.key ? h('span', { class: 'k' }, it.key) : null);
    if (it.danger) row.classList.add('danger'); // styles.css: red text, and the red fill with the selection text while hovered / focused
    menu.append(row);
  }
  root.append(menu);
  ctxOpen = menu;
  ctxOpener = document.activeElement;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px'; // a menu taller than the window keeps its first items reachable
  // keyboard: ↑/↓ cycle through enabled items, Home/End, Enter/Space activate, Esc (global) / Tab close
  const enabled = () => [...menu.querySelectorAll('.ctx-item:not(.disabled)')];
  menu.addEventListener('keydown', (e) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); if (list.length) list[((n % list.length) + list.length) % list.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) list[i].click(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeContextMenu(); }
  });
  enabled()[0]?.focus({ preventScroll: true });
  setTimeout(() => {
    const off = (e) => {
      if (!menu.contains(e.target)) {
        closeContextMenu();
        document.removeEventListener('mousedown', off, true);
      }
    };
    document.addEventListener('mousedown', off, true);
  }, 0);
  return menu;
}
window.addEventListener('blur', closeContextMenu);
// Esc closes an open menu and nothing else (a dialog underneath stays open).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ctxOpen) return;
  e.stopPropagation();
  e.preventDefault();
  closeContextMenu();
}, true);

// ---------- modal ----------
const modalStack = [];
let modalSeq = 0; // dialogs shown so far: callers can tell whether an action opened (and closed) one
export function modalsShown() {
  return modalSeq;
}
/**
 * Hand focus back to the element that opened a dialog or menu, if it is still there (and visible, enabled);
 * otherwise run `fallback`. A terminal opener is left to the fallback too: the app decides which pane is active.
 */
export function focusBack(el, fallback) {
  const ok = el && el.isConnected && el !== document.body && !el.hidden && !el.disabled && el.offsetParent !== null && !el.closest('.xterm');
  if (ok) el.focus({ preventScroll: true });
  else fallback && fallback();
}
export function showModal({ title, body, buttons = [], width, onClose, closeOnBackdrop = true, beforeClose = null }) {
  const root = $('#modal-root');
  const modal = h('div', { class: 'modal' + (width ? ' ' + width : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : null });
  const backdrop = h('div', { class: 'modal-backdrop' }, modal);
  const opener = document.activeElement; // where the keyboard was: a tab, a tree row, the button that opened this dialog…
  modalSeq++;
  const api = {
    el: modal,
    opener,
    close(result) {
      if (!backdrop.isConnected) return;
      // a dismissal (Esc / ✕ / backdrop / Cancel) may ask for confirmation first; a second one while that is
      // pending (Esc twice, Esc then ✕) is nothing more — it used to slip past the question and close
      if ((result === null || result === undefined) && beforeClose) {
        if (api._closing) return;
        api._closing = true;
        Promise.resolve(beforeClose()).then((ok) => { api._closing = false; if (ok) api.close(false); }, () => { api._closing = false; });
        return;
      }
      if (result === false) result = null;
      document.removeEventListener('keydown', onDocKey, true);
      backdrop.remove();
      modalStack.splice(modalStack.indexOf(api), 1);
      onClose && onClose(result);
      api.resolve && api.resolve(result);
      const top = modalStack[modalStack.length - 1];
      // focus goes back to what opened this dialog: a control of the parent dialog (sub-dialogs), a tab, a tree
      // row, a toolbar/panel button…; the parent's first control / the terminal only when that is gone
      // (api.opener, not the captured element: a list that re-rendered while the dialog was open re-points it)
      if (top) focusBack(top.el.contains(api.opener) ? api.opener : null, () => top.focusFirst());
      else focusBack(api.opener, () => document.dispatchEvent(new CustomEvent('modal-closed'))); // app.js hands focus to the terminal
    },
    focusFirst() {
      // First visible form control in the body, then the primary button, then any button (never the ✕).
      const visible = (el) => el && !el.hidden && el.offsetParent !== null;
      const f = [...modal.querySelectorAll('.modal-body input:not([type=checkbox]):not([type=hidden]), .modal-body select, .modal-body textarea')].find(visible)
        || modal.querySelector('.modal-foot button.primary') || modal.querySelector('.modal-foot button') || modal.querySelector('button');
      if (f) f.focus();
    },
  };
  modal.append(
    // the title text is its own box so a very long session name is clipped with an ellipsis (full text in the tooltip)
    h('div', { class: 'modal-title' }, h('span', { class: 'modal-title-text', title: typeof title === 'string' ? title : null }, title), h('button', { class: 'close', 'aria-label': t('Close'), title: t('Close (Esc)'), onclick: () => api.close(null) }, icon('x'))),
    h('div', { class: 'modal-body' }, body)
  );
  if (buttons.length) {
    modal.append(
      h('div', { class: 'modal-foot' }, buttons.map((b) =>
        h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => (b.action ? b.action(api) : api.close(b.value)) }, b.label)
      ))
    );
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (closeOnBackdrop && e.target === backdrop) api.close(null);
  });
  // Tab / ⇧Tab cycle through this dialog's own controls only (hidden, disabled and tabindex=-1 ones skipped;
  // an unchecked radio yields to the checked one of its group, like the browser's own order).
  const focusables = () => [...modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) =>
    !el.disabled && !el.hidden && el.tabIndex >= 0 && el.type !== 'hidden' && el.offsetParent !== null
    && !(el.type === 'radio' && !el.checked && el.name && modal.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`)));
  const trapTab = (e) => {
    if (ctxOpen) return; // a context menu above the dialog owns the keyboard
    e.preventDefault();
    const list = focusables();
    if (!list.length) return;
    const a = document.activeElement;
    let i = list.indexOf(a), n = list.length;
    if (i < 0 && modal.contains(a)) {
      // focus is on a control outside the Tab order (a roving pick reached with the arrows): continue from its place
      const after = list.findIndex((el) => a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      i = e.shiftKey ? (after < 0 ? n : after) : (after < 0 ? n - 1 : after - 1);
    }
    (i < 0 ? (e.shiftKey ? list[n - 1] : list[0]) : list[(i + (e.shiftKey ? -1 : 1) + n) % n]).focus();
  };
  // Esc closes the top-most dialog even when focus has wandered outside it (e.g. after clicking a label);
  // Tab is trapped inside it for the same reason.
  const onDocKey = (e) => {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (e.key === 'Tab') return trapTab(e);
    if (e.key !== 'Escape' || modal.contains(e.target)) return;
    e.stopPropagation();
    api.close(null);
  };
  document.addEventListener('keydown', onDocKey, true);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close(null);
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement) && !e.isComposing) {
      const primary = buttons.find((b) => b.primary);
      if (primary && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        primary.action ? primary.action(api) : api.close(primary.value);
      }
    }
  });
  root.append(backdrop);
  modalStack.push(api);
  api.promise = new Promise((resolve) => (api.resolve = resolve));
  setTimeout(() => api.focusFirst(), 0);
  return api;
}

export function anyModalOpen() {
  return modalStack.length > 0;
}

/**
 * A list that re-rendered while a dialog was open (the built-in editor saves and refreshes the listing, a transfer
 * finishes, a connection comes up…) calls this with a mapper from the stale opener row to its replacement; closing
 * the dialog then hands the focus to the new row instead of falling through to the terminal.
 */
export function repointOpeners(fn) {
  for (const m of modalStack) {
    const o = m.opener;
    if (!o || o.isConnected) continue;
    const n = fn(o);
    if (n) m.opener = n;
  }
}

export function confirmDialog(message, { title = t('Confirm'), okLabel = t('OK'), danger = false } = {}) {
  const m = showModal({
    title,
    width: 'narrow',
    body: h('div', {}, message),
    buttons: [
      { label: t('Cancel'), value: false },
      { label: okLabel, primary: true, danger, value: true },
    ],
  });
  return m.promise.then((r) => !!r);
}

let promptSeq = 0;
export function promptDialog(title, { label = '', value = '', password = false, checkbox = null, okLabel = t('OK'), placeholder = '' } = {}) {
  // the single box is named by the dialog's title ("Rename tab", "New folder"); the optional line above it describes it
  const labelEl = label ? h('div', { id: `prompt-label-${++promptSeq}`, style: { marginBottom: '6px', color: 'var(--fg-dim)' } }, label) : null;
  const input = h('input', { type: password ? 'password' : 'text', value, placeholder, spellcheck: false, 'aria-label': title, 'aria-describedby': labelEl ? labelEl.id : null, style: { width: '100%', height: '28px', padding: '0 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-input)' } });
  const cb = checkbox ? h('input', { type: 'checkbox', checked: !!checkbox.checked }) : null;
  const m = showModal({
    title,
    width: 'narrow',
    body: h('div', {}, labelEl, input, cb ? h('label', { style: { display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' } }, cb, checkbox.label) : null),
    buttons: [
      { label: t('Cancel'), value: null },
      { label: okLabel, primary: true, action: (api) => api.close(checkbox ? { value: input.value, checked: cb.checked } : input.value) },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 10);
  return m.promise;
}

/** "1 session" / "2 sessions" — English only: a label shown to the user uses tn('{n} session', '{n} sessions', n) instead. */
export function plural(n, word, words = word + 's') {
  return `${n} ${n === 1 ? word : words}`;
}

// ---------- toast ----------
/** A notice in the bottom-right stack; #toast-root is a polite live region (role=status), an error toast is an alert of its own. */
export function toast(message, type = 'info', ms = 3500) {
  const root = $('#toast-root');
  // identical message already showing: restart its timer instead of stacking copies
  const dup = [...root.children].find((c) => c.textContent === message && c.classList.contains(type));
  if (dup) {
    clearTimeout(dup._timer);
    dup._timer = setTimeout(() => dup.remove(), ms);
    return dup;
  }
  const el = h('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : null }, message);
  root.append(el);
  el._timer = setTimeout(() => el.remove(), ms);
  return el;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function parseQuickConnect(str) {
  const s = str.trim();
  if (!s) return null;
  let m = /^(?:(ssh|mosh|telnet|ftp|ftps|rdp|vnc):\/\/)?(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s@]+)(?::(\d+))?$/.exec(s);
  if (!m) return null;
  const scheme = m[1] || 'ssh';
  const type = scheme === 'ftps' ? 'ftp' : scheme;
  const host = m[3].replace(/^\[|\]$/g, '');
  const port = m[4] ? parseInt(m[4], 10) : { ssh: 22, mosh: 22, telnet: 23, ftp: 21, rdp: 3389, vnc: 5900 }[type];
  return { type, username: m[2] || '', host, port, ftps: scheme === 'ftps', name: `${m[2] ? m[2] + '@' : ''}${host}` };
}
