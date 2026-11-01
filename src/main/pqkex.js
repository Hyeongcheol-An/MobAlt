'use strict';
// Post-quantum key exchange: the two hybrid methods ssh2 learns from patches/ssh2+1.17.0.patch
// (lib/protocol/kex-pq.js) and the KEMs behind them, registered here once —
//   mlkem768x25519-sha256               ML-KEM-768 from @noble/post-quantum   (OpenSSH 9.9+, the default of OpenSSH 10)
//   sntrup761x25519-sha512@openssh.com  sntrup761 from OpenSSH's reference C, as WebAssembly (OpenSSH 8.9+; ./pq/sntrup761.js)
// — plus X25519 from Node's crypto, so the exchange stays classical-strength whatever happens to the KEM. Off by
// default: a session with `pqKex: true` offers both first (algorithms.js prepends them), the rest of its lists as
// before. Loading this module is the registration (algorithms.js requires it before any connection).
const kexPQ = require('ssh2/lib/protocol/kex-pq');
const { ml_kem768 } = require('@noble/post-quantum/ml-kem.js');
const sntrup761 = require('./pq/sntrup761');

const mlkem768 = Object.freeze({
  publicKeyBytes: 1184,
  ciphertextBytes: 1088,
  keygen: () => ml_kem768.keygen(),
  decapsulate: (cipherText, secretKey) => ml_kem768.decapsulate(cipherText, secretKey),
});

kexPQ.register('mlkem768', mlkem768);
kexPQ.register('sntrup761', sntrup761);

/** The hybrid methods a session offers first when its option is on: ML-KEM (newer servers) before sntrup761. */
const KEX = Object.freeze(['mlkem768x25519-sha256', 'sntrup761x25519-sha512@openssh.com']);

/** Whether a negotiated key-exchange name is one of the post-quantum hybrids. */
const isHybrid = (name) => Object.prototype.hasOwnProperty.call(kexPQ.METHODS, name);

module.exports = { KEX, isHybrid, kems: { mlkem768, sntrup761 }, kexPQ };
