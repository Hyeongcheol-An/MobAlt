// Produces the frames of the README demo (docs/images/demo.gif). Like docs-shots.js it runs in a fresh user-data
// folder with made-up sessions, local shells whose prompt is overridden (neutral cwd, "demo@<host>", fake commands)
// and an FTP session against test/ftpd.py — nothing personal ends up in a frame: the launch shell (it shows the real
// prompt) is closed before the first capture and every frame is checked for the real user name / home folder first.
//   uv run --with pyftpdlib python3 test/ftpd.py <scratch-root> 2121 demo demo &   # a root with a few folders and files
//   test/qa/run.sh test/qa/demo-frames.js <out-dir> 120000   # → <out-dir>/shots/fNNN-<phase>-<hold>.png
//   bash scripts/make-demo-gif.sh <out-dir>/shots            # → docs/images/demo.gif   (npm run demo does both)
// Keep the MobAlt window in front while it runs (a covered window is drawn lazily, see shot()).
// A frame name carries its place in the story: f012-sftp-200.png is frame 12, in the "sftp" phase (the caption
// make-demo-gif.sh burns in), shown for 200 cs. Typing frames hold ~16–20 cs, scene frames 110–320 cs.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  const log = (...a) => console.log('[demo-frames]', ...a);
  const findings = [];
  const HOME = app.info.home || '', USER = HOME.split('/').pop() || '';
  let n = 0;

  // the rows a pane shows on screen (not the scrollback): what a frame can contain
  const screenText = (p) => {
    const b = p.term.buffer.active, top = b.viewportY;
    return [...Array(p.term.rows)].map((_, i) => b.getLine(top + i)?.translateToString(true) || '').join('\n');
  };
  const leaks = () => {
    const texts = [document.body.innerText || '', ...app.workspace.allPanes().filter((p) => p.term).map(screenText)];
    return [HOME, USER].filter((s) => s && texts.some((t) => t.includes(s)));
  };
  const painted = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // macOS draws a covered window lazily: the page reports itself hidden, a capture then returns the frame drawn for
  // the previous capture, and a fully covered window can make capturePage hang. Keep MobAlt in front while this
  // runs; a throw-away capture before the real one (three when the page is hidden) evens out the lag of a partly
  // covered window.
  const shot = async (phase, hold) => {
    const name = `f${String(++n).padStart(3, '0')}-${phase}-${hold}`;
    const hidden = document.visibilityState !== 'visible';
    if (hidden) findings.push({ severity: 'major', where: name, what: 'window covered while capturing — the frame may be stale' });
    const bad = leaks();
    if (bad.length) findings.push({ severity: 'blocker', where: name, what: `personal data on screen: ${bad.join(', ')}` });
    await painted();
    for (let i = 0; i < (hidden ? 3 : 1); i++) await window.api.app.screenshot('warm-up');
    await window.api.app.screenshot(name);
  };
  const waitFor = async (fn, what, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      await sleep(80);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const noToasts = () => waitFor(() => !document.querySelector('#toast-root')?.children.length, 'toasts to expire', 6000);
  // A real :hover. The pointer is pressed on the status bar (nothing reacts there and body has user-select: none),
  // moved onto `el` and released: no drag starts, and the pointer then rests over the row. park() takes it back.
  const statusbarPoint = () => {
    const r = document.getElementById('statusbar').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };
  const hover = async (el) => {
    const r = el.getBoundingClientRect();
    const to = { x: Math.round(r.left + Math.min(90, r.width / 2)), y: Math.round(r.top + r.height / 2) };
    const from = { x: to.x, y: statusbarPoint().y };
    if (!document.elementFromPoint(from.x, from.y)?.closest('#statusbar')) findings.push({ severity: 'minor', where: 'hover', what: 'pointer origin is not on the status bar' });
    await window.api.app.testDrag(from, to);
    await sleep(200);
  };
  const park = async () => {
    const p = statusbarPoint();
    await window.api.app.testDrag(p, p);
    await sleep(150);
  };
  // type into a pane as a user would: each character goes through the terminal's input path, so MultiExec sees it
  const type = async (pane, text, phase, every, hold) => {
    for (let i = 0; i < text.length; i++) {
      pane.term.input(text[i]);
      await sleep(55);
      if ((i + 1) % every === 0 || i === text.length - 1) await shot(phase, hold);
    }
  };
  // a neutral cwd (the status bar shows the active pane's folder), a demo prompt, fake commands, then a clean screen
  const SHELL = (host, fns) => `cd /Users/Shared 2>/dev/null && export HOME=/Users/Shared || cd /tmp; export PS1='demo@${host}:%~$ '; export PROMPT='demo@${host}:%~$ '; ${fns}; clear`;
  const NGINX = "systemctl() { printf '\\e[32m●\\e[0m nginx.service - nginx web server\\n   Loaded: loaded (nginx.service; enabled)\\n   Active: \\e[32mactive (running)\\e[0m since 09:12\\n Main PID: 1182 (nginx)\\n    Tasks: 5 (limit: 9389)\\n   Memory: 12.4M\\n'; }";
  const UPTIME = (days, load) => `uptime() { printf ' up ${days} days,  load average: ${load}\\n'; }`;
  const clean = (p, host) => {
    const t = screenText(p).trim();
    return t.startsWith(`demo@${host}:~$`) && t.split('\n').filter(Boolean).length === 1 && !t.includes(USER);
  };
  const row = (name) => document.querySelector(`#session-tree .tree-row[data-session="${app.sessions.sessions.find((s) => s.name === name).id}"]`);

  try {
    await window.api.app.testResize(1100, 700);
    await app.saveSettings({ confirmClose: false, restoreWorkspace: false, sftpAutoOpen: true, fontSize: 14 });

    // --- a believable session tree (nothing connects to these hosts)
    const mk = (o) => app.saveSession({ type: 'ssh', port: 22, authMethod: 'auto', sftpAuto: true, ...o });
    await mk({ name: 'web-01', folder: 'Production', host: 'web-01.example.com', username: 'deploy', icon: '🌐', color: '#4ea1ff' });
    await mk({ name: 'web-02', folder: 'Production', host: 'web-02.example.com', username: 'deploy', icon: '🌐', color: '#4ea1ff' });
    await mk({ name: 'db-01', folder: 'Production', host: 'db-01.example.com', username: 'postgres', icon: '🗄️', color: '#e6b422' });
    await mk({ name: 'bastion', folder: 'Production', host: 'bastion.example.com', username: 'ops', icon: '🔒', color: '#e5534b' });
    await mk({ name: 'gpu-box', folder: 'Lab', host: '10.0.0.42', username: 'ml', icon: '🚀', color: '#bd93f9', x11: true });
    await mk({ name: 'raspberry', folder: 'Lab', host: 'raspberrypi.local', username: 'pi', icon: '🐧', color: '#4caf50' });
    await app.saveSession({ name: 'router console', folder: 'Lab', type: 'serial', serialPath: '/dev/tty.usbserial-0001', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flow: 'none', icon: '⚙️' });
    await app.saveSession({ name: 'nas', folder: 'Home', type: 'ftp', host: 'nas.local', username: 'admin', icon: '📦', color: '#2fbfa7' });
    await app.saveSession({ name: 'win-desktop', folder: 'Home', type: 'rdp', host: 'desktop.local', username: 'me', icon: '🪟' });
    await app.saveSession({ name: 'Project shell', type: 'local', cwd: '/tmp', icon: '🤖', color: '#7a7dff' });

    // the launch shell shows the real prompt: it never appears in a frame
    for (const t of [...app.workspace.tabs]) await app.closeTab(t);
    app.showPanel('sessions');
    await sleep(500);

    // 1. session tree: folders, a hovered row
    await shot('sessions', 180);
    await hover(row('web-01'));
    await shot('sessions', 130);
    await hover(row('db-01'));
    await shot('sessions', 130);
    await park();

    // 2. a "remote" shell (local shell with the demo prompt), a command typed character by character
    const a = await app.openSession({ name: 'web-01', type: 'local', icon: '🌐', color: '#4ea1ff', startupCommand: SHELL('web-01', `${NGINX}; ${UPTIME('41', '0.72, 0.80, 0.91')}`) });
    await waitFor(() => clean(a, 'web-01'), 'the web-01 prompt');
    await sleep(400);
    await shot('shell', 140);
    await type(a, 'systemctl status nginx', 'shell', 2, 16);
    a.term.input('\r');
    await waitFor(() => screenText(a).includes('Main PID'), 'the nginx status');
    await sleep(300);
    await shot('shell', 260);

    // 3. FTP session → the file browser panel (what the SFTP panel looks like), browse a folder
    const ftp = await app.openSession({ name: 'nas', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'demo', password: 'demo', icon: '📦', color: '#2fbfa7', sftpAuto: true });
    const sftp = app.sftpPanel;
    await waitFor(() => sftp.rowFor('docs'), 'the FTP listing');
    await sleep(500);
    await shot('sftp', 180);
    await hover(sftp.rowFor('docs'));
    await shot('sftp', 110);
    await sftp.open(sftp.visibleEntries().find((e) => e.name === 'docs'));
    await waitFor(() => sftp.rowFor('notes.md'), 'the docs/ listing');
    await park();
    await sleep(300);
    await shot('sftp', 200);
    await sftp.cmd('up');
    await waitFor(() => sftp.rowFor('docs'), 'the root listing again');
    await sleep(250);
    await shot('sftp', 100);
    await app.closeTab(ftp.tab);
    app.showPanel('sessions');
    await noToasts();

    // 4. split right, a second shell, MultiExec: one command lands in both panes
    const b = await app.openSession({ name: 'db-01', type: 'local', icon: '🗄️', color: '#e6b422', startupCommand: SHELL('db-01', UPTIME('87', '1.24, 1.08, 0.97')) }, { split: 'right', target: a });
    await waitFor(() => clean(b, 'db-01'), 'the db-01 prompt');
    await sleep(400);
    await shot('split', 200);
    app.action('multiexec');
    await sleep(350);
    await shot('multiexec', 200);
    a.focus();
    await type(a, 'uptime', 'multiexec', 2, 20);
    a.term.input('\r');
    await waitFor(() => screenText(a).includes('load average') && screenText(b).includes('load average'), 'uptime in both panes');
    await sleep(300);
    await shot('multiexec', 280);
    app.action('multiexec');
    await sleep(350);
    await shot('multiexec', 120);
    await noToasts();

    // 5. ⇧⌘⏎: the pane fills the tab, then the layout comes back
    app.action('zoom-pane', undefined, a);
    await sleep(400);
    await shot('zoom', 200);
    app.action('zoom-pane', undefined, a);
    await sleep(400);
    await shot('zoom', 160);

    // 6. themes colour the whole window
    await app.saveSettings({ theme: 'light' });
    await sleep(600);
    await shot('theme', 200);
    await app.saveSettings({ theme: 'moba-dark' });
    await sleep(600);
    await shot('theme', 140);

    // 7. the hero view
    await noToasts();
    await shot('end', 300);
    log(`DONE ${n} frames`);
  } catch (e) {
    findings.push({ severity: 'blocker', where: 'script', what: e.message });
    console.error('[demo-frames] FAIL', e.message, e.stack);
  }
  console.log('FINDINGS ' + JSON.stringify(findings));
  window.api.app.quit();
})();
