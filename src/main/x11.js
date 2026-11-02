'use strict';
// X11 forwarding support: locate the local X server (XQuartz) and proxy
// forwarded X11 channels to it, swapping the fake cookie we handed to the
// remote host for the real local MIT-MAGIC-COOKIE-1 (same trick OpenSSH uses).
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { t, tn, tt } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn(); these are printed into the SSH pane, so tt()

const XAUTH_CANDIDATES = ['/opt/X11/bin/xauth', '/usr/X11/bin/xauth', 'xauth'];

// XQuartz's launchd socket in its per-session folder under /private/tmp. (launchctl getenv DISPLAY may name one under
// /var/run instead; a client connected through that one got no answer from the server in testing, while the running
// server's /tmp/.X11-unix socket — the next choice — works, so it is not used.)
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

/**
 * The cookie the local server expects. `xauth list :N` is asked first: xauth resolves that to this Mac's own entry
 * (host/unix:N) — the one XQuartz wrote when it started. The old scan of the whole list took the first entry whose
 * name ended in :N, which on a Mac that has used X over the network is a stale 192.168.x.x:0 cookie ahead of the local
 * one, and the server then answered every forwarded client with "Invalid MIT-MAGIC-COOKIE-1 key".
 */
function localCookie(display) {
  const num = displayNumber(display);
  const parse = (out) => {
    let fallback = null;
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3 || cols[1] !== 'MIT-MAGIC-COOKIE-1') continue;
      if (/\/unix:\d+$/.test(cols[0]) && cols[0].endsWith(`:${num}`)) return cols[2]; // the local socket's entry first
      if (cols[0].endsWith(`:${num}`) && !fallback) fallback = cols[2];
    }
    return fallback;
  };
  for (const bin of XAUTH_CANDIDATES) {
    try {
      const env = { ...process.env, DISPLAY: display };
      const exact = parse(execFileSync(bin, ['list', `:${num}`], { encoding: 'utf8', env }));
      if (exact) return exact;
      const any = parse(execFileSync(bin, ['list'], { encoding: 'utf8', env }));
      if (any) return any;
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
  onStatus && onStatus(tt('starting XQuartz…'));
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

/**
 * Is `presented` (the cookie bytes an X client sent in its setup request) the fake cookie handed to sshd for this
 * session? sshd does not check X11 cookies itself, so this check is the only thing that keeps other users of the
 * remote host away from the Mac's X server: without it any local process there could connect to the forwarded display
 * and be given the real cookie.
 */
function cookieMatches(presented, fakeHex) {
  if (!fakeHex) return false;
  const fake = Buffer.from(fakeHex, 'hex');
  return Buffer.isBuffer(presented) && presented.length === fake.length && crypto.timingSafeEqual(presented, fake);
}

/**
 * Pipe an accepted ssh2 x11 channel to the local X server. With a fake cookie in place the client's setup request must
 * carry exactly that cookie (MIT-MAGIC-COOKIE-1); anything else — another cookie, another protocol, no authorisation —
 * closes the channel before a byte reaches the X server, like OpenSSH's x11_open_helper. A matching cookie is replaced
 * by the real local one when there is one.
 */
function proxy(channel, x11, onError) {
  const sock = x11.socketPath ? net.connect(x11.socketPath) : net.connect(tcpTarget(x11.display) || { port: 6000 });
  sock.once('error', (e) => onError && onError(tt('cannot connect to local X server at {display}: {error}', { display: x11.socketPath || x11.display, error: e.message })));
  let header = Buffer.alloc(0);
  // nothing to check or swap when the session has neither a fake nor a local cookie
  let done = !x11.fakeCookie && !x11.realCookie;
  let refused = false;

  const refuse = () => {
    refused = true;
    header = Buffer.alloc(0);
    onError && onError(t('permission denied'));
    sock.destroy();
    try { channel.close(); } catch {}
  };

  const onData = (chunk) => {
    if (refused) return;
    if (done) return sock.write(chunk);
    header = Buffer.concat([header, chunk]);
    if (header.length < 12) return;
    if (header[0] !== 0x6c && header[0] !== 0x42) return refuse(); // neither 'l' nor 'B': not an X11 setup request
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
    if (x11.fakeCookie) {
      if (name !== 'MIT-MAGIC-COOKIE-1' || !cookieMatches(header.slice(dataStart, dataStart + d), x11.fakeCookie)) return refuse();
      out = x11.realCookie
        ? Buffer.concat([header.slice(0, dataStart), Buffer.from(x11.realCookie, 'hex'), header.slice(dataStart + d, total)])
        : header.slice(0, total);
    } else {
      out = header.slice(0, total);
    }
    done = true;
    header = Buffer.alloc(0);
    sock.write(out);
    if (rest.length) sock.write(rest);
  };

  channel.on('data', onData);
  sock.on('data', (b) => channel.write(b));
  sock.on('error', () => channel.close());
  sock.on('close', () => channel.close());
  // A remote X client that exits gets its channel half-closed by sshd (EOF, no close): the local socket is ended at
  // once so that XQuartz drops the client and its window — otherwise the window stayed on screen until the SSH
  // session itself disconnected. The other way round, the X server ending the connection sends the client EOF.
  channel.on('end', () => sock.end());
  sock.on('end', () => { try { channel.end(); } catch {} });
  channel.on('close', () => sock.destroy());
  channel.on('error', () => sock.destroy());
}

module.exports = { prepare, proxy, cookieMatches, isAvailable, ensureServer, findDisplay, displayNumber, socketPathFor };
