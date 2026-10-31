<p align="center">
  <img src="docs/images/icon.png" width="128" height="128" alt="MobAlt app icon">
</p>

<h1 align="center">MobAlt</h1>

<p align="center"><strong>A MobaXterm-style SSH / SFTP / terminal workbench for macOS.</strong></p>

<p align="center">
  <a href="https://github.com/Hyeongcheol-An/MobAlt/releases"><img src="https://img.shields.io/github/v/release/Hyeongcheol-An/MobAlt?display_name=tag" alt="Release"></a>
  <a href="https://github.com/Hyeongcheol-An/MobAlt/actions/workflows/release.yml"><img src="https://github.com/Hyeongcheol-An/MobAlt/actions/workflows/release.yml/badge.svg" alt="Release workflow"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center"><a href="README.ko.md">한국어 README</a> · <a href="docs/USER_GUIDE.md">User guide</a></p>
<p align="center">User guide in: <a href="docs/USER_GUIDE.md">English</a> · <a href="docs/USER_GUIDE.ko.md">한국어</a> · <a href="docs/USER_GUIDE.zh-CN.md">简体中文</a> · <a href="docs/USER_GUIDE.ja.md">日本語</a> · <a href="docs/USER_GUIDE.vi.md">Tiếng Việt</a> · <a href="docs/USER_GUIDE.hi.md">हिन्दी</a> · <a href="docs/USER_GUIDE.de.md">Deutsch</a> · <a href="docs/USER_GUIDE.fr.md">Français</a> · <a href="docs/USER_GUIDE.es.md">Español</a> · <a href="docs/USER_GUIDE.pt.md">Português</a> · <a href="docs/USER_GUIDE.ar.md">العربية</a></p>

![MobAlt: session tree, two remote shells side by side](docs/images/hero.png)

If you lived in MobaXterm on Windows and miss it on a Mac, MobAlt gives you the same workflow in one
window: a session tree, tabbed and split terminals, an SFTP browser that opens with every SSH
connection, port forwarding, MultiExec, X11 forwarding, macros, network tools and serial consoles.
It is a native-feeling Electron app built on xterm.js, ssh2 and node-pty.

## Demo

![MobAlt demo: sessions, SFTP, split terminals, MultiExec, zoom, themes](docs/images/demo.gif)

A 35-second tour: the session tree, a remote shell, the file browser, a split tab with MultiExec typing into both
panes, a zoomed pane and a theme change (made-up hosts; `npm run demo` regenerates it).

## Features

| MobaXterm | MobAlt | Notes |
|---|---|---|
| Sessions sidebar (folders, search) | ✅ Sessions panel | Nested folders, drag to move, filter, context menu, duplicate |
| SSH (password / key / agent) | ✅ | Automatic order key → agent → password, keyboard-interactive (2FA), passphrase prompts, `~/.ssh/config` and ProxyJump |
| Saved passwords (master password) | ✅ | Encrypted with Electron `safeStorage` (macOS Keychain) |
| Host key checking | ✅ | `~/.ssh/known_hosts` plus the app's own list; changed keys are flagged |
| MobaKeyGen (SSH key generator) | ✅ Generate SSH Key… | Ed25519 / RSA 4096 / ECDSA through `ssh-keygen`, passphrase, public key + fingerprint, add to ssh-agent, install on a server like `ssh-copy-id`; *Generate…* in the session editor fills the key field |
| Expert SSH settings (KEX / host key / ciphers / MACs) | ✅ | Per-session algorithm lists in Advanced SSH, validated against ssh2, "Legacy algorithms" as a preset; a mismatch says what both sides offer (no ML-KEM yet: ssh2) |
| SFTP browser on connect | ✅ Sftp panel | Upload/download (recursive, progress, cancel), mkdir, rename, chmod, delete, hidden files |
| Follow terminal folder | ✅ | OSC 7 shell hook for bash/zsh, per session |
| Remote monitoring bar | ✅ | CPU, memory, root disk, network rates, load, uptime and host name under every SSH pane, polled every 3 s (2–30 s) by one `sh` snippet over the session's own connection; per session, per pane (pane head, View menu) or for all in Settings |
| Remote file editing | ✅ | Built-in editor (⌘S saves back) or your external editor with auto-upload |
| Drag & drop upload | ✅ | Drop Finder items on the SFTP list or on a terminal |
| Built-in X server | ✅ via XQuartz | Starts XQuartz on demand and proxies the X11 channel with cookie replacement |
| MobaSSHTunnel | ✅ Tunneling | Local (-L), remote (-R) and dynamic SOCKS5 (-D); per-session auto-start or standalone |
| MultiExec | ✅ | Type into every visible terminal of the tab at once (⇧⌘M); an *Exclude "name" from MultiExec mode* box under each terminal, Activate all / none / Invert selection and synchronised wheel scrolling in the right-click menu |
| Paste guard (multi-line confirmation, malicious-paste checks) | ✅ | A multi-line or long paste asks first with an editable preview; every paste is checked for zero-width / bidi / control characters, a trailing newline, `curl \| sh`, profile writes, `rm -rf /` and look-alike letters, with a "Paste cleaned" option |
| Split terminals | ✅ | Right/down splits and grids up to 2 × 4 (8 panes); drag sessions onto empty panes or pane edges; drag tabs between panes; ⌥⌘1 unsplits — the other panes become tabs of their own (or close, or ask: Settings) |
| Per-pane settings and a background label | ✅ | Right-click a pane: Rename Pane, Pane Settings (theme, font, cursor, scrollback, highlighting, monitoring, read-only for that pane, or saved to its session), Font Size, Read-Only, and an iTerm2-style background label — a large, dim session name behind the text |
| Macros | ✅ | Record/replay keystrokes, text macros, play to all terminals |
| Tools | ✅ Tools panel | Ping, traceroute, DNS lookup, port scan, network info, Wake-on-LAN, network scanner |
| Telnet | ✅ | NAWS/TTYPE negotiation |
| Serial console | ✅ | USB-serial discovery, baud/framing/flow control, local echo, CR/LF/CRLF |
| Zmodem (rz/sz) | ✅ | In-terminal file transfers for SSH, local, telnet and serial panes; `sz` downloads, `rz` uploads, with progress and cancel in the transfer list |
| Local terminal | ✅ | Your login shell (zsh/bash) with folder-following integration |
| Session logging | ✅ | Per session or from the tab menu |
| RDP / VNC | ⚠️ hands off | RDP writes a `.rdp` file for Windows App; VNC opens macOS Screen Sharing |
| MobaXterm.ini import | ✅ | Best-effort import of the Bookmarks section; `~/.ssh/config` import too |
| Sessions export / import | ✅ | JSON file of every session and folder, never a password or passphrase (Session menu or the tree's context menu); importing merges by id and adds the rest |
| Maximise a split pane | ✅ Zoom | ⇧⌘⏎ (or ⤢ in the pane head) fills the tab with the focused pane and brings the layout back; each tab keeps its zoom, also across a restart |
| Pinned tabs, close tabs left / right, detach to a window | ✅ | ⇧⌘P pins a tab at the left (short title, no ✕, kept across restarts); Close Others / Tabs to the Left / Tabs to the Right / All skip pinned tabs and ask once, counting every live connection; ⌥⌘N moves a tab into its own window with its terminals alive, closing that window brings them back, and the workspace reopens such windows |
| Interface language | ✅ | English, 한국어, 简体中文, 日本語, Tiếng Việt, हिन्दी, Deutsch, Français, Español, Português, العربية — follows the macOS language list or Settings → General → Language, switches at once without a restart; the user guide exists in every one |
| Colour themes / dark mode | ✅ | Moba Dark, One Dark, Dracula, Solarized Dark, Gruvbox Dark and Light colour the whole window (toolbar, sidebar, tabs, dialogs), not only the terminals; a session can override its own terminal theme |
| Keyword highlighting | ✅ | Errors, warnings, OK, IP addresses, URLs and sizes coloured in every terminal by an editable rule table (plain text or regex, colour / background / bold / underline; Settings → Features), colours from the theme; a session can switch it on or off |
| Mosh | ✅ | Runs the mosh client in a pane (needs `brew install mosh`); ssh bootstrap with keys or interactive prompts; SFTP via a companion SSH connection |
| FTP / FTPS | ✅ | Explicit-TLS FTPS, anonymous FTP; browsed, transferred and edited in the Sftp panel |

Full feature-by-feature comparison with MobaXterm 26.6: [docs/MOBAXTERM_PARITY.md](docs/MOBAXTERM_PARITY.md).

Workspace restore brings back your tabs, splits and sessions (local shells keep their folder, a
zoomed pane stays zoomed) on the next launch and reconnects SSH automatically. MobAlt checks GitHub Releases for updates at
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

**Updating**: the in-app updater, `brew upgrade --cask mobalt` or a new DMG all work while MobAlt is running —
the app then shows a relaunch banner. See [Updating](docs/USER_GUIDE.md#updating) in the user guide.

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
  A folder's context menu can open all of its sessions in a grid. ⇧⌘⏎ zooms the focused pane to
  fill the tab and back.
- **Pane menu**: right-click a terminal for *Rename Pane…*, *Pane Settings…* (theme, font, cursor, scrollback,
  keyword highlighting, monitoring bar and read-only for that pane — applied to it alone or saved to its session),
  *Font Size ▸*, *Read-Only* and *Background Label ▸*: a large, dim name behind the text (the session name by
  default, also set per session in the editor's Terminal tab) so you can tell the server at a glance.
- **Icons & colours**: pick an emoji and a colour in the session editor; they show in the sidebar, tab
  and pane header.
- **Startup commands** (MobaXterm's *Execute command*): lines in the session editor's Terminal tab are
  typed into the terminal once it is ready, for every session type. Example: a local session with
  *Start folder* set to a project and `claude --resume <id>` as the startup command.
- **MultiExec**: toolbar button or ⇧⌘M; while on, keystrokes go to every terminal visible in the active tab (its split panes), not to other tabs. Tick the box under a terminal to exclude it (it stays connected; what you type into it goes to it alone); right-click a box's strip or the banner for Activate all / none, Invert selection and synchronised wheel scrolling.
- **Keyboard**: Help → Keyboard Shortcuts. Right-click pastes (⇧-right-click for the menu), selecting
  copies. Shift+Enter and Option+Enter send ESC+CR, which TUI apps such as Claude Code treat as a newline;
  with an image on the clipboard, ⌘V hands it to Claude Code (`[Image #1]`).

## Data and privacy

Everything lives in `~/Library/Application Support/MobAlt/`: `sessions.json` (passwords and
passphrases encrypted through the macOS Keychain), `settings.json`, `known_hosts`, `workspace.json`.
Session logs default to `~/Documents/MobAlt Logs/`. MobAlt talks only to the hosts you configure;
there is no telemetry; the optional update check only downloads the release manifest from GitHub. Details in [SECURITY.md](SECURITY.md).

## Development

Requirements: Node.js 22+, Xcode Command Line Tools (for `node-pty`). Regenerating the icon/DMG assets
(`npm run assets`) also needs librsvg and ImageMagick: `brew install librsvg imagemagick`.

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
  tools.js       ping / traceroute / port scan / DNS, and the probes the scanner uses
  wol.js         Wake-on-LAN magic packet
  netscan.js     network scanner: CIDR / range expansion, worker queue
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
