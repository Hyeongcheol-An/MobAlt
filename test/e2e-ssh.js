// Renderer-side end-to-end check. Run with:
//   test/start-sshd.sh start
//   MOBALT_TEST_SCRIPT=test/e2e-ssh.js MOBALT_SHOT_DIR=/tmp/shots MOBALT_SCREENSHOT=/tmp/shots/final.png MOBALT_SCREENSHOT_DELAY=90000 npx electron .
// Exercises: session save, ONE host-key prompt for four first connections to the same host opened in a grid (the
// others wait for its answer and do not run into the handshake limit), key auth, follow-cwd/SFTP, X11 env, session
// tunnel, SFTP mkdir/upload/download/read/write, encrypted key passphrase prompt, split, MultiExec.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + what);
  };
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e]', ...a);
  const app = window.app;
  const results = {};
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  try {
    const home = app.info.home;
    const root = app.info.appPath;
    const keyDir = root + '/test/sshd-runtime';
    const user = home.split('/').pop();
    await app.saveSettings({ confirmClose: false });

    // 1. sessions
    const s1 = await app.saveSession({
      name: 'local-sshd', folder: 'Test/Local', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key',
      privateKeyPath: keyDir + '/client_ed25519', followCwd: true, sftpAuto: true, x11: true,
      tunnels: [{ type: 'local', bindHost: '127.0.0.1', bindPort: 2223, destHost: '127.0.0.1', destPort: 2222, enabled: true }],
    });
    const s2 = await app.saveSession({ name: 'enc-key', folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_enc_ed25519', sftpAuto: false });
    log('sessions saved:', app.sessions.sessions.map((s) => s.folder + '/' + s.name).join(', '));

    // 1b. four first connections to the same unknown host at once (a folder opened in a 2x2 grid): ONE host-key
    //     prompt; it is left open longer than the handshake limit (shortened to 5 s here) and every connection still
    //     comes up once it is accepted — the ones behind the dialog wait for its answer instead of asking again
    await app.saveSettings({ readyTimeout: 5000 });
    const gridSessions = [];
    for (const i of [1, 2, 3, 4]) gridSessions.push(await app.saveSession({ name: 'grid-' + i, folder: 'Grid', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false }));
    const prompts = new Set();
    const promptWatch = new MutationObserver(() => { for (const m of document.querySelectorAll('.modal')) if (/host key/i.test(m.querySelector('.modal-title-text')?.textContent || '')) prompts.add(m); });
    promptWatch.observe(document.getElementById('modal-root'), { childList: true, subtree: true });
    const gridOpen = app.openSessionsInGrid(gridSessions, 2);
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog');
    await shot('02-hostkey');
    await sleep(7000); // longer than the 5 s limit: nothing may time out while the dialog waits
    results.onePromptForFour = prompts.size === 1 && document.querySelectorAll('.modal').length === 1;
    btn.click();
    await gridOpen;
    const gridTab = app.workspace.active;
    await waitFor(() => gridTab.panes().filter((p) => p.kind === 'ssh').every((p) => p.status === 'connected'), 20000, 'all four grid panes connected').catch(() => {});
    await sleep(500);
    const gridPanes = gridTab.panes().filter((p) => p.kind === 'ssh');
    results.gridAllConnected = gridPanes.length === 4 && gridPanes.every((p) => p.status === 'connected');
    results.gridNoTimeout = gridPanes.every((p) => !/Timed out while waiting for handshake/.test(textOf(p)));
    results.gridStillOnePrompt = prompts.size === 1 && !document.querySelector('.modal');
    promptWatch.disconnect();
    log('grid after one prompt:', gridPanes.map((p) => p.status).join(','), '| prompts seen:', prompts.size);
    await shot('02b-grid-one-prompt');
    await app.closeTab(gridTab);
    await sleep(300);
    await app.saveSettings({ readyTimeout: 20000 });

    // 2. open s1 — the host is known since 1b: no prompt (one is accepted if it does appear); X11 setup takes a while
    const pane = await app.openSession(s1);
    await waitFor(() => { document.querySelector('.modal .btn.primary')?.click(); return pane.status === 'connected'; }, 30000, 'ssh connected');
    results.connect = true;
    await sleep(1800);
    pane.write('\x15'); // clear any stray input on the line first
    await sleep(200);
    pane.write('cd /tmp && echo DISPLAY=$DISPLAY\r');
    await sleep(1500);
    results.followCwd = app.sftpPanel.state()?.path;
    log('sftp panel path after cd /tmp:', results.followCwd);
    // ~/.zprofile may override DISPLAY; query sshd's forwarded display explicitly (X11DisplayOffset 10)
    pane.write('DISPLAY=localhost:10.0 /opt/X11/bin/xdpyinfo 2>&1 | head -2; /opt/X11/bin/xauth list | grep -c ":10" \r');
    await sleep(2500);
    pane.write(`ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${keyDir}/client_ed25519 -p 2223 127.0.0.1 'echo TUNNEL_OK'\r`);
    await sleep(3500);
    await shot('03-ssh-x11-tunnel');
    const buf = [];
    for (let i = 0; i < pane.term.buffer.active.length; i++) buf.push(pane.term.buffer.active.getLine(i)?.translateToString(true));
    const text = buf.join('\n');
    results.display = /DISPLAY=localhost:\d+/.test(text);
    results.xdpyinfo = /name of display/.test(text);
    results.tunnel = /TUNNEL_OK/.test(text);
    log('terminal text tail:\n' + text.trim().split('\n').slice(-12).join('\n'));

    // 3. SFTP operations
    const connId = pane.termId;
    await window.api.sftp.remove(connId, '/tmp/mobalt-e2e', true).catch(() => {});
    await window.api.sftp.mkdir(connId, '/tmp/mobalt-e2e');
    const ids = await window.api.sftp.upload(connId, [root + '/package.json', root + '/src'], '/tmp/mobalt-e2e');
    log('upload transfer ids', ids);
    await waitFor(() => [...app.sftpPanel.transfers.values()].filter((t) => ids.includes(t.id) && t.status === 'done').length === ids.length, 20000, 'uploads done');
    await app.sftpPanel.navigate('/tmp/mobalt-e2e');
    await shot('04-sftp-list');
    results.uploadListed = app.sftpPanel.state().entries.map((e) => e.name).sort().join(',');
    const dl = await window.api.sftp.download(connId, '/tmp/mobalt-e2e/src', '/tmp/mobalt-e2e-dl/src', true);
    await waitFor(() => app.sftpPanel.transfers.get(dl)?.status === 'done', 20000, 'download done');
    results.download = app.sftpPanel.transfers.get(dl)?.status;
    const content = await window.api.sftp.read(connId, '/tmp/mobalt-e2e/package.json');
    results.readOk = content.includes('"name": "mobalt"');
    await window.api.sftp.write(connId, '/tmp/mobalt-e2e/hello.txt', 'hello from mobalt\n');
    await app.sftpPanel.navigate('/tmp/mobalt-e2e');
    results.writeOk = app.sftpPanel.state().entries.some((e) => e.name === 'hello.txt' && e.size === 18);
    await window.api.sftp.rename(connId, '/tmp/mobalt-e2e/hello.txt', '/tmp/mobalt-e2e/hello2.txt');
    await window.api.sftp.chmod(connId, '/tmp/mobalt-e2e/hello2.txt', 0o600);
    const st = await window.api.sftp.stat(connId, '/tmp/mobalt-e2e/hello2.txt');
    results.chmod = st.mode.toString(8);
    results.tunnels = (await window.api.tunnels.list()).map((t) => `${t.type}:${t.bindPort}->${t.destHost}:${t.destPort}=${t.status}`);

    // 4. encrypted key -> passphrase prompt
    const p2 = app.openSession(s2);
    const pw = await waitFor(() => document.querySelector('.modal input[type=password]'), 10000, 'passphrase dialog');
    await shot('05-passphrase');
    pw.value = 'secret';
    document.querySelector('.modal input[type=checkbox]').checked = true; // save passphrase in session
    document.querySelector('.modal .btn.primary').click();
    const pane2 = await p2;
    await waitFor(() => pane2.status === 'connected', 15000, 'enc-key connected');
    results.encKey = true;
    await app.reloadSessions();
    results.passphraseSaved = !!app.sessions.sessions.find((s) => s.id === s2.id)?.hasPassphrase;

    // 5. split -> empty pane -> "drop" the enc-key session onto it (saved passphrase means no prompt) + multiexec
    await app.action('split', 'down');
    const emptyPane = app.workspace.active.panes().find((p) => p.kind === 'empty');
    results.splitEmpty = !!emptyPane && !!emptyPane.el.querySelector('.pane-placeholder');
    // REAL drag (CDP) of the enc-key row from the Sessions panel onto the empty pane
    app.showPanel('sessions');
    await sleep(300);
    const row = document.querySelector(`.tree-row[data-session="${s2.id}"]`);
    const rr = row.getBoundingClientRect(), pr = emptyPane.el.getBoundingClientRect();
    const drag = await window.api.app.testDrag({ x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 }, { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 });
    log('real drag result: ' + JSON.stringify(drag));
    await sleep(800);
    results.realDragConnected = app.workspace.active.panes().some((p) => p.session && p.session.id === s2.id && p.kind === 'ssh');
    if (!results.realDragConnected) await app.dropOnPane(emptyPane, { sessionId: s2.id }, 'center'); // keep the rest of the suite going
    await waitFor(() => app.workspace.active.panes().every((p) => p.status === 'connected'), 15000, 'split pane connected');
    results.splitPanes = app.workspace.active.panes().length;
    await sleep(1500);
    app.action('multiexec');
    app.activePane().term.input('echo MULTI_OK_$$\r');
    await sleep(1500);
    await shot('06-split-multiexec');
    const texts = app.workspace.active.panes().map((p) => {
      const b = [];
      for (let i = 0; i < p.term.buffer.active.length; i++) b.push(p.term.buffer.active.getLine(i)?.translateToString(true));
      return b.join('\n');
    });
    results.multiexec = texts.every((t) => /MULTI_OK_\d+/.test(t));
    app.action('multiexec');

    // 6. local tab: split right -> empty pane -> make it a local shell; then drag-drop a session on its left edge
    app.workspace.activate(app.workspace.tabs[0]);
    await app.action('split', 'right');
    const e2 = app.workspace.active.panes().find((p) => p.kind === 'empty');
    await e2.becomeLocal();
    await sleep(800);
    results.becomeLocal = e2.kind === 'local' && e2.status === 'connected';
    await app.dropOnPane(e2, { sessionId: s1.id }, 'left');
    await waitFor(() => app.workspace.active.panes().length === 3 && app.workspace.active.panes().every((p) => p.status === 'connected'), 20000, 'edge split connected');
    results.edgeSplit = app.workspace.active.panes().length;
    // move the local-sshd tab's pane into this tab via "tab drop"
    // the other tab holding a local-sshd pane: the active one took that name when s1 was split into it (a session names its tab)
    const srcTab = app.workspace.tabs.find((t) => t !== app.workspace.active && t.panes().some((p) => p.session?.id === s1.id));
    await app.dropOnPane(app.activePane(), { tabId: srcTab.id }, 'down');
    await sleep(800);
    results.tabMoved = app.workspace.tabs.length === 2 && app.workspace.active.panes().length === 4;
    await sleep(700);
    // 7. grid layouts: 2x4 adds empty panes up to 8, then unsplit back to 1
    await app.applyLayout('2x4');
    await sleep(800);
    const grid = app.workspace.active.panes();
    results.grid8 = grid.length === 8 && grid.filter((p) => p.kind === 'empty').length === 4 && !!app.workspace.active.root && app.workspace.active.root.dir === 'v';
    await shot('08-grid-2x4');
    app.settings.confirmClose = false; // unsplit would otherwise ask before dropping live panes
    await app.unsplit();
    await sleep(500);
    results.unsplit = app.workspace.active.panes().length === 1;
    // 8. open a folder's sessions in a grid (Test folder has 2 sessions + bad ones? only s1,s2 saved in Test/*)
    await app.openSessionsInGrid(app.sessions.sessions.filter((x) => (x.folder || '').startsWith('Test')));
    await waitFor(() => app.workspace.active.panes().every((p) => p.status === 'connected'), 20000, 'grid sessions connected');
    results.folderGrid = app.workspace.active.panes().length;
    await shot('09-folder-grid');
    await shot('07-local-split');
    results.tabs = app.workspace.tabs.map((t) => `${t.title}[${t.panes().length}]`);

    // 9. a connection the server drops (this connection's sshd child killed from a local shell) is announced: a toast,
    //    a dim line in the terminal, "connection lost" in the status bar — while `exit` and Disconnect stay quiet
    {
      const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
      const seenToasts = [];
      new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.classList?.contains('toast')) seenToasts.push(n.textContent); }).observe(document.getElementById('toast-root'), { childList: true });
      const lostToast = 'Connection to enc-key was closed by the server';
      const sp = await app.openSession(app.sessions.sessions.find((x) => x.id === s2.id)); // saved passphrase: no prompt
      await waitFor(() => sp.status === 'connected', 15000, 'drop-test session connected');
      await sleep(1500);
      sp.write('\x15');
      sp.write('echo SSHD_CHILD=$PPID\r');
      const childPid = await waitFor(() => (/SSHD_CHILD=(\d+)/.exec(textOf(sp)) || [])[1], 8000, 'sshd child pid');
      const local = await app.newLocalTab();
      await waitFor(() => /[$%#>] ?$/.test(textOf(local).trimEnd()), 8000, 'local prompt');
      local.term.input(`kill ${childPid} && echo KILLED_OK\r`);
      app.focusPane(sp); // the status bar shows the pane the drop lands on
      await waitFor(() => /KILLED_OK/.test(textOf(local)), 8000, 'kill ran');
      await waitFor(() => sp.dead, 15000, 'ssh pane noticed the drop');
      await sleep(300);
      results.dropToast = seenToasts.includes(lostToast);
      results.dropLine = /── Connection to enc-key was closed by the server\. Press Enter to reconnect/.test(textOf(sp));
      results.dropStatus = sp.status === 'disconnected' && /Connection lost\./.test(sp.overlay?.textContent || '') && /disconnected \(connection lost\)/.test(document.getElementById('st-session').textContent);
      await shot('10-connection-lost');
      log('after the drop: toasts', JSON.stringify(seenToasts), '| status bar', document.getElementById('st-session').textContent);
      // `exit` in the shell and Session → Disconnect end the session without the warning
      const toastsBefore = seenToasts.length;
      await sp.reconnect();
      await waitFor(() => sp.status === 'connected', 15000, 'reconnected after the drop');
      await sleep(1200);
      sp.write('exit\r');
      await waitFor(() => sp.dead, 10000, 'exit ended the session');
      await sp.reconnect();
      await waitFor(() => sp.status === 'connected', 15000, 'reconnected after exit');
      await sleep(800);
      await sp.disconnect();
      await waitFor(() => sp.dead, 10000, 'disconnect ended the session');
      await sleep(300);
      results.quietEndsNoToast = seenToasts.length === toastsBefore && (textOf(sp).match(/closed by the server/g) || []).length === 1 && (textOf(sp).match(/── Session ended\./g) || []).length === 2;
      await app.closeTab(local.tab);
    }
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-fail').catch(() => {});
  }
  await sleep(500);
  window.api.app.quit();
})();
