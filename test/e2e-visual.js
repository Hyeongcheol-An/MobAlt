// Renderer-side visual-consistency checks: one icon style, token radii/heights, narrow sidebar, FTP panel, DNS output.
//   python3 test/ftpd.py <root> 2121 demo demo &          # for the FTP "follow folder" check (pyftpdlib)
//   test/qa/run.sh test/e2e-visual.js <out-dir>
// Screenshots: toolbar + sidebar panels, a dialog and the find bar in moba-dark and light, plus a 180px sidebar.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-visual]', ...a);
  const app = window.app;
  const results = {};
  const closeModal = () => document.querySelector('.modal .close')?.click();
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const emoji = /\p{Extended_Pictographic}/u;
  const radii = new Set(['4px', '6px', '10px']);
  const px = (el, prop) => getComputedStyle(el)[prop];
  try {
    await window.api.app.testResize(1200, 760);
    await app.saveSettings({ confirmClose: false, sftpAutoOpen: false, theme: 'moba-dark' });
    await app.saveSession({ name: 'web-01', folder: 'Production', type: 'ssh', host: 'web-01.example.com', username: 'deploy', icon: '🐧', color: '#4caf50' });
    await app.saveSession({ name: 'db-01', folder: 'Production', type: 'ssh', host: 'db-01.example.com', username: 'postgres' });
    await app.saveSettings({ macros: [{ id: 'm1', name: 'hello', text: 'echo hi\r' }] });
    app.macrosPanel.render();

    // --- 1. one icon style: no emoji code points in the chrome buttons, SVG icons present
    const chromeButtons = [...document.querySelectorAll('#toolbar button, #side-strip button, .sftp-toolbar button, .panel-head .icon-btn, #find-bar button')];
    const emojiButtons = chromeButtons.filter((b) => emoji.test(b.textContent));
    results.noEmojiInChrome = emojiButtons.length === 0;
    if (emojiButtons.length) log('emoji buttons:', emojiButtons.map((b) => b.outerHTML.slice(0, 80)));
    results.toolbarSvgIcons = document.querySelectorAll('#toolbar .tb-btn .ico svg.i').length === 7;
    results.sftpSvgIcons = document.querySelectorAll('.sftp-toolbar .icon-btn svg.i').length === 8;
    results.stripToggleSvg = !!document.querySelector('.strip-btn[data-action="toggle-sidebar"] svg.i');

    // --- 2. one radius / height scale (dialog buttons need a dialog open)
    app.action('new-session');
    await sleep(400);
    const controls = [...document.querySelectorAll('.btn, .tb-btn, .tools-form button, .icon-btn, #find-bar button, .quick input, .quick button, .panel-head input')];
    const badRadius = controls.filter((el) => !radii.has(px(el, 'borderRadius')));
    results.tokenRadii = badRadius.length === 0;
    if (badRadius.length) log('bad radii:', badRadius.map((el) => `${el.className || el.id}=${px(el, 'borderRadius')}`));
    results.splitButtonRounded = px(document.getElementById('btn-split'), 'borderRadius') === '6px';
    const dialogControls = [...document.querySelectorAll('.modal .btn:not(.small), .modal .form-grid input[type=text], .modal .form-grid select')].filter((el) => el.offsetParent !== null);
    results.dialogControls28 = dialogControls.length > 5 && dialogControls.every((el) => el.getBoundingClientRect().height === 28);
    results.dialogRadiusL = px(document.querySelector('.modal'), 'borderRadius') === '10px';
    results.typePickerEmojiOnly = [...document.querySelectorAll('.modal .type-picker .ico')].every((el) => emoji.test(el.textContent));
    await shot('60-dialog-moba-dark');
    closeModal();
    await sleep(200);
    results.panelControls26 = [...document.querySelectorAll('.tools-form button, .tools-form input, .icon-btn, .panel-head input')].every((el) => el.getBoundingClientRect().height === 26 || el.offsetParent === null);

    // --- 3. themes: toolbar, sidebar panels, find bar, toast in dark and light
    for (const theme of ['moba-dark', 'light']) {
      await app.saveSettings({ theme });
      await sleep(250);
      app.showPanel('sessions'); await sleep(150);
      await shot(`61-sessions-${theme}`);
      app.showPanel('tools'); await sleep(150);
      await shot(`62-tools-${theme}`);
      app.showPanel('macros'); await sleep(150);
      await shot(`63-macros-${theme}`);
      app.action('find'); await sleep(150);
      await shot(`64-find-${theme}`);
      app.action('find-close');
      import('./ui.js').then((ui) => ui.toast('Settings saved', 'success'));
      await sleep(150);
      await shot(`65-toast-${theme}`);
      await sleep(3500);
    }
    // the empty-pane card stays readable on the light theme: its text follows the terminal foreground
    await app.action('split', 'right');
    await sleep(300);
    const ph = document.querySelector('.pane-placeholder');
    results.placeholderThemeFg = !!ph && px(ph, 'color') === 'rgb(31, 35, 40)' && px(ph, 'backgroundColor') === 'rgb(255, 255, 255)';
    await shot('66-empty-pane-light');
    await app.closePane(app.activePane(), true);
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(200);

    // --- 4. DNS: explicit "(no MX records)" / "(no TXT records)" for a name, PTR message for an IP
    app.showPanel('tools');
    const host = document.getElementById('tool-host');
    const out = document.getElementById('tool-output');
    host.value = 'localhost';
    document.querySelector('[data-tool="lookup"]').click();
    await waitFor(() => /no MX/.test(out.textContent), 5000, 'dns localhost');
    results.dnsNoMx = /\(no MX records\)/.test(out.textContent) && /\(no TXT records\)/.test(out.textContent);
    host.value = '127.0.0.1';
    document.querySelector('[data-tool="lookup"]').click();
    await waitFor(() => /PTR/.test(out.textContent), 5000, 'dns 127.0.0.1');
    results.dnsIpPtr = /PTR/.test(out.textContent);
    log('dns output:', out.textContent.trim().replace(/\n/g, ' | '));

    // --- 5. narrow sidebar: tools rows and the footer fit at 180px
    document.documentElement.style.setProperty('--sidebar-w', '180px');
    await window.api.app.testResize(1000, 650);
    await sleep(300);
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    const toolBtns = [...document.querySelectorAll('.tools-form button')];
    results.toolsFitNarrow = toolBtns.every((b) => { const r = b.getBoundingClientRect(); return r.right <= sb.right + 0.5 && r.width > 20 && b.scrollWidth <= b.clientWidth + 1; });
    await shot('67-narrow-tools');
    app.showPanel('macros'); await sleep(150);
    const rec = document.getElementById('macro-record').getBoundingClientRect();
    results.recFitsNarrow = rec.right <= sb.right && rec.height === 26 && document.getElementById('macro-record').scrollWidth <= document.getElementById('macro-record').clientWidth + 1;
    results.macroHeadOneLine = document.querySelector('#panel-macros .panel-head').getBoundingClientRect().height < 44;
    await shot('68-narrow-macros');
    app.showPanel('sessions'); await sleep(150);
    const links = [...document.querySelectorAll('.panel-foot .link-btn')];
    results.footerNotEllipsized = links.every((l) => l.scrollWidth <= l.clientWidth + 1 && px(l, 'textOverflow') !== 'ellipsis' && l.getBoundingClientRect().right <= sb.right);
    await shot('69-narrow-sessions');

    // --- 6. FTP: the "Follow terminal folder" option is hidden (FTP has no terminal)
    try {
      const ftp = await app.saveSession({ name: 'demo ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'demo', password: 'demo', sftpAuto: false });
      const pane = await app.openSession(ftp);
      await waitFor(() => pane.status === 'connected', 8000, 'ftp connected (python3 test/ftpd.py <root> 2121 demo demo)');
      app.showPanel('sftp');
      await sleep(500);
      const follow = document.getElementById('sftp-follow').closest('label');
      results.ftpFollowHidden = follow.hidden && follow.offsetParent === null && !document.getElementById('sftp-ui').hidden;
      results.sftpToolbarNoEmoji = ![...document.querySelectorAll('.sftp-toolbar button')].some((b) => emoji.test(b.textContent));
      results.sftpToolbarFitsNarrow = [...document.querySelectorAll('.sftp-toolbar button')].every((b) => b.getBoundingClientRect().right <= sb.right + 0.5);
      await shot('70-narrow-sftp-ftp');
      await pane.disconnect();
    } catch (e) {
      results.ftpFollowHidden = false;
      log('ftp check skipped/failed:', e.message);
    }

    // --- 7. status bar: version and X11 share the bar's font size and colour
    const bar = document.getElementById('statusbar');
    const same = (id) => px(document.getElementById(id), 'fontSize') === px(bar, 'fontSize') && px(document.getElementById(id), 'color') === px(bar, 'color');
    results.statusBarUniform = same('st-version') && same('st-x11') && px(document.getElementById('st-x11'), 'opacity') === '1';

    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-visual] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-visual-fail').catch(() => {});
  }
  await sleep(300);
  window.api.app.quit();
})();
