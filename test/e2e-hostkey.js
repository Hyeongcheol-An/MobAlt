// Host-key dialog through the keyboard (the 1.0 security review): a CHANGED key must not be accepted by a single
// Enter. Needs the test sshd (test/start-sshd.sh start). Run:
//   bash test/qa/run.sh test/e2e-hostkey.js <out-dir> 90000
// The run's known_hosts (<out-dir>/userdata/known_hosts) is seeded with
//   1. another ed25519 key for [127.0.0.1]:2222 → "Host key changed!", Cancel has the focus, Enter refuses, the file
//      is unchanged; then Accept new key (a click) connects and replaces the entry;
//   2. only an RSA key for the host → also "changed" (a known host offering a key of another type);
//   3. the server's real key under @revoked → the warning with the reason and no Accept; Enter refuses;
//   4. nothing → "Unknown host key" with Accept as the default (trust on first use, unchanged).
// ~/.ssh/known_hosts is read (it never names 127.0.0.1:2222 on a QA Mac) and never written.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('timeout waiting for ' + what);
  };
  const log = (...a) => console.log('[e2e-hostkey]', ...a);
  const shot = (n) => window.api.app.screenshot(n);
  const app = window.app;
  const R = {};
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const blob = (type) => {
    const enc = (s) => { const b = new TextEncoder().encode(s); return [0, 0, 0, b.length, ...b]; };
    const body = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...enc(type), 0, 0, 0, 32, ...body));
  };
  const modal = () => document.querySelector('.modal');
  const buttons = (m) => [...m.querySelectorAll('.modal-foot button')].map((b) => b.textContent);
  try {
    const info = await window.api.app.info();
    const kh = info.userData + '/known_hosts';
    const user = info.home.split('/').pop();
    const keyDir = info.appPath + '/test/sshd-runtime';
    const realKey = (await fsx('readText', keyDir + '/host_ed25519.pub')).trim().split(/\s+/)[1];
    await app.saveSettings({ confirmClose: false, sftpAutoOpen: false });
    const s = await app.saveSession({ name: 'hostkey', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });

    const attempt = async (seed, name) => {
      await fsx('writeText', kh, seed);
      const p = app.openSession(s);
      const m = await waitFor(modal, 15000, name + ' dialog');
      await sleep(300); // focusFirst runs on the next tick
      const out = {
        title: m.querySelector('.modal-title-text').textContent,
        body: m.querySelector('.modal-body').textContent,
        buttons: buttons(m),
        focused: document.activeElement && m.contains(document.activeElement) ? document.activeElement.textContent : null,
      };
      await shot(name);
      return { p, m, out };
    };
    const settle = async (p) => {
      const pane = await p;
      await waitFor(() => pane.status !== 'connecting' && pane.status !== 'idle', 15000, 'pane settles');
      const buf = pane.term.buffer.active;
      log('pane', pane.status, JSON.stringify([...Array(buf.length)].map((_, i) => buf.getLine(i)?.translateToString(true)).join('|').replace(/\|+$/, '').slice(-300)));
      return pane;
    };

    // 1. changed key, Enter
    const wrong = `[127.0.0.1]:2222 ssh-ed25519 ${blob('ssh-ed25519')}\n`;
    let a = await attempt(wrong, '01-changed');
    R.changedTitle = /Host key changed/.test(a.out.title);
    R.changedFocusCancel = a.out.focused === 'Cancel';
    await window.api.app.testKey({ keyCode: 'Enter', char: '\r' });
    await sleep(500);
    R.changedEnterClosed = !modal();
    let pane = await settle(a.p);
    R.changedEnterRefused = pane.status !== 'connected';
    R.changedFileUnchanged = (await fsx('readText', kh)) === wrong;
    await app.closeTab(pane.tab);
    await sleep(300);

    // 1b. changed key, Accept new key clicked
    a = await attempt(wrong, '02-changed-accept');
    const accept = [...a.m.querySelectorAll('.modal-foot button')].find((b) => b.textContent === 'Accept new key');
    R.acceptNotPrimary = !!accept && !accept.classList.contains('primary');
    accept.click();
    pane = await settle(a.p);
    R.acceptClickConnects = pane.status === 'connected';
    const after = await fsx('readText', kh);
    R.acceptReplacedEntry = after.includes(realKey) && !after.includes(wrong.trim());
    await app.closeTab(pane.tab);
    await sleep(300);

    // 2. known with another type only
    a = await attempt(`[127.0.0.1]:2222 ssh-rsa ${blob('ssh-rsa')}\n`, '03-other-type');
    R.otherTypeIsChanged = /Host key changed/.test(a.out.title) && a.out.focused === 'Cancel';
    await window.api.app.testKey({ keyCode: 'Escape' });
    pane = await settle(a.p);
    R.otherTypeRefused = pane.status !== 'connected';
    await app.closeTab(pane.tab);
    await sleep(300);

    // 3. revoked
    const revoked = `@revoked [127.0.0.1]:2222 ssh-ed25519 ${realKey}\n[127.0.0.1]:2222 ssh-ed25519 ${realKey}\n`;
    a = await attempt(revoked, '04-revoked');
    R.revokedWording = /revoked/.test(a.out.body) && /Host key changed/.test(a.out.title);
    R.revokedOnlyCancel = a.out.buttons.length === 1 && a.out.buttons[0] === 'Cancel';
    await window.api.app.testKey({ keyCode: 'Enter', char: '\r' });
    pane = await settle(a.p);
    R.revokedRefused = pane.status !== 'connected';
    R.revokedFileUnchanged = (await fsx('readText', kh)) === revoked;
    await app.closeTab(pane.tab);
    await sleep(300);

    // 4. unknown host: Accept stays the default
    a = await attempt('', '05-unknown');
    R.unknownTitle = /Unknown host key/.test(a.out.title);
    R.unknownFocusAccept = a.out.focused === 'Accept';
    await window.api.app.testKey({ keyCode: 'Enter', char: '\r' });
    pane = await settle(a.p);
    R.unknownEnterAccepts = pane.status === 'connected';
    await app.closeTab(pane.tab);
  } catch (e) {
    console.error('[e2e-hostkey] FAIL', e.message);
    R.error = e.message;
  }
  const failed = Object.entries(R).filter(([k, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(R));
  log(failed.length ? 'FAILED: ' + failed.join(', ') : 'ALL PASS');
  await sleep(300);
  window.api.app.quit();
})();
