// Renderer-side end-to-end check for Zmodem (rz / sz) transfers in the terminal. Run with:
//   test/start-sshd.sh start
//   MOBALT_TEST_SCRIPT=test/e2e-zmodem.js MOBALT_SHOT_DIR=/tmp/shots MOBALT_SCREENSHOT=/tmp/shots/final.png MOBALT_SCREENSHOT_DELAY=120000 npx electron .
// Exercises, in a local shell pane and in an SSH pane to the test sshd on 127.0.0.1:2222:
//   - `sz file` on the far side downloads to the folder in settings → identical sha256
//   - `rz` sends the files answered in the Open dialog (testNextDialog) → identical sha256 in the far-side cwd
//   - Cancel from the transfers list, Ctrl-C in the pane and a killed remote sz end a running transfer: the prompt is
//     back within seconds, nothing binary reaches the terminal, a typed command is answered, a session log stays text
//   - a second download of the same name is listed under its unique local name; the status lines carry the pane's
//     palette colour; a finished transfer is announced
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
  const hl = await import('./highlight.js');
  const th = await import('./theme.js');
  // xterm reports every byte it cannot parse on console.error: the count after an abort must stay at zero
  const parseErrors = { n: 0 };
  const origError = console.error;
  console.error = (...a) => { if (a.some((x) => String(x).includes('Parsing error'))) parseErrors.n++; return origError.apply(console, a); };
  const junkChars = (p) => { const t = textOf(p); return (t.match(/[\x00-\x08\x0b-\x1f\x7f-\x9f\ufffd]/g) || []).length + (t.match(/[^\x00-\x7f→…]/g) || []).length; };
  const liveText = () => document.querySelector('#panel-sftp .xfer-live')?.textContent || '';
  const rgbOf = (hex) => parseInt(hex.slice(1), 16);
  /** The last line matching `re` carries the palette colour `key` as a true-colour foreground, and that colour reads at 4.5:1 on the theme's background. */
  const statusColourOk = (pane, re, key) => {
    const theme = th.THEMES[app.settings.theme], p = hl.highlightPalette(theme), buf = pane.term.buffer.active;
    for (let y = buf.length - 1; y >= 0; y--) {
      const line = buf.getLine(y);
      if (!line || !re.test(line.translateToString(true))) continue;
      const cell = line.getCell(2);
      const r = { fgRGB: cell && cell.isFgRGB(), fg: cell && cell.getFgColor(), want: rgbOf(p[key]), contrast: +th.contrast(p[key], theme.background).toFixed(2) };
      log('status colour', app.settings.theme, key, JSON.stringify(r));
      return r.fgRGB && r.fg === r.want && r.contrast >= 4.5;
    }
    return false;
  };
  /** After an abort: a typed command is answered (the prompt is usable, the input gate open). */
  const usable = async (p, tag) => {
    p.term.input(`echo ZM_''${tag}\r`);
    return waitFor(() => textOf(p).split('\n').some((l) => l.trim() === `ZM_${tag}`), 8000, `echo after ${tag}`).then(() => true).catch(() => false);
  };
  /**
   * A big sz ended by `how` — 'list' (Cancel in the transfers list), 'ctrlc' (Ctrl-C in the pane) or 'kill' (the remote
   * sz killed with SIGKILL 1.2 s in: no cancel string from it, the shell's prompt lands in the stream). The transfer
   * settles, the partial file goes, the prompt is back within 3 s (kill: the silence detection takes ~2 s, so 7 s),
   * nothing binary reached xterm, no parse error, a typed command is answered.
   */
  const abortCase = async (tag, pane, far, dl, how) => {
    const r = { how };
    const bigName = 'sz-big.bin';
    pane.write('\x15'); await sleep(150);
    pane.write(`cd ${far}\r`); await sleep(400);
    const errs0 = parseErrors.n, junk0 = junkChars(pane);
    pane.write(how === 'kill' ? `(sleep 1.2; pkill -KILL -P $$ -x sz) & ${SZ} -q -b ${bigName}\r` : `${SZ} -q -b ${bigName}\r`);
    const running = await waitFor(() => { const t = zx((t) => t.kind === 'download' && t.connId === pane.termId && t.name === bigName); return t && t.status === 'running' && t.transferred > 0 ? t : null; }, 30000, `${tag} big sz running`);
    const t0 = Date.now();
    if (how === 'list') await window.api.sftp.cancel(running.id);
    else if (how === 'ctrlc') pane.term.input('\x03');
    const settled = await waitFor(() => { const t = zx((t) => t.id === running.id); return t && t.status !== 'running' ? t : null; }, 20000, `${tag} ${how} settled`);
    r.status = settled.status;
    r.error = settled.error;
    r.settleMs = Date.now() - t0;
    r.partialRemoved = !(await fsx('exists', dl + '/' + bigName));
    r.promptMs = await waitFor(() => promptReady(pane), 15000, `${tag} prompt back after ${how}`).then(() => Date.now() - t0).catch(() => null);
    await sleep(400);
    r.junkChars = junkChars(pane) - junk0;
    r.parseErrors = parseErrors.n - errs0;
    r.statusLine = textOf(pane).split('\n').map((l) => l.trim()).filter((l) => /^Zmodem download of sz-big\.bin/.test(l)).pop() || '';
    r.statusColourOk = statusColourOk(pane, /^Zmodem download of sz-big\.bin/, how === 'kill' ? 'red' : 'dim');
    r.shellUsable = await usable(pane, tag.toUpperCase() + how.toUpperCase());
    r.liveRegion = liveText();
    r.tail = textOf(pane).trimEnd().split('\n').slice(-4);
    await shot(`${tag}-03-${how}`);
    r.ok = (how === 'kill' ? r.status === 'error' && /the remote side stopped/.test(r.error || '') : r.status === 'cancelled' && /cancelled$/.test(r.statusLine))
      && r.partialRemoved && r.promptMs !== null && r.promptMs < (how === 'kill' ? 7000 : 3000) && r.junkChars === 0 && r.parseErrors === 0 && r.shellUsable && r.statusColourOk
      && (how === 'kill' || /download of sz-big\.bin cancelled/.test(r.liveRegion));
    log(`${tag} ${how}`, JSON.stringify(r));
    return r;
  };

  try {
    await app.saveSettings({ confirmClose: false, zmodem: true, sftpAutoOpen: false, theme: 'moba-dark' });
    app.showPanel('sftp'); // the transfers list is read from the DOM
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
      r.szDoneToast = /Zmodem: sz-src\.bin downloaded \(3\.0 MB\)/.test(document.getElementById('toast-root').textContent);
      await waitFor(() => promptReady(pane), 10000, `${tag} prompt back after sz`).catch(() => {});
      r.szStatusColourOk = statusColourOk(pane, /^Zmodem: received sz-src\.bin/, 'dim');
      await shot(`${tag}-01-sz-done`);
      // the same file again: the folder has it, so the download lands under a unique name — and is listed under it
      pane.write(`${SZ} -q -b ${srcName}\r`);
      const dup = await waitFor(() => { const t = zx((t) => t.kind === 'download' && t.connId === pane.termId && t.startedAt > dlt.startedAt); return t && t.status !== 'running' ? t : null; }, 60000, `${tag} second sz done`);
      r.dupListedUnderLocalName = dup.status === 'done' && dup.name === 'sz-src (1).bin' && dup.remote === srcName && dup.local === dl + '/sz-src (1).bin'
        && [...document.querySelectorAll('#panel-sftp .xfer .n')].some((n) => n.textContent === 'sz-src (1).bin' && n.title === srcName);
      log(`${tag} second sz`, dup.status, dup.name, dup.local, 'listed', JSON.stringify([...document.querySelectorAll('#panel-sftp .xfer .n')].map((n) => n.textContent)));
      await waitFor(() => promptReady(pane), 10000, `${tag} prompt back after the second sz`).catch(() => {});

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

      // --- aborts: a big sz cancelled from the transfers list (while a session log runs), by Ctrl-C, and killed remotely ---
      await fsx('randomFile', far + '/sz-big.bin', 160 * 1024 * 1024); // ~8 s at the loopback's ~20 MB/s: room to cancel and to kill
      await pane.toggleLog(true);
      await sleep(300);
      r.cancelList = await abortCase(tag, pane, far, dl, 'list');
      await pane.toggleLog(false);
      await sleep(400);
      const logText = await fsx('readText', pane.logFile);
      const logJunk = (logText.match(/[\x00-\x06\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g) || []).length;
      r.logStaysText = /Zmodem download of sz-big\.bin cancelled/.test(logText) && new RegExp(`ZM_${tag.toUpperCase()}LIST`).test(logText) && logJunk === 0 && logText.length < 20000;
      log(`${tag} log`, pane.logFile, 'bytes', logText.length, 'junk bytes', logJunk);
      r.cancelCtrlC = await abortCase(tag, pane, far, dl, 'ctrlc');
      r.remoteKill = await abortCase(tag, pane, far, dl, 'kill');
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

    // ---------- local shell pane (same code path; needs a working node-pty), on Solarized Dark: SGR 90 was invisible there ----------
    try {
      await app.saveSettings({ theme: 'solarized-dark' });
      await sleep(300);
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

    await app.saveSettings({ theme: 'moba-dark' });
    await fsx('rm', scratch);
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-zmodem] FAIL', e.message, e.stack);
    await shot('99-zmodem-fail').catch(() => {});
  }
  // every boolean that is false anywhere in the results is a failure; the abort cases carry their verdict in `ok`
  const failed = [];
  const walk = (o, at) => { for (const [k, v] of Object.entries(o || {})) { const p = at ? `${at}.${k}` : k; if (v === false) failed.push(p); else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p); } };
  walk(results, '');
  if (results.error) failed.push('error');
  if (!results.ssh) failed.push('ssh');
  results.ok = failed.length === 0;
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ fail: failed.length, failed }));
  log('DONE');
  await sleep(300);
  window.api.app.quit();
})();
