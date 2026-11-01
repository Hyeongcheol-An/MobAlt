// Telnet: the session's username answers the host's `login:` prompt (the username half of MobaXterm's auto-login),
// once; without a username the prompt waits for the user; the session editor says so under the field.
// Server: test/start-servers.sh start (42503 prints "login: " and echoes). Then:
//   test/qa/run.sh test/e2e-telnet.js <out-dir> 60000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-telnet]', ...a);
  const app = window.app;
  const results = {};
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + what);
  };
  const panes = [];
  try {
    await app.saveSettings({ confirmClose: false });
    const s = await app.saveSession({ name: 'telnet-login', folder: 'Test', type: 'telnet', host: '127.0.0.1', port: 42503, username: 'qa-user' });
    const t0 = Date.now();
    const pane = await app.openSession(s);
    panes.push(pane);
    await waitFor(() => /Welcome qa-user/.test(textOf(pane)), 8000, 'auto-login');
    results.autoLoginMs = Date.now() - t0;
    pane.term.input('hello\r');
    await waitFor(() => /you typed: hello/.test(textOf(pane)), 5000, 'echo');
    await sleep(500);
    results.autoLogin = /login: qa-user/.test(textOf(pane)) || /Welcome qa-user/.test(textOf(pane));
    results.onceOnly = (textOf(pane).match(/Welcome/g) || []).length === 1;
    await shot('40-telnet-auto-login');
    // without a username the prompt waits
    const s2 = await app.saveSession({ name: 'telnet-plain', folder: 'Test', type: 'telnet', host: '127.0.0.1', port: 42503, username: '' });
    const pane2 = await app.openSession(s2);
    panes.push(pane2);
    await waitFor(() => /login:$/.test(textOf(pane2).trimEnd()), 8000, 'login prompt');
    await sleep(1500);
    results.noAutoLoginWithoutUsername = !/Welcome/.test(textOf(pane2));
    pane2.term.input('manual\r');
    await waitFor(() => /Welcome manual/.test(textOf(pane2)), 5000, 'manual login');
    results.manualLogin = true;
    // the editor's note under Username for a telnet session
    app.editSession(s);
    await sleep(500);
    results.editorHelp = [...document.querySelectorAll('.modal .form-help')].some((e) => e.textContent === 'Sent at the login: prompt');
    await shot('41-telnet-editor');
    document.querySelector('.modal .close')?.click();
    await sleep(200);
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-telnet] FAIL', e.message);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-telnet-fail').catch(() => {});
  }
  for (const p of panes) if (!p.disposed) await app.closePane(p, true);
  await sleep(300);
  window.api.app.quit();
})();
