'use strict';
// Auto-update via GitHub Releases (electron-updater reads latest-mac.yml from the newest release).
// Nothing is downloaded without the user's consent: an update is offered in a dialog, downloaded on
// request and installed on quit (or right away when the user picks "Restart now"). A release that is
// already on disk (brew upgrade / a dragged DMG while running) is never downloaded again: the bundle
// watch's relaunch banner takes over.
const { app } = require('electron');
const dialogs = require('./dialogs'); // sheets go through the wrapper so that test runs can answer them
const { compareVersions } = require('./bundlewatch');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

/**
 * @param hooks {beforeInstall?: () => void}            called right before quitAndInstall, so the app can skip its
 *                                                      quit confirmation (the user already chose "Restart now")
 *              {diskVersion?: () => Promise<string>}   version of the MobAlt.app on disk (null when unreadable)
 *              {bundleOnDisk?: (version) => void}      that version is already installed: show the relaunch banner
 *              {afterCheck?: () => void}               a check has concluded (the bundle watch looks at the disk again)
 *              {relaunch?: () => void}                 restart into the bundle on disk
 * check(manual, { quiet }) resolves with { status: 'available' | 'up-to-date' | 'on-disk' | 'error' | 'source', version?, message }
 * once the updater has spoken, so the Settings → Updates line can show the outcome. A quiet manual check is one
 * whose caller reports that outcome itself (that line): no up-to-date / error / on-disk sheet, only the
 * "Download?" offer for a new release. Help → Check for Updates… is a loud manual check: every outcome is a sheet.
 */
function setupUpdater(store, getWin, hooks = {}) {
  const win = () => {
    const w = getWin();
    return w && !w.isDestroyed() ? w : undefined;
  };
  if (!autoUpdater || !app.isPackaged) {
    return {
      check: async (manual, { quiet = false } = {}) => {
        const message = 'Updates are only checked in packaged builds';
        if (manual && !quiet) {
          await dialogs.showMessageBox(win(), {
            type: 'info', message,
            detail: `This is MobAlt ${app.getVersion()} running from source.`,
          });
        }
        return { status: 'source', version: app.getVersion(), message };
      },
    };
  }

  const state = { manual: false, quiet: false, pending: null, done: null };
  const loud = () => state.manual && !state.quiet; // this check's outcome is reported in a sheet (read before finish() resets it)
  // One check at a time; whoever asked gets the outcome once, then the bundle watch looks at the disk again.
  const finish = (result) => {
    const done = state.done;
    state.done = null;
    state.pending = null;
    state.manual = false;
    state.quiet = false;
    if (done) done(result);
    try { hooks.afterCheck && hooks.afterCheck(); } catch {}
  };
  const onDisk = async () => {
    try { return hooks.diskVersion ? await hooks.diskVersion() : null; } catch { return null; }
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', async (info) => {
    const manual = loud();
    // The bundle on disk already is this release (or newer): a brew upgrade or a dragged DMG replaced the app
    // while it was running. Nothing to download; the banner (and a manual check's dialog) say to relaunch.
    const disk = await onDisk();
    if (disk && disk !== app.getVersion() && compareVersions(disk, info.version) >= 0) {
      const message = `${disk} is already installed on disk; relaunch to use it`;
      try { hooks.bundleOnDisk && hooks.bundleOnDisk(disk); } catch {}
      finish({ status: 'on-disk', version: disk, message });
      if (manual) {
        const r = await dialogs.showMessageBox(win(), {
          type: 'info',
          message: `MobAlt ${message}`,
          detail: `You are running ${app.getVersion()}. Nothing needs to be downloaded; relaunching starts the version that is on disk.`,
          buttons: ['Relaunch', 'Later'], defaultId: 0, cancelId: 1,
        });
        if (r.response === 0 && hooks.relaunch) hooks.relaunch();
      }
      return;
    }
    finish({ status: 'available', version: info.version, message: `MobAlt ${info.version} is available` });
    const r = await dialogs.showMessageBox(win(), {
      type: 'info',
      message: `MobAlt ${info.version} is available`,
      detail: `You are using ${app.getVersion()}. Download it now? It is installed when you quit, or right away if you choose to restart after the download.`,
      buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) {
      autoUpdater.downloadUpdate().catch((e) => dialogs.showMessageBox(win(), { type: 'error', message: 'Download failed', detail: e.message }));
    }
  });
  autoUpdater.on('update-not-available', () => {
    const manual = loud();
    finish({ status: 'up-to-date', version: app.getVersion(), message: `MobAlt ${app.getVersion()} is up to date` });
    if (manual) dialogs.showMessageBox(win(), { type: 'info', message: 'MobAlt is up to date', detail: `Version ${app.getVersion()}` });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialogs.showMessageBox(win(), {
      type: 'info',
      message: `MobAlt ${info.version} is ready to install`,
      detail: 'Restart now to install it, or keep working: it is installed when you quit.',
      buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) {
      try { hooks.beforeInstall && hooks.beforeInstall(); } catch {}
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });
  autoUpdater.on('error', (e) => {
    const manual = loud();
    finish({ status: 'error', message: `Update check failed: ${e.message}` });
    if (manual) dialogs.showMessageBox(win(), { type: 'error', message: 'Update check failed', detail: e.message });
  });

  const check = (manual, { quiet = false } = {}) => {
    if (state.pending) return state.pending; // a check is under way: share its outcome (and its loudness)
    state.manual = !!manual;
    state.quiet = !!quiet;
    state.pending = new Promise((resolve) => { state.done = resolve; });
    autoUpdater.checkForUpdates().catch((e) => finish({ status: 'error', message: `Update check failed: ${e.message}` }));
    return state.pending;
  };
  if (store.getSettings().autoUpdate !== false) setTimeout(() => check(false), 15000);
  return { check };
}

module.exports = { setupUpdater };
