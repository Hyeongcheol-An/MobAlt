'use strict';
// Interface language: the lookup (src/main/i18n.js), the catalog of source strings (scripts/i18n-extract.js) and the
// dictionaries (src/locales/<code>.json) — each one has to cover the catalog with the same placeholders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const i18n = require('../../src/main/i18n');
// Every shipped language has its dictionary and guide: the checks that need all of them are strict (I18N_STRICT=0
// relaxes them while a new language is being written).
const strict = process.env.I18N_STRICT !== '0';
const extractor = require('../../scripts/i18n-extract');

test('resolveLocale: the setting wins, then the macOS language list, by tag and by language, else English', () => {
  delete process.env.MOBALT_LANG;
  assert.equal(i18n.resolveLocale('ko', ['en-US']), 'ko');
  assert.equal(i18n.resolveLocale('ZH-cn', []), 'zh-CN');
  assert.equal(i18n.resolveLocale('system', ['fr-FR', 'en-US']), 'fr');
  assert.equal(i18n.resolveLocale('system', ['zh-Hant-TW']), 'zh-CN'); // the only Chinese shipped
  assert.equal(i18n.resolveLocale('system', ['pt-BR']), 'pt');
  assert.equal(i18n.resolveLocale('system', ['nl-NL', 'ja-JP']), 'ja'); // the first language that is shipped
  assert.equal(i18n.resolveLocale('system', ['nl-NL']), 'en');
  assert.equal(i18n.resolveLocale(undefined, []), 'en');
  assert.equal(i18n.resolveLocale('klingon', ['de-DE']), 'de'); // an unknown setting falls back to the system list
  process.env.MOBALT_LANG = 'es';
  assert.equal(i18n.resolveLocale('ko', ['ja']), 'ko'); // pure: main.js feeds MOBALT_LANG in as the preferred list instead
  delete process.env.MOBALT_LANG;
});

test('LANGUAGES: the eleven shipped languages, English first, each with a guide in docs/; Arabic is right-to-left', () => {
  assert.deepEqual(i18n.LANGUAGES.map((l) => l.code), ['en', 'ko', 'zh-CN', 'ja', 'vi', 'hi', 'de', 'fr', 'es', 'pt', 'ar']);
  for (const l of i18n.LANGUAGES) {
    assert.ok(l.name && l.guide, l.code);
    if (strict || l.code === 'en' || l.code === 'ko') assert.ok(fs.existsSync(path.join(root, 'docs', l.guide)), `docs/${l.guide} exists (${l.name})`);
  }
  assert.equal(i18n.guideUrl('ko'), 'https://github.com/Hyeongcheol-An/MobAlt/blob/main/docs/USER_GUIDE.ko.md');
  assert.deepEqual(i18n.LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code), ['ar']);
});

test('t / tn: the source shows when nothing is translated; placeholders and plural forms', () => {
  i18n.setLocale('en');
  assert.equal(i18n.locale(), 'en');
  assert.equal(i18n.t('Close Tab'), 'Close Tab');
  assert.equal(i18n.t('Connected to {host}', { host: 'h1' }), 'Connected to h1');
  assert.equal(i18n.t('Keep {this}', { other: 1 }), 'Keep {this}'); // an unknown placeholder stays visible
  assert.equal(i18n.tn('{n} session', '{n} sessions', 1), '1 session');
  assert.equal(i18n.tn('{n} session', '{n} sessions', 0), '0 sessions');
  assert.equal(i18n.tn('{n} file in {dir}', '{n} files in {dir}', 2, { dir: '/x' }), '2 files in /x');
  assert.equal(i18n.format('{a}{b}', { a: 1, b: 2 }), '12');
});

test('t / tn with a dictionary: one string or [one, other], the source for anything missing', () => {
  const dict = { 'Close Tab': '탭 닫기', '{n} session': '세션 {n}개', '{n} tab': ['{n} onglet', '{n} onglets'], 'Empty': '', 'Save': 'Enregistrer' };
  i18n._use('xx', dict);
  assert.equal(i18n.t('Close Tab'), '탭 닫기');
  assert.equal(i18n.t('Save'), 'Enregistrer');
  assert.equal(i18n.t('Empty'), 'Empty'); // an empty translation is no translation
  assert.equal(i18n.t('Not there'), 'Not there');
  assert.equal(i18n.tn('{n} session', '{n} sessions', 3), '세션 3개');
  assert.equal(i18n.tn('{n} tab', '{n} tabs', 1), '1 onglet');
  assert.equal(i18n.tn('{n} tab', '{n} tabs', 5), '5 onglets');
  assert.equal(i18n.tn('{n} pane', '{n} panes', 2), '2 panes');
  i18n.setLocale('en');
});

test('loadDict: English is empty, an unknown code is empty, a shipped language reads its file', () => {
  assert.deepEqual(i18n.loadDict('en'), {});
  assert.deepEqual(i18n.loadDict('xx'), {});
  for (const l of i18n.LANGUAGES) if (fs.existsSync(path.join(root, 'src', 'locales', l.code + '.json'))) assert.equal(typeof i18n.loadDict(l.code), 'object');
});

// ---------- the catalog ----------
const catalog = extractor.extract(root);
const keys = Object.keys(catalog.strings);

test('extractor: every t() / tn() key is a literal the extractor can read', () => {
  assert.deepEqual(catalog.errors, []);
});

test('extractor: reads string literals, templates without ${}, ?: branches, i18n.t, tn pairs and HTML hooks', () => {
  const js = extractor.extractJs('x.js', [
    "t('One'); t(\"Two\"); t(`Three`); t(ok ? 'Four' : 'Five'); i18n.t('Six'); tn('{n} cat', '{n} cats', n);",
    "notT('Seven'); x.t('Eight'); t(name); tn('{n} dog', other, n);",
  ].join('\n'));
  assert.deepEqual(js.found.map((f) => f.key), ['One', 'Two', 'Three', 'Four', 'Five', 'Six', '{n} cat']);
  assert.equal(js.found[6].plural, '{n} cats');
  assert.equal(js.errors.length, 2, js.errors.join('\n'));
  const html = extractor.extractHtml('x.html', [
    '<button data-i18n title="Tip (⌘N)" data-i18n-title><span class="ico"></span>Session</button>',
    '<input placeholder="Filter sessions…" data-i18n-placeholder aria-label="Filter" data-i18n-aria-label />',
    '<div data-i18n>Two<br/>lines &amp; more</div><p>Not hooked</p>',
    '<label data-i18n><input type="checkbox" /> Follow terminal</label>',
  ].join('\n'));
  assert.deepEqual(html.found.map((f) => f.key), ['Tip (⌘N)', 'Session', 'Filter sessions…', 'Filter', 'Two', 'lines & more', 'Follow terminal']);
  assert.deepEqual(html.errors, []);
});

test('src/locales/catalog.json is up to date (npm run i18n)', () => {
  const onDisk = fs.existsSync(extractor.CATALOG) ? fs.readFileSync(extractor.CATALOG, 'utf8') : '';
  assert.equal(onDisk, extractor.render(catalog), 'the catalog on disk differs from the sources: run npm run i18n');
  assert.ok(keys.length > 0);
});

test('catalog: the strings the Language setting itself uses are there', () => {
  for (const k of ['Language', 'System default ({name})']) assert.ok(keys.includes(k), k);
});

// ---------- the dictionaries ----------
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const words = (s) => String(s).split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;

for (const lang of i18n.LANGUAGES) {
  if (lang.code === 'en') continue;
  const file = path.join(root, 'src', 'locales', lang.code + '.json');
  test(`src/locales/${lang.code}.json (${lang.name}) covers the catalog`, (ctx) => {
    if (!fs.existsSync(file)) return ctx.skip('not written yet'); // every language is required once the dictionaries land (see the test below)
    const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(typeof dict, 'object');
    const keep = new Set(Array.isArray(dict['@keep']) ? dict['@keep'] : []); // strings that stay as in English on purpose (names, acronyms)
    const problems = [];
    const entries = Object.keys(dict).filter((k) => !k.startsWith('@'));
    for (const k of entries) if (!catalog.strings[k]) problems.push(`stale key (not in the catalog any more): ${JSON.stringify(k)}`);
    for (const k of keys) {
      const v = dict[k];
      const spec = catalog.strings[k];
      if (v === undefined) { problems.push(`missing: ${JSON.stringify(k)}`); continue; }
      const forms = Array.isArray(v) ? v : [v];
      if (!forms.length || forms.some((f) => typeof f !== 'string' || !f.trim())) { problems.push(`empty: ${JSON.stringify(k)}`); continue; }
      if (Array.isArray(v) && !spec.plural) problems.push(`plural forms for a string without tn(): ${JSON.stringify(k)}`);
      if (Array.isArray(v) && v.length !== 2) problems.push(`plural forms must be [one, other]: ${JSON.stringify(k)}`);
      // every placeholder of the source must be there; a tn() pair whose English forms differ (the singular without
      // {n}, say) lets a translated form drop what only one English form has
      const one = placeholders(k), other = spec.plural ? placeholders(spec.plural) : one;
      const allowed = new Set([...one, ...other]), required = one.filter((x) => other.includes(x));
      for (const f of forms) {
        const got = placeholders(f);
        if (!required.every((x) => got.includes(x)) || !got.every((x) => allowed.has(x))) problems.push(`placeholders differ: ${JSON.stringify(k)} → ${JSON.stringify(f)} (want {${required.join('} {')}}${allowed.size > required.length ? ', may also use {' + [...allowed].filter((x) => !required.includes(x)).join('} {') + '}' : ''})`);
      }
      if (words(k) >= 3 && forms.every((f) => f === k) && !keep.has(k)) problems.push(`left in English: ${JSON.stringify(k)}`);
    }
    assert.deepEqual(problems, [], `${problems.length} problem(s):\n${problems.slice(0, 40).join('\n')}`);
  });
}

test('every shipped language has a dictionary', (ctx) => {
  const missing = i18n.LANGUAGES.filter((l) => l.code !== 'en' && !fs.existsSync(path.join(root, 'src', 'locales', l.code + '.json'))).map((l) => l.code);
  if (missing.length && !strict) return ctx.skip('dictionaries still being written: ' + missing.join(', '));
  assert.deepEqual(missing, [], 'languages without a dictionary');
});
