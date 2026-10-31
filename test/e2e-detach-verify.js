// Phase 2 of test/e2e-detach.js: a fresh launch on the same user data brings the detached window back as a window,
// its split tab started afresh (two live local shells), while the main window restores its own tab.
//   test/qa/run.sh test/e2e-detach-verify.js <same out-dir as e2e-detach.js>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[e2e-detach2]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(150);
    }
    throw new Error('timeout: ' + what);
  };
  const windows = () => window.api.app.testWindows();
  const ev = (id, code) => window.api.app.testEval(id, code);
  const quiet = (fn) => fn().catch(() => false);
  try {
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1, 10000, 'main window tab');
    results.mainHasItsOwnTab = app.workspace.tabs.length === 1 && app.workspace.tabs[0].title !== 'DETACH-ME';
    let dw = null;
    await waitFor(async () => (dw = (await windows()).find((w) => w.detached) || null), 15000, 'detached window restored');
    results.detachedWindowRestored = !!dw && (await windows()).length === 2;
    await waitFor(() => quiet(() => ev(dw.id, `(() => { const a = window.app; const t = a && a.workspace && a.workspace.tabs[0]; return !!t && a.workspace.tabs.length === 1 && t.title === 'DETACH-ME' && t.panes().length === 2 && t.panes().every((p) => p.kind === 'local' && p.status === 'connected' && p.termId); })()`)), 20000, 'restored split tab with two live shells');
    results.restoredSplitTabLive = true;
    results.restoredChrome = await ev(dw.id, `window.app.detached === true && document.body.classList.contains('detached') && document.title.startsWith('DETACH-ME')`);
    await waitFor(() => app.workspace.allPanes().every((p) => p.status === 'connected' && p.termId), 15000, 'main shell');
    results.mainShellLive = true;
    await sleep(300);
    await ev(dw.id, `window.api.app.screenshot('83-detached-restored')`);
    await window.api.app.screenshot('83-main-restored');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-detach2] FAIL', e.message, e.stack);
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
