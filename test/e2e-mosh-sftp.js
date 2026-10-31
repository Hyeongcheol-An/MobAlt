// Renderer-side check of the SFTP companion of a Mosh pane: the mosh client (brew install mosh) bootstraps
// over the local test sshd on 127.0.0.1:2222, then the Sftp panel browses the host through a separate
// shell-less SSH connection. Like e2e-mosh.js, replace __MOSH_SERVER__ with the mosh-server path first:
//   test/start-sshd.sh start
//   sed 's#__MOSH_SERVER__#/opt/homebrew/bin/mosh-server#' test/e2e-mosh-sftp.js > /tmp/e2e-mosh-sftp.js
//   test/qa/run.sh /tmp/e2e-mosh-sftp.js <out-dir> 120000
// The host key is verified once, by the app's own prompt, before the mosh client is spawned; the SFTP companion
// then finds it in the app's known_hosts and asks nothing. ~/.ssh/known_hosts is never written.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-mosh-sftp]', ...a);
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
      const v = fn();
      if (v) return v;
      await sleep(150);
    }
    throw new Error('timeout: ' + what);
  };
  /** True once an sftp call with the id is refused (the connection is gone from the main process). */
  const untilRefused = async (id, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const refused = await window.api.sftp.list(id, '.').then(() => false, (e) => /Not connected/.test(e.message));
      if (refused) return true;
      await sleep(200);
    }
    return false;
  };
  /** Accept the host-key prompt if it shows up within a moment; returns whether it did. */
  const acceptHostKey = async (ms = 2500) => {
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), ms, 'host key').catch(() => null);
    if (btn) btn.click();
    return !!btn;
  };
  const panelActive = () => document.getElementById('panel-sftp').classList.contains('active');
  try {
    await app.saveSettings({ confirmClose: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const base = { folder: 'Test', type: 'mosh', host: '127.0.0.1', port: 2222, username: user, privateKeyPath: keyDir + '/client_ed25519', moshServer: '__MOSH_SERVER__' };

    // 1. on-demand companion: the session does not open SFTP automatically
    const s1 = await app.saveSession({ ...base, name: 'test mosh sftp', sftpAuto: false, startupCommand: 'echo MOSH_STARTUP_$((40+2))' });
    const pr = app.openSession(s1);
    results.hostKeyPrompt = await acceptHostKey(10000); // the bootstrap's check: the only prompt of this run
    const pane = await pr;
    await waitFor(() => pane.status === 'connected', 8000, 'mosh spawned');
    await waitFor(() => /MOSH_STARTUP_42/.test(text(pane)), 20000, 'remote shell + startup command');
    results.moshShell = true;
    results.noAutoCompanion = pane.sftpConnId === null && pane.sftpStatus === 'idle';
    results.monitorHiddenWithoutCompanion = pane.monitorEl.hidden === true && pane.monitorAllowed() && pane.monitorEnabled(); // the bar needs the companion SSH connection
    app.showPanel('sftp');
    const btn = document.querySelector('#sftp-empty .sftp-mosh button');
    results.emptyStateButton = !!btn && /Open SFTP for this host \(via SSH\)/.test(btn.textContent);
    await shot('50-mosh-sftp-empty');
    btn.click();
    results.companionNoPrompt = !(await acceptHostKey(1500)); // the key is already in the app's known_hosts
    await waitFor(() => pane.sftpStatus === 'connected' && pane.sftpConnId, 15000, 'companion connected');
    const cid = pane.sftpConnId;
    results.companionConnected = true;
    // the remote monitoring bar of a Mosh pane polls the companion connection once it is up
    await waitFor(() => !pane.monitorEl.hidden && pane.monitorSample, 8000, 'monitoring bar via the companion');
    results.monitorViaCompanion = pane.monitorSample.host === app.info.hostname && pane.monitorConnId() === cid;
    await waitFor(() => app.sftpPanel.connId === cid && app.sftpPanel.state()?.path, 10000, 'panel lists the home folder');
    const st = app.sftpPanel.state();
    results.panelBoundToCompanion = app.sftpPanel.connId === cid && panelActive();
    results.homeListed = st.path === app.info.home && st.entries.length > 0;
    results.status = document.getElementById('st-session').textContent;
    results.statusHint = /SFTP: connected/.test(results.status);
    results.connHeader = /via SSH/.test(document.getElementById('sftp-conn').textContent);
    results.viaBadgeBeforeHost = !!document.querySelector('#sftp-conn .sftp-via') && document.getElementById('sftp-conn').textContent.indexOf('via SSH') < document.getElementById('sftp-conn').textContent.indexOf('127.0.0.1');
    results.followHiddenForMosh = document.getElementById('sftp-follow').closest('label').hidden === true;
    log('home listing:', st.path, st.entries.length, 'entries');

    // 2. file operations through the companion id (what the panel's toolbar/menus call)
    const dir = '/private/tmp/mobalt-mosh-sftp-' + Math.random().toString(36).slice(2, 8);
    await window.api.sftp.mkdir(cid, dir);
    await window.api.sftp.mkdir(cid, dir + '/alpha');
    await window.api.sftp.rename(cid, dir + '/alpha', dir + '/beta');
    await window.api.sftp.write(cid, dir + '/beta/note.txt', 'via mosh companion\n');
    await app.sftpPanel.navigate(dir);
    results.panelLists = app.sftpPanel.state().path === dir && app.sftpPanel.state().entries.map((e) => e.name).join(',');
    results.renamed = results.panelLists === 'beta';
    results.readBack = (await window.api.sftp.read(cid, dir + '/beta/note.txt')) === 'via mosh companion\n';
    await shot('51-mosh-sftp-list');
    await window.api.sftp.remove(cid, dir, true);
    results.removed = await window.api.sftp.stat(cid, dir).then(() => false, () => true);

    // 3. closing the pane drops the companion connection
    await app.closePane(pane, true);
    await waitFor(() => !app.sftpPanel.states.has(cid) && pane.sftpConnId === null, 8000, 'companion state dropped');
    results.paneClosedDropsCompanion = true;
    results.companionGone = await untilRefused(cid, 8000);
    results.panelEmpty = app.sftpPanel.connId === null;

    // 4. automatic companion (session default + Settings "Switch to SFTP panel") and Disconnect
    const s2 = await app.saveSession({ ...base, name: 'test mosh auto' });
    app.showPanel('sessions');
    const pane2 = await app.openSession(s2);
    results.autoNoPrompt = !(await acceptHostKey(1500));
    await waitFor(() => pane2.sftpStatus === 'connected' && pane2.sftpConnId, 15000, 'auto companion connected');
    const cid2 = pane2.sftpConnId;
    results.autoCompanion = true;
    await waitFor(() => app.sftpPanel.connId === cid2 && app.sftpPanel.state()?.path, 10000, 'auto panel bound');
    results.autoPanelShown = panelActive() && app.sftpPanel.state().path === app.info.home;
    await waitFor(() => /\S/.test(text(pane2)), 20000, 'mosh drew the remote shell');
    await shot('52-mosh-sftp-auto');
    await pane2.disconnect();
    await waitFor(() => pane2.dead, 8000, 'mosh closed');
    await waitFor(() => !app.sftpPanel.states.has(cid2) && pane2.sftpConnId === null && pane2.sftpStatus === 'idle', 8000, 'auto companion dropped');
    results.disconnectDropsCompanion = await untilRefused(cid2, 8000);
    results.monitorHiddenAfterDrop = pane2.monitorEl.hidden === true && pane2.monitorOn === false;
    await app.closePane(pane2, true);

    // 5. Advanced SSH for a Mosh session: the tab is there with the legacy preset, the algorithm lists and the
    //    monitoring bar (not the jump host, X11, agent forwarding, compression or keep-alive, which mosh's own ssh does
    //    not take); a bogus name blocks Save; a saved list is stored AND applied — a key exchange the test sshd does
    //    not offer fails the host-key check before mosh starts, with the "no matching key exchange" sentence; a
    //    restricted-but-valid list starts mosh and connects the SFTP companion (the same lists travel with it)
    const fieldOf = (root, label) => { const el = [...root.querySelectorAll('.form-grid > label')].find((l) => l.textContent === label)?.nextElementSibling; return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el : el?.querySelector('input,select,textarea'); };
    const cbOf = (root, txt) => [...root.querySelectorAll('.checks label')].find((l) => l.textContent.includes(txt))?.querySelector('input[type=checkbox]');
    const btnOf = (root, txt) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === txt);
    const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const visible = (el) => !!el && !el.hidden && el.offsetParent !== null;
    const errorsShown = (root) => [...root.querySelectorAll('.form-error')].filter(visible).map((e) => e.textContent);
    const session = (id) => app.sessions.sessions.find((x) => x.id === id);
    const s3 = await app.saveSession({ ...base, name: 'mosh algos', sftpAuto: false });
    const openAdvanced = async (sess) => {
      app.editSession(sess);
      const m = await waitFor(() => document.querySelector('.modal'), 5000, 'session editor');
      await sleep(300);
      const tab = [...m.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Advanced SSH');
      results.moshAdvancedTab = !!tab && !tab.hidden && visible(tab);
      tab.click();
      await sleep(100);
      return m;
    };
    let ed = await openAdvanced(s3);
    const kexTa = fieldOf(ed, 'Key exchange');
    results.moshAdvancedRows = visible(kexTa) && visible(cbOf(ed, 'Legacy algorithms')) && visible(cbOf(ed, 'Show remote monitoring bar')) && visible(btnOf(ed, 'Reset to defaults'))
      && !visible(cbOf(ed, 'X11 forwarding')) && !visible(cbOf(ed, 'Agent forwarding')) && !visible(cbOf(ed, 'Compression')) && !visible(fieldOf(ed, 'Jump host')) && !visible(fieldOf(ed, 'Keep-alive (s)'))
      && /Mosh: the preset and these lists apply to the host-key check before mosh starts and to the SFTP companion connection/.test(ed.querySelector('.mpage.active').textContent);
    await shot('53-mosh-advanced-ssh');
    setVal(kexTa, 'bogus-kex');
    ed.querySelector('.modal-foot .btn.primary').click();
    await sleep(300);
    results.moshBogusBlocksSave = document.querySelector('.modal') === ed && errorsShown(ed).includes('Unknown key exchange algorithm: bogus-kex') && document.activeElement === kexTa;
    setVal(kexTa, 'diffie-hellman-group14-sha256'); // valid, but the test sshd (OpenSSH 10) does not offer it
    ed.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved');
    await sleep(200);
    results.moshAlgosStored = JSON.stringify(session(s3.id).algorithms) === JSON.stringify({ kex: ['diffie-hellman-group14-sha256'] });
    const p3 = await app.openSession(session(s3.id));
    await waitFor(() => p3.status === 'failed', 20000, 'the host-key check refused the kex');
    await sleep(300);
    const flat = text(p3).replace(/\n/g, ''); // the long sentence wraps over several terminal rows
    results.moshAlgosApplied = /Failed to start: no matching key exchange: this session offers diffie-hellman-group14-sha256; the server offers .*curve25519-sha256.*Advanced SSH → Algorithms: add .*curve25519-sha256/.test(flat) && p3.dead;
    log('mosh with an impossible kex:', text(p3).trim().split('\n').slice(-4).join(' / '));
    await shot('54-mosh-algos-applied');
    await app.closePane(p3, true);
    // a restricted-but-valid list (and the legacy preset) still starts mosh, and the companion comes up with it
    ed = await openAdvanced(session(s3.id));
    cbOf(ed, 'Legacy algorithms').click(); // first: the preset appends its names to the lists
    await sleep(50);
    setVal(fieldOf(ed, 'Key exchange'), 'curve25519-sha256');
    ed.querySelector('.modal-foot .btn.primary').click();
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor saved (restricted)');
    await sleep(200);
    results.moshRestrictedStored = session(s3.id).legacyAlgorithms === true && JSON.stringify(session(s3.id).algorithms) === JSON.stringify({ kex: ['curve25519-sha256'] });
    const p4 = await app.openSession(session(s3.id));
    await waitFor(() => p4.status === 'connected', 10000, 'mosh spawned with the restricted list');
    await waitFor(() => /\S/.test(text(p4)), 20000, 'mosh drew the remote shell (restricted list)');
    p4.openSftpCompanion();
    await waitFor(() => p4.sftpStatus === 'connected' && p4.sftpConnId, 15000, 'companion with the restricted list');
    await waitFor(() => app.sftpPanel.connId === p4.sftpConnId && app.sftpPanel.state()?.path, 10000, 'panel on the restricted companion');
    results.moshRestrictedCompanion = p4.sftpStatus === 'connected' && app.sftpPanel.state().entries.length > 0;
    await shot('55-mosh-restricted-companion');
    await app.closePane(p4, true);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-mosh-sftp] FAIL', e.message, e.stack);
    await shot('99-mosh-sftp-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
