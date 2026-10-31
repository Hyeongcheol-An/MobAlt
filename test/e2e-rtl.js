// Right-to-left interface (Arabic): <html dir="rtl"> mirrors the chrome — the side strip and the sidebar on the right
// edge, the terminals on the left, toasts bottom-left, menus opening towards the left of the pointer and staying in the
// window, the dialog's ✕ on the left of its title — while the terminal, the technical fields (quick connect, paths)
// and the split directions keep their left-to-right / physical meaning. Switching back to English restores it all.
//   env -u ELECTRON_RUN_AS_NODE MOBALT_LANG=ar test/qa/run.sh test/e2e-rtl.js <out-dir> 180000
// (without an Arabic dictionary the labels stay English: the direction follows the language code, not the strings)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-rtl]', ...a);
  const app = window.app;
  const results = {};
  const failed = [];
  const check = (name, ok, detail) => { results[name] = !!ok; if (!ok) { failed.push(name); log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
  const ui = await import('./ui.js');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; };
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const inside = (r) => r.left >= 0 && r.top >= 0 && r.right <= W() && r.bottom <= H();
  const closeModals = async () => { for (let i = 0; i < 6 && document.querySelector('.modal'); i++) { document.querySelector('.modal .close')?.click(); await sleep(200); document.querySelector('.modal.narrow .btn.primary')?.click(); await sleep(150); } };
  const closeMenu = async () => { document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); ui.closeContextMenu(); await sleep(120); };
  try {
    await app.saveSettings({ confirmClose: false });
    await window.api.app.testResize(900, 560);
    await sleep(500);
    log('lang', document.documentElement.lang, 'window', W() + 'x' + H());
    check('documentRtl', document.dir === 'rtl' && document.documentElement.dir === 'rtl' && getComputedStyle(document.body).direction === 'rtl', { dir: document.dir, lang: document.documentElement.lang });

    // ---- layout: side strip + sidebar on the right edge, terminals on the left, the resizer between them ----
    if (!app.workspace.tabs.length) { app.action('new-local'); await sleep(1200); }
    const strip = rect(document.querySelector('#side-strip')), side = rect(document.querySelector('#sidebar'));
    const content = rect(document.querySelector('#tab-content')), resizer = rect(document.querySelector('#sidebar-resizer'));
    check('stripAtRightEdge', Math.abs(strip.r - W()) <= 1, { strip, W: W() });
    check('sidebarRightOfTerminals', side.l >= content.r - 1 && side.r <= strip.l + 1 && side.l > W() / 2, { side, content, strip });
    check('terminalsOnTheLeft', content.l <= 1 && content.r <= side.l + 1, content);
    check('resizerBetween', resizer.r <= side.l + 1 && resizer.l >= content.r - 1, { resizer, side, content });
    // toolbar: the brand at the right, quick connect towards the left (the traffic lights keep their 86px on the left)
    const brand = rect(document.querySelector('#toolbar .brand')), qc = document.querySelector('#qc-input'), qcr = rect(qc);
    check('toolbarMirrored', brand.r > W() - 40 && qcr.l < brand.l && qcr.l >= 86, { brand, qcr });
    // status bar: the session text at the right, the version at the left
    const st = rect(document.querySelector('#st-session')), ver = rect(document.querySelector('#st-version'));
    check('statusbarMirrored', st.r > ver.r && st.r > W() - 40, { st, ver });

    // ---- LTR islands ----
    const pane = app.activePane();
    const term = pane && pane.el.querySelector('.pane-term'), xt = pane && pane.el.querySelector('.xterm');
    check('terminalLtr', !!term && getComputedStyle(term).direction === 'ltr' && term.getAttribute('dir') === 'ltr' && !!xt && getComputedStyle(xt).direction === 'ltr', term && getComputedStyle(term).direction);
    qc.value = 'user@example.com:2222'; qc.dispatchEvent(new Event('input'));
    check('quickConnectLtr', getComputedStyle(qc).direction === 'ltr', getComputedStyle(qc).direction);
    qc.value = '';
    check('quickConnectHintRtl', getComputedStyle(qc).direction === 'rtl', getComputedStyle(qc).direction); // the placeholder (a sentence) reads right to left
    check('sftpPathLtr', getComputedStyle(document.querySelector('#sftp-path')).direction === 'ltr');
    check('cwdLtr', getComputedStyle(document.querySelector('#st-cwd')).direction === 'ltr');
    const tabTitle = document.querySelector('#tabs .tab .title');
    check('tabTitleBidiAuto', !!tabTitle && getComputedStyle(tabTitle).unicodeBidi === 'plaintext', tabTitle && getComputedStyle(tabTitle).unicodeBidi);

    // a value put into a sentence (a path, a host) is isolated in a right-to-left interface; numbers are not
    const i18n = await import('./i18n.js');
    const iso = i18n.format('{path} / {n}', { path: '~/Downloads', n: 3 });
    check('valuesIsolated', iso === '\u2068~/Downloads\u2069 / 3', JSON.stringify(iso));

    // ---- toasts: bottom-left quadrant ----
    ui.toast('RTL toast sample', 'info'); await sleep(250);
    const toastEl = [...document.querySelectorAll('#toast-root .toast')].pop();
    const tr = toastEl && rect(toastEl);
    check('toastBottomLeft', !!tr && tr.r < W() / 2 && tr.t > H() / 2 && tr.l >= 0, tr);
    await shot('rtl-main');

    // ---- context menus: towards the left of the pointer, inside the window ----
    let menu = ui.contextMenu(W() - 10, 120, [{ label: 'An item with a fairly long label', key: '⌘K' }, '-', { label: 'Another item' }]);
    await sleep(100);
    let mr = menu.getBoundingClientRect();
    check('menuNearRightEdgeInside', inside(mr) && mr.right <= W() - 6 + 1, { l: mr.left, r: mr.right, W: W() });
    check('menuOpensLeftOfPointer', Math.abs(mr.right - (W() - 10)) <= 1 + 6, { r: mr.right });
    await closeMenu();
    menu = ui.contextMenu(20, 120, [{ label: 'An item with a fairly long label' }]); await sleep(100);
    mr = menu.getBoundingClientRect();
    check('menuNearLeftEdgeInside', inside(mr) && mr.left >= 6 - 1, { l: mr.left, r: mr.right });
    await closeMenu();
    // the session tree's context menu from the pointer near the right edge
    document.querySelector('#session-tree').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: W() - 20, clientY: 200 }));
    await sleep(200);
    menu = document.querySelector('#ctx-root .ctx');
    check('treeMenuInside', !!menu && inside(menu.getBoundingClientRect()), menu && rect(menu));
    await shot('rtl-tree-menu');
    await closeMenu();

    // ---- split menu: under its button, aligned on its right (start) edge ----
    const splitBtn = document.querySelector('#btn-split');
    app.action('split-menu'); await sleep(200);
    menu = document.querySelector('#ctx-root .ctx');
    const br = splitBtn.getBoundingClientRect(); mr = menu && menu.getBoundingClientRect();
    check('splitMenuUnderButton', !!mr && mr.top >= br.bottom - 1 && mr.top <= br.bottom + 8 && inside(mr) && mr.left < br.right && mr.right > br.left && (Math.abs(mr.right - br.right) <= 1 || mr.left <= 6 + 1), { br: { l: br.left, r: br.right, b: br.bottom }, mr: mr && { l: mr.left, r: mr.right, t: mr.top } });
    await shot('rtl-split-menu');
    await closeMenu();

    // ---- Settings: ✕ on the left half of the title bar, every tab fits 900×560 ----
    app.action('settings'); await sleep(450);
    const m = document.querySelector('.modal'), title = m.querySelector('.modal-title'), close = m.querySelector('.modal-title .close');
    const tb = title.getBoundingClientRect(), cb = close.getBoundingClientRect();
    check('settingsCloseOnTheLeft', cb.right <= tb.left + tb.width / 2, { title: { l: tb.left, r: tb.right }, close: { l: cb.left, r: cb.right } });
    const tt = m.querySelector('.modal-title-text').getBoundingClientRect();
    check('settingsTitleOnTheRight', tt.right > tb.left + tb.width / 2, { r: tt.right });
    const foot = [...m.querySelectorAll('.modal-foot button')];
    check('footerMirrored', foot.length >= 2 && foot[foot.length - 1].getBoundingClientRect().left < foot[0].getBoundingClientRect().left, foot.map((b) => rect(b)));
    const lbl = m.querySelector('.form-grid > label'), ctl = lbl && lbl.nextElementSibling;
    check('labelColumnOnTheRight', !!lbl && !!ctl && lbl.getBoundingClientRect().left > ctl.getBoundingClientRect().left, lbl && [rect(lbl), rect(ctl)]);
    const body = m.querySelector('.modal-body');
    const tabs = [...m.querySelectorAll('.mtabs button')], fits = {};
    for (const b of tabs) {
      b.click(); await sleep(150);
      const r = m.getBoundingClientRect();
      fits[b.textContent.trim()] = body.scrollHeight <= body.clientHeight + 1 && inside(r);
      await shot('rtl-settings-' + tabs.indexOf(b));
    }
    check('settingsTabsFit900x560', tabs.length === 5 && Object.values(fits).every(Boolean), fits);
    // a free-text field holding a path reads left to right (dir="auto" from i18n.js), the dialog around it stays right to left
    const pathField = [...m.querySelectorAll('input')].find((i) => /^~\//.test(i.value || i.placeholder));
    const was = pathField && pathField.value;
    if (pathField) { pathField.value = '~/Downloads/incoming'; pathField.dispatchEvent(new Event('input')); }
    check('pathValueLtr', !!pathField && pathField.dir === 'auto' && getComputedStyle(pathField).direction === 'ltr', pathField && { v: pathField.value, dir: pathField.dir, cs: getComputedStyle(pathField).direction });
    if (pathField) { pathField.value = 'مجلد التنزيلات'; pathField.dispatchEvent(new Event('input')); }
    check('arabicValueRtl', !!pathField && getComputedStyle(pathField).direction === 'rtl', pathField && getComputedStyle(pathField).direction);
    if (pathField) { pathField.value = was; pathField.dispatchEvent(new Event('input')); }
    check('settingsTabsMirrored', tabs.length > 1 && tabs[0].getBoundingClientRect().left > tabs[1].getBoundingClientRect().left);
    await closeModals();

    // ---- splits keep their physical meaning ----
    const p0 = app.activePane();
    const p1 = await app.splitActive('right'); await sleep(700);
    const panes = app.workspace.active.panes();
    const np = p1 && p1.el ? p1 : panes.find((p) => p !== p0);
    check('splitRightIsRight', !!np && np.el.getBoundingClientRect().left >= p0.el.getBoundingClientRect().right - 6, np && { old: rect(p0.el), neu: rect(np.el) });
    // drag-split zones: the right edge of a pane is the 'right' zone, its overlay is drawn on the right edge
    const pr = p0.el.getBoundingClientRect(), midY = pr.top + pr.height / 2;
    const zR = p0._dropZone({ clientX: pr.right - 4, clientY: midY }), zL = p0._dropZone({ clientX: pr.left + 4, clientY: midY });
    check('dropZonesPhysical', zR === 'right' && zL === 'left', { zR, zL });
    p0._showZone('right', 'right'); await sleep(50);
    const zr = p0.el.querySelector('.drop-zone').getBoundingClientRect();
    check('dropZoneOverlayRight', Math.abs(zr.right - pr.right) <= 1 && zr.left > pr.left + pr.width / 3, { zr: { l: zr.left, r: zr.right }, pr: { l: pr.left, r: pr.right } });
    p0._hideZone();
    // a session dropped on the right zone opens on the right of the target pane
    const s = await app.saveSession({ name: 'rtl-local', type: 'local', folder: '' });
    await app.dropOnPane(p0, { sessionId: s.id }, zR); await sleep(900);
    const added = app.workspace.active.panes().find((p) => p.session && p.session.id === s.id);
    check('dropRightOpensOnTheRight', !!added && added.el.getBoundingClientRect().left >= p0.el.getBoundingClientRect().right - 6, added && { target: rect(p0.el), added: rect(added.el) });
    // the splitter drag keeps the physical maths: moving the splitter to the right widens the left pane
    const splitter = document.querySelector('.tab-page.active .split.h > .splitter');
    if (splitter) {
      const sr = splitter.getBoundingClientRect(), w0 = p0.el.getBoundingClientRect().width;
      await window.api.app.testDrag({ x: sr.left + 2, y: sr.top + 40 }, { x: sr.left + 62, y: sr.top + 40 }); await sleep(300);
      check('splitterDragPhysical', p0.el.getBoundingClientRect().width > w0 + 20, { w0, w1: p0.el.getBoundingClientRect().width });
    }
    app.action('multiexec'); await sleep(150); app.action('find'); await sleep(200);
    const fb = document.querySelector('#find-bar').getBoundingClientRect();
    check('findBarAtTheLeft', fb.left < W() / 2 && fb.left >= 0, { l: fb.left, r: fb.right });
    ui.toast('Toast above the find bar', 'warn'); await sleep(200);
    await shot('rtl-split-find');
    app.action('find-close'); app.action('multiexec'); await sleep(150);

    // ---- tab strip: overflow arrows scroll from the right (the start) ----
    for (let i = 0; i < 10; i++) { app.action('new-local'); await sleep(150); }
    await sleep(800);
    const tabsEl = document.querySelector('#tabs'), first = app.workspace.tabs[0].tabEl;
    const lb = document.querySelector('#tab-scroll-left'), rb = document.querySelector('#tab-scroll-right');
    check('tabStripOverflows', !lb.hidden && !rb.hidden, { lb: lb.hidden, rb: rb.hidden });
    check('firstTabOnTheRight', first.getBoundingClientRect().right > tabsEl.getBoundingClientRect().right - 40 || tabsEl.scrollLeft < 0, { first: rect(first), strip: rect(tabsEl), sl: tabsEl.scrollLeft });
    check('startArrowOnTheRight', lb.getBoundingClientRect().left > rb.getBoundingClientRect().left && lb.title === i18n.t('Scroll tabs right') && rb.title === i18n.t('Scroll tabs left'), { lb: rect(lb), rb: rect(rb), lt: lb.title, rt: rb.title });
    app.workspace.activate(app.workspace.tabs[app.workspace.tabs.length - 1]); await sleep(500);
    const atEnd = tabsEl.scrollLeft;
    check('scrolledTowardsTheEnd', atEnd < -10 && rb.disabled && !lb.disabled, { sl: atEnd, lbDis: lb.disabled, rbDis: rb.disabled });
    lb.click(); await sleep(600);
    check('startArrowScrollsBack', tabsEl.scrollLeft > atEnd + 10, { before: atEnd, after: tabsEl.scrollLeft });
    await shot('rtl-tab-overflow');
    // the "all tabs" menu: under its button, inside the window
    document.querySelector('#tab-list').click(); await sleep(250);
    menu = document.querySelector('#ctx-root .ctx.tab-list');
    const lr = document.querySelector('#tab-list').getBoundingClientRect();
    check('tabListMenuInside', !!menu && inside(menu.getBoundingClientRect()) && Math.abs(menu.getBoundingClientRect().left - Math.max(6, lr.left)) <= 1, menu && { m: rect(menu), b: { l: lr.left, r: lr.right } });
    await closeMenu();

    // ---- 1400×900 ----
    await window.api.app.testResize(1400, 900); await sleep(500);
    check('largeSidebarRight', Math.abs(document.querySelector('#side-strip').getBoundingClientRect().right - W()) <= 1);
    await shot('rtl-large');

    // ---- back to English: left-to-right, the sidebar on the left again ----
    await app.saveSettings({ language: 'en' }); await sleep(700);
    const s2 = rect(document.querySelector('#side-strip')), c2 = rect(document.querySelector('#tab-content'));
    check('backToLtr', document.dir === 'ltr' && getComputedStyle(document.body).direction === 'ltr', document.dir);
    check('backValuesPlain', i18n.format('{path}', { path: '~/x' }) === '~/x');
    check('backSidebarLeft', s2.l <= 1 && c2.l > s2.r, { s2, c2 });
    check('backArrowLabels', lb.title === 'Scroll tabs left' && rb.title === 'Scroll tabs right' && rb.getBoundingClientRect().left > lb.getBoundingClientRect().left, { lt: lb.title, rt: rb.title });
    menu = ui.contextMenu(W() - 10, 120, [{ label: 'An item with a fairly long label' }]); await sleep(100);
    mr = menu.getBoundingClientRect();
    check('backMenuInside', inside(mr), { l: mr.left, r: mr.right });
    await closeMenu();
    menu = ui.contextMenu(100, 120, [{ label: 'Item' }]); await sleep(100);
    check('backMenuOpensRightOfPointer', Math.abs(menu.getBoundingClientRect().left - 100) <= 1);
    await closeMenu();
    ui.toast('LTR toast', 'info'); await sleep(250);
    const t2 = [...document.querySelectorAll('#toast-root .toast')].pop().getBoundingClientRect();
    check('backToastBottomRight', t2.left > W() / 2, { l: t2.left });
    await shot('rtl-back-en');
  } catch (e) {
    log('ERROR', e && e.stack || String(e));
    failed.push('exception');
  }
  const pass = Object.values(results).filter(Boolean).length;
  log('SUMMARY', JSON.stringify({ pass, fail: failed.length, failed }));
  window.api.app.quit();
})();
