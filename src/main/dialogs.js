'use strict';
// Native dialogs (open / save / message box) behind one door, so that the headless test runs can answer them.
// Every main-process feature that opens a file picker or a sheet (session export / import, the MobaXterm
// importer, the SFTP download-to / upload-from pickers, the renderer's dialog:* bridge used by the session
// editor's key picker, the updater's sheets) goes through these wrappers. Outside test mode they are plain
// pass-throughs to Electron's dialog module. In test mode (MOBALT_TEST_SCRIPT set) a script enqueues canned
// answers through the test:next-dialog IPC (window.api.app.testNextDialog): each show* call takes the next one
// instead of opening the native sheet, and falls through to the real dialog once the queue is empty.
// Outside Electron (unit tests) require('electron') is the binary path or throws; the module is resolved lazily.
let electron = null;
try { electron = require('electron'); } catch { electron = null; }
const native = () => {
  const d = electron && typeof electron === 'object' ? electron.dialog : null;
  if (!d) throw new Error('native dialogs are not available here');
  return d;
};

const queue = [];
const testMode = () => !!process.env.MOBALT_TEST_SCRIPT;

/**
 * Test mode only: queue the answer the next dialog gives — { canceled, filePaths?, filePath?, response? }.
 * Returns how many answers are now waiting; null outside test mode (nothing is queued there, ever).
 */
function enqueue(result) {
  if (!testMode()) return null;
  queue.push(result && typeof result === 'object' ? { ...result } : { canceled: true });
  return queue.length;
}

/** Answers still waiting (0 outside test mode). */
function pending() {
  return testMode() ? queue.length : 0;
}

function canned(kind, opts) {
  if (!testMode() || !queue.length) return null;
  const r = queue.shift();
  console.log(`[test] dialog answered without showing: ${kind} "${(opts && (opts.title || opts.message)) || ''}" ← ${JSON.stringify(r)}`);
  return r;
}

/** Same shape as dialog.showOpenDialog: { canceled, filePaths }. */
async function showOpenDialog(win, opts) {
  const r = canned('open', opts);
  if (r) {
    const paths = r.filePaths || (r.filePath ? [r.filePath] : []);
    return { canceled: !!r.canceled, filePaths: r.canceled ? [] : paths.map(String) };
  }
  return native().showOpenDialog(win, opts);
}

/** Same shape as dialog.showSaveDialog: { canceled, filePath }. */
async function showSaveDialog(win, opts) {
  const r = canned('save', opts);
  if (r) {
    const file = r.filePath || (r.filePaths && r.filePaths[0]) || '';
    return { canceled: !!r.canceled || !file, filePath: r.canceled ? '' : String(file) };
  }
  return native().showSaveDialog(win, opts);
}

/**
 * Same shape as dialog.showMessageBox: { response, checkboxChecked }. A canned { canceled: true } picks the sheet's
 * cancel button the way Esc does (cancelId, else the first "Cancel"/"No"/"Later" button, else 0).
 */
async function showMessageBox(win, opts) {
  const r = canned('message', opts);
  if (r) {
    let response = Number.isInteger(r.response) ? r.response : 0;
    if (r.canceled && !Number.isInteger(r.response)) {
      const buttons = (opts && opts.buttons) || [];
      const byLabel = buttons.findIndex((b) => /^(cancel|no|later)$/i.test(String(b)));
      response = Number.isInteger(opts && opts.cancelId) ? opts.cancelId : byLabel >= 0 ? byLabel : 0;
    }
    return { response, checkboxChecked: !!r.checkboxChecked };
  }
  return native().showMessageBox(win, opts);
}

module.exports = { showOpenDialog, showSaveDialog, showMessageBox, enqueue, pending };
