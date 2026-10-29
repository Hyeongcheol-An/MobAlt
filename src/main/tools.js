'use strict';
// Network tools: ping/traceroute (streamed), port scan, DNS lookup, local network info.
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
    send(`\n[exit ${code}]\n`);
    running.delete(id);
    win && !win.isDestroyed() && win.webContents.send('tools:done', { id, code });
  });
  return id;
}

function stop(id) {
  const p = running.get(id);
  if (p) p.kill();
}

function ping(win, host, count = 5) {
  return streamCommand(win, 'ping', ['-c', String(count), host]);
}

function traceroute(win, host) {
  return streamCommand(win, 'traceroute', ['-m', '30', '-q', '1', '-w', '2', host]);
}

async function portScan(host, from, to, timeout = 800, concurrency = 200) {
  const ports = [];
  for (let p = from; p <= to; p++) ports.push(p);
  const open = [];
  let i = 0;
  const worker = () =>
    new Promise((resolve) => {
      const next = () => {
        if (i >= ports.length) return resolve();
        const port = ports[i++];
        const s = new net.Socket();
        let done = false;
        const fin = (ok) => {
          if (done) return;
          done = true;
          s.destroy();
          if (ok) open.push(port);
          next();
        };
        s.setTimeout(timeout);
        s.once('connect', () => fin(true));
        s.once('timeout', () => fin(false));
        s.once('error', () => fin(false));
        s.connect(port, host);
      };
      next();
    });
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker));
  open.sort((a, b) => a - b);
  return open;
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

module.exports = { ping, traceroute, portScan, lookup, netinfo, stop };
