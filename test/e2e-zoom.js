// Pane zoom (⇧⌘⏎ / action 'zoom-pane'): the active pane fills its tab, the siblings stay alive but hidden, the pane
// head and the tab say so; structural changes and focusing a hidden pane restore the layout; MultiExec writes to
// the zoomed pane only; the zoom is saved with the workspace.
//   test/qa/run.sh test/e2e-zoom.js <out-dir>            (phase 1: ends with tab 1 zoomed and the workspace saved)
//   test/qa/run.sh test/e2e-zoom-verify.js <out-dir>     (phase 2, same out-dir: the restored tab is zoomed again)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-zoom]', ...a);
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
  const shown = (p) => getComputedStyle(p.el).display !== 'none' && p.el.getBoundingClientRect().width > 0;
  const fills = (p) => { // the pane's box is the tab page's box (within a pixel)
    const a = p.el.getBoundingClientRect(), b = p.tab.pageEl.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  };
  const zoomState = (tab, pane) => tab.zoomed === pane && tab.pageEl.classList.contains('zoomed') === !!pane
    && tab.panes().every((p) => p.el.classList.contains('zoomed') === (p === pane) && p.zoomBtn.getAttribute('aria-pressed') === String(p === pane) && p.zoomBadge.hidden === (p !== pane))
    && tab.tabEl.querySelector('.zoomico').hidden === !pane && tab.tabEl.classList.contains('zoomed') === !!pane;
  let seq = 0;
  const mark = () => 'ZM_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  const type = (pane, m) => pane.term.input(`echo ZM_''${m.slice(3)}\r`); // through xterm's onData, like a key press
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const tab1 = app.workspace.active;
    const a = tab1.activePane;
    await prompt(a);

    // --- a single pane: nothing to zoom, a short toast
    app.action('zoom-pane');
    await sleep(150);
    results.singlePaneToast = toasts().includes('Only one pane in this tab') && tab1.zoomed === null && !tab1.pageEl.classList.contains('zoomed');
    await shot('70-zoom-single-pane-toast');

    // --- a | b split down; zoom b (the active pane): it fills the tab, its rows grow, a is hidden but alive
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'down' });
    await prompt(b);
    results.twoPanes = tab1.panes().length === 2 && b.tab === tab1 && app.activePane() === b;
    const rowsBefore = b.term.rows, heightBefore = b.el.getBoundingClientRect().height;
    results.headButtonIsTabStop = b.zoomBtn.tabIndex === 0 && a.zoomBtn.tabIndex === 0 && b.zoomBtn.closest('.pane-head') === b.headEl;
    app.action('zoom-pane');
    await sleep(400);
    results.zoomed = zoomState(tab1, b) && app.activePane() === b;
    results.zoomedFillsTab = shown(b) && fills(b);
    results.rowsGrow = b.term.rows > rowsBefore && b.el.getBoundingClientRect().height > heightBefore + 40;
    log('rows before/after zoom', rowsBefore, b.term.rows, 'height', heightBefore.toFixed(0), b.el.getBoundingClientRect().height.toFixed(0));
    results.siblingHidden = !shown(a) && a.el.isConnected && !a.disposed && live(a);
    results.noSplitterShown = [...tab1.pageEl.querySelectorAll('.splitter')].every((s) => getComputedStyle(s).display === 'none');
    results.headZoomedState = !b.zoomBadge.hidden && b.zoomBtn.title.startsWith('Restore panes') && b.zoomBtn.querySelector('svg')?.dataset.name === 'unzoom' && a.zoomBtn.querySelector('svg')?.dataset.name === 'zoom';
    // an ARIA toggle button: the name stays "Zoom pane", only aria-pressed (and the tooltip) says it is zoomed
    results.headZoomLabelConstant = b.zoomBtn.getAttribute('aria-label') === 'Zoom pane' && b.zoomBtn.getAttribute('aria-pressed') === 'true' && a.zoomBtn.getAttribute('aria-label') === 'Zoom pane' && a.zoomBtn.getAttribute('aria-pressed') === 'false';
    await shot('71-zoomed');

    // --- the hidden pane's shell keeps running: output written while hidden is there after the restore
    const hid = mark();
    a.write(`echo ZM_''${hid.slice(3)}\r`); // straight to a's shell (a is not on screen)
    await sleep(600);

    // --- MultiExec while zoomed: 1 target (the zoomed pane), the hidden pane gets nothing; back to 2 after the restore
    app.action('multiexec');
    await sleep(150);
    results.multiexecCountZoomed = app.multiexec && !banner().hidden && bannerCount() === '1' && /keystrokes go to 1 visible terminal\(s\) in this tab \(the zoomed pane only\)/.test(banner().textContent);
    results.multiexecTargetsZoomed = app.multiexecTargets().length === 1 && app.multiexecTargets()[0] === b;
    results.multiexecZoomedToast = toasts().includes('MultiExec ON: only the zoomed pane is visible — restore the panes (⇧⌘⏎) to broadcast') && !toasts().includes('split the tab to broadcast');
    const m1 = mark();
    type(b, m1);
    await waitFor(() => count(b, m1) >= 1, 8000, 'marker in the zoomed pane');
    await sleep(800);
    results.multiexecOnlyZoomedPane = count(b, m1) === 1 && count(a, m1) === 0;
    await shot('72-zoomed-multiexec');
    app.action('zoom-pane'); // restore
    await sleep(400);
    results.unzoomed = zoomState(tab1, null) && shown(a) && shown(b) && !fills(b) && app.activePane() === b;
    results.multiexecCountRestored = bannerCount() === '2' && !/zoomed pane/.test(banner().textContent);
    results.hiddenShellRanWhileHidden = count(a, hid) === 1;
    const m2 = mark();
    type(a, m2); // typing in the pane that was hidden works as before
    await waitFor(() => count(a, m2) >= 1, 8000, 'marker in pane a after the restore');
    results.hiddenPaneTypesAfterRestore = count(a, m2) === 1;
    log('markers: hidden', count(a, hid), 'a', count(a, m2), 'b', count(b, m1));
    app.action('multiexec');
    await sleep(300); // the banner row goes back to the terminals
    results.multiexecOff = !app.multiexec && banner().hidden;
    results.rowsBack = b.term.rows === rowsBefore && Math.abs(b.el.getBoundingClientRect().height - heightBefore) < 1;
    log('rows after restore', b.term.rows, 'height', b.el.getBoundingClientRect().height.toFixed(0));
    await shot('73-restored');

    // --- the pane-head button and the Split menu toggle it too
    b.zoomBtn.click();
    await sleep(300);
    results.headButtonZooms = zoomState(tab1, b) && fills(b);
    app.action('split-menu');
    await sleep(150);
    const item = [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => /Restore Panes/.test(i.textContent));
    results.splitMenuItem = !!item && /⇧⌘⏎/.test(item.textContent) && !item.classList.contains('disabled');
    item && item.click();
    await sleep(300);
    results.splitMenuRestores = zoomState(tab1, null) && shown(a) && shown(b);
    app.action('split-menu');
    await sleep(150);
    const item2 = [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => /Zoom Pane/.test(i.textContent));
    results.splitMenuZoomItem = !!item2 && !item2.classList.contains('disabled');
    item2 && item2.click();
    await sleep(300);
    results.splitMenuZooms = zoomState(tab1, b);

    // --- switching tabs keeps each tab's zoom
    const c = await app.newLocalTab();
    const tab2 = app.workspace.active;
    await prompt(c);
    results.newTabNotZoomed = tab2 !== tab1 && tab2.zoomed === null && !tab2.pageEl.classList.contains('zoomed');
    results.otherTabKeepsZoom = tab1.zoomed === b && tab1.pageEl.classList.contains('zoomed') && !tab1.tabEl.querySelector('.zoomico').hidden;
    app.workspace.activate(tab1);
    await sleep(300);
    results.zoomKeptAfterTabSwitch = zoomState(tab1, b) && fills(b) && !shown(a) && app.activePane() === b;
    await shot('74-zoom-kept-after-tab-switch');
    // the "all tabs" menu marks the zoomed tab
    const menu = app.workspace.showTabList();
    await sleep(100);
    const rows = [...menu.querySelectorAll('.ctx-item')];
    results.tabListMarksZoomed = rows.length === 2 && !!rows[0].querySelector('.zoomico') && !rows[1].querySelector('.zoomico');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    // --- a split restores the layout first; so do ⌘] (a hidden pane gets the focus), a grid layout and closing a pane
    await app.splitActive('right');
    await sleep(300);
    const empty = tab1.panes().find((p) => p.kind === 'empty');
    results.splitUnzooms = tab1.zoomed === null && zoomState(tab1, null) && tab1.panes().length === 3 && tab1.panes().every(shown);
    await app.closePane(empty, true);
    await sleep(300);
    app.focusPane(b, true); // closing the empty pane handed the focus to the first pane (a)
    app.action('zoom-pane');
    await sleep(300);
    results.zoomAgain = zoomState(tab1, b) && app.activePane() === b;
    app.action('next-pane');
    await sleep(300);
    results.nextPaneUnzooms = zoomState(tab1, null) && app.activePane() === a && shown(a) && shown(b);
    app.action('zoom-pane'); // a zoomed now
    await sleep(300);
    results.zoomA = zoomState(tab1, a) && !shown(b);
    await app.applyLayout('2x1');
    await sleep(300);
    results.layoutUnzooms = zoomState(tab1, null) && tab1.panes().length === 2 && shown(a) && shown(b);
    app.action('zoom-pane'); // a zoomed
    await sleep(300);
    await app.closePane(b, true); // the hidden pane goes: the layout (one pane now) is back, nothing zoomed
    await sleep(300);
    results.closeHiddenPaneUnzooms = tab1.panes().length === 1 && tab1.zoomed === null && !tab1.pageEl.classList.contains('zoomed') && !a.el.classList.contains('zoomed') && a.zoomBadge.hidden && shown(a);
    results.singleAgainToast = (app.action('zoom-pane'), await sleep(150), toasts().includes('Only one pane in this tab') && tab1.zoomed === null);

    // --- workspace: the zoomed pane is saved and restored (in-process restore here; test/e2e-zoom-verify.js checks the next launch)
    const d = await app.openSession(local, { split: 'right' }); // tab1 = a | d, d active
    await prompt(d);
    app.action('zoom-pane');
    await sleep(300);
    results.zoomD = zoomState(tab1, d);
    app.saveWorkspaceNow();
    await sleep(300);
    const ws = await window.api.workspace.get();
    const t1 = ws && ws.tabs.find((t) => t.root && t.root.t === 'split');
    results.workspaceSavesZoom = !!t1 && t1.zoomed === 1 && t1.active === 1 && ws.tabs.length === 2 && ws.tabs.filter((t) => 'zoomed' in t).length === 1;
    log('saved workspace', JSON.stringify(ws));
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(100);
    clearTimeout(app._wsTimer); app._wsTimer = null; // the closes queued a save of the empty workspace: not that one
    window.api.workspace.save(ws);
    await sleep(200);
    results.restored = await app.restoreWorkspace();
    await sleep(300);
    const rt = app.workspace.tabs.find((t) => t.panes().length === 2);
    const rz = rt && rt.zoomed;
    results.restoreKeepsZoom = !!rt && !!rz && rt.panes().indexOf(rz) === 1 && rz.kind === 'local' && rz.session?.name === 'local 2' && rt.activePane === rz && zoomState(rt, rz);
    await waitFor(() => rt && rt.panes().every(live), 15000, 'restored shells');
    app.workspace.activate(rt);
    await sleep(300);
    results.restoredZoomFills = !!rz && fills(rz) && !shown(rt.panes()[0]) && app.activePane() === rz;
    await shot('75-restored-zoomed');
    app.saveWorkspaceNow(); // phase 2 (e2e-zoom-verify.js) launches on this file
    await sleep(300);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-zoom] FAIL', e.message, e.stack);
    await shot('99-zoom-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
