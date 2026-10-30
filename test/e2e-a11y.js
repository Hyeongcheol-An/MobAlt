// Keyboard accessibility checks: tab strip, session tree, context menus, dialog focus trap, toolbar.
// Everything is driven with dispatched KeyboardEvents; no SSH server needed.
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
  const focusVisible = (el) => !!el && el.matches(':focus-visible');
  const inTerminal = () => !!active()?.closest('.xterm');
  const ctx = () => document.querySelector('#ctx-root .ctx');
  const items = () => [...(ctx()?.querySelectorAll('.ctx-item') || [])];
  const tabEls = () => [...document.querySelectorAll('#tabs .tab')];
  const rows = () => app.sessionTree.visibleRows();
  const rowOf = (name) => rows().find((r) => r.querySelector('.label')?.textContent === name);
  const labels = () => rows().map((r) => r.querySelector('.label').textContent).join('|');
  const modal = () => document.querySelector('.modal');
  try {
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
    app.action('shortcuts');
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
      results.modalEscCloses = !modal() && inTerminal();
    }
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
