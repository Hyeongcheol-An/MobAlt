#!/bin/bash
# The throwaway servers of the SSH-edge-case and telnet end-to-end checks (test/e2e-ssh-cancel.js, test/e2e-telnet.js),
# all on 127.0.0.1, logs and pids under $MOBALT_E2E_SERVERS (default /tmp/mobalt-e2e-servers — the scripts read the
# logs from there). Needs the test sshd (test/start-sshd.sh start) for the delay proxy's target and the host key.
#   test/start-servers.sh start|stop|status
#   42500  delay proxy: silent for 6 s, then relays to the test sshd on 2222   (test/tcpsrv.js)
#   42501  accepts and closes at once                                          (test/tcpsrv.js)
#   42502  sends an SSH banner, then closes                                    (test/tcpsrv.js)
#   42503  telnet host: "login: ", then echoes                                 (test/tcpsrv.js)
#   42504  ssh2 server, password only (qa / qa-pass-1), no sftp                (test/sshsrv.js)
#   42505  ssh2 server, keyboard-interactive only (code 4242), no sftp         (test/sshsrv.js)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${MOBALT_E2E_SERVERS:-/tmp/mobalt-e2e-servers}"
mkdir -p "$DIR"
PIDS="$DIR/pids"

start_one() { # name, command...
  local name="$1"; shift
  rm -f "$DIR/$name.log"
  env -u ELECTRON_RUN_AS_NODE "$@" --log "$DIR/$name.log" >"$DIR/$name.out" 2>&1 &
  echo "$! $name" >> "$PIDS"
}

start() {
  if [ -f "$PIDS" ] && kill -0 "$(head -1 "$PIDS" | cut -d' ' -f1)" 2>/dev/null; then echo "already running ($PIDS)"; return; fi
  [ -f "$ROOT/test/sshd-runtime/host_ed25519" ] || { echo "start the test sshd first: test/start-sshd.sh start"; exit 1; }
  : > "$PIDS"
  start_one delayproxy node "$ROOT/test/tcpsrv.js" --port 42500 --mode delayproxy --delay 6 --target 127.0.0.1:2222
  start_one close node "$ROOT/test/tcpsrv.js" --port 42501 --mode close
  start_one banner-close node "$ROOT/test/tcpsrv.js" --port 42502 --mode banner-close
  start_one telnet node "$ROOT/test/tcpsrv.js" --port 42503 --mode telnet-login
  start_one sshpw node "$ROOT/test/sshsrv.js" --port 42504 --mode password
  start_one sshkbd node "$ROOT/test/sshsrv.js" --port 42505 --mode kbdint
  sleep 0.7
  status
}

stop() {
  [ -f "$PIDS" ] || { echo "not running"; return; }
  while read -r pid name; do kill "$pid" 2>/dev/null && echo "stopped $name ($pid)" || true; done < "$PIDS"
  rm -f "$PIDS"
}

status() {
  [ -f "$PIDS" ] || { echo "not running"; return 1; }
  local ok=0
  while read -r pid name; do
    if kill -0 "$pid" 2>/dev/null; then echo "$name running ($pid): $(tail -1 "$DIR/$name.log" 2>/dev/null)"; else echo "$name NOT running: $(cat "$DIR/$name.out" 2>/dev/null | tail -2)"; ok=1; fi
  done < "$PIDS"
  return $ok
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
