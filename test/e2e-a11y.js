// Keyboard accessibility checks: tab strip (arrows, overflow), session tree, context menus, dialog focus trap and
// focus return, icon/colour pickers, macros list, toolbar, quick connect. Everything is driven with dispatched
// KeyboardEvents (plus a few real key presses); the SFTP list section runs only when the local test sshd
// (test/start-sshd.sh, 127.0.0.1:2222) is up and is skipped otherwise.
//   test/qa/run.sh test/e2e-a11y.js <out-dir>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => { await sleep(120); return window.api.app.screenshot(n); }; // let the last change paint
  const log = (...a) => console.log('[e2e-a11y]', ...a);
  const app = window.app;
  const results = {};
  const active = () => document.activeElement;
  const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const press = async (k, init) => { key(active(), k, init); await sleep(60); };
  const realKey = async (k) => { await window.api.app.testKey(k); await sleep(120); }; // trusted key: buttons activate on Space/Enter
  const focusVisible = (el) => !!el && el.matches(':focus-visible');
  const inTerminal = () => !!active()?.closest('.xterm');
  const ctx = () => document.querySelector('#ctx-root .ctx');
  const items = () => [...(ctx()?.querySelectorAll('.ctx-item') || [])];
  const tabEls = () => [...document.querySelectorAll('#tabs .tab')];
  const rows = () => app.sessionTree.visibleRows();
  const rowOf = (name) => rows().find((r) => r.querySelector('.label')?.textContent === name);
  const labels = () => rows().map((r) => r.querySelector('.label').textContent).join('|');
  const modal = () => document.querySelector('.modal');
  const modals = () => [...document.querySelectorAll('.modal')];
  const $ = (s) => document.querySelector(s);
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  // "ResizeObserver loop completed with undelivered notifications" is reported as a window error: count them for the whole run
  let roErrors = 0;
  window.addEventListener('error', (e) => { if (/ResizeObserver/.test(e.message || '')) roErrors++; });
  try {
    await app.saveSettings({ confirmClose: false });
    // One real key press (F19, on the quick-connect box where it does nothing) puts Chromium into keyboard
    // mode and raises the window, so :focus-visible checks do not depend on what the mouse did last.
    document.getElementById('qc-input').focus();
    await window.api.app.testKey('F19');
    await sleep(300);
    results.windowFocused = document.hasFocus();
    app.activePane().focus();

    // ---------- tab strip ----------
    await app.newLocalTab();
    await app.newLocalTab();
    await sleep(500);
    const tabs = tabEls();
    results.tabRoles = document.getElementById('tabs').getAttribute('role') === 'tablist' && tabs.length === 3
      && tabs.every((t) => t.getAttribute('role') === 'tab' && t.hasAttribute('tabindex'))
      && tabs.filter((t) => t.tabIndex === 0).length === 1 // roving: one Tab stop
      && tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1
      && tabs.find((t) => t.getAttribute('aria-selected') === 'true') === app.workspace.active.tabEl;
    app.workspace.active.tabEl.focus(); // the third tab is active
    await press('ArrowLeft');
    results.tabArrowLeft = active() === tabs[1] && app.workspace.active.tabEl === tabs[2]; // focus moves, activation does not
    await press('ArrowLeft');
    await press('ArrowLeft');
    results.tabArrowWraps = active() === tabs[2];
    await press('ArrowRight');
    results.tabArrowRight = active() === tabs[0];
    await press('End');
    results.tabEnd = active() === tabs[2];
    await press('Home');
    results.tabHome = active() === tabs[0];
    results.tabFocusVisible = focusVisible(tabs[0]);
    await shot('60-tab-focus-ring');
    await press('Enter');
    results.tabEnterActivates = app.workspace.active.tabEl === tabs[0] && inTerminal();
    tabs[1].focus();
    await press(' ');
    results.tabSpaceActivates = app.workspace.active.tabEl === tabs[1] && inTerminal();
    const add = document.getElementById('tab-add');
    results.tabAddReachable = add.tabIndex === 0 && !add.disabled && !!add.getAttribute('aria-label');

    // ---------- context menu (opened from a tab with ⇧F10) ----------
    tabs[1].focus();
    await press('F10', { shiftKey: true });
    results.menuOpensFromTab = !!ctx() && ctx().textContent.includes('Rename Tab');
    results.menuFirstItemFocused = active() === items()[0];
    results.menuRoles = ctx()?.getAttribute('role') === 'menu' && items().every((i) => i.getAttribute('role') === 'menuitem');
    await press('ArrowDown');
    results.menuArrowDown = active() === items()[1];
    await press('End');
    results.menuEnd = active() === items()[items().length - 1];
    await press('ArrowDown');
    results.menuArrowWraps = active() === items()[0];
    await press('ArrowUp');
    results.menuArrowUpWraps = active() === items()[items().length - 1];
    await press('Home');
    results.menuHome = active() === items()[0];
    results.menuFocusVisible = focusVisible(items()[0]);
    await shot('61-context-menu-keyboard');
    await press('Escape');
    results.menuEscReturnsFocus = !ctx() && active() === tabs[1];
    await press('F10', { shiftKey: true });
    await press('ArrowDown');
    await press('ArrowDown'); // "Tab Color"
    const colorBefore = app.workspace.tabs[1].color;
    await press('Enter');
    results.menuEnterActivates = !ctx() && app.workspace.tabs[1].color !== colorBefore && active() === tabs[1];
    await press('ContextMenu'); // the Menu key works like ⇧F10
    await press('ArrowDown');
    await press('ArrowDown'); // "Tab Color" again
    const colorBefore2 = app.workspace.tabs[1].color;
    await press(' ');
    results.menuSpaceActivates = !ctx() && app.workspace.tabs[1].color !== colorBefore2 && active() === tabs[1];
    // disabled items are skipped (split menu: the last two entries are disabled with a single pane)
    app.splitMenu(document.getElementById('btn-split'));
    await sleep(60);
    const enabled = items().filter((i) => !i.classList.contains('disabled'));
    results.menuHasDisabled = items().length > enabled.length && items().filter((i) => i.classList.contains('disabled')).every((i) => i.getAttribute('aria-disabled') === 'true');
    await press('End');
    results.menuSkipsDisabled = active() === enabled[enabled.length - 1];
    await press('ArrowDown');
    results.menuSkipsDisabledWrap = active() === enabled[0];
    await press('Escape');
    await sleep(60);

    // ---------- tab close / mouse ----------
    {
      const list = tabEls();
      list[1].focus();
      await press('Delete');
      await sleep(300);
      results.tabDeleteCloses = tabEls().length === list.length - 1 && active()?.classList.contains('tab');
      tabEls()[0].click();
      results.tabClickActivates = app.workspace.active.tabEl === tabEls()[0];
    }

    // ---------- session tree ----------
    await app.saveSession({ name: 'db-01', folder: 'Production/EU', type: 'ssh', host: 'db-01.example.com', username: 'postgres' });
    await app.saveSession({ name: 'web-01', folder: 'Production', type: 'ssh', host: 'web-01.example.com' });
    await app.saveSession({ name: 'Project shell', type: 'local', cwd: '/tmp' });
    await app.saveSession({ name: 'Zeta shell', type: 'local', cwd: '/tmp' });
    app.showPanel('sessions');
    app.sessionTree.collapsed.clear();
    app.sessionTree.render();
    await sleep(100);
    const tree = document.getElementById('session-tree');
    results.treeOrder = labels() === 'Production|EU|db-01|web-01|Project shell|Zeta shell';
    results.treeRoles = tree.getAttribute('role') === 'tree' && rows().every((r) => r.getAttribute('role') === 'treeitem')
      && rows().filter((r) => r.classList.contains('folder')).every((r) => r.getAttribute('aria-expanded') === 'true')
      && rows().filter((r) => r.tabIndex === 0).length === 1 && rows()[0].tabIndex === 0 && tree.tabIndex < 0;
    rows()[0].focus(); // what the Tab key lands on: the first row, no click needed
    await press('ArrowDown');
    results.treeArrowDown = active() === rowOf('EU');
    await press('ArrowRight'); // expanded folder → first child
    results.treeRightEnters = active() === rowOf('db-01');
    results.treeSelectionFollows = app.sessionTree.selected === rowOf('db-01').dataset.session && rowOf('db-01').classList.contains('selected');
    await press('ArrowLeft'); // session → parent folder
    results.treeLeftToParent = active() === rowOf('EU');
    await press('ArrowLeft'); // expanded folder → collapse
    const euWrap = rowOf('EU').parentElement;
    results.treeLeftCollapses = euWrap.classList.contains('collapsed') && rowOf('EU').getAttribute('aria-expanded') === 'false' && !rowOf('db-01');
    await press('ArrowDown'); // the hidden db-01 is skipped
    results.treeSkipsCollapsed = active() === rowOf('web-01');
    await press('ArrowUp');
    await press('ArrowRight'); // collapsed folder → expand (focus stays)
    results.treeRightExpands = !euWrap.classList.contains('collapsed') && rowOf('EU').getAttribute('aria-expanded') === 'true' && active() === rowOf('EU');
    await press('End');
    results.treeEnd = active() === rowOf('Zeta shell');
    await press('Home');
    results.treeHome = active() === rowOf('Production');
    results.treeFocusVisible = focusVisible(rowOf('Production'));
    await press('ArrowUp'); // ↑ on the first row goes back to the filter box (↓ from the filter comes here)
    results.treeUpToFilter = active() === document.getElementById('session-filter');
    rowOf('Production').focus();
    app.sessionTree.select(rowOf('Zeta shell').dataset.session); // mouse-style selection elsewhere
    await shot('62-tree-focus-vs-selected');
    const cs = (el) => getComputedStyle(el);
    results.treeFocusDistinct = cs(rowOf('Production')).backgroundColor !== cs(rowOf('Zeta shell')).backgroundColor && cs(rowOf('Production')).outlineStyle === 'solid' && cs(rowOf('Zeta shell')).outlineStyle === 'none';
    await press(' ');
    const prodWrap = rowOf('Production').parentElement;
    results.treeSpaceToggles = prodWrap.classList.contains('collapsed') && rows().length === 3;
    await press('Enter');
    results.treeEnterTogglesFolder = !prodWrap.classList.contains('collapsed') && rows().length === 6;
    {
      const n = app.workspace.tabs.length;
      rowOf('Project shell').focus();
      await press('Enter');
      await sleep(800);
      results.treeEnterOpens = app.workspace.tabs.length === n + 1 && app.activePane()?.session?.name === 'Project shell' && inTerminal();
      const panes = app.workspace.active.panes().length;
      rowOf('Zeta shell').focus();
      await press('Enter', { metaKey: true });
      await sleep(800);
      results.treeCmdEnterSplits = app.workspace.active.panes().length === panes + 1 && app.activePane()?.session?.name === 'Zeta shell';
    }
    // filter box: ↓ moves into the tree, Enter still opens the first match
    {
      const filter = document.getElementById('session-filter');
      filter.focus();
      filter.value = 'zeta';
      filter.dispatchEvent(new Event('input'));
      await sleep(100);
      key(filter, 'ArrowDown');
      results.filterArrowDown = active() === rowOf('Zeta shell');
      filter.focus();
      const n = app.workspace.tabs.length;
      key(filter, 'Enter');
      await sleep(600);
      results.filterEnterOpensFirst = app.workspace.tabs.length === n + 1 && app.activePane()?.session?.name === 'Zeta shell';
      filter.value = '';
      filter.dispatchEvent(new Event('input'));
      await sleep(100);
    }
    // Delete asks first (session and folder); Cancel keeps it, Delete removes it, the keyboard stays in the tree
    rowOf('db-01').focus();
    await press('Delete');
    await sleep(250);
    results.treeDeleteConfirm = !!modal() && /Delete session "db-01"/.test(modal().textContent);
    modal()?.querySelector('.modal-foot .btn:not(.primary)').click();
    await sleep(250);
    results.treeDeleteCancelKeeps = !!rowOf('db-01') && active() === rowOf('db-01');
    await press('Backspace');
    await sleep(250);
    modal()?.querySelector('.modal-foot .btn.primary').click();
    await sleep(500);
    results.treeDeleteRemoves = !rowOf('db-01') && !app.sessions.sessions.some((s) => s.name === 'db-01') && active()?.classList.contains('tree-row');
    // (EU only existed through db-01, so it is gone now; Production still holds web-01)
    results.treeDeleteFocusesFollower = active() === rowOf('web-01') && rowOf('web-01').tabIndex === 0; // the row that followed db-01, not the one at its old index
    rowOf('Production').focus();
    await press('Delete');
    await sleep(250);
    results.treeFolderDeleteConfirm = !!modal() && /Delete folder "Production" and its 1 session/.test(modal().textContent);
    await shot('63-tree-folder-delete-confirm');
    modal()?.querySelector('.modal-foot .btn:not(.primary)').click();
    await sleep(250);
    results.treeFolderDeleteCancelKeeps = !!rowOf('Production') && active() === rowOf('Production');
    // ⇧F10 / Menu key on a row: its menu opens, Esc hands focus back to the row
    rowOf('web-01').focus();
    await press('F10', { shiftKey: true });
    results.treeMenuOpens = !!ctx() && ctx().textContent.includes('Open in Split Right') && active() === items()[0];
    await press('Escape');
    results.treeMenuEscReturnsFocus = !ctx() && active() === rowOf('web-01');
    rowOf('Production').focus();
    await press('ContextMenu');
    results.treeFolderMenuOpens = !!ctx() && ctx().textContent.includes('New Subfolder');
    await press('Escape');
    // a re-render (status dot etc.) keeps the focused row
    rowOf('web-01').focus();
    app.sessionTree.render();
    results.treeRenderKeepsFocus = active() === rowOf('web-01') && rowOf('web-01').tabIndex === 0;

    // ---------- dialog focus trap ----------
    app.action('shortcuts'); // opened while the keyboard is on the web-01 row: closing hands focus back there
    await sleep(300);
    {
      const m = modal();
      const closeX = m.querySelector('.modal-title .close'), closeBtn = m.querySelector('.modal-foot .btn');
      results.modalInitialFocus = active() === closeBtn; // never the ✕
      results.modalRoles = m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true' && closeX.getAttribute('aria-label') === 'Close';
      results.modalListsNewKeys = /⇧F10/.test(m.textContent) && /Focused session row/.test(m.textContent);
      await press('Tab');
      results.modalTabWraps = active() === closeX;
      results.modalCloseRing = focusVisible(closeX);
      await shot('64-modal-close-focus-ring');
      await press('Tab');
      results.modalTabCycles = active() === closeBtn;
      await press('Tab', { shiftKey: true });
      results.modalShiftTab = active() === closeX;
      app.activePane().focus(); // focus wandered outside the dialog
      await sleep(30);
      await press('Tab');
      results.modalTabPullsBack = m.contains(active());
      await press('Escape');
      await sleep(200);
      results.modalEscReturnsToOpener = !modal() && active() === rowOf('web-01');
    }
    app.activePane().focus();
    app.action('shortcuts'); // opened from the terminal: closing goes back to the terminal
    await sleep(300);
    await press('Escape');
    await sleep(200);
    results.modalEscCloses = !modal() && inTerminal();
    app.action('settings');
    await sleep(400);
    {
      const m = modal();
      const seen = new Set();
      let left = false;
      for (let i = 0; i < 80 && !left; i++) {
        await press('Tab');
        if (!m.contains(active())) left = true;
        else seen.add(active());
      }
      results.modalTrapSettings = !left && seen.size > 3 && [...seen].every((el) => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
      await shot('65-settings-dialog-trap');
      m.querySelector('.modal-title .close').click();
      await sleep(200);
    }

    // ---------- toolbar / side strip ----------
    const tb = [...document.querySelectorAll('#toolbar .tb-btn, #side-strip .strip-btn')];
    results.toolbarTabbable = tb.length > 5 && tb.every((b) => b.tabIndex === 0 && !b.disabled);
    const mx = document.querySelector('[data-action="multiexec"]');
    mx.focus();
    results.toolbarFocusVisible = focusVisible(mx);
    await shot('66-toolbar-focus-ring');
    mx.click(); // what Enter/Space do on a focused button (click with detail 0)
    await sleep(100);
    results.toolbarActionRuns = app.multiexec === true;
    results.toolbarFocusToTerminal = inTerminal();
    mx.click();
    await sleep(50);
    const tools = document.querySelector('#toolbar [data-action="sidebar"][data-arg="tools"]');
    tools.focus();
    tools.click();
    await sleep(100);
    results.toolbarToolsFocusesPanel = active() === document.getElementById('tool-host');
    const strip = document.querySelector('.strip-btn[data-action="toggle-sidebar"]');
    strip.focus();
    strip.click();
    await sleep(100);
    results.stripToggleHidesSidebar = document.getElementById('sidebar').classList.contains('collapsed') && inTerminal();
    strip.focus();
    strip.click();
    await sleep(100);
    app.showPanel('sessions');
    // a mouse click (detail 1) leaves focus where it was (the mousedown is prevented on these buttons)
    app.activePane().focus();
    mx.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await sleep(50);
    results.toolbarMouseKeepsFocus = app.multiexec === true && inTerminal();
    mx.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await sleep(50);
    // the ring is drawn inset so .tb-group's overflow:hidden cannot clip it (same for ‹ › ▾ in the tab bar)
    mx.focus();
    results.toolbarRingInset = focusVisible(mx) && getComputedStyle(mx).outlineOffset === '-2px' && getComputedStyle(mx).outlineStyle === 'solid';
    await shot('67-toolbar-ring-inset');

    // ---------- quick connect: Esc clears the text and goes back to the terminal (like the session filter) ----------
    {
      const qc = document.getElementById('qc-input');
      qc.focus();
      qc.value = 'user@host';
      await press('Escape');
      results.quickConnectEscClears = qc.value === '' && inTerminal();
    }

    // ---------- dialogs opened from a focused tab / row / panel button return focus there ----------
    {
      const tab = app.workspace.active.tabEl;
      tab.focus();
      await press('F10', { shiftKey: true });
      await press('Enter'); // "Rename Tab…"
      await sleep(250);
      results.renameTabOpens = !!modal() && /Rename tab/.test(modal().textContent) && active().tagName === 'INPUT';
      await press('Escape');
      await sleep(200);
      results.renameTabEscBackToTab = !modal() && active() === tab && focusVisible(tab);
      // tree row ⇧F10 → Delete (last item) → confirm → Cancel: back on the row
      rowOf('web-01').focus();
      await press('F10', { shiftKey: true });
      await press('End');
      await press('Enter');
      await sleep(250);
      results.rowMenuDeleteAsks = !!modal() && /Delete session "web-01"/.test(modal().textContent);
      await press('Escape');
      await sleep(200);
      results.rowMenuDeleteCancelBackToRow = !modal() && active() === rowOf('web-01');
      // folder row ⇧F10 → Rename Folder… → Esc: back on the folder row
      rowOf('Production').focus();
      await press('F10', { shiftKey: true });
      const ren = items().find((i) => i.textContent.startsWith('Rename Folder'));
      ren.click();
      await sleep(250);
      results.renameFolderOpens = !!modal() && /Rename folder/.test(modal().textContent);
      await press('Escape');
      await sleep(200);
      results.renameFolderEscBackToRow = !modal() && active() === rowOf('Production');
      // "Move to Folder…" → Esc: back on the row
      rowOf('web-01').focus();
      await press('F10', { shiftKey: true });
      items().find((i) => i.textContent.startsWith('Move to Folder')).click();
      await sleep(250);
      results.moveDialogOpens = !!modal() && /Move to folder/.test(modal().textContent) && active().tagName === 'SELECT';
      await press('Escape');
      await sleep(200);
      results.moveDialogEscBackToRow = !modal() && active() === rowOf('web-01');
      // New folder from the panel head (Enter on the button = click with detail 0) → Esc: back on the button
      const nf = document.querySelector('#panel-sessions [data-action="new-folder"]');
      nf.focus();
      nf.click();
      await sleep(250);
      results.newFolderPromptOpens = !!modal() && /New folder/.test(modal().textContent);
      await press('Escape');
      await sleep(250);
      results.newFolderEscBackToButton = !modal() && active() === nf;
      // a dialog that changes the tree (rename folder, OK) still lands on a row, not on the terminal
      rowOf('Production').focus();
      await press('F10', { shiftKey: true });
      items().find((i) => i.textContent.startsWith('Rename Folder')).click();
      await sleep(250);
      const inp = modal().querySelector('input');
      inp.value = 'Prod';
      await press('Enter');
      await sleep(400);
      results.renameFolderOkKeepsTree = !modal() && !!rowOf('Prod') && active()?.classList.contains('tree-row');
    }

    // ---------- session editor: icon / colour pickers are one Tab stop each ----------
    {
      app.activePane().focus();
      app.action('new-session');
      await sleep(350);
      const m = modal();
      const groups = [...m.querySelectorAll('[role=radiogroup]')];
      const picksOf = (g) => [...g.querySelectorAll('.pick')];
      results.pickerRoles = groups.length === 2 && groups.every((g) => picksOf(g).length > 5 && picksOf(g).every((p) => p.getAttribute('role') === 'radio' && p.hasAttribute('aria-checked'))
        && picksOf(g).filter((p) => p.tabIndex === 0).length === 1 && picksOf(g).filter((p) => p.getAttribute('aria-checked') === 'true').length === 1 && picksOf(g).find((p) => p.tabIndex === 0).getAttribute('aria-checked') === 'true');
      results.pickerTabStops = [...m.querySelectorAll('.pick')].filter((p) => p.tabIndex === 0).length === 2; // 35 before
      const [iconG, colorG] = groups;
      const ip = picksOf(iconG);
      ip[0].focus();
      await press('ArrowRight');
      results.pickerArrowRight = active() === ip[1];
      await press('End');
      results.pickerEnd = active() === ip[ip.length - 1];
      await press('ArrowRight');
      results.pickerWrapsRight = active() === ip[0];
      await press('ArrowLeft');
      results.pickerWrapsLeft = active() === ip[ip.length - 1];
      await press('ArrowUp');
      results.pickerArrowUp = active() === ip[ip.length - 2];
      await press('Home');
      results.pickerHome = active() === ip[0];
      await press('ArrowDown');
      await press('ArrowDown');
      results.pickerArrowDown = active() === ip[2];
      results.pickerFocusVisible = focusVisible(ip[2]);
      await shot('68-icon-picker-roving');
      await realKey('Space'); // chooses (the button's own activation)
      const ip2 = picksOf(iconG);
      results.pickerSpaceChooses = ip2[2].getAttribute('aria-checked') === 'true' && ip2[2].classList.contains('active') && active() === ip2[2]
        && ip2.filter((p) => p.tabIndex === 0).length === 1 && ip2[2].tabIndex === 0 && ip2[0].getAttribute('aria-checked') === 'false';
      await press('ArrowRight');
      await realKey('Enter'); // so does Enter
      const ip3 = picksOf(iconG);
      results.pickerEnterChooses = ip3[3].getAttribute('aria-checked') === 'true' && active() === ip3[3] && ip3[2].getAttribute('aria-checked') === 'false';
      // Tab leaves the group: the next stop is the colour group's single stop, not another icon
      await realKey('Tab');
      results.pickerTabLeavesGroup = active().closest('[role=radiogroup]') === colorG && active().tabIndex === 0 && active().getAttribute('aria-checked') === 'true';
      await press('Tab', { shiftKey: true });
      results.pickerShiftTabBack = active() === ip3[3];
      // after arrowing away without choosing, Tab still leaves the group (the stop follows the focus)
      await press('ArrowRight');
      await press('ArrowRight');
      await realKey('Tab');
      results.pickerTabAfterArrow = active().closest('[role=radiogroup]') === colorG;
      // the mouse still picks, and the picked swatch becomes the stop
      const cp = picksOf(colorG);
      cp[1].click();
      await sleep(50);
      const cp2 = picksOf(colorG);
      results.pickerMouseChooses = cp2[1].getAttribute('aria-checked') === 'true' && cp2[1].tabIndex === 0 && cp2[0].tabIndex === -1 && cp2[0].getAttribute('aria-checked') === 'false';
      results.pickerStopsStillTwo = [...m.querySelectorAll('.pick')].filter((p) => p.tabIndex === 0).length === 2;
      // --- Tunnels page: the Tunnel sub-dialog hands focus back to "＋ Add tunnel", not to Save / the first control
      m.querySelector('.mtabs button:nth-child(4)').click(); // Tunnels
      await sleep(100);
      const addBtn = [...m.querySelectorAll('button')].find((b) => b.textContent.includes('Add tunnel'));
      addBtn.focus();
      addBtn.click();
      await sleep(250);
      results.tunnelFormOpens = modals().length === 2 && modals()[1].contains(active());
      await press('Escape');
      await sleep(200);
      results.tunnelFormEscBackToAdd = modals().length === 1 && active() === addBtn && focusVisible(addBtn);
      await shot('69-tunnel-form-closed-focus-add');
      addBtn.click();
      await sleep(250);
      const sub = modals()[1];
      const nums = sub.querySelectorAll('input[type=number]'), texts = sub.querySelectorAll('input[type=text]');
      nums[0].value = '8080'; // bind port
      texts[2].value = 'localhost'; // destination host
      nums[1].value = '80';
      sub.querySelector('.modal-foot .btn.primary').click();
      await sleep(300);
      results.tunnelFormOkBackToAdd = modals().length === 1 && active() === addBtn && !!m.querySelector('tbody tr');
      // ✕ on the (focused) tunnel row: focus stays in the dialog (next row, else the Add button)
      const x = m.querySelector('tbody button');
      x.focus();
      x.click();
      await sleep(100);
      results.tunnelRemoveKeepsFocus = !m.querySelector('tbody tr') && active() === addBtn;
      await press('Escape');
      await sleep(250);
      const top = [...document.querySelectorAll('.modal')].pop(); // tunnel edits make the editor dirty → discard prompt on top
      if (top && /Discard/.test(top.textContent)) { top.querySelector('.modal-foot .btn.primary').click(); await sleep(250); }
      results.editorClosed = !modal();
    }

    // ---------- Tunnels dialog: "＋ New tunnel…" gets the focus back from its sub-dialog ----------
    {
      app.activePane().focus();
      app.action('tunnels');
      await sleep(400);
      const m = modal();
      const nt = [...m.querySelectorAll('button')].find((b) => b.textContent.includes('New tunnel'));
      results.tunnelsNewEnabled = !!nt && !nt.disabled; // web-01 is an SSH session
      nt.focus();
      nt.click();
      await sleep(250);
      results.tunnelsSubOpens = modals().length === 2;
      await press('Escape');
      await sleep(200);
      results.tunnelsSubEscBackToNew = modals().length === 1 && active() === nt;
      await press('Escape');
      await sleep(200);
      results.tunnelsClosed = !modal() && inTerminal();
    }

    // ---------- tab strip overflow: arrows never drop focus on <body>; focused tabs clear the edge fade ----------
    {
      await window.api.app.testResize(1000, 650);
      await sleep(400);
      while (app.workspace.tabs.length < 8) await app.newLocalTab();
      await sleep(600);
      const left = $('#tab-scroll-left'), right = $('#tab-scroll-right'), tabsEl = $('#tabs'), bar = $('#tabbar');
      await waitFor(() => !left.hidden && right.disabled && !left.disabled, 3000, 'overflow with the active tab at the end');
      results.overflowArrows = true;
      left.focus();
      for (let n = 0; n < 20 && !left.disabled; n++) { left.click(); await sleep(450); } // Space/Enter on the focused ‹ = click
      results.arrowLeftDisabledHandsOff = left.disabled && active() === right && focusVisible(right);
      await shot('70-arrow-handoff');
      for (let n = 0; n < 20 && !right.disabled; n++) { right.click(); await sleep(450); }
      results.arrowRightDisabledHandsOff = right.disabled && active() === left;
      // no overflow any more while ‹ has the focus: the active tab takes it
      await window.api.app.testResize(1400, 650);
      await sleep(500);
      results.arrowHiddenFocusesActiveTab = left.hidden && active() === app.workspace.active.tabEl;
      await window.api.app.testResize(1000, 650);
      await sleep(500);
      // ←/→ keep the focused tab clear of the 18px fade on the overflowing side(s)
      const fade = 18;
      const clearOfFade = () => {
        const r = active().getBoundingClientRect(), b = tabsEl.getBoundingClientRect();
        return r.left >= b.left + (bar.classList.contains('ovf-left') ? fade : 0) - 1 && r.right <= b.right - (bar.classList.contains('ovf-right') ? fade : 0) + 1;
      };
      const last = app.workspace.tabs.length - 1;
      app.workspace.tabs[last].tabEl.focus();
      let clear = true;
      for (let n = 0; n < last; n++) { await press('ArrowLeft'); await sleep(80); if (!clearOfFade()) clear = false; }
      results.tabArrowLeftClearOfFade = clear && active() === app.workspace.tabs[0].tabEl && tabsEl.scrollLeft === 0;
      for (let n = 0; n < last; n++) { await press('ArrowRight'); await sleep(80); if (!clearOfFade()) clear = false; }
      results.tabArrowRightClearOfFade = clear && active() === app.workspace.tabs[last].tabEl;
      await shot('71-tab-focus-clear-of-fade');
      // resizing an overflowing strip back and forth: the arrows toggle without a ResizeObserver loop error
      for (const w of [1300, 900, 1400, 1000, 1100]) { await window.api.app.testResize(w, 650); await sleep(250); }
      results.overflowAfterResizes = !left.hidden;
    }

    // ---------- closing the last tab from the keyboard: ＋ gets the focus ----------
    {
      for (const t of app.workspace.tabs.slice(1)) await app.closeTab(t);
      await sleep(300);
      const t0 = tabEls()[0];
      t0.focus();
      await press('F10', { shiftKey: true }); // menu → Close (third from the end)
      await press('End');
      await press('ArrowUp');
      await press('ArrowUp');
      results.tabMenuCloseItem = active()?.textContent.startsWith('Close') && !active()?.textContent.includes('Others') && !active()?.textContent.includes('All');
      await press('Enter');
      await sleep(300);
      const add = document.getElementById('tab-add');
      results.lastTabMenuCloseFocusesAdd = tabEls().length === 0 && active() === add;
      await app.newLocalTab();
      await sleep(400);
      tabEls()[0].focus();
      await press('Delete');
      await sleep(300);
      results.lastTabDeleteFocusesAdd = tabEls().length === 0 && active() === add && focusVisible(add);
      await shot('72-last-tab-closed-focus-add');
      await app.newLocalTab();
      await sleep(500);
    }

    // ---------- macros list: options with one Tab stop; keys play / menu / delete ----------
    {
      await app.saveSettings({ macros: [{ id: 'm1', name: 'alpha', text: 'echo MACRO_A\r' }, { id: 'm2', name: 'beta', text: 'echo MACRO_B\r' }, { id: 'm3', name: 'gamma', text: 'echo MACRO_C\r' }] });
      app.macrosPanel.render();
      app.showPanel('macros');

      await sleep(100);
      const ml = document.getElementById('macro-list');
      const mrows = () => [...ml.querySelectorAll('.tree-row')];
      results.macroRoles = ml.getAttribute('role') === 'listbox' && mrows().length === 3 && mrows().every((r) => r.getAttribute('role') === 'option' && r.hasAttribute('aria-selected'))
        && mrows().filter((r) => r.tabIndex === 0).length === 1 && mrows()[0].tabIndex === 0;
      mrows()[0].focus();
      await press('ArrowDown');
      results.macroArrowDown = active() === mrows()[1] && mrows()[1].getAttribute('aria-selected') === 'true' && mrows()[1].tabIndex === 0 && mrows()[0].tabIndex === -1;
      await press('End');
      results.macroEnd = active() === mrows()[2];
      await press('Home');
      results.macroHome = active() === mrows()[0] && focusVisible(mrows()[0]);
      await shot('73-macros-focus');
      const pane = app.activePane();
      await press('Enter'); // plays in the active terminal (= double-click)
      results.macroEnterPlays = await waitFor(() => /^MACRO_A$/m.test(text(pane)), 8000, 'macro output').then(() => inTerminal(), () => false);
      mrows()[1].focus();
      await press('F10', { shiftKey: true });
      results.macroMenuOpens = !!ctx() && ctx().textContent.includes('Play in All Terminals') && active() === items()[0];
      await press('Escape');
      results.macroMenuEscBack = !ctx() && active() === mrows()[1];
      await press('ContextMenu');
      results.macroMenuKey = !!ctx();
      await press('Escape');
      await press('Delete');
      await sleep(250);
      results.macroDeleteAsks = !!modal() && /Delete macro "beta"/.test(modal().textContent);
      await press('Escape');
      await sleep(200);
      results.macroDeleteCancelKeeps = mrows().length === 3 && active() === mrows()[1];
      await press('Backspace');
      await sleep(250);
      modal()?.querySelector('.modal-foot .btn.primary').click();
      await sleep(400);
      results.macroDeleteRemoves = mrows().length === 2 && !mrows().some((r) => r.textContent.includes('beta')) && active() === mrows()[1] && mrows()[1].textContent.includes('gamma') && mrows()[1].tabIndex === 0;
      app.showPanel('sessions');
    }

    // ---------- SFTP list (local test sshd; skipped when it is not running) ----------
    {
      const keyDir = app.info.appPath + '/test/sshd-runtime', user = app.info.home.split('/').pop();
      const s = await app.saveSession({ name: 'local sshd', folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: true });
      const opening = app.openSession(s);
      let ready = false;
      try {
        await waitFor(() => $('.modal .btn.primary') || ['connected', 'failed', 'disconnected'].includes(app.activePane()?.status), 15000, 'host key dialog or connection');
        if ($('.modal .btn.primary')) $('.modal .btn.primary').click(); // accept the test host key
        const pane = await opening;
        await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
        await waitFor(() => $('#sftp-list .sftp-row[data-name]:not([data-name=".."])'), 10000, 'sftp listing');
        ready = true;
      } catch (e) {
        log('SFTP checks skipped: no local sshd on 127.0.0.1:2222 (' + e.message + ')');
        if (modal()) modal().querySelector('.modal-title .close')?.click();
      }
      if (ready) {
        app.showPanel('sftp');
        const list = $('#sftp-list');
        list.focus();
        await sleep(50);
        results.sftpListFocusRing = focusVisible(list) && getComputedStyle(list).outlineStyle === 'solid' && getComputedStyle(list).outlineOffset === '-2px';
        await press('ArrowDown');
        await press('ArrowDown');
        const sel = list.querySelector('.sftp-row.selected');
        results.sftpArrowSelects = !!sel && getComputedStyle(sel).boxShadow !== 'none';
        await shot('74-sftp-list-focus');
        await press('F10', { shiftKey: true });
        results.sftpShiftF10RowMenu = !!ctx() && ctx().textContent.includes('Rename') && active() === items()[0];
        await press('Escape');
        results.sftpMenuEscBackToList = !ctx() && active() === list;
        app.sftpPanel.clearSelection();
        await press('ContextMenu'); // nothing selected: the background menu
        results.sftpMenuKeyBackground = !!ctx() && !ctx().textContent.includes('Rename') && ctx().textContent.includes('Upload Files Here');
        await press('Escape');
        await press('ArrowDown');
        await press('F10', { shiftKey: true });
        items().find((i) => i.textContent.startsWith('Rename')).click(); // a dialog from the menu hands focus back to the list
        await sleep(250);
        results.sftpRenameOpens = !!modal() && /Rename/.test(modal().textContent);
        await press('Escape');
        await sleep(200);
        results.sftpRenameEscBackToList = !modal() && active() === list;
        app.showPanel('sessions');
        await app.closeTab(app.activePane().tab);
        await sleep(300);
      }
    }
    results.noResizeObserverLoop = roErrors === 0;
  } catch (e) {

    results.error = e.message;
    console.error('[e2e-a11y] FAIL', e.message, e.stack);
    await shot('99-a11y-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('FAILED ' + JSON.stringify(Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k)));
  log('DONE');
  await sleep(200);
  window.api.app.quit();
})();
