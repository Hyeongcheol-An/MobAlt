'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// src/renderer/theme.js is an ES module in a CommonJS package: Node re-parses it as ESM and would print a one-line
// MODULE_TYPELESS_PACKAGE_JSON notice for it. Everything else that warns is still printed.
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const load = () => import('../../src/renderer/theme.js');

const HEX = /^#[0-9a-f]{6}$/;
// where each kind of token sits (styles.css): text on every surface, dim text never on the pressed/active fill,
// the accent (links, brand, folder names, the ZOOMED chip) and the control outlines on the main surfaces and on the
// hover surface (the focused pane head, hovered rows)
const SURFACES = ['bg', 'bg-panel', 'bg-elev', 'bg-dialog', 'bg-control', 'bg-input', 'bg-hover', 'bg-active'];
const TEXT_SURFACES = SURFACES.filter((s) => s !== 'bg-active');
const LINE_SURFACES = ['bg', 'bg-panel', 'bg-elev', 'bg-dialog'];
const ACCENT_SURFACES = [...LINE_SURFACES, 'bg-hover'];
const ICONS = ['danger', 'warn', 'ok', 'ico-ssh', 'ico-local', 'ico-telnet', 'ico-rdp', 'ico-vnc'];

test('colour maths: hex, mix, luminance, contrast, ensureContrast, fillFor', async () => {
  const { hexToRgb, rgbToHex, mix, lighten, darken, luminance, contrast, ensureContrast, ensureContrastAll, fillFor, isLightTheme, THEMES } = await load();
  assert.deepEqual(hexToRgb('#1e1f22'), [30, 31, 34]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.equal(rgbToHex(30, 31, 34), '#1e1f22');
  assert.equal(rgbToHex(300, -5, 7.4), '#ff0007', 'clamped and rounded');
  assert.equal(mix('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#0000ff', 1), '#ff0000');
  assert.equal(mix('#ff0000', '#0000ff', 0), '#0000ff');
  assert.equal(lighten('#000000', 1), '#ffffff');
  assert.equal(darken('#ffffff', 1), '#000000');
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'), 'symmetric');
  // ensureContrast moves only as far as needed (2% steps) and keeps a colour that already reads
  const c = ensureContrast('#8a9099', '#2e3136', 4.5, '#ffffff');
  assert.ok(contrast(c, '#2e3136') >= 4.5, 'reaches the target');
  assert.ok(contrast(c, '#2e3136') < 5, 'not more than one step past it');
  assert.equal(ensureContrast('#d7dae0', '#1e1f22', 4.5, '#ffffff'), '#d7dae0');
  assert.equal(ensureContrast('#1e1f22', '#1e1f22', 100, '#ffffff'), '#ffffff', 'an unreachable target ends at the limit colour');
  const all = ensureContrastAll('#8a9099', ['#1e1f22', '#2e3136', '#383b41'], 4.5, '#ffffff');
  for (const bg of ['#1e1f22', '#2e3136', '#383b41']) assert.ok(contrast(all, bg) >= 4.5, `all: ${all} on ${bg}`);
  // fillFor darkens a fill under white text and lightens it under black text
  const f = fillFor('#61afef', '#ffffff', 4.5);
  assert.ok(contrast(f, '#ffffff') >= 4.5 && luminance(f) < luminance('#61afef'), `${f}`);
  const g = fillFor('#2472c8', '#000000', 4.5);
  assert.ok(contrast(g, '#000000') >= 4.5 && luminance(g) > luminance('#2472c8'), `${g}`);
  assert.equal(isLightTheme(THEMES.light), true);
  assert.equal(isLightTheme(THEMES['moba-dark']), false);
});

test('every theme has a chrome palette that reads: text 4.5:1, outlines / status colours / icons 3:1, text on accent fills 4.5:1', async () => {
  const { THEMES, chromePalette, contrast, isLightTheme } = await load();
  assert.deepEqual(Object.keys(THEMES), ['moba-dark', 'one-dark', 'dracula', 'solarized-dark', 'gruvbox-dark', 'light']);
  for (const [name, t] of Object.entries(THEMES)) {
    const p = chromePalette(t, name);
    const at = (fg, bg, min) => {
      const r = contrast(p[fg], p[bg]);
      assert.ok(r >= min, `${name}: ${fg} ${p[fg]} on ${bg} ${p[bg]} is ${r.toFixed(2)}:1, wanted ${min}:1`);
    };
    for (const [k, v] of Object.entries(p)) {
      if (k === 'scheme') assert.ok(v === 'dark' || v === 'light');
      else if (k === 'shadow-a' || k === 'backdrop-a') assert.ok(Number(v) > 0 && Number(v) < 1, `${name}: ${k} = ${v}`);
      else assert.match(v, HEX, `${name}: ${k} = ${v}`);
    }
    assert.equal(p.scheme, isLightTheme(t) ? 'light' : 'dark');
    for (const bg of SURFACES) { at('fg', bg, 4.5); at('fg-strong', bg, 4.5); }
    for (const bg of TEXT_SURFACES) { at('fg-dim', bg, 4.5); at('fg-faint', bg, 4.5); }
    for (const bg of ACCENT_SURFACES) { at('accent', bg, 4.5); at('border', bg, 3); }
    at('accent', 'bg-active', 3); // the ZOOMED chip's border and the accent on a pressed row stay visible
    for (const bg of ['bg', 'bg-panel']) for (const c of ICONS) at(c, bg, 3);
    for (const fill of ['selection', 'accent-2', 'selection-hover']) { at('selection-fg', fill, 4.5); at('selection-fg-dim', fill, 4.5); }
    at('selection-fg', 'danger-fill', 4.5);
    at('selection-fg-dim', 'danger-fill', 4.5); // the shortcut hint of a focused danger menu item
    for (const s of ['danger', 'warn', 'ok']) for (const bg of [...TEXT_SURFACES, s + '-bg']) at(s + '-fg', bg, 4.5);
    at('info-fg', 'info-bg', 4.5);
    at('fg-strong', 'info-bg', 4.5);
    at('info-border', 'info-bg', 3);
    at('divider', 'bg', 1.2); // a hairline, not a boundary: visible but soft
  }
});

test('moba-dark keeps the reference chrome; the light theme is a light application; dark chromes sit a step above their terminal', async () => {
  const { THEMES, chromePalette, luminance } = await load();
  const m = chromePalette(THEMES['moba-dark'], 'moba-dark');
  assert.equal(m.scheme, 'dark');
  assert.deepEqual([m.bg, m['bg-panel'], m['bg-elev'], m['bg-active'], m.divider, m.fg, m['fg-dim'], m.accent, m.selection, m.danger, m.warn, m.ok],
    ['#1e1f22', '#26282c', '#2e3136', '#383b41', '#3a3d43', '#d7dae0', '#9aa0a8', '#4ea1ff', '#2a6fc4', '#e5534b', '#e6b422', '#4caf50']);
  assert.equal(chromePalette(THEMES['moba-dark']).bg, m.bg, 'the overrides are found by the palette object as well as by name');
  assert.equal(chromePalette().bg, m.bg, 'no theme: moba-dark');
  const l = chromePalette(THEMES.light, 'light');
  assert.equal(l.scheme, 'light');
  assert.ok(luminance(l.bg) > 0.85 && luminance(l['bg-panel']) > 0.75 && luminance(l['bg-elev']) > 0.95, 'near-white surfaces');
  assert.ok(luminance(l.fg) < 0.05 && luminance(l['fg-dim']) < 0.2, 'dark text');
  assert.equal(l['fg-strong'], '#000000');
  assert.ok(Number(l['shadow-a']) < Number(m['shadow-a']), 'lighter shadows on a light chrome');
  for (const name of ['one-dark', 'dracula', 'solarized-dark', 'gruvbox-dark']) {
    const t = THEMES[name], p = chromePalette(t, name);
    assert.equal(p.scheme, 'dark');
    assert.equal(p.bg, t.background, `${name}: the window is the terminal background`);
    assert.ok(luminance(p['bg-panel']) > luminance(t.background) && luminance(p['bg-elev']) > luminance(p['bg-panel']), `${name}: panels a step lighter, menus another`);
    assert.equal(p['fg-strong'], '#ffffff');
  }
});

test('the chromes differ from theme to theme, and a palette that is not in THEMES still gets a readable chrome', async () => {
  const { THEMES, chromePalette, contrast, cssVars } = await load();
  const bgs = Object.keys(THEMES).map((n) => chromePalette(THEMES[n], n)['bg-panel']);
  assert.equal(new Set(bgs).size, bgs.length, `distinct panel colours: ${bgs.join(' ')}`);
  const p = chromePalette({ background: '#101418', foreground: '#c0c8d0', blue: '#4080ff', red: '#ff5050', green: '#50c050', yellow: '#e0c040', magenta: '#d070d0' }, 'custom');
  assert.equal(p.scheme, 'dark');
  for (const bg of SURFACES) assert.ok(contrast(p.fg, p[bg]) >= 4.5);
  assert.ok(contrast(p.accent, p['bg-panel']) >= 4.5 && contrast(p['selection-fg'], p.selection) >= 4.5);
  const vars = cssVars(p);
  assert.ok(Object.keys(vars).every((k) => k.startsWith('--')) && !('--scheme' in vars) && vars['--bg'] === p.bg);
});

test('the terminal selection band is visible on every theme and the selected text stays readable', async () => {
  const { THEMES, terminalTheme, contrast } = await load();
  for (const [name, t] of Object.entries(THEMES)) {
    const x = terminalTheme(t);
    assert.match(x.selectionBackground, HEX, `${name}: selectionBackground`);
    assert.equal(x.selectionInactiveBackground, x.selectionBackground, `${name}: the unfocused terminal keeps the band`);
    const band = contrast(x.selectionBackground, t.background);
    assert.ok(band >= 2, `${name}: band ${x.selectionBackground} is ${band.toFixed(2)}:1 on ${t.background}, wanted 2:1`);
    if (x.selectionForeground) {
      assert.match(x.selectionForeground, HEX);
      assert.ok(contrast(x.selectionForeground, x.selectionBackground) >= 4.5, `${name}: selection text ${x.selectionForeground} on ${x.selectionBackground}`);
      assert.ok(contrast(t.foreground, x.selectionBackground) < 3, `${name}: the text colour is replaced only when the theme text would not read on the band`);
    } else assert.ok(contrast(t.foreground, x.selectionBackground) >= 3, `${name}: text ${t.foreground} on the band ${x.selectionBackground}`);
    for (const k of Object.keys(t)) if (!k.startsWith('selection')) assert.equal(x[k], t[k], `${name}: ${k} untouched`);
  }
  assert.ok(!terminalTheme(THEMES['moba-dark']).selectionForeground, 'moba-dark keeps the cell colours inside a selection');
  assert.ok(terminalTheme(THEMES['solarized-dark']).selectionForeground, 'Solarized: its dim text gets the strong selection foreground');
  assert.equal(terminalTheme().selectionBackground, terminalTheme(THEMES['moba-dark']).selectionBackground, 'no theme: moba-dark');
});

test('find highlights follow the palette and stay readable under the theme text', async () => {
  const { THEMES, searchDecorations, contrast } = await load();
  for (const [name, t] of Object.entries(THEMES)) {
    const d = searchDecorations(t);
    for (const k of ['matchBackground', 'activeMatchBackground', 'activeMatchBorder', 'matchOverviewRuler', 'activeMatchColorOverviewRuler']) assert.match(d[k], HEX, `${name}: ${k}`);
    // readable: 4.5:1 wherever the theme's text allows it (Solarized's dim text only leaves room for 3:1), and never lost in the background
    const floor = name === 'solarized-dark' ? 3 : 4.5;
    assert.ok(contrast(d.matchBackground, t.foreground) >= floor, `${name}: match ${d.matchBackground} under ${t.foreground}`);
    assert.ok(contrast(d.activeMatchBackground, t.foreground) >= floor, `${name}: active match ${d.activeMatchBackground}`);
    assert.ok(contrast(d.matchBackground, t.background) >= 1.4 && contrast(d.activeMatchBackground, t.background) >= 1.4, `${name}: highlights visible on the terminal background`);
    assert.ok(contrast(d.activeMatchBorder, t.background) >= 3, `${name}: active border visible`);
    assert.notEqual(d.matchBackground, '#515c6a', 'no fixed grey any more');
  }
  assert.notEqual(searchDecorations(THEMES.light).matchBackground, searchDecorations(THEMES['moba-dark']).matchBackground);
});
