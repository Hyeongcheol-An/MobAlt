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
const algorithms = require('./algorithms');
const keygen = require('./keygen');

const { execFile } = require('child_process');

const { STATUS_DIM, STATUS_FAIL } = require('./terminals');
const GREY = STATUS_DIM; // status lines are painted by the renderer from the pane's palette (SGR 90 is invisible on Solarized Dark)
const RED = STATUS_FAIL;
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
  `elif [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="printf '\\033]7;file://%s%s\\a' \\"\\$HOSTNAME\\" \\"\\$PWD\\"\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi; clear -x 2>/dev/null || clear`;

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
    this.execCount = 0; // exec channels opened so far (the monitoring bar's polls among them; a test hook reads it)
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
      const hadSaved = !!passphrase;
      let parsed = utils.parseKey(raw, passphrase);
      let tries = 0;
      while (parsed instanceof Error && /passphrase/i.test(parsed.message) && tries < 3) {
        // only a retry (or a saved passphrase that no longer fits) is blamed on the passphrase
        const why = tries ? 'Incorrect passphrase. ' : hadSaved ? 'The saved passphrase does not match. ' : '';
        tries++;
        const ans = await prompter.password({ kind: 'passphrase', title: 'Private key passphrase', message: `${why}Enter passphrase for key ${display}`, session: cfg });
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
        .hostKey({ host: cfg.host, port: cfg.port || 22, keyType: knownhosts.readKeyType(key), fingerprint: fp, status, name: cfg.name || '' })
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

  /**
   * ssh2's `algorithms` option for a session: the explicit lists of Advanced SSH → Algorithms when set, else the
   * "Legacy algorithms" additions, else nothing (ssh2's defaults). See algorithms.js.
   */
  _algorithms(cfg) {
    return algorithms.connectOption(cfg);
  }

  /**
   * ssh2's debug hook, used for one thing: remembering what the server offered in its KEXINIT (key exchanges, host
   * key formats, ciphers, MACs), so a handshake that finds nothing in common can say what the server does speak.
   */
  _debugHook(ctx) {
    return (line) => { ctx.remoteAlgorithms = algorithms.noteRemote(ctx.remoteAlgorithms, line); };
  }

  /**
   * Check cfg.host's key through the app's own known-hosts flow (same prompt as a connection) without
   * authenticating: the handshake stops right after the key exchange. An accepted or already-known key is
   * also written to the app's known_hosts file (OpenSSH format), so an external ssh — the bootstrap of a
   * Mosh session — can run with StrictHostKeyChecking=yes against that file and ~/.ssh/known_hosts stays
   * untouched. Resolves {ok: true} or {ok: false, error}; a cancelled prompt trusts nothing.
   */
  verifyHost(cfg) {
    return new Promise((resolve) => {
      const settings = this.store.getSettings();
      const client = new Client();
      let settled = false;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        resolve(ok ? { ok: true } : { ok: false, error: error || 'host key check failed' });
      };
      const ctx = {};
      const verifier = this._hostVerifier(cfg, ctx);
      client.on('error', (e) => finish(false, this._explainError(e, ctx, cfg)));
      client.on('close', () => finish(false, 'connection closed during the host key check'));
      client.on('ready', () => finish(true));
      try {
        client.connect({
          host: cfg.host,
          port: cfg.port || 22,
          username: cfg.username || os.userInfo().username,
          hostVerifier: (key, cb) => verifier(key, (ok) => {
            if (ok) {
              try { knownhosts.ensure(cfg.host, cfg.port || 22, key); } catch {}
            }
            cb(ok);
            finish(ok, 'host key not accepted');
          }),
          authHandler: (_methods, _partial, cb) => cb(false), // never reached: the check ends with the key exchange
          readyTimeout: settings.readyTimeout || 20000,
          algorithms: this._algorithms(cfg),
          debug: this._debugHook(ctx),
        });
      } catch (e) {
        finish(false, e.message);
      }
    });
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
        algorithms: this._algorithms(cfg),
        debug: this._debugHook(ctx),
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
    // closing: we asked the connection to end (Disconnect, ⌘W, quit); shellExited: the remote shell ended (exit, logout).
    // A close with neither is the server or the network dropping the session, which the renderer announces.
    const info = { id, cfg, client: null, jump: null, stream: null, sftp: null, x11: null, cols, rows, closed: false, closing: false, shellExited: false, lastError: null, remoteForwards: new Map() };
    this.conns.set(id, info);
    // Typed input waits (`pending`) until the shell is open — and, when a prompt hook or startup command is injected,
    // until that has been written: keystrokes that arrive in between would be spliced into the injected line.
    let pending = '';
    let hold = true;
    registry.register(id, {
      kind: 'ssh',
      write: (d) => (info.stream && !hold ? info.stream.write(d) : (pending += d)),
      // ZMODEM bytes: resolves when the channel has taken them (ssh2 calls back once window space allowed the send)
      writeRaw: (buf) => new Promise((resolve, reject) => {
        if (!info.stream || info.closed) return reject(new Error('not connected'));
        info.stream.write(buf, (e) => (e ? reject(e) : resolve()));
      }),
      resize: (c, r) => {
        info.cols = c;
        info.rows = r;
        if (info.stream) info.stream.setWindow(r, c, 0, 0);
      },
      kill: () => this.disconnect(id),
    });

    const ctx = {
      out: (t) => this._out(id, t),
      onError: (e) => {
        info.lastError = e.message; // e.g. "Keepalive timeout": the reason a lost connection is reported with
        this._out(id, `\r\n${RED}SSH error: ${e.message}${RESET}\r\n`);
      },
      onClose: () => {
        if (info.closed) return;
        info.closed = true;
        this.conns.delete(id);
        const lost = !info.closing && !info.shellExited;
        this.prompter.status(id, 'disconnected');
        registry.exit(id, 0, lost ? 'lost' : 'closed', lost ? info.lastError || undefined : undefined);
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
        // The pty-req carries IUTF8 (RFC 8160 opcode 42, not in ssh2's mode table, so the raw encoding) like OpenSSH's
        // client does for a UTF-8 locale: without it the remote pty erases one byte of a multi-byte character on
        // Backspace in canonical mode (read, cat, password prompts).
        const shellOpts = { term: 'xterm-256color', cols: info.cols, rows: info.rows, modes: Buffer.from([42, 0, 0, 0, 1, 0]) };
        // ssh2's shell(window, options): an object that carries `x11` is taken as the options and the pty is then
        // requested with the defaults (vt100, 80×24, no modes), so the X11 request goes in its own argument
        const sessOpts = {};
        if (cfg.x11) {
          const xp = await x11.prepare((msg) => this._out(id, `${GREY}X11: ${msg}${RESET}\r\n`));
          if (info.closed) return;
          if (xp) {
            info.x11 = xp;
            sessOpts.x11 = { single: false, screen: xp.screen, protocol: xp.protocol, cookie: xp.fakeCookie };
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
        client.shell(shellOpts, sessOpts, (err, stream) => {
          if (err) {
            this._out(id, `${RED}Failed to open shell: ${err.message}${RESET}\r\n`);
            info.closing = true; // our own end, not a drop
            client.end();
            return;
          }
          info.stream = stream;
          const decErr = new StringDecoder('utf8');
          stream.on('data', (d) => registry.bytes(id, d)); // raw: the Zmodem sentry sees the bytes before xterm
          stream.stderr.on('data', (d) => registry.data(id, decErr.write(d)));
          stream.on('exit', () => { info.shellExited = true; }); // exit status from the server: the shell ended on its own
          stream.on('close', () => client.end());
          this.prompter.status(id, 'connected');
          const release = () => {
            hold = false;
            if (pending && info.stream) {
              info.stream.write(pending);
              pending = '';
            }
          };
          const inject = [];
          if (cfg.followCwd) inject.push(' ' + FOLLOW_HOOK);
          if (cfg.startupCommand) inject.push(cfg.startupCommand);
          if (!inject.length) release();
          else setTimeout(() => { if (info.stream && !info.closed) info.stream.write(inject.join('\r') + '\r'); release(); }, 700);
        });
      })
      .catch((e) => {
        const msg = this._explainError(e, ctx, cfg);
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

  /** Turn a connect/auth failure into the message shown to the user (hints for the usual causes). */
  _explainError(e, ctx, cfg) {
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
    } else if (/^Handshake failed: no matching/.test(msg)) {
      // nothing in common with the server's KEXINIT: say which side offers what (algorithms.js knows both lists)
      msg = algorithms.explainHandshake(msg, cfg, ctx.remoteAlgorithms) || msg;
    } else if (/^Unsupported algorithm: /.test(msg)) {
      msg += ' — Advanced SSH → Algorithms names an algorithm this version of MobAlt cannot do; Reset to defaults there.';
    }
    if (/Host denied \(verification failed\)/i.test(msg)) msg = 'host key not accepted';
    return msg;
  }

  /**
   * Put a public key on a server the way ssh-copy-id does: connect to `cfg` with its usual authentication (prompts
   * included), then append `publicKey` (one authorized_keys line) to `remoteFile` (default ~/.ssh/authorized_keys),
   * creating the folder 0700 and the file 0600 when missing; a line already there is left alone. Resolves
   * { ok: true, added: bool, remoteFile, host } or { ok: false, error }. The connection is closed right after.
   */
  async installPublicKey(cfg, publicKey, remoteFile = '~/.ssh/authorized_keys') {
    const line = String(publicKey || '').trim().split('\n')[0];
    const cols = line.split(/\s+/);
    if (cols.length < 2 || !/^[A-Za-z0-9+/=]+$/.test(cols[1])) return { ok: false, error: 'Not a public key line (expected "ssh-ed25519 AAAA… comment")' };
    let cmd;
    try {
      cmd = keygen.installCommand(remoteFile, cols[1]);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const where = `${cfg.username || os.userInfo().username}@${cfg.host}:${cfg.port || 22}`;
    const ctx = { log: '', out: (t) => { ctx.log = (ctx.log + t).slice(-4000); } };
    let client = null, jump = null;
    try {
      ({ client, jump } = await this.connectClient({ ...cfg }, ctx));
    } catch (e) {
      return { ok: false, error: `Could not connect to ${where}: ${this._explainError(e, ctx, cfg)}` };
    }
    try {
      const r = await new Promise((resolve, reject) => {
        client.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          let out = '', errOut = '';
          stream.on('data', (d) => (out += d));
          stream.stderr.on('data', (d) => (errOut += d));
          stream.on('close', (code) => resolve({ code, out, errOut }));
          stream.on('error', reject);
          stream.end(line + '\n');
        });
      });
      if (/MOBALT_KEY_ADDED/.test(r.out)) return { ok: true, added: true, remoteFile, host: where };
      if (/MOBALT_KEY_PRESENT/.test(r.out)) return { ok: true, added: false, remoteFile, host: where };
      const why = (r.errOut.trim() || r.out.trim()).split('\n').pop() || `exit status ${r.code}`;
      return { ok: false, error: `Could not write ${remoteFile} on ${where}: ${why}` };
    } catch (e) {
      return { ok: false, error: `Installing the key on ${where} failed: ${e.message}` };
    } finally {
      try { client.end(); } catch {}
      if (jump) try { jump.end(); } catch {}
    }
  }

  /**
   * Connect for file access only — the SFTP companion of a Mosh pane, which has no SSH channel
   * of its own in the app. Same auth handler and host-key verification (prompts included) as
   * openShell, but no shell is opened. The connection is registered like a shell, so sftp(id),
   * exec(id), disconnect(id)/disconnectAll() and the quit confirmation all cover it, and the
   * renderer gets ssh:status events (connecting → connected | failed, later disconnected).
   * Returns the connection id immediately.
   */
  openSftpOnly(cfg) {
    const id = this.registry.newId();
    const registry = this.registry;
    // The cfg is derived from a session of another type: without its id nothing in the auth path
    // (saved passphrase / password) can write it back over that session.
    cfg = { ...cfg };
    delete cfg.id;
    const info = { id, cfg, client: null, jump: null, stream: null, sftp: null, x11: null, closed: false, remoteForwards: new Map(), sftpOnly: true, log: '' };
    this.conns.set(id, info);
    registry.register(id, { kind: 'sftp', write: () => {}, resize: () => {}, kill: () => this.disconnect(id) });

    const ctx = {
      out: (t) => { info.log = (info.log + t).slice(-4000); }, // no terminal: keep banners/notes for diagnostics
      onError: (e) => ctx.out(`SSH error: ${e.message}\r\n`),
      onClose: () => {
        if (info.closed) return;
        info.closed = true;
        this.conns.delete(id);
        this.prompter.status(id, 'disconnected');
        registry.exit(id, 0, 'closed');
      },
    };

    this.prompter.status(id, 'connecting');
    this.connectClient(cfg, ctx)
      .then(({ client, jump }) => {
        if (info.closed) { // disconnected while still connecting
          try { client.end(); } catch {}
          if (jump) try { jump.end(); } catch {}
          return;
        }
        info.client = client;
        info.jump = jump;
        this.prompter.status(id, 'connected');
      })
      .catch((e) => {
        this.prompter.status(id, 'failed', this._explainError(e, ctx, cfg));
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
    info.closing = true;
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

  /**
   * Run `cmd` on connection `id` over an exec channel (no pty: nothing reaches the terminal) and collect its output:
   * { code, stdout, stderr }. With `timeout` (ms) a command that has not finished by then is abandoned — the channel
   * is closed and the promise rejects — so a stuck host cannot pile up channels (the monitoring bar polls this way).
   */
  exec(id, cmd, { timeout = 0 } = {}) {
    const info = this.conns.get(id);
    if (!info || !info.client) return Promise.reject(new Error('Not connected'));
    this.execCount++;
    return new Promise((resolve, reject) => {
      info.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', errOut = '', done = false;
        const timer = timeout > 0 ? setTimeout(() => {
          if (done) return;
          done = true;
          try { stream.close(); } catch {}
          reject(new Error(`timed out after ${Math.round(timeout / 1000)} s`));
        }, timeout) : null;
        stream.on('data', (d) => (out += d));
        stream.stderr.on('data', (d) => (errOut += d));
        stream.on('close', (code) => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          resolve({ code, stdout: out, stderr: errOut });
        });
      });
    });
  }
}

module.exports = { SshManager, expandHome };
