// Renderer-side Mosh check: mosh client (brew install mosh) bootstrapping over the local test sshd on 127.0.0.1:2222.
//   test/start-sshd.sh start
//   MOBALT_USER_DATA=... MOBALT_TEST_SCRIPT=test/e2e-mosh.js MOBALT_SHOT_DIR=... MOBALT_SCREENSHOT=... MOBALT_SCREENSHOT_DELAY=60000 npx electron .
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-mosh]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => {
    const b = [];
    for (let i = 0; i < pane.term.buffer.active.length; i++) b.push(pane.term.buffer.active.getLine(i)?.translateToString(true));
    return b.join('\n');
  };
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(150);
    }
    throw new Error('timeout: ' + what);
  };
  try {
    await app.saveSettings({ confirmClose: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const s = await app.saveSession({
      name: 'test mosh', folder: 'Test', type: 'mosh', host: '127.0.0.1', port: 2222, username: user,
      privateKeyPath: keyDir + '/client_ed25519', moshServer: '__MOSH_SERVER__', startupCommand: 'echo MOSH_STARTUP_$((40+2))',
    });
    const pane = await app.openSession(s);
    await waitFor(() => pane.status === 'connected', 8000, 'mosh spawned');
    results.spawned = true;
    // mosh-client draws the remote shell; wait for the startup command to have run
    await waitFor(() => /MOSH_STARTUP_42/.test(text(pane)), 20000, 'remote shell + startup command');
    results.startupRan = true;
    pane.term.input('echo MOSH_OK_$((1+1))\r');
    await waitFor(() => /MOSH_OK_2/.test(text(pane)), 10000, 'echo over mosh');
    results.echo = true;
    results.status = document.getElementById('st-session').textContent;
    await shot('40-mosh');
    await pane.disconnect();
    await waitFor(() => pane.dead, 8000, 'mosh closed');
    results.closed = true;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-mosh] FAIL', e.message, e.stack);
    await shot('99-mosh-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
