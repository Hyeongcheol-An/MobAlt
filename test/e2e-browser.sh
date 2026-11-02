#!/bin/bash
# The browser-session end-to-end check, both phases, with the web site it needs (test/httpsrv.js on 127.0.0.1:42510):
#   test/e2e-browser.sh <out-dir>
# Phase 1 (test/e2e-browser.js) drives the pane and leaves a browser tab saved in the workspace; phase 2
# (test/e2e-browser-verify.js, the same out-dir) checks that it comes back at the page it was on. The site is started
# for the run and stopped after it; its request log is <out-dir>/httpsrv.log. Prints both RESULTS lines at the end.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <out-dir>"; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
PORT=42510
if nc -z 127.0.0.1 $PORT 2>/dev/null; then echo "something already listens on 127.0.0.1:$PORT"; exit 1; fi
env -u ELECTRON_RUN_AS_NODE node "$ROOT/test/httpsrv.js" --port $PORT --log "$OUT/httpsrv.log" >"$OUT/httpsrv.out" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.5
rm -rf "$OUT/userdata" # a clean workspace: phase 2 must see what phase 1 saved, nothing older
bash "$ROOT/test/qa/run.sh" "$ROOT/test/e2e-browser.js" "$OUT" 180000 | tee "$OUT/phase1.log"
bash "$ROOT/test/qa/run.sh" "$ROOT/test/e2e-browser-verify.js" "$OUT" 60000 | tee "$OUT/phase2.log"
echo "---- results"
grep -h "RESULTS\|ALL OK\|FAILED" "$OUT/phase1.log" "$OUT/phase2.log" || true
