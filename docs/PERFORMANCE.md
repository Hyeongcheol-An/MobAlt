# Performance

What MobAlt costs to start, to leave open, to keep many panes in, and to download — measured, with the numbers before
and after the round that added the measurements (0.15.2, November 2026, Apple M2 Max, macOS 27, Electron 45), what was
changed on the strength of them, and what was measured and left alone.

## Running the measurements

```bash
npm run pack:qa              # the packaged columns need dist-qa/mac-arm64/MobAlt.app (a build that keeps the test hooks)
npm run pack                 # the bundle size is measured on dist/mac-arm64/MobAlt.app
test/start-sshd.sh start     # the monitoring-bar scene needs the local sshd (skipped otherwise)
npm run perf                 # everything: ~25 min; tables on stdout, perf.json and every run's log under test/shots/perf/<stamp>/
npm run perf -- --quick      # 2 start-up runs and 15 s idle windows instead of 5 and 60 s
npm run perf -- --app dev --only startup,require     # one checkout, some of: startup, require, idle, memory, size
scripts/perf-size.sh [MobAlt.app] [MobAlt.dmg]       # the bundle-size table alone (node test/qa/perf-asar.js for app.asar)
```

`test/qa/perf.js` drives the QA harness (`test/qa/README.md`): every launch gets a fresh user-data folder with
`autoUpdate: false` (a packaged build would otherwise call GitHub 15 s in), the renderer script is injected through
`MOBALT_TEST_SCRIPT`, the window comes up inactive and nothing on the Mac is touched. The dev checkout runs the Electron
binary directly (`npx electron` would put a node process in front of the clock); the packaged app runs
`MobAlt.app/Contents/MacOS/MobAlt`. The app's processes are found from the pid the runner started — never by name, so
a MobAlt the user is running is neither measured nor disturbed.

| What | How |
|---|---|
| Start-up | 1 warm-up launch, then 5 launches; the median of each milestone as ms after `spawn()`. The main process records `main.js` starting to load, its requires done, `app.whenReady`, the window's `did-finish-load`; the renderer reports `performance.getEntriesByType('paint')`, its navigation start, the first animation frame, `performance.mark('mobalt:ready')` (end of `App.init`) and `mobalt:first-output` (the first terminal output: the shell's prompt). `test/qa/perf-startup.js`. |
| Main-process requires | `test/qa/perf-require.js` as Electron's main script in a fresh process: `src/main`'s modules timed in `main.js` order (a module an earlier one loaded costs nothing there), and each heavy package on its own. Median of 3. |
| Idle CPU | A scene is set up (`test/qa/perf-idle.js`), the shells settle 3 s, then `ps -axo pid,ppid,%cpu,time,rss,args` is sampled every second for 60 s; CPU per process = cpu time used ÷ wall time, exact from ps's TIME column, beside the mean of ps's own decaying `%cpu`. Processes are classed by Chromium's `--type` flag (main, renderer, gpu, utility:network); the shells the panes spawn are listed apart. After the window, Chromium's own `app.getAppMetrics()` share (per all cores) is read, then both JS threads are profiled for 10 s (`test:perf { profile }`): wall time, time not idle, the top functions by self time. Note: in test mode the window has `backgroundThrottling: false`, so a covered window keeps full-rate timers here where a release build throttles them. |
| Memory | `test/qa/perf-memory.js`: 0, 1, 10 and 30 local panes in tabs, 10 panes on screen at once (one WebGL context each), then 50 open / close cycles of a local tab. Before each reading a full garbage collection runs in main and in the window (`test:perf { gc }`), then `app.getAppMetrics()` working sets, `process.memoryUsage()`, `performance.memory`, the window's DOM counters (`Memory.getDOMCounters`: every node alive, attached or not), the attached node count, and the census of detached DOM trees JS still holds (`DOM.getDetachedDomNodes`, by root tag and class). The runner snapshots `ps` at each step for the shells. `{ heapSnapshot: path }` writes a `.heapsnapshot` for an offline retainer search. |
| Bundle size | `scripts/perf-size.sh`: `du` of MobAlt.app by part — the Electron framework (binary, Resources, locales, Libraries), helpers, app.asar, app.asar.unpacked, the Chromium licence file, the DMG — and `test/qa/perf-asar.js`: app.asar's contents by package and by kind of file that need not ship, from the archive header. |

The `test:perf` hook exists only while `MOBALT_TEST_SCRIPT` is set; `window.api.app.testPerf({ gc, domCounters,
detached, heapSnapshot, profile })` is its renderer side. The two `performance.mark`s are plain marks, visible in
DevTools' Performance panel too.

## Start-up

Median of 5 launches, ms after the process was started; a fresh user-data folder, so one local tab opens.

| Milestone | dev before | dev after | packaged before | packaged after |
|---|---:|---:|---:|---:|
| main.js starts loading (Electron's own bootstrap before it) | 157 | 140 | 136 | 137 |
| main.js requires done | 207 | 154 | 181 | 154 |
| app ready (`whenReady`) | 255 | 199 | 229 | 194 |
| renderer navigation start | 404 | 334 | 316 | 278 |
| window `did-finish-load` | 545 | 464 | 447 | 405 |
| first paint / first contentful paint | 564 | **477** | 476 | **430** |
| UI ready (`App.init` done) | 617 | 527 | 500 | 459 |
| first terminal output (the prompt) | 684 | **583** | 548 | **505** |

Main-process requires, warm disk cache, median of 3 (the first launch after a build read them from disk: 187 ms in
total, `./ssh` 57 ms, `./updater` 58 ms):

| Module | before | after |
|---|---:|---:|
| `src/main/ssh` (ssh2, knownhosts, x11, algorithms, keygen) | 23.0 ms | 11.5 ms (ssh2's constants for algorithms.js, the rest on first use) |
| `src/main/updater` (electron-updater and its tree: js-yaml, fs-extra, semver, …) | 24.5 ms | 0.4 ms |
| `src/main/ftp` (basic-ftp) | 2.8 ms | 0.3 ms |
| everything else (18 modules) | 5.0 ms | 3.8 ms |
| **total** | **55.3 ms** | **16.0 ms** |

On their own: electron-updater 27.5 ms, ssh2 21.7 ms (of which `ssh2/lib/protocol/constants`, which algorithms.js
keeps at start for the session editor's lists, 13 ms), serialport 12.5 ms (already loaded on first use), basic-ftp
3.5 ms, zmodem.js 3.5 ms (already on first use), node-pty 2.8 ms (the first local tab needs it anyway).

Where the time goes: Electron's own bootstrap takes ~140 ms before `main.js` runs; the requires 16 ms now (55 before);
`whenReady` fires ~45 ms later (Chromium's own readiness, which cannot be reported before the main script has
finished evaluating — so the requires were on the critical path, and the window now opens ~55 ms earlier); creating
the window and the renderer process ~85–135 ms; loading the page (xterm.js and the addons, app.js's module graph, the
four boot IPCs) ~130–150 ms to first paint; the shell's own login files ~50–70 ms to the prompt. The lazy requires are
worth 46–87 ms to the first paint here, and more on a cold disk (the same requires took 187 ms on the first launch
after a build).

## Idle CPU

Per cent of one core over 60 s, from ps's cpu time; the app total leaves the shells out (they use none). The JS columns
are what the 10 s profile found busy on each JS thread — in the main process almost all of it is the profiler's own
`inspector.post`, so main is idle; the renderer's busy time is Chromium's `(program)` (GC, compilation, native) and
the WebGL addon's cursor-blink redraw.

| Scene | main | renderer | gpu | network | **total before** | **total after** |
|---|---:|---:|---:|---:|---:|---:|
| no pane (empty window) — dev | 0.2 | 0.3 | 0.3 | 0.0 | **0.8** | 0.4 |
| 1 local pane — dev | 0.2 | 0.5 | 0.6 | 0.0 | **1.3** | 2.0 |
| 1 local pane, cursor blink off — dev | 0.3 | 0.3 | 0.4 | 0.0 | **1.0** | 1.5 |
| 10 local panes in 10 tabs (1 on screen) — dev | 0.2 | 0.6 | 0.8 | 0.0 | **1.6** | 2.9 |
| 10 local panes on screen (10 WebGL contexts) — dev | 0.3 | 0.5 | 0.6 | 0.0 | **1.4** | 2.9 |
| 1 SSH pane with the monitoring bar (local sshd) — dev | 0.2 | 0.7 | 0.9 | 0.0 | **1.8** | 3.0 |
| no pane — packaged | 0.2 | 0.3 | 0.3 | 0.0 | **0.8** | 0.5 |
| 1 local pane — packaged | 0.3 | 0.8 | 1.0 | 0.0 | **2.1** | 2.8 |
| 1 local pane, cursor blink off — packaged | 0.3 | 0.3 | 0.4 | 0.0 | **1.0** | 1.4 |
| 10 panes in 10 tabs — packaged | 0.3 | 0.9 | 0.9 | 0.0 | **2.1** | 2.8 |
| 10 panes on screen — packaged | 0.4 | 0.9 | 1.1 | 0.0 | **2.4** | 3.0 |
| 1 SSH pane with the monitoring bar — packaged | 0.3 | 0.8 | 1.1 | 0.0 | **2.2** | 3.1 |

Nothing in this round was meant to change idle CPU and nothing did: the after column is the same picture with the
run's own noise on top (the two runs were an hour apart; the gpu share in particular swings by ±0.5 % between runs,
the empty window went down, the panes went up). Where idle CPU comes from, in order: the cursor blink (the focused pane's WebGL renderer redraws the cursor row every
600 ms, then the GPU process composites — about 1 % of a core across renderer and gpu, gone with blink off); the
monitoring bar (one `sh -c` exec over the connection every 3 s: ~0.3–0.5 % between the renderer's re-fit of the strip
and the main process's channel; it stops the moment the pane is off screen or the bar hidden, `test/e2e-monitor.js`
checks that); the workspace save every 20 s and, in a packaged build, the bundle watch's plist read every 60 s (both
below what ps can see); the update check (one HTTPS request 15 s after start, then nothing). The tab-overflow
`requestAnimationFrame` is one frame per strip change, not a loop; xterm's WebGL renderer draws only on changes.
Chromium's own accounting (`percentCPUUsage`, per all cores) agrees: main 0.01 %, renderer 0.02–0.08 %, gpu
0.04–0.11 % of the machine — with 12 cores, the same picture as above.

## Memory

Working set in MB after a garbage collection (`app.getAppMetrics`), the shells from ps.

| Scene | main | renderer | gpu | network | **app total before** | **app total after** | shells | renderer JS heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 panes — dev / packaged | 205 / 178 | 158 | 98 | 48 | **510 / 482** | 493 / 466 | 0 | 11 |
| 1 pane | 205 / 179 | 164 / 162 | 103 / 98 | 48 | **520 / 488** | 509 / 476 | 3 | 11 |
| 10 panes in tabs (1 WebGL context) | 206 / 179 | 188 / 184 | 113 / 107 | 48 | **555 / 519** | 528 / 498 | 34 | 11 |
| 30 panes in tabs | 204 / 177 | 214 / 208 | 115 / 110 | 48 | **582 / 543** | 560 / 535 | 103 | 11 |
| 10 panes on screen (10 WebGL contexts) | 204 / 177 | 221 / 216 | 129 / 123 | 48 | **602 / 565** | 580 / 552 | 34 | 11 |

A local pane costs about 2.5 MB of renderer working set in a tab (its xterm buffer and DOM; the renderer's JS heap
stays at 10–11 MB because xterm keeps the buffer in typed arrays) plus 3.4 MB for its zsh. The after column is 13–30
MB lower throughout: the main process no longer carries electron-updater's module tree (its JS heap 8 → 5 MB, its
working set −13 MB packaged), the rest is the usual run-to-run drift. The WebGL budget's effect: ten
panes on screen take 33 MB more renderer and 16 MB more GPU memory than the same ten in tabs — a GPU context and a
texture atlas each — which is what the budget of 12 contexts (`WEBGL_BUDGET`, terminal.js) is there to bound; hidden
panes draw with the DOM renderer and hold none of it. The main process's 180–205 MB is Electron's own (the framework
mapped in; its JS heap is 6–9 MB).

**The open / close loop (50 local tabs opened and closed, then a GC):**

| | before | after |
|---|---|---|
| renderer working set | 214 → **319 MB** (+105 MB) | 199 → **206 MB** (+7 MB) |
| gpu working set | 125 → 144 MB | 115 → 123 MB |
| renderer JS heap | 11 → 11 MB | 10 → 10 MB |
| DOM nodes alive (attached) | 901 → 1960 (322 → 322) | 836 → 908 (322 → 322) |
| detached DOM trees held by JS | 412 trees, 1086 nodes: per closed pane xterm's element, viewport, style, 3 canvases | 20 trees, 144 nodes: the last closed pane and the live one |

The leak: addon-webgl 0.19 creates its `CursorBlinkStateManager` in a `MutableDisposable` that the renderer never
registers for disposal, so the 600 ms blink interval outlived `dispose()` and, through its callback, kept the
renderer, its canvas, the link-layer canvas and the texture-atlas pages alive — about 2 MB and one more ticking timer
for every pane closed or hidden (a heap snapshot's retainer path: `DOMTimer → CursorBlinkStateManager._renderCallback
→ WebglRenderer → _canvas / _charAtlas._pages`). `TermPane.disposeWebgl` now disposes that manager after the addon;
a fixed addon makes the step a no-op.

## Bundle size

`dist/mac-arm64/MobAlt.app`, `du` in MB (1024-based); the DMG is what users download.

| Part | before | after |
|---|---:|---:|
| MobAlt.app | 272.7 | 258.0 |
| Electron Framework.framework | 249.8 | 243.0 |
| — binary | 196.7 | 196.7 |
| — Resources (resources.pak 12.7, icudtl.dat 10.3, snapshots, locales) | 33.9 | 27.2 |
| — of which Chromium's locales (*.lproj) | 8.7 (220 dirs) | 1.9 (56 dirs: the interface's 11 languages and their variants) |
| — Libraries (libvk_swiftshader 15.7, libffmpeg 2.2) | 17.9 | 17.9 |
| helpers, Squirrel, Mantle, ReactiveObjC | 1.6 | 1.6 |
| app.asar | 7.8 | 4.9 |
| app.asar.unpacked (the native modules) | 7.5 | 2.5 |
| LICENSES.chromium.html | 5.3 | 5.3 |
| MobAlt-0.15.2-arm64.dmg (what users download) | 119.1 | 115.1 |

The downloads at 1.0.0, from the v1.0.0 GitHub release's assets (read 2026-11-02; MB, 1024-based). No 1.0.0 app was
measured part by part, so the table above stays the 0.15.2 round's.

| Release asset | MB |
|---|---:|
| MobAlt-1.0.0-arm64.dmg | 115.6 |
| MobAlt-1.0.0-arm64.zip (the update download) | 111.5 |
| MobAlt-1.0.0-x64.dmg | 122.5 |
| MobAlt-1.0.0-x64.zip (the update download) | 118.4 |

What app.asar shipped that the app never loads (6.8 MB of its 14.2): node-pty's Windows prebuilds and winpty sources,
serialport's android / linux / win32 prebuilds and C++ sources, xterm's TypeScript sources
and `xterm.mjs` (the page loads `lib/xterm.js`), the nan and node-addon-api headers, cpu-features' vendored C library,
gyp and build leftovers, changelogs and readmes, and `src/locales/catalog.json` (the string catalog `npm run i18n`
maintains; the dictionaries are what runs). `files` in package.json excludes them now; every `.node` the app loads
(node-pty, serialport, cpu-features, ssh2's sshcrypto) is still unpacked beside the asar, and electron-builder keeps
the loader packages (node-gyp-build) they go through — and `@serialport/binding-mock` stays: it looks like a dev-only package but serialport's index requires it, which the packaged smoke caught. `electronLanguages` lists the interface's eleven languages, so
Chromium drops its other locales from the framework (electron-builder matches `zh-CN` to `zh_CN.lproj` and `pt` to
`pt_BR` and `pt_PT`). What stays and why: the Electron framework is 94 % of the bundle and not ours to trim
(libvk_swiftshader, the software Vulkan fallback, is 15.7 MB of it); LICENSES.chromium.html (5.3 MB) is Chromium's
attribution and ships with every Electron app.

## What was changed, and what was left alone

Changed, because the numbers said so:

- `build:` the `files` exclusions and `electronLanguages` above.
- `perf(main):` electron-updater, ssh2 and basic-ftp are required on first use instead of while `main.js` loads
  (together ~50 ms warm, ~115 ms cold, before the window could be created). Behaviour is the same: the updater wires
  its listeners on the first check (15 s in, or from Help / Settings), ssh2 loads on the first connection or key
  parse, basic-ftp on the first FTP session.
- `perf(renderer):` the WebGL cursor-blink timer leak above.

Measured and left alone:

- Idle timers: the monitoring poll already stops off screen and while the bar is hidden; the update check is a single
  request; the workspace save (20 s) and the bundle watch (60 s, packaged) cost nothing ps can measure. Backing them
  off further would change what the guide documents without a measurable gain.
- The cursor blink (about 1 % of a core while a pane is focused) is the default the guide documents; `cursorBlink`
  stays on. Turning it off in Settings → Terminal is the user's knob.
- xterm options: scrollback 10 000 lines costs ~2.5 MB per pane of renderer memory only once the buffer fills, and
  the profile shows no scrolling or rendering cost at idle; `fastScrollModifier` is not set. Nothing to gain.
- The WebGL budget stays at 12: the memory table shows what each on-screen context costs, and the DOM renderer for
  hidden panes is what keeps 30 tabs at +50 MB rather than +160.
- `ssh2/lib/protocol/constants` (13 ms) is kept at start by algorithms.js: its tables are built at load (and its unit
  tests say so) for the session editor, and the renderer asks for them while booting; moving that is more change than
  the 13 ms are worth.
- The main process's working set (180–205 MB) is Electron's framework mapped in, not heap (6–9 MB).

## Caveats

The numbers are from one machine on one day; run `npm run perf` on yours and read the trend, not the digits. Idle
figures are sensitive to anything else running; the runner uses one-second ps samples over 60 s and reports the exact
cpu-time delta, which is good to about 0.05 % of a core. Start-up medians move by ±20 ms between runs. The packaged
app is an unsigned `--dir` build; a signed, notarized one starts the same way (Gatekeeper's check happens once, at the
first launch after download).
