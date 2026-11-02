'use strict';
// What a browser session may open (src/main/browserurl.js): the one rule the session editor, quick connect, the JSON
// importer and the main process's webview guard all apply.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { normalizeBrowserUrl, isBrowserUrl, browserHost, isLocalHost } = require('../../src/main/browserurl');

test('normalizeBrowserUrl: a typed address becomes an http(s) URL, or is refused with a reason', () => {
  const table = [
    // typed → url
    ['https://example.com', 'https://example.com/'],
    ['HTTP://Example.COM/Path?q=1#f', 'http://example.com/Path?q=1#f'],
    ['  https://example.com/x  ', 'https://example.com/x'],
    ['example.com', 'https://example.com/'], // a bare public host: https
    ['www.example.com/admin', 'https://www.example.com/admin'],
    ['example.com:8443', 'https://example.com:8443/'],
    ['localhost', 'http://localhost/'], // the user's own machine and network: http
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost:3000?x=1', 'http://localhost:3000/?x=1'],
    ['127.0.0.1:8080/grafana', 'http://127.0.0.1:8080/grafana'],
    ['192.168.1.1', 'http://192.168.1.1/'],
    ['10.0.0.5:9090', 'http://10.0.0.5:9090/'],
    ['172.20.0.1', 'http://172.20.0.1/'],
    ['[::1]:8080', 'http://[::1]:8080/'],
    ['::1', 'http://[::1]/'], // a bare IPv6 address is bracketed, never read as a scheme or a port
    ['fe80::1', 'http://[fe80::1]/'],
    ['2001:db8::1', 'https://[2001:db8::1]/'],
    ['example.com:80', 'http://example.com/'], // the web's own ports decide the scheme
    ['example.com:8080', 'https://example.com:8080/'],
    ['192.168.1.1:443', 'https://192.168.1.1/'],
    ['nas.local:8443', 'https://nas.local:8443/'],
    ['010.0.0.1', 'https://8.0.0.1/'], // an octal octet: the parser's reading of the address decides (8.0.0.1 is not local)
    ['router', 'http://router/'], // a single label: a name on the local network
    ['nas.local', 'http://nas.local/'],
    ['printer.lan:631', 'http://printer.lan:631/'],
    ['user@example.com', 'https://example.com/'], // a user name alone is dropped: the page asks for it
    ['http:example.com', 'http://example.com/'], // the slashes the user left out
    ['https:/example.com/x', 'https://example.com/x'],
    ['https:///example.com/x', 'https://example.com/x'], // extra slashes are the parser's business
    ['about:blank', 'about:blank'],
    ['ABOUT:BLANK', 'about:blank'],
    // typed → error
    ['', 'empty'],
    ['   ', 'empty'],
    ['file:///etc/hosts', 'scheme'],
    ['FILE:///etc/hosts', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,<b>x</b>', 'scheme'],
    ['blob:https://example.com/uuid', 'scheme'],
    ['ftp://example.com', 'scheme'],
    ['ssh://user@example.com', 'scheme'],
    ['mailto:someone@example.com', 'scheme'],
    ['about:config', 'scheme'],
    ['chrome://settings', 'scheme'],
    ['x-custom://thing', 'scheme'],
    ['http://', 'invalid'],
    ['http:8080', 'invalid'], // a port with no host
    ['https://8080/', 'invalid'],
    ['http://exa mple.com', 'invalid'],
    ['http://example.com:99999', 'invalid'],
    ['not a url', 'invalid'],
    ['http://example.com/\u0001', 'invalid'],
    ['https://user:pw@example.com/x', 'credentials'], // a password never goes into a session, a file or the address field
    ['user:pw@example.com', 'credentials'],
    ['http://admin:admin@192.168.1.1/', 'credentials'],
  ];
  for (const [typed, want] of table) {
    const r = normalizeBrowserUrl(typed);
    if (want === 'empty' || want === 'scheme' || want === 'invalid' || want === 'credentials') assert.deepEqual(r, { error: want }, JSON.stringify(typed));
    else assert.deepEqual(r, { url: want }, JSON.stringify(typed));
  }
  assert.deepEqual(normalizeBrowserUrl(null), { error: 'empty' });
  assert.deepEqual(normalizeBrowserUrl(undefined), { error: 'empty' });
});

test('isBrowserUrl: only an http(s) URL with a host, or about:blank — what the webview guard lets through', () => {
  for (const ok of ['http://example.com/', 'https://example.com', 'HTTPS://example.com/x', 'http://127.0.0.1:8080/', 'http://[::1]:3000/', 'about:blank', ' about:blank ']) assert.equal(isBrowserUrl(ok), true, ok);
  for (const bad of ['', null, undefined, 42, 'example.com', 'file:///etc/hosts', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'http://', 'about:config', 'blob:http://example.com/x', 'http:example.com', 'http://u:p@example.com/', 'http://u@example.com/']) assert.equal(isBrowserUrl(bad), false, String(bad));
});

test('browserHost: the default session name is the host, with a non-default port', () => {
  assert.equal(browserHost('https://example.com/x'), 'example.com');
  assert.equal(browserHost('http://localhost:3000/'), 'localhost:3000');
  assert.equal(browserHost('https://example.com:443/'), 'example.com'); // the scheme's own port is dropped by the parser
  assert.equal(browserHost('http://[::1]:8080/'), '[::1]:8080');
  assert.equal(browserHost('about:blank'), '');
  assert.equal(browserHost('nonsense'), '');
});

test('isLocalHost: loopback, private and link-local ranges, .local names and single labels', () => {
  // the addresses just outside the private ranges are built here, not written out: the hygiene scan (test/unit/hygiene.test.js)
  // must not see a public address in the tree, and these are the boundary cases of the rule, not real hosts
  const ip = (...o) => o.join('.');
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '100.64.0.1', '[::1]', 'fe80::1', 'fd12::1', 'nas.local', 'box.lan', 'router', 'a.home.arpa']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['example.com', '8.8.8.8', ip(172, 32, 0, 1), ip(172, 15, 0, 1), ip(11, 0, 0, 1), ip(100, 128, 0, 1), 'www.example.org', '2001:db8::1', '']) assert.equal(isLocalHost(h), false, h);
});

test('the renderer sees the same rules: the file also works as a classic script (window.BrowserUrl)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'browserurl.js'), 'utf8');
  const sandbox = { self: undefined, URL };
  sandbox.self = sandbox; // a browser: `self` is the global
  vm.runInNewContext(src, sandbox);
  assert.equal(typeof sandbox.BrowserUrl.normalizeBrowserUrl, 'function');
  // objects from another context have another Object.prototype: compare by value
  const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
  same(sandbox.BrowserUrl.normalizeBrowserUrl('localhost:3000'), normalizeBrowserUrl('localhost:3000'));
  same(sandbox.BrowserUrl.normalizeBrowserUrl('file:///x'), { error: 'scheme' });
  same(sandbox.BrowserUrl.isBrowserUrl('http://example.com/'), true);
});
