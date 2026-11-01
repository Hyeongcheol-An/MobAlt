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
# from Node's crypto; its exports are memory, pk/sk/ct/k (buffer pointers) and keypair/enc/dec.
#   vendor/sntrup761/build.sh            → src/main/pq/sntrup761.wasm (+ its sha256 and the toolchain version)
set -euo pipefail
cd "$(dirname "$0")"
EM="${EMSCRIPTEN_ROOT:-$(brew --prefix emscripten)}"
CLANG="$EM/libexec/llvm/bin/clang"
OUT="../../src/main/pq/sntrup761.wasm"
expected=61560b7d7f0a6749090ebe807321baab5bfe7d69a861ff28e65b1b459b6549b0
actual=$(shasum -a 256 sntrup761.c | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "sntrup761.c is not the upstream file (sha256 $actual)"; exit 1; }
"$CLANG" --target=wasm32 -std=gnu99 -O2 -nostdlib -ffreestanding -fno-builtin \
  -Wall -Wextra -Wno-unused-parameter -Wno-unused-function \
  -I. sntrup761.c glue.c -o "$OUT" \
  -Wl,--no-entry -Wl,--strip-all -Wl,-z,stack-size=262144 -Wl,--initial-memory=1048576 -Wl,--max-memory=1048576
echo "built $OUT with $("$CLANG" --version | head -1)"
shasum -a 256 "$OUT"
