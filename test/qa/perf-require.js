'use strict';
// Main-process require cost (test/qa/perf.js, dev checkout only). Run as Electron's main script in a fresh process:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron test/qa/perf-require.js            # src/main in main.js order
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron test/qa/perf-require.js ssh2 …     # these packages, in that order
// Prints PERF-REQUIRE { items: [[name, ms]], total } — what main.js pays before its first line of work runs, or what
// one package costs on its own (a module already loaded by an earlier one costs nothing: order matters).
const path = require('path');
const { app } = require('electron');
const root = path.resolve(__dirname, '..', '..');
const MAIN_ORDER = ['store', 'terminals', 'ssh', 'sftp', 'ftp', 'updater', 'tunnels', 'importers', 'tools', 'wol', 'netscan', 'x11', 'knownhosts', 'keygen', 'algorithms', 'live', 'bundlewatch', 'dialogs', 'i18n', 'monitor', 'zmodem'];
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-') && a !== root && !a.endsWith('perf-require.js'));
app.whenReady().then(() => {
  const items = [];
  const t0 = process.hrtime.bigint();
  const time = (label, fn) => { const a = process.hrtime.bigint(); try { fn(); } catch (e) { items.push([label, null, e.message]); return; } items.push([label, Math.round(Number(process.hrtime.bigint() - a) / 1e4) / 100]); };
  if (wanted.length) for (const w of wanted) time(w, () => require(path.join(root, 'node_modules', w)));
  else for (const m of MAIN_ORDER) time('src/main/' + m, () => require(path.join(root, 'src', 'main', m)));
  console.log('PERF-REQUIRE ' + JSON.stringify({ items, total: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100 }));
  app.exit(0);
});
