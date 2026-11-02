'use strict';
// Auto-update via GitHub Releases (electron-updater reads latest-mac.yml from the newest release).
// Nothing is downloaded without the user's consent: an update is offered in a dialog, downloaded on
// request and installed on quit (or right away when the user picks "Restart now"). A release that is
// already on disk (brew upgrade / a dragged DMG while running) is never downloaded again: the bundle
// watch's relaunch banner takes over. The download itself is reported to the windows as it goes
// (hooks.progress → app:update-progress): a 30–40 MB zip takes a while, and the banner above the tabs and
// Settings → Updates show the figures instead of leaving the user to wonder whether "Download" did anything.
const { app } = require('electron');
const dialogs = require('./dialogs'); // sheets go through the wrapper so that test runs can answer them
const { compareVersions } = require('./bundlewatch');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

// electron-updater is loaded on the first check, 15 s after start or from the menu: its require (~25 ms warm, more
// from a cold disk) is nothing the window should wait for. null until then; false when the module is missing.
let autoUpdater = null;
function loadAutoUpdater() {
  if (autoUpdater === null) {
    try { ({ autoUpdater } = require('electron-updater')); } catch { autoUpdater = false; }
  }
  return autoUpdater || null;
}

/**
 * @param hooks {beforeInstall?: () => void}            called right before quitAndInstall, so the app can skip its
 *                                                      quit confirmation (the user already chose "Restart now")
 *              {diskVersion?: () => Promise<string>}   version of the MobAlt.app on disk (null when unreadable)
 *              {bundleOnDisk?: (version) => void}      that version is already installed: show the relaunch banner
 *              {afterCheck?: () => void}               a check has concluded (the bundle watch looks at the disk again)
 *              {relaunch?: () => void}                 restart into the bundle on disk
 *              {progress?: (info) => void}             the download as it goes, for every window's banner and Settings line:
 *                                                      { phase: 'downloading' | 'done' | 'error', version, percent, transferred,
 *                                                      total, bytesPerSecond, message? } — once at the start (0 %, no size yet),
 *                                                      on every download-progress event (at most one a second), when the file
 *                                                      is complete (100 %) and when the download failed (with the message)
 * check(manual, { quiet }) resolves with { status: 'available' | 'up-to-date' | 'on-disk' | 'error' | 'source', version?, message }
 * once the updater has spoken, so the Settings → Updates line can show the outcome. A quiet manual check is one
 * whose caller reports that outcome itself (that line): no up-to-date / error / on-disk sheet, only the
 * "Download?" offer for a new release. Help → Check for Updates… is a loud manual check: every outcome is a sheet.
 * install() quits into the downloaded update — the sheet's "Restart now", the banner's and the one in Settings → Updates
 * all come here; false (nothing happens) while no download has completed.
 */
function setupUpdater(store, getWin, hooks = {}) {
  const win = () => {
    const w = getWin();
    return w && !w.isDestroyed() ? w : undefined;
  };
  // Running from source (or, in a packaged build, without the electron-updater module): no check, only the answer.
  const sourceCheck = async (manual, { quiet = false } = {}) => {
    const message = t('Updates are only checked in packaged builds');
    if (manual && !quiet) {
      await dialogs.showMessageBox(win(), {
        type: 'info', message,
        detail: t('This is MobAlt {version} running from source.', { version: app.getVersion() }),
      });
    }
    return { status: 'source', version: app.getVersion(), message };
  };
  if (!app.isPackaged) return { check: sourceCheck, install: () => false };

  // download: { version, last } while a download runs (last: the latest figures, so "done" can repeat the size);
  // downloaded: the version whose file is complete and waits for the quit (or install()); lastDone: that event, sent
  // again when a check finds the release once more; installing: install() ran (a second click does nothing more)
  const state = { manual: false, quiet: false, pending: null, done: null, download: null, downloaded: null, lastDone: null, installing: false };
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
  // The download as the windows see it. Every event carries the version and the four figures (a window draws the
  // whole line from any one of them); a failure carries its message. A listener that throws never breaks the download.
  const emit = (info) => { try { hooks.progress && hooks.progress(info); } catch {} };
  const report = (phase, figures = {}, message) => {
    if (!state.download) return;
    const d = state.download;
    d.last = { ...(d.last || { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }), ...figures };
    const info = { phase, version: d.version, percent: d.last.percent, transferred: d.last.transferred, total: d.last.total, bytesPerSecond: d.last.bytesPerSecond };
    if (message !== undefined) info.message = message;
    if (phase === 'done') state.lastDone = info; // sent again when a later check finds this release (the way back to Restart now)
    emit(info);
  };
  // A download that broke off. downloadUpdate() rejects for every failure — electron-updater's errorHandler emits 'error'
  // and rethrows, a cancellation rejects without the event — so this is the one place that reports it; the 'error'
  // listener below leaves the download alone (that event is also a failed *check*: Settings → Check now hitting a DNS
  // error while the file keeps coming from the CDN must not end the download).
  const failDownload = (e) => {
    if (!state.download) return;
    report('error', {}, (e && e.message) || t('Download failed')); // never a line that ends in "failed: "
    state.download = null;
  };
  const startDownload = (autoUpdater, version) => {
    if (state.download) return; // one download at a time: a newer release found meanwhile must not relabel the running one (AppUpdater hands back the download in progress)
    state.download = { version, last: null };
    report('downloading', { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }); // "Download" did something: the line appears before the first byte
    autoUpdater.downloadUpdate().catch((e) => {
      failDownload(e);
      dialogs.showMessageBox(win(), { type: 'error', message: t('Download failed'), detail: (e && e.message) || String(e) });
    });
  };
  const install = () => {
    const autoUpdater = loadAutoUpdater();
    if (!autoUpdater || !state.downloaded) return false;
    if (state.installing) return true; // a second click while the quit is under way: nothing more to do (a second quitAndInstall would stack on MacUpdater)
    state.installing = true;
    try { hooks.beforeInstall && hooks.beforeInstall(); } catch {}
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  };
  // The "ready to install" sheet: after the download, and again when a loud check finds the file already complete.
  const offerInstall = async (version) => {
    const r = await dialogs.showMessageBox(win(), {
      type: 'info',
      message: t('MobAlt {version} is ready to install', { version }),
      detail: t('Restart now to install it, or keep working: it is installed when you quit.'),
      buttons: [t('Restart now'), t('Later')], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) install();
  };
  // The module and its listeners, on the first check (the updater is never needed before that).
  let wired = false;
  const wire = () => {
    const autoUpdater = loadAutoUpdater();
    if (!autoUpdater || wired) return autoUpdater;
    wired = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-available', async (info) => {
      const manual = loud();
      // The bundle on disk already is this release (or newer): a brew upgrade or a dragged DMG replaced the app
      // while it was running. Nothing to download; the banner (and a manual check's dialog) say to relaunch.
      const disk = await onDisk();
      if (disk && disk !== app.getVersion() && compareVersions(disk, info.version) >= 0) {
        const message = t('{version} is already installed on disk; relaunch to use it', { version: disk });
        try { hooks.bundleOnDisk && hooks.bundleOnDisk(disk); } catch {}
        finish({ status: 'on-disk', version: disk, message });
        if (manual) {
          const r = await dialogs.showMessageBox(win(), {
            type: 'info',
            message: t('MobAlt {version} is already installed on disk; relaunch to use it', { version: disk }),
            detail: t('You are running {current}. Nothing needs to be downloaded; relaunching starts the version that is on disk.', { current: app.getVersion() }),
            buttons: [t('Relaunch'), t('Later')], defaultId: 0, cancelId: 1,
          });
          if (r.response === 0 && hooks.relaunch) hooks.relaunch();
        }
        return;
      }
      const available = { status: 'available', version: info.version, message: t('MobAlt {version} is available', { version: info.version }) };
      // The file of that release is complete already (the sheet and the banner were both answered Later): the windows get
      // the "done" event again — the way back to Restart now — and a loud check shows the ready-to-install sheet again.
      if (state.downloaded === info.version) {
        emit(state.lastDone || { phase: 'done', version: info.version, percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 });
        finish(available);
        if (manual) await offerInstall(info.version);
        return;
      }
      finish(available);
      // A download is running (this release, or an older one found first): the banner and the Settings line show it; no
      // second offer, and never two downloads at once (a newer release waits for the next check).
      if (state.download) return;
      const r = await dialogs.showMessageBox(win(), {
        type: 'info',
        message: t('MobAlt {version} is available', { version: info.version }),
        detail: t('You are using {current}. Download it now? It is installed when you quit, or right away if you choose to restart after the download.', { current: app.getVersion() }),
        buttons: [t('Download'), t('Later')], defaultId: 0, cancelId: 1,
      });
      if (r.response === 0) startDownload(autoUpdater, info.version);
    });
    autoUpdater.on('update-not-available', () => {
      const manual = loud();
      finish({ status: 'up-to-date', version: app.getVersion(), message: t('MobAlt {version} is up to date', { version: app.getVersion() }) });
      if (manual) dialogs.showMessageBox(win(), { type: 'info', message: t('MobAlt is up to date'), detail: t('Version {version}', { version: app.getVersion() }) });
    });
    autoUpdater.on('download-progress', (p) => {
      if (p && typeof p === 'object') report('downloading', { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
    });
    autoUpdater.on('update-downloaded', async (info) => {
      state.downloaded = (info && info.version) || (state.download && state.download.version) || app.getVersion();
      if (state.download) {
        const total = (state.download.last && state.download.last.total) || 0;
        report('done', { percent: 100, transferred: total, total });
        state.download = null;
      }
      await offerInstall(state.downloaded);
    });
    autoUpdater.on('error', (e) => {
      // A failed check. electron-updater fires this for a failed download too, but that one is reported from
      // downloadUpdate()'s rejection (startDownload): a check that fails while the file keeps coming must not end the download.
      const manual = loud();
      finish({ status: 'error', message: t('Update check failed: {error}', { error: e.message }) });
      if (manual) dialogs.showMessageBox(win(), { type: 'error', message: t('Update check failed'), detail: e.message });
    });
    return autoUpdater;
  };

  const check = (manual, { quiet = false } = {}) => {
    if (state.pending) return state.pending; // a check is under way: share its outcome (and its loudness)
    const autoUpdater = wire();
    if (!autoUpdater) return sourceCheck(manual, { quiet });
    state.manual = !!manual;
    state.quiet = !!quiet;
    state.pending = new Promise((resolve) => { state.done = resolve; });
    autoUpdater.checkForUpdates().catch((e) => finish({ status: 'error', message: t('Update check failed: {error}', { error: e.message }) }));
    return state.pending;
  };
  if (store.getSettings().autoUpdate !== false) setTimeout(() => check(false), 15000);
  return { check, install };
}

module.exports = { setupUpdater };
