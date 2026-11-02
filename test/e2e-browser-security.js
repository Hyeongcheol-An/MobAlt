// Browser sessions, the hostile-page side (src/main/main.js hardenWebviews, src/renderer/browser.js), against the
// test site (test/httpsrv.js on 127.0.0.1:42510): a favicon on another origin is never asked for; the favicon fetch
// carries no cookie and the pane's own user agent, is refused for a guest that is not the window's, and gives up on a
// 40 MB icon long before reading it; a download (a link with `download`, an attachment) lands in the run's Downloads
// folder with a toast and no sheet; a page's beforeunload never holds the pane; window.close() ends in the error view
// and Retry brings the page back; HTTP Basic authentication is asked through the app's own prompt (Cancel shows the
// 401 page, demo / demo signs in, a prompt still up when the pane closes is withdrawn); a page that swallows every
// keydown does not take ⌘L from the app; an address with a password is refused everywhere.
//   test/e2e-browser.sh <out-dir>                               (all phases, the site started for them)
//   test/qa/run.sh test/e2e-browser-security.js <out-dir> 180000 (alone: node test/httpsrv.js --port 42510 --log <out-dir>/httpsrv.log)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => { await sleep(150); return window.api.app.screenshot(n); };
  const log = (...a) => console.log('[e2e-browser-security]', ...a);
  const app = window.app;
  const results = {};
  const SITE = 'http://127.0.0.1:42510/';
  const OTHER = 'http://localhost:42510/'; // the same server under another origin
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const toasts = () => document.getElementById('toast-root').textContent;
  const modal = () => document.querySelector('.modal');
  const loaded = (p, suffix) => waitFor(() => p.status === 'connected' && !p.loading && (suffix === undefined || p.url.endsWith(suffix)), 10000, 'loaded ' + (suffix || ''));
  const inGuest = (p, code, gesture = true) => p.webview.executeJavaScript(code, gesture);
  const guestId = (p) => p.webview.getWebContentsId();
  // the site's request log: the wrapper starts the server with --log <out-dir>/httpsrv.log, next to this run's user data
  const logFile = app.info.userData.replace(/\/userdata$/, '') + '/httpsrv.log';
  const serverLog = async () => { try { return await window.api.app.testFs('readText', logFile); } catch { return ''; } };
  const requests = async (re) => (await serverLog()).split('\n').filter((l) => re.test(l));
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    results.serverLog = (await serverLog()).includes('listening');
    const saved = await app.saveSession({ name: 'Local web', type: 'browser', url: SITE });
    const p = await app.openSession(saved);
    await loaded(p, '/');
    await waitFor(() => !!p.favicon, 5000, 'favicon');

    // ---------- the favicon fetch: same origin only, no cookies, the pane's user agent, this window's guest only ----------
    p.navigate(SITE + 'setcookie');
    await loaded(p, '/setcookie');
    results.cookieSet = (await inGuest(p, 'document.cookie', false)).includes('probe=set');
    p.navigate(OTHER + 'cross');
    await loaded(p, '/cross');
    await sleep(1500);
    results.crossOriginIconNeverAsked = (await requests(/probe-icon\?via=favicon/)).length === 0 && p.favicon === null;
    p.navigate(SITE);
    await loaded(p, '/');
    const stamp = Date.now();
    const direct = await window.api.browser.favicon(guestId(p), SITE + 'probe-icon?direct=' + stamp);
    await sleep(300);
    const line = (await requests(new RegExp('probe-icon\\?direct=' + stamp))).pop() || '';
    const ua = (/ua="([^"]*)"/.exec(line) || [])[1] || '';
    results.faviconNoCookie = /^data:image\/png;base64,/.test(String(direct)) && /cookie="-"/.test(line);
    results.faviconPaneUserAgent = ua.length > 0 && !/Electron|MobAlt/.test(ua) && ua === p.webview.getAttribute('useragent');
    results.faviconWrongGuestRefused = (await window.api.browser.favicon(999999, SITE + 'probe-icon?wrong=' + stamp)) === null && (await requests(/probe-icon\?wrong=/)).length === 0;
    results.faviconOtherSchemeRefused = (await window.api.browser.favicon(guestId(p), 'file:///etc/hosts')) === null;
    // a 40 MB "icon": given up on long before it is read (the server sees the socket close early), well under the 4 s timeout
    const t0 = Date.now();
    const big = await window.api.browser.favicon(guestId(p), SITE + 'bigicon?mb=40&t=' + stamp);
    const bigMs = Date.now() - t0;
    await sleep(800);
    const closed = (await requests(/bigicon closed after/)).pop() || '';
    const bytes = Number((/after (\d+) bytes/.exec(closed) || [])[1] || 0);
    results.bigIconCapped = big === null && bigMs < 3500 && bytes > 0 && bytes < 16 * 1024 * 1024;
    log('big icon', bigMs + ' ms', bytes + ' bytes seen by the server');
    p.navigate(SITE + 'bigicon-page');
    await loaded(p, '/bigicon-page');
    await sleep(1500);
    results.bigIconPageNoIcon = p.favicon === null && p.status === 'connected';

    // ---------- downloads: into the run's Downloads folder, a toast, no sheet, the page stays ----------
    p.navigate(SITE + 'evil');
    await loaded(p, '/evil');
    const dlDir = app.info.userData + '/Downloads';
    await inGuest(p, "document.getElementById('dl').click()");
    await waitFor(() => /saved to Downloads/.test(toasts()), 8000, 'download toast');
    results.downloadLinkSaved = (await window.api.app.testFs('exists', dlDir + '/payload.bin')) && /Downloading payload\.bin to Downloads/.test(toasts()) && p.url === SITE + 'evil' && p.status === 'connected' && !modal();
    await inGuest(p, "location = '/attachment'", false);
    await waitFor(() => /payload \(2\)\.bin saved to Downloads/.test(toasts()), 8000, 'second download toast');
    await sleep(300);
    results.attachmentSavedUniquely = (await window.api.app.testFs('exists', dlDir + '/payload (2).bin')) && p.status === 'connected' && p.url === SITE + 'evil' && !modal();
    await shot('s1-download-toast');

    // ---------- a page's beforeunload never holds the pane ----------
    p.navigate(SITE + 'trap');
    await loaded(p, '/trap');
    p.navigate(SITE + 'b');
    await loaded(p, '/b');
    results.beforeunloadBypassed = p.url === SITE + 'b' && p.title === 'Page B' && p.errorEl.hidden;

    // ---------- window.close(): the error view, then Retry makes a new guest ----------
    await inGuest(p, 'window.close()', false);
    await waitFor(() => p.status === 'failed', 5000, 'closed → failed');
    await sleep(200);
    results.windowCloseErrorView = !p.errorEl.hidden && /closed/.test(p.errorEl.textContent) && p.webview.classList.contains('off') && !p.ready;
    await shot('s2-window-close');
    const oldWebview = p.webview;
    p.retryBtn.click();
    await loaded(p, '/b');
    await waitFor(() => p.title === 'Page B', 5000, 'title after retry');
    results.windowCloseRetry = p.webview !== oldWebview && !oldWebview.isConnected && p.errorEl.hidden && (await inGuest(p, 'document.title', false)) === 'Page B' && p.canBack === false;

    // ---------- HTTP Basic authentication through the app's own prompt ----------
    p.navigate(SITE + 'auth');
    await waitFor(() => !!modal() && /Sign in to 127\.0\.0\.1:42510/.test(modal().getAttribute('aria-label') || ''), 8000, 'auth prompt');
    const m1 = modal();
    results.authPrompt = /test site/.test(m1.textContent) && !!m1.querySelector('input[type=password]') && document.activeElement === m1.querySelector('input[type=text]');
    await shot('s3-auth-prompt');
    [...m1.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Cancel').click();
    await loaded(p, '/auth');
    await sleep(300);
    results.authCancelShows401 = !modal() && (await inGuest(p, 'document.body.textContent', false)).includes('401 body') && p.status === 'connected';
    p.navigate(SITE + 'auth');
    await waitFor(() => !!modal(), 8000, 'auth prompt again');
    const m2 = modal();
    m2.querySelector('input[type=text]').value = 'demo';
    m2.querySelector('input[type=password]').value = 'demo';
    [...m2.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Sign in').click();
    await loaded(p, '/auth');
    await waitFor(() => p.title === 'Authorized', 5000, 'signed in');
    results.authSignIn = !modal() && (await inGuest(p, 'document.body.textContent', false)).includes('Signed in to test site');
    results.authNotStored = !JSON.stringify(await window.api.sessions.list()).includes('demo:demo');
    // a prompt still up when its pane closes is withdrawn (another realm, so Chromium asks again)
    const q = await app.openSession({ name: 'other realm', type: 'browser', url: SITE + 'auth-other' });
    await waitFor(() => !!modal() && /Sign in to/.test(modal().getAttribute('aria-label') || ''), 8000, 'second prompt');
    await app.closePane(q, true);
    await waitFor(() => !modal(), 3000, 'prompt withdrawn');
    results.authPromptWithdrawnOnClose = !modal() && q.disposed;

    // ---------- the app's shortcuts while a page swallows every key ----------
    app.focusPane(p);
    p.navigate(SITE + 'keys');
    await loaded(p, '/keys');
    await inGuest(p, "document.getElementById('kf').focus()", true);
    p.focus();
    await sleep(200);
    await window.api.app.testKey({ keyCode: 'l', modifiers: ['cmd'], guest: guestId(p) });
    await waitFor(() => document.activeElement === p.urlEl, 3000, '⌘L from the page').catch(() => {});
    const seen = await inGuest(p, 'JSON.stringify(window.__keys)', false);
    results.reservedShortcutReachesApp = document.activeElement === p.urlEl && !/"Ml"/.test(seen);
    log('keys the page saw', seen);
    p.focus();
    await window.api.app.testKey({ keyCode: 'a', modifiers: [], guest: guestId(p) });
    await sleep(150);
    results.ordinaryKeyStaysInPage = /"a"/.test(await inGuest(p, 'JSON.stringify(window.__keys)', false));

    // ---------- an address with a password is refused: the field, the editor, the importer ----------
    p.urlEl.focus();
    p.urlEl.value = 'http://admin:admin@127.0.0.1:42510/';
    p.urlEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(300);
    results.fieldRefusesPassword = /Passwords do not belong in the address/.test(toasts()) && p.url === SITE + 'keys';
    p.urlEl.value = p.url;
    app.action('new-session');
    await sleep(400);
    [...modal().querySelectorAll('.type-picker button')].find((b) => b.textContent.includes('Browser')).click();
    await sleep(150);
    const urlInput = [...modal().querySelectorAll('label')].find((l) => l.textContent === 'URL').nextElementSibling;
    urlInput.value = 'http://admin:admin@192.0.2.1/';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal().querySelector('.modal-foot .btn.primary').click();
    await sleep(300);
    results.editorRefusesPassword = !!modal() && urlInput.getAttribute('aria-invalid') === 'true' && urlInput.classList.contains('invalid') && document.activeElement === urlInput;
    urlInput.value = 'http://192.0.2.1/';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    results.editorClearsInvalidOnEdit = !urlInput.hasAttribute('aria-invalid') && !urlInput.classList.contains('invalid');
    modal().querySelector('.modal-foot button').click(); // Cancel: the editor is dirty, so the discard question comes on top
    await sleep(200);
    const top = [...document.querySelectorAll('.modal')].pop();
    if (top) { [...top.querySelectorAll('.modal-foot button')].find((b) => /Discard/.test(b.textContent))?.click(); await sleep(200); }
    results.editorClosed = !modal();
  } catch (e) {
    results.error = e.message;
    log('ERROR', e.stack || e.message);
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log(failed.length ? 'FAILED ' + failed.join(', ') : 'ALL OK');
  window.api.app.quit();
})();
