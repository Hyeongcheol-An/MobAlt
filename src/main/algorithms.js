'use strict';
// Expert SSH algorithm settings: the lists ssh2 negotiates with (key exchange, host key, cipher, MAC), the
// "Legacy algorithms" preset, the per-session override stored as `algorithms: { kex, serverHostKey, cipher, hmac }`,
// and the readable explanation of a handshake that found nothing in common with the server.
// Pure functions over ssh2's own tables (lib/protocol/constants.js), so a unit test needs no connection.
const crypto = require('crypto');
const C = require('ssh2/lib/protocol/constants');

const CATEGORIES = ['kex', 'serverHostKey', 'cipher', 'hmac'];
const LABELS = { kex: 'key exchange', serverHostKey: 'host key', cipher: 'cipher', hmac: 'MAC' };

// ssh2 lists every Diffie-Hellman group it knows, but the group itself comes from Node's OpenSSL, which no longer has
// the 1024-bit one (Node 24 dropped modp1 / modp2): negotiating diffie-hellman-group1-sha1 then fails with a raw
// "Unknown DH group" after the KEXINIT. Each group is probed once at load, and a missing one is left out of every
// table below (the supported names, the legacy preset, a stored list), so it is never offered.
const DH_GROUPS = {
  'diffie-hellman-group1-sha1': 'modp2',
  'diffie-hellman-group14-sha1': 'modp14',
  'diffie-hellman-group14-sha256': 'modp14',
  'diffie-hellman-group15-sha512': 'modp15',
  'diffie-hellman-group16-sha512': 'modp16',
  'diffie-hellman-group17-sha512': 'modp17',
  'diffie-hellman-group18-sha512': 'modp18',
};
const dhAvailable = (name) => {
  const group = DH_GROUPS[name];
  if (!group) return true;
  try { crypto.getDiffieHellman(group); return true; } catch { return false; }
};
/** Algorithms ssh2 names but this build's crypto cannot run (today: the 1024-bit DH group). */
const UNAVAILABLE = Object.freeze({
  kex: Object.freeze(Object.keys(DH_GROUPS).filter((n) => !dhAvailable(n))),
  serverHostKey: Object.freeze([]),
  cipher: Object.freeze([]),
  hmac: Object.freeze([]),
});
const usable = (cat, list) => list.filter((a) => !UNAVAILABLE[cat].includes(a));

const DEFAULTS = Object.freeze({
  kex: Object.freeze(usable('kex', [...C.DEFAULT_KEX])),
  serverHostKey: Object.freeze([...C.DEFAULT_SERVER_HOST_KEY]),
  cipher: Object.freeze([...C.DEFAULT_CIPHER]),
  hmac: Object.freeze([...C.DEFAULT_MAC]),
});
const SUPPORTED = Object.freeze({
  kex: Object.freeze(usable('kex', [...C.SUPPORTED_KEX])),
  serverHostKey: Object.freeze([...C.SUPPORTED_SERVER_HOST_KEY]),
  cipher: Object.freeze([...C.SUPPORTED_CIPHER]),
  hmac: Object.freeze([...C.SUPPORTED_MAC]),
});
// What "Legacy algorithms (old devices)" adds after the defaults: SHA-1 key exchanges, DSA host keys, CBC ciphers.
// The 2048-bit group comes first: a device offering both groups then takes the one every build can do.
const LEGACY = Object.freeze({
  kex: Object.freeze(usable('kex', ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'])),
  serverHostKey: Object.freeze(['ssh-rsa', 'ssh-dss']),
  cipher: Object.freeze(['aes128-cbc', 'aes256-cbc', '3des-cbc']),
  hmac: Object.freeze([]),
});

const uniq = (list) => [...new Set(list)];

/** "a, b\nc" → ['a', 'b', 'c']: comma, whitespace or newline separated, trimmed, duplicates dropped. */
function parseList(text) {
  return uniq(String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean));
}

/** The lists the editor shows before any edit: the defaults, plus the legacy additions when that preset is on. */
function presetLists(legacy) {
  const out = {};
  for (const cat of CATEGORIES) out[cat] = legacy ? uniq([...DEFAULTS[cat], ...LEGACY[cat]]) : [...DEFAULTS[cat]];
  return out;
}

/** The one-line note on an algorithm this build lacks (the renderer shows the same wording). */
function unavailableMessage(cat, names) {
  return `Not available in this build: ${names.join(', ')} (1024-bit Diffie-Hellman was removed from its crypto)`;
}

/**
 * Check four lists (strings or arrays) against ssh2's supported tables. Returns { value, errors }: `value` holds the
 * parsed list per category (an empty one means "the defaults"), `errors` one readable line per category that names
 * an algorithm this ssh2 cannot do ("Unknown cipher: aes128-foo"; a name this build lacks gets its own line).
 * Nothing with an error should be saved.
 */
function validate(lists) {
  const value = {}, errors = {};
  for (const cat of CATEGORIES) {
    const raw = lists && lists[cat];
    const list = Array.isArray(raw) ? uniq(raw.map((s) => String(s).trim()).filter(Boolean)) : parseList(raw);
    const unknown = list.filter((a) => !SUPPORTED[cat].includes(a) && !UNAVAILABLE[cat].includes(a));
    const missing = list.filter((a) => UNAVAILABLE[cat].includes(a));
    if (unknown.length) errors[cat] = `Unknown ${LABELS[cat]} algorithm${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`;
    else if (missing.length) errors[cat] = unavailableMessage(cat, missing);
    value[cat] = list;
  }
  return { value, errors, ok: !Object.keys(errors).length };
}

/**
 * What to store on the session: only the categories whose list differs from what the legacy preset already implies
 * (an empty list means "the defaults" too). Returns undefined when nothing differs, so the session carries no
 * `algorithms` key at all.
 */
function normalize(lists, legacy) {
  const preset = presetLists(legacy);
  const out = {};
  for (const cat of CATEGORIES) {
    const raw = lists && lists[cat];
    const list = Array.isArray(raw) ? uniq(raw.map((s) => String(s).trim()).filter(Boolean)) : parseList(raw);
    if (list.length && list.join('\n') !== preset[cat].join('\n')) out[cat] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * ssh2's `algorithms` connect option for a session: an explicit list wins for its category; otherwise the legacy
 * preset appends its algorithms to ssh2's defaults; a session with neither gets undefined (ssh2's defaults). A name
 * this build cannot run is dropped from a stored list (a session saved by an older build may still carry it).
 */
function connectOption(cfg) {
  if (!cfg) return undefined;
  const explicit = cfg.algorithms && typeof cfg.algorithms === 'object' ? cfg.algorithms : null;
  const out = {};
  for (const cat of CATEGORIES) {
    const list = explicit && explicit[cat];
    const own = Array.isArray(list) ? usable(cat, uniq(list.map(String))) : [];
    if (own.length) out[cat] = own;
    else if (cfg.legacyAlgorithms && LEGACY[cat].length) out[cat] = { append: [...LEGACY[cat]] };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The list a session offers for a category (what ssh2 will put in its KEXINIT). */
function offered(cfg, cat) {
  const opt = connectOption(cfg);
  const v = opt && opt[cat];
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.append)) return uniq([...DEFAULTS[cat], ...v.append]);
  return [...DEFAULTS[cat]];
}

// ssh2's debug lines during the handshake: "Handshake: (remote) KEX method: a,b,c" and friends.
const REMOTE_LINE = /^Handshake: \(remote\) (KEX method|Host key format|C->S cipher|S->C cipher|C->S MAC|S->C MAC): (.*)$/;
const REMOTE_CAT = { 'KEX method': 'kex', 'Host key format': 'serverHostKey', 'C->S cipher': 'cipher', 'S->C cipher': 'cipher', 'C->S MAC': 'hmac', 'S->C MAC': 'hmac' };
// KEXINIT markers that are not algorithms (RFC 8308 ext-info, strict KEX): never "what the server offers"
const KEX_MARKER = /^(ext-info-[cs]|kex-strict-[cs]-v00@openssh\.com)$/;
/** Feed one ssh2 debug line; returns the accumulated { cat: [server's list] } (the same object, or a new one). */
function noteRemote(acc, line) {
  const m = REMOTE_LINE.exec(String(line || ''));
  if (!m) return acc;
  const out = acc || {};
  if (!out[REMOTE_CAT[m[1]]]) out[REMOTE_CAT[m[1]]] = parseList(m[2]).filter((a) => !KEX_MARKER.test(a));
  return out;
}

const MISMATCH = /^Handshake failed: no matching (key exchange algorithm|host key format|(?:C->S|S->C) cipher|(?:C->S|S->C) MAC)/;
/**
 * Turn ssh2's "Handshake failed: no matching …" into what to do about it: which side offered what, and where the
 * knob is. `remote` is what noteRemote collected from the server's KEXINIT (may be missing). Returns null for any
 * other message.
 */
function explainHandshake(message, cfg, remote) {
  const m = MISMATCH.exec(String(message || ''));
  if (!m) return null;
  const cat = /key exchange/.test(m[1]) ? 'kex' : /host key/.test(m[1]) ? 'serverHostKey' : /cipher/.test(m[1]) ? 'cipher' : 'hmac';
  const ours = offered(cfg || {}, cat);
  const theirs = remote && remote[cat];
  const custom = !!(cfg && cfg.algorithms && Array.isArray(cfg.algorithms[cat]) && cfg.algorithms[cat].length);
  let msg = `no matching ${LABELS[cat]}: this session offers ${ours.join(', ')}; the server offers ${theirs && theirs.length ? theirs.join(', ') : 'nothing it told us about'}`;
  const common = theirs ? theirs.filter((a) => SUPPORTED[cat].includes(a)) : [];
  const missing = theirs ? theirs.filter((a) => UNAVAILABLE[cat].includes(a)) : [];
  // only the legacy additions in common: the preset is the knob, not the lists
  const legacyOnly = common.length > 0 && common.every((a) => LEGACY[cat].includes(a) && !DEFAULTS[cat].includes(a));
  if (custom && common.length) msg += `. Advanced SSH → Algorithms: add ${common.slice(0, 3).join(', ')} to the ${LABELS[cat]} list or Reset to defaults`;
  else if (custom) msg += '. Advanced SSH → Algorithms: Reset to defaults';
  else if (legacyOnly && !(cfg && cfg.legacyAlgorithms)) msg += '. The server only speaks old algorithms: tick "Legacy algorithms (old devices)" in Advanced SSH';
  else if (theirs && !common.length && missing.length) msg += `. The server only offers ${missing.join(', ')}, which this build cannot do (1024-bit Diffie-Hellman was removed from its crypto)`;
  else if (theirs && !common.length) msg += '. This version of MobAlt supports none of them';
  else if (common.length) msg += `. Advanced SSH → Algorithms: add ${common.slice(0, 3).join(', ')} to the ${LABELS[cat]} list`;
  return msg;
}

/**
 * ssh2's raw "Unknown DH group" (the group was negotiated, Node's crypto has no such group) as a hint: only a list
 * stored by an older build can still carry the name, and Reset to defaults clears it. Null for any other message.
 */
function explainDhGroup(message) {
  if (!/Unknown DH group/i.test(String(message || ''))) return null;
  const names = UNAVAILABLE.kex.length ? UNAVAILABLE.kex.join(', ') : 'diffie-hellman-group1-sha1';
  return `${message} — this build cannot do ${names} (1024-bit Diffie-Hellman was removed from its crypto); Advanced SSH → Algorithms: take it out of the key exchange list or Reset to defaults`;
}

/** What the renderer needs to build the editor section: the defaults, every supported name, the legacy additions, the names this build lacks. */
function describe() {
  const copy = (o) => Object.fromEntries(CATEGORIES.map((c) => [c, [...o[c]]]));
  return { categories: CATEGORIES.slice(), labels: { ...LABELS }, defaults: copy(DEFAULTS), supported: copy(SUPPORTED), legacy: copy(LEGACY), unavailable: copy(UNAVAILABLE) };
}

module.exports = { CATEGORIES, LABELS, DEFAULTS, SUPPORTED, LEGACY, UNAVAILABLE, parseList, presetLists, validate, normalize, connectOption, offered, noteRemote, explainHandshake, explainDhGroup, unavailableMessage, describe };
