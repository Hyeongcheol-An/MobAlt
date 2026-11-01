'use strict';
// Post-quantum key exchange: the two hybrid methods ssh2 learns from patches/ssh2+1.17.0.patch
// (lib/protocol/kex-pq.js) and the KEMs behind them, registered here once —
//   mlkem768x25519-sha256               ML-KEM-768 from @noble/post-quantum   (OpenSSH 9.9+, the default of OpenSSH 10)
//   sntrup761x25519-sha512@openssh.com  sntrup761 from OpenSSH's reference C, as WebAssembly (OpenSSH 8.5+, on by
//   (and its IANA name sntrup761x25519-sha512)  default from 9.0; ./pq/sntrup761.js)
// — plus X25519 from Node's crypto, so the exchange stays classical-strength whatever happens to the KEM. Off by
// default: a session with `pqKex: true` offers both first (algorithms.js prepends them), the rest of its lists as
// before. Loading this module is the registration (algorithms.js requires it before any connection). The exchange
// lives in the ssh2 patch: a build whose postinstall did not apply it (an ssh2 bump, say) still starts — the option
// is then unavailable (KEX empty, the editor says so) and a warning is logged.
const sntrup761 = require('./pq/sntrup761');

// @noble/post-quantum is loaded by the first ML-KEM key generation, not at startup (algorithms.js requires this
// module while the app comes up; the library costs ~10 ms to load)
let mlkem = null;
const mlKem768 = () => mlkem || (mlkem = require('@noble/post-quantum/ml-kem.js').ml_kem768);

let kexPQ = null;
try {
  kexPQ = require('ssh2/lib/protocol/kex-pq');
} catch (e) {
  console.warn(`post-quantum key exchange unavailable: ssh2 is not patched (patches/ssh2+1.17.0.patch, patch-package): ${e.message}`);
}

const mlkem768 = Object.freeze({
  publicKeyBytes: 1184,
  ciphertextBytes: 1088,
  keygen: () => mlKem768().keygen(),
  decapsulate: (cipherText, secretKey) => mlKem768().decapsulate(cipherText, secretKey),
});

if (kexPQ) {
  kexPQ.register('mlkem768', mlkem768);
  kexPQ.register('sntrup761', sntrup761);
}

/**
 * The hybrid methods a session offers first when its option is on: ML-KEM (newer servers), then sntrup761 under
 * its OpenSSH name and its IANA name (the same exchange; OpenSSH 9.9+ offers both, TinySSH only the latter).
 * Empty when ssh2 is not patched.
 */
const KEX = Object.freeze(kexPQ ? ['mlkem768x25519-sha256', 'sntrup761x25519-sha512@openssh.com', 'sntrup761x25519-sha512'] : []);

/** Whether a negotiated key-exchange name is one of the post-quantum hybrids. */
const isHybrid = (name) => !!kexPQ && Object.prototype.hasOwnProperty.call(kexPQ.METHODS, name);

module.exports = { KEX, available: !!kexPQ, isHybrid, kems: { mlkem768, sntrup761 }, kexPQ };
