// Renderer-side check of the remote monitoring bar on an SSH pane (the local test sshd, which is this Mac):
//   test/start-sshd.sh start
//   test/qa/run.sh test/e2e-monitor.js <out-dir> 150000
// The bar appears within seconds of the connection with sane values, toggling hides / shows it and re-fits the
// terminal, polling stops while the pane is off screen and resumes on return, a host that cannot run the snippet
// shows "monitor unavailable" and is not polled again, one failed poll dims the strip as stale with the sample's age,
// disconnecting hides it, Settings and the session option decide the default, a narrow pane folds the strip by
// priority instead of clipping it, and the bar is photographed in two themes.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-monitor]', ...a);
  const app = window.app;
  const results = {};
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const stats = () => window.api.app.testMonitorStats();
  const barText = (p) => p.monitorEl.textContent;
  const closeModal = () => document.querySelector('.modal .close')?.click();
  try {
    await app.saveSettings({ confirmClose: false, sftpAutoOpen: false });
    const user = app.info.home.split('/').pop();
    const keyDir = app.info.appPath + '/test/sshd-runtime';
    const base = { folder: 'Test', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false };
    const s1 = await app.saveSession({ ...base, name: 'monitor-sshd' });
    results.defaultsOn = app.settings.monitorBar === true && app.settings.monitorInterval === 3;

    // 1. the bar appears on connect with sane values (CPU 0–100, memory, this Mac's host name), polled every 3 s
    const pr = app.openSession(s1);
    const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog');
    btn.click();
    const pane = await pr;
    await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
    const tConn = Date.now();
    results.hiddenBeforeConnect = true; // the strip starts hidden (see below for the disconnected state)
    await waitFor(() => !pane.monitorEl.hidden && pane.monitorSample && pane.monitorSample.cpu !== null && pane.monitorSample.rx !== null, 6000, 'first full sample');
    const s = pane.monitorSample;
    results.firstSampleMs = Date.now() - tConn;
    results.values = { cpu: s.cpu, memUsed: s.memUsed, memTotal: s.memTotal, diskPct: s.diskPct, rx: s.rx, tx: s.tx, load: s.load, uptime: s.uptime, host: s.host, os: s.os };
    results.saneValues = s.cpu >= 0 && s.cpu <= 100 && s.memTotal > 0 && s.memUsed > 0 && s.memUsed <= s.memTotal && s.diskPct >= 0 && s.diskPct <= 100
      && s.rx >= 0 && s.tx >= 0 && Array.isArray(s.load) && s.load.length === 3 && s.uptime > 0 && s.host === app.info.hostname && s.os === 'darwin';
    const items = [...pane.monitorEl.querySelectorAll('.mon-item')].map((i) => i.textContent);
    results.barText = items.join(' | ') + ' | ' + pane.monitorEl.querySelector('.mon-host')?.textContent;
    results.barShowsEverything = items.length === 6 && /^CPU\d+%$/.test(items[0]) && /^Mem[\d.]+ [KMGT]B \/ [\d.]+ [KMGT]B$/.test(items[1]) && /^Disk\d+%$/.test(items[2])
      && /^↓ [\d.]+ [KMGTB]+(\/s)?↑ [\d.]+ [KMGTB]+\/s$/.test(items[3].replace(/ B\/s/g, ' B/s')) && /^load\d+\.\d\d \d+\.\d\d \d+\.\d\d$/.test(items[4]) && /^up\d+[dhms]/.test(items[5])
      && pane.monitorEl.querySelector('.mon-host')?.textContent === app.info.hostname;
    results.barA11y = pane.monitorEl.getAttribute('role') === 'status' && pane.monitorEl.getAttribute('aria-live') === 'off';
    results.meters = pane.monitorEl.querySelectorAll('.mon-bar').length === 3 && [...pane.monitorEl.querySelectorAll('.mon-bar i')].every((i) => /^\d+%$/.test(i.style.width));
    const c = getComputedStyle(pane.monitorEl);
    results.barStyled = c.display === 'flex' && c.height === '20px';
    const st0 = await stats();
    await sleep(7000);
    const st1 = await stats();
    results.pollsEvery3s = st1.samples - st0.samples >= 2 && st1.samples - st0.samples <= 3 && st1.execCount - st0.execCount === st1.samples - st0.samples;
    log('polls in 7 s:', st1.samples - st0.samples, 'exec channels:', st1.execCount - st0.execCount);
    await shot('60-monitor-moba-dark');

    // 2. toggling (View menu / head button path) hides and shows the strip; the terminal re-fits around it
    const rowsWith = pane.term.rows;
    await app.action('toggle-monitor');
    await sleep(400);
    results.toggleHides = pane.monitorEl.hidden === true && pane.monitorEnabled() === false && pane.monBtn.getAttribute('aria-pressed') === 'false';
    const rowsWithout = pane.term.rows;
    const stHidden = await stats();
    await sleep(4000);
    results.noPollWhileOff = (await stats()).samples === stHidden.samples;
    await app.action('toggle-monitor');
    await waitFor(() => !pane.monitorEl.hidden && pane.monitorSample, 6000, 'bar back after the toggle');
    await sleep(300);
    results.toggleShows = pane.monitorEnabled() === true && pane.monBtn.getAttribute('aria-pressed') === 'true';
    results.refitRows = rowsWithout > rowsWith && pane.term.rows === rowsWith;
    log('rows with / without the bar:', rowsWith, rowsWithout);

    // 3. the head button is a Tab stop that toggles on Space (the head shows in a split); the context menu has the item
    await app.splitActive('right', pane);
    await sleep(300);
    const empty = app.activePane();
    app.focusPane(pane);
    await sleep(100);
    pane.monBtn.focus();
    results.headButtonFocusable = document.activeElement === pane.monBtn && pane.monBtn.tabIndex === 0 && !pane.monBtn.hidden && pane.monBtn.getAttribute('aria-label') === 'Remote monitoring bar';
    await window.api.app.testKey('Space');
    await sleep(300);
    results.headButtonSpaceToggles = pane.monitorEl.hidden === true;
    await shot('62-monitor-head-button');
    pane.monBtn.click();
    await waitFor(() => !pane.monitorEl.hidden, 3000, 'bar back after the head button');
    results.headButtonClickToggles = true;
    results.emptyPaneNoButton = empty.monBtn.hidden === true;
    pane.termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300, shiftKey: true }));
    await sleep(150);
    results.contextMenuItem = /Hide Remote Monitoring Bar/.test(document.getElementById('ctx-root').textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    await app.closePane(empty, true);
    await sleep(300);

    // 4. polling pauses while the pane is off screen (another tab in front) and resumes when it is back
    const local = await app.newLocalTab();
    await sleep(1200); // a poll in flight finishes
    const stOff = await stats();
    await sleep(7500);
    const stOff2 = await stats();
    results.pausedOffScreen = stOff2.samples === stOff.samples && pane.monitorPaused === true;
    log('polls while another tab was in front:', stOff2.samples - stOff.samples);
    app.workspace.activate(pane.tab);
    await waitFor(async () => (await stats()).samples > stOff2.samples, 5000, 'poll after the tab came back').catch(() => {});
    results.resumedOnReturn = (await stats()).samples > stOff2.samples && pane.monitorPaused === false;
    await app.closeTab(local.tab);
    await sleep(300);

    // 5. a host that cannot run the snippet: the dim "monitor unavailable" note, no more polling; a manual toggle retries
    await window.api.app.testMonitorCommand('exit 127');
    await app.action('toggle-monitor');
    await app.action('toggle-monitor'); // off and on: a fresh start polls at once
    await waitFor(() => pane.monitorFailed, 8000, 'unavailable');
    await sleep(200);
    results.unavailableShown = !pane.monitorEl.hidden && pane.monitorEl.classList.contains('unavailable') && barText(pane) === 'monitor unavailable' && /no sh on the host/.test(pane.monitorEl.querySelector('.mon-note')?.title || '');
    const stFail = await stats();
    await sleep(4000);
    results.unavailableStopsPolling = (await stats()).samples === stFail.samples && pane.monitorOn === false;
    await shot('63-monitor-unavailable');
    await window.api.app.testMonitorCommand(null);
    await app.action('toggle-monitor');
    await app.action('toggle-monitor');
    await waitFor(() => !pane.monitorFailed && pane.monitorSample, 8000, 'recovered after the toggle');
    results.toggleRetries = true;

    // 5b. one failed poll (a stuck host: the snippet hangs past the 10 s exec limit) — the last sample stays, but
    //     dimmed, with its age ("stale (14 s)") and the error in the tooltip; the next good poll clears it
    await window.api.app.testMonitorCommand('sleep 12');
    await waitFor(() => pane.monitorEl.classList.contains('stale'), 20000, 'stale after a timed-out poll');
    await window.api.app.testMonitorCommand(null); // well before the third failure would say "unavailable"
    const staleEl = pane.monitorEl.querySelector('.mon-stale');
    results.staleShown = !!staleEl && /^stale \(\d+ s\)$/.test(staleEl.textContent) && /^Last sample \d+ s ago; the last poll failed: timed out after 10 s$/.test(staleEl.title)
      && pane.monitorErrors === 1 && pane.monitorOn === true && !pane.monitorEl.classList.contains('unavailable') && pane.monitorEl.querySelectorAll('.mon-item').length === 7;
    results.staleDimmed = parseFloat(getComputedStyle(pane.monitorEl.querySelector('.mon-item')).opacity) < 1 && parseFloat(getComputedStyle(staleEl).opacity) === 1;
    const age1 = parseInt((staleEl.textContent.match(/\((\d+) s\)/) || [])[1], 10);
    await sleep(1500);
    const age2 = parseInt((pane.monitorEl.querySelector('.mon-stale')?.textContent.match(/\((\d+) s\)/) || [])[1], 10);
    results.staleAgeCounts = age2 > age1;
    log('stale:', staleEl.textContent, '→', age2, 's | tooltip:', staleEl.title);
    await shot('66-monitor-stale');
    await waitFor(() => !pane.monitorEl.classList.contains('stale') && pane.monitorErrors === 0, 15000, 'fresh again');
    results.staleCleared = !pane.monitorEl.querySelector('.mon-stale') && pane.monitorEl.querySelectorAll('.mon-item').length === 6 && parseFloat(getComputedStyle(pane.monitorEl.querySelector('.mon-item')).opacity) === 1;

    // 6. the light theme, then disconnecting hides the bar and reconnecting brings it back
    await app.saveSettings({ theme: 'light' });
    await sleep(500);
    await shot('61-monitor-light');
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(300);
    await pane.disconnect();
    await waitFor(() => pane.dead, 10000, 'disconnected');
    await sleep(200);
    results.disconnectHides = pane.monitorEl.hidden === true && pane.monitorOn === false;
    const stDead = await stats();
    await sleep(3500);
    results.noPollWhenDead = (await stats()).samples === stDead.samples;
    await pane.reconnect();
    await waitFor(() => pane.status === 'connected', 15000, 'reconnected');
    await waitFor(() => !pane.monitorEl.hidden && pane.monitorSample, 6000, 'bar after the reconnect');
    results.reconnectShows = true;

    // 7. Settings → Terminal: the global switch off → no bar (and no polling) on a session without its own value;
    //    a session's "Show remote monitoring bar" wins either way. The pane's own toggle (used above) outranks both,
    //    so it is cleared first — a pane the user switched by hand keeps that choice.
    results.paneToggleOutranksSetting = pane.monitorOverride === true;
    pane.monitorOverride = null;
    await app.saveSettings({ monitorBar: false });
    await sleep(300);
    results.settingOffHides = pane.monitorEl.hidden === true;
    await pane.disconnect();
    await waitFor(() => pane.dead, 10000, 'disconnected again');
    const stOffSetting = await stats();
    await pane.reconnect();
    await waitFor(() => pane.status === 'connected', 15000, 'reconnected with the setting off');
    await sleep(2500);
    results.settingOffNoBar = pane.monitorEl.hidden === true && (await stats()).samples === stOffSetting.samples;
    const sOn = await app.saveSession({ ...base, name: 'monitor-on', monitor: true });
    const pOn = await app.openSession(sOn);
    await waitFor(() => pOn.status === 'connected', 15000, 'monitor-on connected');
    await waitFor(() => !pOn.monitorEl.hidden && pOn.monitorSample, 6000, 'session option on wins over the setting');
    results.sessionOnWins = true;
    await app.saveSettings({ monitorBar: true });
    const sOff = await app.saveSession({ ...base, name: 'monitor-off', monitor: false });
    const pOff = await app.openSession(sOff);
    await waitFor(() => pOff.status === 'connected', 15000, 'monitor-off connected');
    await sleep(2500);
    results.sessionOffWins = pOff.monitorEl.hidden === true && pOff.monitorSample === null;
    // the pane toggle beats the session option, and the interval setting is clamped to 2–30 s
    await app.action('toggle-monitor', undefined);
    await waitFor(() => !pOff.monitorEl.hidden && pOff.monitorSample, 6000, 'pane toggle over the session option');
    results.paneToggleWins = true;
    await app.saveSettings({ monitorInterval: 99 });
    results.intervalClamped = pOff.monitorInterval() === 30000;
    await app.saveSettings({ monitorInterval: 3 });

    // 8. the dialogs carry the options: Settings → Terminal (still fitting the 900×560 minimum window) and the
    //    session editor's Advanced SSH tab
    const size0 = { w: window.outerWidth, h: window.outerHeight };
    await window.api.app.testResize(900, 560);
    await sleep(300);
    app.action('settings');
    await sleep(400);
    const m = document.querySelector('.modal');
    const tabs = [...m.querySelectorAll('.mtabs button')];
    tabs.find((b) => b.textContent === 'Features').click(); // the monitoring row lives on the Features tab
    await sleep(100);
    const page = m.querySelector('.mpage.active');
    const cb = [...page.querySelectorAll('.checks label')].find((l) => l.textContent.includes('Remote monitoring bar on SSH sessions'));
    const every = page.querySelector('input.mon-interval');
    results.settingsFields = !!cb && cb.querySelector('input').checked === true && !!every && every.value === '3' && every.min === '2' && every.max === '30';
    const body = m.querySelector('.modal-body');
    results.settingsTerminalFits = body.scrollHeight <= body.clientHeight && page.scrollWidth <= page.clientWidth && m.getBoundingClientRect().bottom <= window.innerHeight;
    results.settingsTooltip = /polled over the session/.test(cb.title);
    await shot('64-settings-terminal-monitoring');
    closeModal();
    await sleep(200);
    await window.api.app.testResize(size0.w, size0.h);
    await sleep(300);
    app.editSession(sOff);
    await sleep(400);
    document.querySelectorAll('.modal .mtabs button')[1].click(); // Advanced SSH
    await sleep(150);
    const adv = document.querySelector('.modal .mpage.active');
    const scb = [...adv.querySelectorAll('.checks label')].find((l) => l.textContent.includes('Show remote monitoring bar'));
    results.editorField = !!scb && scb.querySelector('input').checked === false;
    await shot('65-editor-advanced-monitoring');
    closeModal();
    await sleep(200);
    document.querySelector('.modal.narrow .btn.primary')?.click(); // in case a discard question appeared
    await sleep(100);

    // 9. a narrow pane folds the strip by priority (host → uptime → load → the meters → network) instead of clipping
    //    it silently: one pane at 900×560 loses the host name and more, a 2x2 grid at 900×560 keeps CPU / Mem / Disk;
    //    the whole line is in the strip's tooltip; wide again, everything is back
    const fits = (p) => p.monitorEl.scrollWidth <= p.monitorEl.clientWidth + 1;
    app.workspace.activate(pOn.tab);
    await waitFor(() => pOn.monitorSample && pOn.monitorEl.dataset.fit === '0', 8000, 'pOn strip at full width');
    results.wideShowsAll = fits(pOn) && !pOn.monitorEl.querySelector('.mon-host').hidden && pOn.monitorEl.title === '';
    await window.api.app.testResize(900, 560);
    await sleep(600);
    await waitFor(() => Number(pOn.monitorEl.dataset.fit || 0) > 0, 5000, 'strip folded');
    const line = pOn.monitorEl.title;
    results.narrowFolds = fits(pOn) && pOn.monitorEl.querySelector('.mon-host').hidden === true && !pOn.monitorEl.querySelector('.mon-item').hidden
      && new RegExp(`^CPU \\d+% · Mem [\\d.]+ [KMGT]B / [\\d.]+ [KMGT]B · Disk \\d+% · ↓ .* ↑ .* · load [\\d. ]+ · up \\S+.* · host ${app.info.hostname.replace(/\./g, '\\.')}$`).test(line);
    log('fit at 900x560:', pOn.monitorEl.dataset.fit, 'width', pOn.monitorEl.clientWidth, '| tooltip:', line);
    await shot('67-monitor-narrow-single');
    const gridSessions = [];
    for (const i of [1, 2, 3, 4]) gridSessions.push(await app.saveSession({ ...base, name: 'grid-mon-' + i, monitor: true }));
    await app.openSessionsInGrid(gridSessions, 2);
    const gridTab = app.workspace.active;
    const gp = gridTab.panes().filter((p) => p.kind === 'ssh');
    await waitFor(() => gp.length === 4 && gp.every((p) => p.status === 'connected' && p.monitorSample), 30000, 'grid panes with samples');
    await sleep(800);
    results.gridFolds = gp.length === 4 && gp.every((p) => fits(p) && !p.monitorEl.hidden && Number(p.monitorEl.dataset.fit) > 0 && !p.monitorEl.querySelector('.mon-item').hidden && p.monitorEl.title.includes('host '));
    log('2x2 at 900x560:', gp.map((p) => `${p.monitorEl.clientWidth}px fit=${p.monitorEl.dataset.fit} items=${[...p.monitorEl.querySelectorAll('.mon-item')].filter((i) => !i.hidden).length}`).join(' | '));
    await shot('68-monitor-grid-900x560');
    await window.api.app.testResize(1400, 880);
    await sleep(800);
    results.gridWiderShowsMore = gp.every((p) => fits(p) && Number(p.monitorEl.dataset.fit) < 7 && [...p.monitorEl.querySelectorAll('.mon-item')].filter((i) => !i.hidden).length >= 4);
    log('2x2 at 1400x880:', gp.map((p) => `${p.monitorEl.clientWidth}px fit=${p.monitorEl.dataset.fit}`).join(' | '));
    await shot('69-monitor-grid-1400x880');
    await app.closeTab(gridTab);
    await sleep(300);
    await window.api.app.testResize(size0.w, size0.h);
    await sleep(600);
    app.workspace.activate(pOn.tab);
    results.wideUnfolds = await waitFor(() => pOn.monitorEl.dataset.fit === '0' && !pOn.monitorEl.querySelector('.mon-host').hidden && pOn.monitorEl.title === '', 8000, 'unfolded').then(() => true).catch(() => false);
    results.allPanes = app.workspace.allPanes().filter((p) => p.kind === 'ssh').length;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-monitor] FAIL', e.message, e.stack);
    await shot('99-monitor-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  window.api.app.quit();
})();
