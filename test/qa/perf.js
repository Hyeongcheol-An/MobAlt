#!/usr/bin/env node
'use strict';
// MobAlt performance measurements — start-up, idle CPU, memory, bundle size — `npm run perf` (docs/PERFORMANCE.md).
//
//   node test/qa/perf.js [--app dev|packaged|both] [--only startup,require,idle,memory,size] [--runs 5] [--seconds 60]
//                        [--out <dir>] [--quick]
//
// Every launch is a QA-harness run (test/qa/README.md: a fresh user-data folder with autoUpdate off, the renderer
// script injected through MOBALT_TEST_SCRIPT) of the Electron binary itself — `npx electron` would put a node process
// in front of the timing — or of the packaged app (dist/mac-arm64/MobAlt.app from `npm run pack`; both when it
// exists). The app's processes are found from the pid this runner started, never by name: the user's own MobAlt may
// be running. --quick: 2 start-up runs and 15 s idle windows. Results: tables on stdout and <out>/perf.json
// (default out: test/shots/perf/<timestamp>/, with every run's log and user data).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const quick = args.includes('--quick');
const runs = parseInt(opt('runs', quick ? 2 : 5), 10);
const seconds = parseInt(opt('seconds', quick ? 15 : 60), 10);
const only = new Set(opt('only', 'startup,require,idle,memory,size').split(','));
const outDir = path.resolve(opt('out', path.join(root, 'test', 'shots', 'perf', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))));
const packagedApp = path.join(root, 'dist', 'mac-arm64', 'MobAlt.app');
const appArg = opt('app', fs.existsSync(packagedApp) ? 'both' : 'dev');
const apps = appArg === 'both' ? ['dev', 'packaged'] : [appArg];
const devBin = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const sshdRuntime = path.join(root, 'test', 'sshd-runtime');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : Math.round((a[a.length / 2 - 1] + a[a.length / 2]) / 2)) : null; };
const mb = (kb) => (Number.isFinite(kb) ? (kb / 1024).toFixed(0) : '—');
const pct = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const say = (...a) => console.log(...a);

function binaryFor(kind) {
  if (kind === 'packaged') {
    const bin = path.join(packagedApp, 'Contents', 'MacOS', 'MobAlt');
    if (!fs.existsSync(bin)) throw new Error(`no packaged app at ${packagedApp} (npm run pack)`);
    return { bin, args: [] };
  }
  return { bin: devBin, args: [root] };
}

/**
 * One harness run: a fresh user-data folder (autoUpdate off, so a packaged build never calls GitHub during a
 * measurement; `settings` on top), the renderer script, a scenario file the script reads back. Resolves when the
 * process exits with { t0 (ms, just before spawn), pid, code, lines, perf: { TAG: parsed JSON } } — every
 * "PERF-… {json}" line the script logged. onLine(line, tag, data, pid) fires as lines arrive (the idle sampling
 * starts on PERF-IDLE-READY). The app quits itself; a run that hangs is killed `timeoutMs` + 30 s after the start.
 */
function launch(kind, script, name, { scenario = null, timeoutMs = 120000, onLine = null, settings = null } = {}) {
  const dir = path.join(outDir, `${kind}-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'userdata'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'userdata', 'settings.json'), JSON.stringify({ autoUpdate: false, ...(settings || {}) }));
  if (scenario) fs.writeFileSync(path.join(dir, 'userdata', 'perf-scenario.json'), JSON.stringify(scenario));
  const env = { ...process.env, MOBALT_LANG: 'en', MOBALT_USER_DATA: path.join(dir, 'userdata'), MOBALT_TEST_SCRIPT: path.join(__dirname, script), MOBALT_SHOT_DIR: path.join(dir, 'shots'), MOBALT_SCREENSHOT: path.join(dir, 'shots', 'final.png'), MOBALT_SCREENSHOT_DELAY: String(timeoutMs) };
  delete env.ELECTRON_RUN_AS_NODE;
  const { bin, args: a } = binaryFor(kind);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(bin, a, { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [], perf = {};
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        lines.push(line);
        const m = /(PERF-[A-Z-]+) (\{.*\})\s*$/.exec(line);
        let data = null;
        if (m) { try { data = JSON.parse(m[2]); perf[m[1]] = data; } catch {} }
        if (onLine && m) { try { onLine(line, m[1], data, child.pid); } catch (e) { console.error(e); } }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs + 30000);
    child.on('error', (e) => { clearTimeout(killer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(killer);
      fs.writeFileSync(path.join(dir, 'log.txt'), lines.join('\n') + '\n');
      resolve({ t0, pid: child.pid, code, lines, perf, dir });
    });
  });
}

// ---------- the process tree, from ps ----------
/** ps's TIME (M:SS.ss or H:MM:SS.ss) as seconds. */
const cpuSeconds = (t) => t.split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
/** Chromium's --type flag (or the pid itself) names the process: main, renderer, gpu, utility:<service>, else a shell / other child. */
function classify(r, rootPid) {
  if (r.pid === rootPid) return 'main';
  const m = /--type=([a-z-]+)/.exec(r.args);
  if (!m) return /(^|\/)(-?zsh|-?bash|-?sh|-?fish|login|ssh|sshd|mosh-client|mosh)( |$)/.test(r.args) ? 'shell' : 'other';
  if (m[1] === 'renderer') return 'renderer';
  if (m[1] === 'gpu-process') return 'gpu';
  if (m[1] === 'utility') { const s = /--utility-sub-type=([\w.]+)/.exec(r.args); return 'utility:' + (s ? s[1].replace(/\.mojom\..*$/, '') : '?'); }
  return m[1];
}
/** The processes of the app started as `rootPid`: itself and every descendant, with ps's %cpu, cpu time, rss (KB). */
function snapshot(rootPid) {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,time=,rss=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rows = [];
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], time: cpuSeconds(m[4]), rss: +m[5], args: m[6] });
  }
  const byPpid = new Map();
  for (const r of rows) { if (!byPpid.has(r.ppid)) byPpid.set(r.ppid, []); byPpid.get(r.ppid).push(r); }
  const out = [];
  const self = rows.find((r) => r.pid === rootPid);
  if (self) out.push(self);
  const walk = (pid) => { for (const r of byPpid.get(pid) || []) { out.push(r); walk(r.pid); } };
  walk(rootPid);
  for (const r of out) r.kind = classify(r, rootPid);
  return out;
}
/**
 * Sample the tree once a second for `secs`. CPU per process = cpu time used / wall time (exact, from ps's TIME),
 * beside the mean of ps's own %cpu (a decaying average). The app total leaves the shells out.
 */
async function sampleIdle(rootPid, secs) {
  const t0 = Date.now();
  const samples = [snapshot(rootPid)];
  for (let i = 0; i < secs; i++) { await sleep(1000); samples.push(snapshot(rootPid)); }
  const wall = (Date.now() - t0) / 1000;
  const procs = new Map();
  for (const s of samples) {
    for (const r of s) {
      if (!procs.has(r.pid)) procs.set(r.pid, { pid: r.pid, kind: r.kind, cmd: r.args.split(' ')[0].split('/').pop(), time0: r.time, time1: r.time, cpu: [], rss: [] });
      const p = procs.get(r.pid);
      p.time1 = r.time; p.cpu.push(r.cpu); p.rss.push(r.rss);
    }
  }
  const list = [...procs.values()].map((p) => ({ pid: p.pid, kind: p.kind, cmd: p.cmd, cpuPct: Math.round(((p.time1 - p.time0) / wall) * 1000) / 10, psCpuMean: Math.round((p.cpu.reduce((a, x) => a + x, 0) / p.cpu.length) * 10) / 10, rssKB: Math.round(p.rss.reduce((a, x) => a + x, 0) / p.rss.length) }));
  const byKind = {};
  for (const p of list) byKind[p.kind] = Math.round(((byKind[p.kind] || 0) + p.cpuPct) * 10) / 10;
  const total = Math.round(list.filter((p) => p.kind !== 'shell' && p.kind !== 'other').reduce((a, p) => a + p.cpuPct, 0) * 10) / 10;
  return { wallSeconds: Math.round(wall), processes: list, byKind, totalAppCpuPct: total };
}

// ---------- start-up ----------
const STARTUP_KEYS = [['mainStart', 'main.js starts loading'], ['mainLoaded', 'main.js requires done'], ['appReady', 'app ready (whenReady)'], ['timeOrigin', 'renderer navigation start'], ['windowLoaded', 'window did-finish-load'], ['first-paint', 'first paint'], ['first-contentful-paint', 'first contentful paint'], ['firstFrame', 'first animation frame'], ['uiReady', 'UI ready (app.js init done)'], ['first-output', 'first terminal output (prompt)']];
async function startup(kind) {
  say(`\n## start-up (${kind}): ${runs} runs, median, ms after the process was started`);
  await launch(kind, 'perf-startup.js', 'startup-warmup', { timeoutMs: 30000 }); // the first launch after a build or a reboot pays for the disk cache
  const all = [];
  for (let i = 0; i < runs; i++) {
    const r = await launch(kind, 'perf-startup.js', `startup-${i + 1}`, { timeoutMs: 30000 });
    const p = r.perf['PERF-STARTUP'];
    if (!p) { console.error(`run ${i + 1}: no PERF-STARTUP line\n` + r.lines.slice(-5).join('\n')); continue; }
    const rel = {};
    for (const [k, v] of Object.entries(p.boot || {})) rel[k === 'ready' ? 'appReady' : k] = v - r.t0;
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number' && k !== 'panes') rel[k] = v - r.t0;
    all.push(rel);
  }
  const med = {};
  for (const [k] of STARTUP_KEYS) med[k] = median(all.map((r) => r[k]));
  say('| Milestone | ms |\n|---|---:|');
  for (const [k, label] of STARTUP_KEYS) say(`| ${label} | ${med[k] === null ? '—' : med[k]} |`);
  return { runs: all, median: med };
}

// ---------- main-process requires (dev only) ----------
async function requires() {
  say('\n## main-process requires (dev checkout, fresh process each, median of 3)');
  const run = (extra) => new Promise((resolve) => {
    const env = { ...process.env, MOBALT_USER_DATA: path.join(outDir, 'require-userdata') };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(devBin, [path.join(__dirname, 'perf-require.js'), ...extra], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('exit', () => { const m = /PERF-REQUIRE (\{.*\})/.exec(out); resolve(m ? JSON.parse(m[1]) : null); });
  });
  const med = (list, key) => median(list.filter(Boolean).map((r) => (key ? r.items.find((i) => i[0] === key)?.[1] : r.total)));
  const mains = []; for (let i = 0; i < 3; i++) mains.push(await run([]));
  const names = (mains.find(Boolean) || { items: [] }).items.map((i) => i[0]);
  const packages = ['electron-updater', 'ssh2', 'serialport', 'basic-ftp', 'zmodem.js', 'node-pty', 'cpu-features'];
  const singles = {};
  for (const p of packages) { const rs = []; for (let i = 0; i < 3; i++) rs.push(await run([p])); singles[p] = med(rs, p); }
  say('| src/main module (main.js order) | ms |\n|---|---:|');
  const perModule = {};
  for (const n of names) { perModule[n] = med(mains, n); say(`| ${n} | ${perModule[n]} |`); }
  say(`| **total** | **${med(mains)}** |`);
  say('\n| package on its own | ms |\n|---|---:|');
  for (const p of packages) say(`| ${p} | ${singles[p]} |`);
  return { modules: perModule, total: med(mains), packages: singles };
}

// ---------- idle CPU ----------
const IDLE_SCENARIOS = [
  { name: '0-panes', panes: 0, label: 'no pane (empty window)' },
  { name: '1-pane', panes: 1, label: '1 local pane' },
  { name: '1-pane-no-blink', panes: 1, settings: { cursorBlink: false }, label: '1 local pane, cursor blink off' },
  { name: '10-panes-tabs', panes: 10, label: '10 local panes in 10 tabs (1 on screen)' },
  { name: '10-panes-splits', panes: 10, layout: 'splits', label: '10 local panes on screen (one tab, 10 WebGL contexts)' },
  { name: 'monitor', panes: 1, monitor: true, label: '1 SSH pane (local sshd) with the monitoring bar' },
];
function sshdRunning() {
  try { return /running/.test(execFileSync('bash', [path.join(root, 'test', 'start-sshd.sh'), 'status'], { encoding: 'utf8' })); } catch { return false; }
}
async function idle(kind) {
  say(`\n## idle CPU (${kind}): ${seconds} s windows, % of one core from ps cpu time (app total leaves the shells out; Chromium's own per-all-cores figures are in perf.json)`);
  const sshd = sshdRunning();
  const results = [];
  for (const sc of IDLE_SCENARIOS) {
    if (sc.monitor && !sshd) { say(`- ${sc.label}: skipped (start test/start-sshd.sh first)`); continue; }
    let sampling = null;
    const r = await launch(kind, 'perf-idle.js', `idle-${sc.name}`, {
      scenario: { ...sc, seconds, keyDir: sshdRuntime, profileMs: quick ? 5000 : 10000 },
      settings: sc.settings || null,
      timeoutMs: seconds * 1000 + 90000,
      onLine: (_l, tag, _d, pid) => { if (tag === 'PERF-IDLE-READY' && !sampling) sampling = sampleIdle(pid, seconds); },
    });
    const ps = sampling ? await sampling : null;
    const d = r.perf['PERF-IDLE'];
    if (!ps || !d) { say(`- ${sc.label}: failed (${(r.perf['PERF-IDLE-ERROR'] || {}).error || 'no result'})`); continue; }
    results.push({ ...sc, ps, renderer: d });
  }
  say('| Scene | main | renderer | gpu | network | app total | shells | JS busy: renderer / main | top of the renderer profile | top of the main profile |\n|---|---:|---:|---:|---:|---:|---:|---|---|---|');
  for (const x of results) {
    const k = x.ps.byKind;
    const pr = x.renderer.profiles || {};
    const top3 = (p) => ((p && p.top) || []).slice(0, 3).map((t) => `${t.fn} ${t.ms} ms`).join('; ');
    say(`| ${x.label} | ${pct(k.main)} | ${pct(k.renderer)} | ${pct(k.gpu)} | ${pct(k['utility:network'])} | **${pct(x.ps.totalAppCpuPct)}** | ${pct(k.shell || 0)} | ${pr.renderer ? pct(pr.renderer.busyPct) : '—'} % / ${pr.main ? pct(pr.main.busyPct) : '—'} % | ${top3(pr.renderer)} | ${top3(pr.main)} |`);
  }
  return results;
}

// ---------- memory ----------
async function memory(kind) {
  say(`\n## memory (${kind}): working set in MB after a garbage collection`);
  const psByLabel = {};
  const r = await launch(kind, 'perf-memory.js', 'memory', {
    scenario: { steps: quick ? [0, 1, 10] : [0, 1, 10, 30], loop: quick ? 10 : 50 },
    timeoutMs: 300000,
    onLine: (_l, tag, d, pid) => { if (tag === 'PERF-MEMORY-STEP' && d) psByLabel[d.label] = snapshot(pid); },
  });
  const d = r.perf['PERF-MEMORY'];
  if (!d) { say(`failed: ${(r.perf['PERF-MEMORY-ERROR'] || {}).error || 'no result'}`); return null; }
  const kindKB = (step, type) => (step.processes || []).filter((p) => p.type === type).reduce((a, p) => a + (p.workingSetKB || 0), 0);
  say('| Scene | main | renderer | gpu | utility | app total | shells (ps rss) | renderer JS heap | main JS heap | DOM nodes (attached) | listeners |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of d.steps) {
    const ps = psByLabel[s.label] || [];
    const shells = ps.filter((p) => p.kind === 'shell' || p.kind === 'other').reduce((a, p) => a + p.rss, 0);
    const total = (s.processes || []).reduce((a, p) => a + (p.workingSetKB || 0), 0);
    s.shellsRssKB = shells; s.appTotalKB = total;
    say(`| ${s.label} (${s.panes} panes, ${s.webgl} WebGL) | ${mb(kindKB(s, 'Browser'))} | ${mb(kindKB(s, 'Tab'))} | ${mb(kindKB(s, 'GPU'))} | ${mb(kindKB(s, 'Utility'))} | **${mb(total)}** | ${mb(shells)} | ${mb(s.heapUsedKB)} | ${mb(s.mainHeapUsedKB)} | ${s.dom ? s.dom.nodes : '—'} (${s.attachedNodes}) | ${s.dom ? s.dom.jsEventListeners : '—'} |`);
  }
  if (d.loop) {
    const L = d.loop;
    say(`\nopen / close loop: ${L.n} local tabs in ${(L.ms / 1000).toFixed(1)} s — renderer heap ${mb(L.before.heapUsedKB)} → ${mb(L.after.heapUsedKB)} MB, main heap ${mb(L.before.mainHeapUsedKB)} → ${mb(L.after.mainHeapUsedKB)} MB, DOM nodes ${L.before.dom && L.before.dom.nodes} → ${L.after.dom && L.after.dom.nodes} (attached ${L.before.attachedNodes} → ${L.after.attachedNodes}), listeners ${L.before.dom && L.before.dom.jsEventListeners} → ${L.after.dom && L.after.dom.jsEventListeners}; left over: ${JSON.stringify(L.leftovers)}`);
  }
  return d;
}

// ---------- size ----------
function size() {
  say('\n## bundle size (dist/mac-arm64/MobAlt.app)');
  try {
    const text = execFileSync('bash', [path.join(root, 'scripts', 'perf-size.sh')], { encoding: 'utf8' });
    say(text.trim());
    return text;
  } catch (e) { say(`skipped: ${String(e.stderr || e.message).trim()}`); return null; }
}

(async () => {
  const result = { at: new Date().toISOString(), host: require('os').cpus()[0].model, runs, seconds, apps: {} };
  say(`# MobAlt perf — ${result.at} (${result.host}); out: ${outDir}`);
  for (const kind of apps) {
    if (kind === 'packaged' && !fs.existsSync(packagedApp)) { say(`\n(no packaged app at ${packagedApp}: npm run pack)`); continue; }
    const a = (result.apps[kind] = {});
    if (only.has('startup')) a.startup = await startup(kind);
    if (only.has('require') && kind === 'dev') a.requires = await requires();
    if (only.has('idle')) a.idle = await idle(kind);
    if (only.has('memory')) a.memory = await memory(kind);
  }
  if (only.has('size')) result.size = size();
  fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify(result, null, 2));
  say(`\nwritten: ${path.join(outDir, 'perf.json')}`);
})().catch((e) => { console.error(e); process.exit(1); });
