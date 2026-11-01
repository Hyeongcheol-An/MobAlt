#!/usr/bin/env node
'use strict';
// A small ssh2-based SSH server for the auth end-to-end checks (test/start-servers.sh): password-only or
// keyboard-interactive-only, no sftp subsystem.
//   node test/sshsrv.js --port N --mode password|kbdint|kbdint1|banner [--hostkey FILE] [--log FILE]
// password: only "password" is offered; the password is qa-pass-1.
// kbdint:   only "keyboard-interactive" is offered; two prompts (code 4242 hidden, colour shown) with a title/instructions.
// kbdint1:  one hidden "Password: " prompt (qa-pass-1) — the lone-prompt path (a saved password is sent once).
// banner:   like password, with a pre-auth banner.
// The shell echoes "you said: <line>"; exec answers "ok"; a subsystem request (sftp) is refused. Nothing secret is logged.
const { Server } = require('ssh2');
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const port = parseInt(opt('port', '42504'), 10);
const mode = opt('mode', 'password');
const hostkey = opt('hostkey', path.join(__dirname, 'sshd-runtime', 'host_ed25519'));
const logFile = opt('log', '');
const PASS = 'qa-pass-1', CODE = '4242';
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`;
  process.stderr.write(line + '\n');
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch {} }
};

const srv = new Server({ hostKeys: [fs.readFileSync(hostkey)], ident: 'SSH-2.0-QAsrv_1.0', banner: mode === 'banner' ? 'QA banner: welcome to the fake server\n' : undefined }, (client, info) => {
  let attempts = 0;
  log('client from', info.ip + ':' + info.port, 'ident', info.header.identRaw);
  client.on('authentication', (ctx) => {
    attempts++;
    log('auth', ctx.method, 'user=' + ctx.username, 'attempt', attempts);
    if (mode === 'password' || mode === 'banner') {
      if (ctx.method === 'password') {
        if (ctx.password === PASS) { log('password accepted'); return ctx.accept(); }
        log('password wrong (' + ctx.password.length + ' chars)');
        return ctx.reject(['password']);
      }
      return ctx.reject(['password']);
    }
    if (mode === 'kbdint' || mode === 'kbdint1') {
      if (ctx.method !== 'keyboard-interactive') return ctx.reject(['keyboard-interactive']);
      const prompts = mode === 'kbdint1' ? [{ prompt: 'Password: ', echo: false }] : [{ prompt: 'Verification code: ', echo: false }, { prompt: 'Favourite colour: ', echo: true }];
      ctx.prompt(prompts, 'QA two-factor', 'Enter the code 4242 (and any colour).', (answers) => {
        if (!Array.isArray(answers)) { log('kbdint aborted', answers && answers.message); return ctx.reject(['keyboard-interactive']); }
        log('kbdint answers', answers.map((a) => (a ? '<' + a.length + ' chars>' : '<empty>')).join(', '));
        if (answers[0] === (mode === 'kbdint1' ? PASS : CODE)) { log('kbdint accepted'); return ctx.accept(); }
        ctx.reject(['keyboard-interactive']);
      });
      return;
    }
    ctx.reject();
  });
  client.on('ready', () => {
    log('authenticated');
    client.on('session', (accept) => {
      const s = accept();
      s.on('pty', (a) => a && a());
      s.on('window-change', (a) => a && a());
      s.on('env', (a) => a && a());
      s.on('subsystem', (a, reject, info2) => { log('subsystem refused', info2 && info2.name); reject(); });
      s.on('shell', (accept) => {
        const stream = accept();
        stream.write(`QA ${mode} server: shell ready\r\n$ `);
        let buf = '';
        stream.on('data', (d) => {
          for (const ch of d.toString()) {
            if (ch === '\r') {
              stream.write(`\r\nyou said: ${buf}\r\n$ `);
              if (buf === 'exit') { stream.exit(0); stream.end(); }
              buf = '';
            } else if (ch === '\x03') { stream.write('^C\r\n$ '); buf = ''; }
            else { buf += ch; stream.write(ch); }
          }
        });
      });
      s.on('exec', (accept) => { const st = accept(); st.write('ok\n'); st.exit(0); st.end(); });
    });
  });
  client.on('error', (e) => log('client error', e.message));
  client.on('close', () => log('client closed'));
});
srv.on('error', (e) => { log('listen error', e.code || e.message); process.exit(1); });
srv.listen(port, '127.0.0.1', () => log('listening on 127.0.0.1:' + port, 'mode', mode));
