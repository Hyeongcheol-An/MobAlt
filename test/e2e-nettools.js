// Tools panel: Wake-on-LAN and the network scanner (needs the local sshd on 127.0.0.1:2222 — test/start-sshd.sh start).
//   test/qa/run.sh test/e2e-nettools.js <out-dir> 120000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-nettools]', ...a);
  const app = window.app;
  const tp = app.toolsPanel;
  const results = {};
  const toasts = () => document.getElementById('toast-root').textContent;
  const q = (sel) => document.querySelector(sel);
  const set = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); return el; };
  const until = async (fn, ms, what) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn()) return true;
      if (Date.now() - t0 > ms) throw new Error('timeout: ' + what);
      await sleep(50);
    }
  };
  const scanDone = () => !!tp.scan && !tp.scan.running;
  const rowsOf = () => [...document.querySelectorAll('#scan-results tbody tr')].map((tr) => [...tr.children].slice(0, 4).map((td) => td.textContent));
  const startBtn = () => q('[data-scan="start"]'), stopBtn = () => q('[data-scan="stop"]'), copyBtn = () => q('[data-scan="copy"]');
  try {
    await app.saveSettings({ confirmClose: false });
    app.showPanel('tools');
    await sleep(200);
    results.groupsOpen = !!q('#tools-wol[open]') && !!q('#tools-scan[open]') && q('#scan-results').hidden && !q('#tool-output').hidden;

    // ---------- Wake-on-LAN ----------
    // the test hook listens on 127.0.0.1:<port>; a bad MAC is refused with a toast and nothing is sent
    const { port: wolPort } = await window.api.app.testWolListen(0);
    set('#wol-mac', 'zz:zz:zz:zz:zz:zz');
    set('#wol-broadcast', '127.0.0.1');
    set('#wol-port', String(wolPort));
    q('[data-wol="wake"]').click();
    await until(() => /Invalid MAC address: zz:zz:zz:zz:zz:zz/.test(toasts()), 2000, 'bad MAC toast');
    results.wolBadMacToast = true;
    await sleep(350);
    results.wolBadMacNothingSent = (await window.api.app.testWolPackets()).length === 0 && !app.settings.wolHistory;
    // a good one, in the dash spelling: 3 × 102-byte magic packets reach the listener; the history gets the MAC with its label
    set('#wol-mac', 'AA-BB-CC-DD-EE-FF');
    set('#wol-label', 'nas');
    q('[data-wol="wake"]').click();
    await until(() => /Magic packet sent to nas \(aa:bb:cc:dd:ee:ff\) via 127\.0\.0\.1:\d+/.test(toasts()), 3000, 'wake toast');
    await sleep(150);
    const pk = await window.api.app.testWolPackets();
    const magic = 'ff'.repeat(6) + 'aabbccddeeff'.repeat(16);
    results.wolThreeMagicPackets = pk.length === 3 && pk.every((p) => p.length === 102 && p.hex === magic && p.from === '127.0.0.1');
    log('wol packets:', pk.length, pk.map((p) => p.length).join(','));
    const hist = app.settings.wolHistory || [];
    results.wolHistorySaved = hist.length === 1 && hist[0].mac === 'aa:bb:cc:dd:ee:ff' && hist[0].label === 'nas' && typeof hist[0].at === 'number';
    const opts = [...document.querySelectorAll('#wol-history option')];
    results.wolHistoryOption = opts.length === 1 && opts[0].value === 'aa:bb:cc:dd:ee:ff' && opts[0].label === 'nas' && q('#wol-mac').getAttribute('list') === 'wol-history';
    results.wolMacNormalised = q('#wol-mac').value === 'aa:bb:cc:dd:ee:ff';
    await shot('70-wol-history');
    // Enter in the MAC box wakes too (Cisco spelling); the same MAC stays one history row and keeps its label when the box is empty
    set('#wol-mac', 'aabb.ccdd.eeff');
    set('#wol-label', '');
    q('#wol-mac').focus();
    await window.api.app.testKey('Enter');
    await until(async () => (await window.api.app.testWolPackets()).length === 6, 3000, 'Enter wakes');
    await sleep(150);
    results.wolEnterWakes = (app.settings.wolHistory || []).length === 1 && app.settings.wolHistory[0].label === 'nas' && document.activeElement === q('#wol-mac');
    // eleven more MACs: the history keeps the last 10, newest first, and a typed MAC recalls its label
    for (let i = 0; i < 11; i++) {
      const mac = `02:00:00:00:00:${i.toString(16).padStart(2, '0')}`;
      set('#wol-mac', mac);
      set('#wol-label', i === 5 ? 'srv5' : '');
      q('[data-wol="wake"]').click();
      await until(() => (app.settings.wolHistory || [])[0]?.mac === mac, 3000, 'history ' + i);
    }
    const h10 = app.settings.wolHistory;
    results.wolHistoryCap10 = h10.length === 10 && h10[0].mac === '02:00:00:00:00:0a' && h10[9].mac === '02:00:00:00:00:01' && !h10.some((x) => x.mac === 'aa:bb:cc:dd:ee:ff') && document.querySelectorAll('#wol-history option').length === 10;
    set('#wol-label', '');
    set('#wol-mac', '02:00:00:00:00:05');
    results.wolLabelRecalled = q('#wol-label').value === 'srv5';
    results.wolPacketsTotal = (await window.api.app.testWolPackets()).length === 6 + 33;
    // a bad port is refused by the main process
    set('#wol-port', '70000');
    q('[data-wol="wake"]').click();
    await until(() => /The port must be between 1 and 65535/.test(toasts()), 2000, 'bad port toast');
    results.wolBadPortToast = true;
    set('#wol-port', String(wolPort));

    // ---------- network scanner ----------
    // a single host as /32: 127.0.0.1 answers, with the test sshd's port 2222 open and a round-trip time from ping
    set('#scan-target', '127.0.0.1/32');
    set('#scan-ports', '22,2222,80');
    let prev = tp.scan && tp.scan.id;
    startBtn().click();
    await until(() => tp.scan && tp.scan.id !== prev, 2000, 'scan started');
    await until(scanDone, 15000, '/32 scan'); // loopback answers within milliseconds: the running state is checked on the /24 below
    let rows = rowsOf();
    log('/32 rows:', JSON.stringify(rows));
    results.scanSingleFinds2222 = rows.length === 1 && rows[0][0] === '127.0.0.1' && /\b2222\b/.test(rows[0][3]) && /^[\d.]+ ms$/.test(rows[0][2]);
    results.scanProgress = q('#scan-count').textContent === '1/1' && q('#scan-bar').value === 1 && q('#scan-bar').max === 1;
    results.scanFinishedToast = /Scan finished: 1 host up of 1 in [\d.]+ s/.test(toasts());
    results.scanIdleState = !startBtn().disabled && stopBtn().disabled && !copyBtn().disabled && q('#scan-empty').hidden;
    await shot('71-scan-single');
    // a range: three targets, 127.0.0.1 is the one that answers (2222 open); the reverse lookup fills the host column
    set('#scan-target', '127.0.0.1-127.0.0.3');
    prev = tp.scan.id;
    startBtn().click();
    await until(() => tp.scan && tp.scan.id !== prev && tp.scan.total === 3, 2000, 'range scan started');
    await until(scanDone, 20000, 'range scan');
    rows = rowsOf();
    log('range rows:', JSON.stringify(rows));
    results.scanRangeFinds2222 = rows.length === 1 && rows[0][0] === '127.0.0.1' && /\b2222\b/.test(rows[0][3]) && q('#scan-count').textContent === '3/3';
    results.scanRangeHostCell = rows[0]?.[1] === '—' || (typeof rows[0]?.[1] === 'string' && rows[0][1].length > 0); // the reverse lookup's name, or the dash when loopback has no PTR
    // Copy as text: the table in aligned columns
    copyBtn().click();
    await until(() => /Copied 1 host as text/.test(toasts()), 2000, 'copy toast');
    const clip = await window.api.clipboard.read();
    log('clipboard:', JSON.stringify(clip));
    results.scanCopyText = /^IP {2,}Hostname {2,}RTT {2,}Open ports\n127\.0\.0\.1 {2,}\S+ {2,}[\d.]+ ms {2,}[\d,]*2222[\d,]*\n$/.test(clip);
    // sortable: a header click sorts by that column, the same again flips it (aria-sort tells)
    const th = (k) => q(`#scan-results th button[data-sort="${k}"]`).closest('th');
    q('#scan-results th button[data-sort="hostname"]').click();
    const s1 = [th('ip').getAttribute('aria-sort'), th('hostname').getAttribute('aria-sort')];
    q('#scan-results th button[data-sort="hostname"]').click();
    const s2 = th('hostname').getAttribute('aria-sort');
    q('#scan-results th button[data-sort="ip"]').click();
    results.scanSortToggles = s1.join() === 'none,ascending' && s2 === 'descending' && th('ip').getAttribute('aria-sort') === 'ascending' && rowsOf().length === 1;
    // "Add as session": the session editor, SSH to that host on port 22 filled in
    q('#scan-results .scan-add').click();
    await sleep(400);
    const m = q('.modal');
    const hostEl = m && m.querySelector('input[placeholder^="hostname"]');
    const portEl = m && [...m.querySelectorAll('label')].find((l) => l.textContent === 'Port')?.nextElementSibling;
    results.scanAddSession = !!m && /New session/.test(m.querySelector('.modal-title').textContent) && hostEl?.value === '127.0.0.1' && portEl?.value === '22' && !!m.querySelector('.type-picker button.active')?.textContent.includes('SSH');
    await shot('72-scan-add-session');
    m && m.querySelector('.close').click();
    await sleep(250);
    q('.modal.narrow .btn.primary')?.click(); // in case it asked about discarding
    await sleep(200);
    results.scanAddSessionClosed = !q('.modal');
    // Stop cancels a /24 quickly: with 8 workers and 3 s timeouts the run would take ~95 s; after Stop it closes within a second
    set('#scan-target', '127.1.0.0/24');
    set('#scan-timeout', '3000');
    set('#scan-concurrency', '8');
    q('#scan-method').value = 'tcp';
    startBtn().click();
    await until(() => tp.scan && tp.scan.running && tp.scan.total === 254, 2000, '/24 started');
    results.scanRunningState = startBtn().disabled && !stopBtn().disabled && !q('#scan-results').hidden && q('#tool-output').hidden && !q('#scan-progress').hidden;
    await sleep(500);
    const tStop = Date.now();
    stopBtn().click();
    await until(scanDone, 5000, 'stop');
    const stopMs = Date.now() - tStop;
    log('stop took', stopMs, 'ms; scanned', tp.scan.done, '/', tp.scan.total);
    results.scanStopQuick = stopMs < 1500 && tp.scan.cancelled === true && tp.scan.done < 254 && /Scan stopped: 0 hosts up, \d+\/254 scanned/.test(toasts());
    results.scanStopProgress = q('#scan-count').textContent === `${tp.scan.done}/254` && !q('#scan-empty').hidden && !startBtn().disabled && stopBtn().disabled;
    await shot('73-scan-stopped');
    set('#scan-timeout', '600');
    set('#scan-concurrency', '64');
    q('#scan-method').value = 'both';
    // more than a /16 is refused, so is a nonsense target
    set('#scan-target', '10.0.0.0/8');
    startBtn().click();
    await until(() => /Range too large: 16,777,216 addresses; the limit is a \/16 \(65,536\)/.test(toasts()), 2000, 'oversize toast');
    results.scanOversizeCidrRefused = !tp.scan.running;
    set('#scan-target', '10.0.0.0-10.1.0.0');
    startBtn().click();
    await until(() => /Range too large: 65,537 addresses/.test(toasts()), 2000, 'oversize range toast');
    results.scanOversizeRangeRefused = !tp.scan.running;
    set('#scan-target', 'not a target!');
    startBtn().click();
    await until(() => /Not a CIDR, an address range or a host name: not a target!/.test(toasts()), 2000, 'bad target toast');
    results.scanBadTargetRefused = !tp.scan.running && tp.scan.target === '127.1.0.0/24';
    await sleep(3600); // the toasts go

    // ---------- keyboard: Tab walks every new control in order; Enter in the target box starts a scan; Space on Scan too ----------
    const key = (el) => el.id || (el.dataset.wol ? 'wol:' + el.dataset.wol : el.dataset.scan ? 'scan:' + el.dataset.scan : el.tagName.toLowerCase() + '#' + (el.parentElement.id || ''));
    const want = [...document.querySelectorAll('#tools-wol, #tools-scan')].flatMap((g) => [...g.querySelectorAll('summary, input, select, button')]).filter((el) => !el.disabled && el.offsetParent !== null).map(key);
    const fromMac = want.slice(want.indexOf('wol-mac'));
    const walk = async () => {
      q('#wol-mac').focus();
      const seen = [key(document.activeElement)];
      for (let i = 1; i < fromMac.length; i++) {
        await window.api.app.testKey('Tab');
        await sleep(40);
        seen.push(key(document.activeElement));
      }
      return seen;
    };
    let seen = await walk();
    if (seen.join() !== fromMac.join()) seen = await walk(); // focus-dependent: one retry
    log('tab order:', seen.join(' > '));
    results.tabOrder = seen.join() === fromMac.join();
    results.tabCoversNewControls = ['wol-mac', 'wol:wake', 'wol-broadcast', 'wol-port', 'wol-label', 'scan-target', 'scan:start', 'scan-method', 'scan-ports', 'scan-rdns', 'scan-concurrency', 'scan-timeout'].every((k) => seen.includes(k));
    results.stopSkippedWhileIdle = !seen.includes('scan:stop');
    await shot('74-tab-on-last-control');
    // the rDNS checkbox shows the keyboard focus ring like every other control (the text fields' outline reset used to take it)
    await window.api.app.testKey('F19'); // keyboard modality: :focus-visible on the programmatic focus below
    const rdns = q('#scan-rdns');
    rdns.focus();
    await sleep(60);
    const ring = getComputedStyle(rdns);
    results.rdnsFocusRing = document.activeElement === rdns && rdns.matches(':focus-visible') && ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) >= 2 && ring.outlineColor !== 'rgba(0, 0, 0, 0)';
    log('rdns ring:', ring.outlineStyle, ring.outlineWidth, ring.outlineColor);
    await shot('74b-rdns-focus-ring');
    set('#scan-target', '127.0.0.1/32');
    set('#scan-ports', '2222');
    q('#scan-target').focus();
    prev = tp.scan.id;
    await window.api.app.testKey('Enter');
    await until(() => tp.scan && tp.scan.id !== prev && tp.scan.total === 1 && tp.scan.target === '127.0.0.1/32', 2000, 'Enter starts');
    results.enterStartsScan = document.activeElement === q('#scan-target');
    await until(scanDone, 15000, 'enter scan');
    results.enterScanFound = rowsOf().length === 1 && /\b2222\b/.test(rowsOf()[0][3]);
    await shot('75-scan-keyboard');
    // Space on the focused Scan button starts too; while the run lasts (two silent loopback addresses, 600 ms connects)
    // the keyboard sits on Stop, Scan being inert, and is back on Scan when it ends
    set('#scan-target', '127.1.0.1-127.1.0.2');
    q('#scan-method').value = 'tcp';
    startBtn().focus();
    prev = tp.scan.id;
    await window.api.app.testKey('Space');
    await until(() => tp.scan && tp.scan.id !== prev, 2000, 'Space starts');
    results.spaceStartsScan = tp.scan.total === 2 && tp.scan.running === true;
    results.focusToStopWhileRunning = document.activeElement === stopBtn();
    await until(scanDone, 15000, 'space scan');
    results.focusBackToScan = document.activeElement === startBtn();
    set('#scan-target', '127.0.0.1/32');
    q('#scan-method').value = 'both';
    // the classic tools still own the output area when they run; the next scan brings the table back
    set('#tool-host', '127.0.0.1');
    q('[data-tool="netinfo"]').click();
    await until(() => /Hostname:/.test(q('#tool-output').textContent), 3000, 'netinfo');
    results.classicToolShowsText = !q('#tool-output').hidden && q('#scan-results').hidden;
    prev = tp.scan.id;
    startBtn().click();
    await until(() => tp.scan && tp.scan.id !== prev, 2000, 'scan after netinfo started');
    await until(scanDone, 15000, 'scan after netinfo');
    results.scanShowsTableAgain = q('#tool-output').hidden && !q('#scan-results').hidden && rowsOf().length === 1;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-nettools] FAIL', e.message, e.stack);
    await shot('99-nettools-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log(failed.length ? 'FAILED ' + failed.join(', ') : 'ALL PASSED');
  log('DONE');
  window.api.app.quit();
})();
