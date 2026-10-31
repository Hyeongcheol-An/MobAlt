// MultiExec scope: keystrokes go only to the live terminals visible in the active tab, never to other tabs,
// and the banner count follows tab switches, splits, closes, deaths and reconnects.
//   test/qa/run.sh test/e2e-multiexec.js <out-dir>
// (There is no pane zoom/maximize feature — "zoom" is the font size — so "visible" is every pane of the active tab.)
// Also: the tab titles after a tab → pane drop, the FTP card in a split (test/ftpd.py on 127.0.0.1:2151 when it is
// running; without a server the failed card has the same box) and the wording when nothing can be broadcast to.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-multiexec]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const count = (pane, s) => text(pane).split('\n').filter((l) => l.includes(s)).length;
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const banner = () => document.getElementById('multiexec-banner');
  const bannerCount = () => document.getElementById('multiexec-count').textContent;
  const toasts = () => document.getElementById('toast-root').textContent;
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  let seq = 0;
  const mark = () => 'MX_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  // Type through xterm's onData (what a key press does) → _onInput → broadcast. The echoed command line reads
  // MX_''ABC, so only the command's output contains MX_ABC: one matching line per time the shell ran it.
  const type = (pane, m) => pane.term.input(`echo MX_''${m.slice(3)}\r`);
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const tab1 = app.workspace.active;
    const a = tab1.activePane;
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'right' });
    await prompt(a);
    await prompt(b);
    results.tab1HasTwoPanes = tab1.panes().length === 2 && b.tab === tab1;
    const c = await app.newLocalTab();
    const tab2 = app.workspace.active;
    await prompt(c);
    results.tab2IsSeparate = tab2 !== tab1 && tab2.panes().length === 1 && app.workspace.tabs.length === 2;

    // --- off → on in tab 1: the banner counts the 2 visible panes
    app.workspace.activate(tab1);
    await sleep(200);
    results.bannerHiddenWhileOff = banner().hidden && !app.multiexec;
    app.action('multiexec');
    await sleep(150);
    results.multiexecOn = app.multiexec === true && document.getElementById('btn-multiexec').classList.contains('on');
    results.bannerShownTab1 = !banner().hidden && bannerCount() === '2';
    results.bannerWording = /keystrokes go to 2 visible terminal\(s\) in this tab/.test(banner().textContent);
    results.toastOn = toasts().includes('MultiExec ON: input goes to every visible terminal in this tab');
    results.buttonTooltip = /every visible terminal in this tab/.test(document.getElementById('btn-multiexec').title);
    await shot('60-multiexec-banner-tab1');

    // --- typing in pane a reaches a and b (same tab) exactly once each, and not c (other tab)
    const m1 = mark();
    type(a, m1);
    await waitFor(() => count(a, m1) >= 1 && count(b, m1) >= 1, 8000, 'marker in both tab-1 panes');
    await sleep(800); // a double write would show by now
    results.markerInPaneAOnce = count(a, m1) === 1;
    results.markerInPaneBOnce = count(b, m1) === 1;
    results.markerNotInTab2 = count(c, m1) === 0;
    log('marker', m1, 'counts a/b/c', count(a, m1), count(b, m1), count(c, m1));
    await shot('61-multiexec-typed-tab1');

    // --- switching tabs: the banner follows the active tab (1 visible terminal in tab 2); typing there stays there
    app.workspace.activate(tab2);
    await sleep(200);
    results.bannerCountTab2 = !banner().hidden && bannerCount() === '1';
    await shot('62-multiexec-banner-tab2');
    const m2 = mark();
    type(c, m2);
    await waitFor(() => count(c, m2) >= 1, 8000, 'marker in tab-2 pane');
    await sleep(800);
    results.tab2MarkerOnce = count(c, m2) === 1;
    results.tab2MarkerNotInTab1 = count(a, m2) === 0 && count(b, m2) === 0;

    // --- turning it on with a single terminal visible says so, but still enables
    app.action('multiexec');
    await sleep(100);
    results.toggledOff = app.multiexec === false && banner().hidden && toasts().includes('MultiExec OFF');
    app.action('multiexec');
    await sleep(150);
    results.singleTerminalToast = toasts().includes('MultiExec ON: only 1 terminal is visible — split the tab to broadcast');
    results.singleTerminalStillOn = app.multiexec === true && !banner().hidden && bannerCount() === '1';
    await shot('63-multiexec-single-terminal-toast');

    // --- back in tab 1: an empty split pane is not counted; a pane that dies drops out; reconnecting brings it back
    app.workspace.activate(tab1);
    await sleep(200);
    results.bannerBackTo2 = bannerCount() === '2';
    await app.splitActive('down');
    await sleep(300);
    results.emptyPaneNotCounted = tab1.panes().length === 3 && bannerCount() === '2';
    const empty = tab1.panes().find((p) => p.kind === 'empty');
    await app.closePane(empty, true);
    await sleep(300);
    results.countAfterCloseEmpty = tab1.panes().length === 2 && bannerCount() === '2';
    b.write('exit 3\r'); // straight to b's shell (not a keystroke): a non-zero exit leaves the pane dead on screen
    await waitFor(() => b.dead && !b.termId, 8000, 'pane b dead');
    await sleep(200);
    results.deadPaneDropsOut = tab1.panes().includes(b) && bannerCount() === '1';
    const m3 = mark();
    type(a, m3);
    await waitFor(() => count(a, m3) >= 1, 8000, 'marker after b died');
    await sleep(500);
    results.deadPaneNotWritten = count(a, m3) === 1 && count(b, m3) === 0;
    await shot('64-multiexec-dead-pane');
    await b.reconnect();
    await prompt(b);
    results.reconnectCountsAgain = live(b) && bannerCount() === '2';

    // --- closing a live pane; font zoom (⌘=) is not a pane zoom and leaves the count alone
    await app.closePane(b, true);
    await sleep(300);
    results.countAfterClosePane = tab1.panes().length === 1 && bannerCount() === '1';
    app.action('zoom', 1);
    await sleep(100);
    results.fontZoomKeepsCount = bannerCount() === '1';
    app.action('zoom', 0);
    app.action('multiexec');
    await sleep(100);
    results.offAtEnd = !app.multiexec && banner().hidden;

    // --- tab → pane drop: an auto-titled source tab follows the pane it shows once its active pane moved out; the target takes that pane's name
    const d = await app.openSession(local, { split: 'right' }); // tab1 = a | d
    await prompt(d);
    d.updateTitle(); // the pane reports its title (as a shell's title sequence does): the tab, auto-titled, takes "local 2" from its active pane
    results.sourceTitledByActivePane = tab1.autoTitle && tab1.activePane === d && tab1.title === 'local 2';
    app.workspace.activate(tab2);
    await sleep(200);
    await app.dropOnPane(c, { tabId: tab1.id }, 'down');
    await sleep(400);
    results.tabDropMovesPane = d.tab === tab2 && tab2.panes().length === 2 && tab1.panes().length === 1 && tab1.panes()[0] === a;
    results.sourceRetitledAfterDrop = tab1.title === a.title && tab1.tabEl.querySelector('.title').textContent === a.title;
    results.targetRetitledAfterDrop = tab2.title === 'local 2' && tab2.tabEl.querySelector('.title').textContent === 'local 2';
    log('titles after tab drop: source', JSON.stringify(tab1.title), 'target', JSON.stringify(tab2.title), '(pane a:', JSON.stringify(a.title) + ')');
    await shot('65-tab-drop-titles');

    // --- placeholder cards in a split (empty pane, FTP): they start below the pane head, whose title and buttons stay reachable
    const ftpSession = await app.saveSession({ name: 'ftp-local', type: 'ftp', host: '127.0.0.1', port: 2151, username: 'user', password: 'pw' });
    await app.splitActive('right'); // next to d: tab2 = c / (d | empty)
    await sleep(300);
    const cardCheck = (pane, cardSel) => {
      const card = pane.el.querySelector(cardSel);
      const head = pane.headEl.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
      const closeBtn = pane.headEl.querySelector('button[title="Close pane"]');
      const cb = closeBtn.getBoundingClientRect();
      const hitClose = document.elementFromPoint(cb.left + cb.width / 2, cb.top + cb.height / 2);
      const hitTitle = document.elementFromPoint(head.left + 30, head.top + head.height / 2);
      log(cardSel, pane.status, 'head bottom', head.bottom.toFixed(1), 'card top', cardRect.top.toFixed(1), 'hit', hitClose && hitClose.tagName, hitTitle && hitTitle.className);
      return {
        belowHead: pane.el.classList.contains('show-head') && head.height >= 20 && cardRect.top >= head.bottom - 0.5 && cardRect.height > 60,
        headReachable: closeBtn.contains(hitClose) && !!hitTitle && hitTitle.closest('.pane-head') === pane.headEl,
      };
    };
    const emptyPane = tab2.panes().find((p) => p.kind === 'empty');
    const emptyCard = cardCheck(emptyPane, '.pane-placeholder:not(.ftp-info)');
    results.emptyCardBelowPaneHead = emptyCard.belowHead;
    results.emptyPaneHeadReachable = emptyCard.headReachable;
    await shot('66-empty-card-in-split');
    const ftpPane = await app.replacePane(emptyPane, ftpSession, true); // test/ftpd.py on 2151 → connected card; no server → failed card, same box
    await waitFor(() => ftpPane.status === 'connected' || ftpPane.status === 'failed', 10000, 'ftp card');
    await sleep(300);
    const ftpCard = cardCheck(ftpPane, '.pane-placeholder.ftp-info');
    results.ftpCardBelowPaneHead = ftpCard.belowHead;
    results.ftpPaneHeadReachable = ftpCard.headReachable;
    await shot('67-ftp-card-in-split');

    // --- nothing to broadcast to (no tab at all; a tab with only an empty card): the toast and banner say so, not "0 terminals — split the tab"
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(300);
    app.action('multiexec');
    await sleep(150);
    results.zeroNoTabToast = toasts().includes('MultiExec ON: no terminal is visible — open a session first') && !toasts().includes('only 0');
    results.zeroNoTabBanner = !banner().hidden && bannerCount() === '0' && /MultiExec is ON — no terminal is visible — open a session first/.test(banner().textContent) && !/0 visible terminal/.test(banner().textContent) && !/in this tab/.test(banner().textContent);
    await shot('68-multiexec-no-terminal');
    app.action('multiexec');
    await sleep(100);
    const e1 = await app.newLocalTab();
    await prompt(e1);
    await app.splitActive('right');
    await sleep(300);
    const onlyEmptyTab = app.workspace.active;
    await app.closePane(e1, true);
    await sleep(300);
    results.onlyEmptyPaneLeft = onlyEmptyTab.panes().length === 1 && onlyEmptyTab.panes()[0].kind === 'empty';
    app.action('multiexec');
    await sleep(150);
    results.zeroInTabToast = toasts().includes('MultiExec ON: no terminal is visible in this tab — connect a session first');
    results.zeroInTabBanner = bannerCount() === '0' && /MultiExec is ON — no terminal is visible in this tab — connect a session first/.test(banner().textContent) && getComputedStyle(document.getElementById('multiexec-count')).display === 'none';
    await shot('69-multiexec-only-empty-pane');
    app.action('multiexec');
    await sleep(100);
    results.offAfterZeroChecks = !app.multiexec && banner().hidden;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-multiexec] FAIL', e.message, e.stack);
    await shot('99-multiexec-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
