#!/usr/bin/env bash
# Render MobAlt's brand assets from the SVG sources in build/src/.
#
#   build/src/icon.svg           -> build/icon.png (1024)
#                                   build/icon.iconset/ (gitignored) -> build/icon.icns
#                                   docs/images/icon.png (256, README hero)
#   build/src/dmg-background.svg -> build/dmg-background.png (600x400)
#                                   build/dmg-background@2x.png (1200x800, Retina)
#
# Needs rsvg-convert (brew install librsvg), magick (brew install imagemagick) and iconutil (macOS).
# Usage: npm run assets   (same as: bash scripts/make-assets.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/src"
BUILD="$ROOT/build"
ICONSET="$BUILD/icon.iconset"

die() { echo "make-assets: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found. $2"; }

need rsvg-convert "Install it with: brew install librsvg"
need magick "Install it with: brew install imagemagick"
need iconutil "It ships with macOS; the .icns can only be assembled on a Mac."
[[ -f "$SRC/icon.svg" ]] || die "missing $SRC/icon.svg"
[[ -f "$SRC/dmg-background.svg" ]] || die "missing $SRC/dmg-background.svg"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# render <svg> <width> <height> <out.png> [magick args...]
# rsvg-convert does the rasterising (crisp at every size, no downscaling); magick strips the text
# chunks it writes so re-renders are byte-stable, recompresses losslessly (-quality 95 = zlib 9 +
# adaptive filter) and applies any extra args (e.g. flattening).
render() {
  local svg="$1" w="$2" h="$3" out="$4"; shift 4
  rsvg-convert -w "$w" -h "$h" "$svg" -o "$TMP/r.png"
  magick "$TMP/r.png" "$@" -strip -quality 95 "$out"
}

echo "icon: build/icon.png (1024)"
render "$SRC/icon.svg" 1024 1024 "$BUILD/icon.png"

echo "icon: build/icon.iconset -> build/icon.icns"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  render "$SRC/icon.svg" "$s" "$s" "$ICONSET/icon_${s}x${s}.png"
  render "$SRC/icon.svg" $((s * 2)) $((s * 2)) "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"

echo "icon: docs/images/icon.png (256)"
mkdir -p "$ROOT/docs/images"
render "$SRC/icon.svg" 256 256 "$ROOT/docs/images/icon.png"

# Finder wants an opaque background; the SVG is fully painted, so drop the alpha channel.
echo "dmg: build/dmg-background.png (600x400) + @2x (1200x800)"
render "$SRC/dmg-background.svg" 600 400 "$BUILD/dmg-background.png" -background '#0c1428' -alpha remove -alpha off
render "$SRC/dmg-background.svg" 1200 800 "$BUILD/dmg-background@2x.png" -background '#0c1428' -alpha remove -alpha off

echo "done"
