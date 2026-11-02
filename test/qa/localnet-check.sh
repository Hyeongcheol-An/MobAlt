#!/bin/bash
# The macOS Local Network permission, seen from the app itself (see src/main/localnet.js).
#
# Launches the app through LaunchServices (`open`), so the app — not the shell it was started from — is the process
# macOS judges (a run started from a terminal is attributed to that terminal and goes through), and runs
# test/qa/localnet-check.js against a host on this Mac's local network: the default gateway, unless LOCALNET_HOST
# names one. The script connects by SSH and Telnet, pings from the Tools panel, and reports on one RESULTS line
# whether this Mac refused the connections (EHOSTUNREACH), whether the pane carried the hint about the permission,
# and whether the dialog that opens the setting was shown once and only once (it answers it with "Later").
# When the app is allowed on the local network the connections go through instead — then there is nothing to see
# and the line says so (permissionGranted).
#
#   test/qa/localnet-check.sh [out-dir]                               the dev checkout (node_modules/electron)
#   MOBALT_APP=dist-qa/mac-arm64/MobAlt.app test/qa/localnet-check.sh the packaged app — a `npm run pack:qa` build:
#                                                                     release builds ignore MOBALT_TEST_SCRIPT
#                                                                     (src/main/testgate.js), so no RESULTS line
#   MOBALT_LANG=ko test/qa/localnet-check.sh                          the hint and the dialog in another language
set -u
unset ELECTRON_RUN_AS_NODE # an IDE's terminal sets it, `open` passes it on, and Electron would then run main.js as plain Node
R="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/mobalt-localnet-check}"
rm -rf "$OUT"; mkdir -p "$OUT/userdata" "$OUT/shots"
HOST="${LOCALNET_HOST:-$(route -n get default 2>/dev/null | awk '/gateway:/ {print $2}')}"
[ -n "$HOST" ] || { echo "no default gateway found; set LOCALNET_HOST=<address on your LAN>"; exit 2; }
# the run's own user data: no update check (its dialog would be native), no quit confirmation, English unless asked
printf '{"autoUpdate":false,"confirmClose":false,"sftpAutoOpen":false,"language":"en"}\n' > "$OUT/userdata/settings.json"
printf '%s\n' "$HOST" > "$OUT/userdata/localnet-host.txt"
ENV=(--env MOBALT_LANG="${MOBALT_LANG:-en}" --env MOBALT_USER_DATA="$OUT/userdata" --env MOBALT_TEST_SCRIPT="$R/test/qa/localnet-check.js" --env MOBALT_SHOT_DIR="$OUT/shots")
echo "host $HOST, output in $OUT"
if [ -n "${MOBALT_APP:-}" ]; then
  perl -e 'alarm 120; exec @ARGV' open -n -W -a "$MOBALT_APP" --stdout "$OUT/stdout.log" --stderr "$OUT/stderr.log" "${ENV[@]}"
else
  perl -e 'alarm 120; exec @ARGV' open -n -W -a "$R/node_modules/electron/dist/Electron.app" --stdout "$OUT/stdout.log" --stderr "$OUT/stderr.log" "${ENV[@]}" --args "$R"
fi
grep -E '\[localnet-check\] RESULTS' "$OUT/stdout.log" || { echo "no RESULTS line; see $OUT/stdout.log and $OUT/stderr.log"; exit 1; }
