// Expert SSH algorithm settings end to end (Session editor → Advanced SSH → Algorithms).
//   test/start-sshd.sh start
//   test/qa/run.sh test/e2e-algorithms.js <out-dir> 180000
// The editor pre-fills ssh2's defaults, validates every name, keeps "Legacy algorithms" as a preset and stores only
// lists that differ; a restricted-but-valid set connects to the test sshd, an impossible one fails with a message
// that names what both sides offer. The last part is an "old device": test/start-sshd-legacy.sh (an sshd on
// 127.0.0.1:2223 offering only diffie-hellman-group14-sha1 + group1-sha1 and CBC ciphers), started and stopped from
// here through an exec on the 2222 sshd — the defaults fail with the "tick Legacy algorithms" hint, the preset
// connects and installs a key (test/sshd-runtime/authorized_keys is restored at the end).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-algos]', ...a);
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
  // terminal text with wrapped rows joined back into their line (a long failure message spans several rows)
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
  const btnOf = (root, txt) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === txt);
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const visible = (el) => !!el && !el.hidden && el.offsetParent !== null;
  const errorsShown = (root) => [...root.querySelectorAll('.form-error')].filter(visible).map((e) => e.textContent);
  const list = (ta) => ta.value.split(/[\s,]+/).filter(Boolean);
  const openAdvanced = async (s) => {
    app.editSession(s);
    const m = await waitFor(() => modal(), 5000, 'session editor');
    await sleep(300);
    [...m.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Advanced SSH').click();
    await sleep(100);
    return m;
  };
  const session = (id) => app.sessions.sessions.find((x) => x.id === id);
  // a shell on the 2222 sshd (this Mac) runs the helper script and restores authorized_keys; set once pane4 is up
  let ctl = null, legacySshd = false, authBefore = null, authFile = null;
  const addedBlobs = [];
  const sh = async (cmd) => { const r = await window.api.ssh.exec(ctl.termId, cmd); return { ...r, out: (r.stdout + r.stderr).trim() }; };
  try {
    await app.saveSettings({ confirmClose: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    authFile = keyDir + '/authorized_keys';
    const base = { type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false };
    const A = app.algorithms;
    results.tablesLoaded = !!A && A.defaults.kex.includes('curve25519-sha256') && A.supported.kex.includes('diffie-hellman-group14-sha1') && !A.defaults.kex.includes('diffie-hellman-group14-sha1') && A.legacy.cipher.includes('aes256-cbc');
    // the 2048-bit SHA-1 group leads the preset; the 1024-bit one is listed only when this build's crypto has it
    // (Electron 45's Node 24 does not: it is "unavailable", never offered, never "unknown")
    const g1 = 'diffie-hellman-group1-sha1';
    results.legacyOrder = A.legacy.kex[0] === 'diffie-hellman-group14-sha1' && A.legacy.kex[1] === 'diffie-hellman-group-exchange-sha1';
    results.group1Probed = Array.isArray(A.unavailable.kex) && A.unavailable.kex.includes(g1) === !A.supported.kex.includes(g1) && A.legacy.kex.includes(g1) === A.supported.kex.includes(g1);
    log('group1-sha1 available in this build:', A.supported.kex.includes(g1));

    // 1. the editor pre-fills ssh2's defaults; nothing is stored for them
    let s = await app.saveSession({ ...base, name: 'algos' });
    let m = await openAdvanced(s);
    const kex = () => fieldOf(m, 'Key exchange'), hostKey = () => fieldOf(m, 'Host key'), ciphers = () => fieldOf(m, 'Ciphers'), macs = () => fieldOf(m, 'MACs');
    results.prefilledDefaults = list(kex()).join() === A.defaults.kex.join() && list(hostKey()).join() === A.defaults.serverHostKey.join() && list(ciphers()).join() === A.defaults.cipher.join() && list(macs()).join() === A.defaults.hmac.join();
    results.areasLabelled = ['Key exchange', 'Host key', 'Ciphers', 'MACs'].every((l) => { const ta = fieldOf(m, l); return ta && ta.tagName === 'TEXTAREA' && m.querySelector(`label[for="${ta.id}"]`)?.textContent === l; });
    await shot('30-algorithms-defaults');
    // 2. an unknown name is an inline error while typing and blocks Save (the Advanced tab comes to the front)
    setVal(kex(), 'curve25519-sha256, nope-kex');
    results.inlineError = errorsShown(m).includes('Unknown key exchange algorithm: nope-kex') && kex().classList.contains('invalid') && kex().getAttribute('aria-invalid') === 'true';
    // the MAC list's error reads like the main process's ("MAC", not "mac"); the 1024-bit group gets its own sentence when the build lacks it
    setVal(macs(), 'hmac-sha2-256, bogus-one');
    results.macWording = errorsShown(m).includes('Unknown MAC algorithm: bogus-one');
    setVal(macs(), A.defaults.hmac.join(', '));
    setVal(kex(), `curve25519-sha256, ${g1}`);
    results.group1Wording = A.supported.kex.includes(g1) ? !errorsShown(m).length : errorsShown(m).includes(`Not available in this build: ${g1} (1024-bit Diffie-Hellman was removed from its crypto)`);
    setVal(kex(), 'curve25519-sha256, nope-kex');
    [...m.querySelectorAll('.mtabs button')][0].click(); // Basic in front, then Save
    m.querySelector('.modal-foot .btn.primary').click();
    await sleep(300);
    results.saveBlocked = document.querySelector('.modal') === m && m.querySelector('.mpage.active') === kex().closest('.mpage') && document.activeElement === kex() && document.getElementById('toast-root').textContent.includes('Unknown key exchange algorithm: nope-kex');
    await shot('31-algorithms-invalid');
    // fixing it clears the error; a restricted-but-valid list is saved as the override, the other three stay unstored
    setVal(kex(), 'curve25519-sha256');
    results.errorCleared = !errorsShown(m).length && !kex().classList.contains('invalid');
    setVal(ciphers(), A.defaults.cipher.join('\n')); // the same names, newline separated: still the defaults
    m.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved');
    await sleep(200);
    results.storedOnlyKex = JSON.stringify(session(s.id).algorithms) === JSON.stringify({ kex: ['curve25519-sha256'] });
    // 3. restricted but valid: curve25519-sha256 only → the test sshd connects
    const p1 = app.openSession(session(s.id));
    const hk = await waitFor(() => document.querySelector('.modal .btn.primary') || (app.activePane()?.status === 'connected' ? { click() {} } : null), 15000, 'host key dialog or connection');
    hk.click();
    const pane1 = await p1;
    await waitFor(() => pane1.status === 'connected' || pane1.status === 'failed', 15000, 'restricted set connection');
    results.restrictedConnects = pane1.status === 'connected';
    await pane1.disconnect();
    await sleep(300);
    // 4. Reset to defaults drops the override; the legacy preset adds and removes its algorithms
    m = await openAdvanced(session(s.id));
    results.overrideShown = list(kex()).join() === 'curve25519-sha256';
    btnOf(m, 'Reset to defaults').click();
    results.resetFills = list(kex()).join() === A.defaults.kex.join();
    cbOf(m, 'Legacy algorithms').click();
    await sleep(50);
    const withLegacy = { kex: list(kex()), hostKey: list(hostKey()), ciphers: list(ciphers()), macs: list(macs()) };
    results.legacyAppends = withLegacy.kex.join() === [...A.defaults.kex, ...A.legacy.kex].join()
      && withLegacy.ciphers.join() === [...A.defaults.cipher, ...A.legacy.cipher].join()
      && withLegacy.hostKey.join() === [...A.defaults.serverHostKey, 'ssh-dss'].join() // ssh-rsa is a default already
      && withLegacy.macs.join() === A.defaults.hmac.join();
    await shot('32-algorithms-legacy');
    cbOf(m, 'Legacy algorithms').click();
    await sleep(50);
    results.legacyRemoves = list(kex()).join() === A.defaults.kex.join() && list(hostKey()).join() === A.defaults.serverHostKey.join() && list(ciphers()).join() === A.defaults.cipher.join();
    cbOf(m, 'Legacy algorithms').click(); // on again, and saved: the preset alone, no stored lists
    m.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved (legacy)');
    await sleep(200);
    results.legacySavedAsPreset = session(s.id).legacyAlgorithms === true && session(s.id).algorithms === undefined;
    // the legacy session still connects (the sshd ignores the extra offers) and re-opens with the preset lists
    const p2 = await app.openSession(session(s.id));
    await waitFor(() => p2.status === 'connected' || p2.status === 'failed', 15000, 'legacy preset connection');
    results.legacyConnects = p2.status === 'connected';
    await p2.disconnect();
    await sleep(300);
    m = await openAdvanced(session(s.id));
    results.legacyReopens = cbOf(m, 'Legacy algorithms').checked && list(kex()).join() === [...A.defaults.kex, ...A.legacy.kex].join();
    m.querySelector('.close').click();
    await sleep(200);

    // 5. an impossible set: a key exchange the test sshd (OpenSSH 10) no longer offers → readable failure naming both sides
    const bad = await app.saveSession({ ...base, name: 'bad-kex', algorithms: { kex: ['diffie-hellman-group14-sha256'] } });
    const pane2 = await app.openSession(bad);
    await waitFor(() => pane2.status === 'failed', 15000, 'impossible kex failed');
    await sleep(500);
    const t2 = text(pane2);
    results.kexFailed = pane2.status === 'failed';
    results.kexMessage = /Connection failed: no matching key exchange: this session offers diffie-hellman-group14-sha256; the server offers [^;]*?curve25519-sha256/.test(t2) && /Advanced SSH → Algorithms: add [^\n]*?curve25519-sha256[^\n]*? to the key exchange list or Reset to defaults/.test(t2);
    results.kexStatus = /no matching key exchange/.test(document.getElementById('st-session').textContent) || /failed/.test(document.getElementById('st-session').textContent);
    log('kex failure text:\n' + t2.trim().split('\n').slice(-6).join('\n'));
    await shot('33-algorithms-mismatch');
    // a cipher nobody on the server side offers any more
    const badC = await app.saveSession({ ...base, name: 'bad-cipher', algorithms: { cipher: ['aes256-cbc'] } });
    const pane3 = await app.openSession(badC);
    await waitFor(() => pane3.status === 'failed', 15000, 'impossible cipher failed');
    await sleep(500);
    const t3 = text(pane3);
    results.cipherMessage = /no matching cipher: this session offers aes256-cbc; the server offers [^;\n]*?aes128-ctr/.test(t3) && /Reset to defaults/.test(t3);
    log('cipher failure text:\n' + t3.trim().split('\n').slice(-4).join('\n'));
    // 6. the stored lists survive the editor untouched and the message names the editor's lists after a Reset
    m = await openAdvanced(badC);
    results.badCipherShown = list(ciphers()).join() === 'aes256-cbc' && list(kex()).join() === A.defaults.kex.join();
    btnOf(m, 'Reset to defaults').click();
    m.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved (reset)');
    await sleep(200);
    results.resetClearsStored = session(badC.id).algorithms === undefined;
    const pane4 = await app.openSession(session(badC.id)); // the saved session, fresh (a pane's Reconnect keeps its own copy)
    await waitFor(() => pane4.status === 'connected' || pane4.status === 'failed', 15000, 'connect after reset');
    results.connectsAfterReset = pane4.status === 'connected';

    // 7. an old device: an sshd on 127.0.0.1:2223 that only speaks group14-sha1 + group1-sha1 and CBC ciphers,
    //    started on this Mac through the 2222 shell (pane4) — test/start-sshd-legacy.sh
    ctl = pane4;
    const legacyScript = app.info.appPath + '/test/start-sshd-legacy.sh';
    const started = await sh(`bash ${legacyScript} start`);
    log('legacy sshd:', started.out);
    legacySshd = /started on 127\.0\.0\.1:2223|already running/.test(started.out);
    results.legacySshdStarted = legacySshd;
    authBefore = (await sh(`cat ${authFile}`)).stdout;
    // 7a. the defaults against it: no raw "Unknown DH group", a sentence that names the preset
    const old = await app.saveSession({ ...base, name: 'old-device-defaults', port: 2223 });
    const p5 = await app.openSession(old);
    await waitFor(() => p5.status === 'failed' || p5.status === 'connected', 20000, 'old device with the defaults');
    await sleep(500);
    const t5 = text(p5);
    results.oldDeviceDefaultsFail = p5.status === 'failed';
    results.oldDeviceHint = /Connection failed: no matching key exchange: this session offers [^;]*; the server offers diffie-hellman-group14-sha1, diffie-hellman-group1-sha1\. The server only speaks old algorithms: tick "Legacy algorithms \(old devices\)" in Advanced SSH/.test(t5);
    results.oldDeviceNoRawDh = !/Unknown DH group/.test(t5);
    log('old device text:\n' + t5.trim().split('\n').slice(-5).join('\n'));
    const outDir = (await shot('34-algorithms-old-device-hint')).replace(/\/shots\/[^/]+$/, '');
    // 7b. the preset connects (the key of [127.0.0.1]:2223 is new to the app: one prompt, accepted)
    const leg = await app.saveSession({ ...base, name: 'old-device-legacy', port: 2223, legacyAlgorithms: true });
    const p6o = app.openSession(leg);
    const hk6 = await waitFor(() => document.querySelector('.modal .btn.primary'), 15000, 'host key dialog for :2223');
    hk6.click();
    const p6 = await p6o;
    await waitFor(() => p6.status === 'connected' || p6.status === 'failed', 20000, 'legacy preset against the old device');
    results.legacyPresetConnectsOldDevice = p6.status === 'connected';
    if (p6.status !== 'connected') log('legacy preset text:\n' + text(p6).trim().split('\n').slice(-5).join('\n'));
    await sleep(300);
    await shot('35-algorithms-legacy-old-device');
    // 7c. Generate SSH key → Install on a server → that session: the install connection takes the preset too
    app.action('keygen');
    const km = await waitFor(() => modal(), 5000, 'keygen dialog');
    await sleep(200);
    const keyPath = outDir + '/keys/id_legacy';
    setVal(fieldOf(km, 'Save as'), keyPath);
    cbOf(km, 'Install on a server').click();
    await sleep(100);
    setVal(fieldOf(km, 'Server'), leg.id);
    setVal(fieldOf(km, 'Remote file'), authFile);
    btnOf(km, 'Generate').click();
    await waitFor(() => visible(km.querySelector('.keygen-result')), 40000, 'key generated and installed');
    const blob = km.querySelector('.keygen-pub').value.split(/\s+/)[1];
    addedBlobs.push(blob);
    const steps = [...km.querySelectorAll('.keygen-step')].map((st) => st.className + ': ' + st.textContent);
    log('install steps:', steps.join(' | '));
    results.keygenInstallOnOldDevice = steps.some((st) => new RegExp(`keygen-step ok: Installed on ${user}@127\\.0\\.0\\.1:2223 in `).test(st)) && (await sh(`grep -cF -- '${blob}' ${authFile}`)).out === '1';
    await shot('36-algorithms-keygen-install-legacy');
    km.querySelector('.modal-foot .btn').click(); // Close
    await sleep(200);
    // 7d. and the new key logs in over the preset
    const gen = await app.saveSession({ ...base, name: 'old-device-new-key', port: 2223, legacyAlgorithms: true, privateKeyPath: keyPath });
    const p7 = await app.openSession(gen);
    await waitFor(() => p7.status === 'connected' || p7.status === 'failed', 20000, 'new key on the old device');
    results.newKeyLogsInOldDevice = p7.status === 'connected';
    await p7.disconnect();
    await p6.disconnect();
    await sleep(300);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-algos] FAIL', e.message, e.stack);
    await shot('99-algos-fail').catch(() => {});
  } finally {
    // the old device's sshd goes away and its authorized_keys loses the line installed above (cat > keeps the mode)
    if (ctl && ctl.status === 'connected') {
      try {
        if (authBefore !== null) {
          for (const b of addedBlobs) await sh(`grep -vF -- '${b}' ${authFile} > ${authFile}.e2e && cat ${authFile}.e2e > ${authFile} && rm ${authFile}.e2e`);
          results.authorizedKeysRestored = (await sh(`cat ${authFile}`)).stdout === authBefore;
        }
        if (legacySshd) {
          const stopped = await sh(`bash ${app.info.appPath}/test/start-sshd-legacy.sh stop`);
          results.legacySshdStopped = /stopped/.test(stopped.out);
        }
      } catch (e) {
        results.cleanup = 'FAILED: ' + e.message;
      }
    }
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
