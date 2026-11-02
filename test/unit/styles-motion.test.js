'use strict';
// Reduce motion (macOS System Settings → Accessibility → Display): every endless animation of the stylesheet — the
// connecting dot's pulse, the browser pane's loading bar — is switched off under prefers-reduced-motion, as the
// monitoring bar's transition already is. A one-off entrance (a toast sliding in) may stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The top-level rules with an infinite animation, and the selectors a reduced-motion block sets `animation: none` on. */
function scan() {
  const endless = [], stilled = new Set();
  const media = /@media \(prefers-reduced-motion: reduce\) \{((?:[^{}]*\{[^}]*\})*)\s*\}/g;
  let m;
  while ((m = media.exec(css))) {
    for (const r of m[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) if (/animation:\s*none/.test(r[2])) r[1].split(',').forEach((sel) => stilled.add(sel.trim()));
  }
  const top = css.replace(media, '');
  for (const r of top.matchAll(/([^{}@]+)\{([^}]*)\}/g)) if (/animation:[^;]*\binfinite\b/.test(r[2])) r[1].split(',').forEach((sel) => endless.push(sel.trim()));
  return { endless, stilled };
}

test('every endless animation stops under prefers-reduced-motion', () => {
  const { endless, stilled } = scan();
  assert.ok(endless.includes('.tab .dot.connecting'), 'the connecting dot pulses');
  assert.ok(endless.includes('.pane.browser .bt-progress::before'), 'the loading bar sweeps');
  assert.deepEqual(endless.filter((sel) => !stilled.has(sel)), []);
});
