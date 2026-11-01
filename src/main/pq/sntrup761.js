'use strict';
// Streamlined NTRU Prime 761 (sntrup761), the KEM of the sntrup761x25519-sha512@openssh.com key exchange: OpenSSH's
// public-domain reference implementation (vendor/sntrup761/sntrup761.c, byte for byte openssh-portable's) compiled
// to WebAssembly by vendor/sntrup761/build.sh. The module has no heap and no libc; its randomness and its SHA-512
// come from Node's crypto through the two imports below, so the WebAssembly only ever does the NTRU Prime
// arithmetic. One static buffer per value inside the module (pk, sk, ct, k): the host copies in, runs the
// operation, copies out and wipes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLICKEYBYTES = 1158;
const SECRETKEYBYTES = 1763;
const CIPHERTEXTBYTES = 1039;
const BYTES = 32;

let wasm = null;
/** The instantiated module (loaded on first use, synchronously: a 50 KB module, well under a millisecond). */
function instance() {
  if (wasm) return wasm;
  const bytes = fs.readFileSync(path.join(__dirname, 'sntrup761.wasm'));
  let memory = null;
  const view = (ptr, len) => new Uint8Array(memory.buffer, ptr, len);
  const imports = {
    env: {
      randombytes: (ptr, len) => { crypto.randomFillSync(view(ptr, len)); },
      crypto_hash_sha512: (out, inp, inlen) => {
        view(out, 64).set(crypto.createHash('sha512').update(view(inp, Number(inlen))).digest());
        return 0;
      },
    },
  };
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
  memory = inst.exports.memory;
  if (typeof inst.exports._initialize === 'function') inst.exports._initialize();
  const e = inst.exports;
  wasm = {
    pk: () => view(e.pk(), PUBLICKEYBYTES),
    sk: () => view(e.sk(), SECRETKEYBYTES),
    ct: () => view(e.ct(), CIPHERTEXTBYTES),
    k: () => view(e.k(), BYTES),
    keypair: e.keypair,
    enc: e.enc,
    dec: e.dec,
  };
  return wasm;
}

const sized = (what, buf, len) => {
  if (!(buf instanceof Uint8Array) || buf.length !== len) throw new Error(`sntrup761: ${what} must be ${len} bytes`);
  return buf;
};

/** A fresh key pair: { publicKey (1158 bytes), secretKey (1763 bytes) }. */
function keygen() {
  const w = instance();
  if (w.keypair() !== 0) throw new Error('sntrup761: keypair failed');
  const publicKey = Buffer.from(w.pk());
  const secretKey = Buffer.from(w.sk());
  w.sk().fill(0);
  return { publicKey, secretKey };
}

/** Encapsulate to a public key: { cipherText (1039 bytes), sharedSecret (32 bytes) }. The server's side; here for the tests. */
function encapsulate(publicKey) {
  const w = instance();
  w.pk().set(sized('public key', publicKey, PUBLICKEYBYTES));
  if (w.enc() !== 0) throw new Error('sntrup761: enc failed');
  const cipherText = Buffer.from(w.ct());
  const sharedSecret = Buffer.from(w.k());
  w.k().fill(0);
  return { cipherText, sharedSecret };
}

/** The 32-byte shared secret of a ciphertext (a wrong ciphertext gives an unrelated secret, never an error: implicit rejection). */
function decapsulate(cipherText, secretKey) {
  const w = instance();
  w.ct().set(sized('ciphertext', cipherText, CIPHERTEXTBYTES));
  w.sk().set(sized('secret key', secretKey, SECRETKEYBYTES));
  const rc = w.dec();
  w.sk().fill(0);
  if (rc !== 0) throw new Error('sntrup761: dec failed');
  const sharedSecret = Buffer.from(w.k());
  w.k().fill(0);
  return sharedSecret;
}

module.exports = {
  publicKeyBytes: PUBLICKEYBYTES,
  secretKeyBytes: SECRETKEYBYTES,
  ciphertextBytes: CIPHERTEXTBYTES,
  sharedSecretBytes: BYTES,
  keygen,
  encapsulate,
  decapsulate,
};
