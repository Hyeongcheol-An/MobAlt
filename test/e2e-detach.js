// A tab moved into a window of its own (tab menu → Detach to New Window, ⌥⌘N, action 'detach-tab'): the new window
// attaches to the same live terminal and draws the replayed output, typing goes on there, MultiExec stays per
// window, the workspace file lists the window; closing the detached window brings the tab back to the main window
// with its terminal still alive; a split tab moves with both panes. The script runs in the main window and drives
// the detached one through window.api.app.testEval (test/qa/README.md).
//   test/qa/run.sh test/e2e-detach.js <out-dir>            (phase 1: ends with a split tab in a detached window, saved)
//   test/qa/run.sh test/e2e-detach-verify.js <out-dir>     (phase 2, same out-dir: that window comes back on launch)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-detach]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const count = (pane, s) => text(pane).split('\n').filter((l) => l.includes(s)).length;
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(150);
    }
    throw new Error('timeout: ' + what);
  };
  const toasts = () => document.getElementById('toast-root').textContent;
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  let seq = 0;
  const mark = () => 'DT_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  const echo = (m) => `echo DT_''${m.slice(3)}\r`; // the marker never appears in the command line itself
  const type = (pane, m) => pane.term.input(echo(m));
  // the other window(s)
  const windows = () => window.api.app.testWindows();
  const detachedWin = async () => (await windows()).find((w) => w.detached) || null;
  const ev = (id, code) => window.api.app.testEval(id, code);
  const evText = (id) => ev(id, `(() => { const p = window.app && window.app.workspace && window.app.activePane(); if (!p) return ''; const b = p.term.buffer.active; return [...Array(b.length)].map((_, i) => b.getLine(i)?.translateToString(true)).join('\\n'); })()`);
  const evCount = async (id, m) => (await evText(id)).split('\n').filter((l) => l.includes(m)).length;
  const waitWindow = async (what) => { let dw = null; await waitFor(async () => (dw = await detachedWin()), 15000, what); return dw; };
  const quiet = (fn) => fn().catch(() => false);
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const a = app.activePane(), tab1 = a.tab;
    await prompt(a);
    // output before the detach must show up in the new window (replayed from main's ring buffer)
    const m1 = mark();
    type(a, m1);
    await waitFor(() => count(a, m1) >= 1, 8000, 'marker 1');
    tab1.title = 'DETACH-ME';
    tab1.autoTitle = false;
    app.workspace.updateTab(tab1);
    const termId = a.termId;
    const b = await app.newLocalTab();
    await prompt(b);
    app.workspace.activate(tab1);
    results.twoTabsBefore = app.workspace.tabs.length === 2 && app.workspace.active === tab1 && (await windows()).length === 1;
    // the tab menu offers it
    app.workspace.tabMenu(tab1, 100, 100);
    await sleep(100);
    const item = [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => /^Detach to New Window/.test(i.textContent));
    results.menuHasDetach = !!item && /⌥⌘N/.test(item.textContent) && !item.classList.contains('disabled');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    // ---- detach: the tab leaves this window, its terminal is not ended, a second window shows it
    await app.action('detach-tab');
    await waitFor(() => app.workspace.tabs.length === 1, 3000, 'tab left the main window');
    results.mainKeepsOtherTab = app.workspace.tabs.length === 1 && app.workspace.active === b.tab && !app.panesByTerm.has(termId) && a.disposed === true && a.released === true;
    let dw = await waitWindow('detached window');
    results.windowOpened = !!dw && (await windows()).length === 2 && !dw.main;
    const attached = (id) => quiet(() => ev(id, `!!(window.app && window.app.workspace && window.app.activePane() && window.app.activePane().termId === ${JSON.stringify(termId)} && window.app.activePane().status === 'connected')`));
    await waitFor(() => attached(dw.id), 15000, 'the new window attached the terminal');
    results.attachedSameTerminal = true;
    await waitFor(async () => (await evCount(dw.id, m1)) >= 1, 5000, 'replayed marker in the new window');
    results.replayShowsMarker = true;
    results.detachedTitle = await ev(dw.id, `window.app.workspace.active.title === 'DETACH-ME' && document.title.startsWith('DETACH-ME')`);
    results.detachedChrome = await ev(dw.id, `document.body.classList.contains('detached') && document.getElementById('sidebar').classList.contains('collapsed') && window.app.detached === true`);
    results.detachedOnlyThatTab = (await ev(dw.id, `window.app.workspace.tabs.length`)) === 1;
    results.detachedWindowBounds = dw.bounds.width >= 900 && dw.bounds.height >= 560;
    await sleep(300);
    await ev(dw.id, `window.api.app.screenshot('80-detached-window')`);
    await shot('80-main-after-detach');

    // ---- live typing in the detached window: the shell answers there, nothing lands here
    const m2 = mark();
    await ev(dw.id, `window.app.activePane().term.input(${JSON.stringify(echo(m2))})`);
    await waitFor(async () => (await evCount(dw.id, m2)) >= 1, 8000, 'typed marker in the detached window');
    await sleep(300);
    results.liveTypingInDetached = (await evCount(dw.id, m2)) === 1;
    results.mainGotNothing = count(b, m2) === 0;
    // the detached window's sidebar comes back with ⌘B there, without touching the main window's setting
    await ev(dw.id, `window.app.toggleSidebar()`);
    await sleep(100);
    results.detachedSidebarToggles = (await ev(dw.id, `!document.getElementById('sidebar').classList.contains('collapsed')`)) && app.settings.sidebarVisible === true;
    await ev(dw.id, `window.app.toggleSidebar()`);
    // MultiExec is per window: on here, off there
    app.action('multiexec');
    await sleep(150);
    results.multiexecPerWindow = app.multiexec === true && !(await ev(dw.id, `window.app.multiexec || !document.getElementById('multiexec-banner').hidden`));
    app.action('multiexec');
    await sleep(150);
    // the workspace file lists the window with its tab and bounds
    app.saveWorkspaceNow();
    await ev(dw.id, `window.app.saveWorkspaceNow()`);
    await sleep(500);
    const ws = await window.api.workspace.get();
    results.workspaceListsWindow = ws.tabs.length === 1 && Array.isArray(ws.windows) && ws.windows.length === 1 && ws.windows[0].tabs.length === 1 && ws.windows[0].tabs[0].title === 'DETACH-ME' && !!ws.windows[0].bounds && !('termId' in ws.windows[0].tabs[0].root);
    log('workspace with a window', JSON.stringify(ws));

    // ---- closing the detached window hands the tab back: same terminal, both markers redrawn, typing works again
    await window.api.app.testCloseWindow(dw.id);
    await waitFor(() => app.workspace.tabs.length === 2, 10000, 'tab came back');
    const back = app.workspace.tabs.find((t) => t.title === 'DETACH-ME');
    const bp = back && back.panes()[0];
    await waitFor(() => bp && bp.termId === termId && bp.status === 'connected', 10000, 'terminal re-attached in the main window');
    await waitFor(async () => (await windows()).length === 1, 10000, 'detached window gone');
    results.windowGone = true;
    results.tabBackSameTerminal = !!bp && bp.termId === termId && !bp.dead && app.workspace.active === back && app.panesByTerm.get(termId) === bp;
    results.replayOnReturn = count(bp, m1) >= 1 && count(bp, m2) >= 1;
    const m3 = mark();
    type(bp, m3);
    await waitFor(() => count(bp, m3) >= 1, 8000, 'marker 3 after the return');
    results.typingAfterReturn = count(bp, m3) === 1;
    results.returnToast = toasts().includes('1 tab back from the closed window');
    await shot('81-tab-back-in-main');
    app.saveWorkspaceNow();
    await sleep(500);
    const ws2 = await window.api.workspace.get();
    results.workspaceWindowDropped = ws2.tabs.length === 2 && (!ws2.windows || ws2.windows.length === 0);

    // ---- a split tab moves with both panes (and phase 2 launches on this workspace: the window comes back)
    await app.splitActive('right', bp);
    const e = app.activePane();
    await e.becomeLocal();
    await waitFor(() => e.kind === 'local' && live(e), 10000, 'local pane in the split');
    await prompt(e);
    const ids = back.panes().map((p) => p.termId);
    results.splitReady = back.panes().length === 2 && ids.every(Boolean);
    app.workspace.activate(back);
    await app.action('detach-tab');
    dw = await waitWindow('second detached window');
    await waitFor(() => quiet(() => ev(dw.id, `(() => { const t = window.app && window.app.workspace && window.app.workspace.active; return !!t && t.panes().length === 2 && t.panes().map((p) => p.termId).join() === ${JSON.stringify(ids.join())} && t.panes().every((p) => p.status === 'connected'); })()`)), 15000, 'both panes attached');
    results.splitTabDetached = true;
    results.mainOneTabAgain = app.workspace.tabs.length === 1 && app.workspace.tabs[0] === b.tab;
    await sleep(300);
    await ev(dw.id, `window.api.app.screenshot('82-detached-split')`);
    app.saveWorkspaceNow();
    await ev(dw.id, `window.app.saveWorkspaceNow()`);
    await sleep(500);
    const ws3 = await window.api.workspace.get();
    results.workspaceSavedForVerify = ws3.tabs.length === 1 && ws3.windows.length === 1 && ws3.windows[0].tabs.length === 1 && ws3.windows[0].tabs[0].root.t === 'split';
    log('workspace for phase 2', JSON.stringify(ws3));
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-detach] FAIL', e.message, e.stack);
    await shot('99-detach-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
