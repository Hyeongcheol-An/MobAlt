'use strict';
// Remote monitoring bar (MobaXterm's CPU / RAM / disk / net strip): one portable `sh` snippet runs over an exec
// channel of the pane's own ssh2 connection, prints a single `MOBALT_MON k=v …` line, and parseMonitorOutput turns
// it into a sample. Counters (CPU jiffies, network bytes) are left raw by the snippet; the parser derives the rates
// from the previous sample, so a poll costs one short exec and no sleep on the host.
//
// The snippet runs as `sh -c '…'` so it reads the same whatever the login shell is (fish, csh, zsh, bash, busybox
// ash): it is ONE line with no single quote, no backslash and no `!` — the only characters those shells treat
// specially inside single quotes. Inside it only POSIX sh is used (read, case, ${…} and $((…)): no awk, sed, grep
// or tail), which busybox and dash have. Case arms are written `(pattern)`: bash 3.2 (macOS's /bin/sh) cannot
// parse a bare `pattern)` inside `$( … )`.

const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()
const SENTINEL = 'MOBALT_MON ';
const EXEC_TIMEOUT = 10000; // a poll that takes longer than this is abandoned (the channel is closed)

const MONITOR_SCRIPT = `
LC_ALL=C; export LC_ALL; set -f; P=/proc;
h=$(hostname 2>/dev/null) || h=$(uname -n 2>/dev/null);
os=other; cb=; ct=; cp=; nc=; mt=; mu=; rx=; tx=; l1=; l5=; l15=; up=;
if [ -r $P/stat ] && [ -r $P/meminfo ]; then
  os=linux;
  read -r c u n s i w q sq st x < $P/stat;
  cb=$((u+n+s+\${q:-0}+\${sq:-0}+\${st:-0})); ct=$((cb+i+\${w:-0}));
  mt=0; mf=0; ma=; bu=0; ca=0;
  while read -r k v x; do case "$k" in (MemTotal:) mt=$v;; (MemFree:) mf=$v;; (MemAvailable:) ma=$v;; (Buffers:) bu=$v;; (Cached:) ca=$v;; esac; done < $P/meminfo;
  [ -n "$ma" ] || ma=$((mf+bu+ca));
  mu=$(((mt-ma)*1024)); mt=$((mt*1024));
  rx=0; tx=0;
  if [ -r $P/net/dev ]; then while read -r l; do case "$l" in (*:*) n=\${l%%:*}; n=\${n##* }; case "$n" in (lo|lo[0-9]*) ;; (*) set -- \${l#*:}; rx=$((rx+$1)); tx=$((tx+$9));; esac;; esac; done < $P/net/dev; fi;
  read -r l1 l5 l15 x < $P/loadavg;
  read -r up x < $P/uptime; up=\${up%.*};
elif [ "$(uname -s 2>/dev/null)" = Darwin ]; then
  os=darwin;
  mt=$(sysctl -n hw.memsize 2>/dev/null); nc=$(sysctl -n hw.ncpu 2>/dev/null);
  set -- $(vm_stat 2>/dev/null | { g=4096; a=0; w=0; c=0; while read -r l; do case "$l" in (*"page size of "*) g=\${l##*page size of }; g=\${g%% *};; ("Pages active:"*) a=\${l##* }; a=\${a%.};; ("Pages wired down:"*) w=\${l##* }; w=\${w%.};; ("Pages occupied by compressor:"*) c=\${l##* }; c=\${c%.};; esac; done; echo "$g $a $w $c"; });
  [ $# -ge 4 ] && mu=$((($2+$3+$4)*$1));
  set -- $(ps -A -o %cpu= 2>/dev/null | { t=0; while read -r c; do case "$c" in (*.*) f=\${c#*.}; f=\${f%\${f#?}}; t=$((t+\${c%.*}*10+f));; ("") ;; (*) t=$((t+c*10));; esac; done; echo "$t"; });
  cp=$1;
  set -- $(netstat -ibn 2>/dev/null | { r=0; t=0; while read -r l; do set -- $l; case "$1" in (lo*|Name) ;; (*) case "$3" in ("<Link"*) if [ $# -ge 11 ]; then r=$((r+$7)); t=$((t+\${10})); else r=$((r+$6)); t=$((t+$9)); fi;; esac;; esac; done; echo "$r $t"; });
  rx=$1; tx=$2;
  set -- $(sysctl -n vm.loadavg 2>/dev/null); l1=$2; l5=$3; l15=$4;
  b=$(sysctl -n kern.boottime 2>/dev/null); b=\${b#*sec = }; b=\${b%%,*}; [ -n "$b" ] && up=$(($(date +%s)-b));
else
  os=$(uname -s 2>/dev/null);
  set -- $(sysctl -n kern.cp_time 2>/dev/null); [ $# -ge 5 ] && cb=$(($1+$2+$3+$4)) && ct=$((cb+$5));
  mt=$(sysctl -n hw.physmem 2>/dev/null); g=$(sysctl -n hw.pagesize 2>/dev/null); fr=$(sysctl -n vm.stats.vm.v_free_count 2>/dev/null); ia=$(sysctl -n vm.stats.vm.v_inactive_count 2>/dev/null);
  [ -n "$mt" ] && [ -n "$g" ] && [ -n "$fr" ] && mu=$((mt-(fr+\${ia:-0})*g));
  u=$(uptime 2>/dev/null); u=\${u##*average}; u=\${u#s}; u=\${u#:}; set -- $u; l1=\${1%,}; l5=\${2%,}; l15=\${3%,};
fi;
set -- $(df -P / 2>/dev/null | { read -r x; read -r a b c d e x; echo "$e"; }); dp=$1;
echo "${SENTINEL}os=$os cpu_busy=$cb cpu_total=$ct cpu_pct10=$cp ncpu=$nc mem_total=$mt mem_used=$mu disk=$dp rx=$rx tx=$tx load1=$l1 load5=$l5 load15=$l15 uptime=$up host=$h"
`.replace(/\s*\n\s*/g, ' ').trim();

/** The exec command: the one-line script under `sh -c`. */
const MONITOR_COMMAND = `sh -c '${MONITOR_SCRIPT}'`;
if (/['\\!\n]/.test(MONITOR_SCRIPT)) throw new Error('monitor script must not contain quotes, backslashes, ! or newlines');

const clampPct = (x) => (Number.isFinite(x) ? Math.round(Math.min(100, Math.max(0, x)) * 10) / 10 : null);

/**
 * Parse the snippet's output. `text` is the exec stdout (anything a login script printed before the MOBALT_MON line
 * is ignored; the last such line wins), `prev` the sample this function returned for the previous poll of the same
 * host (or null), `now` the receipt time (ms). Returns null when there is no MOBALT_MON line, else
 *   { os, host, cpu (0–100 or null), memUsed, memTotal (bytes or null), diskPct (0–100 or null),
 *     rx, tx (bytes/s or null), load ([1, 5, 15] or null), uptime (s or null), at, raw }
 * CPU and network are rates between two polls: null on the first sample of a Linux host, and after a counter reset.
 * macOS has no cumulative CPU counter in the shell; its cpu is the sum of the per-process %cpu over the cores.
 */
function parseMonitorOutput(text, prev, now = Date.now()) {
  const lines = String(text || '').split(/\r?\n/);
  let line = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(SENTINEL)) { line = lines[i].slice(SENTINEL.length); break; }
  }
  if (line === null) return null;
  const hm = /(?:^|\s)host=(.*)$/.exec(line); // the host name is last: it is the only value that may hold spaces
  const host = hm ? hm[1].trim() : '';
  const kv = {};
  for (const tok of (hm ? line.slice(0, hm.index) : line).trim().split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq > 0) kv[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  const num = (k) => {
    if (kv[k] === undefined || kv[k] === '') return null;
    const n = Number(kv[k]);
    return Number.isFinite(n) ? n : null;
  };
  const p = prev && prev.raw ? prev.raw : null;
  const raw = { cpuBusy: num('cpu_busy'), cpuTotal: num('cpu_total'), rx: num('rx'), tx: num('tx'), at: now };
  let cpu = null;
  if (raw.cpuBusy !== null && raw.cpuTotal !== null) {
    if (p && p.cpuBusy !== null && p.cpuTotal !== null && raw.cpuTotal > p.cpuTotal && raw.cpuBusy >= p.cpuBusy) {
      cpu = clampPct(((raw.cpuBusy - p.cpuBusy) / (raw.cpuTotal - p.cpuTotal)) * 100);
    }
  } else if (num('cpu_pct10') !== null && num('ncpu') > 0) {
    cpu = clampPct(num('cpu_pct10') / 10 / num('ncpu'));
  }
  const memTotal = num('mem_total') > 0 ? num('mem_total') : null;
  const memUsed = memTotal !== null && num('mem_used') !== null ? Math.max(0, Math.min(memTotal, num('mem_used'))) : null;
  const diskPct = kv.disk && /^\d+%?$/.test(kv.disk) ? clampPct(parseInt(kv.disk, 10)) : null;
  const rate = (k) => {
    if (raw[k] === null || !p || p[k] === null) return null;
    const dt = (now - p.at) / 1000;
    if (!(dt > 0)) return null;
    const d = raw[k] - p[k];
    return d < 0 ? null : Math.round(d / dt);
  };
  const load = [num('load1'), num('load5'), num('load15')];
  const uptime = num('uptime');
  return {
    os: kv.os || 'unknown',
    host,
    cpu,
    memUsed,
    memTotal,
    diskPct,
    rx: rate('rx'),
    tx: rate('tx'),
    load: load.every((x) => x !== null) ? load : null,
    uptime: uptime !== null && uptime >= 0 ? Math.floor(uptime) : null,
    at: now,
    raw,
  };
}

/**
 * Polls hosts for the renderer: sample(id) runs the snippet on connection `id` of the SshManager and returns
 * { sample } or { error, fatal }. `fatal` means polling this connection again is pointless (no sh on the host, a
 * shell that cannot run the script, permission denied, the connection is gone); a timeout is not fatal.
 * The previous sample is kept per connection for the rates; forget(id) drops it when the connection ends.
 */
class RemoteMonitor {
  constructor(ssh) {
    this.ssh = ssh;
    this.prev = new Map();
    this.command = MONITOR_COMMAND;
    this.samples = 0; // polls started (test hook)
  }

  /** Test hook: run another command instead of the snippet (a failing one exercises the "unavailable" path). */
  setCommand(cmd) {
    this.command = cmd || MONITOR_COMMAND;
  }

  forget(id) {
    this.prev.delete(id);
  }

  async sample(id) {
    this.samples++;
    let r;
    try {
      r = await this.ssh.exec(id, this.command, { timeout: EXEC_TIMEOUT });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      return { error: msg, fatal: /not connected/i.test(msg) };
    }
    const sample = parseMonitorOutput(r.stdout, this.prev.get(id) || null);
    if (!sample) {
      const err = String(r.stderr || '').trim().split('\n').pop() || '';
      const why = r.code === 127 || /not found|No such file/i.test(err) ? 'no sh on the host'
        : r.code === 126 || /Permission denied/i.test(err) ? 'permission denied'
        : err ? err.slice(0, 120) : `no output (exit ${r.code === null || r.code === undefined ? '?' : r.code})`;
      return { error: why, fatal: true };
    }
    this.prev.set(id, sample);
    return { sample };
  }
}

module.exports = { MONITOR_SCRIPT, MONITOR_COMMAND, SENTINEL, EXEC_TIMEOUT, parseMonitorOutput, RemoteMonitor };
