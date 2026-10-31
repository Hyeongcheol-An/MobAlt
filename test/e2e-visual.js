// Renderer-side visual-consistency checks: one icon style, token radii/heights, the global theme, narrow sidebar, FTP panel, DNS output.
//   python3 test/ftpd.py <root> 2121 demo demo &          # for the FTP checks (pyftpdlib); another port: replace __FTP_PORT__ below
//   test/qa/run.sh test/e2e-visual.js <out-dir> 150000
// Screenshots: toolbar + sidebar panels, a dialog and the find bar in moba-dark and light; for every theme the main window,
// the session editor, Settings, a context menu, the toasts and the banners at 1400×900 (80-…85-<theme>); a 180px sidebar.
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
  const ftpPort = Number('__FTP_PORT__') || 2121; // the runner may substitute the placeholder (a second ftpd beside the default one)
  // WCAG contrast: between two colours, or of an element's text (its opacity applied) over the nearest opaque background behind it
  const parseColor = (c) => {
    let m = /^rgba?\(([^)]+)\)/.exec(c);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; }
    m = /^color\(srgb ([^)]+)\)/.exec(c); // what color-mix() computes to
    if (m) { const [r, g, b, a = 1] = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a }; }
    m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
    return null;
  };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return Math.round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) * 100) / 100; };
  const contrastOf = (el) => {
    let bg = null;
    for (let e = el; e && !bg; e = e.parentElement) { const c = parseColor(px(e, 'backgroundColor')); if (c && c.a >= 0.9) bg = c; }
    bg = bg || { r: 30, g: 30, b: 30 };
    const fg = parseColor(px(el, 'color')), op = parseFloat(px(el, 'opacity')) || 1;
    return ratio({ r: fg.r * op + bg.r * (1 - op), g: fg.g * op + bg.g * (1 - op), b: fg.b * op + bg.b * (1 - op) }, bg);
  };
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
    app.activePane().term.input('clear; for i in 1 2 3; do echo "needle $i in the haystack"; done\r'); // something for the find bar to highlight
    await sleep(800);
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
      // the match and active-match highlights follow the palette: readable under the theme's text (no fixed grey / yellow any more)
      const deco = app.findDecorations(), pal = app.activePane().themeFor();
      results[`findMatchReadable-${theme}`] = ratio(parseColor(deco.matchBackground), parseColor(pal.foreground)) >= 4.5 && ratio(parseColor(deco.activeMatchBackground), parseColor(pal.foreground)) >= 4.5 && deco.matchBackground !== '#515c6a';
      const fi = document.getElementById('find-input');
      fi.value = 'needle'; fi.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      await shot(`64-find-${theme}`);
      fi.value = ''; fi.dispatchEvent(new Event('input', { bubbles: true }));
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

    // --- 3b. global theme: every theme recolours the whole window (toolbar, sidebar, tabs, status bar, dialogs, menus,
    //         toasts, banners, cards). Per theme at 1400×900: screenshots of each surface, the window colour and
    //         color-scheme the theme asks for (page and main process), and 4.5:1 text everywhere in the chrome.
    const { THEMES, chromePalette } = await import('./theme.js');
    const ui = await import('./ui.js');
    const sel = (s) => document.querySelector(s);
    const rgbOf = (hex) => { const c = parseColor(hex); return `rgb(${c.r}, ${c.g}, ${c.b})`; };
    const rowOf = (name) => app.sessionTree.visibleRows().find((r) => r.querySelector('.label')?.textContent === name);
    await window.api.app.testResize(1400, 900);
    await app.newLocalTab();                                   // a second tab: an inactive tab label to measure
    await sleep(400);
    await app.action('split', 'right');                        // split terminals; the new pane shows the empty-pane card
    await sleep(300);
    app.sessionTree.reveal(app.sessions.sessions.find((s) => s.name === 'web-01')); // a selected row
    const chromeBgs = new Map();
    let updNo = 0;
    for (const theme of Object.keys(THEMES)) {
      await app.saveSettings({ theme });
      await sleep(250);
      const pal = chromePalette(THEMES[theme], theme), root = document.documentElement;
      chromeBgs.set(theme, px(document.body, 'backgroundColor'));
      const chrome = await window.api.app.testChrome();
      results[`chromeApplied-${theme}`] = px(root, 'colorScheme') === pal.scheme && root.dataset.theme === theme && px(document.body, 'backgroundColor') === rgbOf(pal.bg)
        && !!chrome && chrome.scheme === pal.scheme && String(chrome.background).toLowerCase() === pal.bg && chrome.stored && chrome.stored.background === pal.bg;
      app.showPanel('sessions');
      await sleep(100);
      const checks = []; // [what, ratio|null]: measured while the element is on screen (menus, toasts and dialogs are gone later)
      const measure = (pairs) => pairs.forEach(([what, el]) => checks.push([what, el ? contrastOf(el) : null]));
      measure([
        ['toolbar label', sel('#toolbar .tb-btn')], ['brand', sel('.brand')], ['quick connect', sel('#qc-input')], ['strip button', sel('.strip-btn span')],
        ['sidebar row', rowOf('db-01')?.querySelector('.label')], ['sidebar row sub', rowOf('db-01')?.querySelector('.sub')],
        ['selected row', sel('.tree-row.selected .label')], ['selected row sub', sel('.tree-row.selected .sub')],
        ['active tab', sel('.tab.active .title')], ['inactive tab', sel('.tab:not(.active) .title')],
        ['status bar', sel('#st-session')], ['status cwd', sel('#st-cwd')], ['status version', sel('#st-version')],
        ['placeholder card', sel('.pane-placeholder .big')], ['placeholder hint', sel('.pane-placeholder .hint')], ['footer link', sel('.panel-foot .link-btn')],
      ]);
      await shot(`80-${theme}-main`);
      app.editSession(app.sessions.sessions.find((s) => s.name === 'web-01'));
      await sleep(400);
      measure([['dialog title', sel('.modal .modal-title')], ['dialog label', sel('.modal .form-grid label')], ['dialog input', sel('.modal .form-grid input[type=text]')],
        ['dialog select', sel('.modal .form-grid select')], ['dialog help', sel('.modal .form-help')], ['dialog tab', sel('.modal .mtabs button:not(.active)')],
        ['dialog tab active', sel('.modal .mtabs button.active')], ['dialog button', sel('.modal .modal-foot .btn:not(.primary)')], ['primary button', sel('.modal .modal-foot .btn.primary')]]);
      await shot(`81-${theme}-editor`);
      closeModal();
      await sleep(200);
      app.action('settings');
      await sleep(400);
      measure([['settings label', sel('.modal .form-grid label')], ['settings check label', sel('.modal .checks label')], ['settings small button', sel('.modal .btn.small')]]);
      const prev = sel('.modal .theme-preview'); // the preview is painted in the theme's own terminal colours, whatever the chrome
      results[`themePreviewOwnColours-${theme}`] = !!prev && px(prev, 'backgroundColor') === rgbOf(THEMES[theme].background) && px(prev, 'color') === rgbOf(THEMES[theme].foreground);
      await shot(`82-${theme}-settings`);
      closeModal();
      await sleep(200);
      const row = rowOf('db-01'), rr = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 60, clientY: rr.top + 12 }));
      await sleep(150);
      measure([['menu item', sel('.ctx .ctx-item')], ['menu key', sel('.ctx .ctx-item .k')], ['menu danger item', sel('.ctx .ctx-item[style]')]]); // (the hovered item's colours: unit test)
      await shot(`83-${theme}-menu`);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(100);
      for (const type of ['info', 'success', 'warn', 'error']) ui.toast(`${type} toast: ${theme}`, type, 60000);
      await sleep(200);
      measure([...document.querySelectorAll('.toast')].map((t) => [`toast ${t.className.split(' ')[1]}`, t]));
      await shot(`84-${theme}-toasts`);
      document.querySelectorAll('.toast').forEach((t) => { clearTimeout(t._timer); t.remove(); });
      await window.api.app.testBundleUpdated(`0.13.${updNo++}`);
      await sleep(200);
      app.action('multiexec');
      await sleep(200);
      measure([['multiexec banner', sel('#multiexec-banner')], ['update banner', sel('#update-banner-text')], ['update banner bold', sel('#update-banner b')], ['update later', sel('#update-later')], ['update relaunch', sel('#update-relaunch')]]);
      await shot(`85-${theme}-banners`);
      app.action('multiexec');
      app.showUpdateBanner(false);
      await sleep(100);
      document.querySelectorAll('.toast').forEach((t) => { clearTimeout(t._timer); t.remove(); }); // the MultiExec ON/OFF toasts
      const low = checks.filter(([, r]) => r !== null && r < 4.5), missing = checks.filter(([, r]) => r === null).map(([what]) => what);
      results[`chromeContrast-${theme}`] = low.length === 0 && missing.length === 0;
      log(theme, 'chrome', pal.bg, pal.scheme, '| measured', checks.length - missing.length, '| below 4.5:1:', low.length ? JSON.stringify(low) : 'none', missing.length ? '| missing: ' + missing.join(', ') : '');
    }
    results.chromeDistinct = new Set(chromeBgs.values()).size === Object.keys(THEMES).length;
    log('chrome backgrounds:', JSON.stringify([...chromeBgs]));
    await app.closePane(app.activePane(), true);               // the empty pane (the second tab stays)
    await app.saveSettings({ theme: 'moba-dark' });
    await window.api.app.testResize(1200, 760);
    await sleep(300);

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
      const ftp = await app.saveSession({ name: 'demo ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: ftpPort, username: 'demo', password: 'demo', sftpAuto: false });
      const pane = await app.openSession(ftp);
      await waitFor(() => pane.status === 'connected', 8000, `ftp connected (python3 test/ftpd.py <root> ${ftpPort} demo demo)`);
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

    // --- 6b. the FTP card on the light theme: the dead / failed card's title, hint and error line clear 4.5:1 on the white card
    try {
      await app.saveSettings({ theme: 'light' });
      await sleep(250);
      const dead = await app.openSession(app.sessions.sessions.find((s) => s.name === 'demo ftp'));
      await waitFor(() => dead.status === 'connected', 8000, 'ftp connected again');
      await dead.disconnect();
      await sleep(500);
      const deadCard = dead.el.querySelector('.pane-placeholder.ftp-info');
      const deadBig = contrastOf(deadCard.querySelector('.big')), deadHint = contrastOf(deadCard.querySelector('.hint'));
      results.ftpDeadCardReadableLight = deadCard.classList.contains('disconnected') && deadBig >= 4.5 && deadHint >= 4.5;
      await shot('71-ftp-disconnected-light');
      const bad = await app.saveSession({ name: 'bad ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: ftpPort, username: 'demo', password: 'wrong', sftpAuto: false });
      const failed = await app.openSession(bad);
      await waitFor(() => failed.el.querySelector('.pane-placeholder.ftp-info.failed'), 8000, 'ftp login failed');
      await sleep(500);
      const failedCard = failed.el.querySelector('.pane-placeholder.ftp-info'), err = failedCard.querySelector('.ftp-err');
      const failedBig = contrastOf(failedCard.querySelector('.big')), failedHint = contrastOf(failedCard.querySelector('.hint')), errRatio = err ? contrastOf(err) : 0;
      results.ftpFailedCardReadableLight = failedBig >= 4.5 && failedHint >= 4.5 && errRatio >= 4.5;
      log('ftp card contrast on light: dead', deadBig, deadHint, '| failed', failedBig, failedHint, '| error', errRatio);
      await shot('72-ftp-failed-light');
      await app.closePane(failed, true);
      await app.closePane(dead, true);
    } catch (e) {
      results.ftpDeadCardReadableLight = false;
      log('ftp light check skipped/failed:', e.message);
    }
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(200);

    // --- 7. status bar: version and X11 share the bar's font size and colour
    const bar = document.getElementById('statusbar');
    const same = (id) => px(document.getElementById(id), 'fontSize') === px(bar, 'fontSize') && px(document.getElementById(id), 'color') === px(bar, 'color');
    results.statusBarUniform = same('st-version') && same('st-x11') && px(document.getElementById('st-x11'), 'opacity') === '1';

    // --- 8. banners at the 900 px minimum width (default 280 px sidebar): the update banner's call to action never ends
    //        up as a one-word line, nothing is clipped, and both banners sit above the tabs
    document.documentElement.style.setProperty('--sidebar-w', '280px');
    await window.api.app.testResize(900, 560);
    await sleep(300);
    await window.api.app.testBundleUpdated('0.12.1');
    await sleep(250);
    app.action('multiexec');
    await sleep(200);
    const ub = document.getElementById('update-banner'), ubText = document.getElementById('update-banner-text'), keep = ub.querySelector('.keep');
    const range = document.createRange();
    range.selectNodeContents(ubText);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const lineWidths = [...new Set(rects.map((r) => Math.round(r.top)))].map((t) => { const rs = rects.filter((r) => Math.round(r.top) === t); return Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)); });
    results.bannerKeepOneLine = !ub.hidden && !!keep && keep.getClientRects().length === 1 && lineWidths.length <= 2 && lineWidths.every((w) => w > 100);
    results.bannerNotClipped = ub.scrollWidth <= ub.clientWidth + 1 && ubText.scrollWidth <= ubText.clientWidth + 1 && [...ub.querySelectorAll('button')].every((b) => b.getBoundingClientRect().right <= ub.getBoundingClientRect().right);
    results.bothBannersAboveTabs = !document.getElementById('multiexec-banner').hidden && ub.getBoundingClientRect().bottom <= document.getElementById('tabbar').getBoundingClientRect().top + 0.5;
    log('update banner at 900px:', lineWidths.length, 'line(s) of', lineWidths.map(Math.round).join('/'), 'px, bar height', Math.round(ub.getBoundingClientRect().height));
    await shot('73-banners-900');
    app.action('multiexec');
    app.showUpdateBanner(false);

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
