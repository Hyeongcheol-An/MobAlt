'use strict';
// Other running instances of this MobAlt.app, for the updater's "Restart now". Squirrel's ShipIt installs only once
// every process of the bundle has exited (SQRLTerminationListener): with a second MobAlt open (`open -n`, another
// user-data folder), quitAndInstall quits this one and nothing happens until the other quits — minutes or hours
// later, with a relaunch nobody expected. The updater asks here first and tells the user instead of quitting.
//
// An instance is a process running the bundle's main executable (`<bundle>/Contents/MacOS/MobAlt`): the Renderer,
// GPU and Utility helpers (Contents/Frameworks/MobAlt Helper*.app), crashpad and ShipIt also live in the bundle but
// are not instances. Our own process and anything it started are left out by the parent chain.
const { execFile } = require('child_process');

/**
 * Parse `ps -axo pid,ppid,comm` and return the pids of the other main processes of `exe`.
 * @param text  the ps output (a header line, then "  pid  ppid /full/path/of/the executable" — the path may contain spaces)
 * @param exe   this instance's main executable (app.getPath('exe'))
 * @param pid   our own pid: it and its descendants are never "another instance"
 */
function parseOtherInstances(text, exe, pid) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
  const ours = (p) => { // p is us or one of our descendants (bounded walk: a broken table never loops)
    for (let i = 0; i < 64 && p > 1; i++) {
      if (p === pid) return true;
      p = parent.get(p);
      if (p === undefined) return false;
    }
    return false;
  };
  return rows.filter((r) => r.comm === exe && !ours(r.pid)).map((r) => r.pid);
}

/**
 * Resolves with the pids of the other running instances of this bundle; [] when ps cannot be read (the install then
 * goes ahead as before: an unknown answer must not take Restart now away).
 */
function otherInstances(exe, pid = process.pid) {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid,ppid,comm'], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      try { resolve(parseOtherInstances(stdout, exe, pid)); } catch { resolve([]); }
    });
  });
}

module.exports = { parseOtherInstances, otherInstances };
