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
| `zdotdir/` | Generated zsh integration files for local terminals. |

Session logs (optional) go to `~/Documents/MobAlt Logs/`.

## Network behaviour

MobAlt only connects to the hosts you configure (SSH, SFTP, Telnet, tunnels, ping/traceroute/port
scan targets you type in). There is no telemetry and no crash reporting. The optional update check
(on by default, Settings → Updates) fetches the release manifest from GitHub and downloads an
update only after you confirm.
SSH host keys are verified against `~/.ssh/known_hosts` and the app's own `known_hosts`; a changed
key is reported and never accepted silently.

## Build integrity

Release builds are produced by GitHub Actions from the tagged commit, signed with a Developer ID
Application certificate and notarized by Apple. Every push is scanned with gitleaks, and signing
material (`*.p12`, `*.p8`) is git-ignored.
