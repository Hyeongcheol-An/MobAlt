// The in-app update's download, as the banner above the tabs (app.js onUpdateProgress) and the Settings → Updates
// line (dialogs.js) word it. The figures are electron-updater's download-progress event — { percent, transferred,
// total, bytesPerSecond } — forwarded by src/main/updater.js with the version and a phase. Pure on purpose: the
// sentence is built through the t() the caller passes, so the module loads outside the renderer
// (test/unit/updateprogress.test.js) and both views show the same numbers for the same event.

const MB = 1024 * 1024;

/** Bytes as megabytes with one decimal ("12.3"); anything that is not a finite, positive number reads "0.0". */
export function mb(bytes) {
  const n = Number(bytes);
  return (Number.isFinite(n) && n > 0 ? n / MB : 0).toFixed(1);
}

/** A percentage as a whole number from 0 to 100 (the updater reports fractions such as 41.8). */
export function percent(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** The figures of a progress event, formatted: { percent: 42, transferred: '12.3', total: '29.4', speed: '2.1' }. */
export function progressParts(p) {
  const e = p && typeof p === 'object' ? p : {};
  return { percent: percent(e.percent), transferred: mb(e.transferred), total: mb(e.total), speed: mb(e.bytesPerSecond) };
}

/**
 * The one line that tells where the download stands; `t` is the interface language's t(). '' for no event or an
 * unknown phase.
 *   downloading  "Downloading MobAlt 0.17.0 — 42 % (12.3 of 29.4 MB, 2.1 MB/s)", or "Downloading MobAlt 0.17.0…"
 *                before the first byte (the start event carries no size yet)
 *   done         "MobAlt 0.17.0 downloaded — it is installed when you quit, or restart now"
 *   error        "Download of MobAlt 0.17.0 failed: <message>"
 */
export function progressLine(p, t) {
  if (!p || typeof p !== 'object') return '';
  const version = p.version || '';
  if (p.phase === 'done') return t('MobAlt {version} downloaded — it is installed when you quit, or restart now', { version });
  if (p.phase === 'error') return t('Download of MobAlt {version} failed: {error}', { version, error: p.message || '' });
  if (p.phase !== 'downloading') return '';
  if (!(Number(p.total) > 0)) return t('Downloading MobAlt {version}…', { version });
  return t('Downloading MobAlt {version} — {percent} % ({transferred} of {total} MB, {speed} MB/s)', { version, ...progressParts(p) });
}
