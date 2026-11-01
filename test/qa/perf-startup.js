// Start-up timing for test/qa/perf.js: the renderer's paint entries, the marks app.js sets (mobalt:ready at the end of
// init(), mobalt:first-output on the first terminal output — the shell's prompt on a fresh start) and the main
// process's boot timestamps (test:perf), all as epoch milliseconds so the runner can relate them to the moment it
// started the process. Quits as soon as the first output arrived (or after 15 s).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 15000;
  while (!performance.getEntriesByName('mobalt:first-output').length && Date.now() < deadline) await sleep(10);
  const abs = (t) => Math.round(performance.timeOrigin + t);
  const r = { timeOrigin: Math.round(performance.timeOrigin) };
  for (const p of performance.getEntriesByType('paint')) r[p.name] = abs(p.startTime);
  for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('mobalt:')) r[m.name === 'mobalt:ready' ? 'uiReady' : m.name.slice(7)] = abs(m.startTime);
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) { r.domContentLoaded = abs(nav.domContentLoadedEventEnd); r.load = abs(nav.loadEventEnd); }
  const frames = window.api.app.testFirstFrames();
  if (frames.length) r.firstFrame = abs(frames[0].t);
  const perf = await window.api.app.testPerf();
  r.boot = perf && perf.boot;
  r.panes = window.app.workspace.allPanes().length;
  console.log('PERF-STARTUP ' + JSON.stringify(r));
  window.api.app.quit();
})();
