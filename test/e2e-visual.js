// Renderer-side visual-consistency checks: one icon style, token radii/heights, the global theme, narrow sidebar, FTP panel, DNS output.
//   python3 test/ftpd.py <root> 2121 demo demo &          # for the FTP checks (pyftpdlib; the root needs a dot-file or two); another port: replace __FTP_PORT__ below
//   test/start-sshd.sh start                                # for the Tunnels error-line check (skipped when the sshd is down)
//   test/qa/run.sh test/e2e-visual.js <out-dir> 150000
// Screenshots: toolbar + sidebar panels, a dialog and the find bar in moba-dark and light; for every theme the main window,
// the session editor, Settings, a context menu, the toasts and the banners at 1400×900 (80-…85-<theme>); a 180px sidebar;
// the qa4 theme pass (86-…92-<theme>: disabled buttons, a coloured zoomed pane, an own-theme tab, the keyboard ring on a selected
// row, the focused danger menu item, the Tunnels error line, the password field); hidden SFTP rows and the FTP cards per theme.
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
      results[`themePreviewOutline-${theme}`] = !!prev && ratio(parseColor(px(prev, 'borderTopColor')), parseColor(px(prev, 'backgroundColor'))) >= 1.5; // the chip is framed (Solarized's bright black equals its background)
      await shot(`82-${theme}-settings`);
      closeModal();
      await sleep(200);
      const row = rowOf('db-01'), rr = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 60, clientY: rr.top + 12 }));
      await sleep(150);
      measure([['menu item', sel('.ctx .ctx-item')], ['menu key', sel('.ctx .ctx-item .k')], ['menu danger item', sel('.ctx .ctx-item.danger')]]);
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

    // --- 3c. qa4 theme pass: per theme, what the first pass did not measure — a coloured session's pane head and tree
    //         dot, the ZOOMED chip, a danger menu item while focused, the keyboard ring on a selected row and on a menu
    //         item, disabled buttons, the Tunnels error line, the LOG indicator, "Invalid pattern", prompt / password
    //         fields, text selection in fields, the terminal selection band, and a tab whose pane has its own theme.
    const dialogs = await import('./dialogs.js');
    const bgBehind = (el) => { for (let e = el; e; e = e.parentElement) { const c = parseColor(px(e, 'backgroundColor')); if (c && c.a >= 0.9) return c; } return { r: 30, g: 30, b: 30 }; };
    const shadowColor = (s) => parseColor((/rgba?\([^)]+\)|color\(srgb [^)]+\)/.exec(s || '') || [''])[0]);
    const escModal = () => { const m = [...document.querySelectorAll('.modal')].pop(); (m || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); };
    // keyboard modality: a programmatic focus matches :focus-visible once a real key was pressed (F19: a no-op key);
    // another window may take the key when several Electron instances run, so it is retried once
    const focusVisibly = async (el) => {
      for (let i = 0; i < 3; i++) {
        el.focus({ preventScroll: true });
        await sleep(60);
        if (el.matches(':focus-visible')) return true;
        await window.api.app.testKey('F19');
        await sleep(200);
      }
      return false;
    };
    await window.api.app.testResize(1400, 900);
    await app.saveSettings({ logDir: app.info.userData + '/logs' }); // the LOG indicator writes a file: into the test user data
    const amber = await app.saveSession({ name: 'amber shell', folder: 'Test', type: 'local', color: '#e6b422' });
    const amberPane = await app.openSession(amber);            // its own tab: the colour on the tab stripe
    await sleep(400);
    await app.action('split', 'right');                        // pane heads are shown in a split
    await sleep(300);
    app.focusPane(amberPane);
    await app.action('zoom-pane');                             // the ZOOMED chip on its head
    await sleep(300);
    const amberTab = amberPane.tab;
    const ownTheme = await app.saveSession({ name: 'dracula shell', folder: 'Test', type: 'local', theme: 'dracula' });
    const draculaPane = await app.openSession(ownTheme);
    await sleep(400);
    const draculaTab = draculaPane.tab;
    app.workspace.activate(amberTab);
    app.focusPane(amberPane);
    await amberPane.toggleLog(true);                           // ● LOG in the status bar
    await sleep(200);
    app.action('find');
    await sleep(150);
    const findRegex = document.getElementById('find-regex'), findInput = document.getElementById('find-input');
    findRegex.checked = true; findRegex.dispatchEvent(new Event('change', { bubbles: true }));
    findInput.value = '['; findInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    results.badPatternShown = document.getElementById('find-bar').classList.contains('bad-pattern');
    // a tunnel that fails (its bind port is the sshd's own) through a real connection to the local test sshd, when it is up
    let tunnelPane = null;
    try {
      const keyDir = app.info.appPath + '/test/sshd-runtime', user = app.info.home.split('/').pop();
      const sshd = await app.saveSession({ name: 'local sshd', folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });
      const opening = app.openSession(sshd);
      await waitFor(() => document.querySelector('.modal .btn.primary') || (app.activePane() && app.activePane().status === 'failed'), 8000, 'host key dialog');
      document.querySelector('.modal .btn.primary')?.click();
      tunnelPane = await opening;
      await waitFor(() => tunnelPane.status === 'connected', 15000, 'sshd connected');
      await window.api.tunnels.start({ connId: tunnelPane.termId, type: 'local', name: 'port in use', bindHost: '127.0.0.1', bindPort: 2222, destHost: '127.0.0.1', destPort: 22 });
      await sleep(300);
      const list = await window.api.tunnels.list();
      results.tunnelFailedAsExpected = list.some((t) => t.status === 'error' && !!t.error);
      log('tunnel:', JSON.stringify(list.map((t) => [t.status, t.error])));
    } catch (e) {
      results.tunnelFailedAsExpected = 'skipped';
      log('tunnel error line not checked (needs test/start-sshd.sh start):', e.message);
      escModal();
    }
    // disabled buttons are dimmed, with no hover and an arrow cursor (once: the rule is the same on every theme)
    app.action('settings');
    await sleep(400);
    const dis = ui.h('button', { class: 'btn primary', disabled: true }, 'Disabled'), dis2 = ui.h('button', { class: 'btn', disabled: true }, 'Disabled');
    document.querySelector('.modal .modal-foot').prepend(dis, dis2);
    results.disabledButtonsDimmed = parseFloat(px(dis, 'opacity')) <= 0.6 && px(dis, 'cursor') === 'default' && px(dis, 'pointerEvents') === 'none' && parseFloat(px(dis2, 'opacity')) <= 0.6 && px(dis2, 'cursor') === 'default';
    await shot('86-disabled-buttons');
    closeModal();
    await sleep(200);
    for (const theme of Object.keys(THEMES)) {
      await app.saveSettings({ theme });
      await sleep(250);
      const pal = chromePalette(THEMES[theme], theme), term = THEMES[theme];
      const checks = [], notes = []; // [what, ratio|null, min]
      const measure = (pairs) => pairs.forEach(([what, el, min = 4.5]) => checks.push([what, el ? contrastOf(el) : null, min]));
      const pair = (what, fg, bg, min) => checks.push([what, fg && bg ? ratio(fg, bg) : null, min]);
      // the amber session: its zoomed, focused pane head (title in the chrome text colour, the chip and its border), its tree dot
      app.workspace.activate(amberTab);
      app.focusPane(amberPane);
      await sleep(150);
      const head = amberPane.el.querySelector('.pane-head'), badge = amberPane.zoomBadge, headTitle = head.querySelector('.title');
      measure([['pane-head title (coloured session)', headTitle], ['ZOOMED chip', badge]]);
      pair('ZOOMED chip border', parseColor(px(badge, 'borderTopColor')), bgBehind(head), 3);
      results[`sessionColourNotText-${theme}`] = amberPane.el.style.getPropertyValue('--pane-color') === '#e6b422' && px(headTitle, 'color') !== 'rgb(230, 180, 34)' && px(head, 'boxShadow').includes('rgb(230, 180, 34)');
      const th = amberPane.term.options.theme;
      results[`xtermSelectionVisible-${theme}`] = ratio(parseColor(th.selectionBackground), parseColor(term.background)) >= 2;
      app.showPanel('sessions');
      await sleep(100);
      const amberRow = rowOf('amber shell'), swatch = amberRow && amberRow.querySelector('.ico.swatch');
      const sw = swatch && getComputedStyle(swatch, '::before');
      results[`sessionColourIsADot-${theme}`] = !!sw && sw.backgroundColor === 'rgb(230, 180, 34)' && !amberRow.querySelector('.ico').textContent;
      pair('tree dot ring', sw && shadowColor(sw.boxShadow), amberRow && bgBehind(amberRow), 3);
      // status bar LOG indicator and the find bar's "Invalid pattern"
      measure([['status LOG', sel('#st-log.on')], ['find invalid pattern', sel('#find-bar.bad-pattern .find-count')]]);
      // a pane with its own theme: its tab is painted in that theme; a pane on the global theme follows the global one
      app.workspace.activate(draculaTab);
      await sleep(150);
      const dt = draculaTab.tabEl;
      results[`ownThemeTab-${theme}`] = dt.classList.contains('active') && px(dt, 'backgroundColor') === rgbOf(THEMES.dracula.background) && px(dt.querySelector('.title'), 'color') === rgbOf(THEMES.dracula.foreground) && px(draculaPane.el, 'backgroundColor') === rgbOf(THEMES.dracula.background);
      measure([['own-theme tab title', dt.querySelector('.title')]]);
      if (theme === 'light') await shot('87-light-own-theme-tab');
      app.workspace.activate(amberTab);
      await sleep(150);
      results[`globalThemeTab-${theme}`] = px(amberTab.tabEl, 'backgroundColor') === rgbOf(term.background) && px(amberTab.tabEl.querySelector('.title'), 'color') === rgbOf(term.foreground);
      await shot(`88-${theme}-zoomed-amber`);
      // the keyboard ring on the selected row: visible against the blue fill and against the panel around it
      app.showPanel('sessions');
      const dbRow = rowOf('db-01');
      app.sessionTree.reveal(app.sessions.sessions.find((s) => s.name === 'db-01'));
      await sleep(100);
      if (await focusVisibly(dbRow)) {
        const ring = parseColor(px(dbRow, 'outlineColor'));
        pair('selected row ring vs fill', ring, parseColor(px(dbRow, 'backgroundColor')), 3);
        pair('selected row ring vs panel', ring, bgBehind(dbRow.parentElement), 3);
        await shot(`89-${theme}-row-ring`);
      } else notes.push('row ring not measured (no :focus-visible)');
      // the context menu: the focused item's ring, the danger item plain and focused
      const rr = dbRow.getBoundingClientRect();
      dbRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 60, clientY: rr.top + 12 }));
      await sleep(150);
      const first = sel('.ctx .ctx-item'), danger = sel('.ctx .ctx-item.danger'), menuBg = bgBehind(sel('.ctx'));
      measure([['danger item', danger]]);
      if (await focusVisibly(first)) {
        const ring = parseColor(px(first, 'outlineColor'));
        pair('menu focus ring vs fill', ring, parseColor(px(first, 'backgroundColor')), 3);
        pair('menu focus ring vs menu', ring, menuBg, 3);
      } else notes.push('menu ring not measured (no :focus-visible)');
      if (danger && await focusVisibly(danger)) {
        measure([['danger item focused', danger], ['danger item key focused', danger.querySelector('.k')]]);
        results[`dangerFocusFill-${theme}`] = px(danger, 'backgroundColor') === rgbOf(pal['danger-fill']);
        await shot(`90-${theme}-menu-danger-focused`);
      } else notes.push('danger item focus not measured');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(100);
      // the Tunnels dialog: the error line under the "error" badge
      if (results.tunnelFailedAsExpected === true) {
        app.action('tunnels');
        await sleep(500);
        const badge = sel('.modal .list-table .badge.error');
        measure([['tunnel error line', badge && badge.parentElement.querySelector('.form-help')]]);
        if (theme === 'moba-dark' || theme === 'light') await shot(`91-${theme}-tunnels-error`);
        closeModal();
        await sleep(200);
      }
      // prompt / password / keyboard-interactive fields sit on the input surface, like every other field
      ui.promptDialog('Rename tab', { value: 'amber' });
      await sleep(150);
      const pin = sel('.modal input[type=text]');
      results[`promptInputSurface-${theme}`] = !!pin && px(pin, 'backgroundColor') === rgbOf(pal['bg-input']);
      escModal();
      await sleep(150);
      dialogs.passwordDialog({ title: 'Password', message: 'Password for demo@host' });
      await sleep(150);
      const pw = sel('.modal input[type=password]');
      results[`passwordInputSurface-${theme}`] = !!pw && px(pw, 'backgroundColor') === rgbOf(pal['bg-input']);
      if (theme === 'light') await shot('92-light-password');
      escModal();
      await sleep(150);
      dialogs.kbdIntDialog({ name: 'Authentication', label: 'host', prompts: [{ prompt: 'Verification code:', echo: false }] });
      await sleep(150);
      const ki = sel('.modal input[type=password]');
      results[`kbdIntInputSurface-${theme}`] = !!ki && px(ki, 'backgroundColor') === rgbOf(pal['bg-input']);
      escModal();
      await sleep(150);
      results[`promptsClosed-${theme}`] = !document.querySelector('.modal');
      // text selection in fields follows the theme
      const selStyle = getComputedStyle(document.getElementById('qc-input'), '::selection');
      results[`inputSelectionThemed-${theme}`] = selStyle.backgroundColor === rgbOf(pal.selection) && selStyle.color === rgbOf(pal['selection-fg']);
      const low = checks.filter(([, r, min]) => r !== null && r < min), missing = checks.filter(([, r]) => r === null).map(([what]) => what);
      results[`qa4Contrast-${theme}`] = low.length === 0 && missing.length === 0;
      log(theme, 'qa4 | measured', checks.length - missing.length, '| below target:', low.length ? JSON.stringify(low) : 'none', missing.length ? '| missing: ' + missing.join(', ') : '', notes.length ? '| ' + notes.join('; ') : '');
    }
    findInput.value = ''; findInput.dispatchEvent(new Event('input', { bubbles: true }));
    findRegex.checked = false; findRegex.dispatchEvent(new Event('change', { bubbles: true }));
    app.action('find-close');
    await amberPane.toggleLog(false);
    document.querySelectorAll('.toast').forEach((t) => { clearTimeout(t._timer); t.remove(); });
    await app.saveSettings({ theme: 'moba-dark' });
    for (const t of [draculaTab, amberTab, tunnelPane && tunnelPane.tab].filter(Boolean)) await app.closeTab(t);
    await sleep(300);
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
      // dot-files (Show hidden) are dimmed as a colour, not an opacity: name and size still read at 4.5:1 on every theme
      const hiddenCb = document.getElementById('sftp-hidden');
      hiddenCb.checked = true;
      hiddenCb.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => document.querySelector('.sftp-row.hidden-file'), 5000, 'hidden rows (the FTP root needs dot-files)');
      for (const theme of Object.keys(THEMES)) {
        await app.saveSettings({ theme });
        await sleep(250);
        const hr = document.querySelector('.sftp-row.hidden-file:not(.dir)'), hd = document.querySelector('.sftp-row.hidden-file.dir');
        const name = hr ? contrastOf(hr.querySelector('.name')) : 0, size = hr ? contrastOf(hr.querySelector('.size')) : 0, dirName = hd ? contrastOf(hd.querySelector('.name')) : 4.5;
        results[`hiddenRowsReadable-${theme}`] = name >= 4.5 && size >= 4.5 && dirName >= 4.5 && !!hr && px(hr, 'opacity') === '1';
        log(theme, 'hidden rows: name', name, 'size', size, 'dir', dirName);
        if (theme === 'light' || theme === 'solarized-dark') await shot(`74-hidden-rows-${theme}`);
      }
      await app.saveSettings({ theme: 'moba-dark' });
      await sleep(200);
      hiddenCb.checked = false;
      hiddenCb.dispatchEvent(new Event('change', { bubbles: true }));
      await pane.disconnect();
    } catch (e) {
      results.ftpFollowHidden = false;
      log('ftp check skipped/failed:', e.message);
    }

    // --- 6b. the FTP card on every theme: the dead / failed card's title, hint and error line clear 4.5:1 on the card
    //         (the error box's border 3:1); Solarized's dim text left no room for any dimming
    try {
      const dead = await app.openSession(app.sessions.sessions.find((s) => s.name === 'demo ftp'));
      await waitFor(() => dead.status === 'connected', 8000, 'ftp connected again');
      await dead.disconnect();
      await sleep(500);
      const deadCard = dead.el.querySelector('.pane-placeholder.ftp-info');
      const bad = await app.saveSession({ name: 'bad ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: ftpPort, username: 'demo', password: 'wrong', sftpAuto: false });
      const failed = await app.openSession(bad);
      await waitFor(() => failed.el.querySelector('.pane-placeholder.ftp-info.failed'), 8000, 'ftp login failed');
      await sleep(500);
      const failedCard = failed.el.querySelector('.pane-placeholder.ftp-info'), err = failedCard.querySelector('.ftp-err');
      const bgBehindCard = (el) => { for (let e = el; e; e = e.parentElement) { const c = parseColor(px(e, 'backgroundColor')); if (c && c.a >= 0.9) return c; } return null; };
      for (const theme of Object.keys(THEMES)) {
        await app.saveSettings({ theme });
        await sleep(250);
        const deadBig = contrastOf(deadCard.querySelector('.big')), deadHint = contrastOf(deadCard.querySelector('.hint'));
        const failedBig = contrastOf(failedCard.querySelector('.big')), failedHint = contrastOf(failedCard.querySelector('.hint')), errRatio = err ? contrastOf(err) : 0;
        const errBorder = err ? ratio(parseColor(px(err, 'borderTopColor')), bgBehindCard(err)) : 0;
        results[`ftpCardsReadable-${theme}`] = deadCard.classList.contains('disconnected') && deadBig >= 4.5 && deadHint >= 4.5 && failedBig >= 4.5 && failedHint >= 4.5 && errRatio >= 4.5 && errBorder >= 3;
        log(theme, 'ftp card contrast: dead', deadBig, deadHint, '| failed', failedBig, failedHint, '| error', errRatio, 'border', errBorder);
        if (theme === 'light' || theme === 'solarized-dark') {
          app.workspace.activate(dead.tab); await sleep(100); await shot(`71-ftp-disconnected-${theme}`);
          app.workspace.activate(failed.tab); await sleep(100); await shot(`72-ftp-failed-${theme}`);
        }
      }
      results.ftpDeadCardReadableLight = results['ftpCardsReadable-light'];
      results.ftpFailedCardReadableLight = results['ftpCardsReadable-light'];
      await app.closePane(failed, true);
      await app.closePane(dead, true);
    } catch (e) {
      results.ftpDeadCardReadableLight = false;
      log('ftp card check skipped/failed:', e.message);
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
