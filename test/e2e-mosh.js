// Renderer-side Mosh check: mosh client (brew install mosh) bootstrapping over the local test sshd on 127.0.0.1:2222.
//   test/start-sshd.sh start
//   sed 's#__MOSH_SERVER__#/opt/homebrew/bin/mosh-server#' test/e2e-mosh.js > /tmp/e2e-mosh.js
//   test/qa/run.sh /tmp/e2e-mosh.js <out-dir> 120000
// The host key is checked by the app (its own prompt, its own known_hosts in the test user-data folder) before
// the mosh client is spawned; the ssh bootstrap then runs with StrictHostKeyChecking=yes against that file, so
// ~/.ssh/known_hosts is never touched.
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
    const modalTitle = () => document.querySelector('.modal .modal-title')?.textContent || '';
    // 1. unknown host key: the app asks (naming the session) before anything is spawned; Cancel = failed, nothing trusted
    let pr = app.openSession(s);
    await waitFor(() => /Unknown host key/.test(modalTitle()), 10000, 'host key prompt');
    results.hostKeyTitle = modalTitle();
    results.hostKeyNamesSession = /test mosh/.test(modalTitle());
    await shot('40-mosh-hostkey');
    [...document.querySelectorAll('.modal .modal-foot button')].find((b) => b.textContent === 'Cancel').click();
    const p0 = await pr;
    await waitFor(() => p0.status === 'failed', 8000, 'cancelled host key → failed');
    await waitFor(() => /host key not accepted/.test(text(p0)), 3000, 'failure text drawn');
    results.cancelFails = p0.dead && /Failed to start: host key not accepted/.test(text(p0));
    await app.closePane(p0, true);
    // 2. the key was not remembered: the prompt comes again; Accept → bootstrap → remote shell
    pr = app.openSession(s);
    await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key prompt again');
    results.promptAgainAfterCancel = /Unknown host key/.test(modalTitle());
    document.querySelector('.modal .btn.primary').click();
    const pane = await pr;
    await waitFor(() => pane.status === 'connected', 8000, 'mosh spawned');
    results.spawned = true;
    // mosh-client draws the remote shell; wait for the startup command to have run
    await waitFor(() => /MOSH_STARTUP_42/.test(text(pane)), 20000, 'remote shell + startup command');
    results.startupRan = true;
    results.moshScreen = pane._moshScreen === true; // the client took over the terminal (alternate screen)
    results.noBootstrapWarning = !/Permanently added|known hosts/.test(text(pane));
    pane.term.input('echo MOSH_OK_$((1+1))\r');
    await waitFor(() => /MOSH_OK_2/.test(text(pane)), 10000, 'echo over mosh');
    results.echo = true;
    results.status = document.getElementById('st-session').textContent;
    await shot('40-mosh');
    await pane.disconnect();
    await waitFor(() => pane.dead, 8000, 'mosh closed');
    results.closed = pane.status === 'disconnected';
    // 3. a bootstrap that cannot start mosh-server exits at once: status failed + hint (no second host-key prompt)
    const s2 = await app.saveSession({ name: 'test mosh noserver', folder: 'Test', type: 'mosh', host: '127.0.0.1', port: 2222, username: user, privateKeyPath: keyDir + '/client_ed25519', moshServer: '/nonexistent/mosh-server' });
    const p2 = await app.openSession(s2);
    await waitFor(() => p2.dead, 15000, 'no-server mosh ended');
    results.noServerFailed = p2.status === 'failed' && /Mosh could not connect — see the output above/.test(text(p2)) && /failed/.test(document.getElementById('st-session').textContent);
    results.noServerNoPrompt = !document.querySelector('.modal');
    await shot('41-mosh-noserver');
    await app.closePane(p2, true);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-mosh] FAIL', e.message, e.stack);
    await shot('99-mosh-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
