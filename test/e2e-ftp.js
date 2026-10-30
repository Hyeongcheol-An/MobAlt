// Renderer-side FTP check against test/ftpd.py (pyftpdlib) on 127.0.0.1:2121. The data channel is throttled
// so the 120 MB upload the cancel check needs (<local>/e2e-big.bin where <local> replaces __FTP_ROOT__ below; create it with dd) is still running when it
// is cancelled:
//   dd if=/dev/urandom of=<root>/e2e-big.bin bs=1m count=120
//   python3 test/ftpd.py <root> 2121 mobalt secret 16000000 &
//   MOBALT_USER_DATA=... MOBALT_TEST_SCRIPT=test/e2e-ftp.js MOBALT_SHOT_DIR=... MOBALT_SCREENSHOT=... MOBALT_SCREENSHOT_DELAY=60000 npx electron .
// The server root is passed in through __FTP_ROOT__ (replaced by the runner) so download paths can be verified.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-ftp]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const localRoot = '__FTP_ROOT__';
  try {
    await app.saveSettings({ confirmClose: false });
    const s = await app.saveSession({ name: 'test ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'mobalt', password: 'secret', sftpAuto: true });
    const pane = await app.openSession(s);
    await waitFor(() => pane.status === 'connected', 8000, 'ftp connected');
    results.connected = true;
    results.connId = !!pane.termId;
    await sleep(600);
    results.panelShown = !document.getElementById('panel-sftp').hidden && !document.getElementById('sftp-ui').hidden;
    await shot('30-ftp-connected');

    const id = pane.termId;
    const home = await window.api.sftp.home(id);
    results.home = home;
    for (const d of ['e2e-dir', 'e2e-dup', 'e2e-rn', 'e2e-up']) await window.api.sftp.remove(id, home.replace(/\/$/, '') + '/' + d, true).catch(() => {}); // leftovers of an aborted run
    await window.api.sftp.mkdir(id, home.replace(/\/$/, '') + '/e2e-dir');
    await window.api.sftp.write(id, home.replace(/\/$/, '') + '/e2e-dir/hello.txt', 'hello ftp\n');
    const listing = await window.api.sftp.list(id, home.replace(/\/$/, '') + '/e2e-dir');
    results.listHasFile = listing.entries.some((e) => e.name === 'hello.txt' && e.size === 10);
    results.readBack = (await window.api.sftp.read(id, home.replace(/\/$/, '') + '/e2e-dir/hello.txt')) === 'hello ftp\n';
    await window.api.sftp.rename(id, home.replace(/\/$/, '') + '/e2e-dir/hello.txt', home.replace(/\/$/, '') + '/e2e-dir/renamed.txt');
    const st = await window.api.sftp.stat(id, home.replace(/\/$/, '') + '/e2e-dir/renamed.txt');
    results.statAfterRename = st.size === 10 && !st.isDir;

    // download to the local side and upload back
    const dl = await window.api.sftp.download(id, home.replace(/\/$/, '') + '/e2e-dir/renamed.txt', localRoot + '/downloaded.txt');
    await sleep(800);
    results.downloadStarted = !!dl;
    const up = await window.api.sftp.upload(id, [localRoot + '/downloaded.txt'], home.replace(/\/$/, '') + '/e2e-dir');
    await sleep(1200);
    results.uploadStarted = Array.isArray(up) && up.length === 1;
    const after = await window.api.sftp.list(id, home.replace(/\/$/, '') + '/e2e-dir');
    results.uploadedListed = after.entries.some((e) => e.name === 'downloaded.txt');
    const transfers = await window.api.sftp.transfers();
    results.transfersDone = transfers.filter((t) => t.status === 'done').length >= 2;

    // panel navigation shows the directory
    app.sftpPanel.navigate(home.replace(/\/$/, '') + '/e2e-dir');
    await sleep(600);
    results.panelLists = document.getElementById('sftp-list').textContent.includes('renamed.txt');
    await shot('31-ftp-panel');

    await window.api.sftp.remove(id, home.replace(/\/$/, '') + '/e2e-dir', true);
    const root = await window.api.sftp.list(id, home);
    results.removed = !root.entries.some((e) => e.name === 'e2e-dir');
    const H = home.replace(/\/$/, '');

    // FTP pane: no terminal → no "Follow terminal folder", no "cd terminal" button; the quit question counts it
    results.followHidden = document.getElementById('sftp-follow').closest('label').hidden === true;
    results.cdButtonHidden = document.querySelector('[data-sftp="terminal-cd"]').hidden === true;
    const q1 = await window.api.app.testQuitCheck();
    await app.saveSettings({ confirmClose: true });
    const q2 = await window.api.app.testQuitCheck();
    await app.saveSettings({ confirmClose: false });
    results.quitCounts = q1.live.ftp === 1 && q1.live.total === 1 && q1.wouldAsk === false && q2.wouldAsk === true && /1 FTP/.test(q2.question);
    log('quit check:', JSON.stringify(q2));

    // readable error texts (main maps the FTP replies; the renderer strips the IPC wrapper)
    const errText = (p) => p.then(() => '', (e) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    await window.api.sftp.mkdir(id, H + '/e2e-dup');
    results.errExists = await errText(window.api.sftp.mkdir(id, H + '/e2e-dup'));
    results.errMissing = await errText(window.api.sftp.remove(id, H + '/e2e-nope.txt', false));
    results.errReadable = /already exists on the server \(550/.test(results.errExists) && /Path not found on the server \(550/.test(results.errMissing) && !/FTPError/.test(results.errExists + results.errMissing);
    await window.api.sftp.remove(id, H + '/e2e-dup', true);

    // rename onto an existing name asks before replacing (FTP servers overwrite on RNTO)
    await window.api.sftp.mkdir(id, H + '/e2e-rn');
    await window.api.sftp.write(id, H + '/e2e-rn/a.txt', 'AAA\n');
    await window.api.sftp.write(id, H + '/e2e-rn/b.txt', 'BBBB\n');
    await app.sftpPanel.navigate(H + '/e2e-rn');
    const entryA = () => app.sftpPanel.state().entries.find((e) => e.name === 'a.txt');
    const modalText = () => document.querySelector('.modal')?.textContent || '';
    const renameTo = async (name) => {
      const done = app.sftpPanel.rename(entryA());
      await waitFor(() => document.querySelector('.modal input'), 3000, 'rename prompt');
      const inp = document.querySelector('.modal input');
      inp.value = name;
      document.querySelector('.modal .modal-foot .btn.primary').click();
      await waitFor(() => /already exists here/.test(modalText()), 3000, 'replace question');
      return { done }; // wrapped: an async function would otherwise chain the pending rename() promise
    };
    let { done } = await renameTo('b.txt');
    results.renameAsks = /Replace\?/.test(document.querySelector('.modal .modal-title').textContent) && /"b.txt" already exists here/.test(modalText());
    await shot('33-ftp-rename-replace');
    [...document.querySelectorAll('.modal .modal-foot button')].find((b) => b.textContent === 'Cancel').click();
    await done;
    const names = async () => (await window.api.sftp.list(id, H + '/e2e-rn')).entries.map((e) => e.name).sort().join(',');
    results.renameCancelKeepsBoth = (await names()) === 'a.txt,b.txt';
    ({ done } = await renameTo('b.txt'));
    [...document.querySelectorAll('.modal .modal-foot button')].find((b) => b.textContent === 'Replace').click();
    await done;
    await waitFor(() => !app.sftpPanel.state().entries.some((e) => e.name === 'a.txt'), 3000, 'renamed');
    results.renameReplace = (await names()) === 'b.txt' && (await window.api.sftp.read(id, H + '/e2e-rn/b.txt')) === 'AAA\n';
    await window.api.sftp.remove(id, H + '/e2e-rn', true);

    // a cancelled upload leaves no partial file on the server; the row shows the elapsed time
    const bigLocal = localRoot + '/e2e-big.bin';
    await window.api.sftp.mkdir(id, H + '/e2e-up');
    await window.api.sftp.write(id, H + '/e2e-up/.keep', '');
    const [bigId] = await window.api.sftp.upload(id, [bigLocal], H + '/e2e-up');
    await waitFor(() => (app.sftpPanel.transfers.get(bigId) || {}).transferred > 0, 8000, 'upload under way');
    await window.api.sftp.cancel(bigId);
    await waitFor(() => (app.sftpPanel.transfers.get(bigId) || {}).status === 'cancelled', 8000, 'upload cancelled');
    await sleep(500); // the partial file is removed over the control connection right after
    const upList = await window.api.sftp.list(id, H + '/e2e-up');
    results.cancelledUploadRemoved = !upList.entries.some((e) => e.name === 'e2e-big.bin');
    results.cancelRowElapsed = /cancelled\d+(\.\d)?s/.test([...document.querySelectorAll('#sftp-transfers .xfer.cancelled')].map((x) => x.textContent).join(' '));
    log('upload after cancel:', upList.entries.map((e) => `${e.name}:${e.size}`).join(' '), '| rows:', [...document.querySelectorAll('#sftp-transfers .xfer')].map((x) => x.textContent).join(' | '));
    await window.api.sftp.remove(id, H + '/e2e-up', true);

    // Disconnect: status / dots / card follow; the panel forgets the connection; Reconnect brings it back
    await pane.disconnect();
    results.deadAfterDisconnect = pane.dead === true;
    results.disconnectStatus = pane.status === 'disconnected' && /disconnected/.test(document.getElementById('st-session').textContent)
      && pane.tab.tabEl.querySelector('.dot').classList.contains('disconnected') && pane.headEl.querySelector('.dot').classList.contains('disconnected');
    results.disconnectCardNoButtons = !!pane.placeholder && !pane.placeholder.querySelector('.btns') && /Disconnected from/.test(pane.placeholder.textContent) && !!pane.overlay;
    results.disconnectDropsState = !app.sftpPanel.states.has(id) && app.sftpPanel.connId === null;
    results.disconnectRefused = await window.api.sftp.list(id, '.').then(() => false, (e) => /closed|Not connected/i.test(e.message)); // the id is gone from main
    await sleep(200);
    await shot('34-ftp-disconnected');
    await pane.reconnect();
    await waitFor(() => pane.status === 'connected' && pane.termId && pane.termId !== id, 8000, 'ftp reconnected');
    results.reconnected = !!pane.placeholder.querySelector('.btns') && !pane.dead;
    const id2 = pane.termId;

    // Closing the pane disconnects the FTP session and leaves no panel state behind
    await app.closePane(pane, true);
    await sleep(300);
    results.closeRefused = await window.api.sftp.list(id2, '.').then(() => false, (e) => /closed|Not connected/i.test(e.message));
    results.closeDropsState = !app.sftpPanel.states.has(id2) && app.sftpPanel.states.size === 0;
    const q3 = await window.api.app.testQuitCheck();
    results.closeNoLive = q3.live.ftp === 0;

    // wrong password → clear failure, readable in the card and the status bar
    const bad = await app.saveSession({ name: 'bad ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'mobalt', password: 'wrong' });
    const p2 = await app.openSession(bad);
    await waitFor(() => p2.status === 'failed', 8000, 'bad login failed');
    results.badStatus = p2.status;
    results.badLoginText = /Login failed \(530\): check the username\/password/.test(p2.placeholder?.textContent || '') && /Login failed \(530\)/.test(document.getElementById('st-session').textContent) && !/FTPError/.test(p2.placeholder?.textContent || '');
    results.badCardNoButtons = !p2.placeholder.querySelector('.btns') && !!p2.overlay;
    await shot('32-ftp-bad-login');
    await app.closePane(p2, true);

    // FTPS against a plain server → tells the user to untick FTPS
    const tls = await app.saveSession({ name: 'ftps plain', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'mobalt', password: 'secret', ftps: true });
    const p3 = await app.openSession(tls);
    await waitFor(() => p3.status === 'failed', 8000, 'ftps failed');
    results.ftpsText = /does not support FTPS \(explicit TLS\); untick FTPS/.test(p3.placeholder?.textContent || '');
    await app.closePane(p3, true);

    // user name without password → the app's password dialog, "Save in session" keeps it
    const ask = await app.saveSession({ name: 'ask ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'mobalt', sftpAuto: false });
    const pr = app.openSession(ask);
    await waitFor(() => /FTP password/.test(document.querySelector('.modal .modal-title')?.textContent || ''), 5000, 'ftp password prompt');
    results.passwordPrompt = /mobalt@127\.0\.0\.1's FTP password/.test(document.querySelector('.modal').textContent) && !!document.querySelector('.modal input[type=checkbox]');
    await shot('35-ftp-password-prompt');
    document.querySelector('.modal input[type=password]').value = 'secret';
    document.querySelector('.modal input[type=checkbox]').checked = true;
    document.querySelector('.modal .modal-foot .btn.primary').click();
    const p4 = await pr;
    await waitFor(() => p4.status === 'connected', 8000, 'connected after prompt');
    await sleep(300);
    await app.reloadSessions();
    results.passwordSaved = app.sessions.sessions.find((x) => x.id === ask.id)?.hasPassword === true;
    await app.closePane(p4, true);

    // quick connect ftp://host (no user) is anonymous and never reuses the saved "mobalt@" session
    const p5 = await app.quickConnect('ftp://127.0.0.1:2121');
    await waitFor(() => p5.status === 'connected', 8000, 'anonymous quick connect');
    results.quickAnonymous = !p5.session.id && !p5.session.username && /anonymous@127\.0\.0\.1/.test(document.getElementById('st-session').textContent);
    await shot('36-ftp-anonymous');
    await app.closePane(p5, true);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-ftp] FAIL', e.message, e.stack);
    await shot('99-ftp-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
