// Formatting for the remote monitoring bar (terminal.js): pure functions over a sample from src/main/monitor.js.
// Unit-tested through test/unit/monitor.test.js (dynamic import, like theme.js).

import { t } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Bytes as a short size, 1024-based: 0 B, 512 B, 3.1 KB, 12 KB, 15.6 GB, 64 GB. One decimal below 10 of a unit, and
 * up to 100 from GB on (memory sizes: "15.6 GB" says more than "16 GB"); rates in KB/MB stay whole numbers.
 */
export function formatBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—';
  let v = n, i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const decimal = i > 0 && (v < 10 || (i >= 3 && v < 100));
  const s = decimal ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
  return `${s} ${UNITS[i]}`;
}

/** A transfer rate: "12 KB/s"; null (no second sample yet, counter reset) is an em dash. */
export function formatRate(bytesPerSecond) {
  if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return '—';
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

/** Seconds of uptime as the two largest units: 3d 4h, 4h 12m, 12m, 45s (the unit letters follow the interface language). */
export function formatUptime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return t('{d}d {h}h', { d, h });
  if (h > 0) return t('{h}h {m}m', { h, m });
  if (m > 0) return t('{m}m', { m });
  return t('{s}s', { s });
}

/** The three load averages with two decimals, or an em dash. */
export function formatLoad(load) {
  if (!Array.isArray(load) || load.length < 3 || load.some((x) => !Number.isFinite(x))) return '—';
  return load.slice(0, 3).map((x) => x.toFixed(2)).join(' ');
}

/** Memory in use as a percentage of the total, or null when either is unknown. */
export function memPercent(sample) {
  if (!sample || !sample.memTotal || sample.memUsed === null || sample.memUsed === undefined) return null;
  return Math.min(100, Math.max(0, (sample.memUsed / sample.memTotal) * 100));
}

/** The meter's state class for a percentage: '' below 80, 'warn' from 80, 'danger' from 95; '' when unknown. */
export function meterLevel(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '';
  return pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
}
