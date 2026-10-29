'use strict';
// SSH connection manager: one ssh2 Client per terminal (like MobaXterm),
// with shell, SFTP channel, X11 forwarding, jump hosts and tunnels attached.
const { Client, utils } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const knownhosts = require('./knownhosts');
const x11 = require('./x11');

const GREY = '\x1b[90m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Prompt hook injected into the remote shell when "follow terminal folder" is on.
const FOLLOW_HOOK =
  `if [ -n "$ZSH_VERSION" ]; then __mobalt_cwd(){ printf '\\033]7;file://%s%s\\a' "$HOST" "$PWD"; }; precmd_functions+=(__mobalt_cwd); ` +
  `elif [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="printf '\\033]7;file://%s%s\\a' \\"\\$HOSTNAME\\" \\"\\$PWD\\"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi; clear`;

class SshManager {
  /**
   * @param registry TerminalRegistry
   * @param store Store
   * @param prompter {hostKey(info)->Promise<bool>, password(info)->Promise<{password,save}|null>,
   *                  keyboardInteractive(info)->Promise<string[]|null>, status(id, state, msg)}
   */
  constructor(registry, store, prompter) {
    this.registry = registry;
    this.store = store;
    this.prompter = prompter;
    this.conns = new Map();
  }

  get(id) {
    return this.conns.get(id);
  }

  _out(id, text) {
    this.registry.data(id, text);
  }

  /** Build an async authHandler for ssh2. */
  _buildAuthHandler(cfg, ctx) {
    const username = cfg.username || os.userInfo().username;
    const method = cfg.authMethod || 'auto';
    const prompter = this.prompter;
    const steps = [];
    const label = `${username}@${cfg.host}`;

    steps.push({ type: 'none', run: async () => ({ type: 'none', username }) });

    if ((method === 'key' || method === 'auto') && cfg.privateKeyPath) {
      steps.push({
        type: 'publickey',
        run: async () => {
          let raw;
          try {
            raw = fs.readFileSync(expandHome(cfg.privateKeyPath));
          } catch (e) {
            ctx.out(`${RED}Cannot read private key ${cfg.privateKeyPath}: ${e.message}${RESET}\r\n`);
            return null;
          }
          let passphrase = cfg.passphrase || undefined;
          let parsed = utils.parseKey(raw, passphrase);
          let tries = 0;
          while (parsed instanceof Error && /passphrase/i.test(parsed.message) && tries < 3) {
            tries++;
            const ans = await prompter.password({
              kind: 'passphrase',
              title: 'Private key passphrase',
              message: `Enter passphrase for key ${cfg.privateKeyPath}`,
              session: cfg,
            });
            if (!ans) return null;
            passphrase = ans.password;
            parsed = utils.parseKey(raw, passphrase);
            if (!(parsed instanceof Error) && ans.save && cfg.id) {
              this.store.upsertSession({ ...cfg, passphrase });
            }
          }
          if (parsed instanceof Error) {
            ctx.out(`${RED}Invalid private key: ${parsed.message}${RESET}\r\n`);
            return null;
          }
          return { type: 'publickey', username, key: raw, passphrase };
        },
      });
    }
    if ((method === 'agent' || method === 'auto') && process.env.SSH_AUTH_SOCK) {
      steps.push({ type: 'agent', run: async () => ({ type: 'agent', username, agent: process.env.SSH_AUTH_SOCK }) });
    }
    if ((method === 'password' || method === 'auto') && cfg.password) {
      steps.push({ type: 'password', run: async () => ({ type: 'password', username, password: cfg.password }) });
    }
    // keyboard-interactive (PAM / 2FA). Try the saved password first for a lone password prompt.
    let kbdUsedSaved = false;
    steps.push({
      type: 'keyboard-interactive',
      run: async () => ({
        type: 'keyboard-interactive',
        username,
        prompt: (name, instructions, lang, prompts, finish) => {
          if (prompts.length === 1 && /pass/i.test(prompts[0].prompt) && cfg.password && !kbdUsedSaved) {
            kbdUsedSaved = true;
            return finish([cfg.password]);
          }
          prompter
            .keyboardInteractive({ name, instructions, prompts, session: cfg, label })
            .then((answers) => finish(answers || []))
            .catch(() => finish([]));
        },
      }),
    });
    for (let i = 0; i < 3; i++) {
      steps.push({
        type: 'password',
        run: async () => {
          const ans = await prompter.password({
            kind: 'password',
            title: 'SSH password',
            message: `${label}'s password${i > 0 ? ' (retry ' + i + ')' : ''}`,
            session: cfg,
          });
          if (!ans) return false; // abort
          ctx.lastPrompted = ans;
          return { type: 'password', username, password: ans.password };
        },
      });
    }

    let idx = 0;
    return (methodsLeft, partialSuccess, cb) => {
      const next = async () => {
        while (idx < steps.length) {
          const step = steps[idx++];
          if (Array.isArray(methodsLeft) && step.type !== 'none' && !methodsLeft.includes(step.type)) continue;
          let res;
          try {
            res = await step.run();
          } catch (e) {
            res = null;
          }
          if (res === false) return cb(false);
          if (res) {
            ctx.currentAuth = step.type;
            return cb(res);
          }
        }
        cb(false);
      };
      next();
    };
  }

  _hostVerifier(cfg, ctx) {
    return (key, cb) => {
      const status = knownhosts.check(cfg.host, cfg.port || 22, key);
      if (status === 'ok') return cb(true);
      const fp = knownhosts.fingerprint(key);
      this.prompter
        .hostKey({ host: cfg.host, port: cfg.port || 22, keyType: knownhosts.readKeyType(key), fingerprint: fp, status })
        .then((ok) => {
          if (ok) {
            if (status === 'mismatch') knownhosts.forget(cfg.host, cfg.port || 22);
            knownhosts.remember(cfg.host, cfg.port || 22, key);
          }
          cb(!!ok);
        })
        .catch(() => cb(false));
    };
  }

  /** Resolve a jump host spec (session id or user@host:port) to a session cfg. */
  _resolveJump(cfg) {
    if (cfg.jumpSessionId) {
      const s = this.store.getSession(cfg.jumpSessionId);
      if (s) return s;
    }
    if (cfg.jumpHost) {
      const m = /^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/.exec(cfg.jumpHost.trim());
      if (m) {
        return {
          name: cfg.jumpHost,
          type: 'ssh',
          host: m[2],
          port: m[3] ? parseInt(m[3], 10) : 22,
          username: m[1] || cfg.username,
          authMethod: 'auto',
          privateKeyPath: cfg.privateKeyPath,
          password: cfg.jumpPassword,
        };
      }
    }
    return null;
  }

  /**
   * Connect a raw ssh2 Client for cfg (used for shells and standalone tunnels).
   * @returns {Promise<{client: Client, jump: Client|null}>}
   */
  connectClient(cfg, ctx, depth = 0) {
    return new Promise(async (resolve, reject) => {
      const settings = this.store.getSettings();
      const client = new Client();
      let settled = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      };

      const jumpCfg = depth < 3 ? this._resolveJump(cfg) : null;
      let jump = null;
      let sock;
      if (jumpCfg) {
        ctx.out(`${GREY}Connecting to jump host ${jumpCfg.username || ''}@${jumpCfg.host}:${jumpCfg.port || 22}...${RESET}\r\n`);
        try {
          const j = await this.connectClient(jumpCfg, ctx, depth + 1);
          jump = j.client;
          sock = await new Promise((res, rej) =>
            jump.forwardOut('127.0.0.1', 0, cfg.host, cfg.port || 22, (err, stream) => (err ? rej(err) : res(stream)))
          );
          ctx.out(`${GREY}Jump established, connecting to ${cfg.host}:${cfg.port || 22}...${RESET}\r\n`);
        } catch (e) {
          if (jump) jump.end();
          return fail(new Error(`Jump host failed: ${e.message}`));
        }
      }

      client.on('ready', () => {
        if (settled) return;
        settled = true;
        resolve({ client, jump });
      });
      client.on('error', (e) => {
        if (!settled) fail(e);
        else if (ctx.onError) ctx.onError(e);
      });
      client.on('banner', (msg) => ctx.out(msg.replace(/\r?\n/g, '\r\n')));
      client.on('close', () => {
        if (jump) jump.end();
        if (ctx.onClose) ctx.onClose();
      });

      const connectCfg = {
        host: cfg.host,
        port: cfg.port || 22,
        username: cfg.username || os.userInfo().username,
        authHandler: this._buildAuthHandler(cfg, ctx),
        hostVerifier: this._hostVerifier(cfg, ctx),
        keepaliveInterval: (cfg.keepAliveInterval ?? settings.keepAliveInterval ?? 30) * 1000,
        keepaliveCountMax: 3,
        readyTimeout: settings.readyTimeout || 20000,
        compress: !!cfg.compression,
        agentForward: !!cfg.agentForward && !!process.env.SSH_AUTH_SOCK,
        agent: cfg.agentForward ? process.env.SSH_AUTH_SOCK : undefined,
        tryKeyboard: true,
        algorithms: cfg.legacyAlgorithms
          ? { kex: { append: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1'] },
              serverHostKey: { append: ['ssh-rsa', 'ssh-dss'] },
              cipher: { append: ['aes128-cbc', 'aes256-cbc', '3des-cbc'] } }
          : undefined,
      };
      if (sock) connectCfg.sock = sock;
      try {
        client.connect(connectCfg);
      } catch (e) {
        fail(e);
      }
    });
  }

  /** Open an interactive shell for a session config. Returns the terminal id immediately. */
  openShell(cfg, { cols = 80, rows = 24 } = {}) {
    const id = this.registry.newId();
    const registry = this.registry;
    const info = { id, cfg, client: null, jump: null, stream: null, sftp: null, x11: null, cols, rows, closed: false, remoteForwards: new Map() };
    this.conns.set(id, info);
    let pending = '';
    registry.register(id, {
      kind: 'ssh',
      write: (d) => (info.stream ? info.stream.write(d) : (pending += d)),
      resize: (c, r) => {
        info.cols = c;
        info.rows = r;
        if (info.stream) info.stream.setWindow(r, c, 0, 0);
      },
      kill: () => this.disconnect(id),
    });

    const ctx = {
      out: (t) => this._out(id, t),
      onError: (e) => this._out(id, `\r\n${RED}SSH error: ${e.message}${RESET}\r\n`),
      onClose: () => {
        if (info.closed) return;
        info.closed = true;
        this.conns.delete(id);
        this.prompter.status(id, 'disconnected');
        registry.exit(id, 0, 'closed');
      },
    };

    this.prompter.status(id, 'connecting');
    this._out(id, `${GREY}Connecting to ${cfg.username || os.userInfo().username}@${cfg.host}:${cfg.port || 22}...${RESET}\r\n`);

    this.connectClient(cfg, ctx)
      .then(async ({ client, jump }) => {
        info.client = client;
        info.jump = jump;
        // Remember a prompted password if the user asked to save it.
        if (ctx.lastPrompted && ctx.lastPrompted.save && cfg.id && ctx.currentAuth === 'password') {
          this.store.upsertSession({ ...cfg, password: ctx.lastPrompted.password });
          cfg.password = ctx.lastPrompted.password;
        }
        const shellOpts = { term: 'xterm-256color', cols: info.cols, rows: info.rows };
        if (cfg.x11) {
          const xp = await x11.prepare((msg) => this._out(id, `${GREY}X11: ${msg}${RESET}\r\n`));
          if (info.closed) return;
          if (xp) {
            info.x11 = xp;
            shellOpts.x11 = { single: false, screen: xp.screen, protocol: xp.protocol, cookie: xp.fakeCookie };
            let x11Warned = false;
            client.on('x11', (details, accept, reject) => {
              try {
                x11.proxy(accept(), xp, (msg) => {
                  if (x11Warned) return;
                  x11Warned = true;
                  this._out(id, `\r\n${RED}X11: ${msg}${RESET}\r\n`);
                });
              } catch (e) {
                reject();
              }
            });
          } else {
            this._out(id, `${RED}X11 forwarding requested but no local X server found (install/start XQuartz).${RESET}\r\n`);
          }
        }
        client.on('tcp connection', (details, accept, reject) => {
          const h = info.remoteForwards.get(details.destPort);
          if (h) h(details, accept, reject);
          else reject();
        });
        client.shell(shellOpts, (err, stream) => {
          if (err) {
            this._out(id, `${RED}Failed to open shell: ${err.message}${RESET}\r\n`);
            client.end();
            return;
          }
          info.stream = stream;
          const dec = new StringDecoder('utf8');
          const decErr = new StringDecoder('utf8');
          stream.on('data', (d) => registry.data(id, dec.write(d)));
          stream.stderr.on('data', (d) => registry.data(id, decErr.write(d)));
          stream.on('close', () => client.end());
          this.prompter.status(id, 'connected');
          if (pending) {
            stream.write(pending);
            pending = '';
          }
          const inject = [];
          if (cfg.followCwd) inject.push(' ' + FOLLOW_HOOK);
          if (cfg.startupCommand) inject.push(cfg.startupCommand);
          if (inject.length) setTimeout(() => info.stream && info.stream.write(inject.join('\r') + '\r'), 700);
        });
      })
      .catch((e) => {
        this._out(id, `\r\n${RED}Connection failed: ${e.message}${RESET}\r\n`);
        this.prompter.status(id, 'failed', e.message);
        if (!info.closed) {
          info.closed = true;
          this.conns.delete(id);
          registry.exit(id, 1, 'failed');
        }
      });
    return { id };
  }

  disconnect(id) {
    const info = this.conns.get(id);
    if (!info) return;
    try {
      if (info.stream) info.stream.end();
    } catch {}
    try {
      if (info.client) info.client.end();
      else {
        // still connecting: mark closed; close handler will fire when client errors
        info.closed = true;
        this.conns.delete(id);
        this.registry.exit(id, 0, 'cancelled');
      }
    } catch {}
    if (info.jump) {
      try {
        info.jump.end();
      } catch {}
    }
  }

  disconnectAll() {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
  }

  /** Get (opening if needed) the SFTP channel for a connection. */
  sftp(id) {
    const info = this.conns.get(id);
    if (!info || !info.client) return Promise.reject(new Error('Not connected'));
    if (info.sftp) return Promise.resolve(info.sftp);
    if (info.sftpPromise) return info.sftpPromise;
    info.sftpPromise = new Promise((resolve, reject) => {
      info.client.sftp((err, sftp) => {
        info.sftpPromise = null;
        if (err) return reject(err);
        info.sftp = sftp;
        sftp.on('close', () => (info.sftp = null));
        resolve(sftp);
      });
    });
    return info.sftpPromise;
  }

  exec(id, cmd) {
    const info = this.conns.get(id);
    if (!info || !info.client) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      info.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', errOut = '';
        stream.on('data', (d) => (out += d));
        stream.stderr.on('data', (d) => (errOut += d));
        stream.on('close', (code) => resolve({ code, stdout: out, stderr: errOut }));
      });
    });
  }
}

module.exports = { SshManager, expandHome };
