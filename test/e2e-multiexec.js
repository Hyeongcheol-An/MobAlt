// MultiExec scope: keystrokes go only to the live terminals visible in the active tab, never to other tabs,
// and the banner count follows tab switches, splits, closes, deaths and reconnects.
//   test/qa/run.sh test/e2e-multiexec.js <out-dir>
// (The 'zoom' action is the font size; "visible" is every pane of the active tab — no pane is zoomed here, see test/e2e-zoom.js.)
// Also: the tab titles after a tab → pane drop, the FTP card in a split (test/ftpd.py on 127.0.0.1:2151 when it is
// running; without a server the failed card has the same box) and the wording when nothing can be broadcast to.
// Then MobaXterm's per-terminal switch (second half, a 2 × 2 grid): the strip under each terminal with the box
// `Exclude "<title>" from MultiExec mode`, the banner's ", N excluded" and all-excluded wording, the bulk menu
// (right-click on a strip or the banner, ⇧F10 on a box: Activate all / none, Invert selection, Synchronize mouse wheel
// scrolling), the pane menu's checkable entry, the reset when the mode goes off, zoom, and the terminals' re-fit.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-multiexec]', ...a);
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
  let seq = 0;
  const mark = () => 'MX_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  // Type through xterm's onData (what a key press does) → _onInput → broadcast. The echoed command line reads
  // MX_''ABC, so only the command's output contains MX_ABC: one matching line per time the shell ran it.
  const type = (pane, m) => pane.term.input(`echo MX_''${m.slice(3)}\r`);
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const tab1 = app.workspace.active;
    const a = tab1.activePane;
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'right' });
    await prompt(a);
    await prompt(b);
    results.tab1HasTwoPanes = tab1.panes().length === 2 && b.tab === tab1;
    const c = await app.newLocalTab();
    const tab2 = app.workspace.active;
    await prompt(c);
    results.tab2IsSeparate = tab2 !== tab1 && tab2.panes().length === 1 && app.workspace.tabs.length === 2;

    // --- off → on in tab 1: the banner counts the 2 visible panes
    app.workspace.activate(tab1);
    await sleep(200);
    results.bannerHiddenWhileOff = banner().hidden && !app.multiexec;
    app.action('multiexec');
    await sleep(150);
    results.multiexecOn = app.multiexec === true && document.getElementById('btn-multiexec').classList.contains('on');
    results.bannerShownTab1 = !banner().hidden && bannerCount() === '2';
    results.bannerWording = /keystrokes go to 2 visible terminal\(s\) in this tab/.test(banner().textContent);
    results.toastOn = toasts().includes('MultiExec ON: input goes to every visible terminal in this tab');
    results.buttonTooltip = /every visible terminal in this tab/.test(document.getElementById('btn-multiexec').title);
    await shot('60-multiexec-banner-tab1');

    // --- typing in pane a reaches a and b (same tab) exactly once each, and not c (other tab)
    const m1 = mark();
    type(a, m1);
    await waitFor(() => count(a, m1) >= 1 && count(b, m1) >= 1, 8000, 'marker in both tab-1 panes');
    await sleep(800); // a double write would show by now
    results.markerInPaneAOnce = count(a, m1) === 1;
    results.markerInPaneBOnce = count(b, m1) === 1;
    results.markerNotInTab2 = count(c, m1) === 0;
    log('marker', m1, 'counts a/b/c', count(a, m1), count(b, m1), count(c, m1));
    await shot('61-multiexec-typed-tab1');

    // --- switching tabs: the banner follows the active tab (1 visible terminal in tab 2); typing there stays there
    app.workspace.activate(tab2);
    await sleep(200);
    results.bannerCountTab2 = !banner().hidden && bannerCount() === '1';
    await shot('62-multiexec-banner-tab2');
    const m2 = mark();
    type(c, m2);
    await waitFor(() => count(c, m2) >= 1, 8000, 'marker in tab-2 pane');
    await sleep(800);
    results.tab2MarkerOnce = count(c, m2) === 1;
    results.tab2MarkerNotInTab1 = count(a, m2) === 0 && count(b, m2) === 0;

    // --- turning it on with a single terminal visible says so, but still enables
    app.action('multiexec');
    await sleep(100);
    results.toggledOff = app.multiexec === false && banner().hidden && toasts().includes('MultiExec OFF');
    app.action('multiexec');
    await sleep(150);
    results.singleTerminalToast = toasts().includes('MultiExec ON: only 1 terminal is visible — split the tab to broadcast');
    results.singleTerminalStillOn = app.multiexec === true && !banner().hidden && bannerCount() === '1';
    await shot('63-multiexec-single-terminal-toast');

    // --- back in tab 1: an empty split pane is not counted; a pane that dies drops out; reconnecting brings it back
    app.workspace.activate(tab1);
    await sleep(200);
    results.bannerBackTo2 = bannerCount() === '2';
    await app.splitActive('down');
    await sleep(300);
    results.emptyPaneNotCounted = tab1.panes().length === 3 && bannerCount() === '2';
    const empty = tab1.panes().find((p) => p.kind === 'empty');
    await app.closePane(empty, true);
    await sleep(300);
    results.countAfterCloseEmpty = tab1.panes().length === 2 && bannerCount() === '2';
    b.write('exit 3\r'); // straight to b's shell (not a keystroke): a non-zero exit leaves the pane dead on screen
    await waitFor(() => b.dead && !b.termId, 8000, 'pane b dead');
    await sleep(200);
    results.deadPaneDropsOut = tab1.panes().includes(b) && bannerCount() === '1';
    const m3 = mark();
    type(a, m3);
    await waitFor(() => count(a, m3) >= 1, 8000, 'marker after b died');
    await sleep(500);
    results.deadPaneNotWritten = count(a, m3) === 1 && count(b, m3) === 0;
    await shot('64-multiexec-dead-pane');
    await b.reconnect();
    await prompt(b);
    results.reconnectCountsAgain = live(b) && bannerCount() === '2';

    // --- closing a live pane; font zoom (⌘=) is not a pane zoom and leaves the count alone
    await app.closePane(b, true);
    await sleep(300);
    results.countAfterClosePane = tab1.panes().length === 1 && bannerCount() === '1';
    app.action('zoom', 1);
    await sleep(100);
    results.fontZoomKeepsCount = bannerCount() === '1';
    app.action('zoom', 0);
    app.action('multiexec');
    await sleep(100);
    results.offAtEnd = !app.multiexec && banner().hidden;

    // --- tab → pane drop: an auto-titled source tab follows the pane it shows once its active pane moved out; the target takes that pane's name
    const d = await app.openSession(local, { split: 'right' }); // tab1 = a | d
    await prompt(d);
    d.updateTitle(); // the pane reports its title (as a shell's title sequence does): the tab, auto-titled, takes "local 2" from its active pane
    results.sourceTitledByActivePane = tab1.autoTitle && tab1.activePane === d && tab1.title === 'local 2';
    app.workspace.activate(tab2);
    await sleep(200);
    await app.dropOnPane(c, { tabId: tab1.id }, 'down');
    await sleep(400);
    results.tabDropMovesPane = d.tab === tab2 && tab2.panes().length === 2 && tab1.panes().length === 1 && tab1.panes()[0] === a;
    results.sourceRetitledAfterDrop = tab1.title === a.title && tab1.tabEl.querySelector('.title').textContent === a.title;
    results.targetRetitledAfterDrop = tab2.title === 'local 2' && tab2.tabEl.querySelector('.title').textContent === 'local 2';
    log('titles after tab drop: source', JSON.stringify(tab1.title), 'target', JSON.stringify(tab2.title), '(pane a:', JSON.stringify(a.title) + ')');
    await shot('65-tab-drop-titles');

    // --- placeholder cards in a split (empty pane, FTP): they start below the pane head, whose title and buttons stay reachable
    const ftpSession = await app.saveSession({ name: 'ftp-local', type: 'ftp', host: '127.0.0.1', port: 2151, username: 'user', password: 'pw' });
    await app.splitActive('right'); // next to d: tab2 = c / (d | empty)
    await sleep(300);
    const cardCheck = (pane, cardSel) => {
      const card = pane.el.querySelector(cardSel);
      const head = pane.headEl.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
      const closeBtn = pane.headEl.querySelector('button[title="Close pane"]');
      const cb = closeBtn.getBoundingClientRect();
      const hitClose = document.elementFromPoint(cb.left + cb.width / 2, cb.top + cb.height / 2);
      const hitTitle = document.elementFromPoint(head.left + 30, head.top + head.height / 2);
      log(cardSel, pane.status, 'head bottom', head.bottom.toFixed(1), 'card top', cardRect.top.toFixed(1), 'hit', hitClose && hitClose.tagName, hitTitle && hitTitle.className);
      return {
        belowHead: pane.el.classList.contains('show-head') && head.height >= 20 && cardRect.top >= head.bottom - 0.5 && cardRect.height > 60,
        headReachable: closeBtn.contains(hitClose) && !!hitTitle && hitTitle.closest('.pane-head') === pane.headEl,
      };
    };
    const emptyPane = tab2.panes().find((p) => p.kind === 'empty');
    const emptyCard = cardCheck(emptyPane, '.pane-placeholder:not(.ftp-info)');
    results.emptyCardBelowPaneHead = emptyCard.belowHead;
    results.emptyPaneHeadReachable = emptyCard.headReachable;
    await shot('66-empty-card-in-split');
    const ftpPane = await app.replacePane(emptyPane, ftpSession, true); // test/ftpd.py on 2151 → connected card; no server → failed card, same box
    await waitFor(() => ftpPane.status === 'connected' || ftpPane.status === 'failed', 10000, 'ftp card');
    await sleep(300);
    const ftpCard = cardCheck(ftpPane, '.pane-placeholder.ftp-info');
    results.ftpCardBelowPaneHead = ftpCard.belowHead;
    results.ftpPaneHeadReachable = ftpCard.headReachable;
    await shot('67-ftp-card-in-split');

    // --- nothing to broadcast to (no tab at all; a tab with only an empty card): the toast and banner say so, not "0 terminals — split the tab"
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(300);
    app.action('multiexec');
    await sleep(150);
    results.zeroNoTabToast = toasts().includes('MultiExec ON: no terminal is visible — open a session first') && !toasts().includes('only 0');
    results.zeroNoTabBanner = !banner().hidden && bannerCount() === '0' && /MultiExec is ON — no terminal is visible — open a session first/.test(banner().textContent) && !/0 visible terminal/.test(banner().textContent) && !/in this tab/.test(banner().textContent);
    await shot('68-multiexec-no-terminal');
    app.action('multiexec');
    await sleep(100);
    const e1 = await app.newLocalTab();
    await prompt(e1);
    await app.splitActive('right');
    await sleep(300);
    const onlyEmptyTab = app.workspace.active;
    await app.closePane(e1, true);
    await sleep(300);
    results.onlyEmptyPaneLeft = onlyEmptyTab.panes().length === 1 && onlyEmptyTab.panes()[0].kind === 'empty';
    app.action('multiexec');
    await sleep(150);
    results.zeroInTabToast = toasts().includes('MultiExec ON: no terminal is visible in this tab — connect a session first');
    results.zeroInTabBanner = bannerCount() === '0' && /MultiExec is ON — no terminal is visible in this tab — connect a session first/.test(banner().textContent) && getComputedStyle(document.getElementById('multiexec-count')).display === 'none';
    await shot('69-multiexec-only-empty-pane');
    app.action('multiexec');
    await sleep(100);
    results.offAfterZeroChecks = !app.multiexec && banner().hidden;

    // ================= per-pane Exclude (MobaXterm's checkbox under each terminal), the bulk menu, synchronised scrolling =================
    // a fresh tab with a 2 × 2 grid of local shells: g1 | g2 over g3 | g4
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(300);
    const g1 = await app.newLocalTab();
    await prompt(g1);
    const g2 = await app.openSession(local, { split: 'right' });
    await prompt(g2);
    const g3 = await app.openSession(local, { split: 'down', target: g1 });
    await prompt(g3);
    const g4 = await app.openSession(local, { split: 'down', target: g2 });
    await prompt(g4);
    const grid = app.workspace.active;
    const G = [g1, g2, g3, g4];
    results.gridOfFour = grid.panes().length === 4 && G.every((p) => live(p) && p.tab === grid);
    const strip = (p) => p.mxEl;
    const stripShown = (p) => !strip(p).hidden && strip(p).getBoundingClientRect().height > 0;
    const screenBottom = (p) => p.termEl.querySelector('.xterm-screen').getBoundingClientRect().bottom;
    // the strip sits under the terminal, at the pane's bottom edge, left-aligned; the terminal's screen never overlaps it
    const under = (p) => {
      const s = strip(p).getBoundingClientRect(), tr = p.termEl.getBoundingClientRect(), e = p.el.getBoundingClientRect();
      return s.top >= tr.bottom - 0.5 && Math.abs(s.bottom - e.bottom) < 1 && s.left < e.left + 8 && screenBottom(p) <= s.top + 0.5;
    };
    const ctx = () => document.querySelector('#ctx-root .ctx');
    const items = () => [...(ctx()?.querySelectorAll('.ctx-item') || [])];
    const labelsOf = () => items().map((i) => i.childNodes[0].textContent);
    const item = (label) => items().find((i) => i.childNodes[0].textContent === label);
    const rightClick = (el, dx = 10, dy = 5, init = {}) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + dx, clientY: r.top + dy, ...init })); };
    const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    const esc = async () => { key(document.activeElement || document.body, 'Escape'); await sleep(80); };

    results.stripsHiddenWhileOff = !app.multiexec && G.every((p) => strip(p).hidden && strip(p).getBoundingClientRect().height === 0);
    const before = G.map((p) => ({ rows: p.term.rows, h: p.termEl.clientHeight }));
    app.action('multiexec');
    await sleep(300);
    results.stripsShownWhenOn = G.every((p) => stripShown(p) && !p.mxBox.checked && !p.multiexecExcluded);
    results.stripCaption = G.every((p) => p.mxCaption.textContent === `Exclude "${p.title}" from MultiExec mode` && p.mxEl.title === p.mxCaption.textContent);
    results.stripA11y = G.every((p) => p.mxEl.getAttribute('role') === 'group' && p.mxEl.getAttribute('aria-label').includes(p.title) && p.mxBox.labels.length === 1 && p.mxBox.labels[0].textContent === p.mxCaption.textContent && p.mxBox.tabIndex === 0);
    results.stripUnderTerminal = G.every(under);
    results.terminalRefitWithStrip = G.every((p, i) => p.termEl.clientHeight < before[i].h && p.term.rows <= before[i].rows);
    results.bannerCountFour = bannerCount() === '4' && !/excluded/.test(banner().textContent);
    results.buttonTooltipMentionsBox = /a box under each terminal excludes it/.test(document.getElementById('btn-multiexec').title);
    log('rows before / with strip', JSON.stringify(G.map((p, i) => [before[i].rows, p.term.rows])), 'strip height', strip(g1).getBoundingClientRect().height);

    // --- tick g2's box: it stays on screen and connected, out of the broadcast; the banner says "3 … , 1 excluded"
    g2.mxBox.click();
    await sleep(150);
    results.excludeByBox = g2.multiexecExcluded === true && g2.mxBox.checked && live(g2) && !g1.multiexecExcluded && app.multiexecTargets().length === 3 && !app.multiexecTargets().includes(g2);
    results.bannerThreeOneExcluded = bannerCount() === '3' && /keystrokes go to 3 visible terminal\(s\) in this tab, 1 excluded/.test(banner().textContent);
    await shot('70-multiexec-exclude-one');
    const m4 = mark();
    type(g1, m4);
    await waitFor(() => count(g1, m4) >= 1 && count(g3, m4) >= 1 && count(g4, m4) >= 1, 8000, 'marker in the three active panes');
    await sleep(800);
    results.excludedGetsNothing = count(g2, m4) === 0;
    results.activeGetOnce = [g1, g3, g4].every((p) => count(p, m4) === 1);
    // typing into the excluded pane itself still reaches its own shell, once, and nobody else (MobaXterm)
    const m5 = mark();
    type(g2, m5);
    await waitFor(() => count(g2, m5) >= 1, 8000, 'marker in the excluded pane');
    await sleep(800);
    results.excludedTypedDirectly = count(g2, m5) === 1 && [g1, g3, g4].every((p) => count(p, m5) === 0);

    // --- the bulk menu on a strip: Activate none → every box ticked, the all-excluded sentence, nothing broadcast
    rightClick(strip(g1));
    await sleep(100);
    results.bulkMenuItems = labelsOf().join('|') === 'Activate all|Activate none|Invert selection|Synchronize mouse wheel scrolling';
    results.bulkMenuSyncIsCheckbox = item('Synchronize mouse wheel scrolling')?.getAttribute('role') === 'menuitemcheckbox' && item('Synchronize mouse wheel scrolling').getAttribute('aria-checked') === 'false' && item('Activate all').getAttribute('role') === 'menuitem';
    await shot('71-multiexec-bulk-menu');
    item('Activate none').click();
    await sleep(150);
    results.activateNone = G.every((p) => p.multiexecExcluded && p.mxBox.checked && live(p)) && bannerCount() === '0' && getComputedStyle(document.getElementById('multiexec-count')).display === 'none'
      && /MultiExec is ON — every visible terminal is excluded — untick "Exclude … from MultiExec mode" under a pane/.test(banner().textContent) && !/visible terminal\(s\)/.test(banner().textContent) && !/, \d+ excluded/.test(banner().textContent);
    await shot('72-multiexec-all-excluded');
    const m6 = mark();
    type(g1, m6);
    await waitFor(() => count(g1, m6) >= 1, 8000, 'marker with every pane excluded');
    await sleep(800);
    results.allExcludedNothingSent = count(g1, m6) === 1 && [g2, g3, g4].every((p) => count(p, m6) === 0);
    // --- the banner's own right-click opens the same menu: Activate all
    rightClick(banner(), 20, 5);
    await sleep(100);
    results.bannerMenu = labelsOf().length === 4 && !!item('Activate all');
    item('Activate all').click();
    await sleep(150);
    results.activateAll = G.every((p) => !p.multiexecExcluded && !p.mxBox.checked) && bannerCount() === '4' && !/excluded/.test(banner().textContent);
    // --- Invert selection: g2 ticked → g2 becomes the only active pane
    g2.setMultiexecExcluded(true);
    rightClick(strip(g3));
    await sleep(100);
    item('Invert selection').click();
    await sleep(150);
    results.invertSelection = !g2.multiexecExcluded && [g1, g3, g4].every((p) => p.multiexecExcluded && p.mxBox.checked) && bannerCount() === '1' && /1 visible terminal\(s\) in this tab, 3 excluded/.test(banner().textContent);

    // --- the pane context menu (⇧-right-click inside the terminal): a checkable "Exclude from MultiExec" entry, the same switch
    rightClick(g1.termEl, 40, 40, { shiftKey: true });
    await sleep(100);
    const ex = () => item('Exclude from MultiExec');
    results.paneMenuEntryChecked = !!ex() && ex().getAttribute('role') === 'menuitemcheckbox' && ex().getAttribute('aria-checked') === 'true' && ex().querySelector('.k')?.textContent === '✓';
    ex().click();
    await sleep(150);
    results.paneMenuToggles = !g1.multiexecExcluded && !g1.mxBox.checked && bannerCount() === '2' && /2 excluded/.test(banner().textContent);
    rightClick(g1.termEl, 40, 40, { shiftKey: true });
    await sleep(100);
    results.paneMenuEntryUnchecked = !!ex() && ex().getAttribute('aria-checked') === 'false' && !ex().querySelector('.k');
    await esc();
    results.paneMenuClosed = !ctx();
    // --- ⇧F10 on the focused box opens the bulk menu under it; Esc hands the focus back to the box; the Menu key works too
    g2.mxBox.focus();
    key(g2.mxBox, 'F10', { shiftKey: true });
    await sleep(100);
    results.shiftF10OpensMenu = !!ctx() && labelsOf().length === 4 && ctx().getBoundingClientRect().top >= g2.mxBox.getBoundingClientRect().bottom - 1;
    await esc();
    results.escBackToBox = !ctx() && document.activeElement === g2.mxBox;
    key(g2.mxBox, 'ContextMenu');
    await sleep(100);
    results.menuKeyOpensMenu = !!ctx() && labelsOf().length === 4;
    await esc();
    key(g2.mxBox, 'F10'); // plain F10 is not the menu
    await sleep(60);
    results.plainF10Ignored = !ctx();

    // --- off: the boxes reset and the strips go, the terminals get their rows back; on again: all active
    app.action('multiexec');
    await sleep(300);
    results.offResetsExclusions = !app.multiexec && G.every((p) => !p.multiexecExcluded && !p.mxBox.checked && strip(p).hidden);
    results.terminalRefitWithoutStrip = G.every((p, i) => p.termEl.clientHeight === before[i].h && p.term.rows === before[i].rows);
    log('rows after off', JSON.stringify(G.map((p) => p.term.rows)));
    app.action('multiexec');
    await sleep(300);
    results.onAgainAllActive = G.every((p) => stripShown(p) && !p.multiexecExcluded) && bannerCount() === '4';

    // --- zoom: the zoomed pane is the only candidate; excluded, nothing is broadcast (its own keys still reach it); hidden siblings keep their boxes
    g1.setMultiexecExcluded(true);
    app.toggleZoom(g1);
    await sleep(300);
    results.zoomedExcludedNothing = grid.zoomed === g1 && bannerCount() === '0' && /every visible terminal is excluded/.test(banner().textContent) && app.multiexecTargets().length === 0 && stripShown(g1) && under(g1);
    const m7 = mark();
    type(g1, m7);
    await waitFor(() => count(g1, m7) >= 1, 8000, 'marker in the zoomed, excluded pane');
    await sleep(800);
    results.zoomedExcludedTypedOnce = count(g1, m7) === 1 && [g2, g3, g4].every((p) => count(p, m7) === 0);
    g1.setMultiexecExcluded(false);
    g2.setMultiexecExcluded(true); // hidden behind the zoom: neither visible nor counted as excluded
    await sleep(100);
    results.zoomedActiveOnly = bannerCount() === '1' && /the zoomed pane only/.test(banner().textContent) && !/excluded/.test(banner().textContent);
    await shot('73-multiexec-zoomed-strip');
    app.toggleZoom(g1);
    await sleep(300);
    results.unzoomKeepsFlags = !grid.zoomed && g2.multiexecExcluded && bannerCount() === '3' && /1 excluded/.test(banner().textContent) && G.every(stripShown) && G.every(under);

    // --- Synchronize mouse wheel scrolling: 80 lines in every pane, then a wheel in g1 moves g3 and g4 by the same lines; g2 (excluded) neither follows nor leads
    const m8 = mark();
    const fill = `for i in $(seq 1 80); do echo MX_''${m8.slice(3)}_$i; done\r`;
    g1.term.input(fill); // → g1, g3, g4
    g2.term.input(fill); // excluded: its own shell only
    await waitFor(() => G.every((p) => count(p, m8 + '_80') >= 1), 15000, '80 lines in every pane');
    await sleep(500);
    const y = (p) => p.term.buffer.active.viewportY;
    const atBottom = (p) => y(p) === p.term.buffer.active.baseY;
    results.allAtBottom = G.every(atBottom) && G.every((p) => p.term.buffer.active.baseY > 10);
    // a wheel tick as the window gets it: xterm 6's scrollable element listens inside the viewport and reads the legacy wheelDeltaY (120 per notch, up = positive)
    const wheel = (p, dy) => p.termEl.querySelector('.xterm-screen').dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, wheelDeltaY: -dy * 1.2, wheelDelta: -dy * 1.2, bubbles: true, cancelable: true }));
    wheel(g1, -300);
    await waitFor(() => !atBottom(g1), 2000, 'a wheel scrolled g1');
    await sleep(300);
    results.wheelNotSyncedByDefault = !app.multiexecSyncScroll && !atBottom(g1) && [g2, g3, g4].every(atBottom);
    rightClick(strip(g1));
    await sleep(100);
    item('Synchronize mouse wheel scrolling').click();
    await sleep(100);
    results.syncToggled = app.multiexecSyncScroll === true;
    rightClick(banner(), 20, 5);
    await sleep(100);
    results.syncShownChecked = item('Synchronize mouse wheel scrolling').getAttribute('aria-checked') === 'true' && item('Synchronize mouse wheel scrolling').querySelector('.k')?.textContent === '✓';
    await esc();
    const y1 = y(g1);
    wheel(g1, -300);
    await waitFor(() => y(g1) < y1, 2000, 'a second wheel scrolled g1');
    await sleep(400);
    const delta = y1 - y(g1);
    results.wheelSynced = delta > 0 && [g3, g4].every((p) => p.term.buffer.active.baseY - y(p) === delta) && atBottom(g2);
    results.noFeedback = y(g1) === y1 - delta; // the followers' own scroll never comes back
    log('sync scroll: g1 moved', delta, 'lines; offsets from the bottom g2/g3/g4', [g2, g3, g4].map((p) => p.term.buffer.active.baseY - y(p)));
    wheel(g2, -300); // the excluded pane scrolls alone
    await waitFor(() => !atBottom(g2), 2000, 'a wheel scrolled g2');
    await sleep(300);
    results.excludedWheelAlone = !atBottom(g2) && y(g1) === y1 - delta && [g3, g4].every((p) => p.term.buffer.active.baseY - y(p) === delta);
    // output arriving in a follower at the bottom is not a wheel: g1 does not move (g3 is scrolled up, so its own view stays too)
    const m9 = mark();
    g4.write(`echo MX_''${m9.slice(3)}\r`); // straight to g4's shell, not a keystroke
    await waitFor(() => count(g4, m9) >= 1, 8000, 'output in g4');
    await sleep(300);
    results.outputIsNotAWheel = y(g1) === y1 - delta && g3.term.buffer.active.baseY - y(g3) === delta;
    await shot('74-multiexec-sync-scroll');
    app.multiexecSyncScroll = false;
    app.action('multiexec');
    await sleep(100);
    results.offAtTheEnd = !app.multiexec && banner().hidden && G.every((p) => strip(p).hidden && !p.multiexecExcluded);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-multiexec] FAIL', e.message, e.stack);
    await shot('99-multiexec-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
