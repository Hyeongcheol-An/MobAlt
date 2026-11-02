'use strict';
// What a window may ask the Mac to open (shell:open-external, shell:open-path, window.open, launch:vnc) and where a
// window may navigate. The renderer shows text from servers (terminal output, OSC 8 links, file names, web pages in
// browser panes), so these IPC channels are treated as reachable by that text: anything that would start a program
// — a custom URL scheme handled by some app, a file:// URL, an .app or .command file — is refused here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** May this URL go to the default browser / mail app? Only http(s) and mailto, well-formed. */
function externalUrlAllowed(url) {
  if (typeof url !== 'string' || url.length > 8192) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!EXTERNAL_SCHEMES.has(u.protocol)) return false;
  return u.protocol === 'mailto:' || !!u.hostname;
}

const isUnder = (p, root) => {
  const rel = path.relative(root, p);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

/**
 * May shell:open-path open this? Only an existing folder (Finder shows it; a file could be an app or a .command
 * script that macOS would run) inside the home folder, the temporary folder or the download folder of the settings.
 * Symbolic links are resolved first, so a link inside home that points elsewhere does not count.
 */
function openPathAllowed(p, { downloadDir } = {}) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  const target = real(p);
  if (!target) return false;
  let st;
  try { st = fs.statSync(target); } catch { return false; }
  if (!st.isDirectory()) return false;
  const roots = [os.homedir(), os.tmpdir(), downloadDir].filter((r) => typeof r === 'string' && path.isAbsolute(r)).map(real).filter(Boolean);
  return roots.some((r) => isUnder(target, r));
}

/** The vnc:// URL for a VNC session, or null when the host or user name would change what the URL means. */
function vncUrl(cfg) {
  const host = String((cfg && cfg.host) || '');
  const port = Number((cfg && cfg.port) || 5900);
  if (!/^(\[[0-9A-Fa-f:.%\w]+\]|[A-Za-z0-9._-]+)$/.test(host) || host.startsWith('-')) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const user = cfg.username ? encodeURIComponent(String(cfg.username)) + '@' : '';
  return `vnc://${user}${host}:${port}`;
}

/**
 * The .rdp file Microsoft's Remote Desktop app opens for an RDP session: { name, text }. One line per setting, so a
 * CR / LF (or any control character) in an imported host or user name — which would add settings of its own: a drive
 * redirection, an alternate shell — is removed.
 */
function rdpFile(cfg) {
  const oneLine = (v) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '');
  const port = Number(cfg && cfg.port) || 3389;
  const lines = [
    `full address:s:${oneLine(cfg.host)}${port !== 3389 ? ':' + port : ''}`,
    `username:s:${oneLine(cfg.username)}`,
    'screen mode id:i:2',
    'use multimon:i:0',
    'session bpp:i:32',
    'audiomode:i:0',
    'redirectclipboard:i:1',
    'authentication level:i:2',
    'prompt for credentials:i:1',
  ];
  return { name: `${oneLine(cfg.name || cfg.host).replace(/[^\w.-]+/g, '_')}.rdp`, text: lines.join('\r\n') + '\r\n' };
}

/** May a window (the app's own page) navigate to `url`? Only to its own index.html (any query: detached windows). */
function windowNavigationAllowed(url, indexFile) {
  try {
    const u = new URL(url);
    const own = pathToFileURL(indexFile);
    return u.protocol === 'file:' && u.pathname === own.pathname;
  } catch {
    return false;
  }
}

module.exports = { externalUrlAllowed, openPathAllowed, vncUrl, rdpFile, windowNavigationAllowed };
