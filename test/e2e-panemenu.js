// The pane menu's per-terminal items (MobaXterm's terminal right-click set): Rename Pane… (Rename Terminal), Pane
// Settings… (the running terminal's own settings, applied to one pane or saved to its session), Background Label ▸
// (iTerm2-style badge behind the text: show / hide, text, centre / top right), Font Size ▸ and Read-Only; sub-menus
// of the context menu; the state travels with the pane (zoom, split, resize, detach) and with the workspace, the
// session editor's Terminal tab stores the label on the session; the label is never in the buffer or the log.
//   test/qa/run.sh test/e2e-panemenu.js <out-dir> 240000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-panemenu]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const count = (pane, s) => text(pane).split('\n').filter((l) => l.includes(s)).length;
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  let seq = 0;
  const mark = () => 'PM_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  const type = (pane, m) => pane.term.input(`echo PM_''${m.slice(3)}\r`);
  const ctx = () => document.querySelector('#ctx-root .ctx:not(.ctx-sub)');
  const sub = () => document.querySelector('#ctx-root .ctx.ctx-sub');
  const rows = (menu) => [...(menu?.querySelectorAll('.ctx-item') || [])];
  const labelsOf = (menu) => rows(menu).map((i) => i.childNodes[0].textContent);
  const item = (menu, label) => rows(menu).find((i) => i.childNodes[0].textContent === label);
  const modal = () => document.querySelector('#modal-root .modal');
  const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const esc = async () => { key(document.activeElement || document.body, 'Escape'); await sleep(80); };
  const openMenu = async (p, init = { shiftKey: true }) => {
    const r = p.termEl.getBoundingClientRect();
    p.termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 60, ...init }));
    await sleep(100);
  };
  const badgeFont = (p) => parseFloat(getComputedStyle(p.badgeText).fontSize);
  const badgeShown = (p) => !p.badgeEl.hidden && getComputedStyle(p.badgeEl).display !== 'none' && p.badgeEl.getBoundingClientRect().height > 0;
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const button = (m, label) => [...m.querySelectorAll('.modal-foot button')].find((b) => b.textContent === label);
  const accName = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    return [...(el.labels || [])].map((l) => l.textContent.trim()).filter(Boolean).join(' ');
  };
  const windows = () => window.api.app.testWindows();
  const ev = (id, code) => window.api.app.testEval(id, code);
  try {
    await app.saveSettings({ confirmClose: false, rightClickPaste: true });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const tab = app.workspace.active;
    const a = tab.activePane;
    const local2 = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local2, { split: 'right' });
    await prompt(a);
    await prompt(b);
    results.twoPanes = tab.panes().length === 2 && b.session?.id === local2.id && !a.session;
    const baseFont = app.settings.fontSize;

    // ---------- the menu: MobaXterm-ordered items, sub-menus by mouse and keyboard, ⌃- or ⇧-right-click while a right-click pastes ----------
    const clipBefore = await window.api.clipboard.read(); // the Mac's clipboard is put back at the end
    await window.api.clipboard.write(''); // a plain right-click pastes the clipboard: nothing to paste, so the shell line stays clean and no paste guard opens
    await sleep(100);
    await openMenu(b, {}); // a plain right-click pastes (Settings → Terminal): no menu
    await sleep(200);
    results.plainRightClickNoMenu = !ctx() && !modal();
    await openMenu(b, { ctrlKey: true });
    results.ctrlRightClickOpensMenu = !!ctx();
    await esc();
    await openMenu(b);
    const L = labelsOf(ctx());
    log('pane menu:', L.join(' | '));
    results.menuItemsPresent = ['Rename Pane…', 'Pane Settings…', 'Background Label', 'Font Size', 'Read-Only'].every((l) => L.includes(l));
    results.menuOrder = L.indexOf('Clear') < L.indexOf('Rename Pane…') && L.indexOf('Rename Pane…') < L.indexOf('Pane Settings…') && L.indexOf('Pane Settings…') < L.indexOf('Background Label') && L.indexOf('Background Label') < L.indexOf('Font Size') && L.indexOf('Font Size') < L.indexOf('Read-Only') && L.indexOf('Read-Only') < L.indexOf('Split Right');
    const bl = item(ctx(), 'Background Label');
    results.subMenuRowA11y = bl.getAttribute('aria-haspopup') === 'menu' && bl.getAttribute('aria-expanded') === 'false' && bl.querySelector('.k')?.textContent === '›';
    results.readOnlyIsCheckbox = item(ctx(), 'Read-Only').getAttribute('role') === 'menuitemcheckbox' && item(ctx(), 'Read-Only').getAttribute('aria-checked') === 'false';
    await shot('80-pane-menu');
    bl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await sleep(80);
    results.hoverOpensSub = !!sub() && bl.getAttribute('aria-expanded') === 'true' && labelsOf(sub()).join('|') === 'Show|Set Text…|Centre|Top Right';
    results.subPositionBesideRow = !!sub() && Math.abs(sub().getBoundingClientRect().left - bl.getBoundingClientRect().right) < 4;
    results.subCentreChecked = item(sub(), 'Centre').getAttribute('aria-checked') === 'true' && item(sub(), 'Top Right').getAttribute('aria-checked') === 'false';
    await shot('81-pane-menu-background-submenu');
    item(ctx(), 'Font Size').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); // another row: the first sub-menu goes, its own opens
    await sleep(80);
    results.hoverSwitchesSub = document.querySelectorAll('#ctx-root .ctx-sub').length === 1 && labelsOf(sub()).join('|') === 'Increase|Decrease|Reset' && bl.getAttribute('aria-expanded') === 'false';
    item(ctx(), 'Rename Pane…').dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); // a plain row: no sub-menu
    await sleep(80);
    results.plainRowClosesSub = !sub();
    // keyboard: → opens, the first sub item has the focus, ← closes and puts the keyboard back on the row; Esc in a sub-menu closes just it
    bl.focus();
    key(bl, 'ArrowRight');
    await sleep(80);
    results.arrowRightOpensSub = !!sub() && document.activeElement === item(sub(), 'Show');
    key(document.activeElement, 'ArrowDown');
    results.arrowDownInSub = document.activeElement === item(sub(), 'Set Text…');
    key(document.activeElement, 'ArrowLeft');
    await sleep(80);
    results.arrowLeftClosesSub = !sub() && document.activeElement === bl && !!ctx();
    key(bl, 'Enter');
    await sleep(80);
    results.enterOpensSub = !!sub() && document.activeElement === item(sub(), 'Show');
    await esc();
    results.escClosesSubOnly = !sub() && !!ctx() && document.activeElement === bl;
    await esc();
    results.escClosesMenu = !ctx();

    // ---------- Rename Pane… (MobaXterm's Rename Terminal): the head and the tab follow, the shell's title sequences do not; empty = automatic ----------
    const renameTo = async (p, name) => {
      const pr = p.renamePrompt();
      await waitFor(() => modal(), 3000, 'rename prompt');
      const m = modal();
      const input = m.querySelector('input[type=text]');
      results.renamePrefilled = results.renamePrefilled !== false && input.value === p.title;
      setVal(input, name);
      button(m, 'OK').click();
      await pr;
      await sleep(150);
    };
    await renameTo(b, 'DB-01');
    results.renameSetsTitle = b.title === 'DB-01' && b.titleLocked === true && b.headTitle.textContent === 'DB-01';
    results.renameNamesTab = tab.autoTitle && tab.title === 'DB-01' && tab.tabEl.querySelector('.title').textContent === 'DB-01';
    results.renameInExcludeCaption = b.mxCaption.textContent === 'Exclude "DB-01" from MultiExec mode';
    b.term.write('\x1b]0;shell-says-so\x07'); // what a shell's title sequence does: ignored while the name is locked
    await sleep(200);
    results.lockedAgainstShellTitle = b.title === 'DB-01';
    await renameTo(b, '');
    results.emptyRestoresAutomatic = b.title === 'local 2' && b.titleLocked === false && tab.title === 'local 2';
    b.term.write('\x1b]0;shell-says-so\x07');
    await sleep(200);
    results.shellTitleWorksAgain = b.title === 'shell-says-so';
    await renameTo(b, 'DB-01');
    await shot('82-rename-pane');

    // ---------- Pane Settings…: applies to this pane only; the sibling is untouched; a global Settings change leaves the override alone ----------
    {
      const pr = app.paneSettings(b);
      await waitFor(() => modal(), 3000, 'pane settings');
      const m = modal();
      results.paneSettingsTitle = m.getAttribute('aria-label') === 'Pane Settings — DB-01';
      const unnamed = [...m.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => !accName(el));
      results.paneSettingsFieldsLabelled = unnamed.length === 0;
      if (unnamed.length) log('unnamed controls', unnamed.map((e) => e.outerHTML.slice(0, 80)));
      const byLabel = (txt) => { const l = [...m.querySelectorAll('label')].find((x) => x.textContent === txt); return l && l.htmlFor ? document.getElementById(l.htmlFor) : null; };
      results.paneSettingsNoMonitorForLocal = !byLabel('Monitoring bar');
      results.paneSettingsButtons = !!button(m, 'Apply to this pane') && !!button(m, 'Save to session') && !!button(m, 'Cancel');
      setVal(byLabel('Theme'), 'dracula');
      setVal(byLabel('Font size'), '16');
      setVal(byLabel('Cursor'), 'underline');
      setVal(byLabel('Cursor blink'), 'off');
      setVal(byLabel('Scrollback lines'), '500');
      setVal(byLabel('Keyword highlighting'), 'off');
      const showBox = [...m.querySelectorAll('input[type=checkbox]')].find((cb) => accName(cb) === 'Show a background label');
      showBox.checked = true;
      setVal(byLabel('Label text'), 'PROD');
      setVal(byLabel('Label position'), 'top-right');
      await shot('83-pane-settings-dialog');
      button(m, 'Apply to this pane').click();
      await pr;
      await sleep(300);
    }
    results.overridesApplied = b.overrides.theme === 'dracula' && b.overrides.fontSize === 16 && b.overrides.cursorStyle === 'underline' && b.overrides.cursorBlink === false && b.overrides.scrollback === 500 && b.overrides.highlight === 'off';
    results.termOptionsFollow = b.term.options.fontSize === 16 && b.term.options.cursorStyle === 'underline' && b.term.options.cursorBlink === false && b.term.options.scrollback === 500 && b.el.style.getPropertyValue('--term-bg') === b.themeFor().background && b.themeFor() !== a.themeFor();
    results.siblingUntouched = a.term.options.fontSize === baseFont && a.term.options.cursorStyle === (app.settings.cursorStyle || 'block') && Object.keys(a.overrides).length === 0 && a.el.style.getPropertyValue('--term-bg') === a.themeFor().background && !a.overrides.theme;
    results.badgeFromSettings = badgeShown(b) && b.badgeText.textContent === 'PROD' && b.badgeEl.classList.contains('top-right') && !badgeShown(a);
    results.sessionNotWrittenByApply = !app.sessions.sessions.find((s) => s.id === local2.id).theme;
    await app.saveSettings({ fontSize: baseFont + 1 });
    await sleep(200);
    results.globalChangeKeepsOverride = a.term.options.fontSize === baseFont + 1 && b.term.options.fontSize === 16;
    await app.saveSettings({ fontSize: baseFont });
    await sleep(200);
    // Font Size ▸ steps this pane only; Reset comes back to the pane's own base (its override)
    b.zoom(1); b.zoom(1);
    results.fontStepPerPane = b.term.options.fontSize === 18 && a.term.options.fontSize === baseFont;
    b.zoom(0);
    results.fontResetToOverride = b.term.options.fontSize === 16;

    // ---------- Save to session: the session gets the fields it has; a new pane of that session follows ----------
    {
      const pr = app.paneSettings(b);
      await waitFor(() => modal(), 3000, 'pane settings again');
      const m = modal();
      button(m, 'Save to session').click();
      await pr;
      await sleep(400);
    }
    const saved = app.sessions.sessions.find((s) => s.id === local2.id);
    results.savedToSession = !!saved && saved.theme === 'dracula' && saved.fontSize === 16 && saved.highlight === 'off' && saved.backgroundName === 'PROD' && saved.backgroundShown === true && saved.backgroundPosition === 'top-right';
    results.saveToastNamesSession = document.getElementById('toast-root').textContent.includes('Pane settings saved to session "local 2"');
    const c = await app.openSession(saved, { split: 'down', target: b });
    await prompt(c);
    results.newPaneFollowsSession = Object.keys(c.overrides).length === 0 && c.term.options.fontSize === 16 && c.themeFor() === b.themeFor() && badgeShown(c) && c.badgeText.textContent === 'PROD' && c.badgeEl.classList.contains('top-right');
    await shot('84-badge-session-two-panes');
    await app.closePane(c, true);
    await sleep(300);

    // ---------- Background Label ▸ on a pane without a session: Show (the title), Set Text…, Centre / Top Right; it scales with the pane ----------
    results.badgeOffByDefault = !badgeShown(a) && a.badgeState().show === false;
    await openMenu(a);
    item(ctx(), 'Background Label').dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(80);
    item(sub(), 'Show').click();
    await sleep(100);
    results.badgeShowUsesTitle = badgeShown(a) && a.badgeText.textContent === a.title && !a.badgeEl.classList.contains('top-right');
    await openMenu(a);
    item(ctx(), 'Background Label').dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(80);
    results.badgeMenuSaysHide = labelsOf(sub())[0] === 'Hide';
    const pr2 = (item(sub(), 'Set Text…').click(), waitFor(() => modal(), 3000, 'badge prompt'));
    await pr2;
    {
      const m = modal();
      const input = m.querySelector('input[type=text]');
      results.badgePromptPlaceholder = input.placeholder === a.title && input.value === '';
      setVal(input, 'STAGING');
      button(m, 'OK').click();
      await sleep(200);
    }
    results.badgeTextSet = badgeShown(a) && a.badgeText.textContent === 'STAGING' && a.badge.text === 'STAGING';
    const fontCentre = badgeFont(a);
    await openMenu(a);
    item(ctx(), 'Background Label').dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(80);
    item(sub(), 'Top Right').click();
    await sleep(100);
    results.badgeTopRight = a.badgeEl.classList.contains('top-right') && badgeFont(a) < fontCentre && a.badgeText.getBoundingClientRect().right <= a.termEl.getBoundingClientRect().right + 1 && a.badgeText.getBoundingClientRect().top < a.termEl.getBoundingClientRect().top + a.termEl.clientHeight / 3;
    await shot('85-badge-top-right');
    await openMenu(a);
    item(ctx(), 'Background Label').dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(80);
    item(sub(), 'Centre').click();
    await sleep(100);
    const rect = (el) => el.getBoundingClientRect();
    const centred = (p) => { const t = rect(p.termEl), x = rect(p.badgeText); return Math.abs((x.left + x.right) / 2 - (t.left + t.right) / 2) < 8 && Math.abs((x.top + x.bottom) / 2 - (t.top + t.bottom) / 2) < 12; };
    results.badgeCentred = !a.badgeEl.classList.contains('top-right') && centred(a) && badgeFont(a) === fontCentre;
    results.badgeBelowOverlays = parseInt(getComputedStyle(a.badgeEl).zIndex, 10) === 1 && getComputedStyle(a.badgeEl).pointerEvents === 'none';
    // under the badge the terminal still takes clicks: the element at the badge's centre is xterm's, not the label
    {
      const x = rect(a.badgeText);
      const hit = document.elementFromPoint((x.left + x.right) / 2, (x.top + x.bottom) / 2);
      results.badgeNotClickable = !!hit && !a.badgeEl.contains(hit) && !!hit.closest('.xterm');
    }
    await shot('86-badge-centre');
    // the label follows the pane's height (a side-by-side zoom keeps the height: same size, still centred); a down split halves it
    app.toggleZoom(a);
    await sleep(300);
    results.badgeKeptWhenZoomed = tab.zoomed === a && badgeFont(a) === fontCentre && badgeShown(a) && centred(a) && !badgeShown(b);
    app.toggleZoom(a);
    await sleep(300);
    results.badgeBackAfterUnzoom = !tab.zoomed && badgeFont(a) === fontCentre && badgeShown(a) && badgeShown(b);
    app.focusPane(a);
    await app.splitActive('down');
    await sleep(300);
    const fontHalf = badgeFont(a);
    results.badgeScalesWithHeight = fontHalf < fontCentre && fontHalf > 20 && badgeShown(a) && centred(a);
    log('badge font centre / half-height pane', fontCentre, fontHalf);
    for (const p of tab.panes().filter((p) => p.kind === 'empty')) await app.closePane(p, true);
    await sleep(300);
    results.badgeFontBackAfterClose = badgeFont(a) === fontCentre;
    await window.api.app.testResize(1100, 760);
    await sleep(400);
    results.badgeFollowsResize = badgeShown(a) && centred(a) && badgeFont(a) >= fontCentre;
    await window.api.app.testResize(1000, 650);
    await sleep(400);
    // tiny cells hide it: split a down three times (each halves it)
    app.focusPane(a);
    for (let i = 0; i < 3; i++) { await app.splitActive('down'); await sleep(150); app.focusPane(a); }
    await sleep(300);
    results.badgeHiddenWhenTiny = a.termEl.clientHeight < 90 && getComputedStyle(a.badgeEl).display === 'none';
    log('tiny pane height', a.termEl.clientHeight);
    for (const p of tab.panes().filter((p) => p.kind === 'empty')) await app.closePane(p, true);
    await sleep(300);
    results.badgeBackAfterUnsplit = tab.panes().length === 2 && badgeShown(a) && getComputedStyle(a.badgeEl).display !== 'none';
    // never in the buffer, the selection or the log
    const m1 = mark();
    await a.toggleLog(true);
    type(a, m1);
    await waitFor(() => count(a, m1) >= 1, 8000, 'marker in a');
    await sleep(300);
    results.badgeNotInBuffer = !text(a).includes('STAGING') && !text(b).includes('PROD');
    a.term.selectAll();
    results.badgeNotInSelection = !a.term.getSelection().includes('STAGING');
    a.term.clearSelection();
    await a.toggleLog(false);
    await sleep(300);
    const logFile = a.logFile;
    const m2 = mark();
    b.term.input(`command grep -c 'STAGING' '${logFile}'; command grep -c 'PM_'${m1.slice(3)} '${logFile}'; echo PM_''${m2.slice(3)}\r`); // `command`, quoted: the user's zsh aliases stay out of it
    await waitFor(() => count(b, m2) >= 1, 8000, 'grep in b');
    await sleep(300);
    const lines = text(b).split('\n');
    const at = lines.findIndex((l) => l.includes(m2) && !l.includes('grep'));
    results.badgeNotInLog = !!logFile && at >= 2 && lines[at - 2].trim() === '0' && parseInt(lines[at - 1].trim(), 10) >= 1; // the label never, the marker's output line at least once
    log('log file', logFile, 'grep lines', JSON.stringify(lines.slice(Math.max(0, at - 4), at + 1)));

    // ---------- Read-Only: keystrokes and pastes to the pane are dropped, output still flows, a chip in the head, MultiExec leaves it out ----------
    await openMenu(b);
    item(ctx(), 'Read-Only').click();
    await sleep(150);
    results.readOnlyOn = b.readOnly === true && b.term.options.disableStdin === true && !b.roBadge.hidden && b.roBadge.textContent === 'read-only' && b.el.classList.contains('read-only');
    const m3 = mark();
    type(b, m3);
    await sleep(1200);
    results.readOnlyDropsKeys = count(b, m3) === 0;
    results.readOnlyDropsPaste = (await b.pasteText('echo PM_PASTE\r')) === false && document.getElementById('toast-root').textContent.includes('This pane is read-only');
    await sleep(800);
    results.readOnlyPasteNotTyped = count(b, 'PM_PASTE') === 0;
    b.write(`echo PM_''${m3.slice(3)}\r`); // straight to the shell (not a keystroke): output still flows into the read-only pane
    await waitFor(() => count(b, m3) >= 1, 8000, 'output in the read-only pane');
    results.readOnlyShowsOutput = count(b, m3) === 1;
    const m4 = mark();
    type(a, m4);
    await waitFor(() => count(a, m4) >= 1, 8000, 'typing in a');
    results.siblingStillTypes = count(a, m4) === 1 && count(b, m4) === 0;
    app.action('multiexec');
    await sleep(300);
    results.readOnlyOutOfMultiexec = document.getElementById('multiexec-count').textContent === '1' && b.mxEl.hidden && !a.mxEl.hidden;
    app.action('multiexec');
    await sleep(200);
    await openMenu(b);
    results.readOnlyMenuChecked = item(ctx(), 'Read-Only').getAttribute('aria-checked') === 'true' && item(ctx(), 'Read-Only').querySelector('.k')?.textContent === '✓';
    await shot('87-read-only-chip');
    item(ctx(), 'Read-Only').click();
    await sleep(150);
    const m5 = mark();
    type(b, m5);
    await waitFor(() => count(b, m5) >= 1, 8000, 'typing after read-only off');
    results.readOnlyOffTypesAgain = !b.readOnly && b.roBadge.hidden && count(b, m5) === 1;
    await openMenu(b);
    item(ctx(), 'Read-Only').click(); // on again for the transfer / workspace checks
    await sleep(150);

    // ---------- the state travels: detach to a window and back; the workspace file; an in-process restore ----------
    const before = { aTitle: a.title, bTitle: b.title };
    await app.detachTab(tab);
    let dw = null;
    await waitFor(async () => (dw = (await windows()).find((w) => w.detached)) && await ev(dw.id, `!!(window.app && window.app.workspace && window.app.workspace.tabs.length && window.app.workspace.tabs[0].panes().every((p) => p.termId))`), 20000, 'detached window');
    await sleep(800);
    const far = await ev(dw.id, `window.app.workspace.tabs[0].panes().map((p) => ({ title: p.title, locked: p.titleLocked, ro: p.readOnly, theme: p.overrides.theme, fs: p.term.options.fontSize, badge: p.badgeState(), shown: !p.badgeEl.hidden && p.badgeEl.getBoundingClientRect().height > 0, text: p.badgeText.textContent, chip: !p.roBadge.hidden }))`);
    log('detached panes', JSON.stringify(far));
    const fa = far.find((p) => p.title === before.aTitle), fb = far.find((p) => p.title === 'DB-01');
    results.detachCarriesState = !!fa && !!fb && fb.locked && fb.ro && fb.chip && fb.theme === 'dracula' && fb.fs === 16 && fb.shown && fb.text === 'PROD' && fb.badge.position === 'top-right' && fa.shown && fa.text === 'STAGING' && !fa.ro;
    await window.api.app.testCloseWindow(dw.id);
    await waitFor(async () => (await windows()).length === 1 && app.workspace.tabs.length === 1 && app.workspace.tabs[0].panes().every((p) => p.termId), 20000, 'tab back');
    await sleep(500);
    const back = app.workspace.tabs[0];
    const ba = back.panes().find((p) => !p.session), bb = back.panes().find((p) => p.session);
    results.returnKeepsState = !!ba && !!bb && bb.title === 'DB-01' && bb.titleLocked && bb.readOnly && !bb.roBadge.hidden && bb.overrides.theme === 'dracula' && bb.term.options.fontSize === 16 && badgeShown(bb) && bb.badgeText.textContent === 'PROD' && badgeShown(ba) && ba.badgeText.textContent === 'STAGING' && !ba.readOnly;
    app.saveWorkspaceNow();
    await sleep(300);
    const ws = await window.api.workspace.get();
    const panesInWs = [];
    (function walk(n) { if (!n) return; if (n.t === 'pane') panesInWs.push(n); else (n.children || []).forEach(walk); })(ws.tabs[0].root);
    const wa = panesInWs.find((p) => !p.sessionId), wb = panesInWs.find((p) => p.sessionId === local2.id);
    results.workspaceSavesState = !!wa && !!wb && wb.paneTitle === 'DB-01' && wb.readOnly === true && wb.overrides?.theme === 'dracula' && wb.overrides?.fontSize === 16 && wb.badge?.show === true && wb.badge?.text === 'PROD' && wb.badge?.position === 'top-right' && wa.badge?.text === 'STAGING' && !('paneTitle' in wa) && !('readOnly' in wa) && !('termId' in wb);
    log('workspace panes', JSON.stringify(panesInWs));
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(100);
    clearTimeout(app._wsTimer); app._wsTimer = null;
    window.api.workspace.save(ws);
    await sleep(200);
    results.restored = await app.restoreWorkspace();
    await sleep(500);
    const rt = app.workspace.tabs[0];
    const ra = rt && rt.panes().find((p) => !p.session), rb = rt && rt.panes().find((p) => p.session);
    await prompt(ra);
    await prompt(rb);
    results.restoreKeepsState = !!ra && !!rb && rb.title === 'DB-01' && rb.titleLocked && rt.title === 'DB-01' && rb.readOnly && !rb.roBadge.hidden && rb.overrides.theme === 'dracula' && rb.term.options.fontSize === 16 && rb.term.options.scrollback === 500 && badgeShown(rb) && rb.badgeText.textContent === 'PROD' && rb.badgeEl.classList.contains('top-right') && badgeShown(ra) && ra.badgeText.textContent === 'STAGING' && !ra.readOnly && !ra.titleLocked;
    results.restoredReadOnlyDrops = (type(rb, mark()), await sleep(800), text(rb).split('\n').filter((l) => /PM_[A-Z0-9]{6}/.test(l) && !l.includes('echo')).length === 0);
    await shot('88-restored-state');
    // the session editor's Terminal tab shows and saves the label (the fields the Save to session wrote)
    app.editSession(saved);
    await waitFor(() => modal(), 3000, 'session editor');
    {
      const m = modal();
      [...m.querySelectorAll('.mtabs button')].find((bt) => bt.textContent === 'Terminal').click();
      await sleep(100);
      const byLabel = (txt) => { const l = [...m.querySelectorAll('label')].find((x) => x.textContent === txt); return l && l.htmlFor ? document.getElementById(l.htmlFor) : null; };
      const showBox = [...m.querySelectorAll('input[type=checkbox]')].find((cb) => accName(cb) === 'Show a background label');
      results.editorShowsLabelFields = !!showBox && showBox.checked && byLabel('Label text')?.value === 'PROD' && byLabel('Label position')?.value === 'top-right';
      await shot('89-session-editor-background-label');
      setVal(byLabel('Label text'), 'PROD-2');
      setVal(byLabel('Label position'), 'center');
      button(m, 'Save').click();
      await sleep(500);
    }
    const saved2 = app.sessions.sessions.find((s) => s.id === local2.id);
    results.editorSavesLabel = saved2.backgroundName === 'PROD-2' && saved2.backgroundPosition === 'center' && saved2.backgroundShown === true;
    results.openPaneFollowsEditor = rb.session.backgroundName === 'PROD-2' && rb.badgeText.textContent === 'PROD' && rb.badgeEl.classList.contains('top-right'); // the pane's own setting stays on top of the session's
    rb.setBadge({ text: '', position: undefined });
    await sleep(100);
    results.clearedOverrideFollowsSession = rb.badgeText.textContent === 'PROD-2' && !rb.badgeEl.classList.contains('top-right');
    await window.api.clipboard.write(clipBefore || '');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-panemenu] FAIL', e.message, e.stack);
    await shot('99-panemenu-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
