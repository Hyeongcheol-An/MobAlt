'use strict';
// Host key verification against ~/.ssh/known_hosts and our own known_hosts file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { userDataFile } = require('./store');

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
  return h.equals(hash);
}

function files() {
  return [path.join(os.homedir(), '.ssh', 'known_hosts'), userDataFile('known_hosts')];
}

/**
 * @returns {'ok'|'mismatch'|'unknown'}
 */
function check(host, port, keyBuf) {
  const pat = hostPattern(host, port);
  const keyType = readKeyType(keyBuf);
  const keyB64 = keyBuf.toString('base64');
  let sawHost = false;
  for (const f of files()) {
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
      let i = 0;
      if (cols[0].startsWith('@')) i = 1; // @cert-authority / @revoked
      const hosts = cols[i];
      const type = cols[i + 1];
      const key = cols[i + 2];
      if (!hosts || !type || !key) continue;
      let match = false;
      if (hosts.startsWith('|1|')) match = hashedMatch(hosts, pat);
      else match = hosts.split(',').some((h) => h === pat || (h === host && (!port || port === 22)));
      if (!match) continue;
      if (type !== keyType) continue;
      sawHost = true;
      if (key === keyB64) return 'ok';
    }
  }
  return sawHost ? 'mismatch' : 'unknown';
}

function remember(host, port, keyBuf) {
  const file = userDataFile('known_hosts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${hostPattern(host, port)} ${readKeyType(keyBuf)} ${keyBuf.toString('base64')}\n`;
  fs.appendFileSync(file, line);
}

function forget(host, port) {
  const file = userDataFile('known_hosts');
  const pat = hostPattern(host, port);
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const keep = lines.filter((l) => !l.startsWith(pat + ' '));
    fs.writeFileSync(file, keep.join('\n'));
  } catch {}
}

module.exports = { check, remember, forget, fingerprint, readKeyType };
