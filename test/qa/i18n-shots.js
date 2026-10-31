// Interface language QA: screenshots of every view in the language the app runs in, plus an overflow check.
//   env -u ELECTRON_RUN_AS_NODE MOBALT_LANG=ko test/qa/run.sh test/qa/i18n-shots.js /tmp/i18n-qa/ko 180000
// Writes <out>/shots/*.png at the minimum window size (900×560, where translations are tightest) and at 1400×900,
// logs `[i18n-shots] OVERFLOW …` for every visible label that is clipped or wider than its box, `[i18n-shots] MENU`
// with the native menu labels, and `[i18n-shots] LATIN …` for visible texts that still look English (two or more
// Latin words) while a non-Latin language is on — a translator reads those lists to shorten or complete strings.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[i18n-shots]', ...a);
  const app = window.app;
  const lang = document.documentElement.lang || '?';
  const shot = (n) => window.api.app.screenshot(`${lang}-${n}`);
  const overflows = [];
  const latin = new Set();
  const nonLatin = /^(ko|ja|zh|hi|ar)/.test(lang);
  const KEEP = /^(MobAlt|MobaXterm|SSH|SFTP|FTP|FTPS|Mosh|Telnet|RDP|VNC|X11|XQuartz|Zmodem|rz|sz|Wake-on-LAN|MultiExec|Finder|Homebrew|GitHub|JSON|CIDR|MAC|UDP|TCP|DNS|rDNS|URL|IP|CPU|RTT|Ping|Aa|OK|ms|s|Go|Rec|zsh|bash|\d+|[^A-Za-z]+)$/;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const check = (view) => {
    for (const el of document.querySelectorAll('button, label, th, td, option, .tab, .mtabs button, .strip-btn, .tb-btn, .panel-head *, .form-grid label, .form-help, .modal-title-text, .statusbar span, #statusbar span, .toast, .ctx-item, .menu-item, summary, .lbl, .hint, .tree-empty, .sftp-empty p, .big')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const clipped = (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1;
      const r = el.getBoundingClientRect();
      // below the fold of a dialog that scrolls by design (the session editor) is not an overflow
      const scroller = el.closest('.modal-body');
      const inScroller = scroller && scroller.scrollHeight > scroller.clientHeight + 1 && getComputedStyle(scroller).overflowY !== 'visible';
      const outside = !inScroller && (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1);
      const wrapped = el.tagName === 'BUTTON' && el.getBoundingClientRect().height > parseFloat(cs.fontSize) * 2.4 && !el.classList.contains('pick') && !el.closest('.type-picker');
      if (clipped || outside || wrapped) overflows.push(`${view}: <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}> "${(el.textContent || '').trim().slice(0, 60)}" scroll=${el.scrollWidth} client=${el.clientWidth}${outside ? ' OUTSIDE WINDOW' : ''}${wrapped ? ' WRAPPED BUTTON' : ''}`);
      if (nonLatin) {
        const text = (el.textContent || '').trim();
        if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) && !KEEP.test(text) && !el.closest('.xterm')) latin.add(`${view}: "${text.slice(0, 80)}"`);
        for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(v) && !KEEP.test(v)) latin.add(`${view} [${a}]: "${v.slice(0, 80)}"`); }
      }
    }
    // the modal as a whole must fit the window
    const m = document.querySelector('.modal');
    if (m) { const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1) overflows.push(`${view}: .modal ${Math.round(r.width)}×${Math.round(r.height)} does not fit ${window.innerWidth}×${window.innerHeight}`); const b = m.querySelector('.modal-body'); if (b && b.scrollHeight > b.clientHeight + 1 && /^settings/.test(view)) overflows.push(`${view}: .modal-body scrolls (${b.scrollHeight} > ${b.clientHeight}) — every Settings tab must fit 900×560`); }
  };
  // close the top dialog; a "Discard changes?" question (the editor was made dirty) is answered with its Discard button
  const closeModal = async () => {
    const before = document.querySelectorAll('.modal').length;
    const c = document.querySelector('.modal .close'); if (c) c.click(); await sleep(250);
    if (document.querySelectorAll('.modal').length > before) { document.querySelector('.modal.narrow .btn.primary, .modal.narrow .modal-foot .primary, .modal.narrow .modal-foot button:last-child')?.click(); await sleep(250); }
  };
  const closeAll = async () => { for (let i = 0; i < 6 && document.querySelector('.modal'); i++) await closeModal(); };
  const tabTo = async (i) => { const b = document.querySelectorAll('.modal .mtabs button')[i]; if (b) { b.click(); await sleep(200); } };
  try {
    await app.saveSettings({ confirmClose: false });
    await window.api.app.testResize(900, 560);
    await sleep(500);
    log('lang', lang, 'window', window.innerWidth + 'x' + window.innerHeight);
    log('MENU', JSON.stringify(await window.api.app.testMenuLabels()));
    // main window with each panel
    for (const p of ['sessions', 'sftp', 'tools', 'macros']) { app.showPanel(p); await sleep(300); check('panel-' + p); await shot('10-panel-' + p); }
    app.showPanel('sessions');
    // settings, every tab
    app.action('settings'); await sleep(500);
    const n = document.querySelectorAll('.modal .mtabs button').length;
    for (let i = 0; i < n; i++) { await tabTo(i); check('settings-tab-' + i); await shot('20-settings-' + i); }
    await closeModal();
    // session editor, every tab
    app.action('new-session'); await sleep(500);
    const n2 = document.querySelectorAll('.modal .mtabs button').length;
    for (let i = 0; i < n2; i++) { await tabTo(i); check('editor-tab-' + i); await shot('30-editor-' + i); }
    // the type picker: each type shows other fields (Basic tab)
    await tabTo(0);
    const types = [...document.querySelectorAll('.modal .type-picker button')];
    for (let i = 0; i < types.length; i++) { types[i].click(); await sleep(250); const name = (types[i].textContent || '').replace(/[^A-Za-z]/g, '').toLowerCase() || String(i); check('editor-type-' + name); await shot('31-editor-' + name); }
    await closeAll();
    for (const [name, act] of [['tunnels', 'tunnels'], ['shortcuts', 'shortcuts'], ['keygen', 'keygen']]) {
      app.action(act); await sleep(600);
      const m = document.querySelector('.modal');
      if (m) { const tabs = m.querySelectorAll('.mtabs button').length; if (tabs) { for (let i = 0; i < tabs; i++) { await tabTo(i); check(name + '-' + i); await shot('40-' + name + '-' + i); } } else { check(name); await shot('40-' + name); } }
      await closeAll();
    }
    // context menus: a tab, the split menu, the tree root
    const tab = document.querySelector('#tabs .tab');
    if (tab) { tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 60 })); await sleep(250); check('tab-menu'); await shot('50-tab-menu'); document.body.click(); await sleep(150); }
    app.action('split-menu'); await sleep(250); check('split-menu'); await shot('51-split-menu'); document.body.click(); await sleep(150);
    const tree = document.querySelector('#session-tree');
    if (tree) { tree.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 })); await sleep(250); check('tree-menu'); await shot('52-tree-menu'); document.body.click(); await sleep(150); }
    const pane = app.activePane && app.activePane();
    if (pane && pane.termEl) { pane.termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 300, shiftKey: true })); await sleep(250); check('pane-menu'); await shot('53-pane-menu'); document.body.click(); await sleep(150); }
    // split + multiexec banner + find bar
    app.applyLayout('2x2'); await sleep(600); app.action('multiexec'); await sleep(200); app.action('find'); await sleep(200);
    check('split-multiexec-find'); await shot('60-split-multiexec-find');
    app.action('find-close'); app.action('multiexec'); await sleep(150);
    // the relaunch banner
    await window.api.app.testBundleUpdated('9.9.9'); await sleep(400); check('update-banner'); await shot('61-update-banner');
    // toasts
    const ui = await import('./ui.js'); ui.toast('Toast sample', 'info'); ui.toast('Error sample', 'error'); await sleep(200); await shot('62-toasts');
    // at the large size
    await window.api.app.testResize(1400, 900); await sleep(500); check('large'); await shot('70-large');
    log('RESULT', JSON.stringify({ lang, overflows: overflows.length, latin: latin.size }));
    for (const o of overflows) log('OVERFLOW', o);
    for (const l of [...latin].sort()) log('LATIN', l);
  } catch (e) {
    log('ERROR', e && e.stack || String(e));
  }
  window.api.app.quit();
})();
