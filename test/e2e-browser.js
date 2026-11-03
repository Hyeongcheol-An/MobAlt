// Browser sessions (src/renderer/browser.js): a web page in a pane next to the terminals. Opens a saved browser session
// on the test site (test/httpsrv.js on 127.0.0.1:42510): the page loads, the tab is titled after it, the address
// field and the status bar show the URL, the favicon arrives; links, Back / Forward / Reload and the address field
// navigate; a target=_blank link and window.open() stay in the pane, file: / javascript: popups are refused; a bad
// port shows the error view with the code and Retry; Stop ends a slow load; the session editor and quick connect
// refuse file: addresses; the JSON importer takes a browser session and skips a file: one; a split with a local
// terminal works for both without reloading the page; ⇧⌘⏎ zoom; MultiExec leaves the pane out; ⌘= zooms the page;
// ⌘F finds in the page; the pane menu's items and Copy URL; Rename Pane locks the title; the workspace saves the
// page the pane is on and a restore brings it back there; detach to a window and back; close removes the webview.
// Then the review round's cases: the title does not flicker to the session's name while a titled page loads; a
// titleless page is named after the session; a hidden page never re-activates its
// tab while another opens (20×); a session re-saved as another type; an editor-made session through export → import;
// page zoom is Chromium's per-site level; about:blank; a shared cookie jar and an isolated one; a tab switch hides
// the page without reloading; the sidebar toggle and a window resize keep the page over its pane; the drop zone
// makes the page step aside; closing while loading; the closing questions never count a page; a language switch
// relabels the toolbar; unsplit and a tab drop keep the page; an unreachable page and a url-less descriptor restore.
//   test/e2e-browser.sh <out-dir>                      (starts the web site, runs both phases)
//   test/qa/run.sh test/e2e-browser.js <out-dir> 180000 (phase 1 alone: node test/httpsrv.js --port 42510 must be up;
//                                                       ends with a browser tab at /b saved in the workspace)
//   test/qa/run.sh test/e2e-browser-verify.js <out-dir> (phase 2, same out-dir: that tab comes back at /b)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => { await sleep(150); return window.api.app.screenshot(n); };
  const log = (...a) => console.log('[e2e-browser]', ...a);
  const app = window.app;
  const results = {};
  const SITE = 'http://127.0.0.1:42510/';
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const toasts = () => document.getElementById('toast-root').textContent;
  const status = () => document.getElementById('st-session').textContent;
  const layer = () => [...document.querySelectorAll('#webview-layer webview')];
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  const loaded = (p, suffix) => waitFor(() => p.status === 'connected' && !p.loading && (suffix === undefined || p.url.endsWith(suffix)), 10000, 'loaded ' + (suffix || ''));
  const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
  const sameBox = (r, b) => near(r.left, b.left) && near(r.top, b.top) && near(r.width, b.width) && near(r.height, b.height);
  const inGuest = (p, code) => p.webview.executeJavaScript(code, true); // as a user gesture: a click without one leaves a history entry Chromium skips on Back (its history-manipulation intervention)
  const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const modal = () => document.querySelector('.modal');
  const pendingAnswers = async () => (await window.api.app.testNextDialog()).pending;
  const windows = () => window.api.app.testWindows();
  const ev = (id, code) => window.api.app.testEval(id, code);
  const menuItems = () => [...document.querySelectorAll('#ctx-root .ctx-item')].map((i) => i.textContent.trim());
  const closeMenu = async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100); };
  let starts = 0; // did-start-loading events of the pane under test: a reload / retry is one more
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const shell = app.activePane();
    await prompt(shell);

    // ---------- open a saved browser session: loaded, titled, addressed ----------
    const saved = await app.saveSession({ name: 'Local web', type: 'browser', url: SITE });
    results.sessionSaved = saved.type === 'browser' && saved.url === SITE && !!saved.id;
    const p = await app.openSession(saved);
    p.webview.addEventListener('did-start-loading', () => { starts++; });
    results.opened = p.kind === 'browser' && app.activePane() === p && app.workspace.active === p.tab && layer().includes(p.webview);
    await loaded(p, '/');
    await waitFor(() => p.title === 'Page A' && p.tab.title === 'Page A', 5000, 'page title');
    await waitFor(() => !!p.favicon, 5000, 'favicon');
    await sleep(200);
    results.titleFollowsPage = p.title === 'Page A' && p.tab.title === 'Page A' && p.headTitle.textContent === 'Page A';
    results.urlField = p.urlEl.value === SITE;
    results.statusBar = status() === `BROWSER · ${SITE} · loaded`;
    results.favicon = /^data:image\/png;base64,/.test(p.favicon) && !p.favEl.hidden;
    results.webviewPlaced = sameBox(p.webview.getBoundingClientRect(), p.bodyEl.getBoundingClientRect()) && !p.webview.classList.contains('off') && getComputedStyle(p.webview).visibility === 'visible';
    results.sidebarDot = !!app.sessionTree.el.querySelector(`.tree-row[data-session="${saved.id}"] .dot`) && !!app.sessionTree.el.querySelector(`.tree-row[data-session="${saved.id}"] .ico-browser`);
    results.tabDot = p.tab.tabEl.querySelector('.dot').classList.contains('connected');
    results.toolbarA11y = [p.backBtn, p.fwdBtn, p.reloadBtn, p.openBtn].every((b) => b.tabIndex === 0 && !!b.getAttribute('aria-label')) && p.urlEl.getAttribute('aria-label') === 'Address' && p.barEl.getAttribute('role') === 'toolbar';
    await shot('b1-loaded');

    // ---------- navigation: a link, Back / Forward / Reload, the address field ----------
    // every title the pane shows on the way: the previous page's stays until the next one's arrives, never the
    // session's name in between (that is only for a page with no <title>, below)
    const titlesSeen = [];
    const updateTitle = p.updateTitle;
    p.updateTitle = function (...a) { titlesSeen.push(this.title); return updateTitle.apply(this, a); };
    await inGuest(p, "document.getElementById('to-b').click()");
    await loaded(p, '/b');
    await waitFor(() => p.title === 'Page B', 5000, 'title B');
    await waitFor(() => p.canBack, 3000, 'back enabled');
    delete p.updateTitle; // the prototype's again
    results.titleNoFlickerOnNavigate = titlesSeen.length > 0 && titlesSeen.every((x) => x === 'Page A' || x === 'Page B') && titlesSeen[titlesSeen.length - 1] === 'Page B';
    log('titles during the navigation', JSON.stringify(titlesSeen));
    results.linkNavigates = p.url === SITE + 'b' && p.tab.title === 'Page B' && p.urlEl.value === SITE + 'b';
    results.backEnabled = !p.backBtn.disabled && p.fwdBtn.disabled;
    p.backBtn.click();
    await loaded(p, '/');
    await waitFor(() => p.canFwd, 3000, 'forward enabled');
    results.backWorks = p.url === SITE && p.title === 'Page A' && !p.fwdBtn.disabled;
    p.fwdBtn.click();
    await loaded(p, '/b');
    results.forwardWorks = p.url === SITE + 'b' && p.title === 'Page B';
    const before = starts;
    p.reloadBtn.click();
    await waitFor(() => starts === before + 1, 3000, 'reload started');
    await loaded(p, '/b');
    results.reloadWorks = p.url === SITE + 'b' && p.status === 'connected';
    await shot('b2-page-b');
    // the address field completes a bare host:port (the local network: http://) and loads it on Enter
    p.urlEl.focus();
    p.urlEl.value = '127.0.0.1:42510/';
    key(p.urlEl, 'Enter');
    await loaded(p, '/');
    results.urlFieldEnter = p.url === SITE && p.urlEl.value === SITE && p.title === 'Page A';
    p.urlEl.focus();
    p.urlEl.value = 'file:///etc/hosts';
    key(p.urlEl, 'Enter');
    await sleep(300);
    results.urlFieldRefusesFile = p.url === SITE && toasts().includes('Only http:// and https:// addresses') && p.status === 'connected';
    p.urlEl.value = p.url;
    key(p.urlEl, 'Escape');
    // ⌘L (the View menu's Address Bar item): the field, selected
    app.action('address-bar');
    await waitFor(() => document.activeElement === p.urlEl, 2000, 'address bar focused').catch(() => {}); // the focus crosses from the page back to the window
    results.addressBarShortcut = document.activeElement === p.urlEl && p.urlEl.selectionEnd > p.urlEl.selectionStart;
    p.focus();

    // ---------- popups: target=_blank stays in the pane; file: / javascript: are refused ----------
    await inGuest(p, "document.getElementById('blank').click()");
    await loaded(p, '/b');
    await sleep(300);
    results.popupSamePane = p.url === SITE + 'b' && (await windows()).length === 1;
    await inGuest(p, "document.getElementById('to-a').click()");
    await loaded(p, '/');
    await inGuest(p, "document.getElementById('popup-file').click()");
    await inGuest(p, "document.getElementById('popup-js').click()");
    await sleep(600);
    results.popupsRefused = p.url === SITE && p.title === 'Page A' && (await windows()).length === 1 && (await inGuest(p, 'document.title')) === 'Page A';
    if (!results.popupsRefused) log('popups:', p.url, p.title, (await windows()).length, await inGuest(p, 'document.title'));

    // ---------- a bad port: the error view with the code, Retry; a good address recovers ----------
    p.navigate('http://127.0.0.1:42599/');
    await waitFor(() => p.status === 'failed', 10000, 'failed');
    await sleep(200);
    results.errorView = !p.errorEl.hidden && /could not be loaded/.test(p.errorEl.textContent) && /CONNECTION_REFUSED/.test(p.errorEl.textContent) && /\(-102\)/.test(p.errorEl.textContent)
      && p.errorEl.querySelector('.url').textContent === 'http://127.0.0.1:42599/' && p.webview.classList.contains('off') && /· failed/.test(status()) && p.tab.tabEl.querySelector('.dot').classList.contains('failed');
    // the error view replaced Page A: the pane and the tab are named after the session again, not the page that went
    results.errorViewTitle = p.title === 'Local web' && p.tab.title === 'Local web' && p.headTitle.textContent === 'Local web';
    if (!results.errorViewTitle) log('title on the error view:', p.title, p.tab.title);
    if (!results.errorView) log('error view:', p.errorEl.hidden, JSON.stringify(p.errorEl.textContent), p.webview.className, status(), p.tab.tabEl.querySelector('.dot').className);
    await shot('b3-error');
    const beforeRetry = starts;
    p.retryBtn.click();
    await waitFor(() => starts === beforeRetry + 1, 3000, 'retry started');
    await waitFor(() => p.status === 'failed' && !p.loading, 10000, 'failed again');
    results.retryRuns = p.failed && p.failed.url === 'http://127.0.0.1:42599/' && !p.errorEl.hidden && p.title === 'Local web';
    p.navigate(SITE);
    await loaded(p, '/');
    await waitFor(() => p.title === 'Page A', 5000, 'title after recovery').catch(() => {});
    results.titleAfterRecovery = p.title === 'Page A' && p.tab.title === 'Page A';
    await sleep(200);
    results.recovers = p.errorEl.hidden && !p.webview.classList.contains('off') && p.failed === null && status() === `BROWSER · ${SITE} · loaded`;

    // ---------- a slow page: loading state, Stop ----------
    p.navigate(SITE + 'slow');
    await waitFor(() => p.loading && p.status === 'connecting', 3000, 'loading');
    results.loadingState = p.el.classList.contains('loading') && p.reloadBtn.getAttribute('aria-label') === 'Stop' && /· loading/.test(status()) && p.bodyEl.getAttribute('aria-busy') === 'true';
    p.reloadBtn.click(); // Stop
    await waitFor(() => !p.loading, 3000, 'stopped');
    await sleep(200);
    results.stopWorks = p.status === 'connected' && p.url === SITE && p.urlEl.value === SITE && p.reloadBtn.getAttribute('aria-label') === 'Reload' && p.errorEl.hidden;
    if (!results.stopWorks) log('stop:', p.status, p.url, p.urlEl.value, p.reloadBtn.getAttribute('aria-label'), p.errorEl.hidden, JSON.stringify(p.failed));

    // ---------- the session editor: the Browser type, a file: address refused, a bare host completed ----------
    app.action('new-session');
    await sleep(400);
    const typeBtn = [...modal().querySelectorAll('.type-picker button')].find((b) => b.textContent.includes('Browser'));
    results.editorHasType = !!typeBtn && typeBtn.textContent.includes('🌐');
    typeBtn.click();
    await sleep(150);
    const labelOf = (name) => [...modal().querySelectorAll('label')].find((l) => l.textContent === name);
    const urlInput = labelOf('URL')?.nextElementSibling;
    results.editorBrowserForm = urlInput?.tagName === 'INPUT' && !!urlInput.id && labelOf('URL').htmlFor === urlInput.id && !labelOf('Host') && !labelOf('Port') && !!labelOf('Cookies');
    results.editorTabsHidden = [...modal().querySelectorAll('.mtabs button')].filter((b) => !b.hidden).map((b) => b.textContent).join('|') === 'Basic';
    await shot('b4-editor');
    urlInput.value = 'file:///etc/hosts';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal().querySelector('.modal-foot .btn.primary').click();
    await sleep(300);
    results.editorRefusesFile = !!modal() && toasts().includes('Only http:// and https:// addresses') && document.activeElement === urlInput;
    urlInput.value = '127.0.0.1:42510/b';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal().querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !modal(), 3000, 'editor closed');
    await sleep(300);
    const typed = app.sessions.sessions.find((s) => s.url === SITE + 'b');
    results.editorSaves = !!typed && typed.type === 'browser' && typed.name === '127.0.0.1:42510' && typed.isolated === false && typed.id !== saved.id;

    // ---------- quick connect: http(s) opens a browser pane, other schemes are refused ----------
    const tabsBefore = app.workspace.tabs.length;
    await app.quickConnect(SITE + 'b');
    const q = app.activePane();
    results.quickConnectOpens = q !== p && q.kind === 'browser' && q.url === SITE + 'b' && q.session === typed && app.workspace.tabs.length === tabsBefore + 1; // the saved session of that address is used
    await loaded(q, '/b');
    await app.closePane(q, true);
    await sleep(200);
    app.quickConnect('file:///etc/hosts');
    app.quickConnect('javascript:alert(1)');
    await sleep(200);
    results.quickConnectRefuses = app.workspace.tabs.length === tabsBefore && toasts().includes('http:// / https://');

    // ---------- JSON import / export ----------
    const dir = await window.api.app.testFs('mkdtemp', 'mobalt-browser-');
    const inFile = dir + '/in.json';
    await window.api.app.testFs('writeText', inFile, JSON.stringify({ sessions: [
      { name: 'imported-web', type: 'browser', url: 'nas.local:8080/admin', isolated: true },
      { name: 'imported-file', type: 'browser', url: 'file:///etc/hosts' },
    ] }));
    await window.api.app.testNextDialog({ canceled: false, filePaths: [inFile] });
    await app.action('import-json');
    await sleep(400);
    const imp = app.sessions.sessions.find((s) => s.name === 'imported-web');
    results.importAcceptsBrowser = !!imp && imp.type === 'browser' && imp.url === 'http://nas.local:8080/admin' && imp.isolated === true && !app.sessions.sessions.find((s) => s.name === 'imported-file')
      && /skipped 1: "imported-file": bad URL/.test(toasts()) && (await pendingAnswers()) === 0;
    const outFile = dir + '/out.json';
    await window.api.app.testNextDialog({ canceled: false, filePath: outFile });
    await app.action('export-json');
    await sleep(400);
    const exported = JSON.parse(await window.api.app.testFs('readText', outFile));
    const ex = exported.sessions.find((s) => s.id === saved.id);
    results.exportKeepsBrowser = !!ex && ex.type === 'browser' && ex.url === SITE && (await pendingAnswers()) === 0;
    await window.api.app.testFs('rm', dir);

    // ---------- split with a local terminal: both work, the page is not reloaded ----------
    app.focusPane(p);
    await inGuest(p, 'window.__mark = 42');
    await app.splitActive('right');
    const empty = app.activePane();
    await empty.becomeLocal();
    await prompt(empty);
    const marker = 'BR_' + Math.random().toString(36).slice(2, 8).toUpperCase();
    empty.term.input(`echo BR_''${marker.slice(3)}\r`);
    await waitFor(() => text(empty).split('\n').filter((l) => l.includes(marker)).length >= 1, 8000, 'marker in the split shell');
    await sleep(300);
    results.splitBothWork = p.tab.panes().length === 2 && p.tab === empty.tab && p.status === 'connected' && live(empty) && p.el.classList.contains('show-head') && p.headTitle.textContent === 'Page A';
    results.noReloadOnSplit = (await inGuest(p, 'window.__mark')) === 42;
    const wr = p.webview.getBoundingClientRect(), br = p.bodyEl.getBoundingClientRect(), tr = empty.el.getBoundingClientRect();
    results.webviewFollowsSplit = sameBox(wr, br) && wr.right <= tr.left + 1 && wr.width < p.tab.pageEl.getBoundingClientRect().width * 0.7;
    await shot('b5-split');

    // ---------- ⇧⌘⏎: the page fills the tab, the terminal hides, and back ----------
    app.focusPane(p);
    app.action('zoom-pane');
    await sleep(400);
    const zr = p.webview.getBoundingClientRect(), pr = p.tab.pageEl.getBoundingClientRect();
    results.zoomFills = p.tab.zoomed === p && p.zoomed && near(zr.left, pr.left) && near(zr.width, pr.width) && near(zr.bottom, pr.bottom) && getComputedStyle(empty.el).display === 'none'
      && p.zoomBtn.getAttribute('aria-pressed') === 'true' && !p.zoomBadge.hidden;
    await shot('b6-zoomed');
    app.action('zoom-pane');
    await sleep(400);
    results.unzoomRestores = p.tab.zoomed === null && !p.zoomed && getComputedStyle(empty.el).display !== 'none' && sameBox(p.webview.getBoundingClientRect(), p.bodyEl.getBoundingClientRect());

    // ---------- MultiExec leaves the page out ----------
    app.action('multiexec');
    await sleep(200);
    results.multiexecExcludes = app.multiexec && !app.multiexecCandidates().includes(p) && app.multiexecCandidates().includes(empty) && document.getElementById('multiexec-count').textContent === '1' && p.multiexecCandidate() === false;
    app.action('multiexec');
    await sleep(100);

    // ---------- ⌘= / ⌘0 on the page: Chromium's zoom level, not the font ----------
    app.focusPane(p);
    app.action('zoom', 1);
    await sleep(150);
    const level = () => { try { return p.webview.getZoomLevel(); } catch { return p.zoomLevel; } };
    results.pageZoom = p.zoomLevel === 0.5 && level() === 0.5 && empty.term.options.fontSize === empty.baseFontSize();
    app.action('zoom', 0);
    await sleep(150);
    results.pageZoomReset = p.zoomLevel === 0 && level() === 0;

    // ---------- ⌘F: the find bar searches the page ----------
    p.navigate(SITE + 'b');
    await loaded(p, '/b');
    app.focusPane(p);
    app.action('find');
    const fi = document.getElementById('find-input');
    fi.value = 'needle';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => /^1 \/ 2$/.test(document.getElementById('find-count').textContent), 5000, 'find count');
    key(fi, 'Enter');
    await waitFor(() => /^2 \/ 2$/.test(document.getElementById('find-count').textContent), 5000, 'find next');
    results.findInPage = true;
    app.action('find-close');
    await sleep(100);
    results.findCloses = document.getElementById('find-bar').hidden && !document.body.classList.contains('find-open');

    // ---------- the pane menu ----------
    p.openPaneMenu(400, 300);
    await sleep(100);
    const items = menuItems();
    results.paneMenuItems = ['Back', 'Forward', 'Reload', 'Copy URL', 'Open in Browser', 'Rename Pane…', 'Split Right', 'Close Pane'].every((l) => items.some((i) => i.startsWith(l)));
    [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => i.textContent.startsWith('Copy URL')).click();
    await sleep(150);
    results.copyUrl = (await window.api.clipboard.read()) === SITE + 'b';
    await closeMenu();
    p.openHeaderMenu();
    await sleep(100);
    results.headerMenu = menuItems().some((i) => i.startsWith('Copy URL')) && p.menuBtn.getAttribute('aria-expanded') === 'true';
    await closeMenu();

    // ---------- Rename Pane…: the name holds against the page's title; empty = the page's title again ----------
    p.setTitle('My console');
    await inGuest(p, "document.getElementById('to-a').click()");
    await loaded(p, '/');
    await sleep(200);
    results.renameLocks = p.title === 'My console' && p.tab.title === 'My console' && !p.titleIsDefault();
    p.setTitle('');
    await sleep(100);
    results.renameUnlocks = p.title === 'Page A' && p.tab.title === 'Page A' && p.titleIsDefault();

    // ---------- the workspace file remembers the page; a rebuild from it opens the pane there ----------
    p.navigate(SITE + 'b');
    await loaded(p, '/b');
    app.saveWorkspaceNow();
    await sleep(300);
    const ws = await window.api.workspace.get();
    const descs = [];
    (function walk(n) { if (!n) return; if (n.t === 'pane') descs.push(n); else (n.children || []).forEach(walk); })(ws.tabs.find((td) => JSON.stringify(td).includes('"browser"'))?.root);
    const d = descs.find((x) => x.kind === 'browser');
    results.workspaceSavesUrl = !!d && d.url === SITE + 'b' && d.sessionId === saved.id;
    const wsTab = ws.tabs.find((td) => JSON.stringify(td).includes('"browser"'));
    const made = await app.buildTabs({ tabs: [wsTab], activeTab: 0 });
    const rebuilt = app.workspace.active.panes().find((x) => x.kind === 'browser');
    await loaded(rebuilt, '/b');
    results.restoreInRun = made && rebuilt !== p && rebuilt.url === SITE + 'b' && rebuilt.session?.id === saved.id && rebuilt.title === 'Page B';
    await app.closeTab(app.workspace.active);
    await sleep(200);

    // ---------- a page without a <title> is named after the session, never after the page before it ----------
    app.workspace.activate(p.tab);
    app.focusPane(p);
    p.navigate(SITE + 'notitle');
    await loaded(p, '/notitle');
    await sleep(200);
    results.titlelessPage = p.title === 'Local web' && p.tab.title === 'Local web' && p.webview.getAttribute('aria-label') === 'Local web';
    p.navigate(SITE + 'b');
    await loaded(p, '/b');
    await waitFor(() => p.title === 'Page B', 5000, 'title back');

    // ---------- a hidden page never re-activates its tab while another session opens (20×) ----------
    const other = await app.saveSession({ name: 'Second', type: 'browser', url: SITE });
    let churnOk = true;
    for (let i = 0; i < 20 && churnOk; i++) {
      app.focusPane(p);
      const q = await app.openSession(other);
      await sleep(250);
      churnOk = app.workspace.active === q.tab && app.activePane() === q && getComputedStyle(p.webview).visibility === 'hidden';
      if (!churnOk) log('churn failed at', i, app.workspace.active === q.tab, app.activePane() === q);
      await app.closeTab(q.tab);
      await sleep(80);
    }
    results.hiddenPageKeepsOut = churnOk && app.workspace.active === p.tab;

    // ---------- the session re-saved as another type: nothing throws, the pane stays what it is ----------
    let resaveErr = null;
    try { await app.saveSession({ ...other, type: 'ssh', host: '127.0.0.1', port: 2222, username: 'u' }); } catch (e) { resaveErr = e.message; }
    await app.saveSession({ ...other, type: 'browser', url: SITE });
    results.resaveAsOtherType = resaveErr === null && p.status === 'connected';

    // ---------- an editor-made session survives export → import ----------
    const dir2 = await window.api.app.testFs('mkdtemp', 'mobalt-browser-rt-');
    const rt = dir2 + '/roundtrip.json';
    await window.api.app.testNextDialog({ canceled: false, filePath: rt });
    await app.action('export-json');
    await sleep(400);
    const dump = JSON.parse(await window.api.app.testFs('readText', rt));
    const typedOut = dump.sessions.find((s) => s.id === typed.id);
    results.editorMadeExported = !!typedOut && typedOut.type === 'browser' && typedOut.url === SITE + 'b' && !('port' in typedOut) && !('host' in typedOut);
    await app.deleteSession(typed.id);
    await window.api.app.testNextDialog({ canceled: false, filePaths: [rt] });
    await app.action('import-json');
    await sleep(400);
    const typedBack = app.sessions.sessions.find((s) => s.id === typed.id);
    results.editorMadeImported = !!typedBack && typedBack.type === 'browser' && typedBack.url === SITE + 'b' && !/skipped/.test(toasts().slice(-200)) && (await pendingAnswers()) === 0;
    await window.api.app.testFs('rm', dir2);

    // ---------- page zoom is Chromium's level for the site: read back, shared by panes of the site, not the pane's own ----------
    app.focusPane(p);
    app.action('zoom', 1);
    await sleep(200);
    const q2 = await app.openSession(saved);
    await loaded(q2, '/');
    await sleep(300);
    results.zoomIsPerSite = p._zoomNow() === 0.5 && q2._zoomNow() === 0.5 && q2.zoomLevel === 0.5 && p.transferState().zoomLevel === 0.5;
    p.openPaneMenu(300, 300);
    await sleep(100);
    results.zoomInMenu = menuItems().some((i) => /^Page Zoom \(110%\)/.test(i)); // one step is half a Chromium level: 1.2^0.5
    await closeMenu();
    app.focusPane(q2);
    app.action('zoom', 0);
    await sleep(200);
    results.zoomResetFromOtherPane = p._zoomNow() === 0 && q2._zoomNow() === 0;
    await app.closeTab(q2.tab);
    await sleep(100);

    // ---------- about:blank: nothing to open outside ----------
    app.focusPane(p);
    p.navigate('about:blank');
    await loaded(p);
    await sleep(100);
    results.aboutBlank = p.url === 'about:blank' && p.openBtn.disabled && p.title === 'Local web';
    p.navigate(SITE + 'b');
    await loaded(p, '/b');
    results.openEnabledAgain = !p.openBtn.disabled;

    // ---------- cookie jars: shared by default, a session of its own when isolated ----------
    await inGuest(p, "document.cookie = 'jar=shared; path=/'", false);
    const shared2 = await app.openSession(saved);
    await loaded(shared2, '/');
    const isolatedS = await app.saveSession({ name: 'Isolated web', type: 'browser', url: SITE, isolated: true });
    const iso = await app.openSession(isolatedS);
    await loaded(iso, '/');
    results.cookieJarShared = (await inGuest(shared2, 'document.cookie', false)).includes('jar=shared');
    results.cookieJarIsolated = !(await inGuest(iso, 'document.cookie', false)).includes('jar=shared') && iso.partition === 'persist:browser-' + isolatedS.id && shared2.partition === 'persist:browser';
    await app.closeTab(iso.tab);
    await app.closeTab(shared2.tab);
    await sleep(100);

    // ---------- a tab switch hides the page without reloading it; the sidebar and the window keep it over its pane ----------
    app.workspace.activate(p.tab);
    await inGuest(p, 'window.__mark2 = 7', false);
    app.workspace.activate(shell.tab);
    await sleep(200);
    results.tabSwitchHides = p.webview.classList.contains('off') && getComputedStyle(p.webview).visibility === 'hidden';
    app.workspace.activate(p.tab);
    await sleep(200);
    results.tabSwitchNoReload = !p.webview.classList.contains('off') && (await inGuest(p, 'window.__mark2', false)) === 7;
    app.toggleSidebar();
    await sleep(250);
    results.sidebarTogglePlacement = sameBox(p.webview.getBoundingClientRect(), p.bodyEl.getBoundingClientRect());
    app.toggleSidebar();
    await window.api.app.testResize(1100, 700);
    await sleep(400);
    results.windowResizePlacement = sameBox(p.webview.getBoundingClientRect(), p.bodyEl.getBoundingClientRect());
    await window.api.app.testResize(1400, 880);
    await sleep(300);

    // ---------- a session dragged over the page: the drop zone shows, the page steps aside and comes back ----------
    const dt = new DataTransfer();
    dt.setData('text/x-mobalt-session', saved.id);
    const r0 = p.el.getBoundingClientRect();
    p.el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r0.left + r0.width / 2, clientY: r0.top + r0.height / 2 }));
    await sleep(50);
    results.dropZoneStepsAside = !!p.el.querySelector('.drop-zone.center') && p.webview.classList.contains('off') && p._dragOver === true;
    p.el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
    await sleep(50);
    results.dropZoneComesBack = !p.el.querySelector('.drop-zone') && !p.webview.classList.contains('off') && p._dragOver === false;

    // ---------- closing while loading; the closing questions never count a page ----------
    const slowP = await app.openSession({ name: 'slow', type: 'browser', url: SITE + 'slow' });
    await waitFor(() => slowP.loading, 3000, 'slow loading');
    await app.closePane(slowP, false);
    await sleep(200);
    results.closeWhileLoading = slowP.disposed && !layer().includes(slowP.webview) && !toasts().includes('Internal error');
    await app.saveSettings({ confirmClose: true });
    const pageTab = await app.openSession(saved);
    await loaded(pageTab, '/');
    const closedQuietly = await app.closeTab(pageTab.tab);
    await sleep(150);
    results.confirmCloseIgnoresPages = closedQuietly === true && !modal() && app.liveIn([p.tab]).length === 0;
    await app.saveSettings({ confirmClose: false });

    // ---------- a language switch relabels the toolbar ----------
    await app.saveSettings({ language: 'ko' });
    await sleep(300);
    const koLabel = p.closeBtn.getAttribute('aria-label'); // a label the dictionaries have (the toolbar's own are this round's strings, English until translated)
    await app.saveSettings({ language: 'en' });
    await sleep(300);
    results.languageRelabel = koLabel !== 'Close pane' && koLabel.length > 0 && p.closeBtn.getAttribute('aria-label') === 'Close pane' && p.urlEl.getAttribute('aria-label') === 'Address';

    // ---------- unsplit and a tab dropped on a pane keep the page (no reload) ----------
    app.focusPane(p);
    await inGuest(p, 'window.__mark3 = 11', false);
    await app.splitActive('down');
    const empty2 = app.activePane();
    await empty2.becomeLocal();
    await prompt(empty2);
    app.focusPane(p);
    await app.unsplit('tabs'); // the shell goes to a tab of its own, the page stays
    await sleep(300);
    results.unsplitKeepsPage = p.tab.panes().length === 1 && empty2.tab !== p.tab && (await inGuest(p, 'window.__mark3', false)) === 11;
    app.workspace.movePane(empty2, p, 'right'); // the shell's tab dropped on the page's right edge
    await sleep(300);
    results.tabDropKeepsPage = p.tab.panes().length === 2 && empty2.tab === p.tab && (await inGuest(p, 'window.__mark3', false)) === 11 && sameBox(p.webview.getBoundingClientRect(), p.bodyEl.getBoundingClientRect());
    await app.closePane(empty2, true);
    await sleep(100);

    // ---------- the workspace file: an unreachable page restores into the error view; a url-less descriptor opens the session's page ----------
    const made2 = await app.buildTabs({ tabs: [
      { title: 'dead', root: { t: 'pane', kind: 'browser', sessionId: saved.id, url: 'http://127.0.0.1:42599/' } },
      { title: 'start', root: { t: 'pane', kind: 'browser', sessionId: saved.id } },
    ], activeTab: 0 });
    // the rebuilt tabs are named after their session (auto titles), so the panes are found by their address
    const dead = app.workspace.allPanes().find((x) => x.kind === 'browser' && x.url === 'http://127.0.0.1:42599/');
    const start = app.workspace.allPanes().find((x) => x.kind === 'browser' && x !== p && x !== dead && x.session?.id === saved.id);
    await waitFor(() => dead && dead.status === 'failed', 10000, 'dead page failed');
    await loaded(start, '/');
    results.restoreUnreachable = made2 && !dead.errorEl.hidden && dead.url === 'http://127.0.0.1:42599/' && /Nothing answers/.test(dead.errorEl.textContent);
    results.restoreUrlless = start.url === SITE && start.status === 'connected';
    await app.closeTab(dead.tab);
    await app.closeTab(start.tab);
    await sleep(100);

    // ---------- detach to a window: the pane is made again there at its page; closing the window brings it back ----------
    app.workspace.activate(p.tab);
    await app.closePane(empty, true); // the browser pane alone in its tab
    await sleep(200);
    app.focusPane(p);
    await app.action('detach-tab');
    let dw = null;
    await waitFor(async () => (dw = (await windows()).find((w) => w.detached) || null), 15000, 'detached window');
    const state = (id) => ev(id, '(() => { const a = window.app && window.app.workspace && window.app.activePane(); return a ? [a.kind, a.url, a.status, a.title].join(" ") : ""; })()').catch(() => '');
    await waitFor(async () => /^browser http:\/\/127\.0\.0\.1:42510\/b connected Page B$/.test(await state(dw.id)), 15000, 'the window shows the page');
    results.detachRecreates = p.disposed && p.released && !layer().includes(p.webview) && (await windows()).length === 2 && /loaded again in the new window/.test(toasts());
    await ev(dw.id, "window.api.app.screenshot('b7-detached')");
    await window.api.app.testCloseWindow(dw.id);
    await waitFor(async () => (await windows()).length === 1 && app.workspace.allPanes().some((x) => x.kind === 'browser'), 15000, 'tab back');
    const back = app.workspace.allPanes().find((x) => x.kind === 'browser');
    await loaded(back, '/b');
    results.detachReturns = back !== p && back.url === SITE + 'b' && back.session?.id === saved.id && back.tab === app.workspace.active;

    // ---------- close: the webview leaves the layer ----------
    const n = layer().length;
    await app.closePane(back, true);
    await sleep(200);
    results.closeRemovesWebview = back.disposed && layer().length === n - 1 && !back.el.isConnected;

    // ---------- phase 2 (test/e2e-browser-verify.js): a browser tab at /b, saved ----------
    const last = await app.openSession(saved);
    await loaded(last, '/');
    last.navigate(SITE + 'b');
    await loaded(last, '/b');
    app.saveWorkspaceNow();
    await sleep(500);
  } catch (e) {
    results.error = e.message;
    log('ERROR', e.stack || e.message);
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log(failed.length ? 'FAILED ' + failed.join(', ') : 'ALL OK');
  window.api.app.quit();
})();
