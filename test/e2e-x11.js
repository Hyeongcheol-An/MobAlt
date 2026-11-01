// X11 forwarding: a forwarded client's window leaves XQuartz as soon as the client exits (sshd half-closes the X11
// channel; the local socket is ended on that EOF), not only when the SSH session ends. Needs the test sshd
// (X11Forwarding yes) and XQuartz with /opt/X11/bin/xwininfo and one of xlogo / xeyes / xclock on this Mac; without
// them the script skips with a logged reason. The X client's window shows on this Mac for a moment.
//   test/start-sshd.sh start; test/qa/run.sh test/e2e-x11.js <out-dir> 120000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const log = (...a) => console.log('[e2e-x11]', ...a);
  const app = window.app;
  const results = {};
  const X = '/opt/X11/bin';
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await fn(); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
      await sleep(80);
    }
  };
  const skip = (why) => { results.skipped = why; log('SKIP', why); };
  let pane = null;
  try {
    if (!(await fsx('exists', X + '/xwininfo'))) skip('xwininfo missing (XQuartz not installed)');
    const clients = [];
    for (const c of ['xlogo', 'xeyes', 'xclock']) if (await fsx('exists', `${X}/${c}`)) clients.push(c);
    if (!results.skipped && !clients.length) skip('no X client (xlogo / xeyes / xclock) in /opt/X11/bin');
    if (!results.skipped) {
      await app.saveSettings({ confirmClose: false, monitorBar: false });
      const user = app.info.home.split('/').pop();
      const keyDir = app.info.appPath + '/test/sshd-runtime';
      const s = await app.saveSession({ name: 'x11', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false, x11: true, monitor: false });
      pane = await app.openSession(s);
      await waitFor(() => { document.querySelector('.modal .btn.primary')?.click(); return pane.status === 'connected'; }, 30000, 'ssh connected');
      await sleep(1500);
      let seq = 0;
      const run = async (cmd, re, ms = 8000) => { pane.write(cmd + '\r'); return waitFor(() => re.exec(textOf(pane)), ms, cmd); };
      // XQuartz's own display, reachable from the sshd session (the same Mac)?
      const probe = await run(`DISPLAY=:0 ${X}/xwininfo -root -tree >/dev/null 2>&1 && echo XPROBE_''OK || echo XPROBE_''FAIL`, /XPROBE_(OK|FAIL)/);
      if (probe[1] !== 'OK') skip('display :0 not reachable from the sshd session (XQuartz not running?)');
      else {
        const client = clients[0];
        const title = 'mobaltx11e2e' + Math.random().toString(36).slice(2, 7);
        // how many top-level windows of that title the real display shows (the forwarded client's)
        const count = async () => { const tag = 'XC' + ++seq + '_'; const m = await run(`DISPLAY=:0 ${X}/xwininfo -root -tree 2>/dev/null | grep -c -- '"${title}"' | sed "s/^/${tag}=/"`, new RegExp(`${tag}=(\\d+)`)); return +m[1]; };
        pane.write(`DISPLAY=localhost:10.0 ${X}/${client} -title ${title} >/dev/null 2>&1 &\r`);
        let up = 0;
        for (let i = 0; i < 12 && !up; i++) { up = await count(); if (!up) await sleep(300); }
        results.client = client;
        results.windowUp = up > 0;
        await shot('30-x11-window-up');
        if (!up) throw new Error(`the ${client} window did not appear on :0 (is X11 forwarding working? see test/e2e-ssh.js)`);
        // the client exits on the server side (this Mac): the window must be gone within 2 s, the session still up
        const tKill = Date.now();
        pane.write(`pkill -f -- '-title ${title}'; echo KILLED_''AT\r`);
        await waitFor(() => /KILLED_AT/.test(textOf(pane)), 5000, 'pkill');
        let goneAt = null;
        for (let i = 0; i < 40 && goneAt === null; i++) if ((await count()) === 0) goneAt = Date.now();
        results.windowGoneMs = goneAt ? goneAt - tKill : null;
        results.windowGoneWithin2s = goneAt !== null && goneAt - tKill <= 2000;
        results.sessionStillUp = pane.status === 'connected' && !pane.dead;
        await shot('31-x11-window-gone');
      }
    }
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-x11] FAIL', e.message);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-x11-fail').catch(() => {});
  }
  if (pane && !pane.disposed) await app.closePane(pane, true);
  await sleep(300);
  window.api.app.quit();
})();
