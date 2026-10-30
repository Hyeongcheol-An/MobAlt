// Phase 2 of the workspace-restore E2E: a fresh launch with the same MOBALT_USER_DATA
// must bring back the tabs, split layout, titles, icons and reconnect the SSH pane.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 20000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + what);
  };
  const log = (...a) => console.log('[e2e-ws2]', ...a);
  const app = window.app;
  const results = {};
  try {
    const tab = await waitFor(() => app.workspace.tabs.find((t) => t.title === 'WS-TAB'), 10000, 'restored tab');
    results.tabRestored = true;
    results.tabCount = app.workspace.tabs.length;
    const panes = tab.panes();
    results.layout = tab.root.type === 'split' && tab.root.dir === 'h' && panes.length === 2;
    results.ratio = Math.abs(tab.root.ratio - 0.3) < 0.01;
    const sshPane = panes.find((p) => p.kind === 'ssh');
    const localPane = panes.find((p) => p.kind === 'local');
    results.kinds = !!sshPane && !!localPane;
    results.sessionRef = sshPane?.session?.name === 'ws-sshd' && sshPane?.session?.icon === '🚀';
    results.paneIcon = !!sshPane?.el.querySelector('.pane-head .picon');
    await waitFor(() => sshPane.status === 'connected', 20000, 'ssh reconnected');
    results.reconnected = true;
    await waitFor(() => localPane.termId, 10000, 'local shell');
    results.localStarted = true;
    await window.api.app.screenshot('ws-restored');
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-ws2] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
  }
  await sleep(300);
  window.api.app.quit();
})();
