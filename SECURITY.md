# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability
reporting instead: **Security → Report a vulnerability** on
https://github.com/Hyeongcheol-An/MobAlt. You will get a response within a week.

## What MobAlt stores and where

Everything stays on your Mac under `~/Library/Application Support/MobAlt/`:

| File | Contents |
|---|---|
| `sessions.json` | Saved sessions. Passwords and key passphrases are encrypted with Electron `safeStorage`, whose key lives in the macOS Keychain ("MobAlt Safe Storage"). Other users and other apps cannot read them. |
| `settings.json` | Preferences only, no secrets. |
| `known_hosts` | Host keys accepted in the app (in addition to `~/.ssh/known_hosts`). |
| `workspace.json` | Open tabs and split layout, referencing sessions by id only. |
| `zdotdir/` | Generated zsh integration files for local terminals, and the local shell's history (`.zsh_history`) unless your zsh files set `HISTFILE`. |
| `Partitions/browser*` | Cookies and cache of browser panes (cookies encrypted). |

These files are written readable by your account only (0600). If the Keychain cannot be used, secrets are
stored base64-encoded only and the app warns once per run.
Session logs (optional, 0600) go to `~/Documents/MobAlt Logs/`. A remote file opened with *Edit in external
editor* is copied to `$TMPDIR/mobalt-edit/` and deleted when MobAlt quits.

## Network behaviour

MobAlt only connects to the hosts you configure (SSH, SFTP, Telnet, tunnels, ping/traceroute/port
scan targets you type in). There is no telemetry and no crash reporting. The optional update check
(on by default, Settings → Updates) fetches the release manifest from GitHub and downloads an
update only after you confirm.
SSH host keys are verified against `~/.ssh/known_hosts` and the app's own `known_hosts`; a changed
key is reported and never accepted silently.

## Build integrity

Release builds are produced by GitHub Actions from the tagged commit, signed with a Developer ID
Application certificate and notarized by Apple; a release run on `main` fails rather than publish an
unsigned build. The workflow's actions are pinned by commit and only the release job gets a write token.
Every push is scanned with gitleaks, and signing material (`*.p12`, `*.p8`) is git-ignored.

The Electron fuses of a release turn off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and the inspector flags,
encrypt cookies, validate the integrity of `app.asar` and load the app only from it. The QA test hooks
(`MOBALT_TEST_SCRIPT` and friends, `test/qa/README.md`) are ignored by every packaged build except one made
with `npm run pack:qa`, which is never released.
