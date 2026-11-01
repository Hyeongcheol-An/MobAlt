#!/bin/bash
# The serial end-to-end check: starts the virtual device (test/serial-device.js, under Electron as Node because node-pty
# is built for Electron), fills its device path and command file into test/e2e-serial.js and runs that in the app;
# the device is stopped afterwards. Screenshots and RESULTS as with test/qa/run.sh.
#   test/e2e-serial.sh <out-dir>
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <out-dir>"; exit 2; }
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -f "$OUT/device.json" "$OUT/device.cmd" "$OUT/device.cmd.out"
ELECTRON_RUN_AS_NODE=1 "$ROOT/node_modules/.bin/electron" "$ROOT/test/serial-device.js" --announce "$OUT/device.json" --cmdfile "$OUT/device.cmd" >"$OUT/device.out" 2>"$OUT/device.log" &
DEV=$!
trap 'kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do [ -s "$OUT/device.json" ] && break; sleep 0.1; done
[ -s "$OUT/device.json" ] || { echo "the virtual device did not come up:"; cat "$OUT/device.log"; exit 1; }
DEVPATH="$(env -u ELECTRON_RUN_AS_NODE node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).path)' "$OUT/device.json")"
echo "virtual serial device on $DEVPATH"
sed -e "s|__SERIAL_PATH__|$DEVPATH|g" -e "s|__CMD_FILE__|$OUT/device.cmd|g" "$ROOT/test/e2e-serial.js" > "$OUT/e2e-serial.js"
bash "$ROOT/test/qa/run.sh" "$OUT/e2e-serial.js" "$OUT" "${2:-120000}"
