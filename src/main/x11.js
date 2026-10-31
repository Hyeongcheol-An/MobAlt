'use strict';
// X11 forwarding support: locate the local X server (XQuartz) and proxy
// forwarded X11 channels to it, swapping the fake cookie we handed to the
// remote host for the real local MIT-MAGIC-COOKIE-1 (same trick OpenSSH uses).
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

const XAUTH_CANDIDATES = ['/opt/X11/bin/xauth', '/usr/X11/bin/xauth', 'xauth'];

function launchdSocket(num) {
  try {
    for (const d of fs.readdirSync('/private/tmp')) {
      if (!d.startsWith('com.apple.launchd.')) continue;
      const p = `/private/tmp/${d}/org.xquartz:${num}`;
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

/**
 * Pick the local X display. Preference: an explicit launchd socket path in DISPLAY,
 * then XQuartz's launchd socket (starts XQuartz on demand), then a running server's
 * /tmp/.X11-unix socket, then a TCP-style DISPLAY as given.
 */
function findDisplay() {
  const env = process.env.DISPLAY || '';
  if (env.startsWith('/')) return env;
  const num = displayNumber(env || ':0');
  const ld = launchdSocket(num) || launchdSocket(0);
  if (ld) return ld;
  if (fs.existsSync(`/tmp/.X11-unix/X${num}`)) return `:${num}`;
  if (env && !env.startsWith(':')) return env;
  return null;
}

function displayNumber(display) {
  const m = /:(\d+)(\.\d+)?$/.exec(display || '');
  return m ? parseInt(m[1], 10) : 0;
}

function socketPathFor(display) {
  if (display.startsWith('/')) return display; // launchd socket path (XQuartz)
  if (display.startsWith(':')) return `/tmp/.X11-unix/X${displayNumber(display)}`;
  return null; // TCP display (host:N) – handled by proxy()
}

function tcpTarget(display) {
  const m = /^([^:]*):(\d+)/.exec(display);
  if (!m) return null;
  return { host: m[1] || '127.0.0.1', port: 6000 + parseInt(m[2], 10) };
}

function localCookie(display) {
  const num = displayNumber(display);
  for (const bin of XAUTH_CANDIDATES) {
    try {
      const out = execFileSync(bin, ['list'], { encoding: 'utf8', env: { ...process.env, DISPLAY: display } });
      let fallback = null;
      for (const line of out.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 3 || cols[1] !== 'MIT-MAGIC-COOKIE-1') continue;
        if (cols[0].endsWith(`:${num}`)) return cols[2];
        if (!fallback) fallback = cols[2];
      }
      if (fallback) return fallback;
    } catch {}
  }
  return null;
}

function isAvailable() {
  return !!findDisplay();
}

const XQUARTZ_APPS = ['/Applications/Utilities/XQuartz.app', '/Applications/XQuartz.app'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Make sure a local X server is reachable, starting XQuartz in the background if installed (like MobaXterm's built-in X server). */
async function ensureServer(onStatus, timeoutMs = 12000) {
  let d = findDisplay();
  if (d) return d;
  const appPath = XQUARTZ_APPS.find((p) => fs.existsSync(p));
  if (!appPath) return null;
  onStatus && onStatus('starting XQuartz…');
  try {
    spawn('open', ['-g', '-a', appPath], { stdio: 'ignore', detached: true }).unref();
  } catch {
    return null;
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(400);
    d = findDisplay();
    if (d) {
      await sleep(1200); // let the server finish initialising before the first client connects
      return d;
    }
  }
  return null;
}

/** Prepare per-connection X11 parameters (async: may start XQuartz). */
async function prepare(onStatus) {
  const display = await ensureServer(onStatus);
  if (!display) return null;
  const fake = crypto.randomBytes(16).toString('hex');
  const real = localCookie(display);
  return {
    display,
    socketPath: socketPathFor(display),
    screen: 0,
    protocol: 'MIT-MAGIC-COOKIE-1',
    fakeCookie: fake,
    realCookie: real,
  };
}

/** Pipe an accepted ssh2 x11 channel to the local X server. */
function proxy(channel, x11, onError) {
  const sock = x11.socketPath ? net.connect(x11.socketPath) : net.connect(tcpTarget(x11.display) || { port: 6000 });
  sock.once('error', (e) => onError && onError(`cannot connect to local X server at ${x11.socketPath || x11.display}: ${e.message}`));
  let header = Buffer.alloc(0);
  let done = !x11.realCookie; // nothing to swap if we have no local cookie

  const onData = (chunk) => {
    if (done) return sock.write(chunk);
    header = Buffer.concat([header, chunk]);
    if (header.length < 12) return;
    const le = header[0] === 0x6c; // 'l'
    const rd16 = (o) => (le ? header.readUInt16LE(o) : header.readUInt16BE(o));
    const n = rd16(6);
    const d = rd16(8);
    const pad = (x) => (4 - (x % 4)) % 4;
    const total = 12 + n + pad(n) + d + pad(d);
    if (header.length < total) return;
    const name = header.slice(12, 12 + n).toString('latin1');
    const dataStart = 12 + n + pad(n);
    const rest = header.slice(total);
    let out;
    if (name === 'MIT-MAGIC-COOKIE-1' && d === 16) {
      const real = Buffer.from(x11.realCookie, 'hex');
      out = Buffer.concat([header.slice(0, dataStart), real, header.slice(dataStart + 16, total)]);
    } else {
      out = header.slice(0, total);
    }
    done = true;
    sock.write(out);
    if (rest.length) sock.write(rest);
  };

  channel.on('data', onData);
  sock.on('data', (b) => channel.write(b));
  sock.on('error', () => channel.close());
  sock.on('close', () => channel.close());
  channel.on('close', () => sock.destroy());
  channel.on('error', () => sock.destroy());
}

module.exports = { prepare, proxy, isAvailable, ensureServer, findDisplay, displayNumber, socketPathFor };
