'use strict';
// Session importers: ~/.ssh/config and MobaXterm.ini bookmarks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

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

/**
 * Decode a text file a Windows tool or a hand editor may have saved in any of the usual encodings: UTF-16 LE with
 * its BOM, UTF-8 with or without a BOM, UTF-16 LE without a BOM (every other byte NUL — judged in proportion to the
 * file, so a short file is recognised too), then EUC-KR and Latin-1 as fallbacks. Used for MobaXterm.ini and for
 * sessions JSON, which JSON.parse would otherwise refuse over an invisible BOM.
 */
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  let zeros = 0, sampled = 0;
  for (let i = 1; i < Math.min(buf.length, 4000); i += 2) {
    sampled++;
    if (buf[i] === 0) zeros++;
  }
  if (sampled >= 2 && zeros > sampled / 4) return buf.toString('utf16le');
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

// The first number of a bookmark value (#109#0%host%port%user…) tells the kind of session: these are imported …
const MOBA_TYPES = { 109: 'ssh', 143: 'ssh', 98: 'telnet', 91: 'rdp', 128: 'vnc', 100: 'local' };
// … and these are named in the skip reason instead of showing up as a bare number (best effort — the numbers are
// those MobaXterm.ini files are known to carry; anything else is reported by its number).
const MOBA_TYPE_NAMES = { 107: 'Serial', 130: 'FTP', 140: 'SFTP', 151: 'Mosh' };
const MOBA_DEFAULT_PORT = { ssh: 22, telnet: 23, rdp: 3389, vnc: 5900 };

/** Parse MobaXterm.ini bookmark sections. Best effort (format is undocumented). */
function parseMobaXtermIni(file) {
  return parseMobaXtermIniDetailed(file).sessions;
}

/**
 * parseMobaXtermIni plus the bookmarks it could not use, as { entry, reason }: { sessions, skipped }. Host, port and
 * user are trimmed; a port must be 1–65535 when given (else the bookmark is skipped, like the JSON importer does); a
 * Shell bookmark becomes a Local session (it has no host); a later bookmark with the same folder, name and host as
 * an earlier one in the file is skipped as its duplicate, so the first one is what gets imported.
 */
function parseMobaXtermIniDetailed(file) {
  const text = decodeText(fs.readFileSync(file));
  const sessions = [];
  const skipped = [];
  const seen = new Set(); // folder|name|host of what this file already gave — the same key the re-import matching uses
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
    const entry = `"${key}"`;
    const skip = (reason) => skipped.push({ entry, reason });
    const type = MOBA_TYPES[m[1]];
    if (!type) {
      skip(MOBA_TYPE_NAMES[m[1]] ? t('{kind} bookmark (#{num}) not supported', { kind: MOBA_TYPE_NAMES[m[1]], num: m[1] }) : t('unsupported session type #{num}', { num: m[1] }));
      continue;
    }
    const body = m[3].split('#')[0];
    const f = body.split('%').map((x) => x.trim());
    const s = { id: crypto.randomUUID(), name: key, folder: folder ? 'MobaXterm/' + folder : 'MobaXterm', type };
    if (type === 'local') {
      // a Shell bookmark: a terminal on this machine, no host to check or port to keep
      if (seen.has(`${s.folder}|${s.name}|`)) { skip(t('duplicate of an earlier bookmark')); continue; }
      seen.add(`${s.folder}|${s.name}|`);
      sessions.push(s);
      continue;
    }
    let port = MOBA_DEFAULT_PORT[type];
    if (f[1]) {
      port = /^\d+$/.test(f[1]) ? parseInt(f[1], 10) : NaN;
      if (!Number.isInteger(port) || port < 1 || port > 65535) { skip(t('bad port {port}', { port: f[1] })); continue; }
    }
    Object.assign(s, {
      host: f[0] || '',
      port,
      username: (f[2] || '').replace(/^<default>$/i, ''),
      authMethod: 'auto',
      privateKeyPath: '',
      x11: type === 'ssh' && f[4] === '-1',
      compression: type === 'ssh' && f[5] === '-1',
      sftpAuto: true,
    });
    const keyField = f.find((x) => /\.(ppk|pem|key)$|id_(rsa|ed25519|ecdsa)/i.test(x));
    if (keyField) {
      s.privateKeyPath = keyField.replace(/\\/g, '/');
      s.notes = t('Imported key path from Windows; convert .ppk with puttygen and fix the path.');
    }
    if (!s.host) { skip(t('no host')); continue; }
    const dupKey = `${s.folder}|${s.name}|${s.host}`;
    if (seen.has(dupKey)) { skip(t('duplicate of an earlier bookmark')); continue; }
    seen.add(dupKey);
    sessions.push(s);
  }
  return { sessions, skipped };
}

const SESSION_TYPES = ['ssh', 'mosh', 'local', 'telnet', 'serial', 'ftp', 'rdp', 'vnc'];

/**
 * Validate the text of a MobAlt sessions export, or a hand-written file of the same shape. Returns
 * { sessions, folders, skipped }: the usable sessions normalised (trimmed string name, a known type — trimmed and
 * lower-cased, 'ssh' when absent — an integer port when one is given, a string id — fresh when missing — and a
 * string folder) and the rejected entries as { entry, reason }; a second entry with an id the file already used
 * is rejected as a duplicate, so one file never overwrites its own rows. Or { error } when the file is not a
 * sessions file at all (not JSON, no top-level object, no "sessions" array). Secrets and the exporter's
 * hasPassword/… flags are passed through untouched: what to do with them is the store's business.
 */
function parseSessionsJson(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, '')); // a BOM that slipped past the decoder (text handed in directly)
  } catch (e) {
    return { error: t('not JSON ({error})', { error: e.message }) };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: t('the top level is not an object') };
  if (!Array.isArray(data.sessions)) return { error: t('no "sessions" array') };
  const sessions = [];
  const skipped = [];
  const seenIds = new Set();
  data.sessions.forEach((s, i) => {
    const named = !!(s && typeof s === 'object' && typeof s.name === 'string' && s.name.trim());
    const entry = named ? `"${s.name.trim()}"` : t('entry {n}', { n: i + 1 });
    const skip = (reason) => skipped.push({ entry, reason });
    if (!s || typeof s !== 'object' || Array.isArray(s)) return skip(t('not an object'));
    if (!named) return skip(t('no name'));
    const given = typeof s.type === 'string' ? s.type.trim().toLowerCase() : s.type; // "SSH", " ssh" → ssh
    const type = given === undefined || given === null || given === '' ? 'ssh' : given;
    if (!SESSION_TYPES.includes(type)) return skip(t('unknown type {type}', { type: JSON.stringify(s.type) }));
    const out = { ...s, name: s.name.trim(), type, id: typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID(), folder: typeof s.folder === 'string' ? s.folder : '' };
    if (s.port === undefined || s.port === null || s.port === '') delete out.port;
    else {
      const port = typeof s.port === 'number' ? s.port : /^\s*\d+\s*$/.test(String(s.port)) ? parseInt(s.port, 10) : NaN;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return skip(t('bad port {port}', { port: JSON.stringify(s.port) }));
      out.port = port;
    }
    if (seenIds.has(out.id)) return skip(t('duplicate id'));
    seenIds.add(out.id);
    sessions.push(out);
  });
  const folders = Array.isArray(data.folders) ? data.folders.filter((f) => typeof f === 'string' && f.trim()) : [];
  return { sessions, folders, skipped };
}

module.exports = { decodeText, parseSshConfig, parseMobaXtermIni, parseMobaXtermIniDetailed, parseSessionsJson, SESSION_TYPES };
