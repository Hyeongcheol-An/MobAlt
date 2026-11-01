#!/usr/bin/env node
'use strict';
// What every dictionary still owes the catalog — the delta a feature branch that added or reworded interface strings
// has to translate before `npm test` passes and the branch can merge (src/locales/README.md has the procedure):
//
//   npm run i18n:status             one line per language: missing / stale / other problems
//   npm run i18n:status -- --list   …and the strings themselves (the work list of a delta translation)
//   npm run i18n:status -- ko fr    only these languages
//
// The catalog is extracted from the sources here (not read from disk), so the numbers are right before `npm run i18n`
// too. The checks are the ones test/unit/i18n.test.js enforces (it uses this module): every catalog string present and
// non-empty, no stale key, the source's placeholders byte for byte ({n} of a tn() pair as the catalog's plural form
// allows), [one, other] only for a tn() string, nothing of three words or more left in English unless listed in @keep.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const i18n = require('../src/main/i18n');
const extractor = require('./i18n-extract');

const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const words = (s) => String(s).split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;

/** One dictionary against a catalog: { missing: [key], stale: [key], other: [message] } — all empty when it is complete. */
function check(dict, catalog) {
  const keep = new Set(Array.isArray(dict['@keep']) ? dict['@keep'] : []); // strings that stay as in English on purpose (names, acronyms)
  const r = { missing: [], stale: [], other: [] };
  for (const k of Object.keys(dict)) if (!k.startsWith('@') && !catalog.strings[k]) r.stale.push(k);
  for (const k of Object.keys(catalog.strings)) {
    const v = dict[k];
    const spec = catalog.strings[k];
    if (v === undefined) { r.missing.push(k); continue; }
    const forms = Array.isArray(v) ? v : [v];
    if (!forms.length || forms.some((f) => typeof f !== 'string' || !f.trim())) { r.other.push(`empty: ${JSON.stringify(k)}`); continue; }
    if (Array.isArray(v) && !spec.plural) r.other.push(`plural forms for a string without tn(): ${JSON.stringify(k)}`);
    if (Array.isArray(v) && v.length !== 2) r.other.push(`plural forms must be [one, other]: ${JSON.stringify(k)}`);
    // every placeholder of the source must be there; a tn() pair whose English forms differ (the singular without
    // {n}, say) lets a translated form drop what only one English form has
    const one = placeholders(k), other = spec.plural ? placeholders(spec.plural) : one;
    const allowed = new Set([...one, ...other]), required = one.filter((x) => other.includes(x));
    for (const f of forms) {
      const got = placeholders(f);
      if (!required.every((x) => got.includes(x)) || !got.every((x) => allowed.has(x))) r.other.push(`placeholders differ: ${JSON.stringify(k)} → ${JSON.stringify(f)} (want {${required.join('} {')}}${allowed.size > required.length ? ', may also use {' + [...allowed].filter((x) => !required.includes(x)).join('} {') + '}' : ''})`);
    }
    if (words(k) >= 3 && forms.every((f) => f === k) && !keep.has(k)) r.other.push(`left in English: ${JSON.stringify(k)}`);
  }
  return r;
}

/** Every problem of a dictionary as one list of messages (empty = complete; what the unit test asserts). */
function problems(dict, catalog) {
  const r = check(dict, catalog);
  return [...r.stale.map((k) => `stale key (not in the catalog any more): ${JSON.stringify(k)}`), ...r.missing.map((k) => `missing: ${JSON.stringify(k)}`), ...r.other];
}

/** Print the state of the dictionaries (all shipped languages, or `codes`); true when every one is complete. */
function status(codes = [], { list = false, out = console.log } = {}) {
  const catalog = extractor.extract();
  const total = Object.keys(catalog.strings).length;
  const langs = i18n.LANGUAGES.filter((l) => l.code !== 'en' && (!codes.length || codes.includes(l.code)));
  let complete = true;
  out(`catalog: ${total} strings`);
  for (const l of langs) {
    const file = path.join(ROOT, 'src', 'locales', l.code + '.json');
    if (!fs.existsSync(file)) { out(`${l.code.padEnd(6)} TODO  no dictionary (src/locales/${l.code}.json)  (${l.name})`); complete = false; continue; }
    const r = check(JSON.parse(fs.readFileSync(file, 'utf8')), catalog);
    const ok = !r.missing.length && !r.stale.length && !r.other.length;
    if (!ok) complete = false;
    out(`${l.code.padEnd(6)} ${ok ? 'ok  ' : 'TODO'}  missing ${String(r.missing.length).padStart(4)}  stale ${String(r.stale.length).padStart(4)}  other ${String(r.other.length).padStart(3)}  (${l.name})`);
    if (list) {
      for (const k of r.missing) out(`  missing: ${JSON.stringify(k)}${catalog.strings[k].plural ? '  plural: ' + JSON.stringify(catalog.strings[k].plural) : ''}`);
      for (const k of r.stale) out(`  stale:   ${JSON.stringify(k)}`);
      for (const m of r.other) out(`  ${m}`);
    }
  }
  return complete;
}

module.exports = { check, problems, status };

if (require.main === module) {
  const args = process.argv.slice(2);
  const codes = args.filter((a) => !a.startsWith('--'));
  const unknown = codes.filter((c) => !i18n.LANGUAGES.some((l) => l.code === c && c !== 'en'));
  if (unknown.length) { console.error(`unknown language: ${unknown.join(', ')} (shipped: ${i18n.LANGUAGES.filter((l) => l.code !== 'en').map((l) => l.code).join(' ')})`); process.exit(2); }
  process.exit(status(codes, { list: args.includes('--list') }) ? 0 : 1);
}
