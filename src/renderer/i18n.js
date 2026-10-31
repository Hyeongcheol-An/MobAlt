// Interface language in the renderer: the same t() / tn() as src/main/i18n.js (read its header for the rules), with
// the dictionary the preload fetched synchronously before this module ran (window.api.i18n.boot()), so that every
// module-level label is already in the saved language at the first paint.
//
//   import { t, tn } from './i18n.js';
//   h('button', {}, t('Connect'))                    t('Connected to {host}', { host })     tn('{n} tab', '{n} tabs', n)
//
// Static text in index.html carries data-i18n hooks instead: data-i18n (the element's own text nodes),
// data-i18n-title, data-i18n-placeholder, data-i18n-aria-label (that attribute). translateDom() applies them; the
// English in the file is the key, remembered the first time so a later language switch starts from the source again.
//
// A language switch at run time (Settings → General → Language, this window or another one): app.js calls
// setLocale(code, dict), which re-translates the static hooks and fires `i18n:changed` on the document. A component
// that keeps rendered labels (the session tree, the tab strip, the status bar, a panel) listens with onChange() and
// renders itself again; dialogs and menus are built when they open and need nothing.

const FALLBACK = { locale: 'en', system: 'en', dict: {}, languages: [{ code: 'en', name: 'English', guide: 'USER_GUIDE.md' }] };
const boot = (() => {
  try {
    const b = window.api && window.api.i18n && window.api.i18n.boot();
    return b && typeof b === 'object' && Array.isArray(b.languages) && b.languages.length ? b : FALLBACK;
  } catch { return FALLBACK; }
})();

/** The shipped languages: [{ code, name, guide }], English first. */
export const LANGUAGES = boot.languages;
/** The language the macOS language list resolves to (what 'system' means on this Mac). */
export const SYSTEM_LOCALE = boot.system || 'en';

let current = boot.locale || 'en';
let dict = boot.dict && typeof boot.dict === 'object' ? boot.dict : {};
/** 'rtl' for a right-to-left language (Arabic), else 'ltr' — <html dir> follows it, and so does the chrome's layout. */
export function direction(code = current) { const l = languageOf(code); return l && l.dir === 'rtl' ? 'rtl' : 'ltr'; }
try { document.documentElement.lang = current; document.documentElement.dir = direction(current); } catch {}

export function locale() { return current; }
export function languageOf(code) { return LANGUAGES.find((l) => l.code.toLowerCase() === String(code || '').toLowerCase()) || null; }
/** The code a Settings value ('system' or a language code) shows as, on this Mac. */
export function resolveSetting(setting) {
  const lang = languageOf(setting);
  return lang ? lang.code : SYSTEM_LOCALE;
}

/** "{name}" placeholders filled from params (an unknown name stays, so a typo is visible). */
// In a right-to-left interface a value put into a sentence (a path, a host, a file name, a session name) is isolated
// with FSI … PDI (U+2068 / U+2069): it takes its own direction from its first letter and never reorders the Arabic
// around it ("~/Downloads" keeps its "~/" at its left end). Numbers and left-to-right interfaces are left untouched.
export function format(str, params) {
  if (!params) return str;
  const iso = current && direction(current) === 'rtl';
  return String(str).replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in params)) return m;
    const v = params[k];
    return iso && typeof v === 'string' && v ? '\u2068' + v + '\u2069' : String(v);
  });
}

/** t('Source text', { placeholders }) → the translation, else the source. */
export function t(source, params) {
  const entry = dict[source];
  const str = typeof entry === 'string' && entry ? entry : Array.isArray(entry) && entry.length ? entry[entry.length - 1] : source;
  return format(str, params);
}

/** tn('{n} item', '{n} items', n, params) → the plural form for n ({n} is filled in). */
export function tn(one, other, n, params) {
  const entry = dict[one];
  let str;
  if (Array.isArray(entry) && entry.length) str = entry[n === 1 ? 0 : Math.min(1, entry.length - 1)];
  else if (typeof entry === 'string' && entry) str = entry;
  else str = n === 1 ? one : other;
  return format(str, { n, ...(params || {}) });
}

// ---------- static hooks in index.html ----------
const sources = new WeakMap(); // element → { text: [[node, lead, src, trail]], attrs: { title: src, … } }
const ATTRS = ['title', 'placeholder', 'aria-label'];
function remember(el) {
  let s = sources.get(el);
  if (s) return s;
  s = { text: [], attrs: {} };
  if (el.hasAttribute('data-i18n')) {
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.data);
      if (m && m[2]) s.text.push([node, m[1], m[2], m[3]]);
    }
  }
  for (const a of ATTRS) if (el.hasAttribute('data-i18n-' + a)) s.attrs[a] = el.getAttribute(a) || '';
  sources.set(el, s);
  return s;
}
/** Apply the current language to every data-i18n* hook under root (the whole document by default). */
export function translateDom(root = document) {
  const els = root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]');
  for (const el of els) {
    const s = remember(el);
    for (const [node, lead, src, trail] of s.text) node.data = lead + t(src) + trail;
    for (const [a, src] of Object.entries(s.attrs)) if (src) el.setAttribute(a, t(src));
  }
  return els.length;
}

/** Switch this window to a language: the dictionary comes from window.api.i18n.dict(code) (app.js does that). */
export function setLocale(code, newDict) {
  const lang = languageOf(code) || LANGUAGES[0];
  current = lang.code;
  dict = newDict && typeof newDict === 'object' ? newDict : {};
  try { document.documentElement.lang = current; document.documentElement.dir = direction(current); } catch {}
  translateDom(document);
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: current } }));
  return current;
}

// ---------- direction of free-text fields ----------
// A field the user types free text into (a session name, a folder, a host in the session editor, notes, startup
// commands) takes the direction of its first strong letter — "user@host" and "~/Downloads" left to right, an Arabic
// name right to left — like the title spans (styles.css unicode-bidi: plaintext). An input's text lives in its own
// inner box, where a CSS unicode-bidi does not reach, so the attribute does it: dir="auto" on every text field without
// a dir of its own, in index.html at boot and in every dialog / panel row built later. The technical fields that must
// always read left to right (quick connect, paths, hosts in the Tools panel, the find box, numbers, passwords) carry
// direction: ltr in styles.css, which wins over the attribute. Terminals keep theirs (xterm's helper textarea).
const FREE_TEXT = 'input[type=text]:not([dir]), input:not([type]):not([dir]), input[type=search]:not([dir]), textarea:not([dir])';
function autoDirection(root) {
  if (!root || root.nodeType !== 1) return;
  const els = root.matches(FREE_TEXT) ? [root] : root.querySelectorAll(FREE_TEXT);
  for (const el of els) if (!el.closest('.xterm')) el.dir = 'auto';
}
try {
  autoDirection(document.body);
  // only the chrome that builds fields later (dialogs, sidebar panels, the toolbar): never the terminals' busy DOM
  const watch = new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) autoDirection(n); });
  for (const id of ['modal-root', 'sidebar', 'toolbar']) { const el = document.getElementById(id); if (el) watch.observe(el, { childList: true, subtree: true }); }
} catch {}

/** Run fn after every language switch (components that keep rendered labels render again). Returns the unsubscribe. */
export function onChange(fn) {
  const handler = (e) => fn(e.detail && e.detail.locale);
  document.addEventListener('i18n:changed', handler);
  return () => document.removeEventListener('i18n:changed', handler);
}
