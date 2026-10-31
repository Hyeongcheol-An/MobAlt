'use strict';
// The remote monitoring bar: the snippet's output parsed into samples (captured Linux and macOS lines), the rates
// between two polls, the snippet itself run by the local sh (macOS branch) and against Linux-shaped /proc files
// (Linux branch), the RemoteMonitor poll with a fake SshManager, and the renderer's formatting.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MONITOR_SCRIPT, MONITOR_COMMAND, SENTINEL, parseMonitorOutput, RemoteMonitor } = require('../../src/main/monitor');

// src/renderer/monitor.js is an ES module in a CommonJS package (see theme.test.js for the warning filter)
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const loadFormat = () => import('../../src/renderer/monitor.js');

// captured from `sh /mon.sh` in a Debian (dash) container, a busybox (Alpine) container and this Mac's sshd
const LINUX_1 = 'MOBALT_MON os=linux cpu_busy=5986018 cpu_total=179019352 cpu_pct10= ncpu= mem_total=16749502464 mem_used=3345690624 disk=28% rx=110 tx=0 load1=3.56 load5=3.60 load15=3.58 uptime=299001 host=ea04cc2455e0\n';
const LINUX_2 = 'MOBALT_MON os=linux cpu_busy=5986168 cpu_total=179019752 cpu_pct10= ncpu= mem_total=16749502464 mem_used=3345633280 disk=28% rx=61550 tx=3072 load1=3.56 load5=3.60 load15=3.58 uptime=299004 host=ea04cc2455e0\n';
const BUSYBOX = 'MOBALT_MON os=linux cpu_busy=5986046 cpu_total=179019618 cpu_pct10= ncpu= mem_total=16749502464 mem_used=3270877184 disk=28% rx=196 tx=0 load1=3.56 load5=3.60 load15=3.58 uptime=299001 host=e8fcdbd9a8d8\n';
const MAC_1 = 'MOBALT_MON os=darwin cpu_busy= cpu_total= cpu_pct10=3036 ncpu=12 mem_total=68719476736 mem_used=46717648896 disk=6% rx=18738270982 tx=3759491895 load1=7.25 load5=7.28 load15=9.07 uptime=335495 host=Anui-MacBookPro.local\n';
const MAC_2 = 'MOBALT_MON os=darwin cpu_busy= cpu_total= cpu_pct10=3300 ncpu=12 mem_total=68719476736 mem_used=46750810112 disk=6% rx=18738535660 tx=3759852952 load1=7.20 load5=7.27 load15=9.05 uptime=335501 host=Anui-MacBookPro.local\n';

test('Linux: the first sample has memory, disk, load, uptime and host; CPU and network wait for a second poll', () => {
  const s = parseMonitorOutput(LINUX_1, null, 1000000);
  assert.equal(s.os, 'linux');
  assert.equal(s.host, 'ea04cc2455e0');
  assert.equal(s.cpu, null, 'CPU is a delta between two polls');
  assert.equal(s.rx, null);
  assert.equal(s.tx, null);
  assert.equal(s.memTotal, 16749502464);
  assert.equal(s.memUsed, 3345690624);
  assert.equal(s.diskPct, 28);
  assert.deepEqual(s.load, [3.56, 3.6, 3.58]);
  assert.equal(s.uptime, 299001);
  assert.equal(s.at, 1000000);
  assert.deepEqual(s.raw, { cpuBusy: 5986018, cpuTotal: 179019352, rx: 110, tx: 0, at: 1000000 });
});

test('Linux: the second sample carries the CPU share of the busy jiffies and the byte rates since the previous poll', () => {
  const s1 = parseMonitorOutput(LINUX_1, null, 1000000);
  const s2 = parseMonitorOutput(LINUX_2, s1, 1003000); // 3 s later: busy +150 of total +400, rx +61440 B, tx +3072 B
  assert.equal(s2.cpu, 37.5);
  assert.equal(s2.rx, 20480);
  assert.equal(s2.tx, 1024);
  assert.equal(s2.uptime, 299004);
  assert.equal(s2.memUsed, 3345633280);
  // the same output twice (no jiffies passed) and a counter that went backwards (reboot, interface reset) give no rate
  const same = parseMonitorOutput(LINUX_2, s2, 1006000);
  assert.equal(same.cpu, null);
  assert.equal(same.rx, 0);
  const reset = parseMonitorOutput(LINUX_1, s2, 1009000);
  assert.equal(reset.cpu, null);
  assert.equal(reset.rx, null);
  assert.equal(reset.tx, null);
  assert.equal(parseMonitorOutput(LINUX_2, s1, 1000000).rx, null, 'no time passed: no rate');
});

test('busybox output parses the same, also behind the noise a login script printed, with CRLF and a late sentinel', () => {
  const noisy = 'Welcome to the box\r\nsh: warning: setlocale: LC_ALL: cannot change locale (C.UTF-8)\r\n' + BUSYBOX.replace('\n', '\r\n') + 'bye\r\n';
  const s = parseMonitorOutput(noisy, null, 5000);
  assert.equal(s.host, 'e8fcdbd9a8d8');
  assert.equal(s.memUsed, 3270877184);
  assert.equal(s.diskPct, 28);
  // the last MOBALT_MON line wins
  const twice = parseMonitorOutput(LINUX_1 + LINUX_2, null, 5000);
  assert.equal(twice.raw.cpuBusy, 5986168);
  assert.equal(parseMonitorOutput('nothing here\n', null), null);
  assert.equal(parseMonitorOutput('', null), null);
  assert.equal(parseMonitorOutput(null, null), null);
});

test('macOS: CPU is the per-process sum over the cores at once; memory from vm_stat pages; network rates between polls', () => {
  const s1 = parseMonitorOutput(MAC_1, null, 2000000);
  assert.equal(s1.os, 'darwin');
  assert.equal(s1.host, 'Anui-MacBookPro.local');
  assert.equal(s1.cpu, 25.3, '3036 tenths of a percent over 12 cores');
  assert.equal(s1.memTotal, 68719476736);
  assert.equal(s1.memUsed, 46717648896);
  assert.equal(s1.diskPct, 6);
  assert.deepEqual(s1.load, [7.25, 7.28, 9.07]);
  assert.equal(s1.uptime, 335495);
  assert.equal(s1.rx, null);
  const s2 = parseMonitorOutput(MAC_2, s1, 2006428);
  assert.equal(s2.cpu, 27.5);
  assert.equal(s2.rx, 41176);
  assert.equal(s2.tx, 56169);
  assert.deepEqual(s2.load, [7.2, 7.27, 9.05]);
});

test('odd values: a bare disk number, missing or zero totals, out-of-range percentages, a host name with spaces, no host', () => {
  const line = (kv) => SENTINEL + kv + '\n';
  assert.equal(parseMonitorOutput(line('os=linux disk=42 host=x'), null).diskPct, 42);
  assert.equal(parseMonitorOutput(line('os=linux disk=- host=x'), null).diskPct, null);
  assert.equal(parseMonitorOutput(line('os=linux disk=120% host=x'), null).diskPct, 100);
  const s = parseMonitorOutput(line('os=other cpu_pct10=99999 ncpu=1 mem_total=0 mem_used=5 load1=1 load5=x load15=3 uptime=-5 host=my host name'), null);
  assert.equal(s.cpu, 100, 'clamped');
  assert.equal(s.memTotal, null);
  assert.equal(s.memUsed, null);
  assert.equal(s.load, null, 'an unparsable load average gives none');
  assert.equal(s.uptime, null);
  assert.equal(s.host, 'my host name');
  const mem = parseMonitorOutput(line('os=linux mem_total=1000 mem_used=5000'), null);
  assert.equal(mem.memUsed, 1000, 'used never exceeds the total');
  assert.equal(mem.host, '');
  assert.equal(parseMonitorOutput(line('os=darwin cpu_pct10=120 ncpu=0'), null).cpu, null, 'no cores known: no share');
});

test('the command is one quoted line of POSIX sh: no single quote, backslash, ! or newline inside, so fish and csh pass it through', () => {
  assert.ok(MONITOR_COMMAND.startsWith("sh -c '") && MONITOR_COMMAND.endsWith("'"));
  assert.equal(MONITOR_COMMAND, `sh -c '${MONITOR_SCRIPT}'`);
  assert.doesNotMatch(MONITOR_SCRIPT, /['\\!\n\r]/);
  assert.ok(MONITOR_SCRIPT.length < 4096, `the script stays short enough for any exec request: ${MONITOR_SCRIPT.length}`);
  assert.match(MONITOR_SCRIPT, /LC_ALL=C; export LC_ALL; set -f;/, 'no locale surprises, no globbing of a line');
  assert.match(MONITOR_SCRIPT, /\(\*"page size of "\*\)/, 'case arms are written (pattern): bash 3.2 cannot parse a bare pattern) inside $( )');
  assert.match(MONITOR_SCRIPT, /netstat -ibn/, 'numeric: netstat -ib resolves every address and takes seconds');
  assert.ok(MONITOR_SCRIPT.endsWith(`echo "${SENTINEL}os=$os cpu_busy=$cb cpu_total=$ct cpu_pct10=$cp ncpu=$nc mem_total=$mt mem_used=$mu disk=$dp rx=$rx tx=$tx load1=$l1 load5=$l5 load15=$l15 uptime=$up host=$h"`));
});

test('the snippet runs under the local sh and describes this machine', { skip: process.platform !== 'darwin' && process.platform !== 'linux' }, () => {
  const t0 = Date.now();
  const out = execFileSync('/bin/sh', ['-c', MONITOR_COMMAND], { encoding: 'utf8', timeout: 20000 });
  const ms = Date.now() - t0;
  const s = parseMonitorOutput(out, null);
  assert.ok(s, 'a MOBALT_MON line: ' + out);
  assert.equal(s.os, process.platform);
  assert.equal(s.host, os.hostname());
  assert.equal(s.memTotal, os.totalmem());
  assert.ok(s.memUsed > 0 && s.memUsed <= s.memTotal, `memory ${s.memUsed} of ${s.memTotal}`);
  assert.ok(s.diskPct >= 0 && s.diskPct <= 100, `disk ${s.diskPct}`);
  assert.ok(Array.isArray(s.load) && s.load.length === 3, `load ${s.load}`);
  assert.ok(Math.abs(s.uptime - os.uptime()) < 120, `uptime ${s.uptime} vs ${os.uptime()}`);
  assert.ok(s.raw.rx >= 0 && s.raw.tx >= 0, 'network counters');
  if (process.platform === 'darwin') assert.ok(s.cpu >= 0 && s.cpu <= 100, `macOS cpu ${s.cpu}`);
  else assert.ok(s.raw.cpuBusy > 0 && s.raw.cpuTotal > s.raw.cpuBusy, 'Linux jiffies');
  assert.ok(ms < 5000, `one poll took ${ms} ms`);
});

test('the Linux branch reads /proc as busybox and dash see it (fixture files, local sh)', () => {
  const proc = path.join(__dirname, '..', 'fixtures', 'proc-linux');
  assert.ok(MONITOR_SCRIPT.includes(' P=/proc;'));
  const script = MONITOR_SCRIPT.replace(' P=/proc;', ` P=${proc};`);
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 20000 });
  const s1 = parseMonitorOutput(out, null, 1000);
  assert.equal(s1.os, 'linux', out);
  // stat: user 3776817 + nice 0 + system 1093440 + irq 0 + softirq 1115790 + steal 0 busy; + idle 172991619 + iowait 41960 total
  assert.deepEqual([s1.raw.cpuBusy, s1.raw.cpuTotal], [5986047, 179019626]);
  assert.equal(s1.memTotal, 16356936 * 1024);
  assert.equal(s1.memUsed, (16356936 - 13162136) * 1024, 'MemTotal − MemAvailable');
  assert.deepEqual([s1.raw.rx, s1.raw.tx], [123456 + 1000, 7890 + 200], 'every interface but lo, also one whose name touches the colon');
  assert.deepEqual(s1.load, [0.52, 0.58, 0.59]);
  assert.equal(s1.uptime, 299001);
  assert.equal(s1.host, os.hostname());
  assert.ok(s1.diskPct >= 0 && s1.diskPct <= 100, 'df of the local root');
  // a meminfo without MemAvailable (old kernels): free + buffers + cached stand in
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-proc-'));
  fs.mkdirSync(path.join(tmp, 'net'));
  for (const f of ['stat', 'loadavg', 'uptime']) fs.copyFileSync(path.join(proc, f), path.join(tmp, f));
  fs.writeFileSync(path.join(tmp, 'meminfo'), 'MemTotal:       1000 kB\nMemFree:         100 kB\nBuffers:          50 kB\nCached:          250 kB\n');
  fs.writeFileSync(path.join(tmp, 'net', 'dev'), 'Inter-| Receive |  Transmit\n face |bytes\n');
  const s2 = parseMonitorOutput(execFileSync('/bin/sh', ['-c', MONITOR_SCRIPT.replace(' P=/proc;', ` P=${tmp};`)], { encoding: 'utf8' }), null);
  assert.equal(s2.memTotal, 1000 * 1024);
  assert.equal(s2.memUsed, (1000 - 400) * 1024);
  assert.deepEqual([s2.raw.rx, s2.raw.tx], [0, 0], 'no interfaces: zero counters, not nothing');
});

test('RemoteMonitor: one exec per poll, rates from the previous sample, fatal vs transient errors, forget', async () => {
  const calls = [];
  const fake = { execCount: 0, next: { code: 0, stdout: LINUX_1, stderr: '' }, exec: async (id, cmd, opts) => { fake.execCount++; calls.push({ id, cmd, opts }); const r = fake.next; if (r instanceof Error) throw r; return r; } };
  const m = new RemoteMonitor(fake);
  const r1 = await m.sample('t1');
  assert.ok(r1.sample && r1.sample.cpu === null && r1.sample.memTotal === 16749502464);
  assert.equal(calls[0].cmd, MONITOR_COMMAND);
  assert.equal(calls[0].opts.timeout, 10000);
  fake.next = { code: 0, stdout: LINUX_2, stderr: '' };
  const r2 = await m.sample('t1');
  assert.equal(r2.sample.cpu, 37.5, 'the previous sample of the same connection gives the rate');
  assert.ok(r2.sample.rx >= 0, 'the rate uses the real clock between the two polls');
  assert.equal(m.samples, 2);
  assert.equal(fake.execCount, 2);
  // another connection starts from nothing; forget() does the same for a reconnected one
  assert.equal((await m.sample('t2')).sample.cpu, null);
  m.forget('t1');
  assert.equal((await m.sample('t1')).sample.cpu, null);
  // no sh on the host (127), permission denied (126), a shell that printed nothing: fatal; a timeout: not
  fake.next = { code: 127, stdout: '', stderr: 'bash: sh: command not found\n' };
  assert.deepEqual(await m.sample('t1'), { error: 'no sh on the host', fatal: true });
  fake.next = { code: 126, stdout: '', stderr: 'sh: permission denied\n' };
  assert.deepEqual(await m.sample('t1'), { error: 'permission denied', fatal: true });
  fake.next = { code: 1, stdout: 'motd only\n', stderr: '' };
  assert.deepEqual(await m.sample('t1'), { error: 'no output (exit 1)', fatal: true });
  fake.next = { code: 2, stdout: '', stderr: 'sh: syntax error near unexpected token\n' };
  assert.deepEqual(await m.sample('t1'), { error: 'sh: syntax error near unexpected token', fatal: true });
  fake.next = new Error('timed out after 10 s');
  assert.deepEqual(await m.sample('t1'), { error: 'timed out after 10 s', fatal: false });
  fake.next = new Error('Not connected');
  assert.deepEqual(await m.sample('t1'), { error: 'Not connected', fatal: true });
  // test hook: another command, then the snippet again
  m.setCommand('exit 127');
  fake.next = { code: 127, stdout: '', stderr: '' };
  await m.sample('t1');
  assert.equal(calls[calls.length - 1].cmd, 'exit 127');
  m.setCommand(null);
  fake.next = { code: 0, stdout: MAC_1, stderr: '' };
  assert.equal((await m.sample('t1')).sample.os, 'darwin');
  assert.equal(calls[calls.length - 1].cmd, MONITOR_COMMAND);
});

test('formatting: sizes, rates, uptime, load, memory share and meter levels', async () => {
  const { formatBytes, formatRate, formatUptime, formatLoad, memPercent, meterLevel } = await loadFormat();
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(3.1 * 1024), '3.1 KB');
  assert.equal(formatBytes(12 * 1024), '12 KB');
  assert.equal(formatBytes(16749502464), '15.6 GB', 'memory sizes keep a decimal up to 100 GB');
  assert.equal(formatBytes(46776418304), '43.6 GB');
  assert.equal(formatBytes(68719476736), '64 GB');
  assert.equal(formatBytes(120 * 1024 ** 3), '120 GB');
  assert.equal(formatBytes(15.6 * 1024 ** 2), '16 MB', 'below GB a value from 10 up is whole');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatRate(20480), '20 KB/s');
  assert.equal(formatRate(0), '0 B/s');
  assert.equal(formatRate(null), '—');
  assert.equal(formatUptime(299001), '3d 11h');
  assert.equal(formatUptime(4 * 3600 + 12 * 60 + 5), '4h 12m');
  assert.equal(formatUptime(12 * 60 + 30), '12m');
  assert.equal(formatUptime(45), '45s');
  assert.equal(formatUptime(null), '—');
  assert.equal(formatLoad([0.52, 0.6, 0.7]), '0.52 0.60 0.70');
  assert.equal(formatLoad(null), '—');
  assert.equal(memPercent({ memUsed: 3345690624, memTotal: 16749502464 }).toFixed(1), '20.0');
  assert.equal(memPercent({ memUsed: null, memTotal: 1 }), null);
  assert.equal(memPercent(null), null);
  assert.equal(meterLevel(79.9), '');
  assert.equal(meterLevel(80), 'warn');
  assert.equal(meterLevel(95), 'danger');
  assert.equal(meterLevel(null), '');
});
