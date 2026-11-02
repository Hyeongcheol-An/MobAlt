// The macOS Local Network permission as the app shows it — run by test/qa/localnet-check.sh (its header says how and
// why the app must be launched through `open`). The host comes from <userData>/localnet-host.txt. One RESULTS line:
//   sshRefused / telnetRefused   the connection failed on this Mac with EHOSTUNREACH
//   sshHint / telnetHint         the pane's error line names the Local Network setting
//   dialogTaken                  the dialog that opens the setting was shown (the canned "Later" answer was consumed)
//   dialogOnce                   a second refused connection shows no second dialog (its canned answer stays unused)
//   pingHint                     the Tools panel's ping to the host ends with the hint
//   permissionGranted            the connection went through instead: nothing to check, the app is allowed
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  const r = {};
  const log = (...a) => console.log('[localnet-check]', ...a);
  const text = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } throw new Error('timeout: ' + what); };
  const modal = () => document.querySelector('.modal .btn.primary');
  const settled = (p) => (modal() ? 'prompt' : p.status === 'connected' ? 'connected' : /EHOSTUNREACH|Connection failed|Telnet error|ECONNREFUSED|ETIMEDOUT/.test(text(p)) || p.status === 'failed' ? 'failed' : null);
  const deadline = setTimeout(() => { log('RESULTS ' + JSON.stringify({ ...r, error: 'deadline' })); window.api.app.quit(); }, 60000);
  try {
    r.version = app.info.version;
    const host = (await window.api.app.testFs('readText', app.info.userData + '/localnet-host.txt')).trim();
    r.host = host;
    await window.api.app.testNextDialog({ response: 1 }); // "Later", should the dialog come

    // SSH: refused on this Mac, or a prompt (host key / password) because the socket connected
    const ssh = await app.saveSession({ name: 'localnet-ssh', type: 'ssh', host, port: 22, username: 'nobody', authMethod: 'password', sftpAuto: false });
    const p1 = await app.openSession(ssh);
    r.sshOutcome = await waitFor(() => settled(p1), 20000, 'ssh outcome');
    const t1 = text(p1);
    r.sshRefused = /EHOSTUNREACH/.test(t1);
    r.sshHint = /Local Network/.test(t1);
    if (r.sshOutcome === 'prompt') { r.permissionGranted = true; (document.querySelector('.modal .btn:not(.primary)') || modal()).click(); }
    await sleep(600);
    r.dialogTaken = (await window.api.app.testNextDialog()).pending === 0; // the canned "Later" was consumed

    // Telnet: the same socket error through the telnet pane
    const telnet = await app.saveSession({ name: 'localnet-telnet', type: 'telnet', host, port: 23 });
    const p2 = await app.openSession(telnet);
    // a telnet pane is "connected" the moment its socket exists: wait for the socket's own verdict in the text
    r.telnetOutcome = await waitFor(() => (/Telnet error|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|login:|Password:/i.test(text(p2)) ? 'settled' : /closed|exited|failed/.test(p2.status) ? p2.status : null), 15000, 'telnet outcome').catch(() => 'timeout');
    const t2 = text(p2);
    r.telnetRefused = /EHOSTUNREACH/.test(t2);
    r.telnetHint = /Local Network/.test(t2);

    // once per run: a second refused connection shows no second dialog
    await window.api.app.testNextDialog({ response: 1 });
    const p3 = await app.openSession(ssh);
    await waitFor(() => settled(p3), 20000, 'second ssh outcome').catch(() => {});
    if (modal()) (document.querySelector('.modal .btn:not(.primary)') || modal()).click();
    await sleep(600);
    r.dialogOnce = (await window.api.app.testNextDialog()).pending === 1;

    // Tools → Ping: the hint after "No route to host"
    const out = [];
    let pingDone = false;
    window.api.on('tools:output', ({ text: chunk }) => out.push(chunk));
    window.api.on('tools:done', () => { pingDone = true; });
    await window.api.tools.ping(host, 1);
    await waitFor(() => pingDone, 20000, 'ping done').catch(() => {});
    const o = out.join('');
    r.pingUnreachable = /No route to host/.test(o);
    r.pingHint = /Local Network/.test(o);
    await window.api.app.screenshot('localnet-check');
  } catch (e) { r.error = e.message; }
  clearTimeout(deadline);
  log('RESULTS ' + JSON.stringify(r));
  window.api.app.quit();
})();
