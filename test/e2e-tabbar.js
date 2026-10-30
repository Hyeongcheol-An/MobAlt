// Tab strip overflow (arrows, fades, "all tabs" menu), plain-text session logs, theme kept across splits,
// and the empty workspace still offering "+" / ⌘T.
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
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-tabbar] FAIL', e.message, e.stack);
    await shot('99-tabbar-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
