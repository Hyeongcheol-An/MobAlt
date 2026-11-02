'use strict';
/**
 * macOS Local Network privacy (macOS 15 and later, Apple TN3179). The first time an app reaches a device on the local
 * network the system asks the user; until they allow it — and for good once they declined — the kernel's packet
 * filter refuses the connection on this Mac before anything is sent. The socket fails with EHOSTUNREACH ("No route
 * to host"), which reads like a routing problem although `ssh host` in a terminal works (command-line tools run from
 * Terminal are exempt) and hosts outside the local network connect fine. The check sits deep in the networking
 * stack, so every connection the app makes is subject to it: SSH, Telnet, FTP, Mosh's bootstrap, the Tools panel.
 *
 * hint(e, host) is the sentence to append to a connection error when this is the likely cause: macOS 15 or later
 * (Darwin 24 — the setting does not exist before), EHOSTUNREACH, and the address the error names (or `host`) is a
 * local one — private IPv4, link-local, unique-local or link-local IPv6, or a .local name. Loopback is exempt from
 * the privacy check and never hinted. A router can also answer "host unreachable" for a private address behind a
 * VPN that is down, so the sentence says "usually".
 *
 * main.js listens (onBlocked) and shows, once per run, the dialog that opens the setting; a call site that printed
 * the hint calls notify(host).
 */
const os = require('os');
const i18n = require('./i18n');

/** Where macOS keeps the switch (System Settings → Privacy & Security → Local Network). */
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork';

/** True for an address the Local Network privacy check covers: private/link-local IPv4, ULA/link-local IPv6, .local names. */
function isLocalAddress(host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isLocalAddress(mapped[1]);
    const bare = h.replace(/%.*$/, ''); // zone index (fe80::1%en0)
    return /^f[cd][0-9a-f]{2}:/.test(bare) || /^fe[89ab][0-9a-f]:/.test(bare);
  }
  return h.endsWith('.local') || h.endsWith('.local.');
}

const message = (e) => String((e && e.message) || e || '');

/** Whether an error is the kernel's "no route to host" (Node's EHOSTUNREACH, or OpenSSH's wording in a pty). */
function isHostUnreachable(e) {
  if (!e) return false;
  if (e.code === 'EHOSTUNREACH') return true;
  return /\bEHOSTUNREACH\b|No route to host/.test(message(e));
}

/** The address the error names: Node's `address` on a connect error, else the one in its message ("connect EHOSTUNREACH 192.168.1.20:22 - Local (…)"), or null. */
function unreachableAddress(e) {
  if (e && typeof e.address === 'string' && e.address) return e.address.replace(/^\[|\]$/g, '');
  const m = /EHOSTUNREACH\s+(\S+?):\d+(?=\s|$)/.exec(message(e));
  return m ? m[1].replace(/^\[|\]$/g, '') : null;
}

/**
 * The sentence to append to a connection error, or null when the Local Network permission is not the likely cause.
 * `platform` and `release` are for the tests; the check only exists on macOS 15 and later (Darwin 24).
 */
function hint(e, host, platform = process.platform, release = os.release()) {
  if (platform !== 'darwin' || !(Number(String(release).split('.')[0]) >= 24) || !isHostUnreachable(e)) return null;
  const addr = unreachableAddress(e) || host;
  if (!isLocalAddress(addr)) return null;
  const t = i18n.t;
  return t('On a Mac this usually means macOS has not allowed MobAlt on the local network: turn MobAlt on under System Settings → Privacy & Security → Local Network, then connect again.');
}

let listener = null;
/** main.js: what to do when a connection was refused this way (it shows the dialog once per run). */
function onBlocked(fn) { listener = typeof fn === 'function' ? fn : null; }
/** A call site that printed the hint says so; `host` is what the user typed. */
function notify(host) {
  if (!listener) return;
  try {
    const r = listener(host);
    if (r && typeof r.catch === 'function') r.catch(() => {}); // the dialog is best effort
  } catch {}
}

module.exports = { SETTINGS_URL, isLocalAddress, isHostUnreachable, unreachableAddress, hint, onBlocked, notify };
