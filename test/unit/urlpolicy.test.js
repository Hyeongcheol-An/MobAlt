'use strict';
// What a window may ask the Mac to open (src/main/urlpolicy.js) — the 1.0 security review, N1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../src/main/urlpolicy');

test('externalUrlAllowed: http(s) and mailto only', () => {
  for (const ok of ['https://example.com/', 'http://192.0.2.1:8080/x?y#z', 'mailto:someone@example.com', 'HTTPS://EXAMPLE.COM']) assert.equal(P.externalUrlAllowed(ok), true, ok);
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:com.apple.preference.security', 'vnc://host', 'ssh://host', 'smb://host/share', 'data:text/html,x', 'tel:123', 'https://', 'not a url', '', null, 42, 'http:' + 'x'.repeat(9000)]) assert.equal(P.externalUrlAllowed(bad), false, String(bad).slice(0, 40));
});

test('openPathAllowed: existing folders under home, tmp or the download folder only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-urlpolicy-'));
  const file = path.join(tmp, 'evil.command');
  fs.writeFileSync(file, '#!/bin/sh\n');
  assert.equal(P.openPathAllowed(tmp), true);
  assert.equal(P.openPathAllowed(os.homedir()), true);
  assert.equal(P.openPathAllowed(file), false, 'a file could run');
  assert.equal(P.openPathAllowed('/Applications'), false);
  assert.equal(P.openPathAllowed('/System/Applications/Utilities'), false);
  assert.equal(P.openPathAllowed('relative/dir'), false);
  assert.equal(P.openPathAllowed(path.join(tmp, 'missing')), false);
  // a symbolic link in tmp that points outside does not count as tmp
  const link = path.join(tmp, 'apps');
  fs.symlinkSync('/Applications', link);
  assert.equal(P.openPathAllowed(link), false);
  // the download folder of the settings counts even outside home (a volume)
  assert.equal(P.openPathAllowed('/Applications', { downloadDir: '/Applications' }), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('vncUrl: a host that would change the URL is refused', () => {
  assert.equal(P.vncUrl({ host: 'mac.example.com' }), 'vnc://mac.example.com:5900');
  assert.equal(P.vncUrl({ host: '192.0.2.5', port: 5901, username: 'a b@c' }), 'vnc://a%20b%40c@192.0.2.5:5901');
  assert.equal(P.vncUrl({ host: '[2001:db8::1]' }), 'vnc://[2001:db8::1]:5900');
  for (const host of ['evil.example.com/path', 'a@b', 'x?y', 'a b', '', '-oProxy', 'h#x']) assert.equal(P.vncUrl({ host }), null, host);
  assert.equal(P.vncUrl({ host: 'ok', port: 70000 }), null);
});

test('windowNavigationAllowed: the window stays on its own index.html', () => {
  const index = '/Applications/MobAlt.app/Contents/Resources/app.asar/src/renderer/index.html';
  assert.equal(P.windowNavigationAllowed('file://' + index, index), true);
  assert.equal(P.windowNavigationAllowed('file://' + index + '?detached=abc', index), true);
  assert.equal(P.windowNavigationAllowed('file:///Users/me/Downloads/dropped.html', index), false);
  assert.equal(P.windowNavigationAllowed('https://example.com/', index), false);
  assert.equal(P.windowNavigationAllowed('garbage', index), false);
});

test('rdpFile: an imported host or user name cannot add lines to the .rdp file', () => {
  const r = P.rdpFile({ name: 'win/../x', host: '192.0.2.7\r\ndrivestoredirect:s:*', username: 'bob\nalternate shell:s:cmd.exe', port: 3390 });
  const lines = r.text.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 9);
  assert.equal(lines[0], 'full address:s:192.0.2.7drivestoredirect:s:*:3390');
  assert.equal(lines[1], 'username:s:bobalternate shell:s:cmd.exe');
  assert.ok(!lines.some((l) => /^(drivestoredirect|alternate shell)/.test(l)));
  assert.match(r.name, /^[\w.-]+\.rdp$/);
  assert.equal(P.rdpFile({ host: 'h.example.com' }).text.split('\r\n')[0], 'full address:s:h.example.com');
});
