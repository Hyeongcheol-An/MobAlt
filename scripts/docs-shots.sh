#!/bin/bash
# The screenshots of the user guides in every interface language — docs/images/<code>/*.png, English in docs/images/
# (where README.md takes its hero picture too):
#   npm run docs:shots              every shipped language
#   npm run docs:shots -- ko ar     only these
# Each language is one run of test/qa/docs-shots.js (a fresh user-data folder, made-up sessions, nothing personal in
# the pictures) with MOBALT_LANG set. The file-panel picture needs an FTP server on 127.0.0.1:2121 (demo/demo):
# test/ftpd.py (pip install pyftpdlib) is started on a throwaway folder unless something already listens there; the
# browser picture needs test/httpsrv.js on 127.0.0.1:48731, started the same way.
# The status bar in the pictures shows the checkout's version (package.json): run this after a release's version bump
# when the pictures should carry that number.
# Env: FTPD_PYTHON  the python that has pyftpdlib (default: python3)
#      DOCS_SHOTS_OUT  where the runs' work files go (default: a temporary folder)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LANGS=("$@")
[ ${#LANGS[@]} -gt 0 ] || LANGS=(en ko zh-CN ja vi hi de fr es pt ar)
GUIDE_IMAGES=(hero session-editor split-grid sftp-panel tunnels settings browser-session)   # the pictures docs/USER_GUIDE*.md and README.md show
OUT="${DOCS_SHOTS_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/mobalt-docs-shots.XXXXXX")}"
mkdir -p "$OUT"

FTPD_PID=""
HTTPD_PID=""
trap '[ -n "$FTPD_PID" ] && kill "$FTPD_PID" 2>/dev/null; [ -n "$HTTPD_PID" ] && kill "$HTTPD_PID" 2>/dev/null; true' EXIT
if ! lsof -nP -iTCP:2121 -sTCP:LISTEN >/dev/null 2>&1; then
  FTP_ROOT="$OUT/ftp-root"
  mkdir -p "$FTP_ROOT/backups" "$FTP_ROOT/docs" "$FTP_ROOT/photos"
  printf '# nas\n\nShared files of the demo NAS.\n' > "$FTP_ROOT/README.md"
  head -c 54000 /dev/urandom > "$FTP_ROOT/inventory.xlsx"
  head -c 180000 /dev/urandom > "$FTP_ROOT/backups/nightly-2026-10-30.tar.gz"
  head -c 2400 /dev/urandom > "$FTP_ROOT/docs/handbook.pdf"
  head -c 91000 /dev/urandom > "$FTP_ROOT/photos/IMG_0421.jpg"
  "${FTPD_PYTHON:-python3}" test/ftpd.py "$FTP_ROOT" 2121 demo demo > "$OUT/ftpd.log" 2>&1 &
  FTPD_PID=$!
  sleep 2
  kill -0 "$FTPD_PID" 2>/dev/null || { echo "the FTP server did not start (pip install pyftpdlib, or FTPD_PYTHON=…): $OUT/ftpd.log"; exit 1; }
fi

if ! lsof -nP -iTCP:48731 -sTCP:LISTEN >/dev/null 2>&1; then
  node test/httpsrv.js --port 48731 > "$OUT/httpsrv.log" 2>&1 &
  HTTPD_PID=$!
  sleep 1
  kill -0 "$HTTPD_PID" 2>/dev/null || { echo "the web server did not start: $OUT/httpsrv.log"; exit 1; }
fi

for code in "${LANGS[@]}"; do
  echo "=== $code"
  MOBALT_LANG="$code" test/qa/run.sh test/qa/docs-shots.js "$OUT/$code" 90000 > "$OUT/$code.log" 2>&1 || true
  grep -q '\[docs-shots\] DONE' "$OUT/$code.log" || { echo "docs-shots did not finish for $code: $OUT/$code.log"; exit 1; }
  if [ "$code" = en ]; then dest="docs/images"; else dest="docs/images/$code"; fi
  mkdir -p "$dest"
  for n in "${GUIDE_IMAGES[@]}"; do
    cp "$OUT/$code/shots/$n.png" "$dest/$n.png"
    # a 255-colour palette: the interface has a few hundred colours, so nothing visible changes and the file is ~60 % smaller
    if command -v magick >/dev/null 2>&1; then magick "$dest/$n.png" -dither None -colors 255 "PNG8:$dest/$n.png"; fi
  done
  echo "    → $dest/{$(IFS=,; echo "${GUIDE_IMAGES[*]}")}.png"
done
echo "done (work files in $OUT)"
