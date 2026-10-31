'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-live-'));
const { TerminalRegistry } = require('../../src/main/terminals');
const { liveConnections, quitQuestion } = require('../../src/main/live');

const handle = (kind) => ({ kind, write() {}, resize() {}, kill() {} });

test('liveConnections counts SSH shells, Mosh clients, SFTP companions and FTP control connections (not local shells)', () => {
  const reg = new TerminalRegistry();
  const ftp = { conns: new Map() };
  assert.deepEqual(liveConnections(reg, ftp), { ssh: 0, mosh: 0, sftp: 0, ftp: 0, total: 0 });
  reg.register('l1', handle('local'));
  reg.register('t1', handle('telnet'));
  assert.equal(liveConnections(reg, ftp).total, 0, 'local and telnet terminals do not block a quit');
  reg.register('s1', handle('ssh'));
  reg.register('s2', handle('ssh'));
  reg.register('m1', handle('mosh'));
  reg.register('c1', handle('sftp'));
  ftp.conns.set('ftp_1', {});
  assert.deepEqual(liveConnections(reg, ftp), { ssh: 2, mosh: 1, sftp: 1, ftp: 1, total: 5 });
  reg.exit('s1', 0, 'closed');
  ftp.conns.delete('ftp_1');
  assert.deepEqual(liveConnections(reg, ftp), { ssh: 1, mosh: 1, sftp: 1, ftp: 0, total: 3 });
  assert.equal(liveConnections(reg, null).ftp, 0);
});

test('quitQuestion names the kinds that are open', () => {
  assert.equal(quitQuestion({ ssh: 1, mosh: 0, sftp: 0, ftp: 0, total: 1 }), '1 connection is still open (1 SSH). Quit anyway?');
  assert.equal(quitQuestion({ ssh: 1, mosh: 1, sftp: 1, ftp: 2, total: 5 }), '5 connections are still open (1 SSH, 1 Mosh, 1 SFTP, 2 FTP). Quit anyway?');
});

test('quitQuestion ends with the verb the user chose: Quit by default, Relaunch for the update banner', () => {
  const live = { ssh: 2, mosh: 0, sftp: 0, ftp: 0, total: 2 };
  assert.equal(quitQuestion(live, 'Relaunch'), '2 connections are still open (2 SSH). Relaunch anyway?');
  assert.equal(quitQuestion(live), quitQuestion(live, 'Quit'));
});
