// On-disk update banner: a different MobAlt.app written over the running one (brew upgrade --cask mobalt, a
// dragged DMG) is announced by the main process; the banner offers a relaunch, "Later" silences that version
// only, and Relaunch goes through the quit question (nothing is live here) before restarting — recorded, not
// performed, in test mode.
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
