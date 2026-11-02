'use strict';
// Nothing of a real machine, network or account in the public tree: every tracked text file is scanned for public
// IPv4 addresses (fixtures use the private ranges or RFC 5737's 192.0.2/24, 198.51.100/24, 203.0.113/24), for
// private-key blocks and well-known token shapes, and for e-mail addresses outside the handful of domains that
// belong in source (example.com, the algorithm names ending in @openssh.com / @libssh.org, GitHub's noreply).
// package-lock.json (third-party metadata) and binaries are left out. A hit prints file:line so it can be fixed,
// not allow-listed: the point is that a real address never reaches a commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = /^(package-lock\.json|.*\.(png|gif|jpg|jpeg|icns|ico|wasm|pdf|zip|dmg))$/i;

function trackedFiles() {
  let list;
  try { list = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0'); } catch { return null; }
  return list.filter((f) => f && !SKIP.test(f) && fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
}

const files = trackedFiles();
const skipReason = files === null ? 'not a git checkout' : files.length === 0 ? 'no tracked files' : null;
const opts = skipReason ? { skip: skipReason } : {}; // node:test skips on any `skip` key that is not false

/** True for an IPv4 that may appear in source: private, loopback, link-local, multicast, unspecified/broadcast, RFC 5737, public resolvers. */
function allowedIp(ip) {
  const o = ip.split('.').map(Number);
  if (o.some((n) => n > 255)) return true; // not an address (a version number such as 1.3.2.300)
  const [a, b, c] = o;
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
    || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127)
    || ip === '255.255.255.255' || ip === '8.8.8.8' || ip === '8.8.4.4' || ip === '1.1.1.1' || ip === '9.9.9.9';
}

const EMAIL_OK = /@(example\.(com|org|net)|openssh\.com|libssh\.org|users\.noreply\.github\.com|github\.com)$/i;

function scan(fn) {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => { for (const why of fn(line)) hits.push(`${f}:${i + 1}: ${why}`); });
  }
  return hits;
}

test('no public IPv4 address in tracked files', opts, () => {
  const hits = scan((line) => {
    const out = [];
    for (const m of line.matchAll(/(?<![\w.])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\w.])/g)) if (!allowedIp(m[1])) out.push(m[1]);
    return out;
  });
  assert.deepEqual(hits, [], 'public addresses (use 192.0.2.x / 198.51.100.x / 203.0.113.x in fixtures)');
});

test('no private key, certificate or token shape in tracked files', opts, () => {
  const hits = scan((line) => {
    const out = [];
    if (/-----BEGIN (RSA |OPENSSH |EC |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/.test(line)) out.push('private key block');
    if (/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/.test(line)) out.push('GitHub token');
    if (/\bxox[abpr]-[A-Za-z0-9-]{20,}\b/.test(line)) out.push('Slack token');
    if (/\bAKIA[0-9A-Z]{16}\b/.test(line)) out.push('AWS access key');
    if (/\bsk-(ant-)?[A-Za-z0-9_-]{30,}\b/.test(line)) out.push('API key');
    return out;
  });
  assert.deepEqual(hits, []);
});

test('no e-mail address outside the domains that belong in source', opts, () => {
  const hits = scan((line) => {
    const out = [];
    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const addr = m[0];
      if (!EMAIL_OK.test(addr) && !/\.(png|jpg|gif)$/i.test(addr)) out.push(addr);
    }
    return out;
  });
  assert.deepEqual(hits, []);
});
