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
    // editor title: a ~200-char session name is clipped with an ellipsis inside the dialog (the full name is its tooltip)
    {
      const longName = 'very-long-session-name-' + 'abcdefghij'.repeat(18);
      const sl = await app.saveSession({ name: longName, type: 'ssh', host: 'long.example.com', username: 'u' });
      app.editSession(sl);
      await sleep(300);
      const modal = document.querySelector('.modal'), titleEl = modal.querySelector('.modal-title'), txt = titleEl.querySelector('.modal-title-text');
      const mr = modal.getBoundingClientRect(), cr = titleEl.querySelector('.close').getBoundingClientRect();
      results.longTitleClipped = !!txt && txt.scrollWidth > txt.clientWidth && getComputedStyle(txt).textOverflow === 'ellipsis' && titleEl.scrollWidth <= titleEl.clientWidth + 1 && txt.getBoundingClientRect().right <= mr.right;
      results.longTitleTooltip = !!txt && txt.title === `Edit session — ${longName}` && txt.textContent === `Edit session — ${longName}`;
      results.longTitleCloseInside = cr.left >= mr.left && cr.right <= mr.right && cr.left > txt.getBoundingClientRect().right - 1;
      await shot('50b-editor-long-title');
      closeModal();
      await sleep(200);
      await app.deleteSession(sl.id);
    }

    // --- tunnel form: host inputs usable
    app.action('tunnels');
    await sleep(300);
    results.tunnelsNoSessionDisabled = !!document.querySelector('.modal .btn.primary.small')?.disabled;
    closeModal();
    await sleep(150);

    // --- settings: four section tabs (General / Terminal / Logging / Updates), each fits the 900×560 minimum window
    //     without scrolling; the first field of the first tab is focused; "Check now" and its status line are on
    //     Updates; a field changed on any tab round-trips through Save (and Cancel keeps the saved values)
    {
      const size0 = { w: window.outerWidth, h: window.outerHeight };
      await window.api.app.testResize(900, 560);
      await sleep(300);
      const before = { ...app.settings };
      app.action('settings');
      await sleep(400);
      const m = document.querySelector('.modal'), body = m.querySelector('.modal-body');
      const tabs = [...m.querySelectorAll('.mtabs button')];
      results.settingsTabNames = tabs.map((b) => b.textContent).join('|') === 'General|Terminal|Logging|Updates';
      results.settingsFirstFieldFocused = document.activeElement === m.querySelector('.mpage.active input[type=text]') && m.querySelector('.mpage.active') === m.querySelector('.mpage') && tabs[0].classList.contains('active');
      const fit = {};
      for (const b of tabs) {
        b.click();
        await sleep(80);
        const page = m.querySelector('.mpage.active');
        fit[b.textContent] = !!page && page.id === b.getAttribute('aria-controls') && b.classList.contains('active') && m.querySelectorAll('.mpage.active').length === 1
          && body.scrollHeight <= body.clientHeight && body.scrollWidth <= body.clientWidth && page.scrollWidth <= page.clientWidth
          && m.getBoundingClientRect().bottom <= window.innerHeight && m.getBoundingClientRect().right <= window.innerWidth;
        await shot(`56-settings-${b.textContent.toLowerCase()}-900x560`);
      }
      log('settings tabs at 900×560', JSON.stringify(fit));
      results.settingsTabsFit900x560 = Object.keys(fit).length === 4 && Object.values(fit).every(Boolean);
      const upd = m.querySelector('.mpage.active'); // Updates is in front now
      results.settingsCheckNowOnUpdates = tabs[3].classList.contains('active') && [...upd.querySelectorAll('button')].some((x) => x.textContent === 'Check now') && !!upd.querySelector('.upd-status');
      const fieldOf = (root, txt) => [...root.querySelectorAll('.form-grid > label')].find((l) => l.textContent === txt)?.nextElementSibling;
      const cbOf = (root, txt) => [...root.querySelectorAll('.checks label')].find((l) => l.textContent.includes(txt))?.querySelector('input[type=checkbox]');
      tabs[0].click(); fieldOf(m, 'SSH keep-alive (s)').value = '45'; cbOf(m, 'Confirm quit').checked = true;
      tabs[1].click(); fieldOf(m, 'Font size').value = '15'; fieldOf(m, 'Theme').value = 'dracula'; cbOf(m, 'Copy on select').checked = true;
      tabs[2].click(); fieldOf(m, 'Log folder').value = '/private/tmp/mobalt-logs-roundtrip'; cbOf(m, 'Strip colours').checked = true;
      tabs[3].click(); cbOf(m, 'Check for updates').checked = false;
      m.querySelector('.modal-foot .btn.primary').click(); // Save
      await sleep(400);
      const s = app.settings;
      results.settingsRoundTripSaved = !document.querySelector('.modal') && s.keepAliveInterval === 45 && s.confirmClose === true && s.fontSize === 15 && s.theme === 'dracula'
        && s.copyOnSelect === true && s.logDir === '/private/tmp/mobalt-logs-roundtrip' && s.logPlainText === true && s.autoUpdate === false;
      app.action('settings');
      await sleep(400);
      const m2 = document.querySelector('.modal');
      results.settingsRoundTripShown = fieldOf(m2, 'SSH keep-alive (s)').value === '45' && cbOf(m2, 'Confirm quit').checked && fieldOf(m2, 'Font size').value === '15' && fieldOf(m2, 'Theme').value === 'dracula'
        && cbOf(m2, 'Copy on select').checked && fieldOf(m2, 'Log folder').value === '/private/tmp/mobalt-logs-roundtrip' && cbOf(m2, 'Strip colours').checked && !cbOf(m2, 'Check for updates').checked;
      fieldOf(m2, 'Font size').value = '20';
      m2.querySelector('.modal-foot .btn').click(); // Cancel
      await sleep(200);
      results.settingsCancelKeepsSaved = !document.querySelector('.modal') && app.settings.fontSize === 15;
      await app.saveSettings({ keepAliveInterval: before.keepAliveInterval, confirmClose: false, fontSize: before.fontSize, theme: before.theme, copyOnSelect: before.copyOnSelect, logDir: before.logDir, logPlainText: before.logPlainText, autoUpdate: before.autoUpdate });
      await window.api.app.testResize(size0.w, size0.h);
      await sleep(300);
    }

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

    // --- a session tab keeps its session's name and icon while a helper shell split into it is used (shell focused,
    //     tab switched, workspace saved); the shell's folder names the tab only once the session pane is gone
    const iconic = await app.saveSession({ name: 'Icon shell', type: 'local', cwd: '/tmp', icon: '🐧', color: '#4caf50' });
    const sp = await app.openSession(iconic);
    await waitFor(() => sp.status === 'connected', 8000, 'icon shell');
    const stab = sp.tab;
    const shownTab = () => ({ title: stab.tabEl.querySelector('.title').textContent, icon: stab.tabEl.querySelector('.tabico').textContent, iconHidden: stab.tabEl.querySelector('.tabico').hidden });
    results.sessionTabNamed = stab.title === 'Icon shell' && stab.icon === '🐧' && shownTab().icon === '🐧' && !shownTab().iconHidden;
    await app.splitActive('right', sp);
    const helper = app.activePane();
    await helper.becomeLocal();
    await waitFor(() => helper.status === 'connected' && helper.title !== 'Local', 8000, 'helper shell titled by its folder');
    await sleep(300);
    results.sessionTabKeptWithHelper = app.activePane() === helper && stab.title === 'Icon shell' && stab.icon === '🐧' && shownTab().title === 'Icon shell' && shownTab().icon === '🐧' && !shownTab().iconHidden;
    app.focusPane(sp);
    await sleep(200);
    results.sessionTabKeptOnRefocus = stab.title === 'Icon shell' && stab.icon === '🐧';
    app.workspace.activate(second.tab);
    await sleep(200);
    app.workspace.activate(stab);
    await sleep(200);
    results.sessionTabKeptAfterSwitch = stab.title === 'Icon shell' && stab.icon === '🐧' && shownTab().title === 'Icon shell';
    const wsTab = app.serializeWorkspace().tabs.find((t) => t.root.t === 'split' && t.icon === '🐧');
    results.sessionTabSaved = !!wsTab && wsTab.title === 'Icon shell' && wsTab.color === '#4caf50';
    await shot('54-session-tab-with-helper');
    await app.closePane(sp, true);
    await sleep(300);
    results.helperNamesTabAlone = stab.panes().length === 1 && stab.title === helper.title && stab.title !== 'Icon shell' && !stab.icon && shownTab().iconHidden;
    log('tab after the session pane closed:', JSON.stringify(shownTab()));

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
