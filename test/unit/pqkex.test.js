'use strict';
// Post-quantum key exchange: the KEMs against known answers (ML-KEM-768: a NIST ACVP keygen case and the C2SP/CCTV
// encapsulation vectors; sntrup761: OpenSSH's C as WebAssembly, round trips and its secret-key layout), the hybrid
// exchange's encodings against handshakes recorded from the real OpenSSH 10.5 test sshd (Q_C, K, the exchange hash
// H — proven by the server's own signature over it), and the key-exchange list a session offers with the option
// on and off.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ml_kem768 } = require('@noble/post-quantum/ml-kem.js');
const { parseDERKey } = require('ssh2/lib/protocol/keyParser');
const { sigSSHToASN1 } = require('ssh2/lib/protocol/utils');
const C = require('ssh2/lib/protocol/constants');
const pq = require('../../src/main/pqkex');
const sntrup761 = require('../../src/main/pq/sntrup761');
const A = require('../../src/main/algorithms');
const kexPQ = pq.kexPQ;

const hex = (s) => Buffer.from(s, 'hex');
const MLKEM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'pqkex-mlkem768.json'), 'utf8'));
const HANDSHAKES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'pqkex-handshakes.json'), 'utf8')).handshakes;
const MLKEM_NAME = 'mlkem768x25519-sha256', SNTRUP_NAME = 'sntrup761x25519-sha512@openssh.com';

// ---------- ML-KEM-768 (@noble/post-quantum) against known answers ----------

test('ML-KEM-768 keygen: the NIST ACVP (FIPS 203 final) case — seed d‖z gives the expected ek and dk', () => {
  const v = MLKEM.keygen;
  const k = ml_kem768.keygen(Buffer.concat([hex(v.d), hex(v.z)]));
  assert.equal(Buffer.from(k.publicKey).toString('hex'), v.ek);
  assert.equal(Buffer.from(k.secretKey).toString('hex'), v.dk);
  assert.equal(k.publicKey.length, 1184);
  assert.equal(k.secretKey.length, 2400);
});

test('ML-KEM-768 encapsulation and decapsulation: the C2SP/CCTV vectors (ek, m → c, K; dk, c → K)', () => {
  const v = MLKEM.encaps;
  const e = ml_kem768.encapsulate(hex(v.ek), hex(v.m));
  assert.equal(Buffer.from(e.cipherText).toString('hex'), v.c);
  assert.equal(Buffer.from(e.sharedSecret).toString('hex'), v.K);
  assert.equal(e.cipherText.length, 1088);
  assert.equal(Buffer.from(ml_kem768.decapsulate(hex(v.c), hex(v.dk))).toString('hex'), v.K);
});

test('ML-KEM-768 implicit rejection: the CCTV strcmp vector (a ciphertext a byte-string compare must reject in full)', () => {
  const v = MLKEM.strcmp;
  assert.equal(Buffer.from(ml_kem768.decapsulate(hex(v.c), hex(v.dk))).toString('hex'), v.K);
});

test('ML-KEM-768 as registered for ssh2: fresh keys round-trip, a damaged ciphertext gives another secret without an error', () => {
  const kem = pq.kems.mlkem768;
  assert.equal(kem.publicKeyBytes, 1184);
  assert.equal(kem.ciphertextBytes, 1088);
  const k = kem.keygen();
  const e = ml_kem768.encapsulate(k.publicKey);
  assert.deepEqual(Buffer.from(kem.decapsulate(e.cipherText, k.secretKey)), Buffer.from(e.sharedSecret));
  const bad = Buffer.from(e.cipherText);
  bad[100] ^= 0x01;
  assert.notDeepEqual(Buffer.from(kem.decapsulate(bad, k.secretKey)), Buffer.from(e.sharedSecret));
});

// ---------- sntrup761 (OpenSSH's reference C as WebAssembly) ----------

test('sntrup761: OpenSSH\'s sizes, a keygen/enc/dec round trip, the public key inside the secret key, implicit rejection', () => {
  assert.equal(sntrup761.publicKeyBytes, 1158);
  assert.equal(sntrup761.secretKeyBytes, 1763);
  assert.equal(sntrup761.ciphertextBytes, 1039);
  assert.equal(sntrup761.sharedSecretBytes, 32);
  const k = sntrup761.keygen();
  assert.equal(k.publicKey.length, 1158);
  assert.equal(k.secretKey.length, 1763);
  // sk = small f, small ginv (2 × 191 bytes) ‖ pk ‖ ρ (191 random bytes) ‖ SHA-512(4 ‖ pk)[0..32]
  assert.ok(k.secretKey.subarray(382, 382 + 1158).equals(k.publicKey), 'pk is embedded at offset 382');
  const cache = crypto.createHash('sha512').update(Buffer.concat([Buffer.from([4]), k.publicKey])).digest().subarray(0, 32);
  assert.ok(k.secretKey.subarray(1763 - 32).equals(cache), 'the hash of the public key ends the secret key');
  const e = sntrup761.encapsulate(k.publicKey);
  assert.equal(e.cipherText.length, 1039);
  assert.equal(e.sharedSecret.length, 32);
  assert.ok(sntrup761.decapsulate(e.cipherText, k.secretKey).equals(e.sharedSecret));
  const bad = Buffer.from(e.cipherText);
  bad[7] ^= 0x80;
  const other = sntrup761.decapsulate(bad, k.secretKey);
  assert.equal(other.length, 32);
  assert.ok(!other.equals(e.sharedSecret), 'a changed ciphertext decapsulates to an unrelated secret');
  // the rejection secret is deterministic: SHA-512(0 ‖ SHA-512(3 ‖ ρ)[0..32] ‖ c)[0..32]
  const rho = k.secretKey.subarray(382 + 1158, 382 + 1158 + 191);
  const inner = crypto.createHash('sha512').update(Buffer.concat([Buffer.from([3]), rho])).digest().subarray(0, 32);
  const expected = crypto.createHash('sha512').update(Buffer.concat([Buffer.from([0]), inner, bad])).digest().subarray(0, 32);
  assert.ok(other.equals(expected), 'the implicit-rejection value is the one OpenSSH computes');
  // and the real secret is SHA-512(1 ‖ SHA-512(3 ‖ r_enc)[0..32] ‖ c)[0..32]: two different keys never share one
  const k2 = sntrup761.keygen();
  assert.ok(!sntrup761.decapsulate(e.cipherText, k2.secretKey).equals(e.sharedSecret));
  // lengths are checked before anything reaches the module
  assert.throws(() => sntrup761.decapsulate(e.cipherText.subarray(1), k.secretKey), /ciphertext must be 1039 bytes/);
  assert.throws(() => sntrup761.decapsulate(e.cipherText, k.secretKey.subarray(1)), /secret key must be 1763 bytes/);
  assert.throws(() => sntrup761.encapsulate(k.publicKey.subarray(1)), /public key must be 1158 bytes/);
});

test('sntrup761: the module only imports its randomness and SHA-512 from the host (no libc, no WASI)', () => {
  const m = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'pq', 'sntrup761.wasm')));
  assert.deepEqual(WebAssembly.Module.imports(m).map((i) => `${i.module}.${i.name}`).sort(), ['env.crypto_hash_sha512', 'env.randombytes']);
  const exported = WebAssembly.Module.exports(m).map((e) => e.name);
  for (const name of ['memory', 'pk', 'sk', 'ct', 'k', 'keypair', 'enc', 'dec']) assert.ok(exported.includes(name), `exports ${name}`);
});

// ---------- the hybrid exchange (ssh2 patch, lib/protocol/kex-pq.js) ----------

test('ssh2 knows both hybrids as supported, never as defaults; both KEMs are registered; a hybrid is recognised by name', () => {
  for (const name of [MLKEM_NAME, SNTRUP_NAME]) {
    assert.ok(C.SUPPORTED_KEX.includes(name), `${name} supported`);
    assert.ok(!C.DEFAULT_KEX.includes(name), `${name} not a default`);
    assert.equal(kexPQ.available(name), true);
    assert.equal(pq.isHybrid(name), true);
    assert.equal(A.isPostQuantum(name), true);
  }
  assert.deepEqual(pq.KEX, [MLKEM_NAME, SNTRUP_NAME]);
  assert.deepEqual(A.POST_QUANTUM_KEX, [MLKEM_NAME, SNTRUP_NAME]);
  assert.equal(kexPQ.METHODS[MLKEM_NAME].hash, 'sha256');
  assert.equal(kexPQ.METHODS[SNTRUP_NAME].hash, 'sha512');
  assert.equal(kexPQ.available('curve25519-sha256'), false);
  assert.equal(pq.isHybrid('curve25519-sha256'), false);
  assert.equal(A.isPostQuantum('ecdh-sha2-nistp256'), false);
  assert.throws(() => kexPQ.register('x', { publicKeyBytes: 1, ciphertextBytes: 1 }), /Invalid KEM implementation/);
});

test('Q_C is the KEM public key followed by the raw X25519 public key; a reply of the wrong length or a zero X25519 secret is an Error', () => {
  const kem = pq.kems.mlkem768;
  const keys = kem.keygen();
  const x = crypto.generateKeyPairSync('x25519');
  const xpub = kexPQ.x25519Raw(x.publicKey);
  assert.equal(xpub.length, 32);
  const qc = kexPQ.clientPublic(kem, keys.publicKey, xpub);
  assert.equal(qc.length, 1184 + 32);
  assert.ok(qc.subarray(0, 1184).equals(Buffer.from(keys.publicKey)) && qc.subarray(1184).equals(xpub));
  assert.throws(() => kexPQ.clientPublic(kem, keys.publicKey.subarray(1), xpub), /expected 1184/);
  const e = ml_kem768.encapsulate(keys.publicKey);
  const short = kexPQ.sharedSecret('sha256', kem, keys.secretKey, x.privateKey, Buffer.from(e.cipherText));
  assert.ok(short instanceof Error && /expected 1120/.test(short.message));
  // the all-zero point: X25519 gives an all-zero secret (or the library refuses it) — either way no key comes out
  const zero = kexPQ.sharedSecret('sha256', kem, keys.secretKey, x.privateKey, Buffer.concat([Buffer.from(e.cipherText), Buffer.alloc(32)]));
  assert.ok(zero instanceof Error, 'low-order point rejected');
  // a well-formed reply: K = SHA-256(KEM secret ‖ X25519 secret), 32 raw bytes
  const y = crypto.generateKeyPairSync('x25519');
  const reply = Buffer.concat([Buffer.from(e.cipherText), kexPQ.x25519Raw(y.publicKey)]);
  const k = kexPQ.sharedSecret('sha256', kem, keys.secretKey, x.privateKey, reply);
  const xs = crypto.diffieHellman({ privateKey: y.privateKey, publicKey: x.publicKey });
  assert.ok(Buffer.isBuffer(k) && k.equals(crypto.createHash('sha256').update(Buffer.from(e.sharedSecret)).update(xs).digest()));
});

/** An SSH string: uint32 length + bytes (how K, Q_C, Q_S and the rest enter the exchange hash). */
const sshString = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length, 0); return Buffer.concat([l, b]); };
const readString = (buf, pos) => { const len = buf.readUInt32BE(pos); return [buf.subarray(pos + 4, pos + 4 + len), pos + 4 + len]; };

for (const fx of HANDSHAKES) {
  test(`${fx.kex} against ${fx.server}: Q_C, K (an SSH string of the hash) and H as recorded — the server's signature over H verifies`, () => {
    const method = kexPQ.METHODS[fx.kex];
    const kem = pq.kems[method.kem];
    const priv = crypto.createPrivateKey({ key: hex(fx.x25519PrivateKey), format: 'der', type: 'pkcs8' });
    const xpub = kexPQ.x25519Raw(crypto.createPublicKey(priv));
    // what the client sent
    const qc = kexPQ.clientPublic(kem, hex(fx.kemPublicKey), xpub);
    assert.equal(qc.toString('hex'), fx.Q_C, 'Q_C = KEM pk ‖ X25519 pk');
    assert.equal(qc.length, kem.publicKeyBytes + 32);
    // the secret from the server's reply
    const qs = hex(fx.Q_S);
    assert.equal(qs.length, kem.ciphertextBytes + 32, 'Q_S = ciphertext ‖ X25519 pk');
    const k = kexPQ.sharedSecret(method.hash, kem, hex(fx.kemSecretKey), priv, qs);
    assert.ok(Buffer.isBuffer(k));
    assert.equal(k.toString('hex'), fx.K, 'K = HASH(KEM secret ‖ X25519 secret), raw digest');
    assert.equal(k.length, method.hash === 'sha512' ? 64 : 32);
    // H over the strings, K as a string (not an mpint), hashed with the method's own hash — as kex.js does
    const h = crypto.createHash(method.hash);
    for (const part of ['V_C', 'V_S', 'I_C', 'I_S', 'K_S', 'Q_C', 'Q_S']) h.update(sshString(hex(fx[part])));
    h.update(sshString(k));
    const H = h.digest();
    assert.equal(H.toString('hex'), fx.H, 'exchange hash = session id');
    // the sshd signed exactly this H with its host key
    const ks = hex(fx.K_S);
    const [typeBuf, p1] = readString(ks, 0);
    const key = parseDERKey(ks.subarray(p1), typeBuf.toString());
    assert.ok(!(key instanceof Error), 'host key parses');
    const sig = hex(fx.sig);
    const [sigType, p2] = readString(sig, 0);
    const [sigValue] = readString(sig, p2);
    const hashAlgo = sigType.toString() === 'rsa-sha2-256' ? 'sha256' : sigType.toString() === 'rsa-sha2-512' ? 'sha512' : undefined;
    assert.equal(key.verify(H, sigSSHToASN1(sigValue, sigType.toString()), hashAlgo), true, 'signature over H verifies');
    // the same inputs with K as an mpint would not be what the server signed
    const mp = Buffer.from(k);
    const h2 = crypto.createHash(method.hash);
    for (const part of ['V_C', 'V_S', 'I_C', 'I_S', 'K_S', 'Q_C', 'Q_S']) h2.update(sshString(hex(fx[part])));
    h2.update(sshString(mp[0] & 0x80 ? Buffer.concat([Buffer.from([0]), mp]) : mp.subarray(mp.findIndex((b) => b !== 0))));
    if (mp[0] & 0x80 || mp[0] === 0) assert.notEqual(h2.digest().toString('hex'), fx.H, 'an mpint K would give another H');
    assert.equal(fx.negotiated.kex, fx.kex);
  });
}

// ---------- the key-exchange list a session offers ----------

test('connectOption: off, nothing changes; on, the hybrids go in front of the defaults, of the legacy-extended list and of an explicit list (no duplicates)', () => {
  assert.equal(A.connectOption({}), undefined);
  assert.equal(A.connectOption({ pqKex: false }), undefined);
  assert.deepEqual(A.connectOption({ pqKex: true }), { kex: { prepend: [MLKEM_NAME, SNTRUP_NAME] } });
  const legacy = A.connectOption({ pqKex: true, legacyAlgorithms: true });
  assert.deepEqual(legacy.kex, { prepend: [MLKEM_NAME, SNTRUP_NAME], append: [...A.LEGACY.kex] });
  assert.deepEqual(legacy.cipher, { append: [...A.LEGACY.cipher] }); // the other categories as before
  assert.deepEqual(A.connectOption({ pqKex: true, algorithms: { kex: ['curve25519-sha256', SNTRUP_NAME] } }).kex, [MLKEM_NAME, SNTRUP_NAME, 'curve25519-sha256']);
  assert.deepEqual(A.connectOption({ pqKex: true, algorithms: { cipher: ['aes256-ctr'] } }), { cipher: ['aes256-ctr'], kex: { prepend: [MLKEM_NAME, SNTRUP_NAME] } });
  // an explicit list naming a hybrid works without the option (the names are supported)
  assert.deepEqual(A.connectOption({ algorithms: { kex: [MLKEM_NAME] } }).kex, [MLKEM_NAME]);
});

test('offered: the list in KEXINIT order — hybrids first with the option on, the defaults untouched with it off', () => {
  assert.deepEqual(A.offered({}, 'kex'), [...A.DEFAULTS.kex]);
  assert.deepEqual(A.offered({ pqKex: true }, 'kex'), [MLKEM_NAME, SNTRUP_NAME, ...A.DEFAULTS.kex]);
  assert.deepEqual(A.offered({ pqKex: true, legacyAlgorithms: true }, 'kex'), [MLKEM_NAME, SNTRUP_NAME, ...A.DEFAULTS.kex, ...A.LEGACY.kex]);
  assert.deepEqual(A.offered({ pqKex: true, algorithms: { kex: ['ecdh-sha2-nistp256'] } }, 'kex'), [MLKEM_NAME, SNTRUP_NAME, 'ecdh-sha2-nistp256']);
  assert.ok(!A.DEFAULTS.kex.includes(MLKEM_NAME) && !A.DEFAULTS.kex.includes(SNTRUP_NAME));
  assert.ok(A.SUPPORTED.kex.includes(MLKEM_NAME) && A.SUPPORTED.kex.includes(SNTRUP_NAME));
  assert.equal(A.offered({ pqKex: true }, 'cipher').join(), A.DEFAULTS.cipher.join());
});

test('validate accepts the hybrid names in a typed list; the editor stores nothing for the option itself in the lists', () => {
  const v = A.validate({ kex: `${MLKEM_NAME}, ${SNTRUP_NAME}, curve25519-sha256`, serverHostKey: '', cipher: '', hmac: '' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.kex, [MLKEM_NAME, SNTRUP_NAME, 'curve25519-sha256']);
  assert.equal(A.normalize({ kex: A.DEFAULTS.kex.join(', ') }, false), undefined);
});
