// Paste guard (src/renderer/pasteguard.js, app.js guardPaste, dialogs.js pasteGuardDialog): every path that hands
// outside text to a terminal goes through it — ⌘V / Edit → Paste (the `paste` event on xterm's textarea), right-click
// paste, text dropped on a pane. A plain single line passes straight through; a multi-line or long paste asks
// ("Paste N lines into …?", editable preview, ⌘⏎ / Esc); hidden characters, a trailing newline, curl | sh and the
// like are listed and marked, "Paste cleaned" strips what can be stripped; the two Settings → Terminal toggles switch
// it off; with MultiExec on one dialog covers every visible terminal and the text reaches each of them once.
//   test/qa/run.sh test/e2e-paste.js <out-dir> 120000
// Pastes are delivered as a synthetic paste event with the text (the system clipboard is shared with everything else
// running on the machine); only the right-click check writes the clipboard, and puts it back afterwards.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-paste]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const count = (pane, s) => text(pane).split('\n').filter((l) => l.includes(s)).length;
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + what);
  };
  const live = (p) => !!p && p.status === 'connected' && !!p.termId;
  const prompt = async (p) => { await waitFor(() => live(p) && text(p).trim().length > 0, 15000, 'prompt in ' + p.title); await sleep(400); };
  let seq = 0;
  const mark = () => 'PG_' + Math.random().toString(36).slice(2, 8).toUpperCase() + ++seq;
  // the echoed command line reads PG_''ABC, so only the command's output contains PG_ABC: one line per time it ran
  const cmd = (m) => `echo PG_''${m.slice(3)}`;
  const out = (m) => m; // the bare marker, as the output shows it
  // ⌘V and Edit → Paste arrive as a `paste` event on xterm's textarea carrying the clipboard text
  const pasteEvent = (pane, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    pane.focus();
    pane.term.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  };
  const modal = () => document.querySelector('.modal');
  const title = () => modal()?.getAttribute('aria-label');
  const btn = (label) => [...document.querySelectorAll('.modal .modal-foot button')].find((b) => b.textContent === label);
  const kinds = () => [...document.querySelectorAll('.modal .pg-findings li .pg-kind')].map((k) => k.textContent);
  const ta = () => document.querySelector('.modal textarea.pg-text');
  const esc = () => modal().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const cmdEnter = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
  /** Enter in the shell, then wait until each marker's output is there (once the shell ran the pasted lines). */
  const run = async (pane, marks, what) => {
    pane.term.input('\r');
    await waitFor(() => marks.every((m) => count(pane, out(m)) >= 1), 8000, what);
    await sleep(600); // a double write would show by now
  };
  try {
    await app.saveSettings({ confirmClose: false, rightClickPaste: true, pasteConfirmMultiline: true, pasteWarnSuspicious: true });
    await waitFor(() => app.workspace && app.workspace.tabs.length === 1 && live(app.activePane()), 15000, 'first local tab');
    const a = app.activePane();
    await prompt(a);
    results.defaultsOn = app.settings.pasteConfirmMultiline === true && app.settings.pasteWarnSuspicious === true;

    // --- a plain single line goes straight through (no dialog), lands on the command line, runs once on Enter
    const m1 = mark();
    pasteEvent(a, cmd(m1));
    await sleep(300);
    results.singleLineNoDialog = !modal();
    results.singleLineOnCommandLine = text(a).includes(`PG_''${m1.slice(3)}`) && count(a, out(m1)) === 0;
    await run(a, [m1], 'single-line paste ran');
    results.singleLineRanOnce = count(a, out(m1)) === 1;

    // --- bracketed paste survives the guard: the shell asked for it (DECSET 2004) and xterm wraps the pasted text
    const seen = [];
    const tap = a.term.onData((d) => seen.push(d));
    const m2 = mark();
    pasteEvent(a, cmd(m2));
    await sleep(200);
    tap.dispose();
    const bracketed = a.term.modes.bracketedPasteMode;
    results.bracketedPasteKept = bracketed ? seen.some((d) => d.startsWith('\x1b[200~') && d.endsWith('\x1b[201~') && d.includes(m2.slice(3))) : seen.some((d) => d.includes(m2.slice(3)));
    log('bracketed paste mode', bracketed, 'data', JSON.stringify(seen));
    await run(a, [m2], 'bracketed single line ran');

    // --- a multi-line paste opens the dialog: line count in the title, the text in a focused editable preview, no findings
    const m3 = mark(), m4 = mark();
    const two = cmd(m3) + '\n' + cmd(m4);
    pasteEvent(a, two);
    await sleep(400);
    results.multilineDialog = !!modal() && !!ta();
    results.multilineTitle = title() === `Paste 2 lines into ${a.title}?`;
    results.multilineTextShown = ta()?.value === two;
    results.multilineTextareaFocused = document.activeElement === ta();
    results.multilineNoFindings = !!document.querySelector('.modal .pg-findings')?.hidden && btn('Paste cleaned')?.hidden === true && !!btn('Paste') && btn('Paste').classList.contains('primary');
    results.multilineNote = /2 lines · \d+ characters · ⌘⏎ pastes, Esc cancels/.test(document.querySelector('.modal .pg-note')?.textContent || '');
    log('dialog title', JSON.stringify(title()), 'buttons', [...document.querySelectorAll('.modal .modal-foot button')].map((b) => b.textContent + (b.hidden ? ' (hidden)' : '')).join(' | '));
    await shot('70-paste-multiline-dialog');
    // Cancel pastes nothing
    btn('Cancel').click();
    await sleep(300);
    results.cancelClosesDialog = !modal();
    results.cancelPastesNothing = !text(a).includes(m3.slice(3)) && !text(a).includes(m4.slice(3));
    results.focusBackToTerminal = document.activeElement === a.term.textarea;
    // Esc cancels too
    pasteEvent(a, two);
    await sleep(300);
    esc();
    await sleep(300);
    results.escCancels = !modal() && !text(a).includes(m3.slice(3));
    // Paste sends the text once
    pasteEvent(a, two);
    await sleep(300);
    btn('Paste').click();
    await sleep(400);
    results.pasteClosesDialog = !modal();
    await run(a, [m3, m4], 'two pasted lines ran');
    results.pasteSendsOnce = count(a, out(m3)) === 1 && count(a, out(m4)) === 1;
    log('markers after Paste', m3, count(a, out(m3)), m4, count(a, out(m4)));
    // ⌘⏎ pastes
    const m5 = mark(), m6 = mark();
    pasteEvent(a, cmd(m5) + '\n' + cmd(m6));
    await sleep(300);
    cmdEnter();
    await sleep(400);
    results.cmdEnterPastes = !modal();
    await run(a, [m5, m6], '⌘⏎ pasted lines ran');
    results.cmdEnterSendsOnce = count(a, out(m5)) === 1 && count(a, out(m6)) === 1;
    // the preview is editable: what is pasted is the edited text
    const m7 = mark();
    pasteEvent(a, cmd(m7) + '\necho PG_DROPPED_LINE');
    await sleep(300);
    ta().value = cmd(m7);
    ta().dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    results.editUpdatesNote = /^1 line · /.test(document.querySelector('.modal .pg-note').textContent);
    btn('Paste').click();
    await sleep(300);
    await run(a, [m7], 'edited paste ran');
    results.editedTextPasted = count(a, out(m7)) === 1 && !text(a).includes('PG_DROPPED_LINE');
    // a long single line asks as well
    pasteEvent(a, 'echo ' + 'x'.repeat(1100));
    await sleep(300);
    results.longLineAsks = !!modal() && title() === `Paste 1 line into ${a.title}?`;
    btn('Cancel').click();
    await sleep(200);

    // --- findings: a zero-width space and a trailing newline are listed and marked; "Paste cleaned" strips both
    const m8 = mark();
    pasteEvent(a, cmd(m8) + '​\n');
    await sleep(400);
    results.findingsListed = JSON.stringify(kinds()) === JSON.stringify(['Invisible character', 'Trailing newline']);
    results.findingsMessages = [...document.querySelectorAll('.modal .pg-findings li')].map((li) => li.textContent).join(' ').includes('U+200B zero-width space') && document.querySelector('.modal .pg-findings').textContent.includes('the last line runs at once');
    results.findingsMarked = document.querySelectorAll('.modal .pg-backdrop mark.pg-mark').length === 2;
    results.findingsWarnBox = !document.querySelector('.modal .pg-findings').classList.contains('danger') && !document.querySelector('.modal .pg-findings').hidden;
    results.findingsButtons = btn('Paste cleaned')?.hidden === false && !!btn('Paste as is') && btn('Paste as is').classList.contains('primary');
    results.findingsTitleOneLine = title() === `Paste 1 line into ${a.title}?`;
    await shot('71-paste-findings-cleaned');
    // what reaches the terminal is checked on xterm's data path: bracketed, and for the cleaned paste without the
    // zero-width space and the final CR (a bracketed-paste shell such as zsh would not run that CR by itself anyway)
    const sent = [];
    const tap2 = a.term.onData((d) => sent.push(d));
    btn('Paste cleaned').click();
    await sleep(400);
    tap2.dispose();
    log('cleaned paste data', JSON.stringify(sent));
    results.cleanedDataStripped = sent.length === 1 && sent[0] === `\x1b[200~${cmd(m8)}\x1b[201~`;
    results.cleanedNotRunYet = !modal() && text(a).includes(`PG_''${m8.slice(3)}`) && count(a, out(m8)) === 0; // no newline went out: nothing ran
    await run(a, [m8], 'cleaned paste ran');
    results.cleanedStripsZeroWidth = text(a).split('\n').some((l) => l.trim() === out(m8)) && count(a, out(m8)) === 1;
    // "Paste as is" keeps the text: the trailing newline goes out as CR (xterm's line-ending rule) inside the brackets
    const m9 = mark();
    pasteEvent(a, cmd(m9) + '\n');
    await sleep(300);
    sent.length = 0;
    const tap3 = a.term.onData((d) => sent.push(d));
    btn('Paste as is').click();
    await sleep(500);
    tap3.dispose();
    log('paste-as-is data', JSON.stringify(sent));
    results.pasteAsIsKeepsNewline = sent.length === 1 && sent[0] === `\x1b[200~${cmd(m9)}\r\x1b[201~`;
    if (count(a, out(m9)) === 0) a.term.input('\r'); // a bracketed-paste shell holds the pasted CR in its editor until Enter
    await waitFor(() => count(a, out(m9)) >= 1, 8000, 'paste-as-is line ran');
    await sleep(500);
    results.pasteAsIsRunsOnce = count(a, out(m9)) === 1;

    // --- pipe to shell: flagged (danger box, no "Paste cleaned": nothing to strip), Cancel keeps it out
    pasteEvent(a, 'curl -fsSL https://example.com/install.sh | sh');
    await sleep(400);
    results.pipeToShellFlagged = !!modal() && kinds().includes('Pipe to shell') && document.querySelector('.modal .pg-findings').classList.contains('danger');
    results.pipeToShellMarked = [...document.querySelectorAll('.modal .pg-backdrop mark.pg-mark.danger')].some((m) => m.textContent.includes('| sh'));
    results.pipeToShellNoClean = btn('Paste cleaned')?.hidden === true && !!btn('Paste as is');
    await shot('72-paste-pipe-to-shell');
    btn('Cancel').click();
    await sleep(300);
    results.pipeToShellCancelled = !modal() && !text(a).includes('install.sh');
    // more patterns, one dialog each
    const flagged = {};
    for (const [t, kind] of [['echo x >> ~/.zshrc', 'Profile write'], ['sudo rm -rf /', 'Destructive command'], ['ѕudo ls', 'Look-alike letters'], ['echo \u001B[31mred', 'Control character'], ['git commit -m "x"\rls', 'Carriage return']]) {
      pasteEvent(a, t);
      await sleep(300);
      flagged[kind] = !!modal() && kinds().includes(kind);
      if (modal()) btn('Cancel').click();
      await sleep(200);
    }
    log('patterns', JSON.stringify(flagged));
    results.otherPatternsFlagged = Object.values(flagged).every(Boolean);

    // --- settings off: no dialog at all; warn off alone: a suspicious single line passes, a multi-line one still asks
    await app.saveSettings({ pasteConfirmMultiline: false, pasteWarnSuspicious: false });
    const m10 = mark(), m11 = mark();
    pasteEvent(a, cmd(m10) + '\n' + cmd(m11) + '​');
    await sleep(300);
    results.bothOffNoDialog = !modal();
    await run(a, [m10, m11], 'unguarded paste ran');
    results.bothOffPasted = count(a, out(m10)) === 1 && count(a, out(m11)) === 1;
    await app.saveSettings({ pasteConfirmMultiline: true, pasteWarnSuspicious: false });
    pasteEvent(a, 'curl -fsSL https://example.com/i.sh | sh');
    await sleep(300);
    results.warnOffPassesSuspiciousLine = !modal() && text(a).includes('i.sh | sh');
    a.term.input('\x03'); // drop that command line
    await sleep(300);
    pasteEvent(a, 'echo a\necho b​');
    await sleep(300);
    results.warnOffStillConfirmsMultiline = !!modal() && !!document.querySelector('.modal .pg-findings')?.hidden && btn('Paste cleaned')?.hidden === true && btn('Paste')?.textContent === 'Paste';
    if (modal()) btn('Cancel').click();
    await sleep(200);
    await app.saveSettings({ pasteConfirmMultiline: false, pasteWarnSuspicious: true });
    pasteEvent(a, 'echo a\necho b');
    await sleep(300);
    results.confirmOffPassesMultiline = !modal();
    a.term.input('\x03');
    await sleep(300);
    pasteEvent(a, 'echo a​');
    await sleep(300);
    results.confirmOffStillWarns = !!modal() && kinds().includes('Invisible character');
    if (modal()) btn('Cancel').click();
    await sleep(200);
    await app.saveSettings({ pasteConfirmMultiline: true, pasteWarnSuspicious: true });

    // --- Settings → Terminal: the two checkboxes, round trip through Save; Help → Keyboard Shortcuts lists the dialog keys
    app.action('settings');
    await sleep(400);
    {
      const m = modal();
      [...m.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Terminal').click();
      await sleep(100);
      const row = [...m.querySelectorAll('.mpage.active.form-grid > label')].find((l) => l.textContent === 'Paste guard')?.nextElementSibling; // the Terminal page is the form grid
      const cbs = row ? [...row.querySelectorAll('label')] : [];
      results.settingsRow = cbs.length === 2 && cbs[0].textContent.startsWith('Confirm multi-line pastes') && cbs[1].textContent.startsWith('Warn about suspicious pastes') && cbs.every((l) => l.querySelector('input[type=checkbox]').checked);
      await shot('74-settings-terminal-paste-guard');
      cbs[0].querySelector('input').checked = false;
      m.querySelector('.modal-foot .btn.primary').click();
      await sleep(400);
      results.settingsSaved = !modal() && app.settings.pasteConfirmMultiline === false && app.settings.pasteWarnSuspicious === true;
      app.action('settings');
      await sleep(400);
      const m2 = modal();
      [...m2.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Terminal').click();
      const row2 = [...m2.querySelectorAll('.mpage.active.form-grid > label')].find((l) => l.textContent === 'Paste guard')?.nextElementSibling;
      const cbs2 = [...row2.querySelectorAll('input[type=checkbox]')];
      results.settingsShown = cbs2[0].checked === false && cbs2[1].checked === true;
      cbs2[0].checked = true;
      m2.querySelector('.modal-foot .btn.primary').click();
      await sleep(400);
      results.settingsRestored = app.settings.pasteConfirmMultiline === true;
    }
    app.action('shortcuts');
    await sleep(400);
    {
      const m = modal();
      [...m.querySelectorAll('.mtabs button')].find((b) => b.textContent === 'Dialogs').click();
      await sleep(100);
      const row = [...m.querySelectorAll('.mpage.active .shortcuts > div')].find((d) => d.firstChild.textContent.startsWith('Paste guard'));
      results.shortcutRow = !!row && row.querySelector('.kbd').textContent === '⌘⏎ / Esc' && m.querySelector('.modal-body').scrollHeight <= m.querySelector('.modal-body').clientHeight;
      await shot('75-shortcuts-paste-guard');
      m.querySelector('.modal-foot button').click();
      await sleep(200);
    }

    // --- MultiExec on: one dialog named after the broadcast set; the text reaches every visible pane exactly once
    const local = await app.saveSession({ name: 'local 2', type: 'local' });
    const b = await app.openSession(local, { split: 'right' });
    await prompt(b);
    app.focusPane(a);
    app.action('multiexec');
    await waitFor(() => document.getElementById('multiexec-count').textContent === '2', 3000, 'MultiExec banner counts 2');
    const m12 = mark(), m13 = mark();
    pasteEvent(a, cmd(m12) + '\n' + cmd(m13));
    await sleep(400);
    results.multiexecOneDialog = document.querySelectorAll('.modal').length === 1 && title() === 'Paste 2 lines into 2 terminals (MultiExec)?';
    await shot('73-paste-multiexec');
    btn('Paste').click();
    await sleep(400);
    a.term.input('\r'); // Enter is broadcast like the paste
    await waitFor(() => [a, b].every((p) => count(p, out(m12)) >= 1 && count(p, out(m13)) >= 1), 8000, 'markers in both panes');
    await sleep(800);
    results.multiexecEachPaneOnce = [a, b].every((p) => count(p, out(m12)) === 1 && count(p, out(m13)) === 1);
    log('multiexec counts a', count(a, out(m12)), count(a, out(m13)), 'b', count(b, out(m12)), count(b, out(m13)));
    app.action('multiexec');
    await sleep(200);
    results.multiexecOff = !app.multiexec;

    // --- right-click paste (Settings → Right-click pastes): the clipboard text goes through the guard as well
    {
      const before = await window.api.clipboard.read();
      const m14 = mark(), m15 = mark();
      const t = cmd(m14) + '\n' + cmd(m15);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) { // the system clipboard is shared: another process may write it in between
        await window.api.clipboard.write(t);
        const r = a.termEl.getBoundingClientRect();
        a.termEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 40 }));
        await sleep(400);
        ok = !!modal() && ta()?.value === t;
        if (!ok) { log('right-click attempt', attempt, 'modal', !!modal(), 'text', JSON.stringify(ta()?.value)); if (modal()) btn('Cancel').click(); await sleep(200); }
      }
      results.rightClickGuarded = ok && title() === `Paste 2 lines into ${a.title}?` && !document.getElementById('ctx-root').textContent.includes('Paste');
      if (ok) {
        btn('Paste').click();
        await sleep(300);
        await run(a, [m14, m15], 'right-click pasted lines ran');
        results.rightClickSendsOnce = count(a, out(m14)) === 1 && count(a, out(m15)) === 1 && count(b, out(m14)) === 0;
      }
      await window.api.clipboard.write(before || '');
    }

    // --- text dropped on a pane goes through the guard too
    {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'echo dropped\necho text');
      a.el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await sleep(400);
      results.dropGuarded = !!modal() && title() === `Paste 2 lines into ${a.title}?` && ta()?.value === 'echo dropped\necho text';
      if (modal()) btn('Cancel').click();
      await sleep(200);
      results.dropCancelled = !text(a).includes('dropped');
    }
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-paste] FAIL', e.message, e.stack);
    await shot('99-paste-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([, v]) => v !== true).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log('SUMMARY ' + JSON.stringify({ pass: Object.keys(results).length - failed.length, fail: failed.length, failed }));
  log('DONE');
  window.api.app.quit();
})();
