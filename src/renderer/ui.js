// Small DOM helpers, context menus, modals and toasts (no framework).
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

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export const TYPE_ICON = { ssh: '●', local: '●', telnet: '●', rdp: '●', vnc: '●', serial: '●' };
export const TYPE_LABEL = { ssh: 'SSH', mosh: 'Mosh', local: 'Local', telnet: 'Telnet', serial: 'Serial', ftp: 'FTP', rdp: 'RDP', vnc: 'VNC' };

// ---------- context menu ----------
let ctxOpen = null;
export function closeContextMenu() {
  if (ctxOpen) {
    ctxOpen.remove();
    ctxOpen = null;
  }
}
/** items: [{label, key, action, disabled, danger}] or '-' separators */
export function contextMenu(x, y, items) {
  closeContextMenu();
  const root = $('#ctx-root');
  const menu = h('div', { class: 'ctx' });
  for (const it of items) {
    if (it === '-') {
      menu.append(h('div', { class: 'ctx-sep' }));
      continue;
    }
    if (!it) continue;
    const row = h('div', { class: 'ctx-item' + (it.disabled ? ' disabled' : ''), onclick: () => { closeContextMenu(); it.action && it.action(); } }, it.label, it.key ? h('span', { class: 'k' }, it.key) : null);
    if (it.danger) row.style.color = '#ffb3ae';
    menu.append(row);
  }
  root.append(menu);
  ctxOpen = menu;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
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
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });

// ---------- modal ----------
const modalStack = [];
export function showModal({ title, body, buttons = [], width, onClose, closeOnBackdrop = true, beforeClose = null }) {
  const root = $('#modal-root');
  const modal = h('div', { class: 'modal' + (width ? ' ' + width : '') });
  const backdrop = h('div', { class: 'modal-backdrop' }, modal);
  const api = {
    el: modal,
    close(result) {
      if (!backdrop.isConnected) return;
      // a dismissal (Esc / ✕ / backdrop / Cancel) may ask for confirmation first
      if ((result === null || result === undefined) && beforeClose && !api._closing) {
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
      if (top) top.focusFirst();
      else document.dispatchEvent(new CustomEvent('modal-closed'));
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
    h('div', { class: 'modal-title' }, title, h('button', { class: 'close', onclick: () => api.close(null) }, '✕')),
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
  // Esc closes the top-most dialog even when focus has wandered outside it (e.g. after clicking a label).
  const onDocKey = (e) => {
    if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== api || modal.contains(e.target)) return;
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

export function confirmDialog(message, { title = 'Confirm', okLabel = 'OK', danger = false } = {}) {
  const m = showModal({
    title,
    width: 'narrow',
    body: h('div', {}, message),
    buttons: [
      { label: 'Cancel', value: false },
      { label: okLabel, primary: true, danger, value: true },
    ],
  });
  return m.promise.then((r) => !!r);
}

export function promptDialog(title, { label = '', value = '', password = false, checkbox = null, okLabel = 'OK', placeholder = '' } = {}) {
  const input = h('input', { type: password ? 'password' : 'text', value, placeholder, spellcheck: false, style: { width: '100%', height: '28px', padding: '0 8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' } });
  const cb = checkbox ? h('input', { type: 'checkbox', checked: !!checkbox.checked }) : null;
  const m = showModal({
    title,
    width: 'narrow',
    body: h('div', {}, label ? h('div', { style: { marginBottom: '6px', color: 'var(--fg-dim)' } }, label) : null, input, cb ? h('label', { style: { display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' } }, cb, checkbox.label) : null),
    buttons: [
      { label: 'Cancel', value: null },
      { label: okLabel, primary: true, action: (api) => api.close(checkbox ? { value: input.value, checked: cb.checked } : input.value) },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 10);
  return m.promise;
}

// ---------- toast ----------
export function toast(message, type = 'info', ms = 3500) {
  const root = $('#toast-root');
  // identical message already showing: restart its timer instead of stacking copies
  const dup = [...root.children].find((c) => c.textContent === message && c.classList.contains(type));
  if (dup) {
    clearTimeout(dup._timer);
    dup._timer = setTimeout(() => dup.remove(), ms);
    return dup;
  }
  const el = h('div', { class: 'toast ' + type }, message);
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
