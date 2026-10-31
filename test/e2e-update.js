// On-disk update banner: a different MobAlt.app written over the running one (brew upgrade --cask mobalt, a
// dragged DMG) is announced by the main process; the banner offers a relaunch, "Later" silences that version
// only, and Relaunch goes through the quit question (nothing is live here) before restarting — recorded, not
// performed, in test mode. Also: a main-process notice (app:notice) shows up as an error toast that wraps an
// unbroken path, an empty notice shows nothing, and the toast stack stays above the open find bar (also with both
// banners up in a small window).
//   test/qa/run.sh test/e2e-update.js <out-dir>
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-update]', ...a);
  const app = window.app;
  const results = {};
  const banner = () => document.getElementById('update-banner');
  const text = () => document.getElementById('update-banner-text').textContent;
  const visible = () => !banner().hidden && banner().offsetParent !== null;
  try {
    await app.saveSettings({ confirmClose: true }); // nothing is live, so the quit question still does not apply
    await sleep(500);
    const pane = app.activePane();
    const rows0 = pane.term.rows;
    results.hiddenAtStart = !visible();

    // the main-process event shows the banner with both versions; terminals re-measure around it
    await window.api.app.testBundleUpdated('0.11.0');
    await sleep(300);
    results.visibleAfterHook = visible();
    results.text = text();
    results.textOk = text() === `MobAlt 0.11.0 is installed on disk — you are running ${app.info.version}. Relaunch to use it.`;
    results.panesRefit = pane.term.rows < rows0;
    log('rows', rows0, '→', pane.term.rows);
    // keyboard: Relaunch and Later are ordinary Tab stops
    const btns = ['update-relaunch', 'update-later'].map((id) => document.getElementById(id));
    results.buttonsTabbable = btns.every((b) => b && b.tabIndex === 0 && !b.disabled && b.offsetParent !== null);
    await window.api.app.testKey('F19'); // keyboard mode: focus rings show on programmatic focus
    btns[0].focus();
    results.relaunchFocusable = document.activeElement === btns[0];
    await shot('60-update-banner');

    // Later hides it (focus back in the terminal), the same version stays quiet, a different one shows again
    btns[1].click();
    await sleep(200);
    results.laterHides = !visible();
    results.panesRefitBack = pane.term.rows === rows0;
    results.focusBackToTerminal = document.activeElement === pane.term.textarea;
    await window.api.app.testBundleUpdated('0.11.0');
    await sleep(300);
    results.sameVersionStaysHidden = !visible();
    await window.api.app.testBundleUpdated('0.12.0');
    await sleep(300);
    results.newVersionShows = visible() && text().includes('0.12.0');

    // Relaunch with no live connections: no question, the workspace is saved and the restart requested
    const before = await window.api.app.testQuitCheck();
    results.noRelaunchBefore = before.relaunchRequested === false && before.live.total === 0 && !before.wouldAsk;
    document.getElementById('update-relaunch').click();
    await sleep(400);
    const after = await window.api.app.testQuitCheck();
    results.relaunchRequested = after.relaunchRequested === true;
    const ws = await window.api.workspace.get();
    results.workspaceSavedBeforeRelaunch = !!ws && Array.isArray(ws.tabs) && ws.tabs.length >= 1;

    // main-process notices (uncaughtException → app:notice) surface as an error toast
    const noticeText = 'Internal error: sample notice from main';
    await window.api.app.testNotice(noticeText);
    await sleep(200);
    const noticeToast = [...document.querySelectorAll('#toast-root .toast')].find((t) => t.textContent === noticeText);
    results.noticeToast = !!noticeToast && noticeToast.classList.contains('error');
    await shot('61-main-notice-toast');

    // a notice with an unbroken path (ENOENT / EACCES style) wraps inside the 360px toast and stays inside the window
    const longNotice = 'Internal error: ENOENT: no such file or directory, open /Users/me/Library/Application_Support/MobAlt/sessions/' + 'a'.repeat(80) + '.json';
    await window.api.app.testNotice(longNotice);
    await sleep(200);
    const longToast = [...document.querySelectorAll('#toast-root .toast')].find((t) => t.textContent === longNotice);
    const lr = longToast ? longToast.getBoundingClientRect() : null;
    results.longNoticeWraps = !!lr && longToast.scrollWidth <= longToast.clientWidth + 1 && lr.right <= window.innerWidth && lr.width <= 360 && lr.height > 40;
    log('long toast', lr && `${lr.width}x${lr.height}, scroll ${longToast.scrollWidth} / client ${longToast.clientWidth}, right ${lr.right} of ${window.innerWidth}`);
    await shot('62-long-notice-wraps');
    // an empty notice shows nothing at all (never "[object Object]")
    const toastsBefore = document.querySelectorAll('#toast-root .toast').length;
    await window.api.app.testNotice('');
    await sleep(200);
    results.emptyNoticeIgnored = document.querySelectorAll('#toast-root .toast').length === toastsBefore && !document.getElementById('toast-root').textContent.includes('[object Object]');

    // with the find bar open the toast stack sits above the bar (8px gap), never over its top edge...
    app.action('find');
    await sleep(150);
    const findBar = document.getElementById('find-bar');
    const gapAbove = (t) => findBar.getBoundingClientRect().top - t.getBoundingClientRect().bottom;
    const findNotice = 'Internal error: something broke while the find bar is open';
    await window.api.app.testNotice(findNotice);
    await sleep(200);
    const findToast = [...document.querySelectorAll('#toast-root .toast')].find((t) => t.textContent === findNotice);
    results.toastAboveFindBar = !!findToast && gapAbove(findToast) >= 4 && gapAbove(findToast) <= 16;
    log('find bar top', findBar.getBoundingClientRect().top, 'toast bottom', findToast && findToast.getBoundingClientRect().bottom, 'gap', findToast && gapAbove(findToast));
    await shot('63-find-bar-toast');
    // ...and so does every toast of the stack in a small window with the update and MultiExec banners up
    await window.api.app.testResize(900, 600);
    await sleep(200);
    app.action('multiexec');
    await sleep(300);
    const stack = [...document.querySelectorAll('#toast-root .toast')];
    results.toastStackAboveFindBarSmall = visible() && !document.getElementById('multiexec-banner').hidden && stack.length >= 2 && stack.every((t) => gapAbove(t) >= 4) && gapAbove(stack[stack.length - 1]) <= 16; // the lowest one (MultiExec ON, a warn toast) sits right above the bar
    log('stack gaps at 900x600', stack.map((t) => gapAbove(t).toFixed(1)).join(', '));
    await shot('64-find-bar-toasts-900x600');
    app.action('multiexec');
    app.action('find-close');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-update] FAIL', e.message, e.stack);
    await shot('99-update-fail').catch(() => {});
  }
  results.pass = !results.error && Object.entries(results).every(([k, v]) => k === 'text' || v === true);
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
