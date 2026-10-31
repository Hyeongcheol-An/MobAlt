// Phase 1 of the workspace-restore E2E (run via test/run-e2e-workspace.sh).
// Creates a session with icon/colour, opens it, splits with a local pane,
// renames the tab, lets the workspace autosave, then quits.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout waiting for ' + what);
  };
  const log = (...a) => console.log('[e2e-ws1]', ...a);
  const app = window.app;
  const results = {};
  try {
    const home = app.info.home;
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const user = home.split('/').pop();

    const s1 = await app.saveSession({
      name: 'ws-sshd', folder: 'WS/Grp', type: 'ssh', host: '127.0.0.1', port: 2222, username: user,
      authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false,
      icon: '🚀', color: '#4ea1ff',
    });
    results.saved = !!s1.id;

    // sidebar shows the custom icon + colour
    app.sessionTree.filterEl.value = 'ws-sshd';
    app.sessionTree.render();
    const ico = document.querySelector(`.tree-row[data-session="${s1.id}"] .ico`);
    results.sidebarIcon = ico?.textContent === '🚀' && ico.classList.contains('emoji'); // an emoji keeps its own colours; a colour without an icon is a swatch (--session-color)
    app.sessionTree.filterEl.value = '';
    app.sessionTree.render();

    // open (host key prompt) -> connected
    const p1 = app.openSession(s1);
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog');
    btn.click();
    const pane = await p1;
    await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
    results.connect = true;

    // tab got the session's icon and colour
    const tab = pane.tab;
    results.tabIcon = tab.icon === '🚀' && tab.tabEl.querySelector('.tabico')?.textContent === '🚀';
    results.tabColor = tab.color === '#4ea1ff';
    results.paneIcon = !!pane.el.querySelector('.pane-head .picon');

    // split: ssh | local, rename tab, resize ratio
    await app.splitActive('right', pane);
    const empty = app.activePane();
    await empty.becomeLocal();
    await waitFor(() => empty.kind === 'local' && empty.termId, 10000, 'local pane');
    tab.title = 'WS-TAB';
    tab.autoTitle = false;
    tab.root.ratio = 0.3;
    app.workspace.updateTab(tab);
    results.panes = tab.panes().length === 2;

    app.saveWorkspaceNow();
    await sleep(400);
    const ws = await window.api.workspace.get();
    results.wsSaved = ws && ws.tabs.length >= 1 && ws.tabs.some((t) => t.title === 'WS-TAB' && t.root.t === 'split');
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-ws1] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
  }
  await sleep(300);
  window.api.app.quit();
})();
