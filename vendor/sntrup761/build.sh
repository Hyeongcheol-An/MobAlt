#!/bin/bash
# Builds src/main/pq/sntrup761.wasm — Streamlined NTRU Prime 761 for the sntrup761x25519-sha512@openssh.com key
# exchange — from OpenSSH's public-domain reference implementation in this folder:
#   sntrup761.c    byte for byte openssh-portable/sntrup761.c at tag V_10_6_P1
#                  (commit a8c72b842423f0774f542d3c2197247c3dd28d74; the file's last change 1cc936b2, 2026-01-20,
#                  "$OpenBSD: sntrup761.c,v 1.9"); sha256 61560b7d7f0a6749090ebe807321baab5bfe7d69a861ff28e65b1b459b6549b0
#   crypto_api.h   the subset of OpenSSH's crypto_api.h the file needs (types, sizes, the externals), ours
#   includes.h     a stub that turns the file on (USE_SNTRUP761X25519); string.h a stub for its <string.h>
#   glue.c         static buffers + one export per KEM operation, memcpy/memset/explicit_bzero, the optblockers
# with Emscripten's clang and wasm-ld (brew install emscripten) as a freestanding wasm32 module: no libc, no heap,
# no WASI. Its only imports are env.randombytes and env.crypto_hash_sha512, supplied by src/main/pq/sntrup761.js
# from Node's crypto; its exports are memory, pk/sk/ct/k (buffer pointers), keypair/enc/dec and stack_lo/stack_hi.
# Memory layout (explicit, --stack-first): the C shadow stack is [0, STACK_SIZE), growing down from STACK_SIZE
# (an overflow traps instead of walking into data), the static data follows it; the loader zeroes the whole stack
# after every operation, since the reference code's locals (the shared secret, the small polynomials) stay there.
# The build is deterministic: the same toolchain gives the same bytes (sha256 printed at the end).
#   vendor/sntrup761/build.sh            → src/main/pq/sntrup761.wasm (+ its sha256 and the toolchain version)
set -euo pipefail
cd "$(dirname "$0")"
EM="${EMSCRIPTEN_ROOT:-$(brew --prefix emscripten)}"
CLANG="$EM/libexec/llvm/bin/clang"
OUT="../../src/main/pq/sntrup761.wasm"
STACK_SIZE=262144   # test/unit/pqkex.test.js checks the exported bounds against it
expected=61560b7d7f0a6749090ebe807321baab5bfe7d69a861ff28e65b1b459b6549b0
actual=$(shasum -a 256 sntrup761.c | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "sntrup761.c is not the upstream file (sha256 $actual)"; exit 1; }
"$CLANG" --target=wasm32 -std=gnu99 -O2 -nostdlib -ffreestanding -fno-builtin \
  -Wall -Wextra -Wno-unused-parameter -Wno-unused-function \
  -I. sntrup761.c glue.c -o "$OUT" \
  -Wl,--no-entry -Wl,--strip-all -Wl,--stack-first -Wl,-z,stack-size=$STACK_SIZE \
  -Wl,--initial-memory=1048576 -Wl,--max-memory=1048576
echo "built $OUT with $("$CLANG" --version | head -1)"
shasum -a 256 "$OUT"
