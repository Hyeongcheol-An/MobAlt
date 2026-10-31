'use strict';
// Notices when a different MobAlt.app has been written over the running one — `brew upgrade --cask mobalt`
// trashes the old bundle and puts the new one at the same path, a DMG dragged into Applications replaces it —
// while this process keeps executing the old code (and could even spawn helpers from the new bundle). The
// on-disk Info.plist is compared with the running version on a timer, when a window gets focus and after an
// update check; the renderer is told once per distinct version and shows a relaunch banner.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()
// Outside Electron (unit tests) require('electron') yields the binary path string, or throws when the
// Electron binary is not installed; the pure helpers below need neither (same pattern as store.js).
let electron = null;
try { electron = require('electron'); } catch { electron = null; }
const { app } = electron && typeof electron === 'object' ? electron : {};

const VERSION_KEY = 'CFBundleShortVersionString';

/** CFBundleShortVersionString of an XML plist's text, or null when the key is missing or empty. */
function readBundleVersion(plistText) {
  const re = new RegExp(`<key>\\s*${VERSION_KEY}\\s*</key>\\s*<string>([^<]*)</string>`);
  const m = re.exec(String(plistText || ''));
  if (!m) return null;
  const v = m[1].trim();
  return v || null;
}

/**
 * Compare dotted versions numerically ("0.11.0" > "0.9.1", unlike a string compare); a pre-release suffix
 * sorts before its release. Returns -1, 0 or 1.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const [main, ...pre] = String(v || '').trim().replace(/^v/, '').split('-');
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre: pre.join('-') };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** …/MobAlt.app for a running executable at …/MobAlt.app/Contents/MacOS/MobAlt. */
function bundlePath(execPath = process.execPath) {
  return path.resolve(execPath, '..', '..', '..');
}

/**
 * How to restart into the bundle on disk. A bundle that Homebrew (or a browser download) wrote still carries the
 * quarantine attribute until LaunchServices opens it, and a raw exec of its binary can be refused or show a
 * confusing prompt — so the relaunch goes through `open -n -a <bundle>` (Chromium's relauncher execs it only
 * after this process has exited, so no second instance). Returns null when there is no bundle (running from
 * source): plain app.relaunch() is right then.
 * @param bundle   …/MobAlt.app (default: the running executable's bundle)
 * @param exists   fs.existsSync, injectable for tests
 */
function relaunchOptions(bundle = bundlePath(), exists = fs.existsSync) {
  if (!exists(path.join(bundle, 'Contents', 'Info.plist'))) return null;
  return { execPath: '/usr/bin/open', args: ['-n', '-a', bundle] };
}

/** An Info.plist as XML text; a binary plist goes through plutil. Rejects when the file cannot be read. */
function readPlistXml(file) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (err, buf) => {
      if (err) return reject(err);
      if (buf.subarray(0, 6).toString('latin1') !== 'bplist') return resolve(buf.toString('utf8'));
      execFile('plutil', ['-convert', 'xml1', '-o', '-', file], { maxBuffer: 4 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(String(out))));
    });
  });
}

/**
 * @param opts.getWin      () => BrowserWindow | null — the renderer that gets `app:bundle-updated { version, current }`
 * @param opts.intervalMs  poll interval (default 60 s)
 * @param opts.enabled     defaults to a packaged macOS build; the test hook calls send() directly instead
 */
function startBundleWatch({ getWin, intervalMs = 60000, enabled } = {}) {
  const current = app ? app.getVersion() : '';
  const active = enabled !== undefined ? !!enabled : !!(app && app.isPackaged && process.platform === 'darwin');
  const plist = path.join(bundlePath(), 'Contents', 'Info.plist');
  let announced = null; // last version the renderer was told about
  let pending = null;
  let timer = null;

  /** Raw renderer event (no de-duplication): the real checks go through announce(). */
  const send = (version) => {
    const w = getWin && getWin();
    if (!w || w.isDestroyed()) return false;
    w.webContents.send('app:bundle-updated', { version: String(version), current });
    return true;
  };
  /** Tell the renderer about an on-disk version once; a later check with the same version stays quiet. */
  const announce = (version) => {
    if (!version || version === announced) return false;
    if (!send(version)) return false; // no window right now: the next check tries again
    announced = version;
    return true;
  };
  /** The bundle's version on disk; null when its plist is missing or unreadable (e.g. mid-replacement). */
  const diskVersion = async () => {
    try { return readBundleVersion(await readPlistXml(plist)); } catch { return null; }
  };
  const check = () => {
    if (!active) return Promise.resolve(null);
    if (!pending) {
      pending = diskVersion().then((v) => {
        pending = null;
        if (v && v !== current) announce(v);
        return v;
      });
    }
    return pending;
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (app) app.removeListener('browser-window-focus', check);
  };
  if (active) {
    timer = setInterval(check, intervalMs);
    if (timer.unref) timer.unref();
    app.on('browser-window-focus', check);
  }
  return { active, current, plist, check, announce, send, diskVersion, stop };
}

module.exports = { startBundleWatch, readBundleVersion, compareVersions, bundlePath, readPlistXml, relaunchOptions };
