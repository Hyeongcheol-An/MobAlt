'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSshConfig, parseMobaXtermIni } = require('../../src/main/importers');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-test-'));
}

test('parseSshConfig: hosts, options, Include and wildcard skipping', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'conf.d'));
  fs.writeFileSync(path.join(dir, 'conf.d', 'extra.conf'), 'Host extra\n  HostName 10.0.0.9\n  User bob\n');
  const cfg = path.join(dir, 'config');
  fs.writeFileSync(cfg, [
    `Include ${path.join(dir, 'conf.d', '*.conf')}`,
    'Host *',
    '  ServerAliveInterval 30',
    'Host prod prod-alias',
    '  HostName prod.example.com',
    '  User deploy',
    '  Port 2200',
    '  IdentityFile ~/.ssh/prod_ed25519',
    '  ForwardX11 yes',
    '  ForwardAgent yes',
    '  ProxyJump bastion',
    '',
    'Host bastion',
    '  HostName bastion.example.com   # comment',
    'Match host foo',
    '  User ignored',
  ].join('\n'));
  const sessions = parseSshConfig(cfg);
  const names = sessions.map((s) => s.name);
  assert.deepEqual(names, ['extra', 'prod', 'prod-alias', 'bastion']);
  const prod = sessions.find((s) => s.name === 'prod');
  assert.equal(prod.host, 'prod.example.com');
  assert.equal(prod.port, 2200);
  assert.equal(prod.username, 'deploy');
  assert.equal(prod.privateKeyPath, '~/.ssh/prod_ed25519');
  assert.equal(prod.x11, true);
  assert.equal(prod.agentForward, true);
  assert.equal(prod.jumpHost, 'bastion');
  assert.equal(sessions.find((s) => s.name === 'bastion').host, 'bastion.example.com');
  assert.equal(sessions.find((s) => s.name === 'extra').username, 'bob');
  assert.ok(sessions.every((s) => s.type === 'ssh' && s.id));
});

test('parseSshConfig: missing file returns empty list', () => {
  assert.deepEqual(parseSshConfig(path.join(tmpdir(), 'nope')), []);
});

const INI = [
  '[Bookmarks]',
  'SubRep=',
  'ImgNum=42',
  'web01=#109#0%web01.example.com%22%admin%%-1%-1%%%%%0%0%0%%%-1%0%0%0%%1080%%0%0%1#MobaFont%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%-1%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%1%-1#0# #-1',
  '[Bookmarks_1]',
  'SubRep=Prod\\DB',
  'ImgNum=41',
  'db-main=#109#0%10.1.2.3%2222%dbuser%%0%0%%%%C:\\keys\\db.ppk%0%0%0%%%-1%0%0%0%%1080%%0%0%1#MobaFont%10#0# #-1',
  'old-switch=#98#1%192.168.0.1%23%%%%#MobaFont#0# #-1',
  'winbox=#91#4%10.1.2.4%3389%administrator%%#MobaFont#0# #-1',
  'unknown=#999#0%x%1#0# #-1',
].join('\r\n');

test('parseMobaXtermIni: utf-8 bookmarks with folders and types', () => {
  const file = path.join(tmpdir(), 'MobaXterm.ini');
  fs.writeFileSync(file, INI, 'utf8');
  const s = parseMobaXtermIni(file);
  assert.equal(s.length, 4);
  const web = s.find((x) => x.name === 'web01');
  assert.equal(web.type, 'ssh');
  assert.equal(web.host, 'web01.example.com');
  assert.equal(web.port, 22);
  assert.equal(web.username, 'admin');
  assert.equal(web.x11, true);
  assert.equal(web.folder, 'MobaXterm');
  const db = s.find((x) => x.name === 'db-main');
  assert.equal(db.folder, 'MobaXterm/Prod/DB');
  assert.equal(db.port, 2222);
  assert.equal(db.privateKeyPath, 'C:/keys/db.ppk');
  assert.equal(db.x11, false);
  assert.equal(s.find((x) => x.name === 'old-switch').type, 'telnet');
  assert.equal(s.find((x) => x.name === 'winbox').type, 'rdp');
  assert.equal(s.find((x) => x.name === 'winbox').port, 3389);
});

test('parseMobaXtermIni: utf-16le file with BOM', () => {
  const file = path.join(tmpdir(), 'MobaXterm16.ini');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(INI, 'utf16le')]));
  const s = parseMobaXtermIni(file);
  assert.equal(s.length, 4);
  assert.equal(s[0].name, 'web01');
});
