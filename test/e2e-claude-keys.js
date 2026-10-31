// The keys and pastes Claude Code depends on (src/renderer/terminal.js: the key handler, the paste handler, pasteImage;
// src/main/main.js clipboard:kinds): Shift+Enter reaches the pty as ESC CR and nothing else (xterm's keypress path used
// to add a plain CR after it — a newline, then a submit, in Claude Code), Option+Enter sends the same, Enter a bare CR,
// Ctrl+V a bare 0x16; ⌘V / Edit → Paste and right-click paste with an image and no text on the clipboard send Ctrl+V
// (0x16), so a TUI that reads the clipboard itself (Claude Code: "[Image #1]") takes the image; text on the clipboard
// wins; an empty clipboard sends nothing; an image file dropped on a local pane pastes its quoted path. All of it in a
// plain pane, a split pane, a zoomed pane and a detached window. The bytes are read by a raw-mode node reader running
// in the pane, which prints every chunk it gets as <hex>; the keys are REAL presses (window.api.app.testKey with
// modifiers and the char event a key gives the browser), the ⌘V an Edit → Paste (window.api.app.testPaste).
// No claude binary is needed; test/qa/claude-code-check.js drives the real one.
//   test/qa/run.sh test/e2e-claude-keys.js <out-dir> 120000
// The system clipboard is written (a PNG through osascript, then through the test hook, then text) and put back
// afterwards; it is shared with everything else on the Mac, so a check whose clipboard was taken meanwhile is repeated.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-claude-keys]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const same = (got, ...want) => got.length === want.length && got.every((c, i) => c === want[i]);
  const SHIFT_ENTER = { keyCode: 'Enter', modifiers: ['shift'], char: '\r' };
  const OPTION_ENTER = { keyCode: 'Enter', modifiers: ['alt'], char: '\r' };
  const CTRL_V = { keyCode: 'V', modifiers: ['control'] };
  const ENTER = { keyCode: 'Enter', char: '\r' };
  // the reader: raw mode, one <hex> line per chunk read from stdin, Ctrl+Q ends it
  const scratch = await fsx('mkdtemp', 'mobalt-claude-keys-');
  const reader = scratch + '/reader.js';
  await fsx('writeText', reader, [
    "process.stdin.setRawMode(true); process.stdin.resume();",
    "process.stdin.on('data', (d) => { process.stdout.write('<' + d.toString('hex') + '>\\r\\n'); if (d.includes(0x11)) process.exit(0); });",
    "process.stdout.write('READER READY\\r\\n');",
    '',
  ].join('\n'));
  const chunks = (t) => (t.replace(/\n/g, '').match(/<[0-9a-f]*>/g) || []).map((c) => c.slice(1, -1)); // rows joined: a long chunk wraps over two rows
  const startReader = async (pane) => {
    pane.term.input('clear; node ' + reader + '\r');
    await waitFor(() => text(pane).includes('READER READY'), 10000, 'reader in ' + pane.id);
    await sleep(200);
  };
  /** The chunks the reader printed while fn ran (a trusted key, a paste, a drop). */
  const during = async (pane, fn, what, wait = 600) => {
    const before = chunks(text(pane)).length;
    await fn();
    await sleep(wait);
    const got = chunks(text(pane)).slice(before);
    log(what, pane.id, JSON.stringify(got));
    return got;
  };
  const press = async (pane, key, what) => during(pane, async () => { pane.focus(); await sleep(80); await window.api.app.testKey(key); }, what);
  // a PNG drawn here, decoded by the shell and put on the pasteboard as PNGf — what a screenshot or "Copy Image" leaves there
  const pngDataUrl = (() => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = '#e33'; g.fillRect(0, 0, 8, 8);
    return c.toDataURL('image/png');
  })();
  await fsx('writeText', scratch + '/x.b64', pngDataUrl.split(',')[1]);
  /** fn with a PNG and no text on the clipboard (the test hook); repeated, up to 3 times, when the clipboard no longer holds it afterwards (another process wrote it meanwhile). */
  const withPng = async (fn) => {
    for (let i = 0; i < 3; i++) {
      await window.api.app.testClipboardPng(pngDataUrl);
      const got = await fn();
      const k = await window.api.clipboard.kinds();
      if (k.image && !k.text) return got;
      log('the clipboard was taken by another process during the check, retrying:', JSON.stringify(k));
    }
    return [];
  };
  const pngToClipboard = async (pane, tag) => {
    pane.term.input(`base64 -D -i ${scratch}/x.b64 -o ${scratch}/x.png && osascript -e 'set the clipboard to (read (POSIX file "${scratch}/x.png") as «class PNGf»)' && echo ${tag}''OK\r`);
    await waitFor(() => text(pane).includes(tag + 'OK'), 15000, 'png on the clipboard (' + tag + ')');
    await sleep(200);
  };
  // the other window
  const windows = () => window.api.app.testWindows();
  const detachedWin = async () => (await windows()).find((w) => w.detached) || null;
  const ev = (id, code) => window.api.app.testEval(id, code);
  const evText = (id) => ev(id, `(() => { const p = window.app && window.app.workspace && window.app.activePane(); if (!p) return ''; const b = p.term.buffer.active; return [...Array(b.length)].map((_, i) => b.getLine(i)?.translateToString(true)).join('\\n'); })()`);
  const evDuring = async (id, fn, what, wait = 600) => {
    const before = chunks(await evText(id)).length;
    await fn();
    await sleep(wait);
    const got = chunks(await evText(id)).slice(before);
    log(what, 'window ' + id, JSON.stringify(got));
    return got;
  };
  const clipBefore = await window.api.clipboard.read();
  try {
    await app.saveSettings({ confirmClose: false, pasteConfirmMultiline: true, pasteWarnSuspicious: true });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const a = app.activePane();
    await prompt(a);

    // ---- the clipboard IPC: a PNG and no text
    await pngToClipboard(a, 'CLIP1');
    const kImg = await window.api.clipboard.kinds();
    log('kinds (png)', JSON.stringify(kImg));
    results.kindsImageNoText = kImg.image === true && kImg.text === false;

    // ---- plain pane: the bytes of each key, one chunk each
    await startReader(a);
    results.enterBareCR = same(await press(a, ENTER, 'Enter'), '0d');
    results.shiftEnterEscCrOnly = same(await press(a, SHIFT_ENTER, 'Shift+Enter'), '1b0d');
    results.optionEnterEscCr = same(await press(a, OPTION_ENTER, 'Option+Enter'), '1b0d');
    results.ctrlVUntouched = same(await press(a, CTRL_V, 'Ctrl+V'), '16');
    results.typedLetter = same(await press(a, { keyCode: 'X', char: 'x' }, 'x'), '78');
    // ⌘V / Edit → Paste with an image and no text: Ctrl+V to the application; the same from the right-click path
    a.focus();
    results.pasteImageSendsCtrlV = same(await during(a, () => window.api.app.testPaste(), '⌘V (image on the clipboard, osascript)'), '16');
    results.pasteImageHookSendsCtrlV = same(await withPng(() => during(a, () => window.api.app.testPaste(), '⌘V (image on the clipboard)')), '16');
    results.rightClickPasteImage = same(await withPng(() => during(a, () => a.paste(), 'right-click paste (image on the clipboard)')), '16');
    await shot('01-plain-pane');
    // text and an image together: the text is pasted, no Ctrl+V — as one paste event, and from the real clipboard
    {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'txt1');
      try { dt.items.add(new File(['x'], 'x.png', { type: 'image/png' })); } catch {}
      results.textWinsOverImage = same(await during(a, () => a.term.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })), 'paste text+image'), hex('txt1'));
      await window.api.app.testClipboardPng(pngDataUrl, 'txt3');
      const kBoth = await window.api.clipboard.kinds();
      log('kinds (png + text)', JSON.stringify(kBoth));
      results.kindsBoth = kBoth.text === true && kBoth.image === true;
      results.textWinsOnClipboard = same(await during(a, () => window.api.app.testPaste(), '⌘V (image and text on the clipboard)'), hex('txt3'));
      results.rightClickTextWins = same(await during(a, () => a.paste(), 'right-click paste (image and text on the clipboard)'), hex('txt3'));
    }
    // text on the clipboard: pasted as before (and the kinds say so); an empty clipboard: nothing at all
    await window.api.clipboard.write('txt2');
    const kTxt = await window.api.clipboard.kinds();
    log('kinds (text)', JSON.stringify(kTxt));
    results.kindsTextNoImage = kTxt.text === true && kTxt.image === false;
    a.focus();
    results.pasteTextStillPastes = same(await during(a, () => window.api.app.testPaste(), '⌘V (text on the clipboard)'), hex('txt2'));
    await window.api.clipboard.write('');
    const kNone = await window.api.clipboard.kinds();
    results.kindsEmpty = kNone.text === false && kNone.image === false;
    results.emptyClipboardSendsNothing = (await during(a, () => window.api.app.testPaste(), '⌘V (empty clipboard)')).length === 0;
    results.rightClickEmptySendsNothing = (await during(a, () => a.paste(), 'right-click paste (empty clipboard)')).length === 0;

    // ---- an image file dropped on a local pane (a real drop through CDP, the File carries its path): its quoted path
    {
      const file = scratch + '/my pic.png';
      await fsx('writeText', file, 'x');
      const r = a.termEl.getBoundingClientRect();
      results.imageDropPastesQuotedPath = same(await during(a, () => window.api.app.testDropFiles([file], { x: r.left + r.width / 2, y: r.top + r.height / 2 }), 'drop image file'), hex(`'${file}'`));
      if (results.imageDropPastesQuotedPath !== true) log('drop: buffer tail', JSON.stringify(text(a).trim().split('\n').slice(-4)), 'want', hex(`'${file}'`));
    }

    // ---- split pane, then zoomed
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'right' });
    await prompt(b);
    await startReader(b);
    results.shiftEnterSplit = same(await press(b, SHIFT_ENTER, 'Shift+Enter (split pane)'), '1b0d');
    results.ctrlVSplit = same(await press(b, CTRL_V, 'Ctrl+V (split pane)'), '16');
    b.focus();
    results.pasteImageSplit = same(await withPng(() => during(b, () => window.api.app.testPaste(), '⌘V image (split pane)')), '16');
    const aCount = chunks(text(a)).length;
    app.action('zoom-pane', undefined, b);
    await sleep(300);
    results.zoomed = b.tab.zoomed === b && b.zoomed === true;
    results.shiftEnterZoomed = same(await press(b, SHIFT_ENTER, 'Shift+Enter (zoomed pane)'), '1b0d');
    b.focus();
    results.pasteImageZoomed = same(await withPng(() => during(b, () => window.api.app.testPaste(), '⌘V image (zoomed pane)')), '16');
    await shot('10-zoomed-pane');
    app.action('zoom-pane', undefined, b);
    await sleep(300);
    results.unzoomed = b.tab.zoomed === null;
    results.hiddenPaneGotNothing = chunks(text(a)).length === aCount;
    await shot('11-split-panes');

    // ---- a detached window: its own window, its own focus, the same bytes
    await app.newLocalTab();
    await sleep(300);
    const c = app.activePane();
    await prompt(c);
    await app.action('detach-tab');
    let dw = null;
    await waitFor(async () => (dw = await detachedWin()), 15000, 'detached window');
    await waitFor(() => ev(dw.id, `!!(window.app && window.app.workspace && window.app.activePane() && window.app.activePane().status === 'connected')`).catch(() => false), 15000, 'the detached window attached its terminal');
    await sleep(500);
    await ev(dw.id, `window.app.activePane().term.input(${JSON.stringify('clear; node ' + reader + '\r')})`);
    await waitFor(async () => (await evText(dw.id)).includes('READER READY'), 10000, 'reader in the detached window');
    await sleep(200);
    const dPress = (key, what) => evDuring(dw.id, async () => { await ev(dw.id, 'window.app.activePane().focus()'); await sleep(80); await window.api.app.testKey({ ...key, windowId: dw.id }); }, what);
    results.shiftEnterDetached = same(await dPress(SHIFT_ENTER, 'Shift+Enter (detached window)'), '1b0d');
    results.ctrlVDetached = same(await dPress(CTRL_V, 'Ctrl+V (detached window)'), '16');
    await ev(dw.id, 'window.app.activePane().focus()');
    results.pasteImageDetached = same(await withPng(() => evDuring(dw.id, () => window.api.app.testPaste(dw.id), '⌘V image (detached window)')), '16');
    await ev(dw.id, `window.api.app.screenshot('20-detached-window')`);
    await window.api.app.testCloseWindow(dw.id);
    await waitFor(async () => !(await detachedWin()), 5000, 'detached window closed');
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-claude-keys] FAIL', e.message, e.stack);
    await shot('99-claude-keys-fail').catch(() => {});
  }
  await window.api.clipboard.write(clipBefore || '').catch(() => {});
  await fsx('rm', scratch).catch(() => {});
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
