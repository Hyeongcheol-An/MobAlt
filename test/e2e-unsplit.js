// Unsplit (⌥⌘1 / action 'unsplit' / View → Unsplit / Split ▾ → Unsplit) and Settings → Terminal → Unsplit: 'tabs' (the
// default) moves every other pane of the tab into a tab of its own right after it — terminals, titles and status as
// they are, nothing reconnects —, 'active' closes the other panes, 'ask' puts the question each time (Cancel keeps the
// split). A tab with one pane does nothing and asks nothing; the zoom is cleared; a pinned tab's new tabs land behind
// the pinned block; the workspace restores the new tabs. Local shells only.
//   test/qa/run.sh test/e2e-unsplit.js <out-dir>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-unsplit]', ...a);
  const app = window.app;
  const ws = app.workspace;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const count = (pane, s) => text(pane).split('\n').filter((l) => l.includes(s)).length;
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const live = (p) => !!p && p.status === 'connected' && !!p.termId && !p.disposed;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(300); };
  const shown = (p) => p.el.isConnected && getComputedStyle(p.el).display !== 'none' && p.el.getBoundingClientRect().width > 0;
  const fills = (p) => { // the pane's box is the tab page's box (within a pixel)
    const a = p.el.getBoundingClientRect(), b = p.tab.pageEl.getBoundingClientRect();
    return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  };
  const modal = () => document.querySelector('#modal-root .modal');
  const modalButtons = () => modal() ? [...modal().querySelectorAll('.modal-foot button')].map((b) => b.textContent) : [];
  const clickButton = (label) => { const b = [...modal().querySelectorAll('.modal-foot button')].find((x) => x.textContent === label); b.click(); return !!b; };
  const titles = () => ws.tabs.map((t) => t.title);
  let seq = 0;
  const mark = () => 'UN_' + Math.random().toString(36).slice(2, 7).toUpperCase() + ++seq;
  const type = (pane, m) => pane.term.input(`echo UN_''${m.slice(3)}\r`); // through xterm's onData, like a key press; the typed line does not contain the marker
  const typed = async (pane) => { const m = mark(); type(pane, m); await waitFor(() => count(pane, m) >= 1, 8000, 'marker in ' + pane.title); return m; };
  // a 2×2 grid in `tab` around its single pane: the grid's empty panes are replaced by the given local sessions, so the
  // pane order is a (the pane that was there), b, c, d — row-major, as applyLayout lays it out
  const grid = async (tab, sessions) => {
    await app.applyLayout('2x2');
    const empties = tab.panes().filter((p) => p.kind === 'empty');
    const made = [];
    for (let i = 0; i < empties.length; i++) made.push(await app.replacePane(empties[i], sessions[i], true));
    for (const p of tab.panes()) await prompt(p);
    return tab.panes();
  };
  const noModal = (p) => !document.querySelector('.modal');
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => ws.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    results.defaultIsTabs = app.settings.unsplitMode === 'tabs';
    const sess = {};
    for (const [k, icon, color] of [['A', '🚀', '#e5534b'], ['B', '🐳', '#4ea1ff'], ['C', '⭐', null], ['D', null, null]]) {
      sess[k] = await app.saveSession({ name: 'local ' + k, type: 'local', ...(icon ? { icon } : {}), ...(color ? { color } : {}) });
    }
    const tab0 = ws.active; // the first local tab stays as it is through the run
    await prompt(tab0.activePane);

    // --- the View menu says "Unsplit"; the Split menu entry too (disabled for a single pane)
    const menus = await window.api.app.testMenuLabels();
    const view = menus.find((m) => m.label === 'View');
    results.viewMenuLabel = !!view && view.submenu.some((i) => i.label === 'Unsplit') && !view.submenu.some((i) => /keep active pane/i.test(i.label || ''));
    app.action('split-menu');
    await sleep(150);
    const item1 = [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => /^Unsplit/.test(i.textContent));
    results.splitMenuItemSingle = !!item1 && /⌥⌘1/.test(item1.textContent) && item1.classList.contains('disabled') && !/keep active pane/.test(item1.textContent);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    // --- a single pane: nothing happens, in 'tabs' mode and in 'ask' mode (no question)
    await app.unsplit();
    await sleep(150);
    results.singlePaneTabsNoop = ws.tabs.length === 1 && tab0.panes().length === 1 && noModal();
    await app.saveSettings({ unsplitMode: 'ask' });
    app.action('unsplit');
    await sleep(300);
    results.singlePaneAskNoDialog = noModal() && ws.tabs.length === 1;
    await app.saveSettings({ unsplitMode: 'tabs' });

    // ---------- 'tabs': a 2×2 grid around session A, b active → b keeps the tab, a / c / d become the next three tabs
    const pa = await app.openSession(sess.A);
    const tab1 = ws.active;
    await prompt(pa);
    const [a, b, c, d] = await grid(tab1, [sess.B, sess.C, sess.D]);
    results.gridBuilt = tab1.panes().length === 4 && a === pa && [a, b, c, d].every(live) && tab1.title === 'local A' && tab1.icon === '🚀';
    const marks = {};
    for (const p of [a, b, c, d]) marks[p.id] = await typed(p);
    await sleep(300);
    const ids = Object.fromEntries([a, b, c, d].map((p) => [p.id, p.termId]));
    const paneTitles = Object.fromEntries([a, b, c, d].map((p) => [p.id, p.title]));
    app.focusPane(b, true);
    await sleep(100);
    results.bActive = app.activePane() === b && ws.active === tab1 && ws.tabs.length === 2;
    await shot('80-unsplit-grid-before');
    const made = await app.unsplit(); // Settings: 'tabs'
    await sleep(400);
    results.tabsMade = Array.isArray(made) && made.length === 3 && ws.tabs.length === 5;
    results.activePaneKeepsTab = tab1.panes().length === 1 && tab1.panes()[0] === b && tab1.activePane === b && b.tab === tab1 && ws.active === tab1;
    results.activeTabStaysFirst = ws.tabs[1] === tab1 && ws.tabs[0] === tab0; // right where it was: after tab0
    results.newTabsInPaneOrder = ws.tabs.slice(2).map((t) => t.panes()[0]).every((p, i) => p === [a, c, d][i]) && ws.tabs.slice(2).every((t, i) => t === made[i]);
    results.newTabsOnePaneEach = made.every((t) => t.panes().length === 1 && t.root.type === 'pane' && t.activePane === t.panes()[0] && t.panes()[0].tab === t);
    results.stripFollowsTabs = [...ws.tabsEl.querySelectorAll('.tab')].map((el) => el.dataset.tab).join() === ws.tabs.map((t) => t.id).join();
    results.titlesKept = tab1.title === 'local B' && tab1.icon === '🐳' && made.map((t) => t.title).join('|') === 'local A|local C|local D' && [a, b, c, d].every((p) => p.title === paneTitles[p.id]);
    results.sessionLooksTravel = made[0].icon === '🚀' && made[0].color === '#e5534b' && made[1].icon === '⭐' && made[1].color === null && made[2].icon === null;
    results.tabElsTitled = made.every((t) => t.tabEl.querySelector('.title').textContent === t.title && t.tabEl.isConnected && t.pageEl.isConnected);
    results.noReconnect = [a, b, c, d].every((p) => live(p) && p.termId === ids[p.id] && app.panesByTerm.get(p.termId) === p);
    results.buffersKept = [a, b, c, d].every((p) => count(p, marks[p.id]) === 1);
    results.focusOnActivePane = app.activePane() === b && b.el.contains(document.activeElement) && b.el.classList.contains('focused');
    results.zoomCleared = tab1.zoomed === null && !tab1.pageEl.classList.contains('zoomed') && [a, b, c, d].every((p) => !p.zoomed && !p.el.classList.contains('zoomed'));
    results.keptPaneFillsTab = shown(b) && fills(b) && !b.el.classList.contains('show-head');
    results.multiexecSetIsOnePane = app.multiexecTargets().length === 1 && app.multiexecTargets()[0] === b;
    results.menuStateFollows = (await window.api.app.testMenuState())['tab-close-right'] === true;
    log('tabs after unsplit', JSON.stringify(titles()));
    await shot('81-unsplit-tabs-after');
    // the moved panes work in their tabs: shown, fitted to the page, their shells answer
    let movedOk = true;
    for (const t of made) {
      ws.activate(t);
      await sleep(300);
      const p = t.panes()[0];
      const m = await typed(p);
      movedOk = movedOk && shown(p) && fills(p) && app.activePane() === p && p.term.cols > 20 && p.term.rows > 5 && count(p, m) === 1 && !p.el.classList.contains('show-head');
    }
    results.movedPanesWork = movedOk;
    await shot('82-unsplit-moved-tab-active');
    // the workspace file lists the new tabs as single-pane tabs of their sessions
    app.saveWorkspaceNow();
    await sleep(200);
    const saved = await window.api.workspace.get();
    results.workspaceLists = saved.tabs.length === 5 && saved.tabs.slice(2).every((t) => t.root.t === 'pane') && saved.tabs.slice(2).map((t) => t.root.sessionId).join() === [sess.A, sess.C, sess.D].map((s) => s.id).join();
    ws.activate(tab1);
    await sleep(200);

    // ---------- 'active': the other panes close
    await app.saveSettings({ unsplitMode: 'active' });
    const panes2 = await grid(tab1, [sess.A, sess.C, sess.D]);
    const marks2 = {};
    for (const p of panes2) marks2[p.id] = await typed(p);
    app.focusPane(panes2[2], true); // c2
    await sleep(100);
    const n2 = ws.tabs.length;
    await app.unsplit();
    await sleep(400);
    results.activeKeepsOne = tab1.panes().length === 1 && tab1.panes()[0] === panes2[2] && app.activePane() === panes2[2] && live(panes2[2]) && count(panes2[2], marks2[panes2[2].id]) === 1;
    results.activeClosesOthers = panes2.filter((p) => p !== panes2[2]).every((p) => p.disposed && !p.el.isConnected) && ws.tabs.length === n2 && noModal();
    await shot('83-unsplit-active-after');

    // ---------- 'ask': the question; Cancel and Esc keep the split; "Move panes to tabs" works as 'tabs'; "Keep only this pane" as 'active'
    await app.saveSettings({ unsplitMode: 'ask' });
    const panes3 = await grid(tab1, [sess.A, sess.B, sess.D]);
    app.focusPane(panes3[1], true);
    await sleep(100);
    let pending = app.action('unsplit');
    await waitFor(modal, 3000, 'unsplit dialog');
    results.askDialog = modal().getAttribute('aria-label') === 'Unsplit this tab' && modalButtons().join('|') === 'Cancel|Keep only this pane|Move panes to tabs' && /3 other panes/.test(modal().querySelector('.modal-body').textContent);
    results.askPrimaryIsTabs = modal().querySelector('.modal-foot button.primary')?.textContent === 'Move panes to tabs';
    await shot('84-unsplit-ask-dialog');
    clickButton('Cancel');
    await pending;
    await sleep(200);
    results.askCancelKeepsSplit = noModal() && tab1.panes().length === 4 && ws.tabs.length === n2 && app.activePane() === panes3[1];
    pending = app.action('unsplit');
    await waitFor(modal, 3000, 'unsplit dialog again');
    (document.activeElement || modal()).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pending;
    await sleep(200);
    results.askEscKeepsSplit = noModal() && tab1.panes().length === 4 && ws.tabs.length === n2;
    pending = app.action('unsplit');
    await waitFor(modal, 3000, 'unsplit dialog (move)');
    clickButton('Move panes to tabs');
    const made3 = await pending;
    await sleep(400);
    results.askMoveMakesTabs = noModal() && Array.isArray(made3) && made3.length === 3 && ws.tabs.length === n2 + 3 && tab1.panes().length === 1 && tab1.panes()[0] === panes3[1]
      && ws.tabs.slice(ws.tabs.indexOf(tab1) + 1, ws.tabs.indexOf(tab1) + 4).every((t, i) => t === made3[i] && t.panes()[0] === [panes3[0], panes3[2], panes3[3]][i]) && panes3.every(live);
    await app.splitActive('down'); // tab1 = b | empty
    await sleep(300);
    const extra = tab1.panes().find((p) => p.kind === 'empty');
    app.focusPane(panes3[1], true);
    pending = app.action('unsplit');
    await waitFor(modal, 3000, 'unsplit dialog (keep)');
    results.askSingularText = /The other pane can become a tab/.test(modal().querySelector('.modal-body').textContent);
    clickButton('Keep only this pane');
    await pending;
    await sleep(300);
    results.askKeepCloses = noModal() && tab1.panes().length === 1 && tab1.panes()[0] === panes3[1] && extra.disposed && ws.tabs.length === n2 + 3;
    await app.saveSettings({ unsplitMode: 'tabs' });

    // ---------- the Split menu entry follows the setting; an explicit mode overrides it
    await app.splitActive('right');
    await sleep(300);
    const extra2 = tab1.panes().find((p) => p.kind === 'empty');
    app.focusPane(panes3[1], true);
    app.action('split-menu');
    await sleep(150);
    const item2 = [...document.querySelectorAll('#ctx-root .ctx-item')].find((i) => /^Unsplit/.test(i.textContent));
    results.splitMenuItemEnabled = !!item2 && !item2.classList.contains('disabled');
    item2 && item2.click();
    await sleep(400);
    results.splitMenuFollowsSetting = tab1.panes().length === 1 && !extra2.disposed && extra2.tab && extra2.tab !== tab1 && ws.tabs.includes(extra2.tab) && extra2.tab.title === 'Empty';
    await app.closeTab(extra2.tab);
    await app.splitActive('right');
    await sleep(300);
    const extra3 = tab1.panes().find((p) => p.kind === 'empty');
    app.focusPane(panes3[1], true);
    const before3 = ws.tabs.length;
    await app.action('unsplit', 'active'); // the explicit verb wins over the setting ('tabs')
    await sleep(300);
    results.explicitModeWins = tab1.panes().length === 1 && extra3.disposed && ws.tabs.length === before3;

    // ---------- a pinned tab: it stays pinned and first; the new tabs are unpinned, right behind the pinned block, in pane order
    for (const t of ws.tabs.filter((t) => t !== tab0 && t !== tab1)) await app.closeTab(t);
    await sleep(200);
    ws.activate(tab1);
    app.togglePin(tab1); // tab1 → index 0
    app.togglePin(tab0); // the pinned block: tab1, tab0
    await sleep(100);
    results.pinnedSetup = ws.tabs[0] === tab1 && ws.tabs[1] === tab0 && ws.pinnedCount() === 2 && ws.active === tab1;
    const panes4 = await grid(tab1, [sess.A, sess.C, sess.D]);
    app.focusPane(panes4[0], true); // the first pane keeps the tab this time
    await sleep(100);
    await shot('85-unsplit-pinned-before');
    const made4 = await app.unsplit();
    await sleep(400);
    results.pinnedStays = tab1.pinned && ws.tabs[0] === tab1 && ws.tabs[1] === tab0 && ws.pinnedCount() === 2 && tab1.tabEl.classList.contains('pinned');
    results.pinnedNewTabsBehindBlock = made4.length === 3 && made4.every((t, i) => ws.tabs[2 + i] === t && !t.pinned) && made4.map((t) => t.panes()[0]).every((p, i) => p === panes4[1 + i]);
    results.pinnedKeptPane = tab1.panes().length === 1 && tab1.panes()[0] === panes4[0] && app.activePane() === panes4[0];
    await shot('86-unsplit-pinned-after');
    for (const t of made4) await app.closeTab(t);
    app.togglePin(tab0);
    app.togglePin(tab1);
    await sleep(100);
    ws.moveTab(tab0, 0);
    results.unpinnedBack = ws.pinnedCount() === 0 && ws.tabs[0] === tab0 && ws.tabs[1] === tab1;

    // ---------- a zoomed pane: unsplit clears the zoom, the kept pane fills the tab, the moved panes are shown in theirs
    const panes5 = await grid(tab1, [sess.A, sess.C, sess.D]);
    app.focusPane(panes5[2], true);
    app.action('zoom-pane');
    await sleep(300);
    results.zoomedSetup = tab1.zoomed === panes5[2] && tab1.pageEl.classList.contains('zoomed') && !shown(panes5[0]);
    await shot('87-unsplit-zoomed-before');
    const made5 = await app.unsplit();
    await sleep(400);
    results.zoomedUnsplit = made5.length === 3 && tab1.zoomed === null && !tab1.pageEl.classList.contains('zoomed') && tab1.tabEl.querySelector('.zoomico').hidden
      && panes5.every((p) => !p.zoomed && !p.el.classList.contains('zoomed') && p.zoomBadge.hidden && p.zoomBtn.getAttribute('aria-pressed') === 'false')
      && tab1.panes()[0] === panes5[2] && shown(panes5[2]) && fills(panes5[2]);
    let movedShown = true;
    for (const t of made5) {
      ws.activate(t);
      await sleep(250);
      const p = t.panes()[0];
      movedShown = movedShown && shown(p) && fills(p) && !t.pageEl.classList.contains('zoomed') && t.zoomed === null;
    }
    results.zoomedMovedPanesShown = movedShown;
    ws.activate(tab1);
    await sleep(200);
    await shot('88-unsplit-zoomed-after');

    // ---------- Settings → Terminal: the Unsplit row (after Mouse / keys), its three options, round trip through Save; every tab still fits 900×560
    const size0 = { w: window.outerWidth, h: window.outerHeight };
    await window.api.app.testResize(900, 560);
    await sleep(300);
    app.action('settings');
    await sleep(400);
    const m = modal(), body = m.querySelector('.modal-body');
    const tabsBtns = [...m.querySelectorAll('.mtabs button')];
    const unsplitSel = m.querySelector('select[aria-label="Unsplit"]');
    const rowLabel = [...m.querySelectorAll('.form-grid > label')].find((l) => l.textContent === 'Unsplit');
    tabsBtns[1].click(); // Terminal
    await sleep(80);
    results.settingsRow = !!unsplitSel && !!rowLabel && rowLabel.nextElementSibling === unsplitSel && m.querySelector('.mpage.active').contains(unsplitSel) && tabsBtns[1].classList.contains('active')
      && [...unsplitSel.options].map((o) => o.value + '=' + o.textContent).join('|') === 'tabs=Move the other panes to tabs of their own|active=Keep the active pane, close the others|ask=Ask every time'
      && unsplitSel.value === 'tabs' && /⌥⌘1 on a split tab/.test(unsplitSel.title) && rowLabel.previousElementSibling?.classList.contains('checks'); // the last row, after Mouse / keys
    const heights = new Set(), fit = {};
    for (const b of tabsBtns) {
      b.click();
      await sleep(80);
      heights.add(Math.round(m.getBoundingClientRect().height));
      fit[b.textContent] = body.scrollHeight <= body.clientHeight && body.scrollWidth <= body.clientWidth && m.getBoundingClientRect().bottom <= window.innerHeight;
    }
    log('settings fit at 900×560', JSON.stringify(fit), 'heights', [...heights].join(','));
    results.settingsTabsFit900x560 = Object.keys(fit).length === 5 && Object.values(fit).every(Boolean) && heights.size === 1;
    tabsBtns[1].click();
    await sleep(80);
    await shot('89-unsplit-settings-terminal-900x560');
    unsplitSel.value = 'ask';
    m.querySelector('.modal-foot .btn.primary').click(); // Save
    await sleep(400);
    results.settingsSaves = noModal() && app.settings.unsplitMode === 'ask';
    app.action('settings');
    await sleep(400);
    results.settingsShowsSaved = modal().querySelector('select[aria-label="Unsplit"]').value === 'ask';
    modal().querySelector('.modal-foot .btn').click(); // Cancel
    await sleep(200);
    await app.saveSettings({ unsplitMode: 'tabs' });
    await window.api.app.testResize(size0.w, size0.h);
    await sleep(300);

    // ---------- workspace: the tabs the unsplit made come back from the file (in-process restore of the saved layout)
    app.saveWorkspaceNow();
    await sleep(200);
    const ws1 = await window.api.workspace.get();
    const want = titles();
    for (const t of [...ws.tabs]) await app.closeTab(t);
    await sleep(100);
    clearTimeout(app._wsTimer); app._wsTimer = null; // the closes queued a save of the empty workspace: not that one
    window.api.workspace.save(ws1);
    await sleep(200);
    results.restored = await app.restoreWorkspace();
    await sleep(300);
    results.restoredTabs = ws.tabs.length === want.length && ws.tabs.every((t) => t.panes().length === 1);
    log('restored', JSON.stringify(titles()), 'wanted', JSON.stringify(want));
    await waitFor(() => ws.tabs.every((t) => t.panes().every(live)), 20000, 'restored shells');
    results.restoredTitles = titles().join('|') === want.join('|');
    await shot('90-unsplit-restored');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-unsplit] FAIL', e.message, e.stack);
    await shot('99-unsplit-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
