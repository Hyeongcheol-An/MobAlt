// Paste guard: what a paste contains before it reaches a terminal. Pure (no DOM, no Electron) so that
// test/unit/pasteguard.test.js can run it under Node; terminal.js / app.js decide what to do with the result and
// dialogs.js draws it.
//
//   analysePaste(text) → { text, chars, lines, multiline, findings, cleaned, cleanable }
//   findings: [{ kind, message, index, length, count, line, ranges: [[index, length], …] }]  (one per distinct problem,
//             `index` the first occurrence, `ranges` every occurrence for highlighting)
//   cleaned:  the text without its invisible / control characters and trailing line break (what "Paste cleaned" sends)
//
//   pasteGuardMode(analysis, settings) → { confirm, warn, ask }  the two Settings → Terminal toggles applied

/** A paste longer than this many characters asks for confirmation even on one line. */
export const PASTE_CONFIRM_CHARS = 1000;

export const KIND_LABEL = {
  invisible: 'Invisible character',
  control: 'Control character',
  'trailing-newline': 'Trailing newline',
  cr: 'Carriage return',
  'pipe-to-shell': 'Pipe to shell',
  'profile-write': 'Profile write',
  destructive: 'Destructive command',
  homoglyph: 'Look-alike letters',
};

/** Kinds that mean "this is probably an attack or a disaster", not "this may not be what you see". */
export const DANGER_KINDS = new Set(['pipe-to-shell', 'profile-write', 'destructive']);

// Characters that take no space on screen but reach the shell: zero-width spaces/joiners, bidi marks, embeddings,
// overrides and isolates (Trojan Source), word joiner and the invisible operators, BOM, soft hyphen.
const INVISIBLE_RE = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g;
// C0 controls other than \t \n \r, DEL and the C1 range: keys and escape sequences, not text.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;
const LINE_BREAK_RE = /\r\n|\r|\n/g;

const INVISIBLE_NAMES = {
  0x200b: 'zero-width space', 0x200c: 'zero-width non-joiner', 0x200d: 'zero-width joiner',
  0x200e: 'left-to-right mark', 0x200f: 'right-to-left mark', 0x2028: 'line separator', 0x2029: 'paragraph separator',
  0x202a: 'left-to-right embedding', 0x202b: 'right-to-left embedding', 0x202c: 'pop directional formatting',
  0x202d: 'left-to-right override', 0x202e: 'right-to-left override',
  0x2060: 'word joiner', 0x2061: 'function application', 0x2062: 'invisible times', 0x2063: 'invisible separator', 0x2064: 'invisible plus',
  0x2066: 'left-to-right isolate', 0x2067: 'right-to-left isolate', 0x2068: 'first strong isolate', 0x2069: 'pop directional isolate',
  0xfeff: 'byte order mark', 0xad: 'soft hyphen',
};
const BIDI_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const CONTROL_NAMES = {
  0: 'NUL', 1: 'SOH', 2: 'STX', 3: 'ETX (^C)', 4: 'EOT (^D)', 5: 'ENQ', 6: 'ACK', 7: 'BEL', 8: 'BS', 11: 'VT', 12: 'FF',
  14: 'SO', 15: 'SI', 16: 'DLE', 17: 'DC1', 18: 'DC2', 19: 'DC3', 20: 'DC4', 21: 'NAK', 22: 'SYN', 23: 'ETB', 24: 'CAN',
  25: 'EM', 26: 'SUB (^Z)', 27: 'ESC', 28: 'FS', 29: 'GS', 30: 'RS', 31: 'US', 127: 'DEL', 0x9b: 'CSI',
};

const SHELLS = '(?:ba|z|k|da|fi|c|tc|)sh|python3?|perl|ruby|node';
const FETCH = '(?:curl|wget|fetch)';
const PIPE_TO_SHELL = [
  { re: new RegExp(`\\b${FETCH}\\b[^|\\n]*\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:${SHELLS})\\b`, 'i'), message: 'pipes a download straight into a shell (curl … | sh): the script runs without being seen' },
  { re: new RegExp(`\\b(?:${SHELLS})\\s+(?:-\\S+\\s+)*-c\\s+["']?\\$\\(\\s*${FETCH}\\b`, 'i'), message: 'runs a download through sh -c "$(curl …)": the script runs without being seen' },
  { re: new RegExp(`\\beval\\s+["']?\\$\\(\\s*${FETCH}\\b`, 'i'), message: 'evaluates a download (eval "$(curl …)"): the script runs without being seen' },
  { re: new RegExp(`\\b(?:${SHELLS})\\s+(?:-\\S+\\s+)*<\\(\\s*${FETCH}\\b`, 'i'), message: 'runs a download through process substitution (sh <(curl …)): the script runs without being seen' },
];
const PROFILE_FILES = 'bashrc|bash_profile|bash_login|bash_logout|profile|zshrc|zprofile|zshenv|zlogin|zlogout|ssh\\/authorized_keys|ssh\\/config|ssh\\/rc';
const PROFILE_WRITE = new RegExp(`(?:>>?|\\btee\\b(?:\\s+-\\w+)*)\\s*["']?(?:~|\\$HOME|\\$\\{HOME\\}|\\/home\\/[\\w.-]+|\\/Users\\/[\\w.-]+|\\/root)?\\/?\\.(${PROFILE_FILES})\\b`, 'g');
const DEVICE = '\\/dev\\/(?:r?disk|sd|hd|nvme|mmcblk|vd|xvd)\\w*';
const DESTRUCTIVE = [
  // rm with a recursive flag somewhere in its options and the root, the home folder or a bare * as the first target
  { re: /\brm\s+(?=(?:-\S+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s)(?:-\S+\s+)+["']?(?:\/|~|\$HOME|\$\{HOME\}|\/\*|~\/\*|\*)["']?(?=\s|$|[;&|)])/m, message: 'rm -rf on the root, the home folder or everything in the current folder' },
  { re: new RegExp(`\\bdd\\b[^\\n|;]*\\bof=${DEVICE}`), message: 'dd writes raw data over a disk device' },
  { re: new RegExp(`>\\s*${DEVICE}`), message: 'overwrites a disk device' },
  { re: /\b(?:mkfs(?:\.\w+)?|mke2fs|newfs)\b|\bdiskutil\s+(?:erase\w*|reformat|partition\w*)\b/, message: 'formats a disk' },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, message: 'fork bomb: exhausts the machine' },
  { re: /\bchmod\s+(?:-\w+\s+)*(?:[0-7]{3,4}|[ugoa]*[+=-][rwxst]+)\s+["']?\/["']?(?=\s|$|[;&|)])/m, message: 'chmod on /: breaks the system' },
];
const WORD_RE = /[\p{L}\p{M}\p{N}_]+/gu;
const LATIN_RE = /[A-Za-z]/;
const CONFUSABLE_RE = /[\u0400-\u04FF\u0370-\u03FF]/;

const hex = (code) => 'U+' + code.toString(16).toUpperCase().padStart(4, '0');

/** 1-based line of an offset. */
function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) n++;
    else if (c === 13) { n++; if (text.charCodeAt(i + 1) === 10) i++; }
  }
  return n;
}

/** Groups every match of `re` (global) by `keyOf(match)` into one finding per key, with every occurrence in `ranges`. */
function grouped(text, re, keyOf) {
  const map = new Map();
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) {
    const k = keyOf(m);
    let g = map.get(k);
    if (!g) map.set(k, (g = { key: k, match: m, ranges: [] }));
    g.ranges.push([m.index, m[0].length]);
    if (!m[0].length) re.lastIndex++;
  }
  return [...map.values()];
}

function finding(text, kind, message, ranges, extra = {}) {
  const [index, length] = ranges[0];
  return { kind, message, index, length, count: ranges.length, line: lineOf(text, index), ranges, ...extra };
}

/** [index, length] of every match of `re` on each line, with CRLF-exact offsets. */
function lineMatches(text, re) {
  const out = [];
  LINE_BREAK_RE.lastIndex = 0;
  let start = 0;
  const lines = [];
  for (let m; (m = LINE_BREAK_RE.exec(text));) { lines.push([start, m.index]); start = m.index + m[0].length; }
  lines.push([start, text.length]);
  for (const [a, b] of lines) {
    const line = text.slice(a, b);
    const m = line.match(re);
    if (m) out.push([a + m.index, m[0].length, line]);
  }
  return out;
}

/**
 * Looks at a paste and reports what a reader of the clipboard would not see: characters that take no space, keys and
 * escape sequences, a newline at the end (the last line would run at once), a lone carriage return (the terminal
 * presses Enter there), download-into-shell one-liners, writes to shell profiles and SSH keys, rm -rf / and friends,
 * and Latin words with Cyrillic or Greek look-alike letters in them.
 */
export function analysePaste(input) {
  const text = String(input ?? '');
  const findings = [];
  const breaks = (text.match(LINE_BREAK_RE) || []).length;
  const endsWithBreak = /[\r\n]$/.test(text);
  const lines = text === '' ? 0 : breaks + (endsWithBreak ? 0 : 1);
  const multiline = breaks > 0;

  for (const g of grouped(text, INVISIBLE_RE, (m) => m[0])) {
    const code = g.key.codePointAt(0);
    const bidi = BIDI_RE.test(g.key);
    const what = `${hex(code)} ${INVISIBLE_NAMES[code] || 'invisible character'}`;
    const why = bidi ? 'a bidi control: the text can read in another order than it runs (Trojan Source)' : 'takes no space on screen but is sent to the shell';
    findings.push(finding(text, 'invisible', `${what}${g.ranges.length > 1 ? ` ×${g.ranges.length}` : ''}: ${why}`, g.ranges, { char: g.key }));
  }
  for (const g of grouped(text, CONTROL_RE, (m) => m[0])) {
    const code = g.key.charCodeAt(0);
    const name = CONTROL_NAMES[code] ? ` ${CONTROL_NAMES[code]}` : '';
    findings.push(finding(text, 'control', `${hex(code)}${name}${g.ranges.length > 1 ? ` ×${g.ranges.length}` : ''}: a key or escape sequence, not text; the terminal would act on it`, g.ranges, { char: g.key }));
  }
  if (endsWithBreak) {
    const m = text.match(/(?:\r\n|\r|\n)+$/);
    findings.push(finding(text, 'trailing-newline', 'ends with a newline: the last line runs at once on a prompt without bracketed paste', [[m.index, m[0].length]]));
  }
  {
    const ranges = [];
    for (let i = 0; i < text.length - 1; i++) if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) ranges.push([i, 1]);
    if (ranges.length) findings.push(finding(text, 'cr', `a carriage return inside a line${ranges.length > 1 ? ` ×${ranges.length}` : ''}: the terminal presses Enter there, so what runs is not what you see`, ranges));
  }
  for (const { re, message } of PIPE_TO_SHELL) {
    const ranges = lineMatches(text, re).map(([i, l]) => [i, l]);
    if (ranges.length) findings.push(finding(text, 'pipe-to-shell', message, ranges));
  }
  for (const g of grouped(text, PROFILE_WRITE, (m) => m[1])) {
    const file = g.key.replace('\\/', '/');
    const ssh = file.startsWith('ssh/');
    findings.push(finding(text, 'profile-write', ssh ? `writes to ~/.${file}: that grants or changes SSH access to this account` : `writes to ~/.${file}: a shell profile runs at every new shell`, g.ranges, { file }));
  }
  for (const { re, message } of DESTRUCTIVE) {
    const hits = lineMatches(text, re);
    if (!hits.length) continue;
    const sudo = hits.some(([, , line]) => /\bsudo\b/.test(line));
    findings.push(finding(text, 'destructive', `${message}${sudo ? ' (with sudo)' : ''}`, hits.map(([i, l]) => [i, l])));
  }
  for (const g of grouped(text, WORD_RE, (m) => m[0]).filter((g) => LATIN_RE.test(g.key) && CONFUSABLE_RE.test(g.key))) {
    const odd = [...g.key].filter((c) => CONFUSABLE_RE.test(c)).map((c) => `${c} (${hex(c.codePointAt(0))})`);
    const script = /[\u0400-\u04FF]/.test(g.key) ? (/[\u0370-\u03FF]/.test(g.key) ? 'Cyrillic and Greek' : 'Cyrillic') : 'Greek';
    findings.push(finding(text, 'homoglyph', `"${g.key}" mixes ${script} ${odd.length > 1 ? 'letters' : 'letter'} ${[...new Set(odd)].join(', ')} into a Latin word: it is not the name it looks like`, g.ranges, { word: g.key }));
  }
  findings.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));

  const cleaned = text.replace(INVISIBLE_RE, '').replace(CONTROL_RE, '').replace(/(?:\r\n|\r|\n)+$/, '');
  return { text, chars: text.length, lines, multiline, findings, cleaned, cleanable: cleaned !== text };
}

/**
 * What the guard should do with an analysed paste under the Settings → Terminal toggles (both on by default):
 * `confirm` — the multi-line / long-paste confirmation; `warn` — the suspicious-content findings are shown and
 * "Paste cleaned" offered; `ask` — a dialog is needed at all.
 */
export function pasteGuardMode(analysis, settings = {}) {
  const warn = settings.pasteWarnSuspicious !== false && analysis.findings.length > 0;
  const confirm = settings.pasteConfirmMultiline !== false && (analysis.multiline || analysis.chars > PASTE_CONFIRM_CHARS);
  return { confirm, warn, ask: confirm || warn };
}
