// Keyword highlighting in the terminal (Settings → Terminal → Keyword highlighting): decorations appear on the lines a
// local shell prints with the theme-derived colours, in Moba Dark and Light; disabling removes them; a session's own
// override; a rule added through the settings table applies live; an invalid regex is skipped with a toast; ⌘K
// disposes; 2000-line bursts stay within the budget with a bounded decoration count; find highlights and the mouse
// selection still work on top. No SSH server needed.
//   test/qa/run.sh test/e2e-highlight.js <out-dir> 150000
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const log = (...a) => console.log('[e2e-highlight]', ...a);
  const app = window.app;
  const results = {};
  const text = (pane) => [...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n');
  const waitFor = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(80);
    }
    throw new Error('timeout: ' + what);
  };
  const run = async (pane, cmd, until, ms = 15000) => {
    const t0 = performance.now();
    pane.term.input(cmd + '\r');
    await waitFor(() => text(pane).includes(until), ms, `output "${until}" of ${cmd}`);
    return performance.now() - t0;
  };
  const khEls = (pane) => [...pane.el.querySelectorAll('.xterm-decoration.kh')].filter((e) => e.style.display !== 'none'); // bold / underlined ones carry the class
  const decoEls = (pane) => [...pane.el.querySelectorAll('.xterm-decoration')].filter((e) => e.style.display !== 'none'); // every decoration on screen (no find open)
  // the find bar's highlights are decorations too, indistinguishable in the DOM: the keyword ones on screen are counted from the highlighter's records
  const ourVisible = (pane) => { const b = pane.term.buffer.active; return liveRows(pane).filter((r) => !r.marker.isDisposed && r.marker.line >= b.viewportY && r.marker.line < b.viewportY + pane.term.rows).reduce((n, r) => n + r.decos.length, 0); };
  const findEls = (pane) => Math.max(0, decoEls(pane).length - ourVisible(pane));
  const liveRows = (pane) => pane.highlighter.rows.filter((r) => !r.dead);
  const matchesOf = (pane, rowText) => (liveRows(pane).find((r) => r.text.includes(rowText) && !r.text.includes('printf')) || { matches: [] }).matches.map((m) => `${m.rule.color}:${m.text}`);
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const hl = await import('./highlight.js');
  const th = await import('./theme.js');
  const closeTop = () => [...document.querySelectorAll('.modal')].pop()?.querySelector('.modal-foot .btn')?.click(); // Cancel of the top-most dialog
  try {
    await app.saveSettings({ confirmClose: false, theme: 'moba-dark', highlightEnabled: true, highlightRules: null });
    await window.api.app.testResize(1100, 700);
    await sleep(200);

    // --- a local shell prints the sample lines: every category gets its decoration, coloured from the theme
    const pane = await app.newLocalTab();
    await waitFor(() => pane.status === 'connected', 8000, 'local shell');
    await sleep(900);
    results.highlighterWired = !!pane.highlighter && pane.highlighter.enabled === true && pane.highlighter.compiled.length === 6;
    const sample = [
      'ERROR: disk failed on node-3', 'WARN: option --fast is deprecated', 'OK: service active (running), job done',
      'peer 10.0.0.1:22 and fe80::1 reachable', 'docs: https://example.com/guide?x=1', 'used 512M of 3.2GB in 200ms (45%)',
    ];
    await run(pane, `echo ${btoa(sample.join('\n') + '\n')} | base64 -d`, '(45%)'); // the echoed command carries no keyword
    await sleep(500);
    results.sampleDecorations = {
      error: matchesOf(pane, 'disk failed'), warn: matchesOf(pane, 'is deprecated'), ok: matchesOf(pane, 'job done'),
      ip: matchesOf(pane, 'reachable'), url: matchesOf(pane, 'docs:'), units: matchesOf(pane, 'of 3.2GB'),
    };
    log('sample decorations', JSON.stringify(results.sampleDecorations));
    results.sampleMatched = JSON.stringify(results.sampleDecorations) === JSON.stringify({
      error: ['red:ERROR', 'red:failed'], warn: ['yellow:WARN', 'yellow:deprecated'], ok: ['green:OK', 'green:active (running)', 'green:done'],
      ip: ['blue:10.0.0.1:22', 'blue:fe80::1'], url: ['accent:https://example.com/guide?x=1'], units: ['accent-dim:512M', 'accent-dim:3.2GB', 'accent-dim:200ms', 'accent-dim:45%'],
    });
    const dark = hl.highlightPalette(th.THEMES['moba-dark']);
    const els = khEls(pane);
    const boldError = els.find((e) => e.classList.contains('kh-bold') && e.textContent === 'ERROR');
    const url = els.find((e) => e.classList.contains('kh-ul'));
    results.domDecorations = decoEls(pane).length;
    results.boldErrorRed = !!boldError && getComputedStyle(boldError).color === rgb(dark.red) && getComputedStyle(boldError).fontWeight === '700' && getComputedStyle(boldError).pointerEvents === 'none';
    results.urlUnderlinedAccent = !!url && url.style.getPropertyValue('--kh-fg') === dark.accent && getComputedStyle(url).boxShadow !== 'none';
    results.coloursReadOnDark = Object.values(results.sampleDecorations).flat().every((m) => th.contrast(dark[m.split(':')[0]], th.THEMES['moba-dark'].background) >= 4.5);
    await shot('01-highlight-moba-dark');

    // --- the light theme recolours every decoration from its own palette
    await app.saveSettings({ theme: 'light' });
    await sleep(500);
    const light = hl.highlightPalette(th.THEMES.light);
    const lightBold = khEls(pane).find((e) => e.classList.contains('kh-bold') && e.textContent === 'ERROR');
    results.lightRecoloured = !!lightBold && getComputedStyle(lightBold).color === rgb(light.red) && light.red !== dark.red && matchesOf(pane, 'disk failed').length === 2;
    results.coloursReadOnLight = Object.keys(dark).filter((k) => hl.COLOR_KEYS.some(([c]) => c === k)).every((k) => th.contrast(light[k], '#ffffff') >= 4.5);
    await shot('02-highlight-light');
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(400);

    // --- disabling removes every decoration; enabling brings them back (the bottom of the buffer is rescanned)
    await app.saveSettings({ highlightEnabled: false });
    await sleep(300);
    results.disabledRemoves = pane.highlighter.count === 0 && decoEls(pane).length === 0 && pane.highlighter.enabled === false;
    await app.saveSettings({ highlightEnabled: true });
    await sleep(300);
    results.enabledRestores = pane.highlighter.count > 0 && decoEls(pane).length === results.domDecorations;

    // --- per-session override: "off" in a session while the global switch is on, "on" while it is off; edits apply live
    const sOff = await app.saveSession({ name: 'no highlight', type: 'local', cwd: '/tmp', highlight: 'off' });
    const pOff = await app.openSession(sOff);
    await waitFor(() => pOff.status === 'connected', 8000, 'session off');
    await sleep(700);
    await run(pOff, "printf 'ERROR one\\n'", 'ERROR one');
    await sleep(300);
    results.sessionOff = pOff.highlighter.enabled === false && pOff.highlighter.count === 0 && decoEls(pOff).length === 0;
    await app.saveSession({ ...sOff, highlight: 'on' }); // the open pane takes the new override at once
    await sleep(300);
    results.sessionEditAppliesLive = pOff.highlighter.enabled === true && matchesOf(pOff, 'ERROR one').includes('red:ERROR');
    await app.saveSettings({ highlightEnabled: false });
    await sleep(300);
    results.sessionOnBeatsGlobalOff = pOff.highlighter.enabled === true && pOff.highlighter.count > 0 && pane.highlighter.enabled === false;
    await app.saveSettings({ highlightEnabled: true });
    await sleep(300);
    await app.closeTab(pOff.tab);
    await app.deleteSession(sOff.id);
    app.focusPane(pane);

    // --- the session editor offers the override on its Terminal tab
    app.action('new-session');
    await sleep(300);
    {
      const m = document.querySelector('.modal');
      m.querySelectorAll('.mtabs button')[2].click();
      await sleep(100);
      const sel = [...m.querySelectorAll('.mpage.active .form-grid > label, .mpage.active > label')].find((l) => l.textContent === 'Keyword highlighting')?.nextElementSibling;
      results.editorOverrideField = !!sel && sel.tagName === 'SELECT' && [...sel.options].map((o) => o.value).join('|') === '|on|off';
      m.querySelector('.close').click();
      await sleep(200);
      document.querySelector('.modal.narrow .btn.primary')?.click(); // a discard prompt, if any
      await sleep(200);
    }

    // --- a custom rule added through the settings table applies live; an invalid regex is refused there
    app.action('settings');
    await sleep(400);
    {
      const m = document.querySelector('.modal');
      m.querySelectorAll('.mtabs button')[1].click(); // Terminal
      await sleep(100);
      const row = [...m.querySelectorAll('.mpage.active > label')].find((l) => l.textContent === 'Keyword highlighting')?.nextElementSibling;
      const cb = row?.querySelector('input[type=checkbox]'), btn = [...(row?.querySelectorAll('button') || [])].find((b) => b.textContent === 'Rules…');
      results.settingsRow = !!cb && cb.checked && !!btn && row.closest('.mpage.active') !== null;
      btn.click();
      await sleep(300);
      const rules = [...document.querySelectorAll('.modal')].pop();
      results.rulesDialogOpened = document.querySelectorAll('.modal').length === 2 && rules.querySelectorAll('.hl-rules tbody tr').length === 6;
      await shot('03-rules-dialog');
      [...rules.querySelectorAll('button')].find((b) => b.textContent.includes('Add rule')).click();
      await sleep(100);
      const tr = rules.querySelectorAll('.hl-rules tbody tr')[6];
      results.addRuleFocusesPattern = document.activeElement === tr.querySelector('input[type=text]');
      const pat = tr.querySelector('input[type=text]');
      pat.value = 'banana';
      pat.dispatchEvent(new Event('input', { bubbles: true }));
      const colour = tr.querySelectorAll('select')[0];
      colour.value = 'magenta';
      colour.dispatchEvent(new Event('change', { bubbles: true }));
      tr.querySelectorAll('input[type=checkbox]')[1].click(); // ignore case
      rules.querySelector('.modal-foot .btn.primary').click(); // OK
      await sleep(200);
      results.rulesDialogClosed = document.querySelectorAll('.modal').length === 1;
      m.querySelector('.modal-foot .btn.primary').click(); // Save
      await sleep(500);
      results.customRuleSaved = !document.querySelector('.modal') && app.settings.highlightRules?.length === 7 && app.settings.highlightRules[6].pattern === 'banana' && app.settings.highlightRules[6].ci === true && app.settings.highlightRules[6].color === 'magenta';
      await run(pane, "printf 'a BANANA split\\n'", 'BANANA split');
      await sleep(300);
      results.customRuleLive = matchesOf(pane, 'BANANA split').includes('magenta:BANANA') && pane.highlighter.compiled.length === 7;
      await shot('04-custom-rule');
      // an invalid regex cannot be saved from the table: a toast, the dialog stays, the pattern keeps the focus
      app.action('settings');
      await sleep(300);
      document.querySelectorAll('.modal .mtabs button')[1].click();
      await sleep(80);
      [...document.querySelectorAll('.modal .mpage.active button')].find((b) => b.textContent === 'Rules…').click();
      await sleep(250);
      const rules2 = [...document.querySelectorAll('.modal')].pop();
      [...rules2.querySelectorAll('button')].find((b) => b.textContent.includes('Add rule')).click();
      await sleep(80);
      const tr2 = [...rules2.querySelectorAll('.hl-rules tbody tr')].pop();
      tr2.querySelector('input[type=text]').value = '(';
      tr2.querySelector('input[type=text]').dispatchEvent(new Event('input', { bubbles: true }));
      tr2.querySelectorAll('input[type=checkbox]')[0].click(); // regex
      rules2.querySelector('.modal-foot .btn.primary').click();
      await sleep(200);
      results.invalidRegexRefused = document.querySelectorAll('.modal').length === 2 && document.getElementById('toast-root').textContent.includes('not a valid regular expression') && document.activeElement === tr2.querySelector('input[type=text]');
      // Restore defaults brings the six built-in rows back
      [...rules2.querySelectorAll('button')].find((b) => b.textContent === 'Restore defaults').click();
      await sleep(80);
      results.restoreDefaults = rules2.querySelectorAll('.hl-rules tbody tr').length === 6;
      rules2.querySelector('.modal-foot .btn.primary').click(); // OK (defaults → stored as null)
      await sleep(150);
      document.querySelector('.modal .modal-foot .btn.primary').click(); // Save
      await sleep(400);
      results.defaultsStoredAsNull = app.settings.highlightRules === null && pane.highlighter.compiled.length === 6;
    }
    // --- a stored rule that does not compile is skipped with a toast; the others keep working; nothing throws
    document.getElementById('toast-root').replaceChildren();
    await app.saveSettings({ highlightRules: [{ pattern: '(', regex: true, color: 'red' }, { pattern: 'kiwi', color: 'cyan', bg: 'cyan' }] });
    await sleep(300);
    await run(pane, "printf 'ripe kiwi here\\n'", 'kiwi here');
    await sleep(300);
    results.invalidRuleSkippedWithToast = document.getElementById('toast-root').textContent.includes('is not a valid regex') && pane.highlighter.compiled.length === 1 && !pane.highlighter.failed && matchesOf(pane, 'kiwi here').includes('cyan:kiwi');
    await app.saveSettings({ highlightRules: null });
    await sleep(300);

    // --- ⌘K disposes everything
    app.focusPane(pane);
    app.action('clear');
    await sleep(300);
    results.clearDisposes = pane.highlighter.count === 0 && decoEls(pane).length === 0 && liveRows(pane).length === 0 && pane.term.buffer.active.length <= pane.term.rows;
    await run(pane, "printf 'after clear: ERROR\\n'", 'after clear');
    await sleep(300);
    results.afterClearWorks = matchesOf(pane, 'after clear').includes('red:ERROR');

    // --- performance: 2000 plain lines, then 2000 lines with three matches each; the scan stays within 2 ms / 100 rows,
    //     the decoration count is bounded, nothing leaks
    const st0 = { ...pane.highlighter.stats };
    const plainMs = await run(pane, 'seq 1 2000', '\n2000', 20000);
    await sleep(400);
    const st1 = { ...pane.highlighter.stats };
    results.perfPlain = { rows: st1.rows - st0.rows, scanMs: +(st1.ms - st0.ms).toFixed(2), msPer100: +(((st1.ms - st0.ms) / Math.max(1, st1.rows - st0.rows)) * 100).toFixed(3), wallMs: Math.round(plainMs) };
    const busyMs = await run(pane, 'seq 1 2000 | sed "s/$/ ERROR at 10.0.0.1 took 512MB/"', '\n2000 ERROR', 20000);
    await sleep(500);
    const st2 = { ...pane.highlighter.stats };
    results.perfBusy = { rows: st2.rows - st1.rows, scanMs: +(st2.ms - st1.ms).toFixed(2), msPer100: +(((st2.ms - st1.ms) / Math.max(1, st2.rows - st1.rows)) * 100).toFixed(3), wallMs: Math.round(busyMs), decorations: pane.highlighter.count, rows: liveRows(pane).length, domEls: pane.el.querySelectorAll('.xterm-decoration').length };
    await app.saveSettings({ highlightEnabled: false });
    await sleep(300);
    const offMs = await run(pane, 'seq 1 2000 | sed "s/$/ ERROR at 10.0.0.1 took 512MB/"', '\n2000 ERROR', 20000);
    await app.saveSettings({ highlightEnabled: true });
    await sleep(600);
    results.perfBusy.wallMsHighlightOff = Math.round(offMs);
    log('perf', JSON.stringify({ plain: results.perfPlain, busy: results.perfBusy }));
    results.perfWithinBudget = results.perfPlain.msPer100 <= 2 && results.perfBusy.msPer100 <= 2 && results.perfPlain.rows >= 2000 && results.perfBusy.rows * 3 >= results.perfBusy.decorations && results.perfBusy.decorations >= hl.MAX_DECORATIONS * 0.8;
    results.decorationsBounded = results.perfBusy.decorations <= hl.MAX_DECORATIONS && results.perfBusy.rows <= hl.MAX_DECORATIONS && results.perfBusy.domEls <= hl.MAX_DECORATIONS
      && pane.highlighter.count <= hl.MAX_DECORATIONS && pane.highlighter.count > 0;
    results.visibleRowsHighlighted = (() => { // every row on screen with the pattern carries its three decorations
      const buf = pane.term.buffer.active, rows = liveRows(pane);
      let shown = 0, decorated = 0;
      for (let y = buf.viewportY; y < buf.viewportY + pane.term.rows; y++) {
        const t = buf.getLine(y)?.translateToString(true) || '';
        if (!/^\d+ ERROR at/.test(t)) continue;
        shown++;
        if (rows.some((r) => !r.marker.isDisposed && r.marker.line === y && r.matches.length === 3)) decorated++;
      }
      return shown > 10 && shown === decorated;
    })();
    await shot('05-burst-2000-lines');

    // --- find highlights sit on top of the keyword decorations; the counter works (a short buffer: the search addon
    //     decorates its first 1000 matches, which in a 6000-row buffer would all be far above the viewport)
    app.action('clear');
    await sleep(200);
    await run(pane, 'seq 1 20 | sed "s/$/ ERROR at 10.0.0.1 took 512MB/"', '\n20 ERROR', 20000);
    await sleep(400);
    app.action('find');
    const fi = document.getElementById('find-input');
    fi.value = 'ERROR';
    fi.dispatchEvent(new Event('input'));
    await sleep(500);
    const count = document.getElementById('find-count').textContent;
    pane.term.scrollToBottom(); // the first match is at the top of the buffer, whose rows lost their decorations to the cap
    await sleep(300);
    results.findWithHighlights = /^\d+ \/ \d+$/.test(count.trim()) && findEls(pane) > 0 && khEls(pane).length > 0 && ourVisible(pane) > 0;
    log('find count with highlights', count, 'search decorations', findEls(pane), 'keyword decorations', ourVisible(pane), 'of which bold/underlined', khEls(pane).length);
    await shot('06-find-with-highlights');
    app.action('find-close');
    await sleep(500);
    log('after find-close: search decorations', findEls(pane), 'keyword', ourVisible(pane), 'all elements', decoEls(pane).length);
    results.findCloseKeepsHighlights = findEls(pane) === 0 && khEls(pane).length > 0 && decoEls(pane).length === ourVisible(pane);

    // --- the mouse still selects text through the decorations (they take no pointer events)
    {
      // drag across the row that reads "7 ERROR at 10.0.0.1 took 512MB" (cells 0 … 24), through its three decorations
      const buf = pane.term.buffer.active, screen = pane.el.querySelector('.xterm-screen').getBoundingClientRect();
      const cw = screen.width / pane.term.cols, ch = screen.height / pane.term.rows;
      let y = -1;
      for (let i = buf.viewportY; i < buf.viewportY + pane.term.rows; i++) if (/^7 ERROR at/.test(buf.getLine(i)?.translateToString(true) || '')) { y = i - buf.viewportY; break; }
      const py = screen.top + (y + 0.5) * ch;
      await window.api.app.testDrag({ x: screen.left + 0.3 * cw, y: py }, { x: screen.left + 24.7 * cw, y: py });
      await sleep(300);
      const sel = pane.term.getSelection();
      results.selectionThroughDecorations = y >= 0 && pane.term.hasSelection() && /^7 ERROR at 10\.0\.0\.1 took/.test(sel);
      log('selection on row', y, JSON.stringify(sel.slice(0, 60)));
      pane.term.clearSelection();
    }

    // --- a wrapped long line and a wide-character line place their decorations on the right cells
    await run(pane, `printf '${'x'.repeat(pane.term.cols - 4)} ERROR tail\\n'`, 'OR tail'); // "…x ERR" | "OR tail" (a word boundary before ERROR)
    await sleep(300);
    {
      // "ERROR" starts 3 cells before the right edge: "ERR" on the first row, "OR" on the wrapped one — one decoration per row
      const cols = pane.term.cols;
      const rows = liveRows(pane).filter((r) => (r.text === 'OR tail' || r.text.startsWith('x'.repeat(20))) && !r.text.includes('printf'));
      const first = rows.find((r) => r.matches.some((m) => m.x === cols - 3 && m.width === 3));
      const second = rows.find((r) => r.matches.some((m) => m.x === 0 && m.width === 2));
      log('wrapped line rows', cols, JSON.stringify(rows.map((r) => [r.text.slice(-14), r.marker.line, r.matches.map((m) => [m.x, m.width, m.text])])), 'tail of buffer', JSON.stringify(text(pane).split('\n').slice(-4).map((t) => t.slice(-30))), 'count', pane.highlighter.count);
      results.wrappedLine = !!first && !!second && first !== second && rows.every((r) => r.matches.every((m) => m.x >= 0 && m.x + m.width <= cols));
    }
    await run(pane, "printf '한글 테스트 ERROR 끝\\n'", 'ERROR 끝');
    await sleep(300);
    {
      const rec = liveRows(pane).find((r) => r.text.includes('한글 테스트 ERROR') && !r.text.includes('printf'));
      const m = rec?.matches.find((x) => x.text === 'ERROR');
      results.wideCharColumns = !!m && m.x === 12 && m.width === 5; // 한글(4 cells) + space + 테스트(6 cells) + space = 12
    }

    // --- disposing the pane disposes the highlighter
    const hlRef = pane.highlighter;
    await app.closeTab(pane.tab);
    await sleep(200);
    results.disposed = hlRef.disposed === true && hlRef.count === 0 && hlRef.rows.length === 0;
  } catch (e) {
    results.error = e.message;
    console.error('[e2e-highlight] FAIL', e.message, e.stack);
    await shot('99-highlight-fail').catch(() => {});
  }
  const failed = Object.entries(results).filter(([k, v]) => v === false).map(([k]) => k);
  log('RESULTS ' + JSON.stringify(results));
  log(failed.length ? 'FAILED ' + failed.join(', ') : 'ALL PASSED');
  log('DONE');
  window.api.app.quit();
})();
