'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSshConfig, parseMobaXtermIni, parseMobaXtermIniDetailed, parseSessionsJson } = require('../../src/main/importers');

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

test('parseMobaXtermIniDetailed: the bookmarks that were not usable come back with a reason', () => {
  const file = path.join(tmpdir(), 'MobaXterm.ini');
  fs.writeFileSync(file, INI + '\r\nno-host=#109#0%%22%%#MobaFont#0# #-1', 'utf8');
  const d = parseMobaXtermIniDetailed(file);
  assert.equal(d.sessions.length, 4);
  assert.deepEqual(d.skipped, [{ entry: '"unknown"', reason: 'unsupported session type #999' }, { entry: '"no-host"', reason: 'no host' }]);
});

test('parseSessionsJson: refuses what is not a sessions file', () => {
  assert.match(parseSessionsJson('this is not json').error, /^not JSON \(/);
  assert.equal(parseSessionsJson('[1, 2]').error, 'the top level is not an object');
  assert.equal(parseSessionsJson('null').error, 'the top level is not an object');
  assert.equal(parseSessionsJson('{"folders": []}').error, 'no "sessions" array');
});

test('parseSessionsJson: normalises the usable entries and skips the rest with a reason', () => {
  const r = parseSessionsJson(JSON.stringify({ folders: ['A', '', 3, 'B/C'], sessions: [
    { id: 'keep', name: ' web ', type: 'ssh', host: 'h', port: '2222', folder: 'A', hasPassword: true, password: 'hand' },
    { name: 'default-type', host: 'h', id: 7 },
    { name: 'bad-port', port: 70000 },
    { name: 'bad-port-2', port: '22x' },
    { name: 'bad-type', type: 'gopher' },
    { host: 'nameless' },
    { name: '   ' },
    'junk',
    null,
    { name: 'no-port', port: '', folder: 7, type: 'local' },
  ] }));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.folders, ['A', 'B/C']);
  assert.deepEqual(r.sessions.map((s) => s.name), ['web', 'default-type', 'no-port']);
  const [web, def, noPort] = r.sessions;
  assert.equal(web.id, 'keep');
  assert.equal(web.port, 2222);
  assert.equal(web.hasPassword, true, 'flags and secrets pass through; the store decides');
  assert.equal(web.password, 'hand');
  assert.equal(def.type, 'ssh');
  assert.match(def.id, /^[0-9a-f-]{36}$/, 'a non-string id is replaced');
  assert.equal(def.folder, '');
  assert.equal('port' in noPort, false);
  assert.equal(noPort.folder, '');
  assert.equal(noPort.type, 'local');
  assert.deepEqual(r.skipped, [
    { entry: '"bad-port"', reason: 'bad port 70000' },
    { entry: '"bad-port-2"', reason: 'bad port "22x"' },
    { entry: '"bad-type"', reason: 'unknown type "gopher"' },
    { entry: 'entry 6', reason: 'no name' },
    { entry: 'entry 7', reason: 'no name' },
    { entry: 'entry 8', reason: 'not an object' },
    { entry: 'entry 9', reason: 'not an object' },
  ]);
});
