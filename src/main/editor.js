'use strict';
// Opening a downloaded copy of a remote file in the local editor (SFTP / FTP "Edit"), shared by sftp.js and ftp.js.
// The file name comes from the server, so it is never put into a shell command: Settings → Editor command is split
// into a program and its arguments here (quotes and backslashes as in a shell, nothing else — no $(…), no ;, no
// globbing) and started with execFile semantics, the local path one argument of its own. An earlier version ran
// `sh -c "<command> \"<path>\""`, and a remote file called `x$(cmd).txt` ran cmd on the Mac.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/**
 * Split a command line into words like a POSIX shell's quoting would: 'single' and "double" quotes group, a backslash
 * escapes the next character (outside single quotes), whitespace separates. Nothing is expanded. Throws on an
 * unterminated quote.
 */
function splitCommand(line) {
  const words = [];
  let cur = '', inWord = false, quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null; else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c; inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i]; inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(cur);
      cur = ''; inWord = false;
    } else {
      cur += c; inWord = true;
    }
  }
  if (quote) throw new Error('unterminated quote');
  if (inWord) words.push(cur);
  return words;
}

/**
 * The argv for the editor setting and a local file: `{file}` inside any word becomes the path (in place, still one
 * word), else the path is appended as the last argument. A leading `~/` in the program is the home folder. Blank →
 * TextEdit through `open -t`.
 */
function editorArgv(command, file) {
  const words = splitCommand(String(command || '').trim());
  if (!words.length) return ['open', '-t', file];
  if (words[0].startsWith('~/')) words[0] = path.join(os.homedir(), words[0].slice(2));
  let used = false;
  const argv = words.map((w) => (w.includes('{file}') ? ((used = true), w.split('{file}').join(file)) : w));
  if (!used) argv.push(file);
  return argv;
}

// An app started from the Finder / Dock gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `code` or `subl`
// from Homebrew are not found by name. A bare program name is looked up like findMosh (terminals.js) does: the usual
// Homebrew / MacPorts folders, then the login shell's `command -v` (the user's PATH). Cached per name for the run.
const PROGRAM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
const resolved = new Map();

function loginShellLookup(name) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // the name is a positional argument, never part of the script
  return require('child_process').execFileSync('/bin/zsh', ['-lc', 'command -v -- "$1"', 'zsh', name], { encoding: 'utf8', timeout: 5000, env }).trim();
}

/**
 * The program to start for a setting's first word: a path (anything with a '/') as is; a bare name from the usual
 * folders or the login shell, else the name unchanged (spawn then searches PATH and reports ENOENT).
 * `deps` (tests): { exists(path), shell(name) → output of `command -v` }.
 */
function resolveProgram(name, deps = {}) {
  if (!name || name.includes('/')) return name;
  if (resolved.has(name)) return resolved.get(name);
  const exists = deps.exists || ((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  const shell = deps.shell || loginShellLookup;
  let found = PROGRAM_DIRS.map((d) => path.join(d, name)).find(exists) || null;
  if (!found) {
    try {
      const out = String(shell(name) || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
      if (path.isAbsolute(out) && exists(out)) found = out; // an alias or a function prints no path: not used
    } catch {}
  }
  const result = found || name;
  resolved.set(name, result);
  return result;
}

/**
 * Start the editor on `file`, detached. `onError(error, program)` hears a program that could not be started (not
 * installed, not executable) — the caller shows it; nothing else is reported (the editor's own exit status is its
 * business).
 */
function openInEditor(command, file, onError) {
  let argv;
  try {
    argv = editorArgv(command, file);
  } catch {
    argv = ['open', '-t', file]; // an unusable setting (an open quote): TextEdit rather than nothing
  }
  argv[0] = resolveProgram(argv[0]);
  const report = (e) => { try { onError && onError(e, argv[0]); } catch {} };
  let child;
  try {
    child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
  } catch (e) {
    report(e);
    return argv;
  }
  child.on('error', report);
  child.unref();
  return argv;
}

// The folders this instance downloaded edited files into ($TMPDIR/mobalt-edit/<connection>/<random>/): removed when
// the app quits (stopEdits with no connection), so copies of remote files do not outlive the session. Only this
// instance's own folders — another MobAlt running at the same time keeps its edits.
const editDirs = new Set();

/** A fresh folder for one edited file, and the local path for the remote name in it (never `.`, `..` or empty). */
function editTarget(connId, remoteName) {
  const dir = path.join(os.tmpdir(), 'mobalt-edit', String(connId), crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  editDirs.add(dir);
  const base = path.posix.basename(String(remoteName || '')).replace(/\//g, '');
  const safe = !base || base === '.' || base === '..' ? 'file' : base;
  return { dir, local: path.join(dir, safe) };
}

/** Delete every edit folder this instance made (and its connection folder when that is left empty). */
function removeEditDirs() {
  for (const dir of editDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    try { fs.rmdirSync(path.dirname(dir)); } catch {} // only when empty
    editDirs.delete(dir);
  }
}

// A run that was killed (or crashed) never reached stopEdits(): at start-up the connection folders under
// $TMPDIR/mobalt-edit older than a day are removed. Only directories named like a connection id (t_… for SSH, ftp_…
// for FTP) directly inside that app-owned folder; anything else there is left alone, and so are recent folders,
// which may belong to another MobAlt running now.
const STALE_MS = 24 * 3600 * 1000;
const CONN_DIR = /^(t|ftp)_[0-9a-f]+$/;

function sweepStaleEdits({ root = path.join(os.tmpdir(), 'mobalt-edit'), now = Date.now(), maxAge = STALE_MS } = {}) {
  const removed = [];
  let names;
  try { names = fs.readdirSync(root); } catch { return removed; }
  for (const name of names) {
    if (!CONN_DIR.test(name)) continue;
    const p = path.join(root, name);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isDirectory() || now - st.mtimeMs < maxAge) continue; // never follows a symlink, never a file
    try { fs.rmSync(p, { recursive: true, force: true }); removed.push(name); } catch {}
  }
  return removed;
}

module.exports = { splitCommand, editorArgv, resolveProgram, openInEditor, editTarget, removeEditDirs, sweepStaleEdits };
