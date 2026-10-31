'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// src/renderer/highlight.js is an ES module in a CommonJS package (see theme.test.js for the notice it would print).
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const load = () => import('../../src/renderer/highlight.js');
const loadTheme = () => import('../../src/renderer/theme.js');

const HEX = /^#[0-9a-f]{6}$/;
const rule = (pattern, extra = {}) => ({ pattern, regex: false, ci: false, color: 'red', bg: '', bold: false, underline: false, ...extra });
const spans = (text, matches) => matches.map((m) => `${m.rule.color}:${text.slice(m.start, m.end)}`);

test('the built-in rules: errors, warnings, success, IPv4 / IPv6, URLs and sizes — and what they must leave alone', async () => {
  const { DEFAULT_RULES, highlightLine, compileRules } = await load();
  assert.equal(DEFAULT_RULES.length, 6);
  assert.equal(compileRules(DEFAULT_RULES).invalid.length, 0, 'every default compiles');
  assert.deepEqual(DEFAULT_RULES.map((r) => r.color), ['red', 'yellow', 'green', 'blue', 'accent', 'accent-dim']);
  assert.ok(DEFAULT_RULES[0].bold && DEFAULT_RULES[4].underline, 'errors are bold, URLs underlined');
  const line = 'ERROR: disk failed, WARN deprecated, OK done, active (running), host 10.0.0.1:22 and fe80::1 and ::1, see https://example.com/a?b=1, used 512M of 3.2GB in 200ms (45%)';
  assert.deepEqual(spans(line, highlightLine(line, DEFAULT_RULES)), [
    'red:ERROR', 'red:failed', 'yellow:WARN', 'yellow:deprecated', 'green:OK', 'green:done', 'green:active (running)',
    'blue:10.0.0.1:22', 'blue:fe80::1', 'blue:::1', 'accent:https://example.com/a?b=1', 'accent-dim:512M', 'accent-dim:3.2GB', 'accent-dim:200ms', 'accent-dim:45%',
  ]);
  // case-insensitive keywords, plural forms, the sentence-ending dot stays outside a URL
  assert.deepEqual(spans('errors Fatal PANIC timed out Refused', highlightLine('errors Fatal PANIC timed out Refused', DEFAULT_RULES)), ['red:errors', 'red:Fatal', 'red:PANIC', 'red:timed out', 'red:Refused']);
  assert.deepEqual(spans('go to http://h/x.', highlightLine('go to http://h/x.', DEFAULT_RULES)), ['accent:http://h/x']);
  assert.deepEqual(spans('2001:db8::8a2e:370:7334 [::1]:8080', highlightLine('2001:db8::8a2e:370:7334 [::1]:8080', DEFAULT_RULES)), ['blue:2001:db8::8a2e:370:7334', 'blue:::1']);
  // not addresses, not sizes, not keywords: a clock, a MAC, a version, C++ scope, "token" / "stderr", a bare number, 256.x
  for (const plain of ['12:30:00', 'aa:bb:cc:dd:ee:ff', 'version 1.2.3', 'std::vector<int>', 'token stderr errorlevel', 'pid 4242', '256.1.1.1', 'a 3 b 7.5 c', '2 m 5 s']) {
    assert.deepEqual(highlightLine(plain, DEFAULT_RULES), [], plain);
  }
  assert.deepEqual(spans('512 MB free, 1.5 GiB used, 3k lines', highlightLine('512 MB free, 1.5 GiB used, 3k lines', DEFAULT_RULES)), ['accent-dim:512 MB', 'accent-dim:1.5 GiB'], 'a lowercase single letter is not a unit (5m: minutes or metres?)');
  // a single-letter unit needs two digits or a decimal: the "2B" of an escape literal and the "7b" of a hash are not sizes
  for (const plain of ['esc [2B down', 'hash 3bf2a1 7b 2b', 'cursor [12B [1;5B', 'id 5M', '9B']) assert.deepEqual(highlightLine(plain, DEFAULT_RULES), [], plain);
  assert.deepEqual(spans('15M 5.0M 512M 100B 1.5G 12b', highlightLine('15M 5.0M 512M 100B 1.5G 12b', DEFAULT_RULES)), ['accent-dim:15M', 'accent-dim:5.0M', 'accent-dim:512M', 'accent-dim:100B', 'accent-dim:1.5G', 'accent-dim:12b']);
  assert.deepEqual(spans('[512MB] 2GB 5%', highlightLine('[512MB] 2GB 5%', DEFAULT_RULES)), ['accent-dim:512MB', 'accent-dim:2GB', 'accent-dim:5%'], 'two-letter units and percents keep a single digit and a bracket');
});

test('plain patterns are literal substrings (escaped), regex ones are regexes; ignore case per rule', async () => {
  const { highlightLine } = await load();
  assert.deepEqual(spans('a.b axb A.B', highlightLine('a.b axb A.B', [rule('a.b')])), ['red:a.b']);
  assert.deepEqual(spans('a.b axb A.B', highlightLine('a.b axb A.B', [rule('a.b', { ci: true })])), ['red:a.b', 'red:A.B']);
  assert.deepEqual(spans('a.b axb', highlightLine('a.b axb', [rule('a.b', { regex: true })])), ['red:a.b', 'red:axb']);
  assert.deepEqual(spans('x (y) [z] $1 ^2 a|b \\n', highlightLine('x (y) [z] $1 ^2 a|b \\n', [rule('(y)'), rule('[z]', { color: 'green' }), rule('$1', { color: 'blue' }), rule('a|b', { color: 'cyan' }), rule('\\n', { color: 'dim' })])),
    ['red:(y)', 'green:[z]', 'blue:$1', 'cyan:a|b', 'dim:\\n']);
  assert.deepEqual(highlightLine('nothing here', [rule('zzz')]), []);
  assert.deepEqual(highlightLine('', [rule('a')]), []);
  assert.deepEqual(highlightLine(null, [rule('a')]), []);
  assert.deepEqual(highlightLine('abc', null), []);
});

test('overlaps: the earlier start wins, at the same start the longer match, then the rule listed first; nested matches are dropped', async () => {
  const { highlightLine, DEFAULT_RULES } = await load();
  // "error" inside a URL: the URL starts first and swallows it
  const t1 = 'open http://host/error.log now';
  assert.deepEqual(spans(t1, highlightLine(t1, DEFAULT_RULES)), ['accent:http://host/error.log']);
  // same start: "failed" (longer) beats "fail" whichever rule comes first
  const t2 = 'it failed';
  assert.deepEqual(spans(t2, highlightLine(t2, [rule('fail'), rule('failed', { color: 'green' })])), ['green:failed']);
  assert.deepEqual(spans(t2, highlightLine(t2, [rule('failed', { color: 'green' }), rule('fail')])), ['green:failed']);
  // same start and length: the rule listed first
  assert.deepEqual(spans('abc', highlightLine('abc', [rule('abc', { color: 'blue' }), rule('abc')])), ['blue:abc']);
  // an earlier, shorter match beats a later, longer one that overlaps it; a match after it is kept
  const t3 = 'abcdef';
  assert.deepEqual(spans(t3, highlightLine(t3, [rule('cdefg'), rule('ab', { color: 'green' }), rule('bcd', { color: 'blue' }), rule('ef', { color: 'cyan' })])), ['green:ab', 'cyan:ef']);
  // the result is sorted by position whatever the rule order
  const t4 = 'one two three';
  assert.deepEqual(spans(t4, highlightLine(t4, [rule('three'), rule('one', { color: 'green' })])), ['green:one', 'red:three']);
  for (const m of highlightLine(t4, [rule('o')])) assert.ok(m.end > m.start);
});

test('limits: 50 matches per line, lines over 4000 characters are skipped, a zero-width pattern cannot spin', async () => {
  const { highlightLine, MAX_MATCHES_PER_LINE, MAX_LINE_LENGTH } = await load();
  assert.equal(MAX_MATCHES_PER_LINE, 50);
  assert.equal(MAX_LINE_LENGTH, 4000);
  const many = 'x '.repeat(80);
  assert.equal(highlightLine(many, [rule('x')]).length, 50);
  assert.equal(highlightLine(many, [rule('x'), rule('x ', { color: 'green' })]).length, 50, 'the cap holds across rules');
  const long = 'error '.repeat(700); // 4200 chars
  assert.deepEqual(highlightLine(long, [rule('error')]), []);
  assert.equal(highlightLine(long.slice(0, 4000), [rule('error')]).length, 50, 'exactly 4000 is still scanned');
  const t0 = Date.now();
  assert.deepEqual(highlightLine('abc', [rule('', { regex: true })]), [], 'an empty pattern matches nothing');
  assert.deepEqual(highlightLine('abc', [rule('x*', { regex: true })]), [], 'zero-width matches are skipped');
  assert.deepEqual(spans('aXXa', highlightLine('aXXa', [rule('X*', { regex: true })])), ['red:XX'], 'the non-empty match of a star pattern is found');
  assert.ok(Date.now() - t0 < 500);
});

test('an invalid regex disables that rule only and never throws; normalizeRule types the fields', async () => {
  const { compileRules, highlightLine, normalizeRule } = await load();
  const bad = rule('(', { regex: true }), good = rule('ok', { color: 'green' });
  const { compiled, invalid } = compileRules([bad, good, rule('[a-', { regex: true, color: 'blue' })]);
  assert.equal(compiled.length, 1);
  assert.deepEqual(invalid.map((i) => i.index), [0, 2]);
  assert.ok(invalid[0].error && !/^Invalid regular expression:|^\//.test(invalid[0].error), `message is trimmed: ${invalid[0].error}`);
  assert.equal(invalid[0].error, 'Unterminated group');
  assert.deepEqual(spans('ok (', highlightLine('ok (', [bad, good])), ['green:ok'], 'the valid rule still matches');
  assert.deepEqual(highlightLine('ok (', [bad]), []);
  assert.deepEqual(spans('ok', highlightLine('ok', compiled)), spans('ok', highlightLine('ok', [good])), 'compiled entries and plain rules give the same result');
  assert.deepEqual(highlightLine('ok', compiled).map((m) => [m.start, m.end]), [[0, 2]]);
  // disabled and empty rules are left out; a plain-text "(" is fine
  assert.equal(compileRules([rule('a', { enabled: false }), rule(''), rule('(')]).compiled.length, 1);
  assert.deepEqual(normalizeRule({ pattern: 'x', regex: 1, ci: 'yes', color: 'RED', bg: '#ABCDEF', bold: null, underline: true, enabled: false }),
    { pattern: 'x', regex: true, ci: true, color: 'red', bg: '#abcdef', bold: false, underline: true, enabled: false });
  assert.deepEqual(normalizeRule({ color: 'nope', bg: 'red', pattern: 5 }), { pattern: '', regex: false, ci: false, color: '', bg: 'red', bold: false, underline: false, enabled: true });
  assert.deepEqual(normalizeRule(null).pattern, '');
});

test('the rule colours read on every theme (4.5:1), backgrounds are visible tints the text still reads on', async () => {
  const { highlightPalette, ruleStyle, resolveColor, COLOR_KEYS } = await load();
  const { THEMES, contrast } = await loadTheme();
  for (const [name, t] of Object.entries(THEMES)) {
    const p = highlightPalette(t);
    for (const [k] of COLOR_KEYS) {
      assert.match(p[k], HEX, `${name}: ${k}`);
      assert.ok(contrast(p[k], t.background) >= 4.5, `${name}: ${k} ${p[k]} on ${t.background} is ${contrast(p[k], t.background).toFixed(2)}:1`);
    }
    assert.ok(contrast(p['accent-dim'], t.background) <= contrast(p.accent, t.background) + 0.01 || contrast(p['accent-dim'], t.background) >= 4.5, `${name}: dim accent`);
    assert.equal(resolveColor('', p), null);
    assert.equal(resolveColor('red', p), p.red);
    const custom = resolveColor('#FF0000', p);
    assert.match(custom, HEX);
    assert.ok(contrast(custom, t.background) >= 4.5, `${name}: a custom colour is pushed until it reads`);
    for (const [k] of COLOR_KEYS) {
      const s1 = ruleStyle(rule('x', { color: '', bg: k }), p); // theme text on the tint
      assert.equal(s1.fg, null);
      assert.match(s1.bg, HEX);
      assert.ok(contrast(s1.bg, t.foreground) >= 3, `${name}: ${k} tint ${s1.bg} under the text ${t.foreground}`);
      assert.ok(contrast(s1.bg, t.background) >= 1.4, `${name}: ${k} tint ${s1.bg} visible on ${t.background}`);
      const s2 = ruleStyle(rule('x', { color: 'red', bg: k, bold: true, underline: true }), p); // red text on the tint
      assert.equal(s2.fg, p.red);
      assert.ok(contrast(s2.bg, p.red) >= 3, `${name}: ${k} tint ${s2.bg} under red ${p.red}`);
      assert.ok(s2.bold && s2.underline);
    }
    assert.deepEqual(ruleStyle(rule('x', { color: 'green' }), p), { fg: p.green, bg: null, bold: false, underline: false });
  }
  assert.notEqual(highlightPalette(THEMES.light).red, highlightPalette(THEMES['moba-dark']).red);
  assert.ok(contrast(highlightPalette(THEMES.light).yellow, '#ffffff') >= 4.5, 'yellow on a light theme is darkened until it reads');
});
