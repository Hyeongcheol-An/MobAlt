// Phase 2 of test/e2e-browser.js (same out-dir): the browser tab the first phase left at /b comes back from the
// workspace file at that page — not at the session's start page — titled after it, with its session.
//   test/qa/run.sh test/e2e-browser-verify.js <out-dir>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[e2e-browser-verify]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  try {
    await waitFor(() => app.workspace && app.workspace.allPanes().some((p) => p.kind === 'browser'), 15000, 'restored browser pane');
    const p = app.workspace.allPanes().find((x) => x.kind === 'browser');
    results.restored = p.url === 'http://127.0.0.1:42510/b' && p.session?.type === 'browser' && p.session.url === 'http://127.0.0.1:42510/';
    await waitFor(() => p.status === 'connected' && !p.loading, 15000, 'loaded');
    await waitFor(() => p.title === 'Page B', 5000, 'title');
    results.restoredAtLastUrl = p.url === 'http://127.0.0.1:42510/b' && p.urlEl.value === 'http://127.0.0.1:42510/b' && p.tab.title === 'Page B';
    results.restoredSessionKept = p.session?.name === 'Local web' && !!app.sessions.sessions.find((s) => s.id === p.session.id);
    results.restoredShown = app.workspace.active === p.tab && !p.webview.classList.contains('off');
    await sleep(200);
    await window.api.app.screenshot('b8-restored');
  } catch (e) {
    results.error = e.message;
    log('ERROR', e.stack || e.message);
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log(failed.length ? 'FAILED ' + failed.join(', ') : 'ALL OK');
  window.api.app.quit();
})();
