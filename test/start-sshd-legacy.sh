#!/bin/bash
# A second user-level OpenSSH server on 127.0.0.1:2223 that speaks only the old algorithms — the SHA-1 key exchanges
# (diffie-hellman-group14-sha1 first, then the 1024-bit group1-sha1, as an old device offers them) and the CBC ciphers.
# It is what "Legacy algorithms (old devices)" is checked against: a session on the defaults must fail with the
# "tick Legacy algorithms" hint, the preset must connect (and install a key). Same host key, client keys and
# authorized_keys as test/start-sshd.sh, which must have been started once (it generates them).
#   test/start-sshd-legacy.sh start|stop|status
# test/e2e-algorithms.js starts and stops it itself, through an exec on the 2222 sshd.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/sshd-runtime"
PORT="${SSHD_LEGACY_PORT:-2223}"
PIDFILE="$DIR/sshd-legacy.pid"
CONF="$DIR/sshd_legacy_config"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running (pid $(cat "$PIDFILE")) on port $PORT"; return
  fi
  [ -f "$DIR/host_ed25519" ] && [ -f "$DIR/authorized_keys" ] || { echo "run test/start-sshd.sh start first (it creates the keys)"; exit 1; }
  cat > "$CONF" <<EOC
Port $PORT
ListenAddress 127.0.0.1
HostKey $DIR/host_ed25519
PidFile $PIDFILE
AuthorizedKeysFile $DIR/authorized_keys
PubkeyAuthentication yes
PasswordAuthentication no
PerSourcePenalties no
MaxStartups 100:30:200
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
X11Forwarding no
AllowTcpForwarding yes
LogLevel VERBOSE
KexAlgorithms diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
Ciphers aes128-cbc,aes256-cbc,3des-cbc
Subsystem sftp /usr/libexec/sftp-server
EOC
  /usr/sbin/sshd -f "$CONF" -E "$DIR/sshd-legacy.log"
  sleep 0.5
  if [ -f "$PIDFILE" ]; then
    echo "legacy sshd started on 127.0.0.1:$PORT (pid $(cat "$PIDFILE")): group14-sha1 + group1-sha1 KEX, CBC ciphers"
  else
    echo "failed to start; see $DIR/sshd-legacy.log"; cat "$DIR/sshd-legacy.log"; exit 1
  fi
}

stop() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null && echo "stopped" || echo "not running"
    rm -f "$PIDFILE"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && echo "running (pid $(cat "$PIDFILE"))" || echo "not running" ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 2 ;;
esac
