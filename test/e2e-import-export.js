// Native file dialogs driven in test mode (window.api.app.testNextDialog): session export / import as JSON,
// the MobaXterm.ini importer, the session editor's private-key picker, the SFTP download-to / upload-from
// pickers — each with its cancel path (state untouched, no error toast) — plus the session log (no dialog).
// Needs the local test sshd (test/start-sshd.sh start): the exported files are read back over it.
//   test/qa/run.sh test/e2e-import-export.js <out-dir> 90000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-impexp]', ...a);
  const app = window.app;
  const results = {};
  const info = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const toasts = [];
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.classList?.contains('toast')) toasts.push({ text: n.textContent, error: n.classList.contains('error') });
  }).observe(document.getElementById('toast-root'), { childList: true });
  const toastsSince = (n) => toasts.slice(n);
  const errorToasts = () => toasts.filter((t) => t.error).map((t) => t.text);
  const answer = (r) => window.api.app.testNextDialog(r);
  const pendingAnswers = async () => (await window.api.app.testNextDialog()).pending;
  const sess = () => app.sessions.sessions;
  const byName = (name) => sess().find((s) => s.name === name);
  const SECRETS = ['hunter2-not-real', 'kp-secret-phrase', 'jump-secret-word', 'local-pw-after-import', 'hand-written-pw', 'moba-pw-local'];
  const fresh = async () => {
    await app.saveAllSessions({ sessions: [], folders: [] });
    await app.reloadSessions();
    return sess().length === 0 && app.sessions.folders.length === 0;
  };
  const closeEditor = async () => {
    document.querySelector('.modal')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
    document.querySelector('.modal.narrow .btn.primary')?.click(); // "Discard" when the form is dirty
    await waitFor(() => !document.querySelector('.modal'), 3000, 'editor closed');
  };
  let connId = null;
  try {
    await app.saveSettings({ confirmClose: false });
    const home = app.info.home;
    const root = app.info.appPath;
    const user = home.split('/').pop();
    const keyDir = root + '/test/sshd-runtime';
    const scratch = app.info.userData + '/scratch'; // under the run's user-data folder; created over the local sshd

    // --- 1. the local sshd: a real SFTP connection, which also reads the files the dialogs produce
    const sshd = await app.saveSession({ name: 'local sshd', folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: true });
    const p1 = app.openSession(sshd);
    (await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key prompt')).click();
    const pane = await p1;
    await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
    connId = pane.termId;
    await waitFor(() => app.paneByConn(connId) && app.sftpPanel.states.has(connId), 10000, 'sftp panel bound');
    app.sftpPanel.show(connId);
    const sftp = window.api.sftp;
    if ((await sftp.list(connId, app.info.userData)).entries.some((e) => e.name === 'scratch')) await sftp.remove(connId, scratch, true); // a reused out-dir
    for (const d of ['', '/remote', '/remote/sub', '/local', '/dl']) await sftp.mkdir(connId, scratch + d);
    const readLocal = (p) => sftp.read(connId, p);
    const exists = async (p) => { // via the parent listing: a stat of a missing file would print an error stack in the run log
      const i = p.lastIndexOf('/');
      const r = await sftp.list(connId, p.slice(0, i)).catch(() => null);
      return !!r && r.entries.some((e) => e.name === p.slice(i + 1));
    };
    results.sshdConnected = true;

    // --- 2. sessions with secrets, several types, an explicit (empty) folder
    await app.saveSession({ name: 'app-01', folder: 'Export/Prod', type: 'ssh', host: 'app-01.example.internal', port: 22, username: 'deploy', authMethod: 'password', password: SECRETS[0] });
    await app.saveSession({ name: 'bastion', folder: 'Export/Prod', type: 'ssh', host: 'bastion.example.internal', port: 2222, username: 'ops', authMethod: 'key', privateKeyPath: '~/.ssh/id_bastion', passphrase: SECRETS[1], jumpHost: 'jump.example.internal', jumpPassword: SECRETS[2] });
    await app.saveSession({ name: 'legacy-switch', folder: 'Export/Lab', type: 'telnet', host: 'sw.example.internal', port: 2323, username: 'admin' });
    await app.saveSession({ name: 'Build shell', type: 'local', cwd: '/tmp', icon: '🔧', color: '#4caf50' });
    await app.saveAllSessions({ sessions: sess(), folders: [...app.sessions.folders, 'Export/Empty'] });
    await app.reloadSessions();
    const before = { count: sess().length, ids: sess().map((s) => s.id).sort(), names: sess().map((s) => s.name).sort(), folders: [...app.sessions.folders].sort() };
    results.secretsSavedAsFlags = byName('app-01').hasPassword === true && byName('bastion').hasPassphrase === true && byName('bastion').hasJumpPassword === true
      && sess().every((s) => !('password' in s) && !('passphrase' in s) && !('jumpPassword' in s));
    const onDisk = JSON.parse(await readLocal(app.info.userData + '/sessions.json'));
    const diskPw = onDisk.sessions.find((s) => s.name === 'app-01').password;
    results.secretsEncryptedOnDisk = /^(enc|b64):/.test(diskPw) && !SECRETS.some((x) => JSON.stringify(onDisk).includes(x));
    info.diskSecretPrefix = diskPw.slice(0, 4);

    // --- 3. export: cancel leaves nothing behind; the file is JSON, carries the sessions, and no secret
    const exportFile = scratch + '/mobalt-sessions.json';
    let n = toasts.length;
    await answer({ canceled: true });
    await app.action('export-json');
    results.exportCancelQuiet = toastsSince(n).length === 0 && !(await exists(exportFile)) && (await pendingAnswers()) === 0;
    n = toasts.length;
    await answer({ canceled: false, filePath: exportFile });
    await app.action('export-json');
    results.exportToast = toastsSince(n).some((t) => t.text === `Exported to ${exportFile}` && !t.error);
    const raw = await readLocal(exportFile);
    const exported = JSON.parse(raw);
    results.exportedShape = Array.isArray(exported.sessions) && Array.isArray(exported.folders) && exported.sessions.length === before.count
      && exported.sessions.map((s) => s.id).sort().join() === before.ids.join()
      && exported.sessions.map((s) => s.name).sort().join() === before.names.join()
      && [...exported.folders].sort().join() === before.folders.join() && exported.folders.includes('Export/Empty');
    results.exportedFields = (() => {
      const a = exported.sessions.find((s) => s.name === 'app-01'), b = exported.sessions.find((s) => s.name === 'bastion'), t = exported.sessions.find((s) => s.name === 'legacy-switch');
      return a?.host === 'app-01.example.internal' && a?.username === 'deploy' && a?.folder === 'Export/Prod' && a?.authMethod === 'password'
        && b?.privateKeyPath === '~/.ssh/id_bastion' && b?.jumpHost === 'jump.example.internal' && b?.port === 2222 && t?.type === 'telnet' && t?.port === 2323;
    })();
    results.exportNoSecrets = !SECRETS.some((x) => raw.includes(x))
      && exported.sessions.every((s) => !('password' in s) && !('passphrase' in s) && !('jumpPassword' in s))
      && exported.sessions.find((s) => s.name === 'app-01').hasPassword === true && exported.sessions.find((s) => s.name === 'bastion').hasPassphrase === true;
    app.showPanel('sessions');
    await shot('70-export-toast');

    // --- 4. import into a fresh store: cancel first, then the file
    results.freshStore = await fresh();
    n = toasts.length;
    await answer({ canceled: true });
    await app.action('import-json');
    results.importCancelQuiet = toastsSince(n).length === 0 && sess().length === 0 && (await pendingAnswers()) === 0;
    n = toasts.length;
    await answer({ canceled: false, filePaths: [exportFile] });
    await app.action('import-json');
    results.importToast = toastsSince(n).some((t) => t.text === `Imported ${before.count} sessions` && !t.error);
    results.importRestoresAll = sess().length === before.count && sess().map((s) => s.id).sort().join() === before.ids.join()
      && sess().map((s) => s.name).sort().join() === before.names.join() && [...app.sessions.folders].sort().join() === before.folders.join();
    results.importRestoresFields = byName('app-01')?.host === 'app-01.example.internal' && byName('app-01')?.folder === 'Export/Prod' && byName('bastion')?.jumpHost === 'jump.example.internal' && byName('Build shell')?.icon === '🔧';
    // what the file did not carry stays gone: no password / passphrase after the round trip
    results.importNoSecretsBack = byName('app-01')?.hasPassword === false && byName('bastion')?.hasPassphrase === false && byName('bastion')?.hasJumpPassword === false;
    info.importedDiskRow = Object.keys(JSON.parse(await readLocal(app.info.userData + '/sessions.json')).sessions.find((s) => s.name === 'app-01')).filter((k) => /^has/.test(k));
    results.importNoJunkFlagsOnDisk = info.importedDiskRow.length === 0; // the exporter's hasPassword/… flags are not persisted
    results.treeShowsImported = document.querySelectorAll('#session-tree .tree-row[data-session]').length === before.count
      && ['Export', 'Export/Prod', 'Export/Lab', 'Export/Empty', 'Test'].every((f) => document.querySelector(`#session-tree .tree-row.folder[data-folder="${f}"]`));
    app.showPanel('sessions');
    await sleep(150);
    await shot('71-imported-tree');
    // --- 5. merge semantics: same ids overwrite (no duplicates, the file wins), unknown ids are added, local extras survive
    await answer({ canceled: false, filePaths: [exportFile] });
    await app.action('import-json');
    results.reimportNoDuplicates = sess().length === before.count;
    const renamed = await app.saveSession({ ...byName('legacy-switch'), name: 'renamed-locally' });
    const extra = await app.saveSession({ name: 'local-extra', type: 'ssh', host: 'extra.example.internal', username: 'u' });
    await answer({ canceled: false, filePaths: [exportFile] });
    await app.action('import-json');
    results.reimportFileWinsById = sess().find((s) => s.id === renamed.id)?.name === 'legacy-switch' && !byName('renamed-locally');
    results.reimportKeepsLocalExtra = sess().some((s) => s.id === extra.id) && sess().length === before.count + 1;
    // a password saved here for a session the file also has (same id; the file carries no secret) survives the
    // re-import, and a password written into a file by hand is taken and stored encrypted
    await app.saveSession({ ...byName('app-01'), password: SECRETS[3] });
    await answer({ canceled: false, filePaths: [exportFile] });
    await app.action('import-json');
    results.reimportKeepsSavedSecret = byName('app-01')?.hasPassword === true;
    const handWritten = scratch + '/hand-written.json';
    await sftp.write(connId, handWritten, JSON.stringify({ sessions: [{ name: 'hand-written', type: 'ssh', host: 'hand.example.internal', username: 'u', password: SECRETS[4] }] }));
    await answer({ canceled: false, filePaths: [handWritten] });
    await app.action('import-json');
    const diskAfter = await readLocal(app.info.userData + '/sessions.json');
    const handRow = JSON.parse(diskAfter).sessions.find((s) => s.name === 'hand-written');
    results.handWrittenSecretEncrypted = byName('hand-written')?.hasPassword === true && /^(enc|b64):/.test(handRow?.password || '') && !SECRETS.some((x) => diskAfter.includes(x));
    // a file without ids (hand-written, or another MobAlt's export edited down): every named session is added anew
    const noIds = scratch + '/no-ids.json';
    await sftp.write(connId, noIds, JSON.stringify({ folders: ['Hand/Written', ''], sessions: [
      { name: 'app-01', folder: 'Export/Prod', type: 'ssh', host: 'app-01.example.internal', username: 'deploy' },
      { host: 'nameless.example.internal', type: 'ssh' },
    ] }));
    n = toasts.length;
    await answer({ canceled: false, filePaths: [noIds] });
    await app.action('import-json');
    results.importWithoutIdAdds = sess().filter((s) => s.name === 'app-01').length === 2 && toastsSince(n).some((t) => t.text === 'Imported 1 session, skipped 1: entry 2: no name' && !t.error)
      && !sess().some((s) => s.host === 'nameless.example.internal') && app.sessions.folders.includes('Hand/Written') && !app.sessions.folders.includes('');
    info.importJsonSemantics = 'upsert by id (file wins, saved secrets kept), id-less entries added, nameless / unknown type / bad port skipped and counted, folders unioned, never deletes; not a sessions file → error toast';
    // a file that is not a sessions file: an error toast names the reason and nothing changes; bad entries are skipped and counted
    const countBefore = sess().length, foldersBefore = app.sessions.folders.length;
    const notJson = scratch + '/not-json.json', noSessions = scratch + '/no-sessions.json', badEntries = scratch + '/bad-entries.json';
    await sftp.write(connId, notJson, 'this is not json\n');
    await sftp.write(connId, noSessions, JSON.stringify({ folders: ['X'], hosts: [] }));
    await sftp.write(connId, badEntries, JSON.stringify({ sessions: [
      { name: 'hand-02', type: 'telnet', host: 'hand-02.example.internal', port: '2323' },
      { name: 'bad-port', host: 'x.example.internal', port: 'abc' },
      { name: 'bad-type', type: 'gopher', host: 'y.example.internal' },
      42,
    ] }));
    n = toasts.length;
    await answer({ canceled: false, filePaths: [notJson] });
    await app.action('import-json');
    const t1 = toastsSince(n);
    results.malformedFileErrorToast = t1.length === 1 && t1[0].error && /^Not a MobAlt sessions file: not JSON \(/.test(t1[0].text);
    n = toasts.length;
    await answer({ canceled: false, filePaths: [noSessions] });
    await app.action('import-json');
    const t2 = toastsSince(n);
    results.noSessionsArrayErrorToast = t2.length === 1 && t2[0].error && t2[0].text === 'Not a MobAlt sessions file: no "sessions" array';
    results.malformedLeavesStore = sess().length === countBefore && app.sessions.folders.length === foldersBefore && !app.sessions.folders.includes('X');
    n = toasts.length;
    await answer({ canceled: false, filePaths: [badEntries] });
    await app.action('import-json');
    const t3 = toastsSince(n);
    results.badEntriesSummaryToast = t3.length === 1 && !t3[0].error && t3[0].text === 'Imported 1 session, skipped 3: "bad-port": bad port "abc"; "bad-type": unknown type "gopher"; entry 4: not an object';
    results.badEntriesSkipped = byName('hand-02')?.port === 2323 && byName('hand-02')?.type === 'telnet' && !byName('bad-port') && !byName('bad-type') && sess().length === countBefore + 1;
    if (!results.malformedFileErrorToast || !results.badEntriesSummaryToast) log('import toasts:', JSON.stringify([t1, t2, t3]));

    // --- 6. MobaXterm.ini: cancel, then the synthetic fixture (its two unusable bookmarks are counted as skipped on every
    //        import); a second import refreshes what is already there instead of duplicating it
    results.freshStore2 = await fresh();
    const ini = root + '/test/fixtures/mobaxterm-sample.ini';
    const MOBA_SKIPPED = ', skipped 2: "unsupported-type": unsupported session type #999; "no-host": no host';
    n = toasts.length;
    await answer({ canceled: true });
    await app.action('import-moba');
    results.mobaCancelQuiet = toastsSince(n).length === 0 && sess().length === 0 && (await pendingAnswers()) === 0;
    n = toasts.length;
    await answer({ canceled: false, filePaths: [ini] });
    await app.action('import-moba');
    results.mobaToast = toastsSince(n).some((t) => t.text === 'Imported 7 sessions from MobaXterm.ini' + MOBA_SKIPPED && !t.error);
    const expectMoba = [
      ['web-01', 'ssh', 'web-01.example.internal', 22, 'deploy', 'MobaXterm'],
      ['core-switch', 'telnet', 'core-sw.example.internal', 23, 'admin', 'MobaXterm/Lab/Network'],
      ['edge-router', 'telnet', 'edge-rtr.example.internal', 2323, '', 'MobaXterm/Lab/Network'],
      ['win-build', 'rdp', 'win-build.example.internal', 3389, 'builder', 'MobaXterm/Lab/Windows'],
      ['kiosk-vnc', 'vnc', 'kiosk.example.internal', 5901, '', 'MobaXterm/Lab/Windows'],
      ['db-primary', 'ssh', 'db-primary.example.internal', 2222, 'dbadmin', 'MobaXterm/Prod'],
      ['bastion', 'ssh', 'bastion.example.internal', 22, '', 'MobaXterm/Prod'],
    ];
    const mobaMismatch = expectMoba.filter(([name, type, host, port, username, folder]) => {
      const s = byName(name);
      return !s || s.type !== type || s.host !== host || s.port !== port || s.username !== username || s.folder !== folder;
    }).map((x) => x[0]);
    results.mobaSessions = sess().length === 7 && mobaMismatch.length === 0 && !byName('unsupported-type') && !byName('no-host');
    results.mobaDetails = byName('web-01')?.x11 === true && byName('web-01')?.compression === true && byName('bastion')?.x11 === false && byName('bastion')?.compression === true
      && byName('db-primary')?.privateKeyPath === 'C:/Users/someone/keys/db.ppk' && /puttygen/.test(byName('db-primary')?.notes || '') && sess().every((s) => s.id && s.authMethod === 'auto');
    results.mobaTree = document.querySelectorAll('#session-tree .tree-row[data-session]').length === 7
      && ['MobaXterm', 'MobaXterm/Lab', 'MobaXterm/Lab/Network', 'MobaXterm/Lab/Windows', 'MobaXterm/Prod'].every((f) => document.querySelector(`#session-tree .tree-row.folder[data-folder="${f}"]`))
      && document.querySelector('#session-tree .tree-row.folder[data-folder="MobaXterm/Lab"] .sub')?.textContent === '4';
    if (mobaMismatch.length) log('moba mismatches:', mobaMismatch.join(', '), JSON.stringify(sess().map((s) => [s.name, s.type, s.host, s.port, s.username, s.folder])));
    app.showPanel('sessions');
    await sleep(150);
    await shot('72-moba-tree');
    // re-import: a bookmark already in the tree (same folder, name and host) is refreshed in place, not added again —
    // its connection facts follow the .ini while its id, saved password, icon and the rest stay; a session whose host
    // was changed here no longer matches, so the bookmark comes in beside it
    const web = byName('web-01'), bastionOld = byName('bastion');
    await app.saveSession({ ...web, username: 'changed-here', icon: '🐧', password: SECRETS[5] });
    await app.saveSession({ ...bastionOld, host: 'moved.example.internal' });
    n = toasts.length;
    await answer({ canceled: false, filePaths: [ini] });
    await app.action('import-moba');
    const t4 = toastsSince(n);
    results.mobaReimportNoDuplicates = sess().length === 8 && sess().filter((s) => s.name === 'web-01').length === 1 && t4.length === 1 && !t4[0].error
      && t4[0].text === 'Imported 1 session from MobaXterm.ini, updated 6 already in the tree' + MOBA_SKIPPED;
    const web2 = byName('web-01');
    results.mobaReimportRefreshesAndKeeps = web2?.id === web.id && web2?.username === 'deploy' && web2?.icon === '🐧' && web2?.hasPassword === true;
    results.mobaChangedHostAddsBeside = sess().filter((s) => s.name === 'bastion').length === 2 && sess().some((s) => s.id === bastionOld.id && s.host === 'moved.example.internal')
      && sess().some((s) => s.name === 'bastion' && s.id !== bastionOld.id && s.host === 'bastion.example.internal');
    if (!results.mobaReimportNoDuplicates) log('moba re-import toasts:', JSON.stringify(t4), 'count', sess().length);
    n = toasts.length;
    await answer({ canceled: false, filePaths: [ini] });
    await app.action('import-moba');
    results.mobaThirdImportNoop = sess().length === 8 && toastsSince(n).some((t) => t.text === 'Imported 0 sessions from MobaXterm.ini, updated 7 already in the tree' + MOBA_SKIPPED);
    info.mobaImportSemantics = 'bookmark matched by folder|name|host → refreshed in place (facts from the .ini; id, secrets, icon kept); otherwise added';

    // --- 7. the private-key picker in the session editor
    app.action('new-session');
    const keyInput = await waitFor(() => document.querySelector('.modal input[placeholder="~/.ssh/id_ed25519"]'), 3000, 'session editor');
    const browse = keyInput.parentElement.querySelector('button');
    results.keyBrowseButton = !!browse && browse.textContent === 'Browse…';
    keyInput.value = '';
    await answer({ canceled: true });
    browse.click();
    await sleep(300);
    results.keyPickCancelKeepsField = keyInput.value === '' && (await pendingAnswers()) === 0 && !!document.querySelector('.modal .type-picker');
    await answer({ canceled: false, filePaths: [home + '/.ssh/id_test_ed25519'] });
    browse.click();
    await waitFor(() => keyInput.value !== '', 3000, 'key field set');
    results.keyPickSetsFieldTilde = keyInput.value === '~/.ssh/id_test_ed25519'; // home is shortened to ~
    await answer({ canceled: false, filePaths: ['/opt/keys/deploy_ed25519'] });
    browse.click();
    await waitFor(() => keyInput.value.startsWith('/opt'), 3000, 'key field set (absolute)');
    results.keyPickSetsFieldAbsolute = keyInput.value === '/opt/keys/deploy_ed25519';
    await answer({ canceled: true });
    browse.click();
    await sleep(300);
    results.keyPickCancelKeepsValue = keyInput.value === '/opt/keys/deploy_ed25519';
    await shot('73-key-picker');
    await closeEditor();
    results.editorClosed = !document.querySelector('.modal');

    // --- 8. session log: no dialog — the file is named from the session in Settings → Log folder
    await app.saveSettings({ logDir: scratch + '/logs' });
    n = toasts.length;
    await pane.toggleLog(true);
    results.logNoDialog = typeof pane.logFile === 'string' && pane.logFile.startsWith(scratch + '/logs/local_sshd_') && pane.logFile.endsWith('.log')
      && (await exists(pane.logFile)) && toastsSince(n).some((t) => t.text === `Logging to ${pane.logFile}`) && (await pendingAnswers()) === 0;
    await pane.toggleLog(false);

    // --- 9. SFTP download-to (file: save dialog; folder: directory picker) and upload-from (open dialog)
    const remote = scratch + '/remote';
    await sftp.write(connId, remote + '/hello.txt', 'hello from the test sshd\n');
    await sftp.write(connId, remote + '/sub/nested.txt', 'nested\n');
    await app.sftpPanel.navigate(remote);
    const entries = () => app.sftpPanel.state().entries;
    await waitFor(() => entries().some((e) => e.name === 'hello.txt'), 5000, 'remote listing');
    const fileEntry = () => entries().find((e) => e.name === 'hello.txt');
    const dirEntry = () => entries().find((e) => e.name === 'sub');
    const transfers = () => [...app.sftpPanel.transfers.values()];
    const dl = scratch + '/dl/hello.txt';
    n = toasts.length;
    let tBefore = transfers().length;
    await answer({ canceled: true });
    await app.sftpPanel.download([fileEntry()]);
    await sleep(300);
    results.downloadCancelQuiet = toastsSince(n).length === 0 && transfers().length === tBefore && !(await exists(dl)) && (await pendingAnswers()) === 0;
    await answer({ canceled: false, filePath: dl });
    await app.sftpPanel.download([fileEntry()]);
    await waitFor(() => transfers().some((t) => t.local === dl && t.status === 'done'), 10000, 'file download done');
    results.downloadToPickedFile = (await readLocal(dl)) === 'hello from the test sshd\n';
    n = toasts.length;
    tBefore = transfers().length;
    await answer({ canceled: true });
    await app.sftpPanel.download([dirEntry()]);
    await sleep(300);
    results.downloadDirCancelQuiet = transfers().length === tBefore && !(await exists(scratch + '/dl/sub')) && toastsSince(n).length === 0;
    await answer({ canceled: false, filePaths: [scratch + '/dl'] }); // folder picker: the folder lands inside the chosen directory
    await app.sftpPanel.download([dirEntry()]);
    await waitFor(() => transfers().some((t) => t.local === scratch + '/dl/sub' && t.status === 'done'), 10000, 'folder download done');
    results.downloadDirIntoPickedFolder = (await readLocal(scratch + '/dl/sub/nested.txt')) === 'nested\n';

    await sftp.write(connId, scratch + '/local/up1.txt', 'upload one\n');
    await sftp.write(connId, scratch + '/local/up2.txt', 'upload two\n');
    n = toasts.length;
    tBefore = transfers().length;
    await answer({ canceled: true });
    await app.sftpPanel.upload([]); // the panel's Upload button: native picker
    await sleep(300);
    await app.sftpPanel.navigate(remote);
    results.uploadCancelQuiet = toastsSince(n).length === 0 && transfers().length === tBefore && !entries().some((e) => /^up[12]\.txt$/.test(e.name)) && (await pendingAnswers()) === 0;
    n = toasts.length;
    await answer({ canceled: false, filePaths: [scratch + '/local/up1.txt', scratch + '/local/up2.txt'] });
    await app.sftpPanel.upload([]);
    results.uploadToast = toastsSince(n).some((t) => t.text === 'Uploading 2 items' && !t.error); // QA4-09: a real plural, not "item(s)"
    await waitFor(() => ['up1.txt', 'up2.txt'].every((f) => transfers().some((t) => t.name === f && t.status === 'done')), 10000, 'uploads done');
    await app.sftpPanel.navigate(remote);
    await waitFor(() => entries().some((e) => e.name === 'up2.txt'), 5000, 'uploads listed');
    results.uploadFromPickedFiles = (await sftp.read(connId, remote + '/up1.txt')) === 'upload one\n' && (await sftp.read(connId, remote + '/up2.txt')) === 'upload two\n';
    app.showPanel('sftp');
    await sleep(150);
    await shot('74-sftp-transfers');

    // --- 10. the queue is empty, and nothing errored along the way
    results.noAnswersLeft = (await pendingAnswers()) === 0;
    const unexpected = errorToasts().filter((x) => !x.startsWith('Not a MobAlt sessions file: '));
    results.noUnexpectedErrorToasts = unexpected.length === 0;
    if (unexpected.length) log('error toasts:', JSON.stringify(unexpected));
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-impexp] FAIL', e.message, e.stack);
    await shot('99-impexp-fail').catch(() => {});
  }
  results.pass = !results.error && Object.entries(results).every(([k, v]) => k === 'pass' || v !== false);
  log('INFO ' + JSON.stringify(info));
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
