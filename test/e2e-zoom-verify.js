// Phase 2 of test/e2e-zoom.js: a fresh launch on the same user data brings the split tab back with its pane zoomed.
//   test/qa/run.sh test/e2e-zoom-verify.js <same out-dir as e2e-zoom.js>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[e2e-zoom2]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const shown = (p) => getComputedStyle(p.el).display !== 'none' && p.el.getBoundingClientRect().width > 0;
  try {
    const tab = await waitFor(() => app.workspace && app.workspace.tabs.find((t) => t.panes().length === 2), 10000, 'restored split tab');
    const panes = tab.panes();
    results.tabRestored = app.workspace.tabs.length === 2 && tab.root.type === 'split';
    results.zoomRestored = tab.zoomed === panes[1] && tab.activePane === panes[1] && tab.pageEl.classList.contains('zoomed');
    results.headAndTabMarked = panes[1].el.classList.contains('zoomed') && !panes[1].zoomBadge.hidden && panes[1].zoomBtn.getAttribute('aria-pressed') === 'true' && !tab.tabEl.querySelector('.zoomico').hidden;
    await waitFor(() => panes.every((p) => p.status === 'connected' && p.termId), 15000, 'restored shells');
    app.workspace.activate(tab);
    await sleep(300);
    const a = panes[1].el.getBoundingClientRect(), b = tab.pageEl.getBoundingClientRect();
    results.zoomedFillsTab = shown(panes[1]) && !shown(panes[0]) && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    results.siblingAlive = !panes[0].disposed && panes[0].status === 'connected';
    await window.api.app.screenshot('76-zoom-restored-next-launch');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-zoom2] FAIL', e.message, e.stack);
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
