# Contributing

Thanks for helping make MobAlt better. This is the short version; the details live next to the code
(`test/qa/README.md`, `src/locales/README.md`). Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Issues

- **Bugs and ideas**: use the issue forms. A bug report needs the macOS version, the MobAlt version (MobAlt → About
  MobAlt) and, for SSH problems, the line the terminal printed (`authentication failed — server accepts: …; tried: …`,
  `no matching key exchange: …`). Nothing in an issue should hold a password, a key, a real public IP or a company
  host name.
- **A MobaXterm feature you miss**: check [docs/MOBAXTERM_PARITY.md](docs/MOBAXTERM_PARITY.md) first; a ❌ row is a
  welcome request, a ➖ row is Windows-only.
- **Security problems**: never a public issue — see [SECURITY.md](SECURITY.md).

## Setup

macOS 13 or later, Node.js 22, Xcode Command Line Tools (for `node-pty` and `serialport`).

```bash
git clone https://github.com/Hyeongcheol-An/MobAlt.git
cd MobAlt
npm ci                                  # applies patches/ssh2+1.17.0.patch, rebuilds node-pty for Electron
env -u ELECTRON_RUN_AS_NODE npm start   # VS Code's terminal exports that variable; with it, electron starts as Node
npm test                                # unit tests (strict i18n: an untranslated string fails)
```

The other scripts (`pack`, `install:local`, `i18n`, `i18n:status`, `docs:shots`, `perf`) are listed in the
[README](README.md#development).

## End-to-end checks

The e2e scripts drive the real app with a script injected into the renderer. Read `test/qa/README.md` once: it lists
the test hooks, how a script answers native dialogs, and how a run stays off your keyboard and clipboard.

```bash
test/start-sshd.sh start                               # user-level sshd on 127.0.0.1:2222
bash test/qa/run.sh test/e2e-ssh.js /tmp/mobalt-ssh 120000   # screenshots in /tmp/mobalt-ssh/shots, a RESULTS {...} line
test/start-sshd.sh stop
```

- `test/e2e-ftp.js`, `test/e2e-visual.js` and `npm run docs:shots` need the FTP server on 127.0.0.1:2121
  (`test/ftpd.py`, `pip install pyftpdlib`); `test/e2e-browser.sh` starts its own web server.
- A script that opens a native dialog must answer it first with `window.api.app.testNextDialog(...)`: a real sheet
  left open blocks the Mac's keyboard until someone dismisses it.
- Never run a script by executing `/Applications/MobAlt.app/Contents/MacOS/MobAlt`; `test/qa/localnet-check.sh` shows
  how to launch a packaged app with its own user-data folder.

## Making a change

1. **One topic per branch**, branched from `main` (`feat/…`, `fix/…`, `docs/…`).
2. **[Conventional Commits](https://www.conventionalcommits.org/)** — `feat(sftp): …`, `fix(ssh): …`, `docs: …`,
   `test: …`. `semantic-release` computes the version and writes `CHANGELOG.md` from them (`feat` → minor, `fix` →
   patch, `feat!` or a `BREAKING CHANGE:` footer → major), so the subject is a changelog line and the body says why.
   Put a `#name` (a CSS id, an element) in backticks in the subject: the release notes turn a bare `#…` into an
   issue link.
3. **Strings**: every user-visible text is English in the code and goes through `t()` / `tn()`, one sentence per
   string. After adding or rewording one, run `npm run i18n` and commit `src/locales/catalog.json`, then translate the
   delta in every `src/locales/<code>.json` — or run `I18N_STRICT=0 npm test` and say in the PR that translations
   follow. Procedure and rules: [src/locales/README.md](src/locales/README.md).
4. **Docs travel with the change**: a visible change gets its paragraph in `docs/USER_GUIDE.md` (the translated
   guides follow with the translations); a feature gets its line in `README.md` / `README.ko.md` and its row in
   `docs/MOBAXTERM_PARITY.md` + `.ko.md`, with the summary counts kept consistent.
5. **Tests**: a unit test under `test/unit/` for logic, an e2e script (or a phase of one) for behaviour in the window.
   CI runs `npm test` on macOS, a gitleaks scan and an unsigned `npm run pack`.
6. **Pull request** against `main`, with the template filled in: what changed, how it was verified (commands and
   numbers), what is left for translation. The maintainer merges; releases are cut from `main` automatically.

## Code conventions

- CommonJS in `src/main/`, plain ES modules in `src/renderer/`, no framework, no build step.
- Anything that touches the network, the file system or secrets lives in `src/main/` behind an `ipcMain.handle` and
  reaches the renderer through a `window.api` group in `src/main/preload.js`; the renderer never gets Node.
- Keep modules small and follow the pane / IPC / preload patterns that are there; comments explain *why*.
- Hygiene is enforced by `test/unit/hygiene.test.js` and gitleaks: fixtures use `192.0.2.x`, `198.51.100.x`,
  `203.0.113.x` and `example.com`; no real host names, addresses, e-mail addresses, keys or tokens in the tree.
- ssh2 carries the post-quantum key exchange through `patches/ssh2+1.17.0.patch` (`patch-package`, applied by
  `postinstall`). After an ssh2 bump, re-apply it to the new version and regenerate it with
  `npx patch-package ssh2 --exclude 'package\.json$|/build/'`; without the patch MobAlt still starts, with the option
  greyed out.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
