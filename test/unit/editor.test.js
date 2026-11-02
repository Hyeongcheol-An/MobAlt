'use strict';
// The external editor for SFTP / FTP "Edit" (src/main/editor.js). Regression for the 1.0 security review
// (editorpoc.js): the remote file name went into `sh -c` inside JSON.stringify quotes, so `x$(cmd).txt` ran cmd.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const editor = require('../../src/main/editor');

test('splitCommand: quotes and backslashes group words, nothing is expanded', () => {
  assert.deepEqual(editor.splitCommand('code --wait'), ['code', '--wait']);
  assert.deepEqual(editor.splitCommand(`open -a "Sublime Text"`), ['open', '-a', 'Sublime Text']);
  assert.deepEqual(editor.splitCommand(`'/Applications/My Editor.app/x' -n`), ['/Applications/My Editor.app/x', '-n']);
  assert.deepEqual(editor.splitCommand('a\\ b "c\\"d" $(id) ;rm'), ['a b', 'c"d', '$(id)', ';rm']);
  assert.deepEqual(editor.splitCommand('  '), []);
  assert.deepEqual(editor.splitCommand('x ""'), ['x', '']);
  assert.throws(() => editor.splitCommand('open "unterminated'));
});

test('editorArgv: the path is one argument, appended or in place of {file}', () => {
  const f = '/tmp/mobalt-edit/c/abc/notes-$(echo INJECTED).txt';
  assert.deepEqual(editor.editorArgv('code --wait', f), ['code', '--wait', f]);
  assert.deepEqual(editor.editorArgv('code --wait {file}', f), ['code', '--wait', f]);
  assert.deepEqual(editor.editorArgv('mate --line=1 --file={file}', f), ['mate', '--line=1', '--file=' + f]);
  assert.deepEqual(editor.editorArgv('', f), ['open', '-t', f]);
  assert.equal(editor.editorArgv('~/bin/ed', f)[0], path.join(os.homedir(), 'bin/ed'));
});

test('a remote file name with shell syntax runs nothing (editorpoc.js)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-editor-'));
  const marker = path.join(dir, 'INJECTED');
  const local = path.join(dir, 'notes-$(touch INJECTED)-`touch INJECTED`;touch INJECTED;.txt'); // a remote name has no slash
  fs.writeFileSync(local, 'x');
  // the same argv openInEditor starts, run synchronously here with a harmless "editor"
  const argv = editor.editorArgv('/bin/cat', local);
  assert.equal(execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: dir }), 'x');
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('editTarget keeps the remote name a plain file name and removeEditDirs deletes only this instance\'s folders', () => {
  const a = editor.editTarget('conn-test', '/srv/../..');
  assert.equal(path.basename(a.local), 'file');
  assert.equal(path.dirname(a.local), a.dir);
  const b = editor.editTarget('conn-test', '/srv/report.txt');
  assert.equal(path.basename(b.local), 'report.txt');
  assert.equal(fs.statSync(b.dir).mode & 0o777, 0o700);
  fs.writeFileSync(b.local, 'secret');
  const other = path.join(path.dirname(path.dirname(b.dir)), 'someone-else');
  fs.mkdirSync(other, { recursive: true });
  editor.removeEditDirs();
  assert.equal(fs.existsSync(a.dir), false);
  assert.equal(fs.existsSync(b.dir), false);
  assert.equal(fs.existsSync(path.dirname(b.dir)), false, 'the empty connection folder goes too');
  assert.equal(fs.existsSync(other), true);
  fs.rmSync(other, { recursive: true, force: true });
});

test('resolveProgram: a bare name is found in the Homebrew folders, then through the login shell, and cached', () => {
  const calls = [];
  // Homebrew first
  assert.equal(editor.resolveProgram('ed-brew', { exists: (p) => p === '/opt/homebrew/bin/ed-brew', shell: (n) => { calls.push(n); return ''; } }), '/opt/homebrew/bin/ed-brew');
  assert.deepEqual(calls, []);
  // not there: the login shell's `command -v` (its last line: a profile may print first)
  const shellOut = 'welcome banner\n/Users/me/.local/bin/ed-shell\n';
  assert.equal(editor.resolveProgram('ed-shell', { exists: (p) => p === '/Users/me/.local/bin/ed-shell', shell: (n) => { calls.push(n); return shellOut; } }), '/Users/me/.local/bin/ed-shell');
  assert.deepEqual(calls, ['ed-shell']);
  // cached: the shell is not asked again
  assert.equal(editor.resolveProgram('ed-shell', { exists: () => false, shell: (n) => { calls.push(n); return ''; } }), '/Users/me/.local/bin/ed-shell');
  assert.deepEqual(calls, ['ed-shell']);
  // an alias / function (no path), a missing file or a failing shell: the name as is (spawn reports ENOENT)
  assert.equal(editor.resolveProgram('ed-alias', { exists: () => false, shell: () => 'ed-alias: aliased to vim' }), 'ed-alias');
  assert.equal(editor.resolveProgram('ed-throw', { exists: () => false, shell: () => { throw new Error('timeout'); } }), 'ed-throw');
  // a path is never looked up
  assert.equal(editor.resolveProgram('/usr/bin/vi', { exists: () => false, shell: () => { throw new Error('asked'); } }), '/usr/bin/vi');
});

test('openInEditor: a program that cannot start is reported with its error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-editor-'));
  const errors = [];
  const argv = editor.openInEditor(path.join(dir, 'no-such-editor'), path.join(dir, 'f.txt'), (e, program) => errors.push([e.code, program]));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(argv[0], path.join(dir, 'no-such-editor'));
  assert.deepEqual(errors, [['ENOENT', path.join(dir, 'no-such-editor')]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sweepStaleEdits removes only connection folders older than a day, inside its own root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-sweep-'));
  const now = Date.now();
  const mk = (name, ageH, { file = false } = {}) => {
    const p = path.join(root, name);
    if (file) fs.writeFileSync(p, 'x'); else fs.mkdirSync(path.join(p, 'abc123'), { recursive: true });
    const t = (now - ageH * 3600 * 1000) / 1000;
    fs.utimesSync(p, t, t);
    return p;
  };
  const oldSsh = mk('t_0a1b2c3d4e5f', 30);
  const oldFtp = mk('ftp_00ff00ff00ff', 48);
  const recent = mk('t_aaaaaaaaaaaa', 2);
  const other = mk('notes', 72);
  const odd = mk('t_xyz', 72);
  const file = mk('t_bbbbbbbbbbbb', 72, { file: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-sweep-outside-'));
  fs.symlinkSync(outside, path.join(root, 't_cccccccccccc'));
  const t = (now - 72 * 3600 * 1000) / 1000;
  fs.lutimesSync(path.join(root, 't_cccccccccccc'), t, t);
  const removed = editor.sweepStaleEdits({ root, now });
  assert.deepEqual(removed.sort(), ['ftp_00ff00ff00ff', 't_0a1b2c3d4e5f']);
  assert.equal(fs.existsSync(oldSsh), false);
  assert.equal(fs.existsSync(oldFtp), false);
  for (const kept of [recent, other, odd, file, outside]) assert.equal(fs.existsSync(kept), true, kept);
  assert.deepEqual(editor.sweepStaleEdits({ root: path.join(root, 'missing'), now }), []);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
