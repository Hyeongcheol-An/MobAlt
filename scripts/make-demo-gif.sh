#!/usr/bin/env bash
# Assemble the README demo (docs/images/demo.gif) from the frames test/qa/demo-frames.js saved.
#
#   scripts/make-demo-gif.sh <frames-dir> [out.gif] [--no-captions]
#   npm run demo                      # runs the harness into test/shots/demo, then this script
#
# Frames are <frames-dir>/fNNN-<phase>-<hold>.png: frame number, story phase (its caption is in CAPTIONS below) and
# how long the frame shows, in 1/100 s (a frame without phase/hold gets DEFAULT_HOLD). Every frame is scaled to
# WIDTH px, the caption is burnt into a translucent bar along the bottom, and the GIF is written with one global
# palette of COLORS colours and frame-difference optimisation so it stays well under 4 MB. The first frame also
# goes out, unscaled by the caption, as docs/images/demo-poster.png (POSTER_WIDTH px wide).
#
# Needs magick only (brew install imagemagick) — no ffmpeg, gifsicle or gifski. The harness that makes the frames
# needs the throwaway FTP server on 127.0.0.1:2121 (user demo / demo) serving a scratch root with a few folders
# and files — nothing personal, it is what the file browser shows:
#   uv run --with pyftpdlib python3 test/ftpd.py /path/to/scratch-root 2121 demo demo &
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIDTH="${WIDTH:-880}"
COLORS="${COLORS:-128}"
DEFAULT_HOLD=150
POSTER_WIDTH=660
BAR=30          # caption bar height (px) at WIDTH
POINTSIZE=15
CAPTIONS=1

caption() {   # phase -> caption
  case "$1" in
    sessions)  echo "Session tree: folders, icons and colours — double-click to connect" ;;
    shell)     echo "Tabbed terminals: SSH, local shells, telnet, serial and mosh" ;;
    sftp)      echo "A file browser opens with every SSH / FTP connection" ;;
    split)     echo "Split a tab right, down or into a grid of up to 8 panes" ;;
    multiexec) echo "MultiExec (⇧⌘M): one keystroke reaches every visible terminal" ;;
    zoom)      echo "Zoom a pane (⇧⌘⏎) and bring the layout back" ;;
    theme)     echo "Themes colour the whole window — Moba Dark, One Dark, Dracula, Light…" ;;
    end)       echo "MobAlt — a MobaXterm-style workbench for macOS" ;;
    *)         echo "" ;;
  esac
}

die() { echo "make-demo-gif: $*" >&2; exit 1; }
command -v magick >/dev/null 2>&1 || die "'magick' not found. Install it with: brew install imagemagick"

FRAMES="" OUT=""
for arg in "$@"; do
  case "$arg" in
    --no-captions) CAPTIONS=0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) if [[ -z $FRAMES ]]; then FRAMES="$arg"; elif [[ -z $OUT ]]; then OUT="$arg"; else die "unexpected argument: $arg"; fi ;;
  esac
done
[[ -n $FRAMES ]] || die "usage: $0 <frames-dir> [out.gif] [--no-captions]"
[[ -d $FRAMES ]] || die "not a folder: $FRAMES"
OUT="${OUT:-$ROOT/docs/images/demo.gif}"
POSTER="$(dirname "$OUT")/$(basename "$OUT" .gif)-poster.png"

# a font that has the ⇧⌘⏎ glyphs first (SF), then Helvetica / Arial
FONT=""
for f in /System/Library/Fonts/SFNS.ttf /System/Library/Fonts/Helvetica.ttc /System/Library/Fonts/Supplemental/Arial.ttf; do
  [[ -f $f ]] && { FONT="$f"; break; }
done
[[ -n $FONT ]] || CAPTIONS=0

shopt -s nullglob
SRC=("$FRAMES"/f[0-9]*.png)
(( ${#SRC[@]} )) || die "no fNNN*.png frames in $FRAMES"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

args=()
total=0
i=0
for src in "${SRC[@]}"; do
  base="$(basename "$src" .png)"
  IFS=- read -r _num phase hold <<<"$base"
  [[ ${hold:-} =~ ^[0-9]+$ ]] || hold=$DEFAULT_HOLD
  i=$((i + 1))
  dst="$TMP/$(printf '%03d' "$i").png"
  text=""
  (( CAPTIONS )) && text="$(caption "${phase:-}")"
  if [[ -n $text ]]; then
    # the bar is its own translucent image with the caption on it, laid over the bottom of the scaled frame
    magick "$src" -resize "${WIDTH}x" \
      \( -size "${WIDTH}x${BAR}" xc:'rgba(0,0,0,0.62)' -font "$FONT" -pointsize "$POINTSIZE" -fill white -gravity center -annotate +0+0 "$text" \) \
      -gravity south -composite "$dst"
  else
    magick "$src" -resize "${WIDTH}x" "$dst"
  fi
  args+=(-delay "$hold" "$dst")
  total=$((total + hold))
done

# one palette for every frame (per-frame palettes cost more and flicker), then the frame-difference optimisation
magick "$TMP"/[0-9]*.png -append +dither -colors "$COLORS" -unique-colors "$TMP/palette.png"
mkdir -p "$(dirname "$OUT")"
magick "${args[@]}" -loop 0 +dither -remap "$TMP/palette.png" -layers Optimize "$OUT"

# poster: the first frame without the caption bar
magick "${SRC[0]}" -resize "${POSTER_WIDTH}x" -strip -define png:compression-level=9 "$POSTER"

frames="$(magick identify "$OUT" | wc -l | tr -d ' ')"
size="$(stat -f %z "$OUT")"
printf 'make-demo-gif: %s — %d frames, %d.%02d s, %d bytes (%.2f MB)\n' "$OUT" "$frames" $((total / 100)) $((total % 100)) "$size" "$(echo "$size / 1048576" | bc -l)"
printf 'make-demo-gif: %s — %s bytes\n' "$POSTER" "$(stat -f %z "$POSTER")"
(( size <= 4 * 1024 * 1024 )) || die "the GIF is over 4 MB; lower COLORS or WIDTH"
