'use strict';
// Network scanner: a CIDR, an address range or one host → every address to try (expandTargets, pure), then an ICMP
// ping and/or TCP connects to a short port list over a worker queue, the answers streamed as they come (scan). The
// probes are tools.js's (the same ones Ping and Port scan use).
const net = require('net');
const dns = require('dns');
const { pingOnce, tcpConnect, runQueue } = require('./tools');

const MAX_HOSTS = 65536; // a /16
const MAX_PORTS = 256;
const DEFAULT_PORTS = [22, 80, 443, 3389, 5900];

const ip4 = (s) => (net.isIPv4(s) ? s.split('.').reduce((n, o) => n * 256 + Number(o), 0) : null);
const toIp4 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const fmt = (n) => n.toLocaleString('en-US');

/**
 * The addresses a target spec stands for, in order:
 *   `192.168.1.0/24`           a CIDR: the host addresses (network and broadcast left out; a /31 and a /32 keep every address)
 *   `10.0.0.1-10.0.0.50`       an inclusive range; `10.0.0.1-50` runs over the last octet
 *   `10.0.0.7`, `web-01.lan`   one host (an IPv6 address or a host name is passed through as is)
 * Throws with a readable message on anything else, on a reversed range and on more than a /16 (65,536 addresses).
 */
function expandTargets(spec) {
  const s = String(spec ?? '').trim();
  if (!s) throw new Error('Enter a target: a CIDR (192.168.1.0/24), a range (10.0.0.1-10.0.0.50) or a host');
  const tooLarge = (n) => new Error(`Range too large: ${fmt(n)} addresses; the limit is a /16 (${fmt(MAX_HOSTS)})`);
  let m;
  if ((m = s.match(/^(\S+)\/(\d{1,2})$/))) {
    const base = ip4(m[1]), prefix = Number(m[2]);
    if (base === null || prefix > 32) throw new Error(`Not a valid CIDR: ${s}`);
    const size = 2 ** (32 - prefix);
    if (size > MAX_HOSTS) throw tooLarge(size);
    const network = Math.floor(base / size) * size;
    if (prefix >= 31) return Array.from({ length: size }, (_, i) => toIp4(network + i));
    return Array.from({ length: size - 2 }, (_, i) => toIp4(network + 1 + i));
  }
  if ((m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\S+)$/))) {
    const from = ip4(m[1]);
    let to = ip4(m[2]);
    if (from !== null && to === null && /^\d{1,3}$/.test(m[2]) && Number(m[2]) <= 255) to = Math.floor(from / 256) * 256 + Number(m[2]);
    if (from === null || to === null) throw new Error(`Not a valid range: ${s}`);
    if (to < from) throw new Error(`The range ends before it starts: ${s}`);
    const size = to - from + 1;
    if (size > MAX_HOSTS) throw tooLarge(size);
    return Array.from({ length: size }, (_, i) => toIp4(from + i));
  }
  if (net.isIP(s)) return [s];
  // a host name: labels of letters, digits and dashes; the last label is never all digits (that is a mistyped address)
  if (/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*\.?$/i.test(s) && !/(^|\.)\d+\.?$/.test(s)) return [s];
  throw new Error(`Not a CIDR, an address range or a host name: ${s}`);
}

/** A port list such as `22,80,443` or `8000-8010 22` → sorted unique ports; empty → the default list. Throws on nonsense or more than 256 ports. */
function parsePorts(spec) {
  const s = String(spec ?? '').trim();
  if (!s) return DEFAULT_PORTS.slice();
  const set = new Set();
  for (const part of s.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!m) throw new Error(`Not a port: ${part}`);
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b > 65535 || b < a) throw new Error(`Ports must be between 1 and 65535: ${part}`);
    for (let p = a; p <= b; p++) {
      set.add(p);
      if (set.size > MAX_PORTS) throw new Error(`Too many ports; the limit is ${MAX_PORTS}`);
    }
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * Scans `targets` (expandTargets' list) and reports through `emit`:
 *   { type: 'hit', ip, host, hostname, rtt, ports }  a host that answered (ping reply or an open port); rtt in ms — the
 *                                                     ping's, else the fastest connect —, ports the open ones
 *   { type: 'progress', done, total }                 at most every ~100 ms, and once at the end
 *   { type: 'error', host, message }                  a host name that does not resolve
 *   { type: 'done', done, total, hits, cancelled, ms }
 * `method` is 'ping', 'tcp' or 'both'; `reverseDns` looks the name of every hit up (1.5 s at most). Returns
 * { promise, cancel, total }: cancel() stops the queue, kills the pings and connects still in flight and the 'done'
 * event follows at once.
 */
function scan(targets, { method = 'both', ports = DEFAULT_PORTS, concurrency = 64, timeout = 600, reverseDns = true } = {}, emit) {
  const total = targets.length;
  const usePing = method !== 'tcp', useTcp = method !== 'ping';
  const procs = new Set(), sockets = new Set(), waiters = new Set();
  let cancelled = false, done = 0, hits = 0, lastProgress = 0;
  const t0 = Date.now();
  const progress = (force) => {
    const now = Date.now();
    if (!force && now - lastProgress < 100) return;
    lastProgress = now;
    emit({ type: 'progress', done, total });
  };
  const reverse = (ip) => new Promise((resolve) => {
    const fin = (v) => { waiters.delete(fin); clearTimeout(t); resolve(v); };
    waiters.add(fin);
    const t = setTimeout(() => fin(null), 1500);
    dns.promises.reverse(ip).then((names) => fin(names[0] || null), () => fin(null));
  });
  const one = async (target) => {
    let ip = target, hostname = null;
    if (!net.isIP(target)) {
      try { ip = (await dns.promises.lookup(target)).address; hostname = target; }
      catch { if (!cancelled) emit({ type: 'error', host: target, message: `Cannot resolve ${target}` }); return; }
    }
    if (cancelled) return;
    const [ping, tcp] = await Promise.all([
      usePing ? pingOnce(ip, timeout, procs) : null,
      useTcp ? Promise.all(ports.map((port) => tcpConnect(ip, port, timeout, sockets).then((r) => ({ port, ...r })))) : [],
    ]);
    if (cancelled) return;
    const open = tcp.filter((r) => r.open);
    if (!(ping && ping.alive) && !open.length) return;
    const rtt = ping && ping.alive && ping.ms !== null ? ping.ms : open.length ? Math.min(...open.map((r) => r.ms)) : null;
    if (reverseDns && !hostname) hostname = await reverse(ip);
    if (cancelled) return;
    hits++;
    emit({ type: 'hit', ip, host: target, hostname, rtt, ports: open.map((r) => r.port) });
  };
  const promise = runQueue(targets, concurrency, async (t) => {
    try { await one(t); } catch {}
    done++;
    if (!cancelled) progress(false);
  }, () => cancelled).then(() => {
    progress(true);
    emit({ type: 'done', done, total, hits, cancelled, ms: Date.now() - t0 });
  });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const p of procs) { try { p.kill(); } catch {} }
    for (const s of sockets) { try { s.destroy(); } catch {} }
    for (const w of waiters) w(null);
  };
  return { promise, cancel, total };
}

module.exports = { expandTargets, parsePorts, scan, MAX_HOSTS, MAX_PORTS, DEFAULT_PORTS };
