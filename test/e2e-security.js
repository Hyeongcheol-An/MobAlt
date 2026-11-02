// What the window may open outside the app (the 1.0 security review, N1/N2). No server needed. Run:
//   bash test/qa/run.sh test/e2e-security.js <out-dir> 60000
// Nothing here opens a browser, Finder or another app: every call is one the main process must refuse.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    throw new Error('timeout waiting for ' + what);
  };
  const log = (...a) => console.log('[e2e-security]', ...a);
  const app = window.app;
  const R = {};
  try {
    const info = await window.api.app.info();
    const start = location.href;
    // N1: shell:open-external refuses anything but http(s) / mailto (refused calls resolve false, nothing opens)
    R.externalFileRefused = (await window.api.shell.openExternal('file:///System/Applications/Calculator.app')) === false;
    R.externalSchemeRefused = (await window.api.shell.openExternal('x-apple.systempreferences:com.apple.preference.security')) === false;
    R.externalJsRefused = (await window.api.shell.openExternal('javascript:alert(1)')) === false;
    // shell:open-path: a file (could be an app or a script) and a folder outside home/tmp are refused
    const tmp = await window.api.app.testFs('mkdtemp', 'mobalt-sec-');
    await window.api.app.testFs('writeText', tmp + '/x.command', '#!/bin/sh\necho hi\n');
    R.openPathFileRefused = (await window.api.shell.openPath(tmp + '/x.command')) === 'refused';
    R.openPathSystemRefused = (await window.api.shell.openPath('/System/Applications')) === 'refused';
    R.openPathDotDotRefused = (await window.api.shell.openPath(info.userData + '/..'.repeat(20) + '/Applications')) === 'refused';
    await window.api.app.testFs('rm', tmp);
    // the app's own folders are allowed wherever they are (a QA run's userData is under /private/tmp, outside home
    // and $TMPDIR): '' is success (test mode answers without opening Finder); a file in them still is not
    R.openPathUserDataAllowed = (await window.api.shell.openPath(info.userData)) === '';
    await window.api.app.testFs('writeText', info.userData + '/x.command', '#!/bin/sh\n');
    R.openPathUserDataFileRefused = (await window.api.shell.openPath(info.userData + '/x.command')) === 'refused';
    // vnc: a host that would change the URL is refused
    R.vncBadHostRefused = (await window.api.launch.vnc({ host: 'x@example.com/a', port: 5900 })) === false;
    // the window stays on index.html: a navigation is cancelled, window.open opens nothing
    location.href = 'file:///private/tmp/';
    await sleep(800);
    R.navigationBlocked = location.href === start && !!window.app;
    const w = window.open('file:///private/tmp/', '_blank');
    R.windowOpenDenied = w === null;
    const wins = await window.api.app.testWindows();
    R.stillOneWindow = Array.isArray(wins) && wins.length === 1;
    // N2: OSC 8 links go through the app's handler, http(s) only
    const pane = await waitFor(() => app.activePane() && app.activePane().term && app.activePane(), 10000, 'local pane');
    const lh = pane.term.options.linkHandler;
    R.osc8Handler = !!lh && typeof lh.activate === 'function' && lh.allowNonHttpProtocols === false;
    // an OSC 8 link is recognised (and a file:// one would never reach activate: allowNonHttpProtocols false)
    pane.term.write('\x1b]8;;file:///etc/passwd\x07FILELINK\x1b]8;;\x07 \x1b]8;;https://example.com/\x07WEBLINK\x1b]8;;\x07\r\n');
    await sleep(300);
    R.osc8Rendered = /FILELINK WEBLINK/.test(pane.term.buffer.active.getLine(pane.term.buffer.active.cursorY - 1)?.translateToString(true) || '');
  } catch (e) {
    console.error('[e2e-security] FAIL', e.message);
    R.error = e.message;
  }
  const failed = Object.entries(R).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(R));
  log(failed.length ? 'FAILED: ' + failed.join(', ') : 'ALL PASS');
  await sleep(300);
  window.api.app.quit();
})();
