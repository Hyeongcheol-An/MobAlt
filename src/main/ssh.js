'use strict';
// SSH connection manager: one ssh2 Client per terminal (like MobaXterm),
// with shell, SFTP channel, X11 forwarding, jump hosts and tunnels attached.
// ssh2 is loaded on the first connection or key parse (~10 ms warm on top of the constants algorithms.js needs at
// start, more from a cold disk): nothing the window should wait for.
let ssh2Lib = null;
const ssh2 = () => ssh2Lib || (ssh2Lib = require('ssh2'));
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const knownhosts = require('./knownhosts');
const x11 = require('./x11');
const algorithms = require('./algorithms');
const keygen = require('./keygen');
const localnet = require('./localnet'); // the macOS Local Network permission, when EHOSTUNREACH is what it looks like

const { execFile } = require('child_process');

const { STATUS_DIM, STATUS_FAIL } = require('./terminals');
const { t, tn, tt, inTerminal } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn(); a line written into the terminal through tt() (English where xterm cannot draw the script)
const GREY = STATUS_DIM; // status lines are painted by the renderer from the pane's palette (SGR 90 is invisible on Solarized Dark)
const RED = STATUS_FAIL;
const RESET = '\x1b[0m';
const DEFAULT_IDENTITY_FILES = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
/** The rejection of sftp() / exec() on a connection that is gone; the code lets monitor.js classify it whatever the language. */
const notConnected = () => Object.assign(new Error(t('Not connected')), { code: 'ENOTCONN' });

/**
 * The TCP socket of an SSH connection, with TCP_NODELAY: ssh2 (1.17) never sets it and Electron's Node (24) does not
 * default it on (Node 26 does), so every socket ran with Nagle on — each small packet sent while an earlier one is
 * unacknowledged waits for the peer's delayed ACK: a sequential SFTP round trip cost 54 ms and a keystroke echo 65 ms
 * on a 12 ms RTT, a 20 000-entry listing 11 s. ssh2 takes the socket as `sock` and connects it like its own (its
 * 'connect' starts the handshake; a socket error reaches the client as a 'client-socket' error with its code intact,
 * so ECONNREFUSED / ETIMEDOUT read as before). A jump hop's forwarded stream is an SSH channel, not a socket: the
 * first hop's socket, made here, carries it.
 */
function tcpSocket(host, port) {
  const sock = net.connect({ host, port, noDelay: true });
  sock.setMaxListeners(0); // as ssh2 does on its own socket
  return sock;
}

let agentKeysCache = null;
/**
 * Public keys (base64 blobs) currently held by ssh-agent, cached for 10 s: { keys: Set, reachable } — `reachable`
 * false when nothing answers at SSH_AUTH_SOCK (ssh-add exits 2), so the agent step can say which it was: an agent
 * with no identities (ssh-add -l) or no agent at all.
 */
function agentPublicKeys() {
  if (agentKeysCache && Date.now() - agentKeysCache.at < 10000) return agentKeysCache.promise;
  const promise = new Promise((resolve) => {
    const keys = new Set();
    if (!process.env.SSH_AUTH_SOCK) return resolve({ keys, reachable: false });
    execFile('ssh-add', ['-L'], { env: process.env, timeout: 3000 }, (err, out) => {
      if (!err) {
        for (const line of String(out).split('\n')) {
          const cols = line.trim().split(/\s+/);
          if (cols.length >= 2 && /^(ssh-|ecdsa-|sk-)/.test(cols[0])) keys.add(cols[1]);
        }
      }
      resolve({ keys, reachable: !err || err.code === 1 }); // 1: "The agent has no identities."; 2 / a spawn error: not reachable
    });
  });
  agentKeysCache = { at: Date.now(), promise };
  return promise;
}
/** The error a cancelled connection attempt fails with (Disconnect / ⌘W while connecting, Cancel in a prompt). */
const cancelledError = () => Object.assign(new Error('cancelled'), { code: 'ECANCELED' });

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
    this.hostKeyPrompts = new Map(); // host:port → { key, promise } while its "Unknown host key" dialog is open (see _hostVerifier)
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

    ctx.tried = ctx.tried || [];
    /**
     * Load a private key file, prompting for its passphrase when needed. Resolves the auth attempt, null when the key
     * cannot be used (the next step is tried) or false when the user cancelled the passphrase prompt — a cancel ends the
     * whole authentication, it never goes on to offer the agent or the default keys to a host the user just declined.
     * Passphrase attempts count as tries of the key ("<key> (passphrase)" in the failure summary).
     */
    const loadKey = async (file, display, savePassphrase) => {
      let raw;
      try {
        raw = fs.readFileSync(expandHome(file));
      } catch (e) {
        ctx.out(`${RED}${tt('Cannot read private key {key}: {error}', { key: display, error: e.message })}${RESET}\r\n`);
        return null;
      }
      let passphrase = savePassphrase ? cfg.passphrase || undefined : undefined;
      const hadSaved = !!passphrase;
      let parsed = ssh2().utils.parseKey(raw, passphrase);
      let tries = 0;
      const triedPassphrase = () => { if (tries || hadSaved) ctx.tried.push(tt('{key} (passphrase)', { key: display })); };
      while (parsed instanceof Error && /passphrase/i.test(parsed.message) && tries < 3) {
        // only a retry (or a saved passphrase that no longer fits) is blamed on the passphrase
        const message = tries ? t('Incorrect passphrase. Enter passphrase for key {key}', { key: display })
          : hadSaved ? t('The saved passphrase does not match. Enter passphrase for key {key}', { key: display })
            : t('Enter passphrase for key {key}', { key: display });
        tries++;
        const ans = await prompter.password({ kind: 'passphrase', title: t('Private key passphrase'), message, session: cfg });
        if (ctx.cancelled) return false;
        if (!ans) {
          ctx.cancelled = true;
          triedPassphrase();
          return false;
        }
        passphrase = ans.password;
        parsed = ssh2().utils.parseKey(raw, passphrase);
        if (!(parsed instanceof Error) && ans.save && cfg.id && savePassphrase) {
          this.store.upsertSession({ ...cfg, passphrase }).catch(() => {});
        }
      }
      if (parsed instanceof Error) {
        ctx.out(`${RED}${tt('Invalid private key {key}: {error}', { key: display, error: parsed.message })}${RESET}\r\n`);
        triedPassphrase();
        return null;
      }
      return { type: 'publickey', username, key: raw, passphrase, _parsed: parsed };
    };

    if ((method === 'key' || method === 'auto') && cfg.privateKeyPath) {
      steps.push({ type: 'publickey', label: cfg.privateKeyPath, run: () => loadKey(cfg.privateKeyPath, cfg.privateKeyPath, true) });
    }
    // "auto" order: configured key → saved password → ssh-agent keys → default ~/.ssh keys (like the
    // ssh CLI) → keyboard-interactive with the saved password → interactive prompts.
    const savedPasswordLabel = tt('saved password');
    if ((method === 'password' || method === 'auto') && cfg.password) {
      steps.push({ type: 'password', label: savedPasswordLabel, run: async () => ({ type: 'password', username, password: cfg.password }) });
    }
    // Every key is a failed attempt on the server side (MaxAuthTries, fail2ban), so when a password is
    // saved and the server accepts passwords, keys from the agent / default files are not tried.
    const keysWanted = () => !(cfg.password && Array.isArray(ctx.serverMethods) && ctx.serverMethods.includes('password'));
    if ((method === 'agent' || method === 'auto') && process.env.SSH_AUTH_SOCK) {
      steps.push({ type: 'agent', label: tt('ssh-agent keys'), guard: keysWanted, run: async () => {
        const agent = await agentPublicKeys();
        if (agent.keys.size) return { type: 'agent', username, agent: process.env.SSH_AUTH_SOCK };
        // nothing to offer: say why before the summary ("tried: nothing" alone reads like the agent was skipped)
        ctx.out(`${GREY}${agent.reachable ? tt('ssh-agent: no keys loaded (ssh-add -l)') : tt('ssh-agent not reachable at SSH_AUTH_SOCK')}${RESET}\r\n`);
        return null;
      } });
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
            if (!res) return res; // null: unusable, on to the next step; false: the user cancelled
            // skip keys the agent already offered
            let pub = null;
            try {
              pub = fs.readFileSync(file + '.pub', 'utf8').trim().split(/\s+/)[1];
            } catch {}
            if (!pub && res._parsed) {
              try { pub = res._parsed.getPublicSSH().toString('base64'); } catch {}
            }
            if (pub && (await agentPublicKeys()).keys.has(pub)) return null;
            delete res._parsed;
            return res;
          },
        });
      }
    }
    let kbdUsedSaved = false;
    let promptCount = 0;
    const MAX_PROMPTS = 3;
    // keyboard-interactive (PAM / 2FA): a lone hidden prompt gets the saved password once, else ask the user. Cancel in
    // the dialog ends the attempt (ctx.abort): answering with no responses is a protocol error to OpenSSH, which then
    // reads as "closed by the server" instead of a cancel.
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
          if (ctx.cancelled) return ctx.abort ? ctx.abort(cancelledError()) : finish([]);
          promptCount++;
          prompter
            .keyboardInteractive({ name, instructions, prompts, session: cfg, label })
            .then((answers) => {
              if (answers) return finish(answers);
              ctx.cancelled = true;
              if (ctx.abort) ctx.abort(cancelledError());
              else finish([]);
            })
            .catch(() => finish([]));
        },
      }),
    });
    if (cfg.password) steps.push(kbdStep(tt('keyboard-interactive (saved password)')));
    for (let i = 0; i < MAX_PROMPTS; i++) {
      steps.push({
        type: 'password',
        label: tt('password prompt'),
        guard: () => promptCount < MAX_PROMPTS,
        run: async () => {
          promptCount++;
          const message = promptCount > 1 ? t("{account}'s password (attempt {n})", { account: label, n: promptCount })
            : ctx.savedPasswordRejected ? t("The saved password was rejected. Enter {account}'s password", { account: label })
              : t("{account}'s password", { account: label });
          const ans = await prompter.password({ kind: 'password', title: t('SSH password'), message, session: cfg });
          if (!ans || ctx.cancelled) {
            ctx.cancelled = true;
            return false; // abort
          }
          ctx.lastPrompted = ans;
          return { type: 'password', username, password: ans.password };
        },
      });
      steps.push(kbdStep(tt('keyboard-interactive prompt')));
    }

    // ssh2 reports the server's remaining methods by SSH name; agent auth is "publickey" on the wire.
    const WIRE = { none: 'none', publickey: 'publickey', agent: 'publickey', password: 'password', 'keyboard-interactive': 'keyboard-interactive' };
    let idx = 0;
    return (methodsLeft, partialSuccess, cb) => {
      if (Array.isArray(methodsLeft) && !ctx.serverMethods) {
        ctx.serverMethods = methodsLeft.slice();
        ctx.out(`${GREY}${tt('Server accepts: {methods}', { methods: methodsLeft.join(', ') || tt('(none)') })}${RESET}\r\n`);
      }
      if (ctx.currentLabel && ctx.currentLabel !== 'none') { // previous attempt was rejected
        ctx.tried.push(ctx.currentLabel);
        if (ctx.currentLabel === savedPasswordLabel) ctx.savedPasswordRejected = true; // the next prompt says so
      }
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

  /**
   * ssh2's hostVerifier for a connection: a known key passes, anything else goes through the app's prompt — one
   * dialog per host:port at a time. Several first connections to the same host (a folder opened in a grid, MultiExec)
   * share the first dialog: the others wait for its answer, re-read known_hosts and continue without a prompt of
   * their own (a declined key declines them too). The handshake timer (ctx.readyTimer, _readyTimer) is paused while
   * a connection waits, so neither the dialog nor the queue behind it runs into the timeout.
   */
  _hostVerifier(cfg, ctx) {
    const host = cfg.host, port = cfg.port || 22, slot = `${host}:${port}`;
    const paused = (fn) => {
      if (ctx.readyTimer) ctx.readyTimer.pause();
      return fn().finally(() => { if (ctx.readyTimer) ctx.readyTimer.resume(); });
    };
    const decide = (key, cb) => {
      if (ctx.cancelled) return cb(false); // the pane was closed or disconnected meanwhile: no dialog for it
      const status = knownhosts.check(host, port, key);
      if (status === 'ok') return cb(true);
      if (status === 'revoked') {
        // an @revoked key is refused whatever the answer: the dialog only says why (it has no Accept button)
        const info = { host, port, keyType: knownhosts.readKeyType(key), fingerprint: knownhosts.fingerprint(key), status, name: cfg.name || '' };
        paused(() => Promise.resolve(this.prompter.hostKey(info))).catch(() => {}).then(() => cb(false));
        return;
      }
      const open = this.hostKeyPrompts.get(slot);
      if (open) {
        paused(() => open.promise).then((ok) => {
          if (knownhosts.check(host, port, key) === 'ok') return cb(true); // accepted and remembered by the first connection
          if (!ok && open.key.equals(key)) return cb(false); // the same key was declined: so is this connection
          decide(key, cb); // the dialog was about another key than this one: ask
        });
        return;
      }
      const fp = knownhosts.fingerprint(key);
      const promise = paused(() => this.prompter.hostKey({ host, port, keyType: knownhosts.readKeyType(key), fingerprint: fp, status, name: cfg.name || '' }))
        .then((ok) => {
          if (ok) {
            if (status === 'mismatch') knownhosts.forget(host, port);
            knownhosts.remember(host, port, key);
          }
          return !!ok;
        }, () => false);
      const entry = { key, promise };
      this.hostKeyPrompts.set(slot, entry);
      promise.then((ok) => {
        if (this.hostKeyPrompts.get(slot) === entry) this.hostKeyPrompts.delete(slot);
        cb(ok);
      });
    };
    return decide;
  }

  /**
   * The handshake timeout (Settings' readyTimeout, 20 s by default) as a timer this code owns: ssh2's own readyTimeout
   * keeps running while a host-key dialog waits for the user, so the connection is opened with readyTimeout 0 and
   * this one fails it instead — with ssh2's message and level, so _explainError reads the same. pause() / resume()
   * bracket a prompt (a resumed timer keeps at least 5 s for the rest of the handshake); ready, error and close stop
   * it. Returns { pause, resume, stop }.
   */
  _readyTimer(client, ms, onTimeout) {
    let timer = null, left = ms, since = 0, done = false;
    const stop = () => { done = true; if (timer) clearTimeout(timer); timer = null; };
    const resume = () => {
      if (done || timer) return;
      since = Date.now();
      timer = setTimeout(() => {
        timer = null;
        done = true;
        const err = new Error('Timed out while waiting for handshake');
        err.level = 'client-timeout';
        onTimeout(err);
      }, left);
    };
    const pause = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      left = Math.max(Math.min(5000, ms), left - (Date.now() - since));
    };
    client.once('ready', stop).once('error', stop).once('close', stop);
    resume();
    return { pause, resume, stop };
  }

  /**
   * ssh2's `algorithms` option for a session: the explicit lists of Advanced SSH → Algorithms when set, else the
   * "Legacy algorithms" additions, else nothing (ssh2's defaults). See algorithms.js. The host-key algorithms the
   * host is already known by in known_hosts go first, so a host known by its RSA key is asked for that one.
   */
  _algorithms(cfg) {
    let types = [];
    try { types = knownhosts.knownTypes(cfg.host, cfg.port || 22); } catch {}
    return algorithms.connectOptionFor(cfg, types);
  }

  /**
   * The grey line after the handshake: the negotiated key exchange — "(post-quantum)" after an ML-KEM / sntrup761
   * hybrid — the host key type and the cipher (both directions, when they differ), from ssh2's `handshake` event.
   */
  handshakeLine(neg) {
    const kex = algorithms.isPostQuantum(neg.kex) ? tt('{kex} (post-quantum)', { kex: neg.kex }) : neg.kex;
    const cipher = neg.cs.cipher === neg.sc.cipher ? neg.cs.cipher : `${neg.cs.cipher} / ${neg.sc.cipher}`;
    return tt('Key exchange {kex}, host key {hostKey}, cipher {cipher}', { kex, hostKey: neg.serverHostKey, cipher });
  }

  /**
   * ssh2's debug hook, used for one thing: remembering what the server offered in its KEXINIT (key exchanges, host
   * key formats, ciphers, MACs), so a handshake that finds nothing in common can say what the server does speak.
   */
  _debugHook(ctx) {
    return (line) => {
      // how far the handshake got, for the timeout's wording: TCP connected ("Socket connected"), the banner seen
      if (line === 'Socket connected') ctx.tcpConnected = true;
      else if (line.startsWith('Remote ident:')) ctx.bannerSeen = true;
      ctx.remoteAlgorithms = algorithms.noteRemote(ctx.remoteAlgorithms, line);
    };
  }

  /**
   * Check cfg.host's key through the app's own known-hosts flow (same prompt as a connection) without
   * authenticating: the connection ends once the key exchange is complete. An accepted or already-known key is
   * also written to the app's known_hosts file (OpenSSH format), so an external ssh — the bootstrap of a
   * Mosh session — can run with StrictHostKeyChecking=yes against that file and ~/.ssh/known_hosts stays
   * untouched. Resolves {ok: true, handshakeLine} — the grey "Key exchange …" line of that check, for the Mosh pane
   * to show as an SSH pane shows its own — or {ok: false, error}; a cancelled prompt trusts nothing.
   */
  verifyHost(cfg) {
    return new Promise((resolve) => {
      const settings = this.store.getSettings();
      const client = new (ssh2().Client)();
      let settled = false;
      // why: a function building the reason with t() — it is built twice, for the status bar and (terminalError,
      // inTerminal) for the Mosh pane's "Failed to start: …" line
      const finish = (ok, why) => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch {}
        if (!ok && ctx.localNetworkBlocked) localnet.notify(ctx.localNetworkBlocked); // Mosh's host-key check: the same dialog as a session
        if (ok) return resolve({ ok: true, handshakeLine: ctx.handshake ? `${GREY}${this.handshakeLine(ctx.handshake)}${RESET}\r\n` : '' });
        const build = () => (why && why()) || t('host key check failed');
        resolve({ ok: false, error: build(), terminalError: inTerminal(build) });
      };
      const ctx = {};
      const verifier = this._hostVerifier(cfg, ctx);
      client.once('handshake', (negotiated) => { ctx.handshake = negotiated; });
      client.on('error', (e) => finish(false, () => this._explainError(e, ctx, cfg)));
      client.on('close', () => finish(false, () => t('connection closed during the host key check')));
      client.on('ready', () => finish(true));
      ctx.readyTimer = this._readyTimer(client, settings.readyTimeout || 20000, (err) => {
        finish(false, () => this._explainError(err, ctx, cfg));
        try { client.destroy(); } catch {}
      });
      try {
        client.connect({
          host: cfg.host,
          port: cfg.port || 22,
          sock: tcpSocket(cfg.host, cfg.port || 22),
          username: cfg.username || os.userInfo().username,
          hostVerifier: (key, cb) => verifier(key, (ok) => {
            if (ok) {
              try { knownhosts.ensure(cfg.host, cfg.port || 22, key); } catch {}
            }
            cb(ok);
            if (!ok) return finish(false, () => t('host key not accepted'));
            // accepted: the exchange completes (NEWKEYS, ssh2's `handshake` with what was negotiated), then the
            // connection is ended before any authentication; a server that drops it first ends in error / close
            if (ctx.handshake) finish(true);
            else client.once('handshake', () => finish(true));
          }),
          authHandler: (_methods, _partial, cb) => cb(false), // not reached: the check ends with the key exchange
          readyTimeout: 0, // ctx.readyTimer: the same limit, paused while the host-key dialog is open
          algorithms: this._algorithms(cfg),
          debug: this._debugHook(ctx),
        });
      } catch (e) {
        finish(false, () => e.message);
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
   * While it runs, `ctx.abort(err)` ends the attempt at whatever stage it is — the TCP connect, the handshake, a
   * host-key or password dialog, a jump host's own connection — and the promise rejects with `err`: the socket is
   * destroyed (never left connecting, authenticating or open behind a pane that is gone), the handshake timer stops,
   * the host verifier answers no further prompt (ctx.cancelled). disconnect() calls it for a pane that is still
   * "Connecting to …"; Cancel in the keyboard-interactive dialog calls it too.
   * @returns {Promise<{client: Client, jump: Client|null}>}
   */
  connectClient(cfg, ctx, depth = 0) {
    return new Promise(async (resolve, reject) => {
      if (ctx.cancelled) return reject(cancelledError());
      const settings = this.store.getSettings();
      const client = new (ssh2().Client)();
      let settled = false;
      let aborted = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        reject(e);
      };
      // the abort chain: this level ends its client, and the level above (a connection through this jump) its own
      const outerAbort = ctx.abort;
      ctx.abort = (err) => {
        ctx.cancelled = true;
        aborted = true;
        if (ctx.readyTimer) ctx.readyTimer.stop();
        fail(err || cancelledError());
        try { client.destroy(); } catch {}
        // a post-quantum exchange still in flight drops its secrets now (Protocol's teardown does the same on close)
        try { if (client._protocol && client._protocol._kex && typeof client._protocol._kex.dispose === 'function') client._protocol._kex.dispose(); } catch {}
        if (outerAbort) outerAbort(err);
      };

      const jumpCfg = depth < 3 ? await this._resolveJump(cfg) : null;
      let jump = null;
      let sock;
      if (jumpCfg) {
        ctx.out(`${GREY}${tt('Connecting to jump host {target}...', { target: `${jumpCfg.username || ''}@${jumpCfg.host}:${jumpCfg.port || 22}` })}${RESET}\r\n`);
        try {
          const j = await this.connectClient(jumpCfg, ctx, depth + 1);
          jump = j.client;
          sock = await new Promise((res, rej) =>
            jump.forwardOut('127.0.0.1', 0, cfg.host, cfg.port || 22, (err, stream) => (err ? rej(err) : res(stream)))
          );
          if (ctx.cancelled) throw cancelledError();
          ctx.out(`${GREY}${tt('Jump established, connecting to {target}...', { target: `${cfg.host}:${cfg.port || 22}` })}${RESET}\r\n`);
        } catch (e) {
          if (jump) jump.end();
          if (ctx.cancelled) return fail(cancelledError());
          // the failure is the jump hop's: explained against the jump host — the "nc -vz" hint names its host and port,
          // never the target's — and marked, so the caller's _explainError leaves it as it is
          const explain = () => t('Jump host failed: {error}', { error: e.explained ? e.message : this._explainError(e, ctx, jumpCfg) });
          const err = new Error(ctx.terminal ? inTerminal(explain) : explain()); // a shell pane prints it: the terminal language
          err.explained = true;
          return fail(err);
        }
      }
      if (ctx.cancelled) return fail(cancelledError());

      client.on('ready', () => {
        if (settled) return;
        settled = true;
        resolve({ client, jump });
      });
      // what the first key exchange of the session's own connection agreed on (a jump host's is not shown)
      if (depth === 0) client.once('handshake', (negotiated) => { ctx.handshake = negotiated; });
      client.on('error', (e) => {
        if (!settled) fail(e);
        else if (ctx.onError && !aborted) ctx.onError(e); // an aborted client's last words are nobody's business
      });
      client.on('banner', (msg) => ctx.out(msg.replace(/\r?\n/g, '\r\n')));
      client.on('close', () => {
        if (jump) jump.end();
        // a server that hangs up cleanly before the handshake is done (after its banner, say) gives ssh2 nothing to
        // report: that is a failed connection, not a session the server ended
        if (!settled) return fail(Object.assign(new Error('EOF'), { code: 'ECONNRESET' }));
        if (ctx.onClose) ctx.onClose();
      });

      // the handshake limit: ssh2's readyTimeout would keep running through a host-key dialog (and the connections
      // queued behind it), so it is off and _readyTimer — paused by _hostVerifier while a dialog waits — fails the
      // connection instead; ssh2 itself ends a timed-out connection the same way (the error, then the socket)
      ctx.readyTimer = this._readyTimer(client, settings.readyTimeout || 20000, (err) => {
        fail(err);
        try { client.destroy(); } catch {}
      });
      const connectCfg = {
        host: cfg.host,
        port: cfg.port || 22,
        username: cfg.username || os.userInfo().username,
        authHandler: this._buildAuthHandler(cfg, ctx),
        hostVerifier: this._hostVerifier(cfg, ctx),
        keepaliveInterval: (cfg.keepAliveInterval ?? settings.keepAliveInterval ?? 30) * 1000,
        keepaliveCountMax: 3,
        readyTimeout: 0, // see ctx.readyTimer above
        compress: !!cfg.compression,
        agentForward: !!cfg.agentForward && !!process.env.SSH_AUTH_SOCK,
        agent: cfg.agentForward ? process.env.SSH_AUTH_SOCK : undefined,
        tryKeyboard: true,
        algorithms: this._algorithms(cfg),
        debug: this._debugHook(ctx),
      };
      connectCfg.sock = sock || tcpSocket(cfg.host, cfg.port || 22); // the jump's forwarded channel, else a TCP socket with TCP_NODELAY (see tcpSocket)
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
        if (!info.stream || info.closed) return reject(new Error(t('not connected')));
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
      terminal: true, // what fails is printed into the pane: messages in the terminal language (tt / inTerminal)
      out: (t) => this._out(id, t),
      onError: (e) => {
        info.lastError = e.message; // e.g. "Keepalive timeout": the reason a lost connection is reported with
        this._out(id, `\r\n${RED}${tt('SSH error: {error}', { error: e.message })}${RESET}\r\n`);
      },
      onClose: () => {
        if (info.closed) return;
        info.closed = true;
        this.conns.delete(id);
        const lost = !info.closing && !info.shellExited;
        this.prompter.status(id, 'disconnected');
        // Disconnect after the login but before the shell opened: still the attempt being cancelled, not a session that ended
        registry.exit(id, 0, lost ? 'lost' : info.cancelled ? 'cancelled' : 'closed', lost ? info.lastError || undefined : undefined);
      },
    };

    info.ctx = ctx; // disconnect() while still connecting aborts the attempt through it
    this.prompter.status(id, 'connecting');
    this._out(id, `${GREY}${tt('Connecting to {target}...', { target: `${cfg.username || os.userInfo().username}@${cfg.host}:${cfg.port || 22}` })}${RESET}\r\n`);

    // a pane that went away while this was connecting: whatever came up for it goes down again, nothing is shown
    const gone = (client, jump) => {
      if (!info.closed) return false;
      try { client.end(); } catch {}
      if (jump) try { jump.end(); } catch {}
      return true;
    };
    this.connectClient(cfg, ctx)
      .then(async ({ client, jump }) => {
        if (gone(client, jump)) return;
        info.client = client;
        info.jump = jump;
        if (ctx.handshake) this._out(id, `${GREY}${this.handshakeLine(ctx.handshake)}${RESET}\r\n`);
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
          const xp = await x11.prepare((msg) => this._out(id, `${GREY}${tt('X11: {message}', { message: msg })}${RESET}\r\n`));
          if (gone(client, jump)) return;
          if (xp) {
            info.x11 = xp;
            sessOpts.x11 = { single: false, screen: xp.screen, protocol: xp.protocol, cookie: xp.fakeCookie };
            let x11Warned = false;
            client.on('x11', (details, accept, reject) => {
              try {
                x11.proxy(accept(), xp, (msg) => {
                  if (x11Warned) return;
                  x11Warned = true;
                  this._out(id, `\r\n${RED}${tt('X11: {message}', { message: msg })}${RESET}\r\n`);
                });
              } catch (e) {
                reject();
              }
            });
          } else {
            this._out(id, `${RED}${tt('X11 forwarding requested but no local X server found (install/start XQuartz).')}${RESET}\r\n`);
          }
        }
        client.on('tcp connection', (details, accept, reject) => {
          const h = info.remoteForwards.get(details.destPort);
          if (h) h(details, accept, reject);
          else reject();
        });
        client.shell(shellOpts, sessOpts, (err, stream) => {
          if (gone(client, jump)) return;
          if (err) {
            this._out(id, `${RED}${tt('Failed to open shell: {error}', { error: err.message })}${RESET}\r\n`);
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
        if (info.closed) return; // cancelled by disconnect(): the pane already says so
        const msg = inTerminal(() => this._explainError(e, ctx, cfg)); // the hints composed around it too, for the terminal
        this._out(id, `\r\n${RED}${tt('Connection failed: {error}', { error: msg })}${RESET}\r\n`);
        if (ctx.localNetworkBlocked) localnet.notify(ctx.localNetworkBlocked); // the dialog that opens the setting (once per run)
        this.prompter.status(id, 'failed', e.message);
        info.closed = true;
        this.conns.delete(id);
        registry.exit(id, 1, 'failed');
      });
    return { id };
  }

  /** Turn a connect/auth failure into the message shown to the user (hints for the usual causes). */
  _explainError(e, ctx, cfg) {
    if (e.explained) return e.message; // a jump hop's failure, explained against the jump host in connectClient
    let msg = e.message;
    const limit = () => Math.round((this.store.getSettings().readyTimeout || 20000) / 1000);
    // this Mac refused the socket (macOS Local Network privacy, see localnet.js): the socket's own error only — a jump
    // server that cannot reach the target answers the channel open with the same words, and that is its routing
    const refused = e.code === 'EHOSTUNREACH' ? localnet.hint(e, cfg.host) : null;
    // the regexes classify ssh2's own (English) messages; the hints are composed around them as {error}
    if (ctx.cancelled) msg = t('authentication cancelled');
    else if (e.level === 'client-authentication') {
      const accepts = ctx.serverMethods || [];
      msg = t('authentication failed — server accepts: {accepts}; tried: {tried}', { accepts: Array.isArray(ctx.serverMethods) ? accepts.join(', ') || t('(none)') : t('unknown'), tried: (ctx.tried || []).join(', ') || t('nothing') });
      if (!(ctx.tried || []).length && cfg.authMethod === 'password' && accepts.length && !accepts.includes('password') && !accepts.includes('keyboard-interactive')) {
        msg = t('{error}. This session is set to Password authentication but the server does not offer it — switch it to Automatic or Private key.', { error: msg });
      } else if (!(ctx.tried || []).length && cfg.authMethod === 'key' && !cfg.privateKeyPath) {
        msg = t('{error}. The session uses key authentication but no key file is set.', { error: msg });
      }
    } else if (refused) {
      ctx.localNetworkBlocked = cfg.host; // the host it was (a jump hop's, when the hop's own socket failed)
      msg = `${msg} — ${refused}`;
    } else if (e.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(msg)) {
      msg = t('{error} — no TCP response from the host. Check network/VPN, the port forward on the router, or a temporary ban (fail2ban) after failed logins.', { error: msg });
    } else if (/Timed out while waiting for handshake/i.test(msg)) {
      // what the time ran out on: the TCP connect itself (a black-holed host), the banner, or the rest of the handshake
      if (!ctx.tcpConnected) msg = t('{error} — no TCP connection within {s}s. Usually the host/port is unreachable from this network (try "nc -vz {host} {port}" in a local terminal).', { error: msg, s: limit(), host: cfg.host, port: cfg.port || 22 });
      else if (!ctx.bannerSeen) msg = t('{error} — no SSH banner within {s}s. Usually the host/port is unreachable from this network (try "nc -vz {host} {port}" in a local terminal), or the port is not an SSH service.', { error: msg, s: limit(), host: cfg.host, port: cfg.port || 22 });
      else msg = t('{error} — the server answered but the handshake did not finish within {s}s.', { error: msg, s: limit() });
    } else if (e.code === 'ECONNRESET' || e.code === 'EPIPE' || /ECONNRESET|EPIPE/.test(msg)) {
      msg = t('{error} — the server closed the connection during the handshake.', { error: msg });
    } else if (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
      msg = t('{error} — the host is reachable but nothing listens on that port.', { error: msg });
    } else if (/Too many authentication failures/i.test(msg)) {
      msg = t('{error} — the server cut the connection after too many key attempts; pick a specific key file or "Password" auth in the session.', { error: msg });
    } else if (/^Handshake failed: no matching/.test(msg)) {
      // nothing in common with the server's KEXINIT: say which side offers what (algorithms.js knows both lists)
      msg = algorithms.explainHandshake(msg, cfg, ctx.remoteAlgorithms) || msg;
    } else if (/^Unsupported algorithm: /.test(msg)) {
      msg = t('{error} — Advanced SSH → Algorithms names an algorithm this version of MobAlt cannot do; Reset to defaults there.', { error: msg });
    } else if (/Unknown DH group/i.test(msg)) {
      // the key exchange was agreed but Node's crypto has no such group (the 1024-bit one): algorithms.js knows the name
      msg = algorithms.explainDhGroup(msg) || msg;
    }
    if (/Host denied \(verification failed\)/i.test(msg)) msg = t('host key not accepted');
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
    if (cols.length < 2 || !/^[A-Za-z0-9+/=]+$/.test(cols[1])) return { ok: false, error: t('Not a public key line (expected "ssh-ed25519 AAAA… comment")') };
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
      return { ok: false, error: t('Could not connect to {where}: {error}', { where, error: this._explainError(e, ctx, cfg) }) };
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
      const why = (r.errOut.trim() || r.out.trim()).split('\n').pop() || t('exit status {code}', { code: r.code });
      return { ok: false, error: t('Could not write {file} on {where}: {error}', { file: remoteFile, where, error: why }) };
    } catch (e) {
      return { ok: false, error: t('Installing the key on {where} failed: {error}', { where, error: e.message }) };
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

    info.ctx = ctx; // disconnect() while still connecting aborts the attempt through it
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
        if (info.closed) return; // cancelled by disconnect()
        this.prompter.status(id, 'failed', this._explainError(e, ctx, cfg));
        info.closed = true;
        this.conns.delete(id);
        registry.exit(id, 1, 'failed');
      });
    return { id };
  }

  disconnect(id) {
    const info = this.conns.get(id);
    if (!info) return;
    info.closing = true;
    if (this.beforeDisconnect) try { this.beforeDisconnect(id); } catch {} // main.js: the connection's transfers end as cancelled, not as a lost channel
    try {
      if (info.stream) info.stream.end();
    } catch {}
    if (info.client) {
      if (!info.stream) info.cancelled = true; // authenticated, the shell not open yet: the pane says "Connection attempt cancelled."
      try { info.client.end(); } catch {}
    } else {
      // still connecting: the pane is over now, and so is the attempt behind it — the socket is destroyed, the
      // handshake timer stopped and no host-key or password dialog opens for it (connectClient's ctx.abort); before,
      // the attempt went on for nobody and a slow server got a dialog, a login and an invisible open connection
      info.closed = true;
      this.conns.delete(id);
      if (info.ctx) {
        info.ctx.cancelled = true;
        if (info.ctx.abort) try { info.ctx.abort(cancelledError()); } catch {}
      }
      this.registry.exit(id, 0, 'cancelled');
    }
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
    if (!info || !info.client) return Promise.reject(notConnected());
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
    if (!info || !info.client) return Promise.reject(notConnected());
    this.execCount++;
    return new Promise((resolve, reject) => {
      info.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', errOut = '', done = false;
        const timer = timeout > 0 ? setTimeout(() => {
          if (done) return;
          done = true;
          try { stream.close(); } catch {}
          reject(new Error(t('timed out after {s} s', { s: Math.round(timeout / 1000) })));
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
