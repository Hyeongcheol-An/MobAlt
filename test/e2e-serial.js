// Renderer-side serial check against test/serial-device.js (a virtual device on a pty). test/e2e-serial.sh starts the
// device, fills in __SERIAL_PATH__ / __CMD_FILE__ below and runs this script:
//   test/e2e-serial.sh <out-dir>
// Exercises: the port list, a session on the device, the device's echo and the local echo (Backspace erases on
// screen), the session editor's serial fields, a second session on the same device (Resource busy — explained),
// Send Break from the pane menu (a pty has no break condition: the driver's refusal is toasted, the pane lives on),
// a session log in test mode (under the run's user-data folder, the file-name stamp in local time), the device
// vanishing (noticed without a keystroke; the pane ends with "Device … disconnected." and a toast says the same),
// a reconnect while it is gone (the open error without the doubled "Error:" / path).
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
  const log = (...a) => console.log('[e2e-serial]', ...a);
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const app = window.app;
  const results = {};
  const DEV = '__SERIAL_PATH__';
  const CMD = '__CMD_FILE__';
  const textOf = (p) => [...Array(p.term.buffer.active.length)].map((_, i) => p.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const toasts = [];
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('#toast-root > *')) if (!el._seen) { el._seen = true; toasts.push(el.textContent); }
  }).observe(document.getElementById('toast-root'), { childList: true, subtree: true });
  const serial = { folder: 'Test', type: 'serial', serialPath: DEV, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flow: 'none', localEcho: true, newline: 'cr' };
  try {
    await app.saveSettings({ confirmClose: false });
    const ports = await window.api.term.listSerialPorts();
    results.listPorts = Array.isArray(ports);
    const s = await app.saveSession({ name: 'mock-device', ...serial });
    const pane = await app.openSession(s);
    await waitFor(() => pane.status === 'connected', 8000, 'serial connected');
    await sleep(500);
    pane.term.input('hello serial\r');
    await sleep(1200);
    let text = textOf(pane);
    results.echoedByDevice = /DEVICE> HELLO SERIAL/.test(text);
    results.localEcho = /^hello serial$/m.test(text);
    // Backspace in the local echo erases on screen ("\b \b"): "abx⌫c" reads abc, and the device (a line editor) gets abc too
    pane.term.input('abx\x7fc\r');
    await waitFor(() => /DEVICE> ABC/.test(textOf(pane)), 5000, 'device echo of abc');
    text = textOf(pane);
    results.backspaceEcho = /^abc$/m.test(text) && !/^abx/m.test(text);
    await shot('20-serial');

    // the session editor shows serial fields
    app.editSession(s);
    await sleep(500);
    results.editorSerialFields = !!document.querySelector('.modal input[placeholder^="or type a device path"]');
    await shot('21-serial-editor');
    document.querySelector('.modal .close')?.click();
    await sleep(300);

    // Send Break in the pane menu of a serial pane; a pty has no break condition, so the driver refuses and the
    // refusal is toasted as a serial error — the pane stays connected either way
    pane.openHeaderMenu();
    await sleep(200);
    const items = [...document.querySelectorAll('#ctx-root .ctx-item')];
    const brk = items.find((i) => i.childNodes[0].textContent === 'Send Break');
    results.sendBreakItem = !!brk;
    const toastsBefore = toasts.length;
    if (brk) brk.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(800);
    results.sendBreakToast = toasts.slice(toastsBefore).find((x) => /Serial error/.test(x)) || null;
    results.sendBreakPaneAlive = pane.status === 'connected' && !pane.dead;
    log('send break:', JSON.stringify({ item: results.sendBreakItem, toast: results.sendBreakToast }));

    // a second session on the same device: serialport opens the port exclusively, so the second open is refused —
    // "Resource busy" explained, without the doubled "Error:" and path of the driver's message
    const s2 = await app.saveSession({ name: 'mock-device-2', ...serial });
    const pane2 = await app.openSession(s2);
    await waitFor(() => pane2.dead || pane2.status === 'connected', 8000, 'second open outcome');
    await sleep(300);
    const t2 = textOf(pane2);
    results.busyLine = (t2.match(/Cannot open [^\n]*/) || [''])[0];
    results.busyExplained = pane2.dead && results.busyLine === `Cannot open ${DEV}: Resource busy — the port is open in another pane or program`;
    await shot('22-serial-busy');
    if (!pane2.dead) await pane2.disconnect();
    await app.closePane(pane2, true);
    await sleep(300);

    // a session log in test mode goes under the run's user-data folder, named with a local-time stamp
    await pane.toggleLog(true);
    const logFile = pane.logFile;
    results.logFile = logFile;
    results.logUnderUserData = typeof logFile === 'string' && logFile.startsWith(app.info.userData + '/MobAlt Logs/');
    const m = /_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.log$/.exec(logFile || '');
    results.logStampLocal = !!m && Math.abs(new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Date.now()) < 120000;
    await pane.toggleLog(false);

    // the device vanishes (the helper closes the pair): noticed without a keystroke — within the 3 s probe and a
    // little — the pane ends with the dead line "Device … disconnected." and a toast says the same
    const tDrop = Date.now();
    await fsx('writeText', CMD, 'drop\n');
    await waitFor(() => pane.dead, 9000, 'device gone noticed');
    results.deviceGoneMs = Date.now() - tDrop;
    await sleep(400);
    text = textOf(pane);
    results.deviceGoneLine = (text.match(/── Device [^\n]*/) || [''])[0];
    results.deviceGoneDead = pane.dead && pane.status === 'disconnected' && text.includes(`── Device ${DEV} disconnected. Press Enter to reconnect, ⌘W to close. ──`);
    results.deviceGoneToast = toasts.some((x) => x.includes(`Device ${DEV} disconnected`));
    results.deviceGoneOverlay = pane.el.querySelector('.pane-overlay span')?.textContent || '';
    results.noEioLine = !/Serial error: EIO/.test(text);
    await shot('23-serial-device-gone');

    // a reconnect while the device is gone: the open error names the reason only
    await pane.reconnect();
    await waitFor(() => pane.dead, 8000, 'reconnect while gone');
    text = textOf(pane);
    results.reconnectGoneLine = (text.match(/Cannot open [^\n]*/g) || []).pop() || '';
    results.reconnectGoneWording = results.reconnectGoneLine === `Cannot open ${DEV}: No such file or directory`;
    await shot('24-serial-reconnect-gone');
    results.closed = true;
    log('RESULTS ' + JSON.stringify(results));
    log('DONE');
  } catch (e) {
    console.error('[e2e-serial] FAIL', e.message, e.stack);
    log('RESULTS ' + JSON.stringify(results));
    await shot('99-serial-fail').catch(() => {});
  }
  await sleep(300);
  window.api.app.quit();
})();
