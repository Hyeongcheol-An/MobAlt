# QA harness: drive the real app, take screenshots

MobAlt can run with a renderer-side script injected and save screenshots of the real window.
Nothing here is compiled into releases; the hooks only exist while `MOBALT_TEST_SCRIPT` is set.

```bash
test/qa/run.sh <script.js> <out-dir> [auto-quit-ms]     # screenshots → <out-dir>/shots/*.png
MOBALT_APP_DIR=/path/to/checkout test/qa/run.sh ...      # run another checkout (e.g. a snapshot)
```

- `<out-dir>/userdata` is a fresh user-data folder (sessions/settings start empty), so your real
  sessions are never touched or shown.
- The script runs inside the renderer after the UI is ready. It must end with
  `window.api.app.quit()`; otherwise the app quits after `auto-quit-ms` (default 60 s) and writes
  `shots/final.png`.
- `console.log` output is echoed to the terminal prefixed with `[renderer:info]`.

## Renderer API available to scripts

```js
const app = window.app;                     // controller
await window.api.app.screenshot('name');    // → <out-dir>/shots/name.png (window capture)
await window.api.app.testResize(1000, 650); // resize the window (test mode only)
app.action('new-session' | 'new-local' | 'quick-connect' | 'duplicate' | 'reconnect' | 'disconnect' |
           'rename-tab' | 'close' | 'close-pane' | 'split' | 'split-menu' | 'layout' | 'unsplit' |
           'next-pane' | 'next-tab' | 'prev-tab' | 'zoom' | 'find' | 'find-close' | 'clear' |
           'toggle-sidebar' | 'sidebar' | 'multiexec' | 'tunnels' | 'toggle-log' | 'settings' |
           'new-folder' | 'import-sshconfig' | 'import-moba' | 'import-json' | 'export-json' | 'shortcuts', arg?)
app.showPanel('sessions' | 'sftp' | 'tools' | 'macros');
const s = await app.saveSession({ name, type: 'ssh'|'local'|'telnet'|'serial'|'rdp'|'vnc', folder, host, port, username, ... });
const pane = await app.openSession(s, { split: 'right'|'down', target: pane });
app.editSession(s);                         // opens the session editor on s
app.activePane(); pane.term (xterm.js); pane.status; pane.cwd; pane.disconnect(); pane.term.input('ls\r');
app.workspace.active (tab) / app.workspace.tabs / tab.panes()
app.applyLayout('2x2'); app.unsplit(); app.splitActive('right'|'down');
app.settings (object); await app.saveSettings({ theme: 'Solarized Dark', fontSize: 14, confirmClose: false });
app.toast('text');
await window.api.app.testDrag({ x, y }, { x, y });  // real drag between window coordinates (CDP)
```

DOM: toolbar `#toolbar`, sidebar `#sidebar` with `#session-tree`, `#session-filter`, panels
`#panel-sftp`, `#panel-tools`, `#panel-macros`, tabs `#tabs`, terminal area `#tab-content`,
status bar `#statusbar` (`#st-session`, `#st-cwd`), dialogs under `#modal-root` (`.modal`,
`.mtabs button`, `.close`), context menus under `#ctx-root`, toasts under `#toast-root`.
Terminal text: `[...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n')`.

## Local SSH server for real connections

```bash
test/start-sshd.sh start     # user-level sshd on 127.0.0.1:2222, key auth, SFTP, X11, forwarding
test/start-sshd.sh status
test/start-sshd.sh stop
```

Session shape for it (see `test/e2e-ssh.js` for a complete example):

```js
const user = app.info.home.split('/').pop();
const keyDir = app.info.appPath + '/test/sshd-runtime';
await app.saveSession({ name: 'local sshd', type: 'ssh', host: '127.0.0.1', port: 2222, username: user,
                        authMethod: 'key', privateKeyPath: keyDir + '/client_ed25519', sftpAuto: true });
```

The first connection shows the host-key prompt (`.modal` with an Accept button); `test/e2e-ssh.js`
shows how to accept it from a script.

## Writing a QA script

```js
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const app = window.app;
  const findings = [];
  try {
    await app.saveSettings({ confirmClose: false });
    app.action('new-session'); await sleep(400);
    await shot('01-session-editor');
    // inspect the DOM, record anything odd
    const overflow = [...document.querySelectorAll('.modal *')].filter((e) => e.scrollWidth > e.clientWidth + 2);
    if (overflow.length) findings.push({ severity: 'minor', where: 'session editor', what: `${overflow.length} clipped elements` });
    document.querySelector('.modal .close')?.click();
  } catch (e) {
    findings.push({ severity: 'blocker', where: 'script', what: e.message });
  }
  console.log('FINDINGS ' + JSON.stringify(findings));
  window.api.app.quit();
})();
```
