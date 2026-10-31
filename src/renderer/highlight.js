// Keyword highlighting in the terminal (MobaXterm's "syntax highlighting"): a rule list — plain text or a regex, a
// colour, an optional background, bold, underline — painted over the output with xterm.js decorations.
//
// Two halves. The pure matcher (`highlightLine`, `compileRules`, the default rules, the palette maths) has no DOM and
// is unit-tested in test/unit/highlight.test.js. `TermHighlighter` is the pane side: it listens to a terminal's
// onWriteParsed, scans only the rows written since the last scan (a marker on the cursor row remembers where that
// was), and registers one decoration per match. Decorations hang on markers, so xterm disposes them itself when a
// row scrolls out of the scrollback or the terminal is cleared; the highlighter forgets them when its rule set,
// palette or enabled state changes and on dispose. Nothing in here may throw into the data path: a scan that fails
// is logged once and switches the pane's highlighting off.
import { ensureContrast, mix, isLightTheme, contrast } from './theme.js';

/** Matches kept per logical line (after overlap resolution). */
export const MAX_MATCHES_PER_LINE = 50;
/** Logical lines longer than this are not scanned (a minified blob, a base64 dump). */
export const MAX_LINE_LENGTH = 4000;
/** Live decorations per pane: beyond this the oldest rows lose theirs (bounds markers, DOM elements and render work). */
export const MAX_DECORATIONS = 2000;
/** Rows scanned per write event at most (a 64 KB pty chunk is a few thousand rows). */
export const SCAN_CAP = 5000;
/** A burst is scanned newest row first; once a scan has used this much time the older rest of it stays plain. */
export const SCAN_BUDGET_MS = 24;

// ---------- the built-in rules ----------
const IPV4 = String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b(?::\d{1,5})?`;
// the usual eight-group / "::"-compressed forms; a hex group is required (a bare "::" is C++ and Ruby, not an address)
const IPV6 = String.raw`(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|:(?::[0-9a-f]{1,4}){1,7})(?![\w:])`;
const URL = String.raw`\b(?:https?|ftps?|sftp|ssh|wss?|file)://[^\s'"<>()\[\]]*[^\s'"<>()\[\].,;:!?]`;
// 512M, 3.2GB, 1.5GiB, 200ms, 45% — a number with a size / time / percent unit (never a bare number or a version); a
// space before the unit only with units of two letters or more ("3 b" is a list item, "512 MB" a size); a single-letter
// unit needs two digits or a decimal and no CSI-literal context ("\033[2B" and the "7b" of a hash are not sizes)
const UNITS = String.raw`\b(?:\d+(?:[.,]\d+)?(?:\s?(?:[KMGTPE]i?B|[kmgtpe]i?b|bytes?|ms|µs|us|ns)|%)|(?<![\[;])(?:\d{2,}|\d+[.,]\d+)(?:[KMGTPE]i?|[Bb]))(?![\w.])`;

/** The rules a fresh install highlights with (Settings → Features → Keyword highlighting → Restore defaults). */
export const DEFAULT_RULES = Object.freeze([
  { pattern: String.raw`\b(?:error|errors|fatal|panic|fail|failed|failure|denied|refused|timeout|timed out)\b`, regex: true, ci: true, color: 'red', bg: '', bold: true, underline: false },
  { pattern: String.raw`\b(?:warn|warning|warnings|deprecated)\b`, regex: true, ci: true, color: 'yellow', bg: '', bold: false, underline: false },
  { pattern: String.raw`active \(running\)|\b(?:ok|success|successful|successfully|done|passed|completed)\b`, regex: true, ci: true, color: 'green', bg: '', bold: false, underline: false },
  { pattern: `${IPV4}|${IPV6}`, regex: true, ci: true, color: 'blue', bg: '', bold: false, underline: false },
  { pattern: URL, regex: true, ci: true, color: 'accent', bg: '', bold: false, underline: true },
  { pattern: UNITS, regex: true, ci: false, color: 'accent-dim', bg: '', bold: false, underline: false },
].map(Object.freeze));

/** Colour keys a rule may use (besides a '#rrggbb'); the label is what the rules table shows. */
export const COLOR_KEYS = [
  ['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['magenta', 'Magenta'], ['cyan', 'Cyan'],
  ['accent', 'Accent'], ['accent-dim', 'Accent (dim)'], ['dim', 'Dim'], ['text', 'Text'],
];
const HEX = /^#[0-9a-f]{6}$/i;

/** A rule as stored: every field present and typed; an unknown colour falls back to the text colour. */
export function normalizeRule(r) {
  r = r && typeof r === 'object' ? r : {};
  const colour = (v) => {
    const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return HEX.test(c) || COLOR_KEYS.some(([k]) => k === c) ? c : '';
  };
  return {
    pattern: typeof r.pattern === 'string' ? r.pattern : '',
    regex: !!r.regex, ci: !!r.ci,
    color: colour(r.color), bg: colour(r.bg),
    bold: !!r.bold, underline: !!r.underline,
    enabled: r.enabled !== false,
  };
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

/**
 * Compile a rule list: `{ compiled: [{ rule, re, index }], invalid: [{ index, rule, error }] }`. A rule whose regex does not
 * compile (or an empty / disabled one) is left out of `compiled`; invalid ones are reported so the caller can say so
 * once (a toast) — this never throws.
 */
export function compileRules(rules) {
  const compiled = [], invalid = [];
  (Array.isArray(rules) ? rules : []).forEach((raw, index) => {
    const rule = normalizeRule(raw);
    if (!rule.enabled || !rule.pattern) return;
    try {
      const re = new RegExp(rule.regex ? rule.pattern : escapeRegex(rule.pattern), 'g' + (rule.ci ? 'i' : ''));
      compiled.push({ rule, re, index });
    } catch (e) {
      invalid.push({ index, rule, error: e && e.message ? e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, '') : String(e) });
    }
  });
  return { compiled, invalid };
}

// rules handed to highlightLine() as plain objects are compiled once per object (a compiled entry carries `re` already)
const reCache = new WeakMap();
const regexOf = (rule) => {
  if (rule && rule.re instanceof RegExp) return rule.re;
  if (!rule || typeof rule !== 'object') return null;
  if (reCache.has(rule)) return reCache.get(rule);
  const { compiled } = compileRules([rule]);
  const re = compiled.length ? compiled[0].re : null;
  reCache.set(rule, re);
  return re;
};

/**
 * The matches of `rules` in one line of text: `[{ start, end, rule }]` sorted by position, non-overlapping. Where two
 * rules overlap the earlier start wins and, at the same start, the longer match (then the rule listed first); a match
 * inside a kept one is dropped. `rules` are rule objects or compileRules() entries. At most MAX_MATCHES_PER_LINE
 * matches per rule and in the result; a line over MAX_LINE_LENGTH chars yields none. Never throws.
 */
export function highlightLine(text, rules) {
  const out = [];
  if (typeof text !== 'string' || !text || text.length > MAX_LINE_LENGTH || !Array.isArray(rules)) return out;
  const found = [];
  for (let i = 0; i < rules.length; i++) {
    const entry = rules[i];
    const re = regexOf(entry);
    if (!re) continue;
    const rule = entry.rule || entry;
    re.lastIndex = 0;
    let m, n = 0;
    try {
      while (n < MAX_MATCHES_PER_LINE && (m = re.exec(text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; } // a zero-width pattern must not spin
        found.push({ start: m.index, end: m.index + m[0].length, rule, order: i });
        n++;
      }
    } catch { /* a pathological pattern: skip this rule on this line */ }
  }
  if (!found.length) return out;
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.order - b.order);
  let lastEnd = -1;
  for (const f of found) {
    if (f.start < lastEnd) continue;
    out.push({ start: f.start, end: f.end, rule: f.rule });
    lastEnd = f.end;
    if (out.length >= MAX_MATCHES_PER_LINE) break;
  }
  return out;
}

// ---------- colours ----------
/**
 * The colours a palette gives the rule colour keys, each pushed until it reads at 4.5:1 on the terminal background
 * (the theme's own red is 3.3:1 on Moba Dark; Solarized's "bright" slots are greys, so the base slots seed them).
 */
export function highlightPalette(theme) {
  const bg = theme.background || '#1e1e1e', fg = theme.foreground || '#ececec', light = isLightTheme(theme);
  const strong = light ? '#000000' : '#ffffff';
  const slot = (k, fallback) => ensureContrast(theme[k] || fallback, bg, 4.5, strong);
  const accent = slot('blue', '#2472c8');
  return {
    bg, fg, light, strong,
    red: slot('red', '#cd3131'), yellow: slot('yellow', '#e5e510'), green: slot('green', '#0dbc79'), blue: accent,
    magenta: slot('magenta', '#bc3fbc'), cyan: slot('cyan', '#11a8cd'),
    accent, 'accent-dim': ensureContrast(mix(accent, fg, 0.55), bg, 4.5, strong),
    dim: ensureContrast(mix(fg, bg, 0.7), bg, 4.5, strong),
    text: ensureContrast(fg, bg, 4.5, strong),
  };
}

/** A rule colour ('red', 'accent-dim', '#rrggbb', '') as a readable text colour on the palette's background, or null. */
export function resolveColor(key, palette) {
  if (!key) return null;
  if (HEX.test(key)) return ensureContrast(key.toLowerCase(), palette.bg, 4.5, palette.strong);
  return palette[key] || null;
}

/**
 * What a rule paints: `{ fg, bg, bold, underline }` with '#rrggbb' or null. A background is a tint of its colour over
 * the terminal background, pushed towards the background until the text on it (the rule's colour, else the theme's
 * text) reads at 4.5:1 — and never lost in the background itself (≥ 1.4:1, 3:1 under text that only allows that).
 */
export function ruleStyle(rule, palette) {
  const fg = resolveColor(rule.color, palette);
  let bg = null;
  const seed = rule.bg && (HEX.test(rule.bg) ? rule.bg.toLowerCase() : palette[rule.bg]);
  if (seed) {
    const text = fg || palette.fg;
    const tint = (min) => ensureContrast(mix(seed, palette.bg, palette.light ? 0.3 : 0.4), text, min, palette.bg);
    bg = tint(4.5);
    if (contrast(bg, palette.bg) < 1.4) bg = tint(3);
  }
  return { fg, bg, bold: !!rule.bold, underline: !!rule.underline };
}

// ---------- the pane side ----------
const ASCII = /^[\x20-\x7e]*$/;
const trimEnd = (s) => s.replace(/\s+$/, '');

/**
 * Highlights one xterm.js terminal. `configure({ enabled, rules, theme })` is the only input (it returns the invalid
 * rules); `reset()` drops every decoration; `dispose()` also unhooks. `stats` counts scanned rows and the time they
 * took, `count` is the number of live decorations.
 */
export class TermHighlighter {
  constructor(term) {
    this.term = term;
    this.enabled = false;
    this.compiled = [];
    this.styles = new Map(); // rule → ruleStyle()
    this.palette = null;
    this.rows = []; // { marker, text, decos, matches, dead } per row that carries decorations, in scan order
    this.deadRows = 0;
    this.count = 0;
    this.tail = null; // marker on the row the last scan ended on
    this.stats = { rows: 0, ms: 0, scans: 0 };
    this.failed = false;
    this.disposed = false;
    this._key = '';
    this._fontKey = '';
    this._cell = null;
    this._font = null; // { family, size, cols, spacing } for the bold overlay
    this._snap = null; // { base, y0, texts }: the screenful above the last scan, so a row rewritten in place is noticed (_verifyRecent)
    this._sub = term.onWriteParsed(() => this._onWriteParsed());
    // Full-screen apps (less, vim, htop) draw on the alternate buffer, but xterm places decorations by marker line
    // against whichever buffer is active: the normal buffer's would be painted onto the app's rows at the same
    // positions. So they all go when the alternate buffer comes up, and are rebuilt when the normal one is back.
    this._bufSub = term.buffer.onBufferChange(() => this._onBufferChange());
  }

  _onBufferChange() {
    if (this.disposed) return;
    try {
      if (this.term.buffer.active.type === 'alternate') this.reset();
      else this.rescan();
    } catch (e) {
      this._fail(e);
    }
  }

  /** Enable / rules / palette in one go; a call that changes nothing is free. Returns compileRules().invalid. */
  configure({ enabled, rules, theme }) {
    if (this.disposed) return [];
    const list = (Array.isArray(rules) && rules.length ? rules : DEFAULT_RULES).map(normalizeRule);
    const t = theme || {};
    const key = JSON.stringify([!!enabled, list, t.background, t.foreground, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan]);
    const { compiled, invalid } = compileRules(list);
    if (key === this._key) return invalid;
    this._key = key;
    this.enabled = !!enabled;
    this.compiled = compiled;
    this.palette = highlightPalette(t);
    this.styles = new Map(compiled.map((c) => [c.rule, ruleStyle(c.rule, this.palette)]));
    this.failed = false;
    this.rescan();
    return invalid;
  }

  /** The pane's font may have changed (settings, ⌘= / ⌘-): the bold overlays are measured and drawn again. */
  fontChanged() {
    const o = this.term.options;
    const key = `${o.fontFamily}|${o.fontSize}|${o.lineHeight}`;
    if (key === this._fontKey) return;
    this._fontKey = key;
    this._font = null;
    if (this.count) this.rescan();
  }

  /** Drop every decoration and marker (rule change, disabled, ⌘K, dispose). */
  reset() {
    for (const r of this.rows) this._dropRow(r);
    this.rows = [];
    this.deadRows = 0;
    this.count = 0;
    this._snap = null;
    if (this.tail) { this.tail.dispose(); this.tail = null; }
  }

  /** Start over: the bottom of the buffer (up to SCAN_CAP rows) and the rows on screen. */
  rescan() {
    this.reset();
    if (!this.enabled || !this.compiled.length || this.disposed) return;
    try {
      const buf = this.term.buffer.active;
      if (buf.type === 'alternate') return;
      const cursor = buf.baseY + buf.cursorY;
      const from = Math.max(0, cursor - SCAN_CAP);
      const vp = buf.viewportY;
      const old = new Map();
      this._scanRange(from, cursor, Infinity, old, MAX_DECORATIONS * 1.5);
      if (this.count > MAX_DECORATIONS) this._trim(); // before the screen is done: the trim takes the rows highest up, the screen may be there
      if (vp < from) this._scanRange(vp, Math.min(from - 1, vp + this.term.rows - 1), Infinity, old);
      this._setTail();
      this._snapshot(cursor);
    } catch (e) {
      this._fail(e);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this._sub.dispose(); } catch {}
    try { this._bufSub.dispose(); } catch {}
    this.reset();
  }

  _fail(e) {
    this.failed = true;
    this.enabled = false;
    console.error('keyword highlighting switched off for this terminal after an error', e);
    try { this.reset(); } catch {}
  }

  _setTail() {
    if (this.tail) this.tail.dispose();
    this.tail = this.term.registerMarker(0) || null;
  }

  /** The live records by row (built once per write event: a burst must not look them up per line). */
  _indexRows() {
    const old = new Map();
    for (const r of this.rows) if (!r.dead && !r.marker.isDisposed) old.set(r.marker.line, r);
    return old;
  }

  _onWriteParsed() {
    if (!this.enabled || !this.compiled.length || this.disposed) return;
    try {
      const buf = this.term.buffer.active;
      if (buf.type === 'alternate') return; // full-screen apps (vim, htop) repaint everywhere: nothing to scan
      const cursor = buf.baseY + buf.cursorY;
      let from = this.tail && !this.tail.isDisposed ? this.tail.line : cursor - SCAN_CAP;
      if (cursor - from > SCAN_CAP) from = cursor - SCAN_CAP;
      from = Math.max(0, Math.min(from, cursor));
      while (from > 0 && buf.getLine(from)?.isWrapped) from--; // the whole logical line, not its tail
      const old = this._indexRows();
      this._verifyRecent(Math.max(0, cursor - this.term.rows), from, old);
      this._scanRange(from, cursor, SCAN_BUDGET_MS, old);
      this._setTail();
      this._snapshot(cursor);
      if (this.count > MAX_DECORATIONS) this._trim();
      if (this.deadRows > 64 && this.deadRows > this.rows.length / 4) this._compact();
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * Rows above the scanned range within a screenful of the cursor: a progress bar, docker pull or apt moves the cursor
   * up and rewrites them. A row whose text differs from the last scan's snapshot (or, without one, from its own
   * record) is scanned again — a row that gained a keyword in place is highlighted, one that lost it is not any more.
   */
  _verifyRecent(lo, hi, old) {
    if (hi <= lo) return;
    const buf = this.term.buffer.active;
    const snap = this._snap;
    const shift = snap && this.tail && !this.tail.isDisposed ? this.tail.line - snap.base : 0; // the scrollback trimmed lines since: every row moved up
    const done = new Set();
    for (let y = lo; y < hi; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = trimEnd(line.translateToString(true));
      const i = snap ? y - (snap.y0 + shift) : -1;
      const known = snap && i >= 0 && i < snap.texts.length ? snap.texts[i] : (old.get(y) || {}).text;
      if (known === undefined || known === text) continue;
      let y0 = y;
      while (y0 > 0 && buf.getLine(y0)?.isWrapped) y0--;
      if (done.has(y0)) continue;
      done.add(y0);
      this._scanLogical(y0, old);
    }
  }

  /** Remember the text of the screenful that ends at the cursor (_verifyRecent); the tail marker anchors it against scrollback trimming. */
  _snapshot(cursor) {
    if (!this.tail || this.tail.isDisposed) { this._snap = null; return; }
    const buf = this.term.buffer.active;
    const y0 = Math.max(0, cursor - this.term.rows + 1);
    const texts = [];
    for (let y = y0; y <= cursor; y++) texts.push(trimEnd(buf.getLine(y)?.translateToString(true) || ''));
    this._snap = { base: this.tail.line, y0, texts };
  }

  /**
   * Scan the logical lines in rows from…to, newest first: the rows a burst leaves on screen are done first, and the
   * scan stops when the decoration cap is reached (the oldest rows of a flood would be trimmed anyway) or, in the data
   * path, when `budgetMs` is used up (the rest of the burst stays plain; the terminal stays responsive).
   */
  _scanRange(from, to, budgetMs, old, stopAt = Infinity) {
    const buf = this.term.buffer.active;
    const t0 = performance.now();
    let y = Math.min(to, buf.length - 1);
    while (y >= from && y >= 0) {
      let y0 = y;
      while (y0 > 0 && buf.getLine(y0)?.isWrapped) y0--; // the whole logical line
      this._scanLogical(y0, old);
      y = y0 - 1;
      if (this.count >= stopAt) break; // a rescan of a flood of matches: enough to fill the cap, newest rows first
      if (budgetMs !== Infinity && performance.now() - t0 > budgetMs) break;
    }
    this.stats.ms += performance.now() - t0;
    this.stats.scans++;
  }

  /** Scan the logical line that starts at row y0 (y0 and the rows wrapped onto it); returns its last row. */
  _scanLogical(y0, old) {
    const term = this.term, buf = term.buffer.active, cols = term.cols;
    let y1 = y0;
    while (y1 + 1 < buf.length && buf.getLine(y1 + 1)?.isWrapped) y1++;
    this.stats.rows += y1 - y0 + 1;
    const texts = [];
    let text = '';
    for (let y = y0; y <= y1; y++) {
      const line = buf.getLine(y);
      const s = line ? line.translateToString(y < y1 ? false : true) : '';
      texts.push(s);
      text += s;
    }
    const matches = text.length <= MAX_LINE_LENGTH ? highlightLine(text, this.compiled) : [];
    const perRow = new Map(); // row → [{ x, width, rule, text }]
    if (matches.length) {
      const place = ASCII.test(text) ? null : this._columnMap(y0, y1, text.length);
      for (const m of matches) {
        let first, last;
        if (place) {
          first = place[m.start];
          last = place[m.end - 1];
        } else {
          first = { row: y0 + Math.floor(m.start / cols), x: m.start % cols, w: 1 };
          last = { row: y0 + Math.floor((m.end - 1) / cols), x: (m.end - 1) % cols, w: 1 };
        }
        if (!first || !last) continue;
        for (let row = first.row; row <= last.row; row++) {
          const x0 = row === first.row ? first.x : 0;
          const x1 = row === last.row ? last.x + last.w : cols;
          if (x1 <= x0) continue;
          if (!perRow.has(row)) perRow.set(row, []);
          perRow.get(row).push({ x: x0, width: x1 - x0, rule: m.rule, text: first.row === last.row ? text.slice(m.start, m.end) : '' });
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      const want = perRow.get(y), had = old.get(y), rowText = trimEnd(texts[y - y0]);
      if (had && !had.dead && had.text === rowText && want) continue; // same text, same matches: keep what is there
      if (had) { this._dropRow(had); old.delete(y); }
      if (!want) continue;
      const marker = term.registerMarker(y - (buf.baseY + buf.cursorY));
      if (!marker || marker.isDisposed) continue;
      const rec = { marker, text: rowText, decos: [], matches: want, dead: false }; // matches: [{ x, width, rule, text }] (tests, debugging)
      // the row left the scrollback or the terminal was cleared: xterm disposed the decorations with the marker
      marker.onDispose(() => { if (!rec.dead) { rec.dead = true; this.deadRows++; this.count -= rec.decos.length; rec.decos = []; } });
      for (const d of want) this._decorate(rec, d);
      if (rec.decos.length) { this.rows.push(rec); old.set(y, rec); }
      else marker.dispose();
    }
    return y1;
  }

  /** String index → { row, x, w } for a logical line with wide (CJK) or combining characters. */
  _columnMap(y0, y1, len) {
    const buf = this.term.buffer.active;
    if (!this._cell) this._cell = buf.getNullCell();
    const map = [];
    for (let y = y0; y <= y1 && map.length < len; y++) {
      const line = buf.getLine(y);
      if (!line) break;
      for (let x = 0; x < line.length && map.length < len;) {
        const cell = line.getCell(x, this._cell);
        if (!cell) break;
        const w = cell.getWidth() || 1, chars = cell.getChars() || ' ';
        for (let i = 0; i < chars.length; i++) map.push({ row: y, x, w });
        x += w;
      }
    }
    return map;
  }

  _decorate(rec, { x, width, rule, text }) {
    const style = this.styles.get(rule);
    if (!style) return;
    const opts = { marker: rec.marker, x, width, layer: 'bottom' };
    if (style.fg) opts.foregroundColor = style.fg;
    if (style.bg) opts.backgroundColor = style.bg;
    const d = this.term.registerDecoration(opts);
    if (!d) return;
    this.count++;
    rec.decos.push(d);
    if (!style.bold && !style.underline) return; // a colour alone is painted by the renderer: no element work
    const fg = style.fg || this.palette.fg;
    const bold = style.bold && text && ASCII.test(text) ? text : '';
    d.onRender((el) => {
      if (el.dataset.kh) return;
      el.dataset.kh = '1';
      el.classList.add('kh');
      el.style.color = fg;
      el.style.setProperty('--kh-fg', fg);
      if (style.underline) el.classList.add('kh-ul');
      if (bold) {
        // bold is not a decoration property: the matched text is drawn again over the cells in the bold face
        const f = this._fontMetrics();
        el.classList.add('kh-bold');
        el.textContent = bold;
        el.style.fontFamily = f.family;
        el.style.fontSize = f.size + 'px';
        el.style.letterSpacing = f.spacing + 'px';
      }
    });
  }

  /** The bold overlay's letter-spacing: the cell width minus the bold face's advance (monospace bold is usually equal). */
  _fontMetrics() {
    const term = this.term;
    const family = term.options.fontFamily || 'monospace', size = term.options.fontSize || 13;
    if (this._font && this._font.family === family && this._font.size === size && this._font.cols === term.cols) return this._font;
    let spacing = 0;
    try {
      const screen = term.element && term.element.querySelector('.xterm-screen');
      const cell = screen ? screen.getBoundingClientRect().width / term.cols : 0;
      const ctx = (this._ctx = this._ctx || document.createElement('canvas').getContext('2d'));
      ctx.font = `bold ${size}px ${family}`;
      const advance = ctx.measureText('W').width;
      if (cell > 0 && advance > 0) spacing = Math.round((cell - advance) * 100) / 100;
    } catch {}
    return (this._font = { family, size, cols: term.cols, spacing });
  }

  _dropRow(r) {
    if (r.dead) return;
    r.dead = true;
    this.deadRows++;
    this.count -= r.decos.length;
    for (const d of r.decos) { try { d.dispose(); } catch {} }
    r.decos = [];
    try { r.marker.dispose(); } catch {}
  }

  /** Over the decoration cap: the rows highest up in the buffer (the oldest output) lose theirs. */
  _trim() {
    const target = MAX_DECORATIONS - Math.floor(MAX_DECORATIONS / 10);
    this._compact();
    this.rows.sort((a, b) => a.marker.line - b.marker.line);
    for (let i = 0; i < this.rows.length && this.count > target; i++) this._dropRow(this.rows[i]);
    this._compact();
  }

  _compact() {
    this.rows = this.rows.filter((r) => !r.dead && !r.marker.isDisposed);
    this.deadRows = 0;
  }
}
