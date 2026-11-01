// Idle CPU for test/qa/perf.js. The scenario file in the user-data folder says what to show: { panes, layout: 'tabs' |
// 'splits' (every pane on screen, one WebGL context each), monitor: true for an SSH pane to the local sshd with the
// monitoring bar (keyDir: its client key), settings: a patch, seconds, profileMs }. Once the scene is up and the
// shells have settled, PERF-IDLE-READY tells the runner to sample `ps` for `seconds`; afterwards the script reads
// Chromium's own per-process CPU share for that window (test:perf), then profiles both JS threads for `profileMs`
// (where the main-thread time goes) and reports everything as PERF-IDLE.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  const log = (...a) => console.log('[perf-idle]', ...a);
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('timeout: ' + what);
  };
  const scene = () => ({ panes: app.workspace.allPanes().length, tabs: app.workspace.tabs.length, webgl: app.workspace.allPanes().filter((p) => p.webgl).length });
  try {
    const sc = JSON.parse(await window.api.app.testFs('readText', app.info.userData + '/perf-scenario.json'));
    await app.saveSettings({ confirmClose: false, sftpAutoOpen: false, ...(sc.settings || {}) });
    const want = sc.panes | 0;
    if (sc.monitor) {
      const user = app.info.home.split('/').pop();
      const s = await app.saveSession({ name: 'perf sshd', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: sc.keyDir + '/client_ed25519', sftpAuto: false, monitor: true });
      const pr = app.openSession(s);
      (await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog')).click();
      const pane = await pr;
      await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
      await waitFor(() => !pane.monitorEl.hidden && pane.monitorSample && pane.monitorSample.cpu !== null, 10000, 'monitoring bar');
      for (const t of [...app.workspace.tabs]) if (t !== pane.tab) await app.closeTab(t); // the start-up local tab: only the SSH pane stays
    } else if (want === 0) {
      for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    } else if (sc.layout === 'splits') {
      const local = await app.saveSession({ name: 'perf local', type: 'local' });
      let i = 0;
      while (app.workspace.allPanes().length < want) await app.openSession(local, { split: i++ % 2 ? 'down' : 'right' });
    } else {
      while (app.workspace.allPanes().length < want) await app.newLocalTab();
    }
    await sleep(sc.settleMs || 3000); // the shells' login files, the prompts, the first fits
    const before = await window.api.app.testPerf(); // Chromium's CPU share counts from here
    log('PERF-IDLE-READY ' + JSON.stringify(scene()));
    await sleep((sc.seconds || 60) * 1000 + 3000); // the runner's sampling window has closed before anything else runs here
    const after = await window.api.app.testPerf();
    const prof = await window.api.app.testPerf({ profile: sc.profileMs || 10000 });
    log('PERF-IDLE ' + JSON.stringify({ ...scene(), cursorBlink: app.settings.cursorBlink, processes: after.processes, profiles: prof.profiles, firstMetricsAt: before.at, metricsAt: after.at }));
  } catch (e) {
    log('PERF-IDLE-ERROR ' + JSON.stringify({ error: e.message }));
  }
  window.api.app.quit();
})();
