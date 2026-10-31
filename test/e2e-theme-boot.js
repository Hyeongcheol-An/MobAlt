// First paint in the saved theme: a launch with Settings → Theme = Light saved must never show the dark moba-dark
// defaults of styles.css first (the preload puts the remembered chrome tokens on <html> before anything is painted).
// Run it twice on the same out-dir:
//   test/qa/run.sh test/e2e-theme-boot.js <out-dir>   # phase 1 (fresh user data): saves the Light theme and quits
//   test/qa/run.sh test/e2e-theme-boot.js <out-dir>   # phase 2: every frame of this launch was light from the first one
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-theme-boot]', ...a);
  const app = window.app;
  const results = {};
  const parse = (c) => { const m = /^rgba?\(([^)]+)\)/.exec(c || ''); return m ? m[1].split(/[\s,\/]+/).filter(Boolean).map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const isLight = (c) => { const p = parse(c); return !!p && lum(p) > 0.8; };
  const LIGHT_BG = '#f5f6f8';
  try {
    const boot = window.api.app.bootChrome();
    const frames = window.api.app.testFirstFrames();
    log('boot chrome:', JSON.stringify(boot && { background: boot.background, scheme: boot.scheme, theme: boot.theme, vars: boot.vars && Object.keys(boot.vars).length }), '| first frames:', JSON.stringify(frames));
    if (app.settings.theme !== 'light') {
      // ---- phase 1: fresh user data, the moba-dark default; save the light theme for the next launch
      results.phase = 1;
      results.firstLaunchDefault = !!boot && !boot.vars && boot.scheme === 'dark' && document.documentElement.dataset.theme === 'moba-dark'; // nothing remembered yet: the stylesheet's own moba-dark
      await app.saveSettings({ theme: 'light', confirmClose: false });
      await sleep(300);
      const chrome = await window.api.app.testChrome();
      const st = chrome && chrome.stored;
      results.lightRemembered = !!st && st.scheme === 'light' && st.theme === 'light' && !!st.vars && st.vars['--bg'] === LIGHT_BG && st.vars['--term-bg'] === '#ffffff' && st.background === LIGHT_BG;
      log('stored chrome:', JSON.stringify(st && { ...st, vars: st.vars && Object.keys(st.vars).length + ' vars' }));
      await shot('90-boot-phase1-light-saved');
    } else {
      // ---- phase 2: the saved light theme was on <html> before the first paint
      results.phase = 2;
      results.bootChromeLight = !!boot && boot.scheme === 'light' && boot.theme === 'light' && !!boot.vars && boot.vars['--bg'] === LIGHT_BG;
      results.firstFrameLight = frames.length > 0 && isLight(frames[0].html) && frames[0].scheme === 'light';
      results.noDarkFrame = frames.length > 0 && frames.every((f) => isLight(f.html) && (f.body === null || isLight(f.body)));
      results.settledLight = getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 248)' && getComputedStyle(document.documentElement).colorScheme === 'light' && document.documentElement.dataset.theme === 'light';
      const chrome = await window.api.app.testChrome();
      results.windowBgLight = !!chrome && String(chrome.background).toLowerCase() === LIGHT_BG && chrome.scheme === 'light';
      const paint = performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]);
      log('paint timing:', JSON.stringify(paint), '| first rAF at', frames[0] && frames[0].t, 'ms');
      await shot('91-boot-phase2-light-first');
    }
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-theme-boot] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
  }
  await sleep(200);
  window.api.app.quit();
})();
