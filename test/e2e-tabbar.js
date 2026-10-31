// Tab strip overflow (arrows, fades, "all tabs" menu), plain-text session logs, theme kept across splits,
// the empty workspace still offering "+" / ⌘T, and the tab menu's pin / close-left / close-right (section 5,
// whose confirm-count checks open two SSH tabs on the local sshd: test/start-sshd.sh start).
//   test/qa/run.sh test/e2e-tabbar.js <out-dir>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-tabbar]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const $ = (s) => document.querySelector(s);
  const bar = $('#tabbar'), tabs = $('#tabs'), left = $('#tab-scroll-left'), right = $('#tab-scroll-right'), list = $('#tab-list'), add = $('#tab-add');
  const fully = (el) => { const r = el.getBoundingClientRect(), b = tabs.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; };
  const bg = (p) => p.term.options.theme.background;
  const termBg = (p) => getComputedStyle(p.el).getPropertyValue('--term-bg').trim();
  try {
    await app.saveSettings({ confirmClose: false });
    await window.api.app.testResize(1100, 700);
    await sleep(400);

    // ---------- 1. overflow affordance ----------
    const tabsLeft0 = tabs.getBoundingClientRect().left, barH0 = bar.getBoundingClientRect().height;
    results.arrowsHiddenWhenFits = left.hidden && right.hidden && !bar.classList.contains('ovf-left') && !bar.classList.contains('ovf-right');
    results.listShownWithTabs = !list.hidden;
    while (app.workspace.tabs.length < 15) await app.newLocalTab();
    await sleep(800);
    results.fifteenTabs = app.workspace.tabs.length === 15;
    results.arrowsShown = !left.hidden && !right.hidden;
    // the active (last) tab is scrolled into view → at the end: ‹ enabled, › disabled, fade only on the left
    await waitFor(() => right.disabled && !left.disabled, 2000, 'arrows at the end');
    results.arrowsAtEnd = true;
    results.fadeAtEnd = bar.classList.contains('ovf-left') && !bar.classList.contains('ovf-right');
    results.activeTabVisible = fully(app.workspace.active.tabEl);
    await shot('60-tabs-overflow-end');
    // ‹ scrolls by one tab (≤ max tab width) and both arrows/fades are live in the middle
    const sl0 = tabs.scrollLeft;
    left.click();
    await waitFor(() => tabs.scrollLeft < sl0 - 30, 2000, 'scrolled left');
    await sleep(500);
    results.scrollLeftOneTab = sl0 - tabs.scrollLeft > 30 && sl0 - tabs.scrollLeft <= 230;
    results.middleBothArrows = !left.disabled && !right.disabled && bar.classList.contains('ovf-left') && bar.classList.contains('ovf-right');
    const sl1 = tabs.scrollLeft;
    right.click();
    await waitFor(() => tabs.scrollLeft > sl1 + 30, 2000, 'scrolled right');
    await sleep(500);
    results.scrollRightOneTab = tabs.scrollLeft - sl1 > 30 && tabs.scrollLeft - sl1 <= 230;
    // activating the first tab scrolls it into view → at the start: ‹ disabled, › enabled, fade on the right
    app.workspace.activate(app.workspace.tabs[0]);
    await waitFor(() => tabs.scrollLeft <= 1, 2000, 'at the start');
    await sleep(300);
    results.arrowsAtStart = left.disabled && !right.disabled && !bar.classList.contains('ovf-left') && bar.classList.contains('ovf-right');
    results.firstTabVisible = fully(app.workspace.tabs[0].tabEl);
    await shot('61-tabs-overflow-start');
    // resize: a wider window still overflows with 15 tabs; the arrows follow the window
    await window.api.app.testResize(1400, 700);
    await sleep(400);
    results.arrowsAfterResize = !left.hidden && !right.hidden;
    await window.api.app.testResize(1100, 700);
    await sleep(400);

    // "all tabs" menu: 15 entries, ✓ on the active one, picking one activates it and scrolls it into view
    list.click();
    await sleep(250);
    const items = [...document.querySelectorAll('#ctx-root .ctx.tab-list .ctx-item')];
    results.tabMenuLists15 = items.length === 15;
    results.tabMenuCheckOnActive = items.length === 15 && items[0].textContent.includes('✓') && items.slice(1).every((i) => !i.textContent.includes('✓'));
    results.tabMenuHasDots = items.length === 15 && items.every((i) => i.querySelector('.dot'));
    await shot('62-all-tabs-menu');
    items[11]?.click();
    await sleep(500);
    results.tabMenuActivates = app.workspace.active === app.workspace.tabs[11] && !document.querySelector('#ctx-root .ctx');
    results.tabMenuScrollsIntoView = fully(app.workspace.tabs[11].tabEl);
    // clicking the button again closes the menu (toggle). Kept tight: a window blur closes any context
    // menu, so no long waits between opening and checking.
    list.click();
    await sleep(30); // the menu attaches its outside-click handler on the next tick
    const openAgain = !!document.querySelector('#ctx-root .ctx.tab-list');
    list.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    list.click();
    results.tabMenuToggles = openAgain && !document.querySelector('#ctx-root .ctx.tab-list');
    // 40 tabs: the menu is capped at 60vh and scrolls, stays inside the window with its first entry reachable (it used
    // to be placed with the uncapped height: top −236 px, 8 entries out of reach) and opens on the active tab's entry
    while (app.workspace.tabs.length < 40) await app.newLocalTab();
    await sleep(800);
    list.click();
    await sleep(250);
    const menu40 = document.querySelector('#ctx-root .ctx.tab-list');
    const items40 = [...(menu40?.querySelectorAll('.ctx-item') || [])];
    const mr = menu40.getBoundingClientRect();
    const inMenu = (el) => { const r = el.getBoundingClientRect(); return r.top >= mr.top - 1 && r.bottom <= mr.bottom + 1; };
    results.tabMenu40Inside = items40.length === 40 && mr.top >= 0 && mr.bottom <= window.innerHeight && mr.height <= window.innerHeight * 0.6 + 1;
    results.tabMenu40Scrolls = menu40.scrollHeight > menu40.clientHeight + 1;
    results.tabMenu40ActiveShown = inMenu(items40[39]) && document.activeElement === items40[39];
    await shot('62b-all-tabs-menu-40');
    menu40.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await sleep(100);
    results.tabMenu40HomeReachesFirst = document.activeElement === items40[0] && inMenu(items40[0]) && items40[0].getBoundingClientRect().top >= 0;
    items40[0].click();
    await sleep(400);
    results.tabMenu40Activates = app.workspace.active === app.workspace.tabs[0] && !document.querySelector('#ctx-root .ctx');
    // back to 2 tabs: arrows and fades disappear, the strip is where it was (no layout shift)
    for (const t of app.workspace.tabs.slice(2)) await app.closeTab(t);
    await sleep(600);
    results.arrowsHiddenAfterClose = left.hidden && right.hidden && !bar.classList.contains('ovf-left') && !bar.classList.contains('ovf-right');
    results.noLayoutShift = Math.abs(tabs.getBoundingClientRect().left - tabsLeft0) < 1 && Math.abs(bar.getBoundingClientRect().height - barH0) < 1;
    await shot('63-tabs-two');

    // ---------- 2. plain-text session log ----------
    const logDir = app.info.userData + '/test-logs';
    await app.saveSettings({ logPlainText: true, logDir });
    const lp = await app.newLocalTab();
    await waitFor(() => /[$%#>] ?$/.test(text(lp).trimEnd()), 8000, 'shell prompt');
    await lp.toggleLog(true);
    await sleep(300);
    results.logStarted = lp.logging === true && typeof lp.logFile === 'string' && lp.logFile.startsWith(logDir);
    lp.term.input("printf '\\e[31mred\\e[0m\\n'\r");
    await waitFor(() => /^red$/m.test(text(lp)), 5000, 'printf output');
    await sleep(400);
    await lp.toggleLog(false);
    await sleep(600);
    results.logStopped = lp.logging === false;
    // read the file back through the shell: lines with "red", number of ESC bytes, the footer
    const check = (f, tag) => `printf '${tag} red=%s esc=%s stopped=%s\\n' "$(grep -c red '${f}')" "$(od -An -tx1 '${f}' | tr -s ' ' '\\n' | grep -c '^1b$')" "$(grep -c 'log stopped' '${f}')"\r`;
    lp.term.input(check(lp.logFile, 'LOGCHECK1'));
    await waitFor(() => /LOGCHECK1 red=\d+ esc=\d+ stopped=\d+/.test(text(lp)), 6000, 'plain log check');
    const m1 = /LOGCHECK1 red=(\d+) esc=(\d+) stopped=(\d+)/.exec(text(lp));
    log('plain log', lp.logFile, m1[0]);
    results.plainLogHasRed = parseInt(m1[1], 10) >= 1;
    results.plainLogNoEsc = m1[2] === '0';
    results.plainLogFooter = m1[3] === '1';
    // the default (raw) log keeps the escape sequences
    await app.saveSettings({ logPlainText: false });
    await lp.toggleLog(true);
    await sleep(300);
    const rawFile = lp.logFile;
    lp.term.input("printf '\\e[32mgreen\\e[0m\\n'\r");
    await waitFor(() => /^green$/m.test(text(lp)), 5000, 'printf output 2');
    await sleep(400);
    await lp.toggleLog(false);
    await sleep(600);
    lp.term.input(check(rawFile, 'LOGCHECK2'));
    await waitFor(() => /LOGCHECK2 red=\d+ esc=\d+ stopped=\d+/.test(text(lp)), 6000, 'raw log check');
    const m2 = /LOGCHECK2 red=(\d+) esc=(\d+) stopped=(\d+)/.exec(text(lp));
    log('raw log', rawFile, m2[0]);
    results.rawLogKeepsEsc = parseInt(m2[2], 10) >= 1 && rawFile !== lp.logFile || parseInt(m2[2], 10) >= 1;
    await shot('64-log-check');
    // the Settings dialog shows the option
    app.action('settings');
    await sleep(400);
    const cb = [...document.querySelectorAll('.modal label')].find((l) => /Strip colours/.test(l.textContent))?.querySelector('input[type=checkbox]');
    results.settingsHasLogPlain = !!cb && cb.checked === false;
    await shot('65-settings-logging');
    $('.modal .close')?.click();
    await sleep(200);

    // ---------- 3. theme kept across split / layout changes ----------
    await app.saveSettings({ theme: 'light' });
    await sleep(200);
    const tp = app.activePane();
    results.lightApplied = bg(tp) === '#ffffff' && termBg(tp) === '#ffffff';
    await app.splitActive('down');
    await sleep(500);
    const panes = tp.tab.panes();
    results.splitTwoPanes = panes.length === 2;
    results.themeKeptAfterSplit = panes.every((p) => bg(p) === '#ffffff');
    results.termBgMatchesAfterSplit = panes.every((p) => termBg(p) === '#ffffff');
    await shot('66-light-split-down');
    await app.applyLayout('2x2');
    await sleep(500);
    results.themeKeptAfterGrid = tp.tab.panes().length === 4 && tp.tab.panes().every((p) => bg(p) === '#ffffff' && termBg(p) === '#ffffff');
    app.focusPane(tp, true);
    await app.unsplit();
    await sleep(400);
    results.themeKeptAfterUnsplit = tp.tab.panes().length === 1 && bg(tp) === '#ffffff' && termBg(tp) === '#ffffff';
    // switching back repaints every pane of every tab, including a freshly split one
    await app.splitActive('right');
    await sleep(300);
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(300);
    results.darkBackOnAllPanes = app.workspace.allPanes().every((p) => bg(p) === '#1e1e1e' && termBg(p) === '#1e1e1e');

    // ---------- 4. empty workspace keeps "+" and ⌘T (menu → action 'new-local') ----------
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(400);
    results.emptyHint = !!$('#tab-content .workspace-empty');
    results.addVisibleWhenEmpty = add.offsetParent !== null && add.getBoundingClientRect().width > 0 && !add.hidden;
    results.listHiddenWhenEmpty = list.hidden && left.hidden && right.hidden;
    await shot('67-empty-workspace');
    await app.action('new-local'); // what ⌘T dispatches through the application menu
    await sleep(600);
    results.cmdTWithNoTab = app.workspace.tabs.length === 1 && !$('#tab-content .workspace-empty') && app.activePane()?.kind === 'local';
    add.click();
    await sleep(600);
    results.addButtonWorks = app.workspace.tabs.length === 2;

    // ---------- 5. pin / unpin, close left / right, one confirm for a bulk close, the workspace keeps pinned ----------
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    const named = async (n) => { const p = await app.newLocalTab({ title: n }); p.tab.title = n; p.tab.autoTitle = false; app.workspace.updateTab(p.tab); return p.tab; };
    const [A, B, C, D, E] = [await named('A'), await named('B'), await named('C'), await named('D'), await named('E')];
    await sleep(300);
    const order = () => app.workspace.tabs.map((t) => t.title).join('');
    const domOrder = () => [...tabs.querySelectorAll('.tab')].map((el) => el.querySelector('.title').textContent).join('');
    const closeShown = (t) => getComputedStyle(t.tabEl.querySelector('.close')).display !== 'none';
    const pinShown = (t) => !t.tabEl.querySelector('.pinico').hidden && getComputedStyle(t.tabEl.querySelector('.pinico')).display !== 'none';
    // the tab menu of an unpinned tab offers Pin Tab, Close Tabs to the Left / Right (Left disabled on the first tab)
    app.workspace.tabMenu(A, 100, 100);
    await sleep(100);
    const menuItems = () => [...document.querySelectorAll('#ctx-root .ctx-item')];
    const item = (re) => menuItems().find((i) => re.test(i.textContent));
    results.menuHasPinAndSideCloses = !!item(/^Pin Tab/) && !!item(/^Close Tabs to the Left$/) && !!item(/^Close Tabs to the Right$/) && !!item(/^Close Others$/);
    results.menuLeftDisabledOnFirst = item(/^Close Tabs to the Left$/).classList.contains('disabled') && !item(/^Close Tabs to the Right$/).classList.contains('disabled');
    await shot('68-tab-menu-pin');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    // pinning moves the tab to the left block in pin order; the strip and the DOM agree
    app.workspace.setPinned(D, true);
    results.pinMovesToFront = order() === 'DABCE' && domOrder() === 'DABCE' && D.pinned && D.tabEl.classList.contains('pinned');
    app.workspace.setPinned(B, true);
    results.secondPinAfterFirst = order() === 'DBACE' && domOrder() === 'DBACE';
    results.pinnedNoCloseButton = !closeShown(D) && !closeShown(B) && closeShown(A) && pinShown(D) && !pinShown(A);
    results.pinnedNarrower = D.tabEl.getBoundingClientRect().width < A.tabEl.getBoundingClientRect().width - 20 && D.tabEl.getBoundingClientRect().width > 40;
    results.pinnedTooltip = /pinned/.test(D.tabEl.title) && !/pinned/.test(A.tabEl.title);
    app.workspace.tabMenu(D, 100, 100);
    await sleep(100);
    results.menuUnpinOnPinned = !!item(/^Unpin Tab/) && !item(/^Pin Tab/);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    // the "all tabs" menu marks pinned entries
    const tl = app.workspace.showTabList();
    await sleep(100);
    const tlRows = [...tl.querySelectorAll('.ctx-item')];
    results.tabListMarksPinned = tlRows.length === 5 && !!tlRows[0].querySelector('.pinico') && !!tlRows[1].querySelector('.pinico') && !tlRows[2].querySelector('.pinico');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    await shot('69-pinned-tabs');
    // reorder: an unpinned tab cannot pass the pinned block, a pinned one cannot leave it (API and a real drag)
    app.workspace.moveTab(E, 0);
    results.unpinnedStopsAtBlock = order() === 'DBEAC' && domOrder() === 'DBEAC';
    app.workspace.moveTab(D, 4);
    results.pinnedStaysInBlock = order() === 'BDEAC' && domOrder() === 'BDEAC';
    app.workspace.moveTab(D, 0);
    results.pinnedReorderWithinBlock = order() === 'DBEAC';
    const mid = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
    const leftOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) }; };
    const drag = await window.api.app.testDrag(mid(C.tabEl), leftOf(D.tabEl)); // C onto the left half of the first pinned tab
    await sleep(300);
    log('drag C → before D', JSON.stringify(drag), order());
    results.dragCannotPassPinned = drag.ok && order() === 'DBCEA' && domOrder() === 'DBCEA';
    // unpinning puts the tab first among the unpinned ones
    app.workspace.setPinned(B, false);
    results.unpinGoesAfterBlock = order() === 'DBCEA' && !B.pinned && closeShown(B) && !pinShown(B) && domOrder() === 'DBCEA';
    // a middle click leaves a pinned tab alone
    D.tabEl.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
    await sleep(200);
    results.middleClickSparesPinned = app.workspace.tabs.includes(D);
    // ⇧⌘P (action 'pin-tab') toggles the active tab
    app.workspace.activate(E);
    await app.action('pin-tab');
    results.pinActionPins = E.pinned && order() === 'DEBCA';
    await app.action('pin-tab');
    results.pinActionUnpins = !E.pinned && order() === 'DEBCA';
    // close left / right skip the pinned tab: from C, left closes E and B (never D), right closes A
    app.workspace.activate(C);
    await app.action('close-left');
    await sleep(300);
    results.closeLeftSkipsPinned = order() === 'DCA' && app.workspace.active === C;
    await app.action('close-right');
    await sleep(300);
    results.closeRightClosesRest = order() === 'DC' && app.workspace.active === C;
    app.workspace.activate(D);
    await app.action('close-others');
    await sleep(300);
    results.closeOthersFromPinned = order() === 'D';
    results.closeAllDisabledWhenOnlyPinned = (app.workspace.tabMenu(D, 100, 100), await sleep(100), item(/^Close All$/).classList.contains('disabled') && item(/^Close Others$/).classList.contains('disabled'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    // the confirm of a bulk close counts the live connections of every tab it closes and asks once
    const user = app.info.home.split('/').pop(), keyDir = app.info.appPath + '/test/sshd-runtime';
    const sshSess = await app.saveSession({ name: 'tab-sshd', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });
    const o1 = app.openSession(sshSess);
    await waitFor(() => $('.modal .btn.primary'), 10000, 'host key dialog');
    $('.modal .btn.primary').click();
    const s1 = await o1;
    const s2 = await app.openSession(sshSess);
    await waitFor(() => s1.status === 'connected' && s2.status === 'connected', 20000, 'two ssh tabs');
    const F = await named('F');
    await sleep(200);
    results.liveTabsOpen = order() === 'Dtab-sshdtab-sshdF' && app.liveIn(app.workspace.tabs).length === 2;
    await app.saveSettings({ confirmClose: true });
    app.workspace.activate(D);
    const ask = app.action('close-right'); // closes 3 tabs (ssh, ssh, F) with 2 live connections: one question
    await waitFor(() => $('#modal-root .modal'), 3000, 'bulk close confirm');
    const modal = $('#modal-root .modal');
    results.bulkConfirmCounts = /Close 3 tabs with 2 live connections\?/.test(modal.textContent);
    await sleep(200); // the dialog is painted before the capture
    await shot('69b-close-right-confirm');
    [...modal.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Cancel').click();
    results.bulkConfirmCancelKeeps = (await ask) === false && app.workspace.tabs.length === 4 && s1.status === 'connected' && s2.status === 'connected';
    await sleep(200);
    results.bulkAskedOnce = !document.querySelector('#modal-root .modal');
    const ask2 = app.action('close-right');
    await waitFor(() => $('#modal-root .modal'), 3000, 'bulk close confirm again');
    const modal2 = $('#modal-root .modal');
    [...modal2.querySelectorAll('.modal-foot button')].find((b) => /^Close tabs$/.test(b.textContent)).click();
    results.bulkConfirmOkCloses = (await ask2) === true && order() === 'D' && s1.disposed && s2.disposed;
    await sleep(300);
    results.noSecondQuestion = !document.querySelector('#modal-root .modal');
    // a single tab keeps its own wording
    const s3 = await app.openSession(sshSess);
    await waitFor(() => s3.status === 'connected', 20000, 'third ssh tab');
    const ask3 = app.closeTab(s3.tab);
    await waitFor(() => $('#modal-root .modal'), 3000, 'single close confirm');
    const modal3 = $('#modal-root .modal');
    results.singleConfirmWording = /Close tab "tab-sshd" with 1 live connection\?/.test(modal3.textContent);
    [...modal3.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Close').click();
    results.singleConfirmCloses = (await ask3) === true && order() === 'D';
    await app.saveSettings({ confirmClose: false });
    // the workspace saves `pinned: true` and only that; restoring brings the pin back at the left
    const G = await named('G');
    app.workspace.setPinned(G, true); // G pinned after D
    const H = await named('H');
    app.workspace.setPinned(D, false); // D unpinned: strip G D H
    results.pinOrderBeforeSave = order() === 'GDH' && G.pinned && !D.pinned && !H.pinned;
    app.saveWorkspaceNow();
    await sleep(300);
    const ws = await window.api.workspace.get();
    results.workspaceSavesPinned = ws.tabs.length === 3 && ws.tabs[0].pinned === true && ws.tabs[0].title === 'G' && !('pinned' in ws.tabs[1]) && !('pinned' in ws.tabs[2]);
    log('saved workspace', JSON.stringify(ws));
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(100);
    clearTimeout(app._wsTimer); app._wsTimer = null;
    // a file whose pinned tab is not first still restores pinned-first
    window.api.workspace.save({ ...ws, tabs: [ws.tabs[1], ws.tabs[0], ws.tabs[2]], activeTab: 0 });
    await sleep(200);
    results.restored = await app.restoreWorkspace();
    await sleep(300);
    const rG = app.workspace.tabs.find((t) => t.title === 'G');
    results.restoreKeepsPinned = order() === 'GDH' && domOrder() === 'GDH' && !!rG && rG.pinned && rG.tabEl.classList.contains('pinned') && !closeShown(rG) && app.workspace.tabs.filter((t) => t.pinned).length === 1;
    await waitFor(() => app.workspace.allPanes().every((p) => p.status === 'connected'), 15000, 'restored shells');
    await shot('69c-pinned-restored');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-tabbar] FAIL', e.message, e.stack);
    await shot('99-tabbar-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
