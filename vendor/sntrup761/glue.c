/*
 * The WebAssembly face of OpenSSH's sntrup761.c (build.sh): four static buffers the host fills and reads through
 * the exported pointers, and one export per KEM operation over them. No heap, no libc: memcpy / memset are the
 * ones the compiler may call for the reference code's loops and struct copies, explicit_bzero the one it calls to
 * wipe secrets, and the optblockers are the volatiles its constant-time helpers read (as kexsntrup761x25519.c
 * defines them in OpenSSH). Public domain.
 */
#include "crypto_api.h"

volatile crypto_int16 crypto_int16_optblocker = 0;
volatile crypto_int32 crypto_int32_optblocker = 0;
volatile crypto_int64 crypto_int64_optblocker = 0;

void
explicit_bzero(void *buf, size_t len)
{
	volatile unsigned char *p = buf;

	while (len-- > 0)
		*p++ = 0;
}

void *
memcpy(void *dst, const void *src, size_t n)
{
	unsigned char *d = dst;
	const unsigned char *s = src;

	while (n-- > 0)
		*d++ = *s++;
	return dst;
}

void *
memset(void *dst, int c, size_t n)
{
	unsigned char *d = dst;

	while (n-- > 0)
		*d++ = (unsigned char)c;
	return dst;
}

static unsigned char PK[crypto_kem_sntrup761_PUBLICKEYBYTES];
static unsigned char SK[crypto_kem_sntrup761_SECRETKEYBYTES];
static unsigned char CT[crypto_kem_sntrup761_CIPHERTEXTBYTES];
static unsigned char K[crypto_kem_sntrup761_BYTES];

__attribute__((export_name("pk"))) unsigned char *sntrup761_pk(void) { return PK; }
__attribute__((export_name("sk"))) unsigned char *sntrup761_sk(void) { return SK; }
__attribute__((export_name("ct"))) unsigned char *sntrup761_ct(void) { return CT; }
__attribute__((export_name("k"))) unsigned char *sntrup761_k(void) { return K; }

/* pk, sk ← keypair() */
__attribute__((export_name("keypair")))
int
sntrup761_keypair(void)
{
	return crypto_kem_sntrup761_keypair(PK, SK);
}

/* ct, k ← enc(pk) */
__attribute__((export_name("enc")))
int
sntrup761_enc(void)
{
	return crypto_kem_sntrup761_enc(CT, K, PK);
}

/* k ← dec(ct, sk) */
__attribute__((export_name("dec")))
int
sntrup761_dec(void)
{
	return crypto_kem_sntrup761_dec(K, CT, SK);
}
