#!/usr/bin/env node
'use strict';
// A small web site for the browser-session end-to-end checks (test/e2e-browser.js, test/e2e-browser-security.js),
// plain Node, no dependencies:
//   node test/httpsrv.js --port 42510 [--log FILE]
//   /             "Page A": a link to /b, a link to /missing, a target=_blank link, window.open(file:) and
//                 window.open(javascript:) buttons, a favicon
//   /b            "Page B": a link back to /, a text field, a paragraph to find
//   /slow         "Slow page": answers after 2.5 s (the Stop button, the loading state)
//   /notitle      a page with no <title> (the pane falls back to the session's name)
//   /auth         HTTP Basic (realm "test site", demo / demo): 401 with a body until signed in; /auth-other: realm
//                 "other", other / other (a cached demo / demo is refused, so the prompt comes again)
//   /cross        a page whose favicon lives on another origin (its icon is on 127.0.0.1; the test opens the page as
//                 http://localhost:<port>/cross): the pane must never ask for it
//   /probe-icon   a PNG, no-store; every request is logged with its cookie and user agent (what a favicon fetch sends)
//   /setcookie    sets cookies for the site (the favicon fetch must not carry them)
//   /bigicon      an image/png that streams up to 40 MB (?mb=N); logs how much the client took before closing
//   /bigicon-page a page whose favicon is /bigicon
//   /attachment   Content-Disposition: attachment (a download); /evil has a link with `download` to it
//   /trap         a page whose beforeunload tries to hold the pane
//   /keys         a page that swallows every keydown and records the keys it saw (window.__keys)
//   /redir-user   302 to http://someone@<this host>/b (a redirect carrying a user name: followed, the name dropped)
//   /redir-loop   302 to http://someone@<this host>/redir-loop, for ever (Chromium's redirect limit must end it)
//   /selfloop     a page whose script sends it to http://u@<this host>/selfloop every 100 ms, for ever (the app must
//                 shut it after a bounded number of reloads, not just slow it down)
//   /slowloop     the same every 700 ms: slower than the burst cap, caught by the minute-long one
//   /count?path=P how many requests this server has had for path P so far (text/plain)
//   /icon.png     a 16 × 16 PNG favicon
//   /router       "Router admin — demo": a made-up status page (documentation addresses only) for the user guide's
//                 browser picture (test/qa/docs-shots.js)
//   anything else: 404 "Not found"
// --log FILE appends one line per request (method, path, cookie, user agent), so a test inside the app can count
// requests and read what they carried.
const http = require('http');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const port = parseInt(opt('port', '42510'), 10);
const logFile = opt('log', '');
const stamp = () => new Date().toISOString().slice(11, 23);
function log(...a) {
  const line = `${stamp()} ${a.join(' ')}`;
  process.stderr.write(line + '\n');
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch {} }
}

// a 16 × 16 solid teal PNG (the favicon the pane shows)
const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOQX7CCJMQwqmFUw/DVAABSO2cQgRM29wAAAABJRU5ErkJggg==', 'base64');

const page = (title, body, head = '<link rel="icon" href="/icon.png">') => `<!doctype html><html><head><meta charset="utf-8">${title === null ? '' : `<title>${title}</title>`}${head}
<style>body{font:14px -apple-system,Helvetica,sans-serif;margin:24px;color:#123} h1{font-size:20px} a{color:#06c}</style></head>
<body>${title === null ? '' : `<h1>${title}</h1>`}${body}</body></html>`;

const routes = {
  '/': () => page('Page A', `<p id="a">This is page A on the test site.</p>
<p><a id="to-b" href="/b">Go to page B</a> · <a id="to-missing" href="/missing">A missing page</a> · <a id="blank" href="/b" target="_blank">Page B in a new window</a></p>
<p><button id="popup-file" onclick="window.open('file:///etc/hosts')">window.open(file:)</button>
<button id="popup-js" onclick="window.open('javascript:document.title=%22pwned%22')">window.open(javascript:)</button></p>`),
  '/b': () => page('Page B', `<p id="b">This is page B. The word needle appears here: needle.</p>
<p><a id="to-a" href="/">Back to page A</a></p><p><input id="field" placeholder="type here"></p>`),
  '/slow': () => page('Slow page', '<p>This page took its time.</p>'),
  '/notitle': () => page(null, '<p id="nt">A page without a title.</p>'),
  '/cross': () => page('Cross page', '<p>This page declares a favicon on another origin (the test opens it as localhost; the icon is on 127.0.0.1).</p>', `<link rel="icon" href="http://127.0.0.1:${port}/probe-icon?via=favicon">`),
  '/bigicon-page': () => page('Big icon page', '<p>This page declares a 40 MB favicon.</p>', '<link rel="icon" href="/bigicon?mb=40&via=page">'),
  '/evil': () => page('Evil page', `<p id="e">A page with a download link.</p><p><a id="dl" href="/attachment" download="payload.bin">download</a></p>`),
  '/trap': () => page('Trap page', `<p id="t">This page tries to hold you.</p><script>window.onbeforeunload = () => 'stay';</script>`),
  '/router': () => `<!doctype html><html><head><meta charset="utf-8"><title>Router admin — demo</title><link rel="icon" href="/icon.png">
<style>body{font:15px -apple-system,Helvetica,sans-serif;margin:0;background:#f4f6f8;color:#222}header{background:#1f6feb;color:#fff;padding:14px 20px;font-weight:600}main{padding:20px}table{border-collapse:collapse;background:#fff}td,th{border:1px solid #ddd;padding:6px 12px;text-align:left}</style></head>
<body><header>Demo router · 192.0.2.1</header><main><h2>Status</h2><table><tr><th>WAN</th><td>up · 203.0.113.9</td></tr><tr><th>LAN</th><td>192.0.2.0/24 · 14 clients</td></tr><tr><th>Wi-Fi</th><td>2.4 GHz · 5 GHz</td></tr><tr><th>Uptime</th><td>41 days</td></tr></table></main></body></html>`,
  '/selfloop': () => page('Self loop', `<p id="sl">This page keeps sending itself to a user@ address.</p>
<script>setInterval(() => { location = 'http://u@127.0.0.1:${port}/selfloop'; }, 100);</script>`),
  '/slowloop': () => page('Slow loop', `<p id="sl">This page sends itself to a user@ address every 700 ms.</p>
<script>setTimeout(() => { location = 'http://u@127.0.0.1:${port}/slowloop'; }, 700);</script>`),
  '/keys': () => page('Keys page', `<p id="k">This page swallows every key.</p><input id="kf" placeholder="focus me">
<script>window.__keys = []; window.addEventListener('keydown', (e) => { window.__keys.push((e.metaKey ? 'M' : '') + (e.ctrlKey ? 'C' : '') + (e.shiftKey ? 'S' : '') + e.key); e.preventDefault(); }, true);</script>`),
};

const authPage = (res, realm, ok) => {
  if (!ok) { res.writeHead(401, { 'www-authenticate': `Basic realm="${realm}"`, 'content-type': 'text/html; charset=utf-8' }); return res.end(page('Unauthorized', '<p id="u">401 body: not signed in.</p>')); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page('Authorized', `<p id="ok">Signed in to ${realm}.</p>`));
};

let n = 0;
const hits = new Map(); // path → requests so far (/count)
const srv = http.createServer((req, res) => {
  const id = ++n;
  const path = (req.url || '/').split('?')[0];
  hits.set(path, (hits.get(path) || 0) + 1);
  log(`#${id} ${req.method} ${req.url} cookie=${JSON.stringify(req.headers.cookie || '-')} ua=${JSON.stringify(req.headers['user-agent'] || '')}`);
  if (path === '/icon.png') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': ICON.length }); return res.end(ICON); }
  if (path === '/probe-icon') { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(ICON); }
  if (path === '/setcookie') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': ['probe=set; Path=/', 'lax=yes; Path=/; SameSite=Lax'] });
    return res.end(page('Set cookie', '<p id="sc">Cookies set.</p>'));
  }
  if (path === '/bigicon') {
    // image/png that streams up to 40 MB as fast as it can; logs how much the client took before closing
    res.writeHead(200, { 'content-type': 'image/png' });
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const mb = Math.max(1, Math.min(40, parseInt((/[?&]mb=(\d+)/.exec(req.url || '') || [])[1] || '40', 10)));
    let sent = 0, closed = false;
    res.on('close', () => { closed = true; log(`bigicon closed after ${sent} bytes`); });
    const pump = () => {
      while (sent < mb * 1024 * 1024 && !closed) {
        sent += chunk.length;
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
      if (!closed) { res.end(); log(`bigicon fully sent ${sent} bytes`); }
    };
    pump();
    return;
  }
  if (path === '/attachment') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="payload.bin"', 'content-length': 16 }); return res.end(Buffer.alloc(16, 1)); }
  if (path === '/auth' || path === '/auth-other') {
    const realm = path === '/auth' ? 'test site' : 'other';
    const cred = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    return authPage(res, realm, cred === (path === '/auth' ? 'demo:demo' : 'other:other'));
  }
  if (path === '/count') {
    const which = new URL(req.url, 'http://x').searchParams.get('path') || '';
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    return res.end(String(hits.get(which) || 0));
  }
  if (path === '/redir-user') { res.writeHead(302, { location: `http://someone@127.0.0.1:${port}/b` }); return res.end(); }
  if (path === '/redir-loop') { res.writeHead(302, { location: `http://someone@127.0.0.1:${port}/redir-loop` }); return res.end(); }
  const route = routes[path];
  if (!route) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page('Not found', `<p>No page at ${path.replace(/[<>&]/g, '')}.</p>`)); }
  const send = () => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(route()); };
  if (path === '/slow') setTimeout(send, 2500);
  else send();
});
srv.listen(port, '127.0.0.1', () => log(`listening on 127.0.0.1:${port}`));
process.on('SIGTERM', () => { srv.close(); process.exit(0); });
process.on('SIGINT', () => { srv.close(); process.exit(0); });
