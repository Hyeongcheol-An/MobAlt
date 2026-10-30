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

const { execFile } = require('child_process');

const GREY = '\x1b[90m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const DEFAULT_IDENTITY_FILES = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

let agentKeysCache = null;
/** Public keys (base64 blobs) currently held by ssh-agent; cached for 10 s. */
function agentPublicKeys() {
  if (agentKeysCache && Date.now() - agentKeysCache.at < 10000) return agentKeysCache.promise;
  const promise = new Promise((resolve) => {
    const set = new Set();
    if (!process.env.SSH_AUTH_SOCK) return resolve(set);
    execFile('ssh-add', ['-L'], { env: process.env, timeout: 3000 }, (err, out) => {
      if (!err) {
        for (const line of String(out).split('\n')) {
          const cols = line.trim().split(/\s+/);
          if (cols.length >= 2 && /^(ssh-|ecdsa-|sk-)/.test(cols[0])) set.add(cols[1]);
        }
      }
      resolve(set);
    });
  });
  agentKeysCache = { at: Date.now(), promise };
  return promise;
}

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

    /** Load a private key file, prompting for its passphrase when needed. */
    const loadKey = async (file, display, savePassphrase) => {
      let raw;
      try {
        raw = fs.readFileSync(expandHome(file));
      } catch (e) {
        ctx.out(`${RED}Cannot read private key ${display}: ${e.message}${RESET}\r\n`);
        return null;
      }
      let passphrase = savePassphrase ? cfg.passphrase || undefined : undefined;
      let parsed = utils.parseKey(raw, passphrase);
      let tries = 0;
      while (parsed instanceof Error && /passphrase/i.test(parsed.message) && tries < 3) {
        tries++;
        const ans = await prompter.password({ kind: 'passphrase', title: 'Private key passphrase', message: `${tries ? 'Incorrect passphrase. ' : ''}Enter passphrase for key ${display}`, session: cfg });
        if (!ans) return null;
        passphrase = ans.password;
        parsed = utils.parseKey(raw, passphrase);
        if (!(parsed instanceof Error) && ans.save && cfg.id && savePassphrase) {
          this.store.upsertSession({ ...cfg, passphrase }).catch(() => {});
        }
      }
      if (parsed instanceof Error) {
        ctx.out(`${RED}Invalid private key ${display}: ${parsed.message}${RESET}\r\n`);
        return null;
      }
      return { type: 'publickey', username, key: raw, passphrase, _parsed: parsed };
    };

    if ((method === 'key' || method === 'auto') && cfg.privateKeyPath) {
      steps.push({ type: 'publickey', label: cfg.privateKeyPath, run: () => loadKey(cfg.privateKeyPath, cfg.privateKeyPath, true) });
    }
    // "auto" order: configured key → saved password → ssh-agent keys → default ~/.ssh keys (like the
    // ssh CLI) → keyboard-interactive with the saved password → interactive prompts.
    if ((method === 'password' || method === 'auto') && cfg.password) {
      steps.push({ type: 'password', label: 'saved password', run: async () => ({ type: 'password', username, password: cfg.password }) });
    }
    // Every key is a failed attempt on the server side (MaxAuthTries, fail2ban), so when a password is
    // saved and the server accepts passwords, keys from the agent / default files are not tried.
    const keysWanted = () => !(cfg.password && Array.isArray(ctx.serverMethods) && ctx.serverMethods.includes('password'));
    if ((method === 'agent' || method === 'auto') && process.env.SSH_AUTH_SOCK) {
      steps.push({ type: 'agent', label: 'ssh-agent keys', guard: keysWanted, run: async () => ((await agentPublicKeys()).size ? { type: 'agent', username, agent: process.env.SSH_AUTH_SOCK } : null) });
    }
    if (method === 'auto' || (method === 'key' && !cfg.privateKeyPath)) {
      for (const name of DEFAULT_IDENTITY_FILES) {
        const file = path.join(os.homedir(), '.ssh', name);
        if (!fs.existsSync(file)) continue;
        steps.push({
          type: 'publickey',
          label: `~/.ssh/${name}`,
          guard: keysWanted,
          run: async () => {
            const res = await loadKey(file, `~/.ssh/${name}`, false);
            if (!res) return null;
            // skip keys the agent already offered
            let pub = null;
            try {
              pub = fs.readFileSync(file + '.pub', 'utf8').trim().split(/\s+/)[1];
            } catch {}
            if (!pub && res._parsed) {
              try { pub = res._parsed.getPublicSSH().toString('base64'); } catch {}
            }
            if (pub && (await agentPublicKeys()).has(pub)) return null;
            delete res._parsed;
            return res;
          },
        });
      }
    }
    let kbdUsedSaved = false;
    let promptCount = 0;
    const MAX_PROMPTS = 3;
    // keyboard-interactive (PAM / 2FA): a lone hidden prompt gets the saved password once, else ask the user.
    const kbdStep = (stepLabel) => ({
      type: 'keyboard-interactive',
      label: stepLabel,
      guard: () => promptCount < MAX_PROMPTS,
      run: async () => ({
        type: 'keyboard-interactive',
        username,
        prompt: (name, instructions, lang, prompts, finish) => {
          const lonePassword = prompts.length === 1 && prompts[0].echo === false;
          if (lonePassword && cfg.password && !kbdUsedSaved) {
            kbdUsedSaved = true;
            return finish([cfg.password]);
          }
          if (!prompts.length) return finish([]);
          promptCount++;
          prompter
            .keyboardInteractive({ name, instructions, prompts, session: cfg, label })
            .then((answers) => {
              if (!answers) ctx.cancelled = true;
              finish(answers || []);
            })
            .catch(() => finish([]));
        },
      }),
    });
    if (cfg.password) steps.push(kbdStep('keyboard-interactive (saved password)'));
    for (let i = 0; i < MAX_PROMPTS; i++) {
      steps.push({
        type: 'password',
        label: 'password prompt',
        guard: () => promptCount < MAX_PROMPTS,
        run: async () => {
          promptCount++;
          const ans = await prompter.password({
            kind: 'password',
            title: 'SSH password',
            message: `${label}'s password${promptCount > 1 ? ' (attempt ' + promptCount + ')' : ''}`,
            session: cfg,
          });
          if (!ans) {
            ctx.cancelled = true;
            return false; // abort
          }
          ctx.lastPrompted = ans;
          return { type: 'password', username, password: ans.password };
        },
      });
      steps.push(kbdStep('keyboard-interactive prompt'));
    }

    // ssh2 reports the server's remaining methods by SSH name; agent auth is "publickey" on the wire.
    const WIRE = { none: 'none', publickey: 'publickey', agent: 'publickey', password: 'password', 'keyboard-interactive': 'keyboard-interactive' };
    ctx.tried = ctx.tried || [];
    let idx = 0;
    return (methodsLeft, partialSuccess, cb) => {
      if (Array.isArray(methodsLeft) && !ctx.serverMethods) {
        ctx.serverMethods = methodsLeft.slice();
        ctx.out(`${GREY}Server accepts: ${methodsLeft.join(', ')}${RESET}\r\n`);
      }
      if (ctx.currentLabel && ctx.currentLabel !== 'none') ctx.tried.push(ctx.currentLabel); // previous attempt was rejected
      const next = async () => {
        if (ctx.cancelled) return cb(false);
        while (idx < steps.length) {
          const step = steps[idx++];
          if (Array.isArray(methodsLeft) && step.type !== 'none' && !methodsLeft.includes(WIRE[step.type])) continue;
          if (step.guard && !step.guard()) continue;
          let res;
          try {
            res = await step.run();
          } catch (e) {
            res = null;
          }
          if (res === false) return cb(false);
          if (res) {
            ctx.currentAuth = step.type;
            ctx.currentLabel = step.label || step.type;
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
  async _resolveJump(cfg) {
    if (cfg.jumpSessionId) {
      const s = await this.store.getSession(cfg.jumpSessionId);
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

      const jumpCfg = depth < 3 ? await this._resolveJump(cfg) : null;
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
          cfg.password = ctx.lastPrompted.password;
          this.store.upsertSession({ ...cfg }).catch(() => {});
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
        let msg = e.message;
        if (ctx.cancelled) msg = 'authentication cancelled';
        else if (e.level === 'client-authentication') {
          msg = `authentication failed — server accepts: ${(ctx.serverMethods || []).join(', ') || 'unknown'}; tried: ${(ctx.tried || []).join(', ') || 'nothing'}`;
          const accepts = ctx.serverMethods || [];
          if (!(ctx.tried || []).length && cfg.authMethod === 'password' && accepts.length && !accepts.includes('password') && !accepts.includes('keyboard-interactive')) {
            msg += '. This session is set to Password authentication but the server does not offer it — switch it to Automatic or Private key.';
          } else if (!(ctx.tried || []).length && cfg.authMethod === 'key' && !cfg.privateKeyPath) {
            msg += '. The session uses key authentication but no key file is set.';
          }
        } else if (e.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(msg)) {
          msg += ' — no TCP response from the host. Check network/VPN, the port forward on the router, or a temporary ban (fail2ban) after failed logins.';
        } else if (/Timed out while waiting for handshake/i.test(msg)) {
          msg += ` — no SSH banner within ${Math.round((this.store.getSettings().readyTimeout || 20000) / 1000)}s. Usually the host/port is unreachable from this network (try "nc -vz ${cfg.host} ${cfg.port || 22}" in a local terminal), or the port is not an SSH service.`;
        } else if (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
          msg += ' — the host is reachable but nothing listens on that port.';
        } else if (/Too many authentication failures/i.test(msg)) {
          msg += ' — the server cut the connection after too many key attempts; pick a specific key file or "Password" auth in the session.';
        }
        if (/Host denied \(verification failed\)/i.test(msg)) msg = 'host key not accepted';
        this._out(id, `\r\n${RED}Connection failed: ${msg}${RESET}\r\n`);
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
