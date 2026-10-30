// Produces the screenshots used by README / docs. Runs in a fresh user-data folder with made-up sessions,
// local shells whose prompt is overridden, and an FTP session against test/ftpd.py — nothing personal
// ends up in the images.
//   test/qa/run.sh test/qa/docs-shots.js <out-dir> 90000   (after starting the FTP server on 127.0.0.1:2121)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (n) => window.api.app.screenshot(n);
  const app = window.app;
  const log = (...a) => console.log('[docs-shots]', ...a);
  const closeModal = () => document.querySelector('.modal .close')?.click();
  const PROMPT = (host) => `export PS1='demo@${host}:%~$ '; export PROMPT='demo@${host}:%~$ '; clear`;
  try {
    await window.api.app.testResize(1360, 860);
    await app.saveSettings({ confirmClose: false, restoreWorkspace: false, sftpAutoOpen: true });

    // --- a believable session tree (nothing connects to these hosts)
    const mk = (o) => app.saveSession({ type: 'ssh', port: 22, authMethod: 'auto', sftpAuto: true, ...o });
    await mk({ name: 'web-01', folder: 'Production', host: 'web-01.example.com', username: 'deploy', icon: '🌐', color: '#4ea1ff' });
    await mk({ name: 'web-02', folder: 'Production', host: 'web-02.example.com', username: 'deploy', icon: '🌐', color: '#4ea1ff' });
    await mk({ name: 'db-01', folder: 'Production', host: 'db-01.example.com', username: 'postgres', icon: '🗄️', color: '#e6b422' });
    await mk({ name: 'bastion', folder: 'Production', host: 'bastion.example.com', username: 'ops', icon: '🔒', color: '#e5534b' });
    await mk({ name: 'gpu-box', folder: 'Lab', host: '10.0.0.42', username: 'ml', icon: '🚀', color: '#bd93f9', x11: true });
    await mk({ name: 'raspberry', folder: 'Lab', host: 'raspberrypi.local', username: 'pi', icon: '🐧', color: '#4caf50' });
    await app.saveSession({ name: 'router console', folder: 'Lab', type: 'serial', serialPath: '/dev/tty.usbserial-0001', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flow: 'none', icon: '⚙️' });
    await app.saveSession({ name: 'nas', folder: 'Home', type: 'ftp', host: 'nas.local', username: 'admin', icon: '📦', color: '#2fbfa7' });
    await app.saveSession({ name: 'win-desktop', folder: 'Home', type: 'rdp', host: 'desktop.local', username: 'me', icon: '🪟' });
    await app.saveSession({ name: 'Project shell', type: 'local', cwd: '/tmp', icon: '🤖', color: '#7a7dff' });

    // --- hero: two "remote" shells side by side (local shells with a demo prompt)
    const a = await app.openSession({ name: 'web-01', type: 'local', startupCommand: PROMPT('web-01') + "; echo 'deploy@web-01 ~ $ systemctl status nginx'; printf '\\e[32m●\\e[0m nginx.service - A high performance web server\\n   Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\\n   Active: \\e[32mactive (running)\\e[0m since Thu 2026-10-30 09:12:03 KST; 3h ago\\n     Docs: man:nginx(8)\\n Main PID: 1182 (nginx)\\n    Tasks: 5 (limit: 9389)\\n\\n'; printf 'deploy@web-01 ~ $ tail -3 /var/log/nginx/access.log\\n10.0.0.7 - - [30/Oct/2026:12:01:14 +0900] \"GET /api/health HTTP/1.1\" 200 17\\n10.0.0.9 - - [30/Oct/2026:12:01:15 +0900] \"POST /api/jobs HTTP/1.1\" 201 311\\n10.0.0.7 - - [30/Oct/2026:12:01:17 +0900] \"GET /static/app.js HTTP/1.1\" 304 0\\n'" });
    await sleep(1800);
    const b = await app.openSession({ name: 'db-01', type: 'local', startupCommand: PROMPT('db-01') + "; printf 'postgres@db-01 ~ $ psql -c \"select count(*) from jobs where state = %s\"\\n count \\n-------\\n 48213\\n(1 row)\\n\\n' \"'done'\"; printf 'postgres@db-01 ~ $ \\e[36mhtop\\e[0m\\n  CPU[\\e[32m||||||||||\\e[0m          23%%]   Tasks: 112, 203 thr; 2 running\\n  Mem[\\e[33m||||||||||||||||||\\e[0m 5.1G/16G]   Load average: 0.72 0.80 0.91\\n  Swp[                   0K/0K]   Uptime: 41 days, 03:12:55\\n'" }, { split: 'right', target: a });
    await sleep(2200);
    app.showPanel('sessions');
    await shot('hero');

    // --- split grid 2x2 with placeholders
    app.applyLayout('2x2');
    await sleep(500);
    await shot('split-grid');
    app.unsplit();
    await sleep(300);

    // --- FTP session → file browser panel (looks exactly like the SFTP panel)
    const ftp = await app.openSession({ name: 'nas', type: 'ftp', host: '127.0.0.1', port: 2121, username: 'demo', password: 'demo', sftpAuto: true });
    await sleep(4000); // let earlier toasts expire
    await shot('sftp-panel');
    await ftp.disconnect();

    // --- session editor (SSH, Basic tab) and its Tunnels tab
    app.editSession(app.sessions.sessions.find((s) => s.name === 'web-01'));
    await sleep(400);
    await shot('session-editor');
    document.querySelectorAll('.modal .mtabs button')[3]?.click();
    await sleep(300);
    await shot('session-editor-tunnels');
    closeModal();

    // --- tunnels manager
    app.action('tunnels');
    await sleep(500);
    await shot('tunnels');
    closeModal();

    // --- settings
    app.action('settings');
    await sleep(400);
    await shot('settings');
    closeModal();

    // --- tools panel with a ping
    app.showPanel('tools');
    document.getElementById('tool-host').value = '127.0.0.1';
    document.querySelector('#panel-tools button')?.click();
    await sleep(2500);
    await shot('tools');
    app.showPanel('sessions');
    log('DONE');
  } catch (e) {
    console.error('[docs-shots] FAIL', e.message, e.stack);
  }
  window.api.app.quit();
})();
