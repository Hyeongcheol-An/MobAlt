'use strict';
// Network tools: ping/traceroute (streamed), port scan, DNS lookup, local network info — and the single probes
// (pingOnce, tcpConnect) with the worker queue (runQueue) that netscan.js builds the network scanner from.
const { spawn } = require('child_process');
const net = require('net');
const dns = require('dns');
const os = require('os');
const crypto = require('crypto');

const running = new Map();

function streamCommand(win, cmd, args) {
  const id = 'tool_' + crypto.randomBytes(4).toString('hex');
  const p = spawn(cmd, args, { env: { ...process.env, LANG: 'C' } });
  running.set(id, p);
  const send = (text) => win && !win.isDestroyed() && win.webContents.send('tools:output', { id, text });
  p.stdout.on('data', (d) => send(d.toString()));
  p.stderr.on('data', (d) => send(d.toString()));
  p.on('error', (e) => send(`error: ${e.message}\n`));
  p.on('close', (code) => {
    send(code === null ? '\n[stopped]\n' : `\n[exit ${code}]\n`);
    running.delete(id);
    win && !win.isDestroyed() && win.webContents.send('tools:done', { id, code });
  });
  return id;
}

function stop(id) {
  const p = running.get(id);
  if (p) p.kill();
}

/** macOS keeps IPv6 in separate binaries (ping6, traceroute6); Linux's take -6. */
const v6Tool = (tool, host) => (net.isIPv6(host) ? (process.platform === 'linux' ? { bin: tool, args: ['-6'] } : { bin: tool + '6', args: [] }) : { bin: tool, args: [] });

function ping(win, host, count = 5) {
  const t = v6Tool('ping', host);
  return streamCommand(win, t.bin, [...t.args, '-c', String(count), host]);
}

function traceroute(win, host) {
  const t = v6Tool('traceroute', host);
  return streamCommand(win, t.bin, [...t.args, '-m', '30', '-q', '1', '-w', '2', host]);
}

/** Runs fn(item, index) over `items` with at most `concurrency` in flight; once isCancelled() is true no further item is taken. */
async function runQueue(items, concurrency, fn, isCancelled = () => false) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !isCancelled()) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

/**
 * One TCP connect: resolves { open, ms } (ms = the time it took to connect, or to give up) and never rejects. A
 * `sockets` Set holds the socket while it is in flight, so a cancelled scan can destroy it (which answers "closed").
 */
function tcpConnect(host, port, timeout = 800, sockets = null) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const t0 = Date.now();
    let done = false;
    const fin = (open) => {
      if (done) return;
      done = true;
      if (sockets) sockets.delete(s);
      s.destroy();
      resolve({ open, ms: Date.now() - t0 });
    };
    if (sockets) sockets.add(s);
    s.setTimeout(timeout);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    s.once('close', () => fin(false));
    s.connect(port, host);
  });
}

async function portScan(host, from, to, timeout = 800, concurrency = 200) {
  const ports = [];
  for (let p = from; p <= to; p++) ports.push(p);
  const open = [];
  await runQueue(ports, concurrency, async (port) => {
    if ((await tcpConnect(host, port, timeout)).open) open.push(port);
  });
  open.sort((a, b) => a - b);
  return open;
}

/**
 * One ICMP echo through the system `ping` (no raw socket, so no root): resolves { alive, ms } — ms from ping's own
 * "time=" when it answered, null otherwise — and never rejects. BSD ping waits a whole interval after its last packet
 * whatever -W says, so the process is killed at `timeout` ms. An IPv6 address goes through `ping6` on macOS (its
 * `ping` cannot resolve one; ping6 has no deadline options, the kill bounds it) and `ping -6` on Linux. A `procs`
 * Set holds the child while it runs, so a cancelled scan can kill it.
 */
function pingOnce(host, timeout = 600, procs = null) {
  return new Promise((resolve) => {
    const secs = String(Math.max(1, Math.ceil(timeout / 1000)));
    const v6 = net.isIPv6(host);
    const bin = v6 && process.platform !== 'linux' ? 'ping6' : 'ping';
    const args = process.platform === 'linux' ? [...(v6 ? ['-6'] : []), '-c', '1', '-W', secs, '-n', host]
      : v6 ? ['-c', '1', '-n', host]
        : ['-c', '1', '-W', String(timeout), '-t', secs, '-n', host];
    let p;
    try { p = spawn(bin, args, { env: { ...process.env, LANG: 'C' } }); } catch { return resolve({ alive: false, ms: null }); }
    if (procs) procs.add(p);
    let out = '', done = false, timer = null;
    const fin = (alive) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (procs) procs.delete(p);
      const m = out.match(/time[=<]\s*([\d.]+)\s*ms/);
      resolve({ alive, ms: alive && m ? parseFloat(m[1]) : null });
    };
    timer = setTimeout(() => { try { p.kill(); } catch {} fin(false); }, timeout + 50);
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => fin(false));
    p.on('close', (code) => fin(code === 0 && /bytes from/.test(out)));
  });
}

async function lookup(host) {
  const out = { host };
  try {
    out.addresses = await dns.promises.lookup(host, { all: true });
  } catch (e) {
    out.error = e.message;
  }
  try {
    out.mx = await dns.promises.resolveMx(host);
  } catch {}
  try {
    out.txt = await dns.promises.resolveTxt(host);
  } catch {}
  if (net.isIP(host)) {
    try {
      out.reverse = await dns.promises.reverse(host);
    } catch {}
  }
  return out;
}

function netinfo() {
  const ifaces = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (a.internal) continue;
      list.push({ name, family: a.family, address: a.address, netmask: a.netmask, mac: a.mac });
    }
  }
  return { hostname: os.hostname(), interfaces: list, dns: dns.getServers() };
}

module.exports = { ping, traceroute, portScan, lookup, netinfo, stop, pingOnce, tcpConnect, runQueue };
