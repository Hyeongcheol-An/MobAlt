// On-disk update banner: a different MobAlt.app written over the running one (brew upgrade --cask mobalt, a
// dragged DMG) is announced by the main process; the banner offers a relaunch, "Later" silences that version
// only, and Relaunch goes through the quit question (nothing is live here) before restarting — recorded, not
// performed, in test mode. The updater's download (app:update-progress, fed by the test hook) uses the same bar: the
// progress line with a thin bar and no buttons while it runs (Settings → Updates shows the same line and follows
// it), Restart now / Later once the file is complete (Restart now is recorded, never performed), the reason for a
// moment when it failed. Also: a main-process notice (app:notice) shows up as an error toast that wraps an unbroken
// path, an empty notice shows nothing, and the toast stack stays above the open find bar (also with both banners up
// in a small window).
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

    // the updater's download takes the same bar: the line, a thin bar, no buttons; terminals re-fit around it
    const MB = 1024 * 1024;
    const progress = (p) => window.api.app.testUpdateProgress({ version: '0.17.0', ...p });
    const bar = () => document.getElementById('update-progress');
    const btn = (id) => document.getElementById(id);
    await progress({ phase: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    await sleep(300);
    results.progressStartText = visible() && text() === 'Downloading MobAlt 0.17.0…';
    results.progressBarShown = !bar().hidden && bar().offsetParent !== null && bar().value === 0 && bar().getAttribute('aria-label') === 'Download progress';
    results.progressNoButtons = ['update-relaunch', 'update-install', 'update-later'].every((id) => btn(id).hidden && btn(id).offsetParent === null);
    results.progressPanesRefit = pane.term.rows < rows0;
    await progress({ phase: 'downloading', percent: 41.8, transferred: 12.3 * MB, total: 29.4 * MB, bytesPerSecond: 2.1 * MB });
    await sleep(300);
    const mid = 'Downloading MobAlt 0.17.0 — 42 % (12.3 of 29.4 MB, 2.1 MB/s)';
    results.progressMidText = text() === mid;
    results.progressBarValue = Math.abs(bar().value - 0.42) < 0.001;
    results.progressLiveRegion = banner().getAttribute('role') === 'status';
    log('progress', text(), 'bar', bar().value);
    await shot('65-update-progress');
    // Settings → Updates: the same line (and the same bar), and it keeps following the download while the dialog is open
    app.action('settings');
    await sleep(400);
    const modal = document.querySelector('.modal');
    [...modal.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Updates')?.click();
    await sleep(150);
    const updStatus = () => modal.querySelector('.upd-status');
    const updBar = () => modal.querySelector('.upd-bar');
    results.settingsLineSameText = updStatus().textContent === mid && updStatus().getAttribute('aria-live') === 'polite';
    results.settingsBarSameValue = !!updBar() && !updBar().hidden && updBar().offsetParent !== null && Math.abs(updBar().value - 0.42) < 0.001;
    await progress({ phase: 'downloading', percent: 77, transferred: 22.6 * MB, total: 29.4 * MB, bytesPerSecond: 2.4 * MB });
    await sleep(300);
    results.settingsLineFollows = updStatus().textContent === text() && text() === 'Downloading MobAlt 0.17.0 — 77 % (22.6 of 29.4 MB, 2.4 MB/s)';
    results.settingsBarFollows = Math.abs(updBar().value - 0.77) < 0.001 && Math.abs(bar().value - 0.77) < 0.001;
    await shot('66-update-progress-settings');
    // done: both say the file is complete; the banner offers Restart now / Later, Settings its own Restart now
    await progress({ phase: 'done', percent: 100, transferred: 29.4 * MB, total: 29.4 * MB, bytesPerSecond: 2.4 * MB });
    await sleep(300);
    const doneText = 'MobAlt 0.17.0 downloaded — it is installed when you quit, or restart now';
    results.doneText = text() === doneText && updStatus().textContent === doneText;
    results.doneControls = !btn('update-install').hidden && !btn('update-later').hidden && btn('update-relaunch').hidden && bar().hidden && updBar().hidden;
    const settingsInstall = [...modal.querySelectorAll('.modal-body button')].find((b) => b.textContent === 'Restart now');
    results.settingsInstallShown = !!settingsInstall && !settingsInstall.hidden && settingsInstall.offsetParent !== null;
    results.noInstallBefore = (await window.api.app.testQuitCheck()).installRequested === false;
    settingsInstall.click(); // the main process's install path (recorded in test mode, never performed)
    await sleep(300);
    results.settingsInstallRequested = (await window.api.app.testQuitCheck()).installRequested === true;
    await shot('67-update-done-settings');
    document.querySelector('.modal .close').click();
    await sleep(250);
    results.settingsClosed = !document.querySelector('.modal');
    results.doneButtonsTabbable = ['update-install', 'update-later'].every((id) => btn(id).tabIndex === 0 && !btn(id).disabled && btn(id).offsetParent !== null);
    btn('update-install').focus();
    results.installFocusable = document.activeElement === btn('update-install');
    await shot('68-update-done-banner');
    // Later hides the banner (nothing on disk is waiting) and the terminals get their rows back
    btn('update-later').click();
    await sleep(250);
    results.doneLaterHides = !visible() && pane.term.rows === rows0 && document.activeElement === pane.term.textarea;
    // a failed download: the reason, no bar and no buttons, gone by itself after a while (shortened here)
    app.updateErrorHideMs = 800;
    await progress({ phase: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
    await sleep(300);
    results.errorText = visible() && text() === 'Download of MobAlt 0.17.0 failed: net::ERR_INTERNET_DISCONNECTED';
    results.errorNoControls = bar().hidden && btn('update-install').hidden && btn('update-later').hidden && btn('update-relaunch').hidden;
    await shot('69-update-error');
    await sleep(900);
    results.errorGoesAway = !visible() && pane.term.rows === rows0;
    app.updateErrorHideMs = 10000;

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
