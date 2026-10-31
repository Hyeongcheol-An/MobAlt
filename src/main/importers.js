'use strict';
// Session importers: ~/.ssh/config and MobaXterm.ini bookmarks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function expandHome(p) {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function globSimple(pattern) {
  // supports a single '*' in the basename only
  pattern = expandHome(pattern);
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!base.includes('*')) return fs.existsSync(pattern) ? [pattern] : [];
  const re = new RegExp('^' + base.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Parse OpenSSH client config into session objects. */
function parseSshConfig(file = path.join(os.homedir(), '.ssh', 'config'), seen = new Set()) {
  file = expandHome(file);
  if (seen.has(file)) return [];
  seen.add(file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const sessions = [];
  let cur = null;
  const push = () => {
    if (!cur) return;
    for (const alias of cur.aliases) {
      if (/[*?!]/.test(alias)) continue;
      const s = {
        id: crypto.randomUUID(),
        name: alias,
        folder: 'ssh config',
        type: 'ssh',
        host: cur.HostName || alias,
        port: cur.Port ? parseInt(cur.Port, 10) : 22,
        username: cur.User || '',
        authMethod: cur.IdentityFile ? 'auto' : 'auto',
        privateKeyPath: cur.IdentityFile ? cur.IdentityFile.replace(os.homedir(), '~') : '',
        x11: /^yes$/i.test(cur.ForwardX11 || '') || /^yes$/i.test(cur.ForwardX11Trusted || ''),
        agentForward: /^yes$/i.test(cur.ForwardAgent || ''),
        jumpHost: cur.ProxyJump || '',
        compression: /^yes$/i.test(cur.Compression || ''),
        sftpAuto: true,
      };
      sessions.push(s);
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(\S+)\s*[=\s]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^"(.*)"$/, '$1');
    const lk = key.toLowerCase();
    if (lk === 'include') {
      for (const pat of val.split(/\s+/)) {
        const p = pat.startsWith('/') || pat.startsWith('~') ? pat : path.join(os.homedir(), '.ssh', pat);
        for (const f of globSimple(p)) sessions.push(...parseSshConfig(f, seen));
      }
      continue;
    }
    if (lk === 'host') {
      push();
      cur = { aliases: val.split(/\s+/) };
      continue;
    }
    if (lk === 'match') {
      push();
      cur = null;
      continue;
    }
    if (!cur) continue;
    const canon = { hostname: 'HostName', user: 'User', port: 'Port', identityfile: 'IdentityFile', forwardx11: 'ForwardX11', forwardx11trusted: 'ForwardX11Trusted', forwardagent: 'ForwardAgent', proxyjump: 'ProxyJump', compression: 'Compression' }[lk];
    if (canon && cur[canon] === undefined) cur[canon] = val;
  }
  push();
  return sessions;
}

function decodeIni(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  let zeros = 0;
  for (let i = 1; i < Math.min(buf.length, 4000); i += 2) if (buf[i] === 0) zeros++;
  if (zeros > 500) return buf.toString('utf16le');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

const MOBA_TYPES = { 109: 'ssh', 98: 'telnet', 91: 'rdp', 128: 'vnc', 100: 'local', 143: 'ssh' };

/** Parse MobaXterm.ini bookmark sections. Best effort (format is undocumented). */
function parseMobaXtermIni(file) {
  return parseMobaXtermIniDetailed(file).sessions;
}

/** parseMobaXtermIni plus the bookmarks it could not use, as { entry, reason }: { sessions, skipped }. */
function parseMobaXtermIniDetailed(file) {
  const text = decodeIni(fs.readFileSync(file));
  const sessions = [];
  const skipped = [];
  let section = null;
  let folder = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1];
      folder = '';
      continue;
    }
    if (!section || !/^Bookmarks/.test(section)) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'SubRep') {
      folder = val.replace(/\\/g, '/');
      continue;
    }
    if (key === 'ImgNum') continue;
    const m = /^#(\d+)#(\d+)%(.*)$/.exec(val);
    if (!m) continue;
    const type = MOBA_TYPES[m[1]];
    if (!type) {
      skipped.push({ entry: `"${key}"`, reason: `unsupported session type #${m[1]}` });
      continue;
    }
    const body = m[3].split('#')[0];
    const f = body.split('%');
    const s = {
      id: crypto.randomUUID(),
      name: key,
      folder: folder ? 'MobaXterm/' + folder : 'MobaXterm',
      type,
      host: f[0] || '',
      port: parseInt(f[1], 10) || (type === 'ssh' ? 22 : type === 'telnet' ? 23 : type === 'rdp' ? 3389 : 5900),
      username: (f[2] || '').replace(/^<default>$/i, ''),
      authMethod: 'auto',
      privateKeyPath: '',
      x11: type === 'ssh' && f[4] === '-1',
      compression: type === 'ssh' && f[5] === '-1',
      sftpAuto: true,
    };
    const keyField = f.find((x) => /\.(ppk|pem|key)$|id_(rsa|ed25519|ecdsa)/i.test(x));
    if (keyField) {
      s.privateKeyPath = keyField.replace(/\\/g, '/');
      s.notes = 'Imported key path from Windows; convert .ppk with puttygen and fix the path.';
    }
    if (s.host) sessions.push(s);
    else skipped.push({ entry: `"${key}"`, reason: 'no host' });
  }
  return { sessions, skipped };
}

const SESSION_TYPES = ['ssh', 'mosh', 'local', 'telnet', 'serial', 'ftp', 'rdp', 'vnc'];

/**
 * Validate the text of a MobAlt sessions export, or a hand-written file of the same shape. Returns
 * { sessions, folders, skipped }: the usable sessions normalised (trimmed string name, a known type with 'ssh'
 * when absent, an integer port when one is given, a string id — fresh when missing — and a string folder) and
 * the rejected entries as { entry, reason }; or { error } when the file is not a sessions file at all (not
 * JSON, no top-level object, no "sessions" array). Secrets and the exporter's hasPassword/… flags are passed
 * through untouched: what to do with them is the store's business.
 */
function parseSessionsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `not JSON (${e.message})` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'the top level is not an object' };
  if (!Array.isArray(data.sessions)) return { error: 'no "sessions" array' };
  const sessions = [];
  const skipped = [];
  data.sessions.forEach((s, i) => {
    const named = !!(s && typeof s === 'object' && typeof s.name === 'string' && s.name.trim());
    const entry = named ? `"${s.name.trim()}"` : `entry ${i + 1}`;
    const skip = (reason) => skipped.push({ entry, reason });
    if (!s || typeof s !== 'object' || Array.isArray(s)) return skip('not an object');
    if (!named) return skip('no name');
    const type = s.type === undefined || s.type === null || s.type === '' ? 'ssh' : s.type;
    if (!SESSION_TYPES.includes(type)) return skip(`unknown type ${JSON.stringify(s.type)}`);
    const out = { ...s, name: s.name.trim(), type, id: typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID(), folder: typeof s.folder === 'string' ? s.folder : '' };
    if (s.port === undefined || s.port === null || s.port === '') delete out.port;
    else {
      const port = typeof s.port === 'number' ? s.port : /^\s*\d+\s*$/.test(String(s.port)) ? parseInt(s.port, 10) : NaN;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return skip(`bad port ${JSON.stringify(s.port)}`);
      out.port = port;
    }
    sessions.push(out);
  });
  const folders = Array.isArray(data.folders) ? data.folders.filter((f) => typeof f === 'string' && f.trim()) : [];
  return { sessions, folders, skipped };
}

module.exports = { parseSshConfig, parseMobaXtermIni, parseMobaXtermIniDetailed, parseSessionsJson, SESSION_TYPES };
