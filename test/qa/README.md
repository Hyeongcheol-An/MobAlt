# QA harness: drive the real app, take screenshots

MobAlt can run with a renderer-side script injected and save screenshots of the real window.
Nothing here is compiled into releases; the hooks only exist while `MOBALT_TEST_SCRIPT` is set.

```bash
test/qa/run.sh <script.js> <out-dir> [auto-quit-ms]     # screenshots → <out-dir>/shots/*.png
MOBALT_APP_DIR=/path/to/checkout test/qa/run.sh ...      # run another checkout (e.g. a snapshot)
```

- `<out-dir>/userdata` is a fresh user-data folder (sessions/settings start empty), so your real
  sessions are never touched or shown.
- The interface runs in English (`MOBALT_LANG=en`, whatever the Mac's language is) unless the command sets
  `MOBALT_LANG=<code>` (ko, zh-CN, ja, vi, hi, de, fr, es, pt, ar); a script can also switch at run time with
  `app.saveSettings({ language: 'ko' })` and read the native menu as shown with `window.api.app.testMenuLabels()`.
- The script runs inside the renderer after the UI is ready. It must end with
  `window.api.app.quit()`; otherwise the app quits after `auto-quit-ms` (default 60 s) and writes
  `shots/final.png`.
- `console.log` output is echoed to the terminal prefixed with `[renderer:info]`.
- `test/qa/docs-shots.js` makes the README screenshots and `test/qa/demo-frames.js` the frames of the README demo GIF
  (`npm run demo` runs it and `scripts/make-demo-gif.sh`); both need the FTP server from their headers, nothing personal
  appears in the images.
- `testKey(k)` sends keyDown/keyUp only (no char event), so the native Enter activation of a focused button cannot
  be driven with `testKey('Enter')`; use `testKey('Space')` (buttons activate on Space) or `el.click()`. Widgets with
  their own Enter handling (picker rows, lists, menus) do react to it. The object form
  `testKey({ keyCode: 'Enter', modifiers: ['shift'], char: '\r', windowId })` presses the key with modifiers and,
  with `char`, the character event a real press gives the browser (the keypress), in the main window or the one
  named — what a terminal pane sees from a user's Shift+Enter (test/e2e-claude-keys.js).
- `test/qa/claude-code-check.js` drives the real Claude Code CLI (`claude` on the login shell's PATH or in
  `~/.local/bin`, signed in): Shift+Enter as a newline in its composer and ⌘V with an image on the clipboard as
  `[Image #1]`, in a plain, split, zoomed and detached pane. It is a manual check, not an e2e suite (those never need
  the binary); it starts Claude Code in a fresh empty folder, answers the trust question and leaves with Ctrl+C, and it
  never submits a prompt (plain Enter is never pressed while the composer holds text).

## Renderer API available to scripts

```js
const app = window.app;                     // controller
await window.api.app.screenshot('name');    // → <out-dir>/shots/name.png (window capture)
await window.api.app.testResize(1000, 650); // resize the window (test mode only)
await window.api.app.testKey('F19');        // one real key press: raises the window, enables :focus-visible rings (test mode only)
await window.api.app.testKey({ keyCode: 'Enter', modifiers: ['shift'], char: '\r' }); // a real press with modifiers and its keypress; windowId for another window (test mode only)
await window.api.app.testPaste(windowId?);               // Edit → Paste: a real paste event with the system clipboard, text or image (test mode only)
await window.api.app.testClipboardPng(dataUrl, text?);   // a PNG on the clipboard, with text beside it or alone (test mode only)
await window.api.app.testDropFiles([path], { x, y }, windowId?); // files dropped at a window point as Finder drops them (test mode only)
await window.api.clipboard.kinds();                      // { text, image, formats }: what a paste would find on the clipboard
await window.api.app.testBundleUpdated('0.11.0'); // pretend that MobAlt version is on disk → the relaunch banner (test mode only)
(await window.api.app.testQuitCheck()).relaunchRequested; // true once the banner's Relaunch ran (test mode records, never restarts)
await window.api.app.testNotice('Internal error: x'); // a main-process notice (app:notice) → error toast (test mode only)
await window.api.app.testSilentListen(2213);            // → { port }: a TCP listener on 127.0.0.1 that accepts and never speaks — an SSH connection to it waits for the banner (test mode only)
window.api.app.bootChrome();                   // the chrome the preload put on <html> before the first paint ({ background, scheme, theme, vars }; no vars on a first launch)
window.api.app.testFirstFrames();              // the first 12 animation frames of this launch: [{ t, html, body, scheme }] (test mode only; see test/e2e-theme-boot.js)
await window.api.app.testNextDialog({ canceled: false, filePaths: ['/f'] }); // answer the next native file dialog / sheet instead of showing it (test mode only; see below)
(await window.api.app.testNextDialog()).pending;        // answers still queued (0 once every dialog you triggered has taken one)
await window.api.app.testWindows();                      // every window: [{ id, main, detached, title, bounds }] (test mode only; a detached tab opens a second one)
await window.api.app.testEval(id, 'window.app.workspace.tabs.length'); // run code in another window (its own window.app); the resolved value comes back
await window.api.app.testCloseWindow(id);                // close a window as its close button would (a detached window hands its tabs back first)
await window.api.app.testMenuState();                    // the native Session menu's tab items as enabled right now: { 'tab-pin': true, 'tab-close-left': false, … } (test mode only)
await window.api.app.testMenuLabels();                   // the application menu as shown: [{ label, submenu: [{ label, enabled, type? }] }] — labels follow the interface language (test mode only)
pane.webgl; pane.webglLosses; pane.visibleInTab();       // the WebGL budget (terminal.js): the addon while the pane is on screen (null = DOM renderer), context losses so far
// screenshot() captures the window it is called from: a detached window shoots itself through testEval (see test/e2e-detach.js)
app.action('new-session' | 'new-local' | 'quick-connect' | 'duplicate' | 'reconnect' | 'disconnect' |
           'rename-tab' | 'close' | 'close-pane' | 'split' | 'split-menu' | 'layout' | 'unsplit' |
           'next-pane' | 'next-tab' | 'prev-tab' | 'zoom' | 'zoom-pane' | 'find' | 'find-close' | 'clear' |
           'toggle-sidebar' | 'sidebar' | 'multiexec' | 'tunnels' | 'toggle-log' | 'settings' |
           'new-folder' | 'import-sshconfig' | 'import-moba' | 'import-json' | 'export-json' | 'shortcuts', arg?)
app.showPanel('sessions' | 'sftp' | 'tools' | 'macros');
const s = await app.saveSession({ name, type: 'ssh'|'local'|'telnet'|'serial'|'rdp'|'vnc', folder, host, port, username, ... });
const pane = await app.openSession(s, { split: 'right'|'down', target: pane });
app.editSession(s);                         // opens the session editor on s
app.activePane(); pane.term (xterm.js); pane.status; pane.cwd; pane.disconnect(); pane.term.input('ls\r');
app.workspace.active (tab) / app.workspace.tabs / tab.panes()
app.applyLayout('2x2'); app.unsplit('tabs'|'active'|'ask' /* default: Settings → Terminal → Unsplit */); app.splitActive('right'|'down');
app.settings (object); await app.saveSettings({ theme: 'solarized-dark', fontSize: 14, confirmClose: false }); // themes: moba-dark one-dark dracula solarized-dark gruvbox-dark light
import('./ui.js').then((ui) => ui.toast('text'));   // toasts live in ui.js, not on app
await window.api.app.testDrag({ x, y }, { x, y });  // real drag between window coordinates (CDP)
```

DOM: toolbar `#toolbar`, sidebar `#sidebar` with `#session-tree`, `#session-filter`, panels
`#panel-sftp`, `#panel-tools`, `#panel-macros`, tabs `#tabs`, terminal area `#tab-content`,
status bar `#statusbar` (`#st-session`, `#st-cwd`), dialogs under `#modal-root` (`.modal`,
`.mtabs button`, `.close`), context menus under `#ctx-root`, toasts under `#toast-root`.
Terminal text: `[...Array(pane.term.buffer.active.length)].map((_, i) => pane.term.buffer.active.getLine(i)?.translateToString(true)).join('\n')`.

## Native file dialogs and sheets

Open / save dialogs and message sheets cannot be driven headlessly, so every one in the main process goes
through `src/main/dialogs.js`: in test mode it answers from a queue first and only opens the real dialog
when the queue is empty. A script queues one answer per dialog it is about to trigger:

```js
await window.api.app.testNextDialog({ canceled: false, filePath: dir + '/sessions.json' }); // next showSaveDialog
await window.api.app.testNextDialog({ canceled: false, filePaths: [file1, file2] });        // next showOpenDialog
await window.api.app.testNextDialog({ response: 0 });                                       // next showMessageBox: button index
await window.api.app.testNextDialog({ canceled: true });                                     // Cancel / Esc, for any of them
(await window.api.app.testNextDialog()).pending;                                             // how many answers are still waiting
```

Answers are consumed in order by whatever opens next: Session → Export / Import Sessions (JSON), Import from
MobaXterm.ini, the session editor's private-key "Browse…" and a local session's Start folder "Browse…" (a folder
picker), the key generator's "Browse…" (a save dialog), the
SFTP panel's download-to / upload-from pickers, the renderer's `window.api.dialog.*` bridge and the updater's
sheets. An empty queue means the real dialog
opens and a headless run hangs on it, so queue exactly one answer per dialog and check that `pending` is 0
afterwards (a leftover answer would be eaten by the next dialog). The main process logs every canned answer as
`[test] dialog answered without showing: <kind> "<title>" ← {...}`. `test/e2e-import-export.js` covers all of
these paths (export / import JSON, `test/fixtures/mobaxterm-sample.ini`, key picker, SFTP pickers, each cancel
path) and needs the local sshd below.

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
