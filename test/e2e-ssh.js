// Renderer-side end-to-end check. Run with:
//   test/start-sshd.sh start
//   MOBALT_TEST_SCRIPT=test/e2e-ssh.js MOBALT_SHOT_DIR=/tmp/shots MOBALT_SCREENSHOT=/tmp/shots/final.png MOBALT_SCREENSHOT_DELAY=90000 npx electron .
// Exercises: session save, host-key prompt, key auth, follow-cwd/SFTP, X11 env, session tunnel,
// SFTP mkdir/upload/download/read/write, encrypted key passphrase prompt, split, MultiExec.
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
  try {
    const home = app.info.home;
    const root = home + '/src/MobAlt';
    const keyDir = root + '/test/sshd-runtime';
    const user = home.split('/').pop();

    // 1. sessions
    const s1 = await app.saveSession({
      name: 'local-sshd', folder: 'Test/Local', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key',
      privateKeyPath: keyDir + '/client_ed25519', followCwd: true, sftpAuto: true, x11: true,
      tunnels: [{ type: 'local', bindHost: '127.0.0.1', bindPort: 2223, destHost: '127.0.0.1', destPort: 2222, enabled: true }],
    });
    const s2 = await app.saveSession({ name: 'enc-key', folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_enc_ed25519', sftpAuto: false });
    log('sessions saved:', app.sessions.sessions.map((s) => s.folder + '/' + s.name).join(', '));

    // 2. open s1 -> host key prompt
    const p1 = app.openSession(s1);
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog');
    await shot('02-hostkey');
    btn.click();
    const pane = await p1;
    await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
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
    await app.dropOnPane(emptyPane, { sessionId: s2.id }, 'center');
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
    const srcTab = app.workspace.tabs.find((t) => t.title === 'local-sshd');
    await app.dropOnPane(app.activePane(), { tabId: srcTab.id }, 'down');
    await sleep(800);
    results.tabMoved = app.workspace.tabs.length === 2 && app.workspace.active.panes().length === 4;
    await sleep(700);
    await shot('07-local-split');
    results.tabs = app.workspace.tabs.map((t) => `${t.title}[${t.panes().length}]`);
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
