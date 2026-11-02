#!/usr/bin/env node
'use strict';
// A small web site for the browser-session end-to-end check (test/e2e-browser.js), plain Node, no dependencies:
//   node test/httpsrv.js --port 42510 [--log FILE]
//   /            "Page A": a link to /b, a link to /missing, a target=_blank link, a window.open(file:) button, a favicon
//   /b           "Page B": a link back to /, a text field, a paragraph to find
//   /slow        "Slow page": answers after 2.5 s (the Stop button, the loading state)
//   /icon.png    a 16 × 16 PNG favicon
//   anything else: 404 "Not found"
// --log FILE appends one line per request (method, path), so a test inside the app can count reloads.
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

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/icon.png">
<style>body{font:14px -apple-system,Helvetica,sans-serif;margin:24px;color:#123} h1{font-size:20px} a{color:#06c}</style></head>
<body><h1>${title}</h1>${body}</body></html>`;

const routes = {
  '/': () => page('Page A', `<p id="a">This is page A on the test site.</p>
<p><a id="to-b" href="/b">Go to page B</a> · <a id="to-missing" href="/missing">A missing page</a> · <a id="blank" href="/b" target="_blank">Page B in a new window</a></p>
<p><button id="popup-file" onclick="window.open('file:///etc/hosts')">window.open(file:)</button>
<button id="popup-js" onclick="window.open('javascript:document.title=%22pwned%22')">window.open(javascript:)</button></p>`),
  '/b': () => page('Page B', `<p id="b">This is page B. The word needle appears here: needle.</p>
<p><a id="to-a" href="/">Back to page A</a></p><p><input id="field" placeholder="type here"></p>`),
  '/slow': () => page('Slow page', '<p>This page took its time.</p>'),
};

let n = 0;
const srv = http.createServer((req, res) => {
  const id = ++n;
  const path = (req.url || '/').split('?')[0];
  log(`#${id} ${req.method} ${path}`);
  if (path === '/icon.png') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': ICON.length }); return res.end(ICON); }
  const route = routes[path];
  if (!route) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page('Not found', `<p>No page at ${path.replace(/[<>&]/g, '')}.</p>`)); }
  const send = () => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(route()); };
  if (path === '/slow') setTimeout(send, 2500);
  else send();
});
srv.listen(port, '127.0.0.1', () => log(`listening on 127.0.0.1:${port}`));
process.on('SIGTERM', () => { srv.close(); process.exit(0); });
process.on('SIGINT', () => { srv.close(); process.exit(0); });
