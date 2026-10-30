# MobAlt

**A MobaXterm-style SSH / SFTP / terminal workbench for macOS.**

[![Release](https://img.shields.io/github/v/release/Hyeongcheol-An/MobAlt?display_name=tag)](https://github.com/Hyeongcheol-An/MobAlt/releases)
[![Release workflow](https://github.com/Hyeongcheol-An/MobAlt/actions/workflows/release.yml/badge.svg)](https://github.com/Hyeongcheol-An/MobAlt/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[한국어 README](README.ko.md) · [User guide](docs/USER_GUIDE.md)

![MobAlt: session tree, two remote shells side by side](docs/images/hero.png)

If you lived in MobaXterm on Windows and miss it on a Mac, MobAlt gives you the same workflow in one
window: a session tree, tabbed and split terminals, an SFTP browser that opens with every SSH
connection, port forwarding, MultiExec, X11 forwarding, macros, network tools and serial consoles.
It is a native-feeling Electron app built on xterm.js, ssh2 and node-pty.

## Features

| MobaXterm | MobAlt | Notes |
|---|---|---|
| Sessions sidebar (folders, search) | ✅ Sessions panel | Nested folders, drag to move, filter, context menu, duplicate |
| SSH (password / key / agent) | ✅ | Automatic order key → agent → password, keyboard-interactive (2FA), passphrase prompts, `~/.ssh/config` and ProxyJump |
| Saved passwords (master password) | ✅ | Encrypted with Electron `safeStorage` (macOS Keychain) |
| Host key checking | ✅ | `~/.ssh/known_hosts` plus the app's own list; changed keys are flagged |
| SFTP browser on connect | ✅ Sftp panel | Upload/download (recursive, progress, cancel), mkdir, rename, chmod, delete, hidden files |
| Follow terminal folder | ✅ | OSC 7 shell hook for bash/zsh, per session |
| Remote file editing | ✅ | Built-in editor (⌘S saves back) or your external editor with auto-upload |
| Drag & drop upload | ✅ | Drop Finder items on the SFTP list or on a terminal |
| Built-in X server | ✅ via XQuartz | Starts XQuartz on demand and proxies the X11 channel with cookie replacement |
| MobaSSHTunnel | ✅ Tunneling | Local (-L), remote (-R) and dynamic SOCKS5 (-D); per-session auto-start or standalone |
| MultiExec | ✅ | Type into every terminal at once (⇧⌘M) |
| Split terminals | ✅ | Right/down splits and grids up to 2 × 4 (8 panes); drag sessions onto empty panes or pane edges; drag tabs between panes |
| Macros | ✅ | Record/replay keystrokes, text macros, play to all terminals |
| Tools | ✅ Tools panel | Ping, traceroute, DNS lookup, port scan, network info |
| Telnet | ✅ | NAWS/TTYPE negotiation |
| Serial console | ✅ | USB-serial discovery, baud/framing/flow control, local echo, CR/LF/CRLF |
| Local terminal | ✅ | Your login shell (zsh/bash) with folder-following integration |
| Session logging | ✅ | Per session or from the tab menu |
| RDP / VNC | ⚠️ hands off | RDP writes a `.rdp` file for Windows App; VNC opens macOS Screen Sharing |
| MobaXterm.ini import | ✅ | Best-effort import of the Bookmarks section; `~/.ssh/config` import too |
| Mosh | ✅ | Runs the mosh client in a pane (needs `brew install mosh`); ssh bootstrap with keys or interactive prompts; SFTP via a companion SSH connection |
| FTP / FTPS | ✅ | Explicit-TLS FTPS, anonymous FTP; browsed, transferred and edited in the Sftp panel |

Workspace restore brings back your tabs, splits and sessions (local shells keep their folder) on
the next launch and reconnects SSH automatically. MobAlt checks GitHub Releases for updates at
startup (Settings → Updates, or Help → Check for Updates…) and installs them only when you agree.

<table>
<tr>
<td><img src="docs/images/split-grid.png" alt="2×2 grid with empty panes ready for drag & drop"></td>
<td><img src="docs/images/sftp-panel.png" alt="File browser panel (SFTP / FTP)"></td>
</tr>
<tr>
<td><img src="docs/images/session-editor.png" alt="Session editor with icons, colours and authentication"></td>
<td><img src="docs/images/tunnels.png" alt="Tunnel manager"></td>
</tr>
</table>

## Install

**Requirements**: macOS 13 Ventura or later, Apple Silicon or Intel. Optional: [XQuartz](https://www.xquartz.org/)
for X11 forwarding, [Windows App](https://apps.apple.com/app/windows-app/id1295203466) for RDP.

### Homebrew

```bash
brew tap Hyeongcheol-An/tap
brew trust Hyeongcheol-An/tap      # Homebrew 7+ asks you to trust third-party taps once
brew install --cask mobalt
```

Later updates: `brew upgrade --cask mobalt`. The cask is also kept in this repository (`Casks/mobalt.rb`).

### DMG

1. Download `MobAlt-<version>-arm64.dmg` (Apple Silicon) or `MobAlt-<version>-x64.dmg` (Intel) from
   [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases).
2. Open it and drag **MobAlt** to **Applications**.

Release builds are signed with a Developer ID certificate and notarized, so they open without
Gatekeeper warnings. If you run a build you made yourself, right-click the app → **Open** the first
time, or clear quarantine with `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.

## Using MobAlt

The [user guide](docs/USER_GUIDE.md) walks through everything; the short version:

- **Sessions**: `＋ Session` (⌘N) → choose SSH / Mosh / Local / Telnet / Serial / FTP / RDP / VNC → save & connect.
  Double-click a session in the sidebar to connect; drag sessions into folders and folders into each other.
- **Quick connect**: type `user@host[:port]` in the toolbar field and press Enter. `mosh://`, `telnet://`,
  `ftp://`, `ftps://`, `rdp://` and `vnc://` prefixes work too.
- **SFTP**: opens automatically for SSH sessions. Double-click to navigate or edit, `>_` sends `cd` to
  the terminal, the terminal can follow your shell's folder (session option).
- **Tunnels**: `Tunneling` (⇧⌘U) starts tunnels over an open connection or a saved session; tunnels
  listed in a session's Tunnels tab start with the session.
- **Splits**: `Split ▾` creates an empty pane on the right/bottom or a grid (up to 2 columns × 4 rows).
  Drop a session from the sidebar onto an empty pane to connect there; drop on a pane edge to split in
  that direction; drop in the centre to replace. Drag a tab onto a pane to move that terminal.
  A folder's context menu can open all of its sessions in a grid.
- **Icons & colours**: pick an emoji and a colour in the session editor; they show in the sidebar, tab
  and pane header.
- **Startup commands** (MobaXterm's *Execute command*): lines in the session editor's Terminal tab are
  typed into the terminal once it is ready, for every session type. Example: a local session with
  *Start folder* set to a project and `claude --resume <id>` as the startup command.
- **MultiExec**: toolbar button or ⇧⌘M; while on, keystrokes go to every terminal.
- **Keyboard**: Help → Keyboard Shortcuts. Right-click pastes (⇧-right-click for the menu), selecting
  copies. Shift+Enter and Option+Enter send ESC+CR, which TUI apps such as Claude Code treat as a newline.

## Data and privacy

Everything lives in `~/Library/Application Support/MobAlt/`: `sessions.json` (passwords and
passphrases encrypted through the macOS Keychain), `settings.json`, `known_hosts`, `workspace.json`.
Session logs default to `~/Documents/MobAlt Logs/`. MobAlt talks only to the hosts you configure;
there is no telemetry; the optional update check only downloads the release manifest from GitHub. Details in [SECURITY.md](SECURITY.md).

## Development

Requirements: Node.js 22+, Xcode Command Line Tools (for `node-pty`), Python 3 (icon/DMG assets).

```bash
git clone https://github.com/Hyeongcheol-An/MobAlt.git
cd MobAlt
npm install            # rebuilds node-pty for Electron
npm start              # run from source
npm test               # unit tests
npm run pack           # dist/mac-arm64/MobAlt.app (unsigned)
npm run dist           # DMG + zip for arm64 and x64
npm run install:local  # build arm64, sign if a Developer ID identity is available, install to /Applications
```

In shells that export `ELECTRON_RUN_AS_NODE=1` (VS Code's integrated terminal), run
`env -u ELECTRON_RUN_AS_NODE npm start`.

### Layout

```
src/main/        Electron main process
  main.js        window, menu, IPC routing, test hooks
  preload.js     window.api (contextBridge)
  store.js       sessions.json / settings.json / workspace.json (secrets via safeStorage)
  terminals.js   terminal registry, local pty (node-pty), telnet, serial
  ssh.js         ssh2 connection: auth handler, jump hosts, X11, shell
  sftp.js        SFTP listing, file operations, transfers, remote edit
  tunnels.js     -L / -R / -D (SOCKS5) forwarding
  x11.js         XQuartz discovery/start and X11 channel proxy
  knownhosts.js  host key verification
  importers.js   ~/.ssh/config and MobaXterm.ini import
  tools.js       ping / traceroute / port scan / DNS
  zdotdir.js     zsh integration for local shells (OSC 7)
src/renderer/    renderer (plain ES modules, no framework)
  app.js         controller: actions, events, status bar
  terminal.js    xterm.js pane: themes, search, drag & drop, reconnect
  layout.js      tabs and the split tree
  sidebar.js     session tree
  sftp.js        SFTP panel
  panels.js      Tools / Macros panels
  dialogs.js     session editor, settings, tunnels, host key and password prompts
test/
  unit/          node --test unit tests
  start-sshd.sh  user-level test sshd on port 2222 (keys, SFTP, X11, forwarding)
  e2e-*.js       scripts executed inside the app (SSH/SFTP/X11/tunnels, UI, auth, serial, workspace, FTP, Mosh)
  ftpd.py        throwaway FTP server for e2e-ftp.js (pip install pyftpdlib)
  qa/            harness for driving the real app with a script and taking screenshots
```

### End-to-end tests

```bash
test/start-sshd.sh start
S=/tmp/mobalt-e2e; mkdir -p $S/userdata $S/shots
MOBALT_USER_DATA=$S/userdata MOBALT_TEST_SCRIPT=test/e2e-ssh.js MOBALT_SHOT_DIR=$S/shots \
MOBALT_SCREENSHOT=$S/shots/final.png MOBALT_SCREENSHOT_DELAY=120000 npx electron .
test/start-sshd.sh stop
```

Each script prints a `RESULTS {...}` line and saves screenshots to `MOBALT_SHOT_DIR`. The test hooks
only exist while `MOBALT_TEST_SCRIPT` is set.

## Releasing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor,
`fix:` → patch, `feat!:` → major). Every push to `main` runs `.github/workflows/release.yml`:
gitleaks secret scan → unit tests → `semantic-release`, which bumps the version, writes
`CHANGELOG.md`, builds and signs the DMG/zip for both architectures, notarizes them, publishes a
GitHub Release and pushes the updated cask to
[Hyeongcheol-An/homebrew-tap](https://github.com/Hyeongcheol-An/homebrew-tap).

Release builds are signed with the maintainer's Developer ID certificate and notarized by Apple inside
the workflow. Local builds (`npm run install:local`) sign with a Developer ID identity from your own
keychain when one is present; otherwise they are unsigned and need right-click → Open once.

## Known limitations

- Setting `DISPLAY` in `~/.zprofile` or similar on the remote side overrides the forwarded X11 display.
- MobaXterm.ini is an undocumented format: hosts, ports, users, folders and the X11 flag are imported,
  passwords are not. Convert `.ppk` keys with `puttygen` to OpenSSH format.
- Mosh needs the `mosh` client on this Mac and `mosh-server` on the remote host (UDP 60000-61000).
- If a connection fails with *Timed out while waiting for handshake* or `ETIMEDOUT`, check reachability
  with `nc -vz <host> <port>` first; repeated authentication failures can get your IP banned by
  fail2ban or sshd `PerSourcePenalties` on the server.

## License

[MIT](LICENSE) © Hyeongcheol An
