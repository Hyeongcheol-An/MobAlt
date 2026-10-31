// SSH key generator end to end (Session → Generate SSH Key…, the editor's Generate… button, the Tools panel button).
//   test/start-sshd.sh start
//   test/qa/run.sh test/e2e-keygen.js <out-dir> 120000
// Keys are generated into <out-dir>/keys (never ~/.ssh); the Save dialog of Browse… is answered with testNextDialog;
// "Install on a server…" targets the local test sshd and its test/sshd-runtime/authorized_keys, which is restored at
// the end. Nothing is added to the user's ssh-agent.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-keygen]', ...a);
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
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const fieldOf = (root, label) => { const el = [...root.querySelectorAll('.form-grid > label')].find((l) => l.textContent === label)?.nextElementSibling; return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el : el?.querySelector('input,select,textarea'); };
  const cbOf = (root, txt) => [...root.querySelectorAll('.checks label')].find((l) => l.textContent.includes(txt))?.querySelector('input[type=checkbox]');
  const btnOf = (root, txt) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === txt);
  const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const visible = (el) => !!el && !el.hidden && el.offsetParent !== null;
  const errorsShown = (root) => [...root.querySelectorAll('.form-error')].filter(visible).map((e) => e.textContent);
  // the generate step may be interrupted by the host-key prompt of the install connection: accept it
  const waitResult = async (m, ms = 30000) => waitFor(() => {
    const hk = [...document.querySelectorAll('.modal')].find((x) => /host key/i.test(x.querySelector('.modal-title-text')?.textContent || ''));
    if (hk) hk.querySelector('.modal-foot .btn.primary')?.click();
    return visible(m.querySelector('.keygen-result'));
  }, ms, 'key generated');
  const pendingDialogs = async () => (await window.api.app.testNextDialog()).pending;
  let connId = null, keyDir = null, authFile = null, authBefore = null;
  const addedBlobs = []; // key bodies installed on the test sshd, removed again in the end
  const sh = async (cmd) => { const r = await window.api.ssh.exec(connId, cmd); return { ...r, out: r.stdout.trim() }; };
  try {
    await app.saveSettings({ confirmClose: false });
    const home = app.info.home;
    const user = home.split('/').pop();
    keyDir = app.info.appPath + '/test/sshd-runtime';
    authFile = keyDir + '/authorized_keys';
    const outDir = (await shot('00-start')).replace(/\/shots\/[^/]+$/, '');
    const keysDir = outDir + '/keys';
    log('keys go to', keysDir);

    // a shell on the test sshd (also makes its host key known, so the install step below does not prompt)
    const sshd = await app.saveSession({ name: 'local-sshd', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });
    const p0 = app.openSession(sshd);
    const hk = await waitFor(() => document.querySelector('.modal .btn.primary') || (app.activePane()?.status === 'connected' ? { click() {} } : null), 15000, 'host key dialog or connection');
    hk.click();
    const shell = await p0;
    await waitFor(() => shell.status === 'connected', 15000, 'test sshd connected');
    connId = shell.termId;
    authBefore = (await sh(`cat ${authFile}`)).stdout;
    results.sshdReady = authBefore.includes('ssh-ed25519');

    // 1. the dialog from the Session menu action: defaults
    app.action('keygen');
    const m1 = await waitFor(() => modal(), 5000, 'keygen dialog');
    await sleep(200);
    results.title = m1.querySelector('.modal-title-text').textContent === 'Generate SSH key';
    const typeSel = fieldOf(m1, 'Key type'), commentIn = fieldOf(m1, 'Comment'), passIn = fieldOf(m1, 'Passphrase'), pass2In = fieldOf(m1, 'Confirm'), pathIn = fieldOf(m1, 'Save as');
    results.defaultType = typeSel.value === 'ed25519';
    results.defaultComment = commentIn.value === `${user}@mobalt`;
    results.defaultPath = /^~\/\.ssh\/id_ed25519(_\d+)?$/.test(pathIn.value);
    results.focusOnType = document.activeElement === typeSel;
    log('suggested path', pathIn.value);
    // the suggestion follows the type while the path is untouched
    const suggestedEd = pathIn.value;
    setVal(typeSel, 'rsa');
    await sleep(300);
    results.pathFollowsType = /^~\/\.ssh\/id_rsa(_\d+)?$/.test(pathIn.value);
    setVal(typeSel, 'ed25519');
    await sleep(300);
    results.pathBackToEd = pathIn.value === suggestedEd;
    // passphrase strength hint
    const strength = m1.querySelector('.keygen-strength');
    results.hintNone = /No passphrase/.test(strength.textContent) && strength.dataset.level === 'none';
    setVal(passIn, 'abc');
    results.hintWeak = /Weak passphrase/.test(strength.textContent) && strength.dataset.level === 'weak';
    setVal(passIn, 'correct horse battery staple');
    results.hintStrong = /Strong passphrase/.test(strength.textContent) && strength.dataset.level === 'strong';
    await shot('20-keygen-form');
    // 2. mismatched passphrases are refused before anything runs
    setVal(pass2In, 'correct horse battery stable');
    btnOf(m1, 'Generate').click();
    await sleep(300);
    results.mismatchBlocked = errorsShown(m1).some((t) => /do not match/.test(t)) && !visible(m1.querySelector('.keygen-result')) && document.activeElement === pass2In;
    await shot('21-keygen-mismatch');
    // 3. Browse… → the save dialog is answered from the queue → the path field takes the chosen file
    setVal(passIn, '');
    setVal(pass2In, '');
    const edPath = keysDir + '/id_ed25519';
    await window.api.app.testNextDialog({ canceled: false, filePath: edPath });
    btnOf(m1, 'Browse…').click();
    await waitFor(() => pathIn.value === edPath, 3000, 'path from the save dialog');
    results.browseFills = pathIn.value === edPath && (await pendingDialogs()) === 0;
    // a cancelled picker leaves the field alone
    await window.api.app.testNextDialog({ canceled: true });
    btnOf(m1, 'Browse…').click();
    await sleep(300);
    results.browseCancelKeeps = pathIn.value === edPath && (await pendingDialogs()) === 0;
    // 4. install on the test sshd: its authorized_keys lives in test/sshd-runtime (restored at the end)
    cbOf(m1, 'Install on a server').click();
    await sleep(100);
    const target = fieldOf(m1, 'Server'), remote = fieldOf(m1, 'Remote file');
    results.installRowsShown = visible(target) && visible(remote) && remote.value === '~/.ssh/authorized_keys';
    setVal(target, sshd.id);
    setVal(remote, authFile);
    btnOf(m1, 'Generate').click();
    await waitResult(m1);
    await sleep(200);
    await shot('22-keygen-result');
    const pub = m1.querySelector('.keygen-pub').value;
    const blob = pub.split(/\s+/)[1];
    addedBlobs.push(blob);
    results.pubShown = /^ssh-ed25519 AAAA\S+ \S+@mobalt$/.test(pub) && pub.endsWith(`${user}@mobalt`);
    const fpShown = m1.querySelector('.keygen-fp').textContent;
    results.resultTitle = m1.querySelector('.modal-title-text').textContent === 'SSH key generated' && btnOf(m1, 'Close') && !visible(btnOf(m1, 'Generate')) && !visible(btnOf(m1, 'Use in this session'));
    results.installStep = [...m1.querySelectorAll('.keygen-step.ok')].some((s) => new RegExp(`Installed on ${user}@127\\.0\\.0\\.1:2222 in `).test(s.textContent));
    log('steps:', [...m1.querySelectorAll('.keygen-step')].map((s) => s.className + ': ' + s.textContent).join(' | '));
    // copy
    btnOf(m1, 'Copy').click();
    await sleep(200);
    results.copied = (await window.api.clipboard.read()) === pub;
    results.copyToast = document.getElementById('toast-root').textContent.includes('Public key copied');
    btnOf(m1, 'Close').click();
    await sleep(200);
    results.closed = !document.querySelector('.modal');
    // files on disk: modes, the public key, the fingerprint of ssh-keygen -lf
    const st = await sh(`stat -f '%Lp' ${edPath} ${edPath}.pub | tr '\\n' ' '; echo; cat ${edPath}.pub; /usr/bin/ssh-keygen -lf ${edPath}.pub`);
    const [modes, pubOnDisk, lf] = st.out.split('\n');
    results.modes = modes.trim() === '600 644';
    results.pubMatchesDisk = pubOnDisk.trim() === pub;
    results.fingerprintMatches = !!lf && fpShown.startsWith(lf.trim().split(/\s+/)[1]) && /\(ED25519 256\)$/.test(fpShown);
    log('modes', modes, '| fingerprint shown', fpShown, '| -lf', lf);
    // the public key landed once in the sshd's authorized_keys, and the new key logs in with it
    const count = await sh(`grep -cF -- '${blob}' ${authFile}`);
    results.installedOnce = count.out === '1';
    const gen = await app.saveSession({ name: 'generated-key', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: edPath, sftpAuto: false });
    const gp = await app.openSession(gen);
    await waitFor(() => gp.status === 'connected' || gp.status === 'failed', 15000, 'generated key login');
    results.loginWithGeneratedKey = gp.status === 'connected';
    await gp.disconnect();
    await sleep(300);
    // generating again onto the same server: the line is not added twice ("Already present")
    app.action('keygen');
    const m1b = await waitFor(() => modal(), 5000, 'keygen dialog (again)');
    await sleep(200);
    setVal(fieldOf(m1b, 'Save as'), keysDir + '/id_ed25519_dup');
    cbOf(m1b, 'Install on a server').click();
    setVal(fieldOf(m1b, 'Server'), sshd.id);
    setVal(fieldOf(m1b, 'Remote file'), authFile);
    btnOf(m1b, 'Generate').click();
    await waitResult(m1b);
    const dupBlob = m1b.querySelector('.keygen-pub').value.split(/\s+/)[1];
    addedBlobs.push(dupBlob);
    results.secondKeyInstalled = (await sh(`grep -cF -- '${dupBlob}' ${authFile}`)).out === '1' && (await sh(`grep -cF -- '${blob}' ${authFile}`)).out === '1';
    btnOf(m1b, 'Close').click();
    await sleep(200);

    // 5. from the session editor: Generate… next to the key field, "Use in this session" fills it
    app.action('new-session');
    const ed = await waitFor(() => modal(), 5000, 'session editor');
    await sleep(300);
    const keyField = ed.querySelector('input[placeholder="~/.ssh/id_ed25519"]');
    const genBtn = btnOf(ed, 'Generate…');
    results.editorHasGenerate = !!genBtn && visible(genBtn) && genBtn.previousElementSibling?.textContent === 'Browse…';
    genBtn.click();
    const m2 = await waitFor(() => modal() !== ed ? modal() : null, 5000, 'keygen from the editor');
    await sleep(200);
    results.stacked = document.querySelectorAll('.modal').length === 2 && m2.querySelector('.modal-title-text').textContent === 'Generate SSH key';
    const sessPath = keysDir + '/id_ed25519_session';
    await window.api.app.testNextDialog({ canceled: false, filePath: sessPath });
    btnOf(m2, 'Browse…').click();
    await waitFor(() => fieldOf(m2, 'Save as').value === sessPath, 3000, 'editor keygen path');
    btnOf(m2, 'Generate').click();
    await waitResult(m2);
    await sleep(200);
    const useBtn = btnOf(m2, 'Use in this session');
    results.useButtonShown = visible(useBtn) && useBtn.classList.contains('primary') && document.activeElement === useBtn;
    await shot('23-keygen-use-in-session');
    useBtn.click();
    await sleep(300);
    results.useFillsKey = document.querySelectorAll('.modal').length === 1 && keyField.value === sessPath;
    results.focusBackInEditor = ed.contains(document.activeElement);
    log('editor key field after Use:', keyField.value);
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    results.editorDirtyAfterUse = document.querySelectorAll('.modal').length === 2; // the filled field counts as an edit
    document.querySelector('.modal.narrow .btn.primary')?.click(); // Discard
    await sleep(250);

    // 6. RSA 4096 with a passphrase, from the Tools panel button; the private key really is encrypted
    app.showPanel('tools');
    await sleep(200);
    document.getElementById('tool-keygen').click();
    const m3 = await waitFor(() => modal(), 5000, 'keygen from the Tools panel');
    await sleep(200);
    setVal(fieldOf(m3, 'Key type'), 'rsa');
    await sleep(300);
    const rsaPath = keysDir + '/id_rsa';
    setVal(fieldOf(m3, 'Save as'), rsaPath);
    setVal(fieldOf(m3, 'Comment'), 'rsa test key');
    setVal(fieldOf(m3, 'Passphrase'), 'correct horse battery staple');
    setVal(fieldOf(m3, 'Confirm'), 'correct horse battery staple');
    btnOf(m3, 'Generate').click();
    await waitResult(m3, 60000);
    await sleep(200);
    const rsaPub = m3.querySelector('.keygen-pub').value;
    const rsaFp = m3.querySelector('.keygen-fp').textContent;
    results.rsaPub = /^ssh-rsa AAAA\S+ rsa test key$/.test(rsaPub);
    results.rsaFingerprint = /\(RSA 4096\)$/.test(rsaFp);
    await shot('25-keygen-rsa');
    btnOf(m3, 'Close').click();
    await sleep(200);
    const rsaCheck = await sh(`/usr/bin/ssh-keygen -lf ${rsaPath}.pub; /usr/bin/ssh-keygen -y -P '' -f ${rsaPath} >/dev/null 2>&1 && echo PLAIN || echo ENCRYPTED; /usr/bin/ssh-keygen -y -P 'correct horse battery staple' -f ${rsaPath} | cut -d' ' -f1-2`);
    const [rsaLf, enc, rsaY] = rsaCheck.out.split('\n');
    results.rsaFingerprintMatches = rsaFp.startsWith(rsaLf.trim().split(/\s+/)[1]) && /^4096 /.test(rsaLf);
    results.rsaEncrypted = enc === 'ENCRYPTED' && rsaY === rsaPub.split(' ').slice(0, 2).join(' ');
    log('rsa:', rsaLf, '|', enc);

    // 7. an existing file is refused readably, before ssh-keygen runs
    app.action('keygen');
    const m4 = await waitFor(() => modal(), 5000, 'keygen dialog (exists)');
    await sleep(200);
    setVal(fieldOf(m4, 'Save as'), edPath);
    btnOf(m4, 'Generate').click();
    await waitFor(() => errorsShown(m4).length, 5000, 'exists error');
    results.existsRefused = errorsShown(m4).some((t) => /already exists — choose another file name/.test(t)) && !visible(m4.querySelector('.keygen-result')) && document.activeElement === fieldOf(m4, 'Save as');
    await shot('24-keygen-exists');
    // an empty path too
    setVal(fieldOf(m4, 'Save as'), '');
    btnOf(m4, 'Generate').click();
    await sleep(200);
    results.emptyPathRefused = errorsShown(m4).some((t) => /Choose where to save/.test(t));
    m4.querySelector('.close').click();
    await sleep(200);
    results.allKeysOnDisk = (await sh(`ls ${keysDir} | tr '\\n' ' '`)).out === 'id_ed25519 id_ed25519.pub id_ed25519_dup id_ed25519_dup.pub id_ed25519_session id_ed25519_session.pub id_rsa id_rsa.pub';
    log('keys on disk:', (await sh(`ls -l ${keysDir}`)).out);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-keygen] FAIL', e.message, e.stack);
    await shot('99-keygen-fail').catch(() => {});
  } finally {
    // restore the sshd's authorized_keys exactly: the lines installed above are taken out again (cat > keeps the file's mode)
    if (connId && authBefore !== null) {
      try {
        for (const b of addedBlobs) await window.api.ssh.exec(connId, `grep -vF -- '${b}' ${authFile} > ${authFile}.e2e && cat ${authFile}.e2e > ${authFile} && rm ${authFile}.e2e`);
        const after = await window.api.ssh.exec(connId, `cat ${authFile}`);
        results.authorizedKeysRestored = after.stdout === authBefore;
        if (!results.authorizedKeysRestored) log('authorized_keys before:\n' + authBefore + '\nafter:\n' + after.stdout);
      } catch (e) {
        results.authorizedKeysRestored = 'FAILED: ' + e.message;
      }
    }
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
