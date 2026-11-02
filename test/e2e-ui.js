// Renderer-side UI check: dialogs, panels and importers (no SSH server needed).
//   MOBALT_TEST_SCRIPT=test/e2e-ui.js MOBALT_SHOT_DIR=/tmp/shots MOBALT_SCREENSHOT=/tmp/shots/final.png MOBALT_SCREENSHOT_DELAY=60000 npx electron .
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-ui]', ...a);
  const app = window.app;
  const results = {};
  const closeModal = () => document.querySelector('.modal .close')?.click();
  try {
    // the side strip names the panel as the protocol is written: SFTP
    results.sftpStripLabel = document.querySelector('.strip-btn[data-panel="sftp"] span').textContent.trim() === 'SFTP';

    // session editor
    app.action('new-session');
    await sleep(400);
    results.editorOpen = !!document.querySelector('.modal .type-picker');
    // icon/colour pickers must render buttons, not "[object HTMLButtonElement]" text
    results.editorNoObjectText = !document.querySelector('.modal').textContent.includes('[object ');
    results.editorPickButtons = document.querySelectorAll('.modal .pick-row button').length;
    document.querySelector('.modal input[placeholder^="hostname"]').value = 'example.com';
    document.querySelectorAll('.modal .mtabs button')[1].click(); // Advanced SSH
    await sleep(200);
    await shot('10-session-editor-advanced');
    document.querySelectorAll('.modal .mtabs button')[3].click(); // Tunnels
    await sleep(200);
    await shot('11-session-editor-tunnels');
    closeModal();
    await sleep(200);

    // settings
    app.action('settings');
    await sleep(400);
    results.settingsOpen = !!document.querySelector('.modal select');
    await shot('12-settings');
    closeModal();
    await sleep(200);

    // tunnels manager
    app.action('tunnels');
    await sleep(500);
    results.tunnelsOpen = /SSH Tunnels/.test(document.querySelector('.modal .modal-title')?.textContent || '');
    await shot('13-tunnels');
    closeModal();
    await sleep(200);

    // import ~/.ssh/config
    const imp = await window.api.sessions.importSshConfig();
    await app.reloadSessions();
    results.importSshConfig = imp;
    app.showPanel('sessions');
    await sleep(300);
    await shot('14-sessions-imported');

    // tools: ping localhost
    app.showPanel('tools');
    const toolOut = () => document.getElementById('tool-output').textContent;
    document.getElementById('tool-host').value = '127.0.0.1';
    document.querySelector('[data-tool="ping"]').click();
    await sleep(3500);
    results.ping = /bytes from 127\.0\.0\.1/.test(toolOut());
    // QA4-08: DNS started while a ping still runs owns the output — the killed ping's late "[stopped]" line is dropped
    const until = async (fn, ms) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(100); return fn(); };
    document.querySelector('[data-tool="ping"]').click();
    await until(() => /bytes from/.test(toolOut()), 10000);
    document.getElementById('tool-host').value = 'localhost';
    document.querySelector('[data-tool="lookup"]').click();
    await until(() => /\n  (A {3}|AAAA|no records|error:|\(no )/.test(toolOut()), 10000);
    await sleep(1500); // time for the ping's "[stopped]" to arrive — and be ignored
    results.toolSwitchNoStaleLine = toolOut().startsWith('Resolving localhost…\n') && !/\[stopped\]|bytes from|PING/.test(toolOut());
    if (!results.toolSwitchNoStaleLine) log('tool output after switching:', JSON.stringify(toolOut()));
    document.querySelector('[data-tool="netinfo"]').click();
    await sleep(500);
    results.netinfo = /Hostname:/.test(document.getElementById('tool-output').textContent);
    await shot('15-tools');

    // macros: create + play into the local terminal
    app.showPanel('macros');
    await app.saveSettings({ macros: [{ id: 'm1', name: 'hello', text: 'echo MACRO_OK\r' }] });
    app.macrosPanel.render();
    const pane = app.activePane();
    app.macrosPanel.play(app.settings.macros[0]);
    await sleep(800);
    const lines = [];
    for (let i = 0; i < pane.term.buffer.active.length; i++) lines.push(pane.term.buffer.active.getLine(i)?.translateToString(true));
    results.macro = /^MACRO_OK$/m.test(lines.join('\n'));
    await shot('16-macros');

    // find bar + quick connect parse + shortcuts dialog
    app.action('find');
    await sleep(200);
    results.findBar = !document.getElementById('find-bar').hidden;
    app.action('find-close');
    app.action('shortcuts');
    await sleep(300);
    await shot('17-shortcuts');
    closeModal();

    // sidebar toggle + tab rename flow (programmatic)
    app.toggleSidebar();
    await sleep(200);
    results.sidebarCollapsed = document.getElementById('sidebar').classList.contains('collapsed');
    app.toggleSidebar();
    app.showPanel('sessions');

    // local session: start folder + startup commands must apply (not only for SSH)
    {
      const s = await app.saveSession({ name: 'startup-test', type: 'local', cwd: '/private/tmp', startupCommand: 'echo MOBALT_STARTUP_$((20+22)); pwd' });
      const pane = await app.openSession(s);
      await sleep(3000);
      const lines = [];
      for (let i = 0; i < pane.term.buffer.active.length; i++) lines.push(pane.term.buffer.active.getLine(i)?.translateToString(true));
      const text = lines.join('\n');
      results.localStartupRan = /MOBALT_STARTUP_42/.test(text);
      results.localStartFolder = /^\/private\/tmp$/m.test(text);
      await shot('18-local-startup');
      await window.api.sessions.remove(s.id);
    }

    // a shell that ends on the bottom row: the dim "── Session ended. … ──" line stays readable above the
    // Reconnect / Close strip (the strip is taller than one row and covers the last rows of the terminal)
    {
      const pane = await app.newLocalTab();
      await sleep(1200);
      pane.term.input('seq 1 300; exit 3\r'); // a non-zero status: the pane stays, marked dead, after the screen filled
      for (let i = 0; i < 100 && !pane.dead; i++) await sleep(100);
      await sleep(400);
      const buf = pane.term.buffer.active;
      let row = -1;
      for (let i = buf.length - 1; i >= 0; i--) if (/Session ended/.test(buf.getLine(i)?.translateToString(true) || '')) { row = i; break; }
      const sr = pane.el.querySelector('.xterm-screen').getBoundingClientRect(), rowH = sr.height / pane.term.rows;
      const y = row - buf.viewportY, lineBottom = sr.top + (y + 1) * rowH, stripTop = pane.overlay ? pane.overlay.getBoundingClientRect().top : -1;
      results.deadLineAboveStrip = pane.dead && row >= 0 && y >= 0 && y < pane.term.rows && lineBottom <= stripTop + 1;
      if (!results.deadLineAboveStrip) log('deadLine', JSON.stringify({ dead: pane.dead, row, y, rows: pane.term.rows, lineBottom, stripTop }));
      await shot('19-dead-line-above-strip');
      // Reconnect: the new shell starts one blank row below the dead line, as it did before the padding
      await pane.reconnect();
      await sleep(1500);
      const rowsText = []; for (let i = row; i < buf.length && i < row + 6; i++) rowsText.push(pane.term.buffer.active.getLine(i)?.translateToString(true) || '');
      results.reconnectOneBlankRow = pane.status === 'connected' && rowsText[1].trim() === '' && rowsText[2].trim() !== '';
      if (!results.reconnectOneBlankRow) log('reconnect rows', JSON.stringify(rowsText));
      // a shell that ends high on the screen gets no padding at all
      const fresh = await app.newLocalTab();
      await sleep(1000);
      fresh.term.input('clear; exit 4\r');
      for (let i = 0; i < 60 && !fresh.dead; i++) await sleep(100);
      await sleep(400);
      results.noPadHighUp = fresh.dead && fresh._deadPad === 0;
      await app.closePane(fresh, true);
      await app.closePane(pane, true);
      await sleep(300);
    }

    // the find bar closes with the last tab: it does not stay over the "No terminal open" card
    {
      await app.saveSettings({ confirmClose: false });
      while (app.workspace.tabs.length) { await app.closeTab(app.workspace.tabs[0]); await sleep(150); }
      const pane = await app.newLocalTab();
      await sleep(600);
      app.action('find');
      await sleep(150);
      const openBefore = !document.getElementById('find-bar').hidden;
      await app.closeTab(pane.tab);
      await sleep(400);
      results.findBarClosesWithLastTab = openBefore && !app.workspace.tabs.length && document.getElementById('find-bar').hidden && !document.body.classList.contains('find-open') && !!document.querySelector('#tab-content .workspace-empty');
      await shot('20-no-tab-no-find-bar');
    }

    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-ui] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-ui-fail').catch(() => {});
  }
  await sleep(300);
  window.api.app.quit();
})();
