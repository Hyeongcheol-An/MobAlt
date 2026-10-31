#!/usr/bin/env node
'use strict';
// Collects every interface string into src/locales/catalog.json — the list each dictionary (src/locales/<code>.json)
// has to cover. Sources: t('…') / tn('…', '…', n) calls in src/renderer/*.js and src/main/*.js (the first argument
// must be a string literal, a template literal without ${}, or a ?: of those; anything else is reported) and the
// data-i18n* hooks of src/renderer/index.html (data-i18n: the element's own text nodes; data-i18n-title /
// -placeholder / -aria-label: that attribute).
//
//   npm run i18n            rewrite the catalog
//   npm run i18n -- --check  exit 1 when the catalog on disk is stale (test/unit/i18n.test.js does the same)
//
// The catalog maps each source string to where it is used and, for tn(), its plural form: translators read it,
// nobody edits it by hand.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'src', 'locales', 'catalog.json');
const JS_DIRS = ['src/renderer', 'src/main'];
const HTML_FILES = ['src/renderer/index.html'];
const SKIP = new Set(['src/renderer/i18n.js', 'src/main/i18n.js']); // the lookup itself calls t(variable)
const ATTRS = ['title', 'placeholder', 'aria-label'];

/** The literal value of a key expression, or null (with the reason) when it is not one the extractor can read. */
function literalOf(node) {
  if (!node) return { value: null, reason: 'missing' };
  if (node.type === 'Literal' && typeof node.value === 'string') return { value: node.value };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return { value: node.quasis.map((q) => q.value.cooked).join('') };
  if (node.type === 'ConditionalExpression') {
    const a = literalOf(node.consequent), b = literalOf(node.alternate);
    if (a.value !== null && b.value !== null) return { value: [a.value, b.value] };
    return { value: null, reason: a.reason || b.reason || 'non-literal branch' };
  }
  return { value: null, reason: node.type };
}
const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : [v]);

/** Walk every node of an acorn AST (plain recursion over object-valued properties). */
function walk(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn, node));
    else if (v && typeof v.type === 'string') walk(v, fn, node);
  }
}

/** t / tn calls of one JS file → [{ key, plural?, line }], plus the errors (a non-literal key). */
function extractJs(file, src) {
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (e) {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  }
  const found = [], errors = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const c = node.callee;
    const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' && c.object.type === 'Identifier' && /^(i18n|I18N)$/.test(c.object.name) ? c.property.name : null;
    if (name !== 't' && name !== 'tn') return;
    const line = node.loc.start.line;
    const first = literalOf(node.arguments[0]);
    if (first.value === null) { errors.push(`${file}:${line}: ${name}() key is not a string literal (${first.reason})`); return; }
    if (name === 't') {
      for (const key of flat(first.value)) found.push({ key, line });
      return;
    }
    const second = literalOf(node.arguments[1]);
    if (second.value === null) { errors.push(`${file}:${line}: tn() plural form is not a string literal (${second.reason})`); return; }
    const ones = flat(first.value), others = flat(second.value);
    if (ones.length !== others.length) { errors.push(`${file}:${line}: tn() singular and plural branches do not pair up`); return; }
    ones.forEach((key, i) => found.push({ key, plural: others[i], line }));
  });
  return { found, errors };
}

/** data-i18n* hooks of an HTML file → [{ key, line }] (a tiny tokenizer: our own file, no nesting of hooks needed). */
function extractHtml(file, src) {
  const found = [], errors = [];
  const tag = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const stack = []; // { name, i18n: bool }
  let last = 0, m;
  const text = (from, to) => {
    const top = stack[stack.length - 1];
    if (!top || !top.i18n) return;
    const raw = src.slice(from, to);
    const t = raw.trim();
    if (t) found.push({ key: t.replace(/\s+/g, ' '), line: lineOf(from) });
  };
  while ((m = tag.exec(src))) {
    text(last, m.index);
    last = tag.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const name = m[1].toLowerCase(), attrs = m[2] || '', selfClosing = !!m[3] || VOID.has(name);
    if (m[0].startsWith('</')) {
      while (stack.length && stack.pop().name !== name);
      continue;
    }
    const line = lineOf(m.index);
    const has = (a) => new RegExp(`(^|\\s)${a}(\\s|=|$)`).test(attrs);
    const valueOf = (a) => { const r = new RegExp(`(?:^|\\s)${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`).exec(attrs); return r ? (r[1] ?? r[2] ?? r[3]) : null; };
    for (const a of ATTRS) {
      if (!has('data-i18n-' + a)) continue;
      const v = valueOf(a);
      if (v) found.push({ key: v, line });
      else errors.push(`${file}:${line}: data-i18n-${a} without a ${a} attribute`);
    }
    if (!selfClosing) stack.push({ name, i18n: has('data-i18n') });
    else if (has('data-i18n')) errors.push(`${file}:${line}: data-i18n on a void element (<${name}>) has no text to translate`);
    if (name === 'script' || name === 'style') { // skip the raw content
      const close = src.indexOf(`</${name}`, last);
      if (close > 0) { tag.lastIndex = last = close; }
    }
  }
  text(last, src.length);
  const decoded = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { found: found.map((f) => ({ ...f, key: decoded(f.key) })), errors };
}

/** The whole catalog: { strings: { key: { refs: [...], plural? } }, errors: [...] }. */
function extract(root = ROOT) {
  const strings = new Map();
  const errors = [];
  // refs name the files only: with line numbers every edit anywhere would change the catalog (and every merge
  // would conflict on it); the sources are one grep away
  const add = (key, ref, plural) => {
    if (!strings.has(key)) strings.set(key, { refs: [] });
    const e = strings.get(key);
    const file = String(ref).replace(/:\d+$/, '');
    if (!e.refs.includes(file)) e.refs.push(file);
    if (plural) {
      if (e.plural && e.plural !== plural) errors.push(`${ref}: "${key}" has two plural forms ("${e.plural}", "${plural}")`);
      e.plural = plural;
    }
  };
  const files = [];
  for (const dir of JS_DIRS) for (const f of fs.readdirSync(path.join(root, dir)).sort()) if (f.endsWith('.js') && !SKIP.has(path.posix.join(dir, f))) files.push(path.posix.join(dir, f));
  for (const rel of files) {
    const r = extractJs(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
    errors.push(...r.errors);
    for (const f of r.found) add(f.key, `${rel}:${f.line}`, f.plural);
  }
  for (const rel of HTML_FILES) {
    const r = extractHtml(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
    errors.push(...r.errors);
    for (const f of r.found) add(f.key, `${rel}:${f.line}`);
  }
  for (const [key, e] of strings) {
    if (!key.trim()) errors.push(`${e.refs[0]}: empty key`);
    if (e.plural && !/\{n\}/.test(key + e.plural)) errors.push(`${e.refs[0]}: tn() forms without {n}: "${key}"`);
  }
  const out = {};
  for (const key of [...strings.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
    const e = strings.get(key);
    out[key] = e.plural ? { plural: e.plural, refs: e.refs } : { refs: e.refs };
  }
  return { strings: out, errors };
}

function render(catalog) {
  return JSON.stringify({ '@generated': 'scripts/i18n-extract.js — run `npm run i18n`; the keys are the English source strings, each dictionary in this folder maps them', strings: catalog.strings }, null, 2) + '\n';
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const catalog = extract();
  for (const e of catalog.errors) console.error('error:', e);
  const text = render(catalog);
  const n = Object.keys(catalog.strings).length;
  if (check) {
    const onDisk = fs.existsSync(CATALOG) ? fs.readFileSync(CATALOG, 'utf8') : '';
    if (onDisk !== text) { console.error(`src/locales/catalog.json is stale (${n} strings now) — run npm run i18n`); process.exit(1); }
    console.log(`catalog up to date: ${n} strings`);
  } else {
    fs.mkdirSync(path.dirname(CATALOG), { recursive: true });
    fs.writeFileSync(CATALOG, text);
    console.log(`src/locales/catalog.json: ${n} strings`);
  }
  if (catalog.errors.length) process.exit(1);
}

module.exports = { extract, extractJs, extractHtml, render, CATALOG, ATTRS };
