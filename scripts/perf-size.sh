#!/bin/bash
# Bundle size by part, for docs/PERFORMANCE.md and `npm run perf`:
#   scripts/perf-size.sh [MobAlt.app] [MobAlt.dmg]
# Defaults: dist/mac-arm64/MobAlt.app (npm run pack) and the newest dist/*-arm64.dmg if there is one.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-dist/mac-arm64/MobAlt.app}"
DMG="${2:-$(ls -t dist/*-arm64.dmg 2>/dev/null | head -1 || true)}"
[ -d "$APP" ] || { echo "no app at $APP (npm run pack)"; exit 1; }
k() { du -sk "$1" 2>/dev/null | cut -f1; }
sumk() { du -sk "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }
row() { printf "| %-52s | %8.1f |\n" "$1" "$(awk -v k="$2" 'BEGIN { print k/1024 }')"; }
FW="$APP/Contents/Frameworks/Electron Framework.framework/Versions/A"
echo "| Part | MB |"
echo "|---|---:|"
row "MobAlt.app" "$(k "$APP")"
row "Electron Framework.framework" "$(k "$APP/Contents/Frameworks/Electron Framework.framework")"
row "  binary" "$(k "$FW/Electron Framework")"
row "  Resources (resources.pak, icudtl.dat, snapshots)" "$(k "$FW/Resources")"
LPROJ_N=$(ls -d "$FW"/Resources/*.lproj 2>/dev/null | wc -l | tr -d ' ')
row "    of which $LPROJ_N × *.lproj (Chromium's locales)" "$(sumk "$FW"/Resources/*.lproj)"
row "  Libraries (libvk_swiftshader, libffmpeg)" "$(k "$FW/Libraries")"
row "Helpers, Squirrel, Mantle, ReactiveObjC" "$(( $(k "$APP/Contents/Frameworks") - $(k "$APP/Contents/Frameworks/Electron Framework.framework") ))"
row "app.asar" "$(k "$APP/Contents/Resources/app.asar")"
row "app.asar.unpacked (native modules)" "$(k "$APP/Contents/Resources/app.asar.unpacked")"
row "LICENSES.chromium.html" "$(k "$APP/Contents/Resources/LICENSES.chromium.html")"
APP_LPROJ_N=$(ls -d "$APP"/Contents/Resources/*.lproj 2>/dev/null | wc -l | tr -d ' ')
row "$APP_LPROJ_N × *.lproj in Contents/Resources (the app's)" "$(sumk "$APP"/Contents/Resources/*.lproj)"
if [ -n "$DMG" ] && [ -f "$DMG" ]; then row "$(basename "$DMG")" "$(k "$DMG")"; fi
echo
node test/qa/perf-asar.js "$APP/Contents/Resources/app.asar"
