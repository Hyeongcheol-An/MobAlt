'use strict';
// A pane's failed start, handed to the renderer as a reply instead of a rejection (main.js term:spawn-mosh, ftp:connect).
// An error thrown from an ipcMain.handle handler only crosses IPC as its message, and Electron prints every one to the
// main process's stderr ("Error occurred in handler for 'ftp:connect': Error: …"). A failed start is an expected
// outcome — a refused port, a declined host key —, and it carries two texts: `error` for the status bar and the FTP
// card (the interface language) and `terminalError` for "Failed to start: …" in the terminal (the terminal language:
// English for Arabic and Hindi, i18n.errorFor). The renderer (terminal.js start) treats `ok: false` as the failure.

/** The reply for a failed start: { ok: false, error, terminalError } (terminalError is error when there is none of its own). */
function startFailure(err) {
  const error = String((err && err.message) || err || '');
  const terminalError = err && typeof err.terminalMessage === 'string' && err.terminalMessage ? err.terminalMessage : error;
  return { ok: false, error, terminalError };
}

/** Wrap an ipcMain.handle handler that starts a pane: what it returns goes through, what it throws comes back as startFailure. */
const forPane = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { return startFailure(err); }
};

module.exports = { startFailure, forPane };
