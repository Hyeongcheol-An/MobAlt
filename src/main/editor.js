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

/** Start the editor on `file`, detached; a program that cannot be started is ignored like before (no crash). */
function openInEditor(command, file) {
  let argv;
  try {
    argv = editorArgv(command, file);
  } catch {
    argv = ['open', '-t', file]; // an unusable setting (an open quote): TextEdit rather than nothing
  }
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
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

module.exports = { splitCommand, editorArgv, openInEditor, editTarget, removeEditDirs };
