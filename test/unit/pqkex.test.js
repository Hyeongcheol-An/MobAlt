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
const net = require('net');
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
const MLKEM_NAME = 'mlkem768x25519-sha256', SNTRUP_NAME = 'sntrup761x25519-sha512@openssh.com', SNTRUP_IANA = 'sntrup761x25519-sha512';
const HYBRIDS = [MLKEM_NAME, SNTRUP_NAME, SNTRUP_IANA];

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
  for (const name of ['memory', 'pk', 'sk', 'ct', 'k', 'keypair', 'enc', 'dec', 'stack_lo', 'stack_hi']) assert.ok(exported.includes(name), `exports ${name}`);
});

test('sntrup761: the C stack comes first in memory (build.sh STACK_SIZE) and is zeroed after every operation — no secret residue', () => {
  const { memory, stack, buffers } = sntrup761._inspect();
  assert.equal(stack.lo, 0, '--stack-first');
  assert.equal(stack.hi, 262144, 'STACK_SIZE of build.sh');
  for (const [name, off] of Object.entries(buffers)) assert.ok(off >= stack.hi, `${name} buffer (${off}) lies above the stack`);
  const scan = () => {
    const mem = Buffer.from(memory.buffer);
    let nonzero = 0;
    for (let i = stack.lo; i < stack.hi; i++) if (mem[i] !== 0) nonzero++;
    return { mem, nonzero };
  };
  const k = sntrup761.keygen();
  let r = scan();
  assert.equal(r.nonzero, 0, 'stack clean after keygen');
  assert.equal(r.mem.indexOf(k.secretKey.subarray(0, 191)), -1, 'small f not in memory');
  assert.equal(r.mem.indexOf(k.secretKey.subarray(191, 382)), -1, 'small ginv not in memory');
  assert.equal(r.mem.indexOf(k.secretKey.subarray(1540, 1731)), -1, 'ρ not in memory');
  const e = sntrup761.encapsulate(k.publicKey);
  r = scan();
  assert.equal(r.nonzero, 0, 'stack clean after enc');
  assert.equal(r.mem.indexOf(e.sharedSecret), -1, 'the encapsulated secret not in memory');
  const d = sntrup761.decapsulate(e.cipherText, k.secretKey);
  assert.ok(d.equals(e.sharedSecret));
  r = scan();
  assert.equal(r.nonzero, 0, 'stack clean after dec');
  assert.equal(r.mem.indexOf(d), -1, 'K not in memory');
  for (const [name, part] of [['small f', k.secretKey.subarray(0, 191)], ['small ginv', k.secretKey.subarray(191, 382)], ['ρ', k.secretKey.subarray(1540, 1731)], ['pk-hash', k.secretKey.subarray(1731)]]) {
    assert.equal(r.mem.indexOf(part), -1, `${name} of the secret key not in memory after dec`);
  }
  assert.equal(r.mem.indexOf(d.subarray(0, 8)), -1, 'not even a prefix of K');
});

// ---------- the hybrid exchange (ssh2 patch, lib/protocol/kex-pq.js) ----------

test('ssh2 knows the hybrids (and sntrup761\'s IANA alias) as supported, never as defaults; both KEMs are registered; a hybrid is recognised by name', () => {
  for (const name of HYBRIDS) {
    assert.ok(C.SUPPORTED_KEX.includes(name), `${name} supported`);
    assert.ok(!C.DEFAULT_KEX.includes(name), `${name} not a default`);
    assert.equal(kexPQ.available(name), true);
    assert.equal(pq.isHybrid(name), true);
    assert.equal(A.isPostQuantum(name), true);
  }
  assert.equal(pq.available, true);
  assert.deepEqual(pq.KEX, HYBRIDS);
  assert.deepEqual(A.POST_QUANTUM_KEX, HYBRIDS);
  assert.deepEqual(A.describe().postQuantum, HYBRIDS);
  assert.equal(kexPQ.METHODS[MLKEM_NAME].hash, 'sha256');
  assert.equal(kexPQ.METHODS[SNTRUP_NAME].hash, 'sha512');
  assert.equal(kexPQ.METHODS[SNTRUP_IANA], kexPQ.METHODS[SNTRUP_NAME], 'the alias is the same exchange');
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
  // the KEM secret is wiped on that error path too (a KEM whose secret we can watch)
  const held = Buffer.alloc(32, 0xab);
  const watched = { publicKeyBytes: 1184, ciphertextBytes: 1088, keygen: () => keys, decapsulate: () => held };
  assert.ok(kexPQ.sharedSecret('sha256', watched, keys.secretKey, x.privateKey, Buffer.concat([Buffer.from(e.cipherText), Buffer.alloc(32)])) instanceof Error);
  assert.ok(held.every((b) => b === 0), 'KEM secret zeroed after the failed derivation');
  held.fill(0xab);
  assert.ok(Buffer.isBuffer(kexPQ.sharedSecret('sha256', watched, keys.secretKey, x.privateKey, Buffer.concat([Buffer.from(e.cipherText), kexPQ.x25519Raw(crypto.generateKeyPairSync('x25519').publicKey)]))));
  assert.ok(held.every((b) => b === 0), 'and after a successful one');
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

// ---------- an exchange that never finishes drops its secrets ----------

const nameList = (arr) => sshString(Buffer.from(arr.join(',')));
const packet = (payload) => { let pad = 8 - ((payload.length + 5) % 8); if (pad < 4) pad += 8; const out = Buffer.alloc(5 + payload.length + pad); out.writeUInt32BE(1 + payload.length + pad, 0); out[4] = pad; payload.copy(out, 5); return out; };
/**
 * A server that negotiates `kexName` and then — `mode` — never answers the client's KEX_ECDH_INIT ('hang-before-reply'),
 * answers it but withholds NEWKEYS ('hang-after-reply': the client holds Q_S and its secrets, finish() never runs), or
 * answers with a reply one byte short and NEWKEYS ('short': finish() fails in computeSecret → doFatalError). The host
 * key and the signature are placeholders: they are only read in finish(), which these modes never reach or which
 * fails before them.
 */
function fakeServer(kexName, mode, seen) {
  return net.createServer((sock) => {
    let buf = Buffer.alloc(0), stage = 'ident';
    sock.write('SSH-2.0-pqtest\r\n');
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (stage === 'ident') { const i = buf.indexOf('\r\n'); if (i < 0) return; buf = buf.subarray(i + 2); stage = 'kexinit'; continue; }
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) return;
        const payload = buf.subarray(5, 4 + len - buf[4]);
        buf = buf.subarray(4 + len);
        if (payload[0] === 20 && stage === 'kexinit') {
          sock.write(packet(Buffer.concat([Buffer.from([20]), crypto.randomBytes(16), nameList([kexName]), nameList(['ssh-ed25519']), nameList(['aes128-ctr']), nameList(['aes128-ctr']), nameList(['hmac-sha2-256']), nameList(['hmac-sha2-256']), nameList(['none']), nameList(['none']), nameList([]), nameList([]), Buffer.from([0]), Buffer.alloc(4)])));
          stage = 'ecdh';
        } else if (payload[0] === 30 && stage === 'ecdh') {
          seen.init = true;
          if (mode === 'hang-before-reply') { stage = 'hang'; return; }
          const kem = pq.kems[kexPQ.METHODS[kexName].kem];
          const qs = crypto.randomBytes(kem.ciphertextBytes + 32 - (mode === 'short' ? 1 : 0));
          const ks = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(Buffer.alloc(32))]);
          const sig = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(Buffer.alloc(64))]);
          sock.write(packet(Buffer.concat([Buffer.from([31]), sshString(ks), sshString(qs), sshString(sig)])));
          if (mode === 'short') sock.write(packet(Buffer.from([21])));
          seen.reply = true;
          stage = 'done';
        }
      }
    });
  });
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what) => { for (let i = 0; i < 300 && !fn(); i++) await settle(10); assert.ok(fn(), what); };
/** The exchange object's secret-bearing fields: the KEM secret key, the X25519 KeyObject, Q_C, Q_S, the reply's host key and signature. */
const holds = (kex) => ({ kemSecret: kex._kemSecret, x25519: kex._x25519, clientPublic: kex._clientPublic, dhData: kex._dhData, hostKey: kex._hostKey, sig: kex._sig });
const assertDisposed = (kex, secretRef) => {
  assert.equal(kex._kemSecret, null, 'KEM secret key reference dropped');
  assert.ok(secretRef.every((b) => b === 0), 'the KEM secret key bytes are zero');
  assert.equal(kex._x25519, null, 'X25519 key released');
  assert.equal(kex._clientPublic, null, 'Q_C dropped');
  assert.equal(kex._dhData, undefined, 'Q_S dropped');
  assert.equal(kex._hostKey, undefined);
  assert.equal(kex._sig, undefined);
};

for (const [kexName, mode, how] of [[MLKEM_NAME, 'hang-before-reply', 'dispose'], [SNTRUP_NAME, 'hang-before-reply', 'destroy'], [MLKEM_NAME, 'hang-after-reply', 'destroy'], [SNTRUP_IANA, 'hang-after-reply', 'dispose'], [MLKEM_NAME, 'short', 'fatal'], [SNTRUP_NAME, 'short', 'fatal']]) {
  test(`${kexName}, ${mode}: ${how === 'dispose' ? 'dispose() as ctx.abort calls it' : how === 'destroy' ? 'client.destroy() alone (Protocol teardown)' : 'a fatal error in finish() (doFatalError)'} leaves no secret in the exchange object`, async () => {
    const seen = {};
    const server = fakeServer(kexName, mode, seen);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { Client } = require('ssh2');
    const client = new Client();
    const errors = [];
    client.on('error', (e) => errors.push(e.message));
    const closed = new Promise((r) => client.once('close', r));
    client.connect({ host: '127.0.0.1', port: server.address().port, username: 'u', password: 'p', algorithms: { kex: [kexName] }, hostVerifier: () => true, readyTimeout: 5000 });
    let kex, secretRef;
    try {
      if (how === 'fatal') {
        await closed;
        kex = client._protocol._kex;
        assert.equal(kex.type, 'pq-hybrid');
        assert.match(errors.join('; '), /Error while computing DH secret \(pq-hybrid\): Server reply is \d+ bytes, expected \d+/);
        secretRef = Buffer.alloc(1); // computeSecret's own finally zeroed and dropped the key before dispose() ran
        secretRef[0] = 0;
      } else {
        await until(() => (mode === 'hang-before-reply' ? seen.init : seen.reply), 'the exchange in flight');
        await settle(80); // the client has parsed the reply (hang-after-reply) and sent its NEWKEYS
        kex = client._protocol._kex;
        assert.equal(kex.type, 'pq-hybrid');
        const h = holds(kex);
        secretRef = h.kemSecret;
        assert.ok(Buffer.isBuffer(h.kemSecret) && h.kemSecret.some((b) => b !== 0), 'the KEM secret key is held while the exchange waits');
        assert.ok(h.x25519 && h.clientPublic, 'the X25519 key and Q_C are held');
        if (mode === 'hang-after-reply') assert.ok(h.dhData && h.dhData.length === pq.kems[kexPQ.METHODS[kexName].kem].ciphertextBytes + 32 && h.hostKey && h.sig, 'Q_S, K_S and the signature are held after the reply');
        if (how === 'dispose') { if (client._protocol && client._protocol._kex && typeof client._protocol._kex.dispose === 'function') client._protocol._kex.dispose(); } // ssh.js ctx.abort
        client.destroy();
        await closed;
      }
      assertDisposed(kex, secretRef);
      kex.dispose(); // idempotent
      assertDisposed(kex, secretRef);
    } finally {
      try { client.destroy(); } catch {}
      await new Promise((r) => server.close(r));
    }
  });
}

// ---------- the key-exchange list a session offers ----------

test('a Mosh session hands the option to its host-key check and its SFTP companion (the renderer\'s two call sites)', () => {
  // the renderer is not loadable here (xterm, the DOM): the arguments of the two IPC calls are read from the source
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'terminal.js'), 'utf8');
  const spawn = /window\.api\.term\.spawnMosh\(\{([^}]*)\}/.exec(src);
  assert.ok(spawn, 'spawnMosh call found');
  assert.match(spawn[1], /\bpqKex: !!s\.pqKex\b/, 'spawnMosh carries pqKex');
  assert.match(spawn[1], /\blegacyAlgorithms: !!s\.legacyAlgorithms\b/);
  const companion = /async openSftpCompanion\(\) \{[\s\S]*?const cfg = \{([\s\S]*?)\};/.exec(src);
  assert.ok(companion, 'the SFTP companion cfg found');
  assert.match(companion[1], /\bpqKex: !!s\.pqKex\b/, 'the companion cfg carries pqKex');
  assert.match(companion[1], /\balgorithms: s\.algorithms\b/);
  // and main's host-key check reads it (term:spawn-mosh → ssh.verifyHost)
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /ssh\.verifyHost\(\{[^}]*\bpqKex: opts\.pqKex\b/);
});

test('connectOption: off, nothing changes; on, the hybrids go in front of the defaults, of the legacy-extended list and of an explicit list (no duplicates)', () => {
  assert.equal(A.connectOption({}), undefined);
  assert.equal(A.connectOption({ pqKex: false }), undefined);
  assert.deepEqual(A.connectOption({ pqKex: true }), { kex: { prepend: HYBRIDS } });
  const legacy = A.connectOption({ pqKex: true, legacyAlgorithms: true });
  assert.deepEqual(legacy.kex, { prepend: HYBRIDS, append: [...A.LEGACY.kex] });
  assert.deepEqual(legacy.cipher, { append: [...A.LEGACY.cipher] }); // the other categories as before
  assert.deepEqual(A.connectOption({ pqKex: true, algorithms: { kex: ['curve25519-sha256', SNTRUP_NAME] } }).kex, [...HYBRIDS, 'curve25519-sha256']);
  assert.deepEqual(A.connectOption({ pqKex: true, algorithms: { kex: [SNTRUP_IANA, 'curve25519-sha256'] } }).kex, [...HYBRIDS, 'curve25519-sha256']);
  assert.deepEqual(A.connectOption({ pqKex: true, algorithms: { cipher: ['aes256-ctr'] } }), { cipher: ['aes256-ctr'], kex: { prepend: HYBRIDS } });
  // an explicit list naming a hybrid works without the option (the names are supported)
  assert.deepEqual(A.connectOption({ algorithms: { kex: [MLKEM_NAME] } }).kex, [MLKEM_NAME]);
  assert.deepEqual(A.connectOption({ algorithms: { kex: [SNTRUP_IANA] } }).kex, [SNTRUP_IANA]);
});

test('offered: the list in KEXINIT order — hybrids first with the option on, the defaults untouched with it off', () => {
  assert.deepEqual(A.offered({}, 'kex'), [...A.DEFAULTS.kex]);
  assert.deepEqual(A.offered({ pqKex: true }, 'kex'), [...HYBRIDS, ...A.DEFAULTS.kex]);
  assert.deepEqual(A.offered({ pqKex: true, legacyAlgorithms: true }, 'kex'), [...HYBRIDS, ...A.DEFAULTS.kex, ...A.LEGACY.kex]);
  assert.deepEqual(A.offered({ pqKex: true, algorithms: { kex: ['ecdh-sha2-nistp256'] } }, 'kex'), [...HYBRIDS, 'ecdh-sha2-nistp256']);
  for (const name of HYBRIDS) assert.ok(!A.DEFAULTS.kex.includes(name) && A.SUPPORTED.kex.includes(name));
  assert.equal(A.offered({ pqKex: true }, 'cipher').join(), A.DEFAULTS.cipher.join());
});

test('validate accepts the hybrid names (and the alias) in a typed list; the editor stores nothing for the option itself in the lists', () => {
  const v = A.validate({ kex: `${MLKEM_NAME}, ${SNTRUP_NAME}, ${SNTRUP_IANA}, curve25519-sha256`, serverHostKey: '', cipher: '', hmac: '' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.kex, [...HYBRIDS, 'curve25519-sha256']);
  assert.equal(A.normalize({ kex: A.DEFAULTS.kex.join(', ') }, false), undefined);
});
