// Auth-flow checks: wrong saved password on a key-only server must surface the diagnostics line, and
// the host key / methods line must appear. Then a correct key session must still connect.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } throw new Error('timeout waiting for ' + what); };
  const log = (...a) => console.log('[e2e-auth]', ...a);
  const app = window.app; const results = {};
  const text = (pane) => { const b = []; for (let i = 0; i < pane.term.buffer.active.length; i++) b.push(pane.term.buffer.active.getLine(i)?.translateToString(true)); return b.join('\n'); };
  try {
    const home = app.info.home; const user = home.split('/').pop();
    const keyDir = home + '/src/MobAlt/test/sshd-runtime';
    // 1) password-only session against a key-only server -> must fail fast with diagnostics, no dialog hang
    const bad = await app.saveSession({ name: 'bad-auth', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'password', password: 'wrong' });
    const p1 = app.openSession(bad);
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 8000, 'host key dialog'); btn.click();
    const pane1 = await p1;
    await waitFor(() => pane1.dead, 15000, 'bad-auth to fail');
    const t1 = text(pane1);
    results.serverAccepts = /Server accepts: publickey/.test(t1);
    results.diag = /authentication failed — server accepts: publickey; tried: /.test(t1);
    results.noDialogLeft = !document.querySelector('.modal');
    log('bad-auth tail:\n' + t1.trim().split('\n').slice(-4).join('\n'));
    // 2) refused port -> ECONNREFUSED hint
    const refused = await app.saveSession({ name: 'refused', type: 'ssh', host: '127.0.0.1', port: 2299, username: user, authMethod: 'password', password: 'x' });
    const pane2 = await app.openSession(refused);
    await waitFor(() => pane2.dead, 15000, 'refused to fail');
    results.refusedHint = /nothing listens on that port/.test(text(pane2));
    // 3) no key configured + wrong saved password on a key-only server -> default ~/.ssh keys must be used
    //    (the test sshd's authorized_keys is extended with ~/.ssh/id_ed25519.pub by the runner)
    const dflt = await app.saveSession({ name: 'default-keys', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'auto', password: 'wrong', sftpAuto: false });
    const paneD = await app.openSession(dflt);
    await waitFor(() => paneD.status === 'connected' || paneD.dead, 20000, 'default-keys outcome');
    results.defaultKeys = paneD.status === 'connected';
    if (!results.defaultKeys) log('default-keys tail:\n' + text(paneD).trim().split('\n').slice(-4).join('\n'));
    // 4) good key session still works (agent keys are tried too; must not block)
    const good = await app.saveSession({ name: 'good', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'auto', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });
    const pane3 = await app.openSession(good);
    await waitFor(() => pane3.status === 'connected', 15000, 'good connected');
    results.goodConnected = true;
    log('RESULTS ' + JSON.stringify(results)); log('DONE');
  } catch (e) { console.error('[e2e-auth] FAIL', e.message); log('RESULTS ' + JSON.stringify(results)); }
  await sleep(300); window.api.app.quit();
})();
