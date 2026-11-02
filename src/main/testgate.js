'use strict';
// Who may drive the app through the test hooks. In test mode (MOBALT_TEST_SCRIPT) the main process runs a script file
// inside the window with the whole preload bridge behind it, and the test:* IPC handlers read and write any file, run
// code in any window and fake key presses — everything a saved session's credentials are protected by. An environment
// variable is not a gate: anyone who can start the app can set one. So the hooks exist only
//   - when running from source (electron .: not packaged), or
//   - in a packaged build made with `npm run pack:qa`, which writes `"testHooks": true` into the bundle's package.json
//     (electron-builder extraMetadata). Release builds (`npm run dist`, the release workflow) never carry it, and the
//     asar-integrity and only-load-from-asar fuses stop anyone from adding it to a signed bundle afterwards.
// Everywhere else the variables are removed from the environment before any module reads them, so every
// `process.env.MOBALT_TEST_SCRIPT` check in the main process (and in the windows and shells it starts) sees nothing.

// The variables that switch test behaviour on. MOBALT_USER_DATA (another settings folder) and MOBALT_LANG (another
// interface language) stay: they change no trust boundary, and the packaged-app checks use them on release builds.
const TEST_VARS = ['MOBALT_TEST_SCRIPT', 'MOBALT_SCREENSHOT', 'MOBALT_SCREENSHOT_DELAY', 'MOBALT_SHOT_DIR', 'MOBALT_QUIT_AFTER', 'MOBALT_ZMODEM_DEBUG'];

/** True when the test hooks may run: from source, or a packaged build that was made with the testHooks flag. */
function testHooksAllowed({ isPackaged, testHooks }) {
  return !isPackaged || testHooks === true;
}

/** Strip the test variables from `env` unless this build may run test hooks. Returns whether it may. */
function applyTestGate(app, pkg, env = process.env) {
  const allowed = testHooksAllowed({ isPackaged: !!(app && app.isPackaged), testHooks: pkg && pkg.testHooks });
  if (!allowed) for (const v of TEST_VARS) delete env[v];
  return allowed;
}

module.exports = { testHooksAllowed, applyTestGate, TEST_VARS };
