// Memory for test/qa/perf.js: the working set of every process (app.getAppMetrics) and the renderer heap after a
// garbage collection with the scenario's `steps` of local panes in tabs (default 0, 1, 10, 30), with ten panes on
// screen at once in one tab (ten WebGL contexts, against one for ten tabs), then a loop opening and closing a local
// tab `loop` times (default 50) with the heap and the DOM counters before and after — a leak shows as a heap, node
// or listener count that does not come back down. Each step is announced as PERF-MEMORY-STEP so the runner can
// snapshot `ps` (the shells are not Electron processes) and the whole result as PERF-MEMORY.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  const log = (...a) => console.log('[perf-memory]', ...a);
  const out = { steps: [] };
  const scene = () => ({ panes: app.workspace.allPanes().length, tabs: app.workspace.tabs.length, webgl: app.workspace.allPanes().filter((p) => p.webgl).length });
  try {
    const sc = JSON.parse(await window.api.app.testFs('readText', app.info.userData + '/perf-scenario.json'));
    await app.saveSettings({ confirmClose: false, sftpAutoOpen: false, ...(sc.settings || {}) });
    const settle = sc.settleMs || 2500;
    const measure = async (label) => {
      await sleep(settle);
      const r = await window.api.app.testPerf({ gc: true, domCounters: true, detached: true });
      const m = performance.memory;
      const step = { label, ...scene(), processes: r.processes, mainHeapUsedKB: Math.round(r.main.memory.heapUsed / 1024), mainRssKB: Math.round(r.main.memory.rss / 1024), heapUsedKB: Math.round(m.usedJSHeapSize / 1024), heapTotalKB: Math.round(m.totalJSHeapSize / 1024), dom: r.dom, detached: r.detached, attachedNodes: document.getElementsByTagName('*').length, panesByTerm: app.panesByTerm.size, paneEls: document.querySelectorAll('.pane').length, xtermEls: document.querySelectorAll('.xterm').length };
      log('PERF-MEMORY-STEP ' + JSON.stringify({ label }));
      await sleep(1500); // the runner's ps snapshot
      out.steps.push(step);
      return step;
    };
    const closeAll = async () => { for (const t of [...app.workspace.tabs]) await app.closeTab(t); };
    const tabsOf = async (n) => { await closeAll(); for (let i = 0; i < n; i++) await app.newLocalTab(); };
    for (const n of sc.steps || [0, 1, 10, 30]) {
      await tabsOf(n);
      await measure(`${n} panes in tabs`);
    }
    // the WebGL budget: ten terminals on screen at once take ten GPU contexts (one per visible pane, WEBGL_BUDGET 12)
    await closeAll();
    const local = await app.saveSession({ name: 'perf local', type: 'local' });
    await app.openSession(local);
    for (let i = 1; i < 10; i++) await app.openSession(local, { split: i % 2 ? 'right' : 'down' });
    await measure('10 panes on screen (one tab)');
    // the open / close loop
    await tabsOf(1);
    const before = await measure('before loop');
    const t0 = Date.now();
    for (let i = 0; i < (sc.loop || 50); i++) {
      const p = await app.newLocalTab();
      await sleep(sc.loopDelayMs || 150);
      await app.closeTab(p.tab);
    }
    const loopMs = Date.now() - t0;
    const after = await measure('after loop');
    out.loop = { n: sc.loop || 50, ms: loopMs, before: { heapUsedKB: before.heapUsedKB, dom: before.dom, detached: before.detached, attachedNodes: before.attachedNodes, mainHeapUsedKB: before.mainHeapUsedKB }, after: { heapUsedKB: after.heapUsedKB, dom: after.dom, detached: after.detached, attachedNodes: after.attachedNodes, mainHeapUsedKB: after.mainHeapUsedKB }, leftovers: { panesByTerm: after.panesByTerm, paneEls: after.paneEls, xtermEls: after.xtermEls } };
    log('PERF-MEMORY ' + JSON.stringify(out));
  } catch (e) {
    log('PERF-MEMORY-ERROR ' + JSON.stringify({ error: e.message, stack: e.stack }));
  }
  window.api.app.quit();
})();
