#!/bin/bash
# Build MobAlt from the current checkout and install it into /Applications.
# Usage: scripts/install-local.sh            (arm64 .app + DMG, then install)
#        scripts/install-local.sh --no-dmg   (unpacked .app only, faster)
set -euo pipefail
cd "$(dirname "$0")/.."
export CSC_IDENTITY_AUTO_DISCOVERY=false
unset ELECTRON_RUN_AS_NODE

# Targets given on the command line override package.json (which lists arm64+x64), so only arm64 is built here.
if [ "${1:-}" = "--no-dmg" ]; then
  npx electron-builder --mac dir --arm64
else
  npx electron-builder --mac dmg --arm64
fi

APP="dist/mac-arm64/MobAlt.app"
[ -d "$APP" ] || { echo "build failed: $APP not found"; exit 1; }

if pgrep -x MobAlt >/dev/null; then
  echo "MobAlt is running; quitting it first"
  osascript -e 'tell application "MobAlt" to quit' || true
  sleep 1
fi
rm -rf /Applications/MobAlt.app
ditto "$APP" /Applications/MobAlt.app
echo "installed /Applications/MobAlt.app ($(defaults read /Applications/MobAlt.app/Contents/Info.plist CFBundleShortVersionString))"
ls dist/*.dmg 2>/dev/null | sed 's/^/dmg: /' || true

# running from source afterwards needs node-pty rebuilt for the host arch
npx electron-rebuild -f -w node-pty >/dev/null 2>&1 || true
