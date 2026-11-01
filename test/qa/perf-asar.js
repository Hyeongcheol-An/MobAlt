'use strict';
// What app.asar ships (scripts/perf-size.sh, test/qa/perf.js): the size by top-level folder, by package, by kind of
// file that need not be in a release (foreign-platform prebuilds, TypeScript sources, C++ headers and build files,
// documentation), from the archive's header — nothing is extracted.
//   node test/qa/perf-asar.js [app.asar]
const path = require('path');
const asar = require('@electron/asar');
const file = process.argv[2] || path.resolve(__dirname, '..', '..', 'dist', 'mac-arm64', 'MobAlt.app', 'Contents', 'Resources', 'app.asar');
const { header } = asar.getRawHeader(file);
const files = [];
const walk = (n, p) => { if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p ? p + '/' + k : k); return; } files.push({ p, size: n.size || 0, unpacked: !!n.unpacked }); };
walk(header, '');
const sum = (list) => list.reduce((a, f) => a + f.size, 0);
const mb = (n) => (n / 1048576).toFixed(2);
const pkgOf = (p) => { const s = p.split('/'); return s[0] !== 'node_modules' ? s[0] : s[1].startsWith('@') ? s[1] + '/' + s[2] : s[1]; };
const by = (key) => { const m = new Map(); for (const f of files) { const k = key(f); m.set(k, (m.get(k) || 0) + f.size); } return [...m].sort((a, b) => b[1] - a[1]); };
console.log(`app.asar: ${files.length} files, ${mb(sum(files))} MB (${mb(sum(files.filter((f) => f.unpacked)))} MB unpacked beside it)`);
console.log('| Package (top 12) | MB |\n|---|---:|');
for (const [k, v] of by((f) => pkgOf(f.p)).slice(0, 12)) console.log(`| ${k} | ${mb(v)} |`);
console.log('\n| Need not ship | MB | files |\n|---|---:|---:|');
const cats = [
  ['prebuilds for other platforms', /\/prebuilds\/(win32|linux|android)-/],
  ['TypeScript sources (src/*.ts) and xterm.mjs', /^node_modules\/.*\.(ts|mts|cts)$|\/@xterm\/xterm\/lib\/xterm\.mjs$/],
  ['C/C++ headers, sources, gyp and build files', /\.(h|hpp|cc|cpp|c|gyp|gypi|mk|a|o|d|stamp)$|\/Makefile$|\/obj\.target\//],
  ['Markdown documentation', /\.md$/],
  ['i18n catalog and locale readme (dev only)', /^src\/locales\/(catalog\.json|README\.md)$/],
  ['serialport mock binding', /\/@serialport\/binding-mock\//],
];
for (const [name, re] of cats) { const m = files.filter((f) => re.test(f.p)); console.log(`| ${name} | ${mb(sum(m))} | ${m.length} |`); }
const all = new Set(); for (const [, re] of cats) for (const f of files) if (re.test(f.p)) all.add(f);
console.log(`| **total (distinct)** | **${mb(sum([...all]))}** | ${all.size} |`);
