'use strict';
// Host key verification against ~/.ssh/known_hosts and our own known_hosts file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { userDataFile } = require('./store');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

function readKeyType(keyBuf) {
  // SSH public key blob: uint32 len, string type, ...
  try {
    const len = keyBuf.readUInt32BE(0);
    return keyBuf.slice(4, 4 + len).toString('ascii');
  } catch {
    return 'unknown';
  }
}

function fingerprint(keyBuf) {
  const sha = crypto.createHash('sha256').update(keyBuf).digest('base64').replace(/=+$/, '');
  const md5 = crypto.createHash('md5').update(keyBuf).digest('hex').match(/../g).join(':');
  return { sha256: 'SHA256:' + sha, md5: 'MD5:' + md5 };
}

function hostPattern(host, port) {
  return port && port !== 22 ? `[${host}]:${port}` : host;
}

function hashedMatch(entry, host) {
  // |1|base64(salt)|base64(hmac-sha1(salt, host))
  const parts = entry.split('|');
  if (parts.length !== 4) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const hash = Buffer.from(parts[3], 'base64');
  const h = crypto.createHmac('sha1', salt).update(host).digest();
  return h.length === hash.length && crypto.timingSafeEqual(h, hash);
}

/** The app's own known_hosts (OpenSSH format, so an external ssh can be pointed at it); never ~/.ssh/known_hosts. */
function file() {
  return userDataFile('known_hosts');
}

function files() {
  return [path.join(os.homedir(), '.ssh', 'known_hosts'), file()];
}

/** OpenSSH's wildcard match (match.c match_pattern): `*` any run of characters, `?` exactly one. */
function globMatch(text, pattern) {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's');
  return re.test(text);
}

/**
 * Does a known_hosts host field (comma list, or one hashed name) name this host? Like OpenSSH: names compare without
 * regard to case (they are lower-cased before matching, and before hashing), `*` / `?` wildcards apply, a `!pattern`
 * that matches excludes the host whatever else the list says, and a non-default port is written `[host]:port`.
 */
function hostsMatch(field, host, port) {
  const name = host.toLowerCase();
  const pat = hostPattern(name, port);
  if (field.startsWith('|1|')) return hashedMatch(field, pat);
  let positive = false;
  for (const raw of field.split(',')) {
    if (!raw) continue;
    const negated = raw.startsWith('!');
    const p = (negated ? raw.slice(1) : raw).toLowerCase();
    const hit = globMatch(pat, p);
    if (hit && negated) return false;
    if (hit) positive = true;
  }
  return positive;
}

/**
 * The known_hosts lines that name this host, from every file of `list`: { marker, type, key } (marker '' for a plain
 * line, 'revoked', 'cert-authority').
 */
function entriesFor(host, port, list) {
  const out = [];
  for (const f of list) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cols = line.split(/\s+/);
      let marker = '';
      if (cols[0].startsWith('@')) marker = cols.shift().slice(1).toLowerCase();
      const [hosts, type, key] = cols;
      if (!hosts || !type || !key) continue;
      if (!hostsMatch(hosts, host, port)) continue;
      out.push({ marker, type, key });
    }
  }
  return out;
}

/**
 * @param list known_hosts files to consult (default: ~/.ssh/known_hosts read-only, then the app's own file)
 * @returns {'ok'|'mismatch'|'unknown'|'revoked'}
 *   revoked  — an `@revoked` line holds this very key: refused whatever else the files say (OpenSSH does the same)
 *   ok       — a plain line holds this key
 *   mismatch — the host is known with another key, of this type or of another one ("keys of a different type are
 *              already known for this host" in OpenSSH: a server that suddenly offers only a new type of key is as
 *              suspect as one with a new key of the old type)
 *   unknown  — no line names the host
 * `@cert-authority` lines are certificate-signing keys, not host keys (MobAlt does not check host certificates): they
 * neither accept a key nor make the host "known".
 */
function check(host, port, keyBuf, list = files()) {
  const keyType = readKeyType(keyBuf);
  const keyB64 = keyBuf.toString('base64');
  const entries = entriesFor(host, port, list);
  if (entries.some((e) => e.marker === 'revoked' && e.key === keyB64)) return 'revoked';
  const plain = entries.filter((e) => !e.marker);
  if (plain.some((e) => e.type === keyType && e.key === keyB64)) return 'ok';
  return plain.length ? 'mismatch' : 'unknown';
}

/** The key types known_hosts holds for this host (plain lines), so the handshake can ask for one of them first. */
function knownTypes(host, port, list = files()) {
  return [...new Set(entriesFor(host, port, list).filter((e) => !e.marker).map((e) => e.type))];
}

function remember(host, port, keyBuf) {
  const file = userDataFile('known_hosts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${hostPattern(host, port)} ${readKeyType(keyBuf)} ${keyBuf.toString('base64')}\n`;
  fs.appendFileSync(file, line);
}

function forget(host, port) {
  const file = userDataFile('known_hosts');
  const pat = hostPattern(host, port).toLowerCase();
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const keep = lines.filter((l) => !l.toLowerCase().startsWith(pat + ' '));
    fs.writeFileSync(file, keep.join('\n'));
  } catch {}
}

/**
 * Make sure the app's own file holds this (already verified) key, so a tool that only reads that file —
 * the ssh bootstrap of a Mosh session — trusts the host too. A key known only from ~/.ssh/known_hosts is
 * copied; a stale entry of the same type in the app file is replaced. Returns true when the file changed.
 */
function ensure(host, port, keyBuf) {
  const status = check(host, port, keyBuf, [file()]);
  if (status === 'ok' || status === 'revoked') return false; // a revoked key never reaches here (refused), never copy it
  if (status === 'mismatch') forget(host, port);
  remember(host, port, keyBuf);
  return true;
}

module.exports = { check, knownTypes, hostsMatch, remember, forget, ensure, file, fingerprint, readKeyType };
