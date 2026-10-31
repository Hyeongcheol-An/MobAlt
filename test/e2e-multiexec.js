// MultiExec scope: keystrokes go only to the live terminals visible in the active tab, never to other tabs,
// and the banner count follows tab switches, splits, closes, deaths and reconnects.
//   test/qa/run.sh test/e2e-multiexec.js <out-dir>
// (There is no pane zoom/maximize feature — "zoom" is the font size — so "visible" is every pane of the active tab.)
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
