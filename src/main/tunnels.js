'use strict';
// SSH port forwarding: local (-L), remote (-R) and dynamic SOCKS5 (-D) tunnels,
// either attached to a terminal's connection or standalone (own SSH connection).
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const i18n = require('./i18n'); // interface language: every message shown to the user goes through i18n.t() (`t` names the tunnel in this file)

function pipe(a, b) {
  a.pipe(b).pipe(a);
  const kill = () => {
    try { a.destroy(); } catch {}
    try { b.destroy(); } catch {}
  };
  a.on('error', kill);
  b.on('error', kill);
  a.on('close', kill);
  b.on('close', kill);
}

class TunnelManager extends EventEmitter {
  constructor(sshManager, store) {
    super();
    this.ssh = sshManager;
    this.store = store;
    this.tunnels = new Map(); // id -> tunnel
  }

  list() {
    return [...this.tunnels.values()].map((t) => ({
      id: t.id, name: t.name, type: t.type, bindHost: t.bindHost, bindPort: t.bindPort, destHost: t.destHost, destPort: t.destPort,
      status: t.status, error: t.error, connId: t.connId, sessionId: t.sessionId, sessionName: t.sessionName, connections: t.connections, bytes: t.bytes,
    }));
  }

  _emit() {
    this.emit('changed', this.list());
  }

  _counter(t, stream) {
    stream.on('data', (d) => (t.bytes += d.length));
  }

  /** Start a tunnel on an existing ssh2 client. */
  async _startOnClient(t, client, info) {
    t.bytes = 0;
    t.connections = 0;
    if (t.type === 'local') {
      await new Promise((resolve, reject) => {
        const server = net.createServer((sock) => {
          t.connections++;
          this._emit();
          client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, t.destHost, t.destPort, (err, stream) => {
            if (err) {
              sock.destroy();
              t.connections--;
              return;
            }
            this._counter(t, stream);
            pipe(sock, stream);
            sock.on('close', () => { t.connections--; this._emit(); });
          });
        });
        server.on('error', reject);
        server.listen(t.bindPort, t.bindHost || '127.0.0.1', () => {
          t.bindPort = server.address().port;
          resolve();
        });
        t.server = server;
      });
    } else if (t.type === 'remote') {
      if (!info) throw new Error(i18n.t('Remote forwards need a connection context'));
      await new Promise((resolve, reject) => {
        client.forwardIn(t.bindHost || '127.0.0.1', t.bindPort, (err, port) => {
          if (err) return reject(err);
          if (port) t.bindPort = port;
          resolve();
        });
      });
      info.remoteForwards.set(t.bindPort, (details, accept, reject) => {
        const stream = accept();
        t.connections++;
        this._emit();
        const sock = net.connect(t.destPort, t.destHost);
        this._counter(t, sock);
        sock.on('connect', () => pipe(sock, stream));
        sock.on('error', () => stream.close());
        stream.on('close', () => { t.connections--; this._emit(); });
      });
      t.stopRemote = () => {
        info.remoteForwards.delete(t.bindPort);
        // The connection may already be gone (ssh2 then throws "Not connected" synchronously).
        try { client.unforwardIn(t.bindHost || '127.0.0.1', t.bindPort, () => {}); } catch {}
      };
    } else if (t.type === 'dynamic') {
      await new Promise((resolve, reject) => {
        const server = net.createServer((sock) => this._socks5(sock, client, t));
        server.on('error', reject);
        server.listen(t.bindPort, t.bindHost || '127.0.0.1', () => {
          t.bindPort = server.address().port;
          resolve();
        });
        t.server = server;
      });
    } else {
      throw new Error(i18n.t('Unknown tunnel type {type}', { type: t.type }));
    }
    t.status = 'active';
    t.error = null;
  }

  /** Minimal SOCKS5 (no auth, CONNECT) over ssh forwardOut. */
  _socks5(sock, client, t) {
    let stage = 0;
    let buf = Buffer.alloc(0);
    const fail = (code = 0x01) => {
      try { sock.end(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); } catch {}
    };
    sock.on('error', () => {});
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0) {
        if (buf.length < 2) return;
        const n = buf[1];
        if (buf.length < 2 + n) return;
        if (buf[0] !== 0x05) return sock.destroy();
        sock.write(Buffer.from([0x05, 0x00]));
        buf = buf.slice(2 + n);
        stage = 1;
      }
      if (stage === 1) {
        if (buf.length < 4) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x01) return fail(0x07);
        const atyp = buf[3];
        let host, off;
        if (atyp === 0x01) {
          if (buf.length < 10) return;
          host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
          off = 8;
        } else if (atyp === 0x03) {
          if (buf.length < 5) return;
          const l = buf[4];
          if (buf.length < 5 + l + 2) return;
          host = buf.slice(5, 5 + l).toString('utf8');
          off = 5 + l;
        } else if (atyp === 0x04) {
          if (buf.length < 22) return;
          const parts = [];
          for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
          host = parts.join(':');
          off = 20;
        } else return fail(0x08);
        const port = buf.readUInt16BE(off);
        const rest = buf.slice(off + 2);
        stage = 2;
        sock.removeListener('data', onData);
        t.connections++;
        this._emit();
        client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
          if (err) {
            t.connections--;
            return fail(0x05);
          }
          sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          if (rest.length) stream.write(rest);
          this._counter(t, stream);
          pipe(sock, stream);
          sock.on('close', () => { t.connections--; this._emit(); });
        });
      }
    };
    sock.on('data', onData);
  }

  /** Start a tunnel bound to an open terminal connection. */
  async startForConnection(connId, spec) {
    const info = this.ssh.get(connId);
    if (!info || !info.client) throw new Error(i18n.t('Connection not ready'));
    const t = { ...spec, id: spec.id || 'tn_' + crypto.randomBytes(4).toString('hex'), connId, status: 'starting', sessionName: info.cfg.name, sessionId: info.cfg.id };
    this.tunnels.set(t.id, t);
    try {
      await this._startOnClient(t, info.client, info);
    } catch (e) {
      t.status = 'error';
      t.error = e.message;
    }
    this._emit();
    return t.id;
  }

  /** Start a standalone tunnel with its own SSH connection to a saved session. */
  async startStandalone(spec) {
    const cfg = await this.store.getSession(spec.sessionId);
    if (!cfg) throw new Error(i18n.t('Session not found'));
    const t = { ...spec, id: spec.id || 'tn_' + crypto.randomBytes(4).toString('hex'), status: 'connecting', sessionName: cfg.name, sessionId: cfg.id, log: '' };
    this.tunnels.set(t.id, t);
    this._emit();
    const ctx = {
      out: (s) => (t.log += s),
      onError: (e) => { t.error = e.message; this._emit(); },
      onClose: () => {
        if (t.status !== 'stopped') { t.status = 'disconnected'; this._emit(); }
        if (t.server) { try { t.server.close(); } catch {} }
      },
    };
    try {
      const { client, jump } = await this.ssh.connectClient(cfg, ctx);
      t.client = client;
      t.jump = jump;
      const info = { remoteForwards: new Map(), cfg };
      client.on('tcp connection', (details, accept, reject) => {
        const h = info.remoteForwards.get(details.destPort);
        if (h) h(details, accept, reject);
        else reject();
      });
      await this._startOnClient(t, client, info);
    } catch (e) {
      t.status = 'error';
      t.error = e.message;
      if (t.client) t.client.end();
    }
    this._emit();
    return t.id;
  }

  stop(id) {
    const t = this.tunnels.get(id);
    if (!t) return;
    t.status = 'stopped';
    if (t.server) { try { t.server.close(); } catch {} }
    if (t.stopRemote) { try { t.stopRemote(); } catch {} }
    if (t.client) { try { t.client.end(); } catch {} }
    this.tunnels.delete(id);
    this._emit();
  }

  stopForConnection(connId) {
    for (const [id, t] of this.tunnels) if (t.connId === connId) this.stop(id);
  }

  stopAll() {
    for (const id of [...this.tunnels.keys()]) this.stop(id);
  }
}

module.exports = { TunnelManager };
