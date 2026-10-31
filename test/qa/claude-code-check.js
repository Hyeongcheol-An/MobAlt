// Manual check against the real Claude Code CLI — not part of the e2e suites (those run without it, see
// test/e2e-claude-keys.js). Needs `claude` on the login shell's PATH (or in ~/.local/bin) and a signed-in Claude Code.
// Checks, in a plain pane, a split pane, that pane zoomed and a detached window: Shift+Enter puts a newline in Claude
// Code's composer instead of sending the prompt, and ⌘V with an image and no text on the clipboard attaches it
// ("[Image #1]"). Claude Code is started in a fresh empty folder, its "trust this folder" question is answered (Down to
// "Yes, I trust this folder", Enter), and it is left with Ctrl+C. NO prompt is ever submitted: nothing goes to the model — the script types `abc`,
// presses Shift+Enter (a real key), types `def`, reads the composer back from the terminal buffer and clears it with
// Ctrl+C; plain Enter is never pressed while the composer holds text.
//   test/qa/run.sh test/qa/claude-code-check.js <out-dir> 300000      # screenshots → <out-dir>/shots/*.png
// The system clipboard is written (a PNG) and put back afterwards.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[claude-check]', ...a);
  const app = window.app;
  const results = {};
  const bufferText = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && bufferText(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  const fsx = (op, ...a) => window.api.app.testFs(op, ...a);
  const SHIFT_ENTER = { keyCode: 'Enter', modifiers: ['shift'], char: '\r' };
  const cwd = await fsx('mkdtemp', 'mobalt-claude-check-'); // fresh and empty: Claude Code asks whether to trust it
  const PROMPT = 'CLAUDECHK> ';
  const shellPrompts = (t) => t.split('\n').filter((l) => l.startsWith('CLAUDECHK>')).length; // the prompt is set before Claude Code starts
  // the composer: a "❯" prompt line (empty or with its placeholder, e.g. ❯ Try "fix lint errors") or the mode line under it
  const composerUp = (t) => /\? for shortcuts|shift\+tab to cycle/.test(t) || /^\s*[❯>]\s*(Try\b.*)?$/m.test(t);
  const trustAsked = (t) => /trust/i.test(t) && /folder|directory/i.test(t);
  const working = (t) => /esc to interrupt|⏺/.test(t); // Claude Code answering: a prompt went out — must never happen
  // the other window
  const windows = () => window.api.app.testWindows();
  const detachedWin = async () => (await windows()).find((w) => w.detached) || null;
  const ev = (id, code) => window.api.app.testEval(id, code);
  // one terminal, in this window (a pane) or in another one (window id + pane index): how to read it and type into it
  const ioOf = (pane) => ({ tag: pane.id, text: async () => bufferText(pane), input: (s) => pane.term.input(s), focus: async () => pane.focus(), press: (k) => window.api.app.testKey(k), paste: () => window.api.app.testPaste(), shot: (n) => shot(n) });
  const ioIn = (id, i) => {
    const p = `window.app.workspace.active.panes()[${i}]`;
    return {
      tag: `window ${id} pane ${i}`,
      text: () => ev(id, `(() => { const b = ${p}.term.buffer.active; return [...Array(b.length)].map((_, i) => b.getLine(i)?.translateToString(true)).join('\\n'); })()`),
      input: (s) => ev(id, `${p}.term.input(${JSON.stringify(s)})`),
      focus: () => ev(id, `${p}.focus()`),
      press: (k) => window.api.app.testKey({ ...k, windowId: id }),
      paste: () => window.api.app.testPaste(id),
      shot: (n) => ev(id, `window.api.app.screenshot(${JSON.stringify(n)})`),
    };
  };
  /** Claude Code started in cwd in this terminal: the trust question answered, the composer up. */
  const startClaude = async (io) => {
    io.input(`PROMPT='${PROMPT}'\r`);
    await waitFor(async () => shellPrompts(await io.text()) >= 1, 8000, 'shell prompt in ' + io.tag);
    io.input(`cd '${cwd}' && "$(command -v claude || echo "$HOME/.local/bin/claude")"\r`);
    await waitFor(async () => { const t = await io.text(); return trustAsked(t) || composerUp(t); }, 40000, 'Claude Code starting in ' + io.tag);
    if (!composerUp(await io.text())) {
      // the trust question pre-selects "No, exit": move the marker to the "Yes" row (Down), then Enter
      await sleep(400);
      const yesSelected = (t) => t.split('\n').some((l) => /^\s*[❯>]\s*Yes/.test(l));
      for (let i = 0; i < 3 && !yesSelected(await io.text()); i++) { io.input('\x1b[B'); await sleep(400); }
      if (!yesSelected(await io.text())) throw new Error('could not select "Yes, I trust this folder" in ' + io.tag);
      io.input('\r');
    }
    await waitFor(async () => composerUp(await io.text()), 40000, 'Claude Code composer in ' + io.tag);
    await sleep(1000);
  };
  /**
   * Leave Claude Code: Ctrl+C twice, close together (the first shows "Press Ctrl-C again to exit", the second — within
   * about a second — exits), until the shell prompt is the last line; then the /exit command as a fallback (a slash
   * command alone in the composer, never a prompt). The pane is focused first, as a user's Ctrl+C always is. A Claude
   * Code that still runs is only reported: the app quit closes its pty anyway.
   */
  const leaveClaude = async (io) => {
    const tail = (t) => t.trimEnd().split('\n').slice(-3);
    const atShell = (t) => /^CLAUDECHK> ?(\^C)?$/.test(tail(t).pop() || '');
    await io.focus();
    await sleep(300);
    log('leaving Claude Code in', io.tag, 'tail', JSON.stringify(tail(await io.text())));
    for (let i = 0; i < 3 && !atShell(await io.text()); i++) {
      io.input('\x03');
      await sleep(250);
      io.input('\x03');
      await sleep(1500);
    }
    if (!atShell(await io.text())) {
      io.input('/exit');
      await sleep(700);
      io.input('\r');
      await sleep(2500);
    }
    const t = await io.text();
    if (!atShell(t)) log('WARNING: Claude Code still runs in', io.tag, JSON.stringify(tail(t)), '- its pty is closed when the app quits');
  };
  /** abc, Shift+Enter, def: the composer shows them on two lines, Claude Code is not answering. Then Ctrl+C clears it. */
  const newlineCheck = async (io, name) => {
    io.input('abc');
    await sleep(400);
    await io.focus();
    await sleep(100);
    await io.press(SHIFT_ENTER);
    await sleep(500);
    io.input('def');
    await sleep(900);
    const t = await io.text();
    const lines = t.split('\n');
    const idf = lines.map((l, i) => (/\bdef\b/.test(l) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const ok = idf > 0 && /\babc\b/.test(lines[idf - 1]) && !lines[idf - 1].includes('def') && !lines[idf].includes('abc') && !working(t);
    log(name, 'composer:', JSON.stringify(lines.slice(Math.max(0, idf - 2), idf + 2)), ok ? 'two lines' : 'NOT two lines', working(t) ? '— and Claude Code is WORKING (a prompt went out!)' : '');
    await io.shot(name);
    io.input('\x03'); // clears the composer
    await sleep(600);
    results[name] = ok;
    return ok;
  };
  /** A PNG on the clipboard, ⌘V (Edit → Paste) in the terminal: the composer shows [Image #n]. Then Ctrl+C clears it. */
  const imageCheck = async (io, name) => {
    await window.api.app.testClipboardPng(pngDataUrl);
    await io.focus();
    await sleep(100);
    const before = ((await io.text()).match(/\[Image #\d+\]/g) || []).length;
    await io.paste();
    let ok = false;
    try { await waitFor(async () => ((await io.text()).match(/\[Image #\d+\]/g) || []).length > before, 10000, '[Image #n] in ' + io.tag); ok = true; } catch {}
    const t = await io.text();
    log(name, 'composer:', JSON.stringify(t.trim().split('\n').slice(-6)), ok ? '[Image #n] shown' : 'NO [Image #n]');
    await io.shot(name);
    io.input('\x03');
    await sleep(600);
    results[name] = ok && !working(t);
    return results[name];
  };
  const pngDataUrl = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#e33'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#fff'; g.fillRect(8, 8, 16, 16);
    return c.toDataURL('image/png');
  })();
  const clipBefore = await window.api.clipboard.read();
  try {
    await app.saveSettings({ confirmClose: false });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const a = app.activePane();
    await prompt(a);

    // ---- plain pane
    const ioA = ioOf(a);
    await startClaude(ioA);
    await newlineCheck(ioA, '01-plain-shift-enter');
    await imageCheck(ioA, '02-plain-image-paste');

    // ---- split pane, then zoomed
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'right' });
    await prompt(b);
    const ioB = ioOf(b);
    await startClaude(ioB);
    await newlineCheck(ioB, '03-split-shift-enter');
    await imageCheck(ioB, '04-split-image-paste');
    app.action('zoom-pane', undefined, b);
    await sleep(500);
    results.zoomed = b.tab.zoomed === b;
    await newlineCheck(ioB, '05-zoomed-shift-enter');
    await imageCheck(ioB, '06-zoomed-image-paste');
    app.action('zoom-pane', undefined, b);
    await sleep(500);

    // ---- the tab detached into a window of its own (both Claude Codes keep running there)
    await app.action('detach-tab');
    let dw = null;
    await waitFor(async () => (dw = await detachedWin()), 15000, 'detached window');
    await waitFor(() => ev(dw.id, `!!(window.app && window.app.workspace && window.app.workspace.active && window.app.workspace.active.panes().length === 2 && window.app.workspace.active.panes().every((p) => p.status === 'connected'))`).catch(() => false), 20000, 'the detached window attached both terminals');
    await sleep(1500);
    const ioD0 = ioIn(dw.id, 0), ioD1 = ioIn(dw.id, 1);
    await waitFor(async () => composerUp(await ioD1.text()), 15000, 'composer replayed in the detached window');
    await newlineCheck(ioD1, '07-detached-shift-enter');
    await imageCheck(ioD1, '08-detached-image-paste');
    await leaveClaude(ioD1);
    await leaveClaude(ioD0);
    await window.api.app.testCloseWindow(dw.id);
    await waitFor(async () => !(await detachedWin()), 5000, 'detached window closed');
  } catch (e) {
    results.error = e.message;
    console.error('[claude-check] FAIL', e.message, e.stack);
    await shot('99-claude-check-fail').catch(() => {});
  }
  await window.api.clipboard.write(clipBefore || '').catch(() => {});
  await fsx('rm', cwd).catch(() => {});
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
