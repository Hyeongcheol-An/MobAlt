// Renderer-side end-to-end check of a connection that is still being made, and of Cancel in the auth prompts.
// Servers: test/start-sshd.sh start; test/start-servers.sh start (ports 42500-42505, their logs under
// /tmp/mobalt-e2e-servers); then test/qa/run.sh test/e2e-ssh-cancel.js <out-dir> 240000.
// Exercises:
//   - Cancel (the connecting pane's button) while a slow server has not answered yet: the pane ends at once with
//     "Connection attempt cancelled.", no host-key dialog ever opens for it and the attempt is torn down — the delay
//     proxy logs the client gone before it relays, the test sshd's log gains no login (the "ghost" of the r16 QA)
//   - the same against a black-holed address, where TCP never connects
//   - the handshake timeout's wording: "no TCP connection" (black hole) against "no SSH banner" (a silent listener)
//   - a server that closes at once / right after its banner: "closed the connection during the handshake"
//   - Cancel in the keyboard-interactive dialog: "authentication cancelled", not "closed by the server"
//   - Cancel in the passphrase prompt of an Automatic session: "authentication cancelled" and no further dialog (no
//     agent, default key or password offered to the host); three wrong passphrases: "tried: <key> (passphrase)"
//   - a rejected saved password: the prompt says so
//   - a server without the sftp subsystem: with the SFTP browser off no error on connect, the panel says it is off;
//     Open SFTP Browser → "SFTP unavailable on <session>: …"
//   - the ssh-agent step saying why it offered nothing (run with SSH_AUTH_SOCK=/nonexistent for "not reachable")
(async () => {
  const SERVERS = '/tmp/mobalt-e2e-servers';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const log = (...a) => console.log('[e2e-ssh-cancel]', ...a);
  const app = window.app;
  const results = {};
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const tail = (p, n = 5) => textOf(p).trimEnd().split('\n').filter((l) => l.trim()).slice(-n).join('\n');
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await fn(); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
      await sleep(100);
    }
  };
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const title = (m) => m.querySelector('.modal-title-text')?.textContent.trim() || '';
  const body = (m) => m.querySelector('.modal-body, .modal')?.textContent.replace(/\s+/g, ' ').trim() || '';
  // every dialog that opens, with its time; host-key dialogs are accepted on sight (unless a step says not to)
  const dialogs = [];
  const autoHostKey = { on: true };
  new MutationObserver(() => {
    for (const m of $$('.modal')) if (!m._seen) {
      m._seen = true;
      dialogs.push({ t: Date.now(), title: title(m) });
      if (autoHostKey.on && /host key/i.test(title(m))) m.querySelector('.btn.primary')?.click();
    }
  }).observe(document.getElementById('modal-root'), { childList: true, subtree: true });
  const toasts = [];
  new MutationObserver(() => {
    for (const el of $$('#toast-root > *')) if (!el._seen) { el._seen = true; toasts.push(el.textContent); }
  }).observe(document.getElementById('toast-root'), { childList: true, subtree: true });
  const waitDialog = (re, ms = 10000) => waitFor(() => $$('.modal').find((m) => re.test(title(m)) || re.test(body(m))), ms, 'dialog ' + re);
  const cancel = async (m) => { const d = { title: title(m), body: body(m) }; $$('button', m).find((b) => b.textContent.trim() === 'Cancel').click(); await sleep(150); return d; };
  const answer = async (m, value) => {
    const d = { title: title(m), body: body(m) };
    const inputs = $$('input[type=password], input[type=text]', m);
    (Array.isArray(value) ? value : [value]).forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
    m.querySelector('.btn.primary').click();
    await sleep(150);
    return d;
  };
  const outcome = async (p, ms = 40000) => {
    const t0 = Date.now();
    await waitFor(() => p.dead || p.status === 'connected', ms, 'pane outcome').catch(() => {});
    await sleep(200);
    return { status: p.status, dead: p.dead, ms: Date.now() - t0, tail: tail(p, 4) };
  };
  const close = async (p) => { if (p && !p.disposed) await app.closePane(p, true); await sleep(200); };
  const user = app.info.home.split('/').pop();
  const keyDir = app.info.appPath + '/test/sshd-runtime';
  const sshdLog = keyDir + '/sshd.log';
  const base = { type: 'ssh', host: '127.0.0.1', username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false, monitor: false };
  let pane = null;
  const step = async (name, fn) => {
    try {
      results[name] = await fn();
      log(name, JSON.stringify(results[name]).slice(0, 600));
    } catch (e) {
      results[name] = { error: e.message, tail: pane ? tail(pane, 6) : '', dialogs: $$('.modal').map(title) };
      log(name, 'FAILED', e.message);
      await shot('99-' + name).catch(() => {});
      for (const m of $$('.modal')) { try { await cancel(m); } catch {} }
      await close(pane);
    }
  };
  try {
    await app.saveSettings({ confirmClose: false, monitorBar: false, readyTimeout: 20000 });
    await window.api.app.testResize(1100, 700);

    // 1. Cancel while the delay proxy keeps the connection silent (it relays to the test sshd after 6 s): the pane ends
    //    at once; nothing of the attempt reaches the sshd later and no dialog opens for a pane that is gone
    await step('ghostCancel', async () => {
      const s = await app.saveSession({ ...base, name: 'ghost', port: 42500 });
      const proxyBefore = (await fsx('readText', SERVERS + '/delayproxy.log')).length;
      const sshdBefore = (await fsx('readText', sshdLog)).length;
      const dialogsBefore = dialogs.length;
      pane = await app.openSession(s);
      await sleep(2000);
      const btn = pane.el.querySelector('.pane-overlay.connecting button');
      const during = { status: pane.status, strip: pane.el.querySelector('.pane-overlay.connecting span')?.textContent || '', cancelButton: btn?.textContent || null };
      await shot('10-connecting-with-cancel');
      const t0 = Date.now();
      btn.click();
      await waitFor(() => pane.dead, 3000, 'pane dead after Cancel');
      const cancelMs = Date.now() - t0;
      await sleep(300);
      const after = { status: pane.status, line: (textOf(pane).match(/── [^\n]*/) || [''])[0], overlay: pane.el.querySelector('.pane-overlay span')?.textContent || '', stripGone: !pane.el.querySelector('.pane-overlay.connecting') };
      await shot('11-cancelled');
      await sleep(9000); // the proxy would relay at 6 s: a ghost would do its handshake, host key and login now
      const proxyLog = (await fsx('readText', SERVERS + '/delayproxy.log')).slice(proxyBefore);
      const sshdDelta = (await fsx('readText', sshdLog)).slice(sshdBefore);
      const r = { during, cancelMs, after, dialogsAfterCancel: dialogs.slice(dialogsBefore).map((d) => d.title), proxyClientGone: /client gone before relay/.test(proxyLog), proxyRelayed: /relaying #/.test(proxyLog), sshdAccepted: /Accepted publickey/.test(sshdDelta), noFailedLine: !/Connection failed/.test(textOf(pane)) };
      await close(pane);
      return r;
    });

    // 2. the same against a black hole (TCP never connects)
    await step('blackholeCancel', async () => {
      pane = await app.openSession(await app.saveSession({ ...base, name: 'no-route-cancel', host: '10.255.255.1', port: 22 }));
      await sleep(400);
      const t0 = Date.now();
      pane.el.querySelector('.pane-overlay.connecting button')?.click();
      await waitFor(() => pane.dead, 3000, 'pane dead after Cancel');
      const cancelMs = Date.now() - t0;
      await sleep(3000);
      const r = { cancelMs, status: pane.status, line: (textOf(pane).match(/── [^\n]*/) || [''])[0], noFailedLine: !/Connection failed/.test(textOf(pane)) };
      await close(pane);
      return r;
    });

    // 3. the handshake timeout says what it waited for
    await step('timeoutWording', async () => {
      await app.saveSettings({ readyTimeout: 3000 });
      pane = await app.openSession(await app.saveSession({ ...base, name: 'no-route', host: '10.255.255.1', port: 22 }));
      const a = await outcome(pane, 15000);
      await close(pane);
      const { port } = await window.api.app.testSilentListen(0);
      pane = await app.openSession(await app.saveSession({ ...base, name: 'silent', port }));
      const b = await outcome(pane, 15000);
      await shot('12-timeout-wording');
      await close(pane);
      await app.saveSettings({ readyTimeout: 20000 });
      return { blackhole: a, blackholeNoTcp: /no TCP connection within 3s/.test(a.tail) && !/no SSH banner/.test(a.tail), silent: b, silentNoBanner: /no SSH banner within 3s/.test(b.tail) };
    });

    // 4. closed at once / after the banner
    await step('closedDuringHandshake', async () => {
      pane = await app.openSession(await app.saveSession({ ...base, name: 'close-at-once', port: 42501 }));
      const a = await outcome(pane, 15000);
      await close(pane);
      pane = await app.openSession(await app.saveSession({ ...base, name: 'banner-then-close', port: 42502 }));
      const b = await outcome(pane, 15000);
      await close(pane);
      const re = /closed the connection during the handshake/;
      return { closeAtOnce: a, bannerThenClose: b, bothExplained: re.test(a.tail) && re.test(b.tail) };
    });

    // 5. Cancel in the keyboard-interactive dialog
    await step('kbdCancel', async () => {
      pane = await app.openSession(await app.saveSession({ ...base, name: 'kbd-server', port: 42505, username: 'qa', authMethod: 'auto', privateKeyPath: '' }));
      const m = await waitDialog(/two-factor|Authentication/i, 15000);
      await shot('13-kbdint-dialog');
      const d = await cancel(m);
      const o = await outcome(pane, 15000);
      await close(pane);
      return { dialog: d, ...o, cancelledWording: /Connection failed: authentication cancelled/.test(o.tail) && !/closed by the server/.test(o.tail) };
    });

    // 6. Cancel in the passphrase prompt of an Automatic session; then three wrong passphrases on a key-only one
    await step('passphraseCancel', async () => {
      const s = await app.saveSession({ ...base, name: 'enc-auto', authMethod: 'auto', privateKeyPath: keyDir + '/client_enc_ed25519', port: 2222 });
      pane = await app.openSession(s);
      const m = await waitDialog(/passphrase/i, 15000);
      const n = dialogs.length;
      const d = await cancel(m);
      const o = await outcome(pane, 15000);
      await sleep(2500); // nothing else may ask after a cancel
      const later = dialogs.slice(n).map((x) => x.title);
      await shot('14-passphrase-cancel');
      await close(pane);
      return { dialog: d, ...o, cancelled: /authentication cancelled/.test(o.tail), noDialogAfter: later.length === 0, later };
    });
    await step('passphraseThreeWrong', async () => {
      const s = await app.saveSession({ ...base, name: 'enc-key', authMethod: 'key', privateKeyPath: keyDir + '/client_enc_ed25519', port: 2222 });
      pane = await app.openSession(s);
      const msgs = [];
      for (const v of ['nope1', 'nope2', 'nope3']) msgs.push((await answer(await waitDialog(/passphrase/i, 15000), v)).body.slice(0, 120));
      const o = await outcome(pane, 15000);
      const unwrapped = textOf(pane).replace(/\n/g, ''); // the summary line is wrapped by the terminal
      await close(pane);
      return { prompts: msgs, ...o, triedPassphrase: unwrapped.includes(`tried: ${keyDir}/client_enc_ed25519 (passphrase)`) };
    });

    // 7. a rejected saved password re-prompts saying so; the right password then connects
    await step('savedPasswordRejected', async () => {
      const s = await app.saveSession({ ...base, name: 'pw-stale', port: 42504, username: 'qa', authMethod: 'password', password: 'stale', privateKeyPath: '' });
      pane = await app.openSession(s);
      const m = await waitDialog(/password/i, 15000);
      await shot('15-saved-password-rejected');
      const d = await answer(m, 'qa-pass-1');
      const o = await outcome(pane, 15000);
      await close(pane);
      return { dialog: d, ...o, saysRejected: d.body.includes("The saved password was rejected. Enter qa@127.0.0.1's password"), connected: o.status === 'connected' };
    });

    // 8. a server without the sftp subsystem, the SFTP browser off: nothing complains until asked
    await step('noSftpSubsystem', async () => {
      const s = await app.saveSession({ ...base, name: 'pw-nosftp', port: 42504, username: 'qa', authMethod: 'password', password: 'qa-pass-1', privateKeyPath: '', sftpAuto: false });
      const n = toasts.length;
      pane = await app.openSession(s);
      const o = await outcome(pane, 15000);
      await sleep(1500);
      app.showPanel('sftp');
      await sleep(800);
      const panelNote = document.querySelector('#panel-sftp .sftp-msg')?.textContent || '';
      const quiet = !toasts.slice(n).some((x) => /subsystem|SFTP unavailable|Unable to start/i.test(x));
      await shot('16-sftp-off-note');
      app.sftpPanel.show(pane.termId); // Open SFTP Browser: now it is asked for
      await waitFor(() => toasts.slice(n).some((x) => /SFTP unavailable on pw-nosftp/.test(x)), 8000, 'SFTP unavailable toast');
      await sleep(300);
      await shot('17-sftp-unavailable');
      const r = { ...o, quietOnConnect: quiet, panelNote, unavailableToast: toasts.slice(n).find((x) => /SFTP unavailable on/.test(x)) || null };
      await close(pane);
      return r;
    });

    // 9. an agent-only session: the agent step says why it had nothing to offer (what it says depends on the agent of this run)
    await step('agentStep', async () => {
      pane = await app.openSession(await app.saveSession({ ...base, name: 'agent-only', port: 2222, authMethod: 'agent', privateKeyPath: '' }));
      const o = await outcome(pane, 20000);
      await close(pane);
      const agentLine = o.tail.split('\n').find((l) => /ssh-agent/.test(l)) || '';
      return { ...o, agentLine, explained: o.status === 'connected' || !/tried: nothing/.test(o.tail) || /ssh-agent: no keys loaded|ssh-agent not reachable/.test(agentLine) };
    });
  } catch (e) {
    results.scriptError = e.message;
    await shot('99-script').catch(() => {});
  }
  results.dialogs = dialogs.map((d) => d.title);
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
