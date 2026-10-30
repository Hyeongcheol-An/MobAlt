#!/bin/bash
# Starts a user-level OpenSSH server on port 2222 (key auth only) for local testing of
# SSH / SFTP / X11 / port-forwarding without touching the system sshd.
#   test/start-sshd.sh start|stop|status
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/sshd-runtime"
PORT="${SSHD_PORT:-2222}"
mkdir -p "$DIR"
chmod 700 "$DIR"

start() {
  if [ -f "$DIR/sshd.pid" ] && kill -0 "$(cat "$DIR/sshd.pid")" 2>/dev/null; then
    echo "already running (pid $(cat "$DIR/sshd.pid")) on port $PORT"; return
  fi
  [ -f "$DIR/host_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -f "$DIR/host_ed25519"
  [ -f "$DIR/client_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C "mobalt-test" -f "$DIR/client_ed25519"
  [ -f "$DIR/client_enc_ed25519" ] || ssh-keygen -q -t ed25519 -N "secret" -C "mobalt-test-enc" -f "$DIR/client_enc_ed25519"
  cat "$DIR/client_ed25519.pub" "$DIR/client_enc_ed25519.pub" > "$DIR/authorized_keys"
  chmod 600 "$DIR/authorized_keys"
  cat > "$DIR/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $DIR/host_ed25519
PidFile $DIR/sshd.pid
AuthorizedKeysFile $DIR/authorized_keys
PubkeyAuthentication yes
PasswordAuthentication no
# OpenSSH 9.8+ penalises sources that connect without authenticating (port scans in the Tools E2E);
# never throttle the test clients.
PerSourcePenalties no
MaxStartups 100:30:200
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
X11Forwarding yes
X11UseLocalhost yes
XAuthLocation /opt/X11/bin/xauth
AllowTcpForwarding yes
GatewayPorts no
PermitTunnel no
LogLevel VERBOSE
Subsystem sftp /usr/libexec/sftp-server
AcceptEnv LANG LC_*
EOF
  /usr/sbin/sshd -f "$DIR/sshd_config" -E "$DIR/sshd.log"
  sleep 0.5
  if [ -f "$DIR/sshd.pid" ]; then
    echo "sshd started on 127.0.0.1:$PORT (pid $(cat "$DIR/sshd.pid"))"
    echo "  key:      $DIR/client_ed25519"
    echo "  enc key:  $DIR/client_enc_ed25519 (passphrase: secret)"
    echo "  test:     ssh -i $DIR/client_ed25519 -p $PORT $(whoami)@127.0.0.1"
  else
    echo "failed to start; see $DIR/sshd.log"; cat "$DIR/sshd.log"; exit 1
  fi
}

stop() {
  if [ -f "$DIR/sshd.pid" ]; then
    kill "$(cat "$DIR/sshd.pid")" 2>/dev/null && echo "stopped" || echo "not running"
    rm -f "$DIR/sshd.pid"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) [ -f "$DIR/sshd.pid" ] && kill -0 "$(cat "$DIR/sshd.pid")" 2>/dev/null && echo "running (pid $(cat "$DIR/sshd.pid"))" || echo "not running" ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 2 ;;
esac
