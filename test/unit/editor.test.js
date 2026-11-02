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
