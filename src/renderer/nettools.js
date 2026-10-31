// Pure helpers of the Tools panel (panels.js ToolsPanel): the Wake-on-LAN form's MAC / label / port handling and
// the scanner table's rules. No DOM, so test/unit/nettools.test.js imports them directly (like monitor.js).

import { t, tn } from './i18n.js'; // interface language: every label / message shown to the user goes through t() / tn()
export const LABEL_MAX = 40;

/**
 * A MAC in any of the usual spellings — aa:bb:cc:dd:ee:ff, AA-BB-CC-DD-EE-FF, Cisco's aabb.ccdd.eeff or the bare 12
 * hex digits — as the lower-case colon form the history keeps; null when the text is not (yet) one. Mirrors
 * src/main/wol.js parseMac, so a label is recalled whatever spelling is typed.
 */
export function normMac(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let hex;
  if (/^[0-9a-f]{12}$/i.test(s)) hex = s;
  else if (/^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i.test(s)) hex = s.replace(/[:-]/g, '');
  else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s)) hex = s.replace(/\./g, '');
  else return null;
  return hex.toLowerCase().match(/../g).join(':');
}

/** The history label as kept: one line, at most LABEL_MAX characters (a 300-character label made a 7-line toast). */
export function trimLabel(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX).trim();
}

/** The UDP port field as typed → { port } (empty: 9) or { error }: "1.5" and "nine" are refused, not rounded to 1. */
export function parsePort(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { port: 9 };
  if (!/^\d{1,5}$/.test(s)) return { error: 'The port must be a whole number between 1 and 65535' };
  const port = Number(s);
  if (port < 1 || port > 65535) return { error: 'The port must be between 1 and 65535' };
  return { port };
}

/** The port "Add as session" prefills from a hit's open ports: 22, else the first SSH-looking one (2222, 22000…), else the first open port, else 22. */
export function sshPortOf(ports) {
  const list = Array.isArray(ports) ? ports : [];
  if (list.includes(22)) return 22;
  return list.find((p) => /^22\d*$/.test(String(p))) ?? list[0] ?? 22;
}

/** The Ports column, ascending: fewer open ports first, then the lowest port number. */
export function comparePorts(a, b) {
  return a.ports.length - b.ports.length || (a.ports[0] ?? 1e6) - (b.ports[0] ?? 1e6);
}
