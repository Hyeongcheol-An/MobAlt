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
    document.getElementById('tool-host').value = '127.0.0.1';
    document.querySelector('[data-tool="ping"]').click();
    await sleep(3500);
    results.ping = /bytes from 127\.0\.0\.1/.test(document.getElementById('tool-output').textContent);
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
