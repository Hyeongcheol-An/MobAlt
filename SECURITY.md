# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/Hyeongcheol-An/MobAlt/security/advisories/new). That is the
only channel; there is no security e-mail address.

Include the MobAlt version (MobAlt → About MobAlt, or the status bar), the macOS version and the steps to reproduce.
A proof of concept against a test server you control is welcome; never send real credentials, keys or host names.

You get an answer within a week, and an assessment within two. A confirmed problem is fixed in a patch release
that reaches users through the in-app updater and the Homebrew cask; the advisory and the release notes credit you
unless you ask not to be named. Please keep the details private until the fixed release is out (90 days at most).

## Supported versions

| Version | Security fixes |
|---|---|
| Latest minor release (1.x) | Yes, as a patch release |
| Older minor releases | No: update; upgrades within 1.x keep your sessions and settings ([docs/VERSIONING.md](docs/VERSIONING.md)) |
| 0.x | No |

## Scope

In scope: the app as released here and through the Homebrew cask — the main and renderer processes, the preload
bridge, browser panes; how it stores and handles credentials; everything that crosses a trust boundary (SSH host
keys, X11 and agent forwarding, tunnels, SFTP / FTP(S) / Telnet / serial / Zmodem input, terminal escape sequences,
pages shown in browser panes); the files it imports (sessions JSON, `MobaXterm.ini`, `~/.ssh/config`); the update
channel and the release workflow.

Out of scope:
- An attacker who already runs code as your macOS user or has your unlocked Mac.
- Commands you run yourself: in a terminal, a local shell or a session's startup commands. Running them is what
  MobAlt is for.
- The weakness of a protocol or option you chose: Telnet, FTP without TLS, "Legacy algorithms", accepting an
  untrusted certificate.
- A vulnerability in Electron / Chromium, ssh2 or another dependency that is already fixed upstream — but do tell us
  when a release still ships the vulnerable version.

## What MobAlt stores and where

Everything stays on your Mac, under `~/Library/Application Support/MobAlt/` unless noted:

| File | Contents |
|---|---|
| `sessions.json` | Saved sessions. Passwords, key passphrases and jump-host passwords are encrypted with Electron `safeStorage`, whose key is in your login keychain ("MobAlt Safe Storage"); copied to another Mac, the file brings the sessions without their secrets. Private keys are referenced by path, never copied. |
| `settings.json` | Preferences only, no secrets. |
| `known_hosts` | Host keys you accepted in MobAlt. `~/.ssh/known_hosts` is read, never written. |
| `workspace.json` | Open tabs and the split layout, sessions referenced by id; a browser pane keeps its last address. |
| `zdotdir/` | Generated zsh integration files for local terminals (folder following), and the local shell's history (`.zsh_history`) unless your zsh files set `HISTFILE`. |
| `Partitions/browser*/` | Cookies and site data of browser panes (`persist:browser`, or `persist:browser-<id>` for a session with its own sign-ins). Cookies are encrypted. |
| `~/Documents/MobAlt Logs/` | Session logs, only when you turn logging on. A log is the raw terminal stream, so it holds whatever the terminal showed. |
| `$TMPDIR/mobalt-edit/` | Local copies of remote files opened with Edit (your per-user temporary folder); deleted when MobAlt quits, and a copy an interrupted run left behind is removed a day later. |
| `$TMPDIR/mobalt-rdp/` | The `.rdp` file handed to Windows App: host and user name, never a password. |

These files are written readable by your account only (0600). If the Keychain cannot be used, secrets are stored
base64-encoded only and the app warns once per run. Passwords never reach the interface: the window gets a "has a
password" flag, and a sessions export never contains a password or passphrase.

## Network behaviour

MobAlt connects only to what you configure or type: SSH, Mosh, Telnet, FTP / FTPS and serial sessions, tunnel
endpoints, the targets of the Tools panel, and the pages you open in a browser pane. There is no telemetry, analytics
or crash reporting.

- **Updates**: the check (on by default, Settings → Updates) reads `latest-mac.yml` from the latest GitHub release
  over HTTPS. An update is downloaded only after you agree and installed when you restart or quit; the update is a
  signed, notarized bundle, and macOS verifies its signature before it runs.
- **Host keys**: a new key is shown with its fingerprint before any password or key is sent; a changed key is
  reported and never accepted silently.
- **Forwarding**: X11 and agent forwarding are off unless a session turns them on. X11 forwarding hands the server a
  random cookie and puts the real one in only on the way to the local X server. Tunnels listen on 127.0.0.1 unless
  you choose another address.
- **Browser panes** load `http://` and `https://` only, in a sandboxed `<webview>` without Node or a preload; a popup opens in the
  same pane (never a new window), device permissions and `file:` / `javascript:` / `data:` addresses are refused; a password in an address
  (`user:secret@host`) is refused; HTTP sign-ins go through MobAlt's own prompt and are not stored.
- **Local Network**: on macOS 15 and later the system asks once before MobAlt may reach hosts on your local network.

## Build integrity

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on every push to `main`: a gitleaks secret
scan, the unit tests, then `semantic-release`, which builds the DMG and zip for both architectures, signs them with
a Developer ID Application certificate (Team ID `325WWNX46Q`) and the hardened runtime, has Apple notarize them,
publishes the GitHub Release and updates the Homebrew cask, which pins the DMG's SHA-256. A release run fails rather
than publish an unsigned build; the workflow's actions are pinned by commit and only the release job gets a write
token.

The packaged app's Electron fuses switch off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and the `--inspect` arguments,
switch on cookie encryption, validate the integrity of `app.asar` and load the app only from it. The QA test hooks
(`MOBALT_TEST_SCRIPT` and friends, `test/qa/README.md`) are ignored by every packaged build except one made with
`npm run pack:qa`, which is never released.

Signing material is never in the repository (`*.p12`, `*.p8`, `*.pem`, `*.key`, `.env*` are git-ignored); every push is scanned with
gitleaks, and `test/unit/hygiene.test.js` refuses real host names, addresses, e-mail addresses and keys in the tree.

To check a download yourself:

```bash
shasum -a 256 MobAlt-<version>-arm64.dmg          # compare with sha256 in Casks/mobalt.rb
hdiutil attach -readonly MobAlt-<version>-arm64.dmg
spctl -a -vv -t exec "/Volumes/MobAlt <version>-arm64/MobAlt.app"   # (or -x64) accepted, source=Notarized Developer ID
```
