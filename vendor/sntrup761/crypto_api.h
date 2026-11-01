/*
 * crypto_api.h for the WebAssembly build of OpenSSH's sntrup761.c (build.sh): the subset of OpenSSH's own
 * crypto_api.h that the reference code uses — the integer typedefs, the sntrup761 sizes and the three externals.
 * The randomness and the SHA-512 are imported from the host (src/main/pq/sntrup761.js, Node's crypto): nothing
 * in the module makes random numbers or hashes on its own. Placed in the public domain, as the original.
 */
#ifndef crypto_api_h
#define crypto_api_h

#include <stdint.h>
#include <stddef.h>

typedef int8_t crypto_int8;
typedef uint8_t crypto_uint8;
typedef int16_t crypto_int16;
typedef uint16_t crypto_uint16;
typedef int32_t crypto_int32;
typedef uint32_t crypto_uint32;
typedef int64_t crypto_int64;
typedef uint64_t crypto_uint64;

/* host imports (module "env"): see src/main/pq/sntrup761.js */
__attribute__((import_module("env"), import_name("randombytes")))
void randombytes(void *buf, size_t len);
#define crypto_hash_sha512_BYTES 64U
__attribute__((import_module("env"), import_name("crypto_hash_sha512")))
int crypto_hash_sha512(unsigned char *out, const unsigned char *in, unsigned long long inlen);

/* glue.c */
void explicit_bzero(void *buf, size_t len);

#define crypto_kem_sntrup761_PUBLICKEYBYTES 1158
#define crypto_kem_sntrup761_SECRETKEYBYTES 1763
#define crypto_kem_sntrup761_CIPHERTEXTBYTES 1039
#define crypto_kem_sntrup761_BYTES 32
int	crypto_kem_sntrup761_enc(unsigned char *cstr, unsigned char *k,
    const unsigned char *pk);
int	crypto_kem_sntrup761_dec(unsigned char *k,
    const unsigned char *cstr, const unsigned char *sk);
int	crypto_kem_sntrup761_keypair(unsigned char *pk, unsigned char *sk);

#endif /* crypto_api_h */
