'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const keygen = require('../../src/main/keygen');

test('keygenArgs: ed25519 has no size, rsa defaults to 4096, ecdsa to 256; every value is its own argument', () => {
  assert.deepEqual(keygen.keygenArgs({ type: 'ed25519', comment: 'me@mobalt', passphrase: '', path: '/k/id_ed25519' }),
    ['-q', '-t', 'ed25519', '-C', 'me@mobalt', '-N', '', '-f', '/k/id_ed25519']);
  assert.deepEqual(keygen.keygenArgs({ type: 'rsa', comment: 'c', passphrase: 'p w', path: '/k/id_rsa' }),
    ['-q', '-t', 'rsa', '-b', '4096', '-C', 'c', '-N', 'p w', '-f', '/k/id_rsa']);
  assert.deepEqual(keygen.keygenArgs({ type: 'rsa', bits: 2048, path: '/k/id_rsa' }).slice(3, 5), ['-b', '2048']);
  assert.deepEqual(keygen.keygenArgs({ type: 'ecdsa', path: '/k/id_ecdsa' }).slice(3, 5), ['-b', '256']);
  assert.deepEqual(keygen.keygenArgs({ type: 'ecdsa', bits: '384', path: '/k/id_ecdsa' }).slice(3, 5), ['-b', '384']);
  // a comment or passphrase that looks like an option stays a plain value (execFile never sees a shell)
  const args = keygen.keygenArgs({ type: 'ed25519', comment: '-f /etc/passwd; rm -rf /', passphrase: "it's $HOME", path: '/k/x' });
  assert.equal(args[args.indexOf('-C') + 1], '-f /etc/passwd; rm -rf /');
  assert.equal(args[args.indexOf('-N') + 1], "it's $HOME");
});

test('keygenArgs refuses what ssh-keygen would not take', () => {
  assert.throws(() => keygen.keygenArgs({ type: 'dsa', path: '/k/x' }), /Unknown key type "dsa"/);
  assert.throws(() => keygen.keygenArgs({ type: 'rsa', bits: 1024, path: '/k/x' }), /rsa keys can be 2048, 3072, 4096 bits, not 1024/);
  assert.throws(() => keygen.keygenArgs({ type: 'ecdsa', bits: 512, path: '/k/x' }), /ecdsa keys can be 256, 384, 521/);
  assert.throws(() => keygen.keygenArgs({ type: 'ed25519', bits: 4096, path: '/k/x' }), /fixed size/);
  assert.throws(() => keygen.keygenArgs({ type: 'ed25519' }), /No output file/);
  assert.throws(() => keygen.keygenArgs({ type: 'ed25519', path: '   ' }), /No output file/);
});

test('nextFreePath: the plain name, then _2, _3 …; a lone .pub also blocks a name', () => {
  const taken = new Set(['/h/.ssh/id_ed25519', '/h/.ssh/id_ed25519_2.pub', '/h/.ssh/id_rsa.pub']);
  const exists = (f) => taken.has(f);
  assert.equal(keygen.nextFreePath('/h/.ssh/id_ecdsa', exists), '/h/.ssh/id_ecdsa');
  assert.equal(keygen.nextFreePath('/h/.ssh/id_ed25519', exists), '/h/.ssh/id_ed25519_3');
  assert.equal(keygen.nextFreePath('/h/.ssh/id_rsa', exists), '/h/.ssh/id_rsa_2');
  assert.throws(() => keygen.nextFreePath('/h/x', () => true), /No free name/);
});

test('parseFingerprint reads ssh-keygen -lf lines, with and without a comment', () => {
  assert.deepEqual(keygen.parseFingerprint('256 SHA256:Zj3o2b0q7m8KQy4m4lW5r3xJ9V0dC7xkH1pL2nM3oP4 me@mobalt (ED25519)\n'),
    { bits: 256, hash: 'SHA256:Zj3o2b0q7m8KQy4m4lW5r3xJ9V0dC7xkH1pL2nM3oP4', comment: 'me@mobalt', type: 'ED25519', line: '256 SHA256:Zj3o2b0q7m8KQy4m4lW5r3xJ9V0dC7xkH1pL2nM3oP4 me@mobalt (ED25519)' });
  assert.deepEqual(keygen.parseFingerprint('4096 SHA256:abc+def/ghi= no comment (RSA)').comment, '');
  assert.equal(keygen.parseFingerprint('4096 SHA256:abc a comment with spaces (RSA)').comment, 'a comment with spaces');
  assert.equal(keygen.parseFingerprint('256 MD5:aa:bb:cc x (ECDSA)').hash, 'MD5:aa:bb:cc');
  assert.equal(keygen.parseFingerprint('/x/id_ed25519.pub is not a public key file.'), null);
  assert.equal(keygen.parseFingerprint(''), null);
});

test('installCommand: ssh-copy-id semantics in one sh -c, the key body quoted, ~ resolved to $HOME on the server', () => {
  const blob = 'AAAAC3NzaC1lZDI1NTE5AAAAIJ6vY+Qz/8x=';
  const cmd = keygen.installCommand('~/.ssh/authorized_keys', blob);
  assert.match(cmd, /^exec sh -c '/);
  assert.match(cmd, /f="\$HOME"\/'\\''\.ssh\/authorized_keys'\\''/); // the inner quotes escaped for the outer sh -c '…'
  assert.match(cmd, /umask 077/);
  assert.match(cmd, /mkdir -p "\$d"/);
  assert.match(cmd, /chmod 600 "\$f"/);
  assert.match(cmd, /grep -qsF -- '\\''AAAAC3NzaC1lZDI1NTE5AAAAIJ6vY\+Qz\/8x='\\'' "\$f"/);
  assert.match(cmd, /MOBALT_KEY_PRESENT/);
  assert.match(cmd, /cat; } >> "\$f" && echo MOBALT_KEY_ADDED/);
  // an absolute file with a quote in its name is quoted for the shell; the default file when none is given
  assert.match(keygen.installCommand("/srv/it's/keys", blob), /f='\\''\/srv\/it'\\''\\'\\'''\\''s\/keys'\\''/);
  assert.match(keygen.installCommand('', blob), /authorized_keys/);
  assert.throws(() => keygen.installCommand('~/.ssh/authorized_keys', 'AAAA"; rm -rf /; "'), /Not a public key/);
  assert.throws(() => keygen.installCommand('/a\nb', blob), /Bad remote file name/);
  // "~bob/…" inside the quotes would be a folder literally named ~bob under the login's home
  assert.throws(() => keygen.installCommand('~bob/.ssh/authorized_keys', blob), /^Error: ~user paths are not supported for the remote file — use ~\/ \(the login's home\) or an absolute path$/);
  assert.doesNotThrow(() => keygen.installCommand('~', blob));
  assert.doesNotThrow(() => keygen.installCommand('~/x', blob));
});

test('installCommand runs: appends once, keeps the file at 0600, creates a private folder, ends a missing newline', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-install-'));
  const blob = 'AAAAC3NzaC1lZDI1NTE5AAAAIJ6vY';
  const line = `ssh-ed25519 ${blob} test@mobalt`;
  const file = path.join(dir, 'sub', 'authorized_keys');
  const sh = (input) => execFileSync('/bin/sh', ['-c', keygen.installCommand(file, blob)], { input, encoding: 'utf8' }).trim();
  assert.equal(sh(line + '\n'), 'MOBALT_KEY_ADDED');
  assert.equal(fs.readFileSync(file, 'utf8'), line + '\n');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal((fs.statSync(path.dirname(file)).mode & 0o777).toString(8), '700');
  assert.equal(sh(line + '\n'), 'MOBALT_KEY_PRESENT');
  assert.equal(fs.readFileSync(file, 'utf8'), line + '\n');
  // an existing file without a trailing newline gets one before the key
  fs.writeFileSync(file, 'ssh-rsa AAAAB3 other');
  assert.equal(sh(line + '\n'), 'MOBALT_KEY_ADDED');
  assert.equal(fs.readFileSync(file, 'utf8'), `ssh-rsa AAAAB3 other\n${line}\n`);
  // a file name with a quote and spaces survives both layers of quoting; ~/ resolves against the server's $HOME
  const odd = path.join(dir, "it's here", 'auth keys');
  assert.equal(execFileSync('/bin/sh', ['-c', keygen.installCommand(odd, blob)], { input: line + '\n', encoding: 'utf8' }).trim(), 'MOBALT_KEY_ADDED');
  assert.equal(fs.readFileSync(odd, 'utf8'), line + '\n');
  assert.equal(execFileSync('/bin/sh', ['-c', keygen.installCommand('~/tilde/ak', blob)], { input: line + '\n', encoding: 'utf8', env: { ...process.env, HOME: dir } }).trim(), 'MOBALT_KEY_ADDED');
  assert.equal(fs.readFileSync(path.join(dir, 'tilde', 'ak'), 'utf8'), line + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generate: a real ed25519 key in a temp folder, 0600 / 0644, public key and fingerprint; refuses to overwrite', { skip: !fs.existsSync(keygen.SSH_KEYGEN) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-keygen-'));
  const file = path.join(dir, 'keys', 'id_ed25519');
  const r = await keygen.generate({ type: 'ed25519', comment: 'unit@mobalt', passphrase: '', path: file });
  assert.equal(r.privateKeyPath, file);
  assert.equal(r.publicKeyPath, file + '.pub');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal((fs.statSync(file + '.pub').mode & 0o777).toString(8), '644');
  assert.equal((fs.statSync(path.dirname(file)).mode & 0o777).toString(8), '700');
  assert.match(r.publicKey, /^ssh-ed25519 AAAA\S+ unit@mobalt$/);
  assert.equal(r.fingerprint.type, 'ED25519');
  assert.equal(r.fingerprint.bits, 256);
  assert.equal(r.fingerprint.comment, 'unit@mobalt');
  const lf = execFileSync(keygen.SSH_KEYGEN, ['-lf', file + '.pub'], { encoding: 'utf8' });
  assert.equal(r.fingerprint.hash, lf.trim().split(/\s+/)[1]);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: file }), /already exists — choose another file name/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: '' }), /Choose where to save/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: 'relative/name' }), /must be absolute/);
  // a folder (a trailing slash, or an existing directory) and a ~user path get their own sentences, before ssh-keygen runs
  await assert.rejects(keygen.generate({ type: 'ed25519', path: path.join(dir, 'sub') + '/' }), /^Error: That is a folder; add a file name$/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: path.join(dir, 'keys') }), /^Error: .*\/keys is a folder; add a file name$/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: '~bob/id_ed25519' }), /^Error: ~user paths are not supported — use ~\/ for your own home folder or an absolute path$/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: '~bob' }), /~user paths are not supported/);
  await assert.rejects(keygen.generate({ type: 'ed25519', path: path.join(dir, 'x') }, { bin: path.join(dir, 'no-such-ssh-keygen') }), /ssh-keygen was not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});
