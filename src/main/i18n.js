'use strict';
// Interface language (Settings → General → Language). gettext style: the English source text is the key.
//
//   t('Close Tab')                                  → the dictionary entry for "Close Tab", or the English when there is none
//   t('Connected to {host}', { host })              → placeholders are {name}; a translation keeps the same names
//   tn('{n} session', '{n} sessions', n)            → the entry for the SINGULAR key: one string (languages without plural
//                                                     forms, e.g. Korean) or [one, other]; n fills {n}
//
// A dictionary is src/locales/<code>.json: { "Close Tab": "탭 닫기", "{n} session": ["…", "…"], … }. Keys starting
// with "@" are notes for translators, not strings. scripts/i18n-extract.js collects every t()/tn() source string and
// every data-i18n* text of index.html into src/locales/catalog.json; test/unit/i18n.test.js checks that each
// dictionary covers the catalog with matching placeholders. The renderer has the same t()/tn() in
// src/renderer/i18n.js and gets its dictionary from here through the preload (app:boot-i18n, i18n:dict).
//
// Rules for code: the key must be a literal ('…' or "…", never a template literal, never a concatenation), so the
// extractor can find it. Compose with placeholders, not with + : t('{n} files selected', { n }) rather than
// n + ' ' + t('files selected'). A string built at module load (a const table of labels) is frozen in the language
// of that moment; look it up at use time instead, or rebuild it on a change (renderer: the i18n:changed event).
const fs = require('fs');
const path = require('path');

/** The languages the interface ships in, in the order the Language list shows them. `guide` is the user guide in docs/; `dir` is 'rtl' for a right-to-left script (default ltr). */
const LANGUAGES = [
  { code: 'en', name: 'English', guide: 'USER_GUIDE.md' },
  { code: 'ko', name: '한국어', guide: 'USER_GUIDE.ko.md' },
  { code: 'zh-CN', name: '简体中文', guide: 'USER_GUIDE.zh-CN.md' },
  { code: 'ja', name: '日本語', guide: 'USER_GUIDE.ja.md' },
  { code: 'vi', name: 'Tiếng Việt', guide: 'USER_GUIDE.vi.md' },
  { code: 'hi', name: 'हिन्दी', guide: 'USER_GUIDE.hi.md' },
  { code: 'de', name: 'Deutsch', guide: 'USER_GUIDE.de.md' },
  { code: 'fr', name: 'Français', guide: 'USER_GUIDE.fr.md' },
  { code: 'es', name: 'Español', guide: 'USER_GUIDE.es.md' },
  { code: 'pt', name: 'Português', guide: 'USER_GUIDE.pt.md' },
  { code: 'ar', name: 'العربية', guide: 'USER_GUIDE.ar.md', dir: 'rtl' }, // right-to-left: the renderer mirrors the chrome (src/renderer/i18n.js, styles.css)
];
const GUIDE_BASE = 'https://github.com/Hyeongcheol-An/MobAlt/blob/main/docs/';
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

const byCode = (code) => LANGUAGES.find((l) => l.code.toLowerCase() === String(code || '').toLowerCase()) || null;

/**
 * The language to show. `setting` is Settings → Language: a code from LANGUAGES, or 'system' (the default) to follow
 * the macOS language list (`preferred`, app.getPreferredSystemLanguages(): 'ko-KR', 'zh-Hans-CN', 'pt-BR', …). The
 * first preferred language that matches a shipped one wins, by full tag, then by language subtag (zh-Hant-TW → zh-CN,
 * pt-PT → pt); nothing matching → English. Pure: main.js feeds MOBALT_LANG (tests, screenshots) in as the preferred
 * list, so 'system' means that language and an explicit choice in Settings still wins at run time.
 */
function resolveLocale(setting, preferred = []) {
  const wanted = byCode(setting);
  if (wanted) return wanted.code;
  for (const tag of Array.isArray(preferred) ? preferred : []) {
    const exact = byCode(tag);
    if (exact) return exact.code;
    const lang = String(tag || '').split(/[-_]/)[0].toLowerCase();
    if (!lang) continue;
    const base = LANGUAGES.find((l) => l.code.split('-')[0].toLowerCase() === lang);
    if (base) return base.code;
  }
  return 'en';
}

const cache = new Map();
/** The dictionary of a language ({} for English or when the file is missing or broken; the English source then shows). */
function loadDict(code) {
  const lang = byCode(code);
  if (!lang || lang.code === 'en') return {};
  if (cache.has(lang.code)) return cache.get(lang.code);
  let dict = {};
  const file = path.join(LOCALES_DIR, lang.code + '.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') dict = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[i18n] ${lang.code}.json: ${e.message}`); // a missing dictionary shows English, quietly
  }
  cache.set(lang.code, dict);
  return dict;
}

/** "{name}" placeholders filled from params (an unknown name stays as it is, so a typo is visible, not an empty hole). */
function format(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

let current = 'en';
let dict = {};

/** Switch the main process to a language (the renderer is switched by app.js through setLocale there). */
function setLocale(code) {
  const lang = byCode(code) || LANGUAGES[0];
  current = lang.code;
  dict = loadDict(lang.code);
  return current;
}
function locale() { return current; }
function language() { return byCode(current) || LANGUAGES[0]; }
/** Tests: use this dictionary under this code without a file. */
function _use(code, d) { current = String(code); dict = d && typeof d === 'object' ? d : {}; }

/** t('Source text', { placeholders }) → the translation, else the source. */
function t(source, params) {
  const entry = dict[source];
  const str = typeof entry === 'string' && entry ? entry : Array.isArray(entry) && entry.length ? entry[entry.length - 1] : source;
  return format(str, params);
}

/** tn('{n} item', '{n} items', n, params) → the plural form for n ({n} is filled in). */
function tn(one, other, n, params) {
  const entry = dict[one];
  let str;
  if (Array.isArray(entry) && entry.length) str = entry[n === 1 ? 0 : Math.min(1, entry.length - 1)];
  else if (typeof entry === 'string' && entry) str = entry;
  else str = n === 1 ? one : other;
  return format(str, { n, ...(params || {}) });
}

/** The user guide in the current language (GitHub). */
function guideUrl(code = current) {
  return GUIDE_BASE + (byCode(code) || LANGUAGES[0]).guide;
}

module.exports = { LANGUAGES, resolveLocale, loadDict, setLocale, locale, language, t, tn, format, guideUrl, byCode, _use };
