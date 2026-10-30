// Renderer-side serial check against test/mock-serial.py. The device path is injected
// by replacing __SERIAL_PATH__ before running (see README "E2E 테스트").
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
  const app = window.app;
  const results = {};
  try {
    const ports = await window.api.term.listSerialPorts();
    results.listPorts = Array.isArray(ports);
    const s = await app.saveSession({ name: 'mock-device', folder: 'Test', type: 'serial', serialPath: '__SERIAL_PATH__', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flow: 'none', localEcho: true, newline: 'cr' });
    const pane = await app.openSession(s);
    await waitFor(() => pane.status === 'connected', 8000, 'serial connected');
    await sleep(500);
    pane.term.input('hello serial\r');
    await sleep(1200);
    const lines = [];
    for (let i = 0; i < pane.term.buffer.active.length; i++) lines.push(pane.term.buffer.active.getLine(i)?.translateToString(true));
    const text = lines.join('\n');
    results.echoedByDevice = /DEVICE> HELLO SERIAL/.test(text);
    results.localEcho = /hello serial/.test(text);
    await shot('20-serial');
    // session editor shows serial fields
    app.editSession(s);
    await sleep(500);
    results.editorSerialFields = !!document.querySelector('.modal input[placeholder^="or type a device path"]');
    await shot('21-serial-editor');
    document.querySelector('.modal .close')?.click();
    await pane.disconnect();
    await waitFor(() => pane.dead, 5000, 'serial closed');
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
