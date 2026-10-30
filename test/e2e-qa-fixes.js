// Regression checks for the issues found by the QA pass (dialogs, sidebar, terminal, find bar, empty state).
//   MOBALT_USER_DATA=... MOBALT_TEST_SCRIPT=test/e2e-qa-fixes.js MOBALT_SHOT_DIR=... MOBALT_SCREENSHOT=... MOBALT_SCREENSHOT_DELAY=90000 npx electron .
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-qa]', ...a);
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
  const closeModal = () => document.querySelector('.modal .close')?.click();
  try {
    await app.saveSettings({ confirmClose: false });

    // --- session editor: grid layout, focus on first field, port follows type, port validation, dirty confirm
    app.action('new-session');
    await sleep(400);
    results.editorGrid = getComputedStyle(document.querySelector('.modal .mpage.active')).display === 'grid';
    results.editorFocusFirst = document.activeElement?.tagName === 'INPUT' && document.activeElement.closest('.modal-body') !== null;
    const typeBtns = [...document.querySelectorAll('.modal .type-picker button')];
    results.typeCount = typeBtns.length; // 8 incl. Mosh and FTP
    const portEl = () => [...document.querySelectorAll('.modal label')].find((l) => l.textContent === 'Port')?.nextElementSibling;
    typeBtns.find((b) => b.textContent.includes('Telnet')).click();
    typeBtns.find((b) => b.textContent.includes('RDP')).click();
    results.portFollowsType = portEl()?.value === '3389';
    typeBtns.find((b) => b.textContent.includes('SSH')).click();
    results.portBackToSsh = portEl()?.value === '22';
    const hostEl = document.querySelector('.modal input[placeholder^="hostname"]');
    hostEl.value = 'web-01.example.com';
    hostEl.dispatchEvent(new Event('input', { bubbles: true }));
    portEl().value = '70000';
    document.querySelector('.modal .modal-foot .btn.primary').click();
    await sleep(200);
    results.badPortRejected = !!document.querySelector('.modal .type-picker') && document.getElementById('toast-root').textContent.includes('65535');
    // Esc with changes → discard confirmation (a second, narrow modal)
    document.querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    results.dirtyConfirm = document.querySelectorAll('.modal').length === 2;
    await shot('50-editor-discard-confirm');
    document.querySelector('.modal.narrow .btn.primary')?.click(); // Discard
    await sleep(250);
    results.editorClosedAfterDiscard = !document.querySelector('.modal');

    // --- editor: shared rows survive a type round-trip; tunnel edits mark the editor dirty; ports are integers
    app.action('new-session');
    await sleep(300);
    {
      const btns = [...document.querySelectorAll('.modal .type-picker button')];
      const click = (label) => btns.find((b) => b.textContent.includes(label)).click();
      click('Mosh'); click('SSH');
      const keyInput = document.querySelector('.modal input[placeholder="~/.ssh/id_ed25519"]');
      results.keyRowAfterMoshRoundTrip = !!keyInput && keyInput.offsetParent !== null && !!keyInput.closest('.mpage.active');
      click('FTP'); click('SSH');
      const clearCb = [...document.querySelectorAll('.modal .mpage.active label')].find((l) => l.textContent.includes('Clear saved password'));
      results.clearPwAfterFtpRoundTrip = !!clearCb && clearCb.offsetParent !== null;
      document.querySelector('.modal input[placeholder^="hostname"]').value = 'h.example.com';
      const portInput = [...document.querySelectorAll('.modal label')].find((l) => l.textContent === 'Port')?.nextElementSibling;
      portInput.value = '12.5';
      document.querySelector('.modal .modal-foot .btn.primary').click();
      await sleep(150);
      results.fractionalPortRejected = !!document.querySelector('.modal .type-picker');
      portInput.value = '22';
      document.querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(250);
      document.querySelector('.modal.narrow .btn.primary')?.click(); // discard the typed host
      await sleep(200);
    }
    // removing a tunnel row marks the editor dirty → Esc asks before discarding
    {
      const withTunnel = await app.saveSession({ name: 'tun', type: 'ssh', host: 't.example.com', username: 'u', tunnels: [{ type: 'local', bindHost: '127.0.0.1', bindPort: 18080, destHost: 'localhost', destPort: 80, enabled: true }] });
      app.editSession(withTunnel);
      await sleep(300);
      document.querySelectorAll('.modal .mtabs button')[3].click();
      await sleep(100);
      document.querySelector('.modal .mpage.active tbody button')?.click();
      await sleep(100);
      document.querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(250);
      results.tunnelRemoveMarksDirty = document.querySelectorAll('.modal').length === 2;
      document.querySelector('.modal.narrow .btn.primary')?.click();
      await sleep(200);
      results.tunnelKeptAfterDiscard = (app.sessions.sessions.find((x) => x.id === withTunnel.id)?.tunnels || []).length === 1;
      await app.deleteSession(withTunnel.id); // keeps the renderer session list in sync
    }

    // --- tunnel form: host inputs usable
    app.action('tunnels');
    await sleep(300);
    results.tunnelsNoSessionDisabled = !!document.querySelector('.modal .btn.primary.small')?.disabled;
    closeModal();
    await sleep(150);

    // --- sidebar: filter without matches shows the empty state; root menu from the gutter
    await app.saveSession({ name: 'db-01', folder: 'Production/EU', type: 'ssh', host: 'db-01.example.com', username: 'postgres' });
    await app.saveSession({ name: 'Project shell', type: 'local', cwd: '/tmp' });
    await sleep(200);
    const filter = document.getElementById('session-filter');
    filter.value = 'zzzz';
    filter.dispatchEvent(new Event('input'));
    await sleep(100);
    results.filterEmptyState = !!document.querySelector('#session-tree .tree-empty');
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    await sleep(100);
    document.querySelector('#session-tree .tree-children')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 200 }));
    await sleep(100);
    results.gutterRootMenu = document.getElementById('ctx-root').textContent.includes('New Folder');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    // --- local tab title follows the folder; the sidebar dot appears for a connected local session
    const local = app.sessions.sessions.find((s) => s.name === 'Project shell');
    await app.openSession(local);
    await sleep(800);
    const pane = await app.newLocalTab(); // plain local tab: title follows the folder
    await sleep(1200);
    pane.term.input('cd /private/tmp\r');
    await waitFor(() => pane.tab.title === 'tmp', 6000, 'local tab title follows cwd');
    results.localTitleFromCwd = true;
    results.localDot = !!document.querySelector('#session-tree .tree-row[data-session] .dot');
    results.themeVarOnPane = /^#|^rgb/.test(getComputedStyle(pane.el).getPropertyValue('--term-bg').trim());

    // --- find bar: case toggle re-runs the search and the counter shows numbers
    pane.term.input("printf 'Hello hello HELLO hallo\\n'\r");
    await sleep(600);
    app.action('find');
    const fi = document.getElementById('find-input');
    fi.value = 'hello';
    fi.dispatchEvent(new Event('input'));
    await sleep(300);
    const countBefore = document.getElementById('find-count').textContent;
    const caseCb = document.getElementById('find-case');
    caseCb.checked = true;
    caseCb.dispatchEvent(new Event('change'));
    await sleep(300);
    const countAfter = document.getElementById('find-count').textContent;
    results.findCounter = /\d+ \/ \d+/.test(countBefore);
    results.findCaseRerun = countBefore !== countAfter && /\/ 1$/.test(countAfter.trim()) === false && countAfter !== '';
    log('find counts', countBefore, '→', countAfter);
    caseCb.checked = false;
    await shot('51-find-bar');
    app.action('find-close');

    // --- tab → pane drag with a real drag: the dragged tab must not become active mid-drag
    const second = await app.newLocalTab();
    await sleep(600);
    const tabs = app.workspace.tabs;
    const before = tabs.length;
    const srcTab = tabs[tabs.length - 2], dstTab = tabs[tabs.length - 1];
    app.workspace.activate(dstTab);
    await sleep(200);
    const r1 = srcTab.tabEl.getBoundingClientRect();
    const r2 = dstTab.activePane.el.getBoundingClientRect();
    await window.api.app.testDrag({ x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 }, { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 });
    await sleep(600);
    results.tabDragMovesTerminal = app.workspace.tabs.length === before - 1 && dstTab.panes().length === 2 && app.workspace.active === dstTab;
    await shot('52-after-tab-drag');

    // --- empty workspace hint after closing the last tab; a dropped session reopens
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    await sleep(300);
    results.emptyWorkspaceHint = !!document.querySelector('#tab-content .workspace-empty');
    await shot('53-empty-workspace');

    // --- status bar path shortening
    app.setStatusCwd('/' + 'a'.repeat(80) + '/leaf');
    results.statusCwdShort = document.getElementById('st-cwd').textContent.startsWith('…') && document.getElementById('st-cwd').textContent.endsWith('/leaf');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-qa] FAIL', e.message, e.stack);
    await shot('99-qa-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
