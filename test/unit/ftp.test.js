'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MOBALT_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-ftp-'));
const { FtpManager, explainFtpError } = require('../../src/main/ftp');

test('explainFtpError: server replies become readable text and keep their code', () => {
  const t = (msg, code) => { const e = new Error(msg); if (code) e.code = code; return explainFtpError(e); };
  assert.equal(t('530 Authentication failed.').message, 'Login failed (530): check the username/password');
  assert.equal(t('530 Authentication failed.').code, 530);
  assert.equal(t('FTPError: 530 Login incorrect.').message, 'Login failed (530): check the username/password');
  assert.equal(t('500 Command "AUTH" not understood.').message, 'The server does not support FTPS (explicit TLS); untick FTPS');
  assert.equal(t('502 AUTH not implemented').message, 'The server does not support FTPS (explicit TLS); untick FTPS');
  assert.match(t('550 File exists.').message, /^The name already exists on the server \(550 File exists\)$/);
  assert.match(t('550 No such file or directory.').message, /^Path not found on the server \(550/);
  assert.match(t('553 Could not create file.').message, /^The server refused the operation \(553/);
  assert.match(t('550 Not enough privileges.').message, /^Permission denied on the server \(550/);
  assert.match(t('421 Service not available.').message, /^The server closed the connection \(421/);
  assert.match(t('connect ECONNREFUSED 127.0.0.1:2121', 'ECONNREFUSED').message, /^Connection refused \(127\.0\.0\.1:2121\)/);
  assert.match(t('getaddrinfo ENOTFOUND nowhere.invalid', 'ENOTFOUND').message, /^Host not found/);
  assert.match(t('self signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT').message, /^TLS certificate not trusted/);
  // anything else is passed through untouched (same Error object)
  const plain = new Error('FTP session is closed');
  assert.equal(explainFtpError(plain), plain);
  assert.equal(explainFtpError('User closed client during task').message, 'User closed client during task');
});

/** Minimal FTP control server that refuses every login; records whether the client closed its socket. */
function refusingServer() {
  const state = { sockets: [], logins: 0 };
  const srv = net.createServer((sock) => {
    const rec = { sock, closed: false };
    state.sockets.push(rec);
    sock.on('close', () => (rec.closed = true));
    sock.on('error', () => {});
    sock.write('220 test ftpd\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (/^USER /i.test(line)) sock.write('331 Password required\r\n');
        else if (/^PASS /i.test(line)) { state.logins++; sock.write('530 Authentication failed.\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 Unknown\r\n');
      }
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, state })));
}

test('a refused login rejects with readable text and closes its control socket', async () => {
  const { srv, port, state } = await refusingServer();
  try {
    const ftp = new FtpManager({ getSettings: () => ({}), upsertSession: async () => {} }, null);
    await assert.rejects(ftp.connect({ host: '127.0.0.1', port, username: 'demo', password: 'wrong' }), (e) => e.message === 'Login failed (530): check the username/password' && e.code === 530);
    assert.equal(ftp.conns.size, 0, 'no connection is kept');
    assert.equal(state.logins, 1);
    const t0 = Date.now();
    while (!state.sockets.every((s) => s.closed) && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    assert.ok(state.sockets.length >= 1 && state.sockets.every((s) => s.closed), 'the client socket of the failed login is closed');
  } finally {
    srv.close();
  }
});

test('a session with a user name but no password asks the prompter; cancel aborts without a socket left open', async () => {
  const { srv, port, state } = await refusingServer();
  try {
    const asked = [];
    const prompter = { password: async (info) => { asked.push(info); return null; } };
    const ftp = new FtpManager({ getSettings: () => ({}), upsertSession: async () => {} }, prompter);
    await assert.rejects(ftp.connect({ host: '127.0.0.1', port, username: 'demo' }), /authentication cancelled/);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].kind, 'password');
    assert.match(asked[0].message, /demo@127\.0\.0\.1's FTP password/);
    assert.equal(state.logins, 0, 'nothing was sent to the server');
    // a typed password that the server refuses is asked again (up to three times), then the error is reported
    let n = 0;
    const saved = [];
    const ftp2 = new FtpManager({ getSettings: () => ({}), upsertSession: async (s) => saved.push(s) }, { password: async (info) => ({ password: 'try' + ++n, save: true }) });
    await assert.rejects(ftp2.connect({ id: 'sid', host: '127.0.0.1', port, username: 'demo' }), /Login failed \(530\)/);
    assert.equal(n, 3, 'three attempts');
    assert.equal(saved.length, 0, 'a refused password is never saved');
    assert.equal(state.logins, 3);
  } finally {
    srv.close();
  }
});

test('anonymous when there is no user name: no prompt', async () => {
  const { srv, port, state } = await refusingServer();
  try {
    let asked = 0;
    const ftp = new FtpManager({ getSettings: () => ({}), upsertSession: async () => {} }, { password: async () => { asked++; return null; } });
    await assert.rejects(ftp.connect({ host: '127.0.0.1', port }), /Login failed \(530\)/);
    assert.equal(asked, 0);
    assert.equal(state.logins, 1);
  } finally {
    srv.close();
  }
});
