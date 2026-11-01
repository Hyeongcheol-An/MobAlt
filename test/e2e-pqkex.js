// Post-quantum key exchange end to end (Session editor → Advanced SSH → Post-quantum).
//   test/start-sshd.sh start
//   test/qa/run.sh test/e2e-pqkex.js <out-dir> 150000
// The checkbox is off by default and saves as `pqKex`; the hybrid names are accepted in the key-exchange list. With
// the option on, a session forced to each hybrid connects to the test sshd (OpenSSH 10.5) and the grey handshake
// line names the method "(post-quantum)"; left to its own list — or the legacy preset — the session negotiates
// ML-KEM (the hybrids go first); with the option off the previous default (curve25519) is back and the line never
// says post-quantum. Local sshd only: no remote server in CI.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-pqkex]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + what);
  };
  // terminal text with wrapped rows joined back into their line (the handshake line can wrap at 80 columns)
  const text = (pane) => {
    const b = pane.term.buffer.active;
    let out = '';
    for (let i = 0; i < b.length; i++) {
      const l = b.getLine(i);
      if (!l) continue;
      const next = b.getLine(i + 1);
      out += next && next.isWrapped ? l.translateToString(false) : l.translateToString(true) + '\n';
    }
    return out;
  };
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const fieldOf = (root, label) => { const el = [...root.querySelectorAll('.form-grid > label')].find((l) => l.textContent === label)?.nextElementSibling; return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el : el?.querySelector('input,select,textarea'); };
  const cbOf = (root, txt) => [...root.querySelectorAll('.checks label')].find((l) => l.textContent.includes(txt))?.querySelector('input[type=checkbox]');
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const visible = (el) => !!el && !el.hidden && el.offsetParent !== null;
  const errorsShown = (root) => [...root.querySelectorAll('.form-error')].filter(visible).map((e) => e.textContent);
  const session = (id) => app.sessions.sessions.find((x) => x.id === id);
  const openAdvanced = async (s) => {
    app.editSession(s);
    const m = await waitFor(() => modal(), 5000, 'session editor');
    await sleep(300);
    [...m.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Advanced SSH').click();
    await sleep(100);
    return m;
  };
  const save = async (m) => {
    m.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved');
    await sleep(200);
  };
  const LINE = /Key exchange (\S+?)( \(post-quantum\))?, host key (\S+), cipher (\S+)/;
  // connect a session, read its handshake line, disconnect
  const connectAndRead = async (s, what, shotName) => {
    const p = app.openSession(s);
    const hk = await waitFor(() => document.querySelector('.modal .btn.primary') || (app.activePane()?.status === 'connected' ? { click() {} } : null), 15000, 'host key dialog or connection');
    hk.click();
    const pane = await p;
    await waitFor(() => pane.status === 'connected' || pane.status === 'failed', 20000, what);
    await sleep(400);
    const status = pane.status;
    const txt = text(pane);
    const m = LINE.exec(txt);
    log(what + ':', status, '|', m ? m[0] : '(no handshake line)');
    if (shotName) await shot(shotName);
    await pane.disconnect();
    await sleep(300);
    return { status, line: m ? m[0] : '', kex: m ? m[1] : '', pq: !!(m && m[2]), hostKey: m ? m[3] : '', cipher: m ? m[4] : '', saysPq: /\(post-quantum\)/.test(txt) };
  };
  const MLKEM = 'mlkem768x25519-sha256', SNTRUP = 'sntrup761x25519-sha512@openssh.com';
  try {
    await app.saveSettings({ confirmClose: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const base = { type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false };

    // 1. the editor: the checkbox is off by default, has its help line, saves as pqKex and comes back ticked
    const s = await app.saveSession({ ...base, name: 'pq' });
    let m = await openAdvanced(s);
    const cb = cbOf(m, 'Post-quantum key exchange');
    results.checkboxOffByDefault = !!cb && cb.checked === false && session(s.id).pqKex !== true;
    results.helpLine = [...m.querySelectorAll('.form-help')].some((e) => visible(e) && /ML-KEM and sntrup761/.test(e.textContent) && /OpenSSH 8\.9 or newer \(ML-KEM: 9\.9 or newer\)/.test(e.textContent));
    // the hybrid names are valid in the key-exchange list (and the list keeps what it had: the option is separate)
    const kexArea = fieldOf(m, 'Key exchange');
    const before = kexArea.value;
    setVal(kexArea, `${MLKEM}, ${SNTRUP}, curve25519-sha256`);
    results.hybridNamesAccepted = !errorsShown(m).length && !kexArea.classList.contains('invalid');
    setVal(kexArea, before);
    cb.click();
    await shot('40-pqkex-editor');
    await save(m);
    results.savedOn = session(s.id).pqKex === true && session(s.id).algorithms === undefined;
    m = await openAdvanced(session(s.id));
    const cb2 = cbOf(m, 'Post-quantum key exchange');
    results.reopensTicked = !!cb2 && cb2.checked === true;
    cb2.click();
    await save(m);
    results.savedOff = session(s.id).pqKex === false;

    // 2. forced to each hybrid through the session's key-exchange list alone: the test sshd (OpenSSH 10.5) speaks both
    const r1 = await connectAndRead(await app.saveSession({ ...base, name: 'pq-mlkem', algorithms: { kex: [MLKEM] } }), 'forced ML-KEM', '41-pqkex-mlkem');
    results.mlkemForced = r1.status === 'connected' && r1.kex === MLKEM && r1.pq && r1.hostKey === 'ssh-ed25519' && /^aes|^chacha/.test(r1.cipher);
    const r2 = await connectAndRead(await app.saveSession({ ...base, name: 'pq-sntrup', algorithms: { kex: [SNTRUP] } }), 'forced sntrup761', '42-pqkex-sntrup761');
    results.sntrupForced = r2.status === 'connected' && r2.kex === SNTRUP && r2.pq;
    // the option puts both hybrids in front of an explicit list too, so ML-KEM wins even over a list of sntrup761 alone
    const r2b = await connectAndRead(await app.saveSession({ ...base, name: 'pq-sntrup-option', pqKex: true, algorithms: { kex: [SNTRUP] } }), 'option on + list of sntrup761');
    results.optionPrependsToExplicitList = r2b.status === 'connected' && r2b.kex === MLKEM && r2b.pq;

    // 3. the option alone (the session's own list): the hybrids go first, the server takes ML-KEM
    const r3 = await connectAndRead(await app.saveSession({ ...base, name: 'pq-on', pqKex: true }), 'option on, own list');
    results.onNegotiatesMlkem = r3.status === 'connected' && r3.kex === MLKEM && r3.pq;
    // 4. with the legacy preset too: the preset appends, the option prepends
    const r4 = await connectAndRead(await app.saveSession({ ...base, name: 'pq-on-legacy', pqKex: true, legacyAlgorithms: true }), 'option on + legacy preset');
    results.onWithLegacyStillMlkem = r4.status === 'connected' && r4.kex === MLKEM && r4.pq;

    // 5. off: the previous default — curve25519 — and nothing says post-quantum
    const r5 = await connectAndRead(await app.saveSession({ ...base, name: 'pq-off' }), 'option off', '43-pqkex-off');
    results.offIsCurve25519 = r5.status === 'connected' && /^curve25519-sha256(@libssh\.org)?$/.test(r5.kex) && !r5.pq && !r5.saysPq;
    results.lineShowsHostKeyAndCipher = r5.hostKey === 'ssh-ed25519' && !!r5.cipher;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-pqkex] FAIL', e.message, e.stack);
    await shot('99-pqkex-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
