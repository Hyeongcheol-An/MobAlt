'use strict';
// Auto-update via GitHub Releases (electron-updater reads latest-mac.yml from the newest release).
// Nothing is downloaded without the user's consent: an update is offered in a dialog, downloaded on
// request and installed on quit (or right away when the user picks "Restart now").
const { app, dialog } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

/**
 * @param hooks {beforeInstall?: () => void} called right before quitAndInstall, so the app can skip its
 *              quit confirmation (the user already chose "Restart now").
 */
function setupUpdater(store, getWin, hooks = {}) {
  const win = () => {
    const w = getWin();
    return w && !w.isDestroyed() ? w : undefined;
  };
  if (!autoUpdater || !app.isPackaged) {
    return {
      check: async (manual) => {
        if (manual) {
          await dialog.showMessageBox(win(), {
            type: 'info', message: 'Updates are only checked in packaged builds',
            detail: `This is MobAlt ${app.getVersion()} running from source.`,
          });
        }
      },
    };
  }

  const state = { manual: false, checking: false };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', async (info) => {
    state.checking = false;
    const r = await dialog.showMessageBox(win(), {
      type: 'info',
      message: `MobAlt ${info.version} is available`,
      detail: `You are using ${app.getVersion()}. Download it now? It is installed when you quit, or right away if you choose to restart after the download.`,
      buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
    });
    state.manual = false;
    if (r.response === 0) {
      autoUpdater.downloadUpdate().catch((e) => dialog.showMessageBox(win(), { type: 'error', message: 'Download failed', detail: e.message }));
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (state.manual) dialog.showMessageBox(win(), { type: 'info', message: 'MobAlt is up to date', detail: `Version ${app.getVersion()}` });
    state.manual = false;
    state.checking = false;
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(win(), {
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
    if (state.manual) dialog.showMessageBox(win(), { type: 'error', message: 'Update check failed', detail: e.message });
    state.manual = false;
    state.checking = false;
  });

  const check = (manual) => {
    if (state.checking) return;
    state.checking = true;
    state.manual = !!manual;
    autoUpdater.checkForUpdates().catch(() => { state.checking = false; });
  };
  if (store.getSettings().autoUpdate !== false) setTimeout(() => check(false), 15000);
  return { check };
}

module.exports = { setupUpdater };
