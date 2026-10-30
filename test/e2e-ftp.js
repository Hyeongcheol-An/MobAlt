// Renderer-side FTP check against test/ftpd.py (pyftpdlib) on 127.0.0.1:2121.
//   python3 test/ftpd.py <root> 2121 mobalt secret &
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

    // wrong password → clear failure
    const bad = await app.saveSession({ name: 'bad ftp', folder: 'Test', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'mobalt', password: 'wrong' });
    const p2 = await app.openSession(bad);
    await sleep(1500);
    results.badStatus = p2.status;
    await shot('32-ftp-bad-login');

    await pane.disconnect();
    results.deadAfterDisconnect = pane.dead === true;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-ftp] FAIL', e.message, e.stack);
    await shot('99-ftp-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
