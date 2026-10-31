// Paste guard: what a paste contains before it reaches a terminal. Pure (no DOM, no Electron) so that
// test/unit/pasteguard.test.js can run it under Node; terminal.js / app.js decide what to do with the result and
// dialogs.js draws it.
//
//   analysePaste(text) → { text, chars, lines, multiline, findings, cleaned, cleanable }
//   findings: [{ kind, message, index, length, count, line, ranges: [[index, length], …] }]  (one per distinct problem,
//             `index` the first occurrence, `ranges` every occurrence for highlighting)
//   cleaned:  the text without its invisible / control characters and trailing line break (what "Paste cleaned" sends)
//
//   pasteGuardMode(analysis, settings) → { confirm, warn, ask }  the two Settings → Features toggles applied

import { t, tn } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()
/** A paste longer than this many characters asks for confirmation even on one line. */
export const PASTE_CONFIRM_CHARS = 1000;

// The label of each finding kind (the list in the paste guard dialog). A table of strings built at module load would
// be frozen in the language of that moment, so each entry is looked up when it is read: kindLabel(kind), or the
// KIND_LABEL object dialogs.js indexes, whose property reads call t() at access time.
const KIND_SRC = {
  invisible: () => t('Invisible character'),
  control: () => t('Control character'),
  'trailing-newline': () => t('Trailing newline'),
  cr: () => t('Carriage return'),
  'pipe-to-shell': () => t('Pipe to shell'),
  'profile-write': () => t('Profile write'),
  destructive: () => t('Destructive command'),
  homoglyph: () => t('Look-alike letters'),
};
/** The label of a finding kind in the current language; undefined for an unknown kind. */
export const kindLabel = (kind) => (Object.prototype.hasOwnProperty.call(KIND_SRC, kind) ? KIND_SRC[kind]() : undefined);
/** KIND_LABEL[kind] === kindLabel(kind): the same labels as an object (every read is translated at that moment). */
export const KIND_LABEL = new Proxy(KIND_SRC, { get: (src, kind) => (typeof kind === 'string' ? kindLabel(kind) : undefined) });

/** Kinds that mean "this is probably an attack or a disaster", not "this may not be what you see". */
export const DANGER_KINDS = new Set(['pipe-to-shell', 'profile-write', 'destructive']);

// Characters that take no space on screen but reach the shell: zero-width spaces/joiners, bidi marks, embeddings,
// overrides and isolates (Trojan Source), word joiner and the invisible operators, BOM, soft hyphen, the Mongolian
// vowel separator, variation selectors and tag characters (invisible text) — and the no-break spaces, which look like
// a space but are not one to the shell ("ls -d" from a web page becomes a command called "ls -d").
const INVISIBLE_RE = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\u00A0\u202F\u180E\uFE00-\uFE0F\u{E0000}-\u{E007F}]/gu;
const SPACE_LOOKALIKE_RE = /[\u00A0\u202F]/g; // cleaned: a real space, not nothing
// C0 controls other than \t \n \r, DEL and the C1 range: keys and escape sequences, not text.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;
const LINE_BREAK_RE = /\r\n|\r|\n/g;

// the names are shown in the findings list, so each is looked up (translated) when a finding is built, not at module load
const INVISIBLE_NAMES = {
  0x200b: () => t('zero-width space'), 0x200c: () => t('zero-width non-joiner'), 0x200d: () => t('zero-width joiner'),
  0x200e: () => t('left-to-right mark'), 0x200f: () => t('right-to-left mark'), 0x2028: () => t('line separator'), 0x2029: () => t('paragraph separator'),
  0x202a: () => t('left-to-right embedding'), 0x202b: () => t('right-to-left embedding'), 0x202c: () => t('pop directional formatting'),
  0x202d: () => t('left-to-right override'), 0x202e: () => t('right-to-left override'),
  0x2060: () => t('word joiner'), 0x2061: () => t('function application'), 0x2062: () => t('invisible times'), 0x2063: () => t('invisible separator'), 0x2064: () => t('invisible plus'),
  0x2066: () => t('left-to-right isolate'), 0x2067: () => t('right-to-left isolate'), 0x2068: () => t('first strong isolate'), 0x2069: () => t('pop directional isolate'),
  0xfeff: () => t('byte order mark'), 0xad: () => t('soft hyphen'), 0xa0: () => t('no-break space'), 0x202f: () => t('narrow no-break space'), 0x180e: () => t('Mongolian vowel separator'),
};
const invisibleName = (code) => (INVISIBLE_NAMES[code] ? INVISIBLE_NAMES[code]() : code >= 0xfe00 && code <= 0xfe0f ? t('variation selector') : code >= 0xe0000 && code <= 0xe007f ? t('tag character') : t('invisible character'));
const BIDI_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const CONTROL_NAMES = {
  0: 'NUL', 1: 'SOH', 2: 'STX', 3: 'ETX (^C)', 4: 'EOT (^D)', 5: 'ENQ', 6: 'ACK', 7: 'BEL', 8: 'BS', 11: 'VT', 12: 'FF',
  14: 'SO', 15: 'SI', 16: 'DLE', 17: 'DC1', 18: 'DC2', 19: 'DC3', 20: 'DC4', 21: 'NAK', 22: 'SYN', 23: 'ETB', 24: 'CAN',
  25: 'EM', 26: 'SUB (^Z)', 27: 'ESC', 28: 'FS', 29: 'GS', 30: 'RS', 31: 'US', 127: 'DEL', 0x9b: 'CSI',
};

const SHELLS = '(?:ba|z|k|da|fi|c|tc|)sh|python3?|perl|ruby|node';
const FETCH = '(?:curl|wget|fetch)';
// `message` is a function: the text is translated when the finding is built (a string here would be frozen at module load)
const PIPE_TO_SHELL = [
  { re: new RegExp(`\\b${FETCH}\\b[^|\\n]*\\|\\s*(?:sudo\\s+(?:-\\S+\\s+)*)?(?:${SHELLS})\\b`, 'i'), message: () => t('pipes a download straight into a shell (curl … | sh): the script runs without being seen') },
  { re: new RegExp(`\\b(?:${SHELLS})\\s+(?:-\\S+\\s+)*-c\\s+["']?\\$\\(\\s*${FETCH}\\b`, 'i'), message: () => t('runs a download through sh -c "$(curl …)": the script runs without being seen') },
  { re: new RegExp(`\\beval\\s+["']?\\$\\(\\s*${FETCH}\\b`, 'i'), message: () => t('evaluates a download (eval "$(curl …)"): the script runs without being seen') },
  { re: new RegExp(`\\b(?:${SHELLS})\\s+(?:-\\S+\\s+)*<\\(\\s*${FETCH}\\b`, 'i'), message: () => t('runs a download through process substitution (sh <(curl …)): the script runs without being seen') },
];
const PROFILE_FILES = 'bashrc|bash_profile|bash_login|bash_logout|profile|zshrc|zprofile|zshenv|zlogin|zlogout|ssh\\/authorized_keys|ssh\\/config|ssh\\/rc';
const PROFILE_WRITE = new RegExp(`(?:>>?|\\btee\\b(?:\\s+-\\w+)*)\\s*["']?(?:~|\\$HOME|\\$\\{HOME\\}|\\/home\\/[\\w.-]+|\\/Users\\/[\\w.-]+|\\/root)?\\/?\\.(${PROFILE_FILES})(?![\\w.-])`, 'g'); // the exact file: .zshrc.bak is not the profile
const DEVICE = '\\/dev\\/(?:r?disk|sd|hd|nvme|mmcblk|vd|xvd)\\w*';
const DESTRUCTIVE = [
  // rm with a recursive flag somewhere in its options and the root, the home folder (with or without a trailing slash) or a bare * as the first target
  { re: /\brm\s+(?=(?:-\S+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s)(?:-\S+\s+)+["']?(?:\/|~\/?|\$HOME\/?|\$\{HOME\}\/?|\/\*|~\/\*|\*)["']?(?=\s|$|[;&|)])/m, message: () => t('rm -rf on the root, the home folder or everything in the current folder') },
  { re: new RegExp(`\\bdd\\b[^\\n|;]*\\bof=${DEVICE}`), message: () => t('dd writes raw data over a disk device') },
  { re: new RegExp(`>\\s*${DEVICE}`), message: () => t('overwrites a disk device') },
  { re: /\b(?:mkfs(?:\.\w+)?|mke2fs|newfs)\b|\bdiskutil\s+(?:erase\w*|reformat|partition\w*)\b/, message: () => t('formats a disk') },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, message: () => t('fork bomb: exhausts the machine') },
  { re: /\bchmod\s+(?:-\w+\s+)*(?:[0-7]{3,4}|[ugoa]*[+=-][rwxst]+)\s+["']?\/["']?(?=\s|$|[;&|)])/m, message: () => t('chmod on /: breaks the system') },
];
const WORD_RE = /[\p{L}\p{M}\p{N}_]+/gu;
const LATIN_RE = /[A-Za-z]/;
const CONFUSABLE_RE = /[\u0400-\u04FF\u0370-\u03FF]/;
// "200μs", "μm", "5μA": the Greek mu as the micro prefix of a short Latin unit is what tools print, not a spoofed name
const MICRO_UNIT_RE = /^\d*(?:[.,]\d+)?μ[A-Za-z]{1,3}$/;

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

  // a character finding reads "U+200B zero-width space ×2: <why>": the code point, its name, how often, the explanation
  const charMessage = (what, why, n) => tn('{what}: {why}', '{what} ×{n}: {why}', n, { what, why });
  for (const g of grouped(text, INVISIBLE_RE, (m) => m[0])) {
    const code = g.key.codePointAt(0);
    const bidi = BIDI_RE.test(g.key);
    const what = `${hex(code)} ${invisibleName(code)}`;
    const why = bidi ? t('a bidi control: the text can read in another order than it runs (Trojan Source)')
      : SPACE_LOOKALIKE_RE.test(g.key) ? t('looks like a space but is not one to the shell: it becomes part of the word')
      : t('takes no space on screen but is sent to the shell');
    findings.push(finding(text, 'invisible', charMessage(what, why, g.ranges.length), g.ranges, { char: g.key }));
  }
  for (const g of grouped(text, CONTROL_RE, (m) => m[0])) {
    const code = g.key.charCodeAt(0);
    const what = CONTROL_NAMES[code] ? `${hex(code)} ${CONTROL_NAMES[code]}` : hex(code);
    findings.push(finding(text, 'control', charMessage(what, t('a key or escape sequence, not text; the terminal would act on it'), g.ranges.length), g.ranges, { char: g.key }));
  }
  if (endsWithBreak) {
    const m = text.match(/(?:\r\n|\r|\n)+$/);
    findings.push(finding(text, 'trailing-newline', t('ends with a newline: the last line runs at once on a prompt without bracketed paste'), [[m.index, m[0].length]]));
  }
  {
    const ranges = [];
    for (let i = 0; i < text.length - 1; i++) if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) ranges.push([i, 1]);
    if (ranges.length) findings.push(finding(text, 'cr', tn('a carriage return inside a line: the terminal presses Enter there, so what runs is not what you see', 'a carriage return inside a line ×{n}: the terminal presses Enter there, so what runs is not what you see', ranges.length), ranges));
  }
  for (const { re, message } of PIPE_TO_SHELL) {
    const ranges = lineMatches(text, re).map(([i, l]) => [i, l]);
    if (ranges.length) findings.push(finding(text, 'pipe-to-shell', message(), ranges));
  }
  for (const g of grouped(text, PROFILE_WRITE, (m) => m[1])) {
    const file = g.key.replace('\\/', '/');
    const ssh = file.startsWith('ssh/');
    findings.push(finding(text, 'profile-write', ssh ? t('writes to ~/.{file}: that grants or changes SSH access to this account', { file }) : t('writes to ~/.{file}: a shell profile runs at every new shell', { file }), g.ranges, { file }));
  }
  for (const { re, message } of DESTRUCTIVE) {
    const hits = lineMatches(text, re);
    if (!hits.length) continue;
    const sudo = hits.some(([, , line]) => /\bsudo\b/.test(line));
    const what = message();
    findings.push(finding(text, 'destructive', sudo ? t('{what} (with sudo)', { what }) : what, hits.map(([i, l]) => [i, l])));
  }
  for (const g of grouped(text, WORD_RE, (m) => m[0]).filter((g) => LATIN_RE.test(g.key) && CONFUSABLE_RE.test(g.key) && !MICRO_UNIT_RE.test(g.key))) {
    const odd = [...g.key].filter((c) => CONFUSABLE_RE.test(c)).map((c) => `${c} (${hex(c.codePointAt(0))})`);
    const script = /[\u0400-\u04FF]/.test(g.key) ? (/[\u0370-\u03FF]/.test(g.key) ? t('Cyrillic and Greek') : t('Cyrillic')) : t('Greek');
    const params = { word: g.key, script, letters: [...new Set(odd)].join(', ') };
    const message = odd.length > 1
      ? t('"{word}" mixes {script} letters {letters} into a Latin word: it is not the name it looks like', params)
      : t('"{word}" mixes {script} letter {letters} into a Latin word: it is not the name it looks like', params);
    findings.push(finding(text, 'homoglyph', message, g.ranges, { word: g.key }));
  }
  findings.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));

  const cleaned = text.replace(SPACE_LOOKALIKE_RE, ' ').replace(INVISIBLE_RE, '').replace(CONTROL_RE, '').replace(/(?:\r\n|\r|\n)+$/, '');
  return { text, chars: text.length, lines, multiline, findings, cleaned, cleanable: cleaned !== text };
}

/**
 * What the guard should do with an analysed paste under the Settings → Features toggles (both on by default):
 * `confirm` — the multi-line / long-paste confirmation; `warn` — the suspicious-content findings are shown and
 * "Paste cleaned" offered; `ask` — a dialog is needed at all.
 */
export function pasteGuardMode(analysis, settings = {}) {
  const warn = settings.pasteWarnSuspicious !== false && analysis.findings.length > 0;
  const confirm = settings.pasteConfirmMultiline !== false && (analysis.multiline || analysis.chars > PASTE_CONFIRM_CHARS);
  return { confirm, warn, ask: confirm || warn };
}
