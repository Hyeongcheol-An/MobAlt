// Renderer-side check of the SFTP companion of a Mosh pane: the mosh client (brew install mosh) bootstraps
// over the local test sshd on 127.0.0.1:2222, then the Sftp panel browses the host through a separate
// shell-less SSH connection. Like e2e-mosh.js, replace __MOSH_SERVER__ with the mosh-server path first:
//   test/start-sshd.sh start
//   sed 's#__MOSH_SERVER__#/opt/homebrew/bin/mosh-server#' test/e2e-mosh-sftp.js > /tmp/e2e-mosh-sftp.js
//   test/qa/run.sh /tmp/e2e-mosh-sftp.js <out-dir> 120000
// The mosh bootstrap (ssh -o StrictHostKeyChecking=accept-new) may add [127.0.0.1]:2222 to ~/.ssh/known_hosts;
// remove it afterwards with `ssh-keygen -R '[127.0.0.1]:2222'` so e2e-ssh.js still gets its host-key prompt.
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
  /** The companion prompts for the host key only when the test sshd's key is unknown to the app. */
  const acceptHostKey = async () => {
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 2500, 'host key').catch(() => null);
    if (btn) {
      results.hostKeyPrompt = true;
      btn.click();
    }
  };
  const panelActive = () => document.getElementById('panel-sftp').classList.contains('active');
  try {
    await app.saveSettings({ confirmClose: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const base = { folder: 'Test', type: 'mosh', host: '127.0.0.1', port: 2222, username: user, privateKeyPath: keyDir + '/client_ed25519', moshServer: '__MOSH_SERVER__' };

    // 1. on-demand companion: the session does not open SFTP automatically
    const s1 = await app.saveSession({ ...base, name: 'test mosh sftp', sftpAuto: false, startupCommand: 'echo MOSH_STARTUP_$((40+2))' });
    const pane = await app.openSession(s1);
    await waitFor(() => pane.status === 'connected', 8000, 'mosh spawned');
    await waitFor(() => /MOSH_STARTUP_42/.test(text(pane)), 20000, 'remote shell + startup command');
    results.moshShell = true;
    results.noAutoCompanion = pane.sftpConnId === null && pane.sftpStatus === 'idle';
    app.showPanel('sftp');
    const btn = document.querySelector('#sftp-empty .sftp-mosh button');
    results.emptyStateButton = !!btn && /Open SFTP for this host \(via SSH\)/.test(btn.textContent);
    await shot('50-mosh-sftp-empty');
    btn.click();
    await acceptHostKey();
    await waitFor(() => pane.sftpStatus === 'connected' && pane.sftpConnId, 15000, 'companion connected');
    const cid = pane.sftpConnId;
    results.companionConnected = true;
    await waitFor(() => app.sftpPanel.connId === cid && app.sftpPanel.state()?.path, 10000, 'panel lists the home folder');
    const st = app.sftpPanel.state();
    results.panelBoundToCompanion = app.sftpPanel.connId === cid && panelActive();
    results.homeListed = st.path === app.info.home && st.entries.length > 0;
    results.status = document.getElementById('st-session').textContent;
    results.statusHint = /SFTP: connected/.test(results.status);
    results.connHeader = /via SSH/.test(document.getElementById('sftp-conn').textContent);
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
    await acceptHostKey();
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
    await app.closePane(pane2, true);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-mosh-sftp] FAIL', e.message, e.stack);
    await shot('99-mosh-sftp-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
