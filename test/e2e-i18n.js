// Interface language: Settings → General → Language switches every label of the window at once (static hooks,
// components that re-render on i18n:changed, dialogs built afterwards, the native menu), each of the ten languages
// keeps the toolbar and every Settings tab inside a 900×560 window, and 'system' resolves to the Mac's language.
//   test/qa/run.sh test/e2e-i18n.js <out-dir> 300000      (the harness starts the app in English: MOBALT_LANG=en)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-i18n]', ...a);
  const app = window.app;
  const results = {};
  const failed = [];
  const check = (name, ok, detail) => { results[name] = !!ok; if (!ok) { failed.push(name); log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
  const i18n = await import('./i18n.js');
  const ui = await import('./ui.js');
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
  const flat = (items, out = []) => { for (const it of items || []) { if (it.label) out.push(it.label); if (it.submenu) flat(it.submenu, out); } return out; };
  const LANGS = ['ko', 'zh-CN', 'ja', 'vi', 'hi', 'de', 'fr', 'es', 'pt', 'ar'];
  const closeModals = async () => { for (let i = 0; i < 6 && document.querySelector('.modal'); i++) { document.querySelector('.modal .close')?.click(); await sleep(200); document.querySelector('.modal.narrow .btn.primary')?.click(); await sleep(150); } };
  try {
    await app.saveSettings({ confirmClose: false });
    await window.api.app.testResize(900, 560);
    await sleep(400);
    const en = { html: document.documentElement.lang, settings: text('[data-action=settings]'), session: text('[data-action=new-session]'), menu: flat(await window.api.app.testMenuLabels()), tree: text('#session-tree'), status: text('#st-session'), filter: document.querySelector('#session-filter')?.placeholder };
    check('bootEnglish', en.html === 'en' && en.settings === 'Settings' && en.session === 'Session' && en.menu.includes('Settings…') && en.menu.includes('User Guide'), en);
    check('languagesListed', i18n.LANGUAGES.map((l) => l.code).join() === 'en,ko,zh-CN,ja,vi,hi,de,fr,es,pt,ar', i18n.LANGUAGES);
    check('hooksPresent', document.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]').length >= 40, document.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]').length);
    check('guideUrlPerLanguage', (await window.api.i18n.guideUrl('ja')).endsWith('/docs/USER_GUIDE.ja.md') && (await window.api.i18n.guideUrl('en')).endsWith('/docs/USER_GUIDE.md'));
    // the Language list in Settings
    app.action('settings'); await sleep(400);
    const sel = [...document.querySelectorAll('.modal select')].find((s) => [...s.options].some((o) => o.value === 'system'));
    check('languageSelectShown', !!sel && sel.options.length === 12 && sel.value === 'system' && /\(/.test(sel.options[0].textContent), sel && [...sel.options].map((o) => o.value + ':' + o.textContent));
    check('languageSelectIsFirstControl', document.activeElement === sel);
    await closeModals();

    for (const code of LANGS) {
      await app.saveSettings({ language: code });
      await sleep(600);
      const cur = { html: document.documentElement.lang, settings: text('[data-action=settings]'), session: text('[data-action=new-session]'), menu: flat(await window.api.app.testMenuLabels()), tree: text('#session-tree'), status: text('#st-session'), filter: document.querySelector('#session-filter')?.placeholder };
      check(`${code}.htmlLang`, cur.html === code, cur.html);
      check(`${code}.direction`, document.documentElement.dir === (code === 'ar' ? 'rtl' : 'ltr'), document.documentElement.dir);
      check(`${code}.settingSaved`, app.settings.language === code);
      check(`${code}.toolbarTranslated`, cur.settings !== en.settings && cur.settings.length > 0, cur.settings);
      check(`${code}.menuTranslated`, !cur.menu.includes('Settings…') && !cur.menu.includes('User Guide') && cur.menu.length === en.menu.length, { len: cur.menu.length, sample: cur.menu.slice(0, 12) });
      check(`${code}.staticHookTranslated`, cur.filter && cur.filter !== en.filter, cur.filter);
      check(`${code}.treeRerendered`, cur.tree && cur.tree !== en.tree, cur.tree.slice(0, 60));
      check(`${code}.statusRerendered`, cur.status && cur.status !== en.status, cur.status);
      // the toolbar keeps its seven buttons and the quick-connect box on one 900 px line
      const tb = document.querySelector('#toolbar'), qc = document.querySelector('#qc-input');
      const btns = [...document.querySelectorAll('#toolbar .tb-btn')];
      const clipped = btns.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > window.innerWidth);
      check(`${code}.toolbarFits`, tb.scrollWidth <= tb.clientWidth + 1 && clipped.length === 0 && qc && qc.getBoundingClientRect().width >= 120, { clipped: clipped.map((b) => b.textContent.trim()), qc: qc && Math.round(qc.getBoundingClientRect().width) });
      // the side strip
      const strip = [...document.querySelectorAll('#side-strip .strip-btn span')].filter((s) => s.textContent.trim());
      check(`${code}.stripTranslated`, strip.length >= 4 && strip.some((s) => s.textContent.trim() !== 'Sessions'), strip.map((s) => s.textContent.trim()));
      // Settings: every tab fits 900×560, the dialog's height is the same on every tab
      app.action('settings'); await sleep(400);
      const m = document.querySelector('.modal'), body = m && m.querySelector('.modal-body');
      const tabs = [...document.querySelectorAll('.modal .mtabs button')];
      const fits = {}; let height = null, sameHeight = true;
      for (const b of tabs) {
        b.click(); await sleep(150);
        const r = m.getBoundingClientRect();
        fits[b.textContent.trim()] = body.scrollHeight <= body.clientHeight + 1 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        if (height === null) height = Math.round(r.height); else if (Math.round(r.height) !== height) sameHeight = false;
      }
      check(`${code}.settingsTabsTranslated`, tabs.length === 5 && tabs.map((b) => b.textContent.trim()).join('|') !== 'General|Terminal|Features|Logging|Updates', tabs.map((b) => b.textContent.trim())); // a tab name may equal the English (es "General"): the set must differ
      check(`${code}.settingsFit900x560`, Object.values(fits).every(Boolean) && sameHeight, { fits, sameHeight });
      tabs[0]?.click(); await sleep(100);
      await shot(`i18n-${code}-settings`);
      const cancel = [...m.querySelectorAll('.modal-foot button')][0];
      check(`${code}.dialogButtonsTranslated`, cancel && cancel.textContent.trim() !== 'Cancel', cancel && cancel.textContent);
      await closeModals();
      // the session editor opens with translated tab names and type labels intact
      app.action('new-session'); await sleep(400);
      const etabs = [...document.querySelectorAll('.modal .mtabs button')].map((b) => b.textContent.trim());
      check(`${code}.editorOpens`, etabs.length === 4 && etabs[0] !== 'Basic', etabs);
      await shot(`i18n-${code}-editor`);
      await closeModals();
      // a confirm built now is in the language
      const p = ui.confirmDialog('x'); await sleep(150);
      const cb = document.querySelector('.modal .modal-foot button');
      check(`${code}.confirmTranslated`, cb && cb.textContent.trim() !== 'Cancel', cb && cb.textContent);
      cb?.click(); await p; await sleep(100);
      await shot(`i18n-${code}-main`);
      // a toast
      ui.toast('ok'); await sleep(50);
    }
    // back to English: everything returns to the source strings
    await app.saveSettings({ language: 'en' }); await sleep(600);
    const back = { html: document.documentElement.lang, settings: text('[data-action=settings]'), menu: flat(await window.api.app.testMenuLabels()), filter: document.querySelector('#session-filter')?.placeholder, tree: text('#session-tree'), status: text('#st-session') };
    check('backToEnglishDir', document.documentElement.dir === 'ltr', document.documentElement.dir);
    check('backToEnglish', back.html === 'en' && back.settings === en.settings && back.filter === en.filter && back.tree === en.tree && back.status === en.status && back.menu.join() === en.menu.join(), back);
    // 'system' follows the Mac: whatever that resolves to, the window shows it
    await app.saveSettings({ language: 'system' }); await sleep(600);
    check('systemResolves', document.documentElement.lang === i18n.SYSTEM_LOCALE && i18n.LANGUAGES.some((l) => l.code === i18n.SYSTEM_LOCALE), { html: document.documentElement.lang, system: i18n.SYSTEM_LOCALE });
    // an unknown saved code falls back to the system language, never crashes
    await app.saveSettings({ language: 'tlh' }); await sleep(400);
    check('unknownCodeFallsBack', document.documentElement.lang === i18n.SYSTEM_LOCALE);
    await app.saveSettings({ language: 'en' }); await sleep(300);
    // the dictionaries themselves: every shipped language has one that is not empty
    const sizes = {};
    for (const code of LANGS) sizes[code] = Object.keys(await window.api.i18n.dict(code)).length;
    check('dictionariesShipped', Object.values(sizes).every((n) => n > 500), sizes);
  } catch (e) {
    log('ERROR', e && e.stack || String(e));
    failed.push('exception');
  }
  const pass = Object.values(results).filter(Boolean).length;
  log('SUMMARY', JSON.stringify({ pass, fail: failed.length, failed }));
  window.api.app.quit();
})();
