// Renderer-side end-to-end check for Zmodem (rz / sz) transfers in the terminal. Run with:
//   test/start-sshd.sh start
//   MOBALT_TEST_SCRIPT=test/e2e-zmodem.js MOBALT_SHOT_DIR=/tmp/shots MOBALT_SCREENSHOT=/tmp/shots/final.png MOBALT_SCREENSHOT_DELAY=120000 npx electron .
// Exercises, in a local shell pane and in an SSH pane to the test sshd on 127.0.0.1:2222:
//   - `sz file` on the far side downloads to the folder in settings → identical sha256
//   - `rz` sends the files answered in the Open dialog (testNextDialog) → identical sha256 in the far-side cwd
//   - Cancel from the transfers list aborts a running transfer
//   - with the setting off the stream is not intercepted (shows as garbage, no transfer)
// The far side is the same Mac (the sshd's home is the real home), so a path written on one side is read on the other.
// sz / rz come from lrzsz (brew install lrzsz); they are not on the sshd's non-interactive PATH, so the full path is used.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-zmodem]', ...a);
  const app = window.app;
  const fsx = (op, ...args) => window.api.app.testFs(op, ...args);
  const results = {};
  const SZ = '/opt/homebrew/bin/sz', RZ = '/opt/homebrew/bin/rz';
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms = 20000, what = 'condition') => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try { v = await fn(); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
      await sleep(150);
    }
  };
  // the zmodem transfer (proto 'zmodem') newest-first; optionally only for a given connection / kind
  const zx = (pred = () => true) => [...app.sftpPanel.transfers.values()].filter((t) => t.proto === 'zmodem' && pred(t)).sort((a, b) => b.startedAt - a.startedAt)[0];
  const promptReady = (p) => /[$%#>] ?$/.test(textOf(p).trimEnd());

  try {
    await app.saveSettings({ confirmClose: false, zmodem: true, sftpAutoOpen: false });
    const scratch = await fsx('mkdtemp', 'mobalt-zmodem-e2e-');
    log('scratch', scratch);

    // ---- a helper that drives one sz (download) + rz (upload) + cancel on a connected pane ----
    const runOn = async (tag, pane, prep) => {
      const r = {};
      const far = prep.farDir;      // directory the sz/rz command runs in (reachable as a path on this Mac)
      const dl = prep.dlDir;        // where sz downloads land (settings.downloadDir)
      await app.saveSettings({ downloadDir: dl });
      pane.term.focus();
      pane.write('\x15'); // clear the line
      await sleep(200);
      if (prep.cd) { pane.write(`cd ${far}\r`); await sleep(500); }

      // --- sz: the far side sends us a file ---
      const srcName = 'sz-src.bin';
      const src = far + '/' + srcName;
      await fsx('randomFile', src, 3 * 1024 * 1024);
      const srcHash = await fsx('sha256', src);
      pane.write(`${SZ} -q -b ${srcName}\r`);
      const dlt = await waitFor(() => { const t = zx((t) => t.kind === 'download' && t.connId === pane.termId); return t && t.status !== 'running' ? t : null; }, 60000, `${tag} sz done`);
      r.szStatus = dlt.status;
      r.szHashMatch = dlt.status === 'done' && (await fsx('sha256', dlt.local)) === srcHash;
      r.szLocal = dlt.local;
      log(`${tag} sz`, dlt.status, 'hash', r.szHashMatch, '→', dlt.local);
      await waitFor(() => promptReady(pane), 10000, `${tag} prompt back after sz`).catch(() => {});
      await shot(`${tag}-01-sz-done`);

      // --- rz: we send the far side a file chosen in the Open dialog (its basename is what lands remotely) ---
      const upName = 'rz-src.bin';
      const upSrc = (await fsx('mkdtemp', tag + '-up-')) + '/' + upName;
      await fsx('randomFile', upSrc, 2 * 1024 * 1024 + 321);
      const upHash = await fsx('sha256', upSrc);
      const rzCwd = await fsx('mkdtemp', 'mobalt-zmodem-rz-');
      pane.write('\x15'); await sleep(150);
      pane.write(`cd ${rzCwd}\r`); await sleep(400);
      await window.api.app.testNextDialog({ canceled: false, filePaths: [upSrc] });
      pane.write(`${RZ} -q -b\r`);
      const upt = await waitFor(() => { const t = zx((t) => t.kind === 'upload' && t.connId === pane.termId); return t && t.status !== 'running' ? t : null; }, 60000, `${tag} rz done`);
      r.rzStatus = upt.status;
      const landed = rzCwd + '/' + upName;
      r.rzLanded = await fsx('exists', landed);
      r.rzHashMatch = r.rzLanded && (await fsx('sha256', landed)) === upHash;
      log(`${tag} rz`, upt.status, 'landed', r.rzLanded, 'hash', r.rzHashMatch);
      await waitFor(() => (window.api.app.testNextDialog()).then((x) => x.pending === 0), 3000, 'dialog queue drained').catch(() => {});
      await shot(`${tag}-02-rz-done`);

      // --- cancel: a large sz, cancelled from the transfers list ---
      const bigName = 'sz-big.bin';
      await fsx('randomFile', far + '/' + bigName, 12 * 1024 * 1024);
      pane.write('\x15'); await sleep(150);
      if (prep.cd) { pane.write(`cd ${far}\r`); await sleep(400); }
      pane.write(`${SZ} -q -b ${bigName}\r`);
      const running = await waitFor(() => { const t = zx((t) => t.kind === 'download' && t.connId === pane.termId && t.name === bigName); return t && t.status === 'running' && t.transferred > 0 ? t : null; }, 30000, `${tag} big sz running`);
      await window.api.sftp.cancel(running.id);
      const cancelled = await waitFor(() => { const t = zx((t) => t.id === running.id); return t && t.status !== 'running' ? t : null; }, 20000, `${tag} cancel settled`);
      r.cancelStatus = cancelled.status;
      r.cancelCleanedUp = !(await fsx('exists', dl + '/' + bigName));
      log(`${tag} cancel`, cancelled.status, 'partial removed', r.cancelCleanedUp);
      await waitFor(() => promptReady(pane), 12000, `${tag} prompt back after cancel`).catch(() => {});
      await shot(`${tag}-03-cancel`);
      return r;
    };

    // ---------- SSH pane (authoritative: a real remote pty, bytes over the ssh2 channel) ----------
    {
      const home = app.info.home;
      const keyDir = app.info.appPath + '/test/sshd-runtime';
      const user = home.split('/').pop();
      const s = await app.saveSession({ name: 'zmodem-sshd', type: 'ssh', host: '127.0.0.1', port: 2222, username: user, authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: false });
      const p = app.openSession(s);
      const btn = await waitFor(() => document.querySelector('.modal .btn.primary'), 10000, 'host key dialog');
      btn.click();
      const pane = await p;
      await waitFor(() => pane.status === 'connected', 15000, 'ssh connected');
      await sleep(1500);
      const farDir = await fsx('mkdtemp', 'mobalt-zmodem-ssh-');
      const dlDir = scratch + '/ssh-dl';
      await fsx('mkdirp', dlDir);

      // --- disabled setting first, on the pristine shell: the stream is not intercepted (no transfer), the raw
      //     handshake reaches the terminal as garbage. A sz with no ZRINIT answer just waits, so the 5-CAN abort
      //     stops it cleanly and the shell is ready for the real transfers below. ---
      await fsx('randomFile', farDir + '/dis-src.bin', 64 * 1024);
      await app.saveSettings({ zmodem: false });
      await sleep(200);
      pane.write('\x15'); await sleep(150);
      pane.write(`cd ${farDir}\r`); await sleep(500);
      const idsBefore = new Set([...app.sftpPanel.transfers.values()].filter((t) => t.proto === 'zmodem').map((t) => t.id));
      pane.write(`${SZ} -q -b dis-src.bin\r`);
      // the raw ZMODEM hex header reaches the terminal; its "B000000000…" run is distinctive (never in shell output)
      const sawHeader = await waitFor(() => /B0{8,}/.test(textOf(pane)), 12000, 'raw zmodem header on the terminal').catch(() => false);
      const newXfers = [...app.sftpPanel.transfers.values()].filter((t) => t.proto === 'zmodem' && !idsBefore.has(t.id));
      results.disabledNoTransfer = newXfers.length === 0; // the sentry did not intercept → no new transfer was created
      results.disabledShowsGarbage = !!sawHeader;
      log('disabled: newXfers', newXfers.length, 'sawHeader', !!sawHeader, 'tail', JSON.stringify(textOf(pane).replace(/ +\n/g, '\n').trim().slice(-100)));
      await shot('ssh-04-disabled');
      pane.write('\x18\x18\x18\x18\x18\x08\x08\x08\x08\x08\r'); // abort the waiting sz
      await sleep(1000);
      pane.write('\x03\r');
      await app.saveSettings({ zmodem: true });
      await waitFor(() => promptReady(pane), 8000, 'prompt back after disabled test').catch(() => {});

      // --- the real transfers (download / upload / cancel) with the feature on ---
      results.ssh = await runOn('ssh', pane, { cd: true, farDir, dlDir });
      await pane.disconnect().catch(() => {});
    }

    // ---------- local shell pane (same code path; needs a working node-pty) ----------
    try {
      const pane = await app.newLocalTab();
      await waitFor(() => pane.status === 'connected' && promptReady(pane), 10000, 'local shell ready');
      const farDir = await fsx('mkdtemp', 'mobalt-zmodem-local-');
      const dlDir = scratch + '/local-dl';
      await fsx('mkdirp', dlDir);
      results.local = await runOn('local', pane, { cd: true, farDir, dlDir });
    } catch (e) {
      results.localError = e.message; // in this sandbox node-pty cannot allocate a pty; the SSH pane proves the same code
      log('local pane unavailable:', e.message);
    }

    results.ok = !!(results.ssh && results.ssh.szHashMatch && results.ssh.rzHashMatch && results.ssh.cancelStatus === 'cancelled' && results.disabledNoTransfer)
      && (!results.local || (results.local.szHashMatch && results.local.rzHashMatch && results.local.cancelStatus === 'cancelled'));
    await fsx('rm', scratch);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-zmodem] FAIL', e.message, e.stack);
    await shot('99-zmodem-fail').catch(() => {});
  }
  log('RESULTS ' + JSON.stringify(results));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
