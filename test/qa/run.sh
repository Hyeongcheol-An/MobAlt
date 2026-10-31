#!/bin/bash
# Run MobAlt with a renderer-side script injected and collect screenshots.
#   test/qa/run.sh <script.js> <out-dir> [auto-quit-ms]
# Env: MOBALT_APP_DIR  checkout to run (default: this repository)
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: $0 <script.js> <out-dir> [auto-quit-ms]"; exit 2; }
SCRIPT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"   # the app needs absolute paths
DELAY="${3:-60000}"
APP_DIR="${MOBALT_APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$OUT/userdata" "$OUT/shots"
cd "$APP_DIR"
env -u ELECTRON_RUN_AS_NODE \
  MOBALT_LANG="${MOBALT_LANG:-en}" \
  MOBALT_USER_DATA="$OUT/userdata" \
  MOBALT_TEST_SCRIPT="$SCRIPT" \
  MOBALT_SHOT_DIR="$OUT/shots" \
  MOBALT_SCREENSHOT="$OUT/shots/final.png" \
  MOBALT_SCREENSHOT_DELAY="$DELAY" \
  timeout $((DELAY / 1000 + 30)) npx electron . 2>&1 | grep -vE '^\s*$' || true
echo "screenshots: $(ls "$OUT/shots" 2>/dev/null | tr '\n' ' ')"
