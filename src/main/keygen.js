'use strict';
// SSH key generator (the MobaKeyGen counterpart): a thin, argument-safe wrapper around macOS's own
// /usr/bin/ssh-keygen, run through execFile (never a shell string), plus the pure helpers the dialog and the
// unit tests share: the argument list, the next free ~/.ssh/id_<type> name, the fingerprint parser and the
// ssh-copy-id style script that installs a public key on a server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

const SSH_KEYGEN = '/usr/bin/ssh-keygen';
const SSH_ADD = '/usr/bin/ssh-add';
const TYPES = { ed25519: { bits: null }, rsa: { bits: [2048, 3072, 4096], default: 4096 }, ecdsa: { bits: [256, 384, 521], default: 256 } };

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}
/** /Users/me/.ssh/x → ~/.ssh/x for messages. */
function shortHome(p) {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

/**
 * The ssh-keygen argument list for { type, bits?, comment?, passphrase?, path }. Types: ed25519 (no size),
 * rsa (2048 / 3072 / 4096, default 4096), ecdsa (256 / 384 / 521, default 256). Throws on anything else, so a
 * bad request never reaches the binary. The passphrase goes through -N as its own argument (an empty one means
 * no passphrase), the output file through -f; -q keeps the randomart off stdout.
 */
function keygenArgs(opts = {}) {
  const spec = TYPES[opts.type];
  if (!spec) throw new Error(`Unknown key type "${opts.type}" (ed25519, rsa or ecdsa)`);
  const file = opts.path && String(opts.path).trim();
  if (!file) throw new Error('No output file');
  const args = ['-q', '-t', opts.type];
  if (spec.bits) {
    const bits = opts.bits === undefined || opts.bits === null || opts.bits === '' ? spec.default : Number(opts.bits);
    if (!spec.bits.includes(bits)) throw new Error(`${opts.type} keys can be ${spec.bits.join(', ')} bits, not ${opts.bits}`);
    args.push('-b', String(bits));
  } else if (opts.bits !== undefined && opts.bits !== null && opts.bits !== '' && Number(opts.bits) !== 256) {
    throw new Error('ed25519 keys have a fixed size');
  }
  args.push('-C', String(opts.comment ?? ''), '-N', String(opts.passphrase ?? ''), '-f', file);
  return args;
}

/**
 * The first of file, file_2, file_3 … whose private and public (.pub) files are both absent. `exists` is
 * injectable for tests (defaults to fs.existsSync).
 */
function nextFreePath(file, exists = fs.existsSync) {
  const free = (f) => !exists(f) && !exists(f + '.pub');
  if (free(file)) return file;
  for (let n = 2; n < 1000; n++) {
    const f = `${file}_${n}`;
    if (free(f)) return f;
  }
  throw new Error(`No free name next to ${file}`);
}

/**
 * Parse `ssh-keygen -lf` output: "256 SHA256:xxxx comment (ED25519)" → { bits, hash, comment, type, line }.
 * A key without a comment prints "no comment" there, which becomes ''. Returns null for anything else.
 */
function parseFingerprint(out) {
  const line = String(out || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const m = /^(\d+)\s+(\S+)\s+(.*?)\s*\(([A-Za-z0-9-]+)\)$/.exec(line);
  if (!m) return null;
  const comment = m[3] === 'no comment' ? '' : m[3];
  return { bits: parseInt(m[1], 10), hash: m[2], comment, type: m[4], line };
}

/** Quote for a POSIX shell: single quotes, with embedded ones escaped. */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The remote command that appends a public key to `remoteFile` (default ~/.ssh/authorized_keys) the way
 * ssh-copy-id does: the folder and file are created private (umask 077, 700 / 600) when missing, the key line
 * arrives on stdin, a line already present is not added twice. `blob` is the key's base64 body (what grep looks
 * for; validated here so it can sit inside the quotes). Prints MOBALT_KEY_ADDED or MOBALT_KEY_PRESENT. Wrapped in
 * `exec sh -c` so a fish or csh login shell on the server does not get to parse it.
 */
function installCommand(remoteFile, blob) {
  if (!/^[A-Za-z0-9+/=]+$/.test(String(blob || ''))) throw new Error('Not a public key');
  const file = String(remoteFile || '').trim() || '~/.ssh/authorized_keys';
  if (/[\r\n]/.test(file)) throw new Error('Bad remote file name');
  // quoted for the shell, "~bob/…" would be a folder literally named ~bob under the login's home
  if (/^~[^/]/.test(file)) throw new Error('~user paths are not supported for the remote file — use ~/ (the login\'s home) or an absolute path');
  const target = file === '~' ? '"$HOME"' : file.startsWith('~/') ? `"$HOME"/${shq(file.slice(2))}` : shq(file);
  const script = [
    `f=${target}`, 'd=$(dirname "$f")', 'umask 077',
    '[ -d "$d" ] || mkdir -p "$d" || exit 1',
    '[ -e "$f" ] || { : > "$f" && chmod 600 "$f"; } || exit 1',
    `if grep -qsF -- ${shq(blob)} "$f"; then echo MOBALT_KEY_PRESENT; else { [ ! -s "$f" ] || [ -z "$(tail -c1 "$f")" ] || echo; cat; } >> "$f" && echo MOBALT_KEY_ADDED; fi`,
  ].join('; ');
  return `exec sh -c ${shq(script)}`;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 60000, maxBuffer: 1024 * 1024, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/**
 * Generate a key pair: { type, bits?, comment?, passphrase?, path } → { privateKeyPath, publicKeyPath, publicKey,
 * fingerprint }. ~ is expanded; a missing folder is created private (0700, ~/.ssh included); the files end up
 * 0600 / 0644. Refuses to overwrite: an existing private or public file is an error before ssh-keygen runs.
 * `deps` lets a test point at another binary.
 */
async function generate(opts = {}, deps = {}) {
  const bin = deps.bin || SSH_KEYGEN;
  const raw = String(opts.path || '').trim();
  if (!raw) throw new Error('Choose where to save the key');
  // the two path shapes ssh-keygen would answer with a confusing "No such file or directory"
  if (/^~[^/]/.test(raw)) throw new Error('~user paths are not supported — use ~/ for your own home folder or an absolute path');
  if (raw.endsWith('/')) throw new Error('That is a folder; add a file name');
  const file = expandHome(raw);
  if (!path.isAbsolute(file)) throw new Error(`The key path must be absolute (or start with ~): ${file}`);
  let isDir = false;
  try { isDir = fs.statSync(file).isDirectory(); } catch {}
  if (isDir) throw new Error(`${shortHome(file)} is a folder; add a file name`);
  const args = keygenArgs({ ...opts, path: file }); // validates type / bits first
  if (fs.existsSync(file) || fs.existsSync(file + '.pub')) throw new Error(`${shortHome(file)} already exists — choose another file name`);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      throw new Error(`Cannot create ${shortHome(dir)}: ${e.message}`);
    }
  }
  const r = await run(bin, args);
  if (r.err) {
    if (r.err.code === 'ENOENT') throw new Error(`ssh-keygen was not found at ${bin} — install the Xcode Command Line Tools (xcode-select --install)`);
    const why = r.stderr.trim().split('\n').pop() || r.err.message;
    throw new Error(`ssh-keygen failed: ${why}`);
  }
  try {
    fs.chmodSync(file, 0o600);
    fs.chmodSync(file + '.pub', 0o644);
  } catch {}
  let publicKey;
  try {
    publicKey = fs.readFileSync(file + '.pub', 'utf8').trim();
  } catch (e) {
    throw new Error(`The key was generated but ${shortHome(file)}.pub cannot be read: ${e.message}`);
  }
  const fp = await run(bin, ['-lf', file + '.pub']);
  const fingerprint = parseFingerprint(fp.stdout) || { bits: 0, hash: '', comment: '', type: '', line: fp.stdout.trim() || fp.stderr.trim() };
  return { privateKeyPath: file, publicKeyPath: file + '.pub', publicKey, fingerprint };
}

/**
 * `ssh-add --apple-use-keychain <key>`: the key goes into the running agent and its passphrase into the login
 * Keychain. There is no terminal to type the passphrase into, so a one-shot askpass helper hands it over
 * (SSH_ASKPASS_REQUIRE=force) and is deleted right after. Resolves { ok, message } / { ok: false, error }.
 */
async function addToAgent(keyPath, passphrase, deps = {}) {
  const bin = deps.bin || SSH_ADD;
  if (!process.env.SSH_AUTH_SOCK) return { ok: false, error: 'No ssh-agent is running (SSH_AUTH_SOCK is not set)' };
  const file = expandHome(String(keyPath || ''));
  const env = { ...process.env };
  let helper = null;
  if (passphrase) {
    helper = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-askpass-')), 'askpass.sh');
    fs.writeFileSync(helper, '#!/bin/sh\nprintf \'%s\\n\' "$MOBALT_ASKPASS_SECRET"\n', { mode: 0o700 });
    env.SSH_ASKPASS = helper;
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.DISPLAY = env.DISPLAY || ':0';
    env.MOBALT_ASKPASS_SECRET = passphrase;
  }
  try {
    const r = await run(bin, ['--apple-use-keychain', file], { env, timeout: 20000 });
    if (r.err) {
      if (r.err.code === 'ENOENT') return { ok: false, error: `ssh-add was not found at ${bin}` };
      return { ok: false, error: `ssh-add failed: ${(r.stderr.trim() || r.err.message).split('\n').pop()}` };
    }
    return { ok: true, message: (r.stderr.trim() || r.stdout.trim() || 'Identity added').split('\n').pop() };
  } finally {
    if (helper) {
      try { fs.rmSync(path.dirname(helper), { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = { SSH_KEYGEN, TYPES, keygenArgs, nextFreePath, parseFingerprint, installCommand, generate, addToAgent, expandHome, shortHome };
