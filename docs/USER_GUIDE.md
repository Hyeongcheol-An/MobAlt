# MobAlt User Guide

[한국어 안내서](USER_GUIDE.ko.md)

MobAlt is a MobaXterm-style workbench for macOS: a session tree on the left, tabbed and split
terminals in the middle, and an SFTP browser, network tools and macros in side panels.

See also: [MobaXterm 26.6 feature parity](MOBAXTERM_PARITY.md) — what MobAlt has, lacks and does differently, with the roadmap.

![MobAlt with two remote shells side by side](images/hero.png)

Contents: [Install](#install) · [Updating](#updating) · [Sessions](#sessions) · [Connecting](#connecting) ·
[Terminal](#terminal) · [Files (SFTP / FTP)](#files-sftp--ftp) · [Tunnels](#tunnels-port-forwarding) ·
[X11, Mosh, Serial, RDP/VNC](#x11-mosh-serial-rdpvnc) · [Tools and macros](#tools-and-macros) ·
[Workspace and settings](#workspace-and-settings) · [Keyboard shortcuts](#keyboard-shortcuts) ·
[Data and privacy](#data-and-privacy) · [Troubleshooting](#troubleshooting)

## Install

- **Homebrew**: `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (Homebrew 7 asks you to trust a third-party tap once; `brew upgrade --cask mobalt` updates later)
- **DMG**: download the Apple Silicon (`arm64`) or Intel (`x64`) DMG from
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) and drag MobAlt to Applications.

Releases are signed and notarized. Requirements: macOS 13 or later. Optional helpers:
[XQuartz](https://www.xquartz.org/) for X11 forwarding, `brew install mosh` for Mosh sessions,
Windows App for RDP.

MobAlt checks GitHub Releases for a newer version at startup and offers it in a dialog; nothing is
downloaded or installed without your confirmation. See [Updating](#updating).

## Updating

Three paths lead to a new release; all of them end with the new bundle at `/Applications/MobAlt.app`:

- **In-app updater**: MobAlt checks GitHub Releases at startup (turn this off in Settings → Updates) and
  Help → Check for Updates… or "Check now" in Settings → Updates runs the check by hand. A newer
  version is offered in a dialog, downloaded only when you say so and installed when you quit, or right
  away with "Restart now".
- **Homebrew**: `brew upgrade --cask mobalt` replaces the app in Applications.
- **DMG**: download the new DMG from [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) and
  drag MobAlt to Applications, replacing the old one.

In-app updates and Homebrew get along. With "Check for updates at startup" on (Settings → Updates) MobAlt keeps
itself current, and `brew upgrade --cask mobalt` is always safe to run as well: if the app already updated
itself, Homebrew simply reinstalls the version that is already there. Because the cask declares `auto_updates`,
a plain `brew upgrade` (no cask named) skips MobAlt unless you pass `--greedy`; name the cask, or add
`--greedy`, when you want Homebrew to do the updating.

Upgrading while MobAlt is running is fine — even from one of MobAlt's own terminals. The running app keeps
executing the old version from memory, notices the new bundle on disk (within a minute, or as soon as the
window is focused again) and shows a banner above the tabs: *MobAlt 0.11.0 is installed on disk — you are
running 0.10.1. Relaunch to use it.* **Relaunch** asks about open SSH/FTP connections first (as ⌘Q does),
saves the workspace and starts the new version; your tabs come back through workspace restore. **Later**
hides the banner until yet another version appears. If the new bundle is already on disk when the updater
runs, nothing is downloaded again: the check reports "0.11.0 is already installed on disk; relaunch to use
it" and offers the same relaunch.

## Sessions

The **Sessions** panel is your bookmark tree. Create a session with `＋ Session` (⌘N), pick a type
and fill in the Basic tab. Double-click a session to connect; right-click for the context menu
(open, split right/down, edit, duplicate, delete, start a tunnel, new session in this folder).

![Session editor](images/session-editor.png)

| Type | What it does |
|---|---|
| SSH | Terminal over SSH with an SFTP browser, tunnels, X11 and agent forwarding |
| Mosh | Roaming terminal through the `mosh` client (bootstrapped over SSH) |
| Local | Your macOS login shell (zsh/bash) with folder following |
| Telnet | Classic telnet with NAWS/TTYPE negotiation |
| Serial | USB-serial console (baud, framing, flow control, local echo) |
| FTP | FTP / FTPS (explicit TLS) file browser in the Sftp panel |
| RDP / VNC | Hands off to Windows App or macOS Screen Sharing |

**Folders**: the folder button in the panel header (New folder) creates a folder; drag sessions and folders to move them (drop on the empty area
for the root). A folder's context menu can open every session inside it in a grid or in tabs.

**Icons and colours**: pick an emoji and a colour in the editor. They show on the row, the tab and the
pane header, so a red "production" session is hard to confuse with a green "staging" one.

**Import / export**: the panel footer imports `~/.ssh/config` (hosts, users, ports, keys, ProxyJump) and a
MobaXterm `MobaXterm.ini` (bookmarks). Export / import all sessions as JSON from the tree's
context menu. The JSON file holds every session and folder but never a password or passphrase: those stay in
MobAlt's encrypted store on this Mac, and the file only records that one was saved (`hasPassword`), so a
session imported on another Mac asks on its first connection. Import merges into what you have: a session
whose `id` matches an existing one is replaced by the file's version (a password saved here for it is kept),
every other one is added — a hand-written entry without an `id` is always added, and a `password` written
into the file is taken and stored encrypted — folders are added and nothing is deleted, so importing the same
file twice changes nothing. Entries without a name, with an unknown type or a bad port are skipped and
counted in the toast; a file that is not a MobAlt sessions file is refused with the reason. `~/.ssh/config`
skips hosts you already have (same folder and name). MobaXterm bookmarks go under a `MobaXterm` folder; one
imported before (same folder, name and host) is refreshed in place — host, port, user, X11 and compression
follow the `.ini`, while its saved password, icon, colour, tunnels and a key path you set stay — so importing
the same `.ini` twice changes nothing either.

**Startup commands** (Terminal tab): one command per line, typed into the terminal once it is
ready. For SSH that is right after login; for local shells right after the prompt appears. Example:
a local session with *Start folder* set to a project and `claude --resume <id>` as the command.

## Connecting

- **Quick connect**: type `user@host[:port]` in the toolbar and press Enter. Prefixes pick the
  type: `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. If a saved session
  matches, it is used.
- **Authentication**: *Automatic* tries a configured key, saved password, the SSH agent and the
  default keys in `~/.ssh` before prompting. Choose *Password*, *Private key* or *SSH agent* to
  restrict it. Keys with a passphrase prompt once; tick "Save in session" to keep it.
- **Host keys**: the first connection shows the fingerprint (SHA256 and MD5). Accepting stores the
  key; a changed key is flagged loudly and never accepted silently.
- **SSH keys**: Session → Generate SSH Key… (also the Tools panel, and *Generate…* next to the
  private-key field in the session editor) runs macOS's `ssh-keygen` for you: Ed25519 (default),
  RSA 4096 or ECDSA, a comment, an optional passphrase with a strength hint, and the file (default
  `~/.ssh/id_<type>`, numbered if that name is taken; `~/.ssh` is created private when missing,
  the files end up 0600 / 0644). It shows the public key with a Copy button and the fingerprint.
  "Add to ssh-agent" runs `ssh-add --apple-use-keychain`; "Install on a server…" connects to a saved
  session with its usual authentication and appends the public key to its `~/.ssh/authorized_keys`
  like `ssh-copy-id` (never twice). From the editor, *Use in this session* fills the key field.
- **Algorithms**: Advanced SSH → Algorithms lists what the session offers for key exchange, host
  key, ciphers and MACs, pre-filled with the built-in defaults; edit a list to restrict or reorder
  it (unknown names are refused inline), *Reset to defaults* puts the lists back, and "Legacy
  algorithms (old devices)" is a preset that adds the SHA-1 key exchanges, CBC ciphers and DSA host
  keys old appliances still need. Only lists that differ from the defaults are stored.
- **Jump hosts**: Advanced SSH → Jump host picks another saved session as the bastion (ProxyJump).
- **When it fails**: the terminal prints what happened, for example
  `authentication failed — server accepts: publickey; tried: ~/.ssh/id_ed25519`, or a hint that
  nothing answered on the port. See [Troubleshooting](#troubleshooting).

## Terminal

![Split grid](images/split-grid.png)

- **Tabs**: every session opens a tab. Drag tabs to reorder them, double-click to rename, middle-click
  to close. Local tabs are titled after their current folder.
- **Splits and grids**: `Split ▾` (⌘D right, ⇧⌘D down) adds an empty pane; the grid entries make
  1×2 … 2×4 layouts (⌥⌘2/4/6/8). Drop a session from the tree onto an empty pane to connect there,
  onto a pane's edge to split in that direction, or onto its centre to replace it. Drag a tab onto
  a pane to move that terminal into the split. ⌥⌘1 unsplits (keeps the focused pane).
- **Zoom a pane** (⇧⌘⏎, the ⤢ button in the pane head, or `Split ▾` → Zoom Pane): the focused
  pane fills the tab, like tmux's zoom or iTerm2's maximize. The other panes stay connected but
  hidden; the pane head shows a *zoomed* chip and the tab a small ⤢. Press again (or ⤡ in the head)
  to bring the layout back. Splitting, closing a pane, a grid layout or focusing a hidden pane (⌘])
  restores the layout first. Each tab keeps its own zoom, also across a restart.
- **MultiExec** (⇧⌘M): while on, every keystroke goes to every terminal visible on screen — the
  live panes of the active tab, or only the zoomed pane while one fills the tab. Other tabs never
  receive it, so split the tab (or use a grid) to put the servers you want to drive side by side.
  The banner shows how many visible terminals listen and follows the tab you switch to.
- **Find** (⌘F): incremental search with case and regex toggles and a match counter.
- **Clipboard**: selecting copies (Settings → Terminal → Copy on select); right-click pastes
  (⇧-right-click opens the menu). Dropping files from Finder on an SSH terminal uploads them;
  on a local terminal it pastes the paths.
- **Paste guard**: a paste with more than one line (or over 1000 characters) asks first — *Paste N
  lines into …?* shows the text in an editable preview; ⌘⏎ pastes, Esc cancels. Every paste is also
  checked for what the clipboard does not show: zero-width and bidi characters, control characters, a
  trailing newline (the last line would run at once), a carriage return inside a line, `curl … | sh`,
  writes to `~/.zshrc` and friends or `~/.ssh/authorized_keys`, `rm -rf /`-style commands and Latin
  words with Cyrillic or Greek look-alike letters. Findings are listed and marked in the preview;
  *Paste cleaned* strips the hidden characters and the trailing newline, *Paste as is* sends the text
  unchanged. Both checks are Settings → Terminal → Paste guard toggles (on by default); they cover ⌘V,
  right-click and text dropped on a pane, not macros. With MultiExec on, one confirmation covers every
  visible terminal.
- **Keys**: Shift+Enter and Option+Enter send ESC+CR (a newline in TUI apps such as Claude Code);
  Option acts as Meta by default.
- **Logging**: Terminal → Start/Stop Session Log, or the session option, writes the raw output to
  `~/Documents/MobAlt Logs/`. Settings → Logging → *Strip colours and control sequences* keeps the
  logs as plain text instead (ANSI colours, cursor movement and the folder-tracking hook are removed).
- **Themes and appearance**: Settings → Terminal → Theme colours the whole program, not only the terminals. The
  toolbar, sidebar, tabs, status bar, dialogs, menus, toasts and banners take a chrome palette derived
  from the chosen one — *Moba Dark* is the familiar dark chrome, *Light* is a light application with
  near-white panels and dark text, *One Dark*, *Dracula*, *Solarized Dark* and *Gruvbox Dark* tint the
  chrome in their own hue — and the native controls and the title-bar strip follow. Every text colour in
  the chrome keeps at least 4.5:1 contrast on its background, in every theme. The theme select shows a
  sample prompt in the palette's own colours; Save applies it at once. Settings → Terminal → Font applies to all
  terminals; a session can override theme and font in its Terminal tab — its own theme colours just that
  pane's terminal, the window keeps the global one.

## Files (SFTP / FTP)

![SFTP panel](images/sftp-panel.png)

The **Sftp** panel follows the active SSH or FTP pane. It opens automatically on connect
(Settings → General → "Switch to SFTP panel when SSH connects").

- Navigate by double-clicking folders, typing a path (`~` works) or using ⬆ / 🏠 / ⟳.
  "Follow terminal folder" keeps the panel on the shell's current directory (needs the session
  option, which injects a small prompt hook). `>_` sends `cd` to the terminal.
- Toolbar and context menu: new folder, rename, permissions, delete, download, upload. Multi-select
  with ⌘ / ⇧. Drag files from Finder onto the list to upload; existing names ask before overwriting.
- Double-click a text file to edit it in the built-in editor (⌘S saves back). "Edit in external
  editor" opens it in your editor (Settings → General → External editor) and re-uploads on every save.
- Transfers show progress, speed and a cancel button; "Show in Finder" after a download.
- Column headers sort by name, size or date. When the sidebar is narrow the date column hides.

## Tunnels (port forwarding)

![Tunnels](images/tunnels.png)

`Tunneling` (⇧⌘U) manages SSH port forwards:

- **Local (-L)**: `127.0.0.1:8080 → db.internal:5432` through the SSH host.
- **Remote (-R)**: a port on the server forwarded back to a local service.
- **Dynamic (-D)**: a local SOCKS5 proxy through the server.

Start a tunnel over an open connection or let MobAlt open a dedicated connection to a saved
session. Tunnels listed in a session's **Tunnels** tab start automatically when that session
connects, and you are told if one fails to bind.

## X11, Mosh, Serial, RDP/VNC

- **X11**: tick "X11 forwarding" in Advanced SSH. MobAlt starts XQuartz when needed, forwards the
  display and swaps the auth cookie, so `xeyes` or `gedit` just work. The status bar shows X11
  availability.
- **Mosh**: needs `brew install mosh` locally and `mosh-server` on the host (UDP 60000-61000).
  The pane runs the mosh client; the SSH bootstrap uses your key, agent or an interactive prompt.
  Set the `mosh-server` path if it is not on the remote PATH.
- **Mosh + SFTP**: mosh carries no SFTP channel, so the Sftp panel browses a Mosh host through a
  separate shell-less SSH connection to the same host (same key, agent and prompts). It opens
  automatically when "Open SFTP browser automatically" is on for the session (and "Switch to SFTP
  panel" in Settings → General), otherwise from the panel's "Open SFTP for this host (via SSH)" button or the
  pane menu's "Open SFTP Browser"; it is dropped together with the pane.
- **Serial**: the editor lists USB-serial devices; set baud, data/stop bits, parity, flow control,
  local echo and what Enter sends (CR, LF, CRLF).
- **RDP / VNC**: MobAlt writes an `.rdp` file and opens Windows App, or opens `vnc://` in Screen
  Sharing. The session keeps host, user and folder like any other bookmark.

## Tools and macros

- **Tools** panel: ping, traceroute, DNS lookup, port scan and local network info, with a Stop
  button for long runs.
- **Wake-on-LAN** (Tools panel): type the MAC address in any spelling (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` or bare hex) and press Wake: the magic packet goes out three times as a
  UDP broadcast (255.255.255.255, port 9 by default; a directed broadcast such as 192.168.1.255
  reaches another subnet). The last 10 addresses are remembered with an optional label and offered
  as you type.
- **Network scanner** (Tools panel): scan a CIDR (`192.168.1.0/24`), a range (`10.0.0.1-10.0.0.50`
  or `10.0.0.1-50`) or one host, up to a /16, by ICMP ping and/or TCP connects to a short port list
  (22, 80, 443, 3389, 5900 by default), with adjustable concurrency and timeout and a reverse DNS
  lookup of every hit. Hosts that answer appear in a sortable table as they are found (IP, host name,
  round-trip time, open ports) while the progress bar counts `123/254`; Stop cancels, ＋ opens the
  session editor with SSH to that host filled in, and "Copy as text" puts the table on the clipboard.
- **Macros** panel: record keystrokes in a terminal (● Rec / ■ Stop), save them under a name and
  replay them into the active terminal or into all terminals. Text macros can be typed directly;
  escape sequences such as `\n` or `\x1b[A` are supported.

## Workspace and settings

MobAlt restores your tabs, splits and sessions on the next launch and reconnects SSH sessions
(local shells reopen in their last folder). Turn this off in Settings → General → Behaviour.

![Settings](images/settings.png)

Settings has four tabs, each of which fits the smallest window without scrolling: **General**
(quit confirmation, the SFTP panel switch, workspace restore, the local shell and its folder
integration, the external editor, the download folder, SSH keep-alive, and "Open config folder",
which shows where everything is stored), **Terminal** (font, line height, cursor, scrollback, theme — the look of the whole
window, see *Themes and appearance* — mouse/keys), **Logging** (log folder, plain-text session logs) and **Updates** (the startup check
and "Check now").

## Keyboard shortcuts

| Action | Keys |
|---|---|
| New session / local terminal / quick connect | ⌘N / ⌘T / ⇧⌘N |
| Duplicate / reconnect / close tab / close pane | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Split right / down, unsplit | ⌘D / ⇧⌘D, ⌥⌘1 |
| Grid 2 / 4 / 6 / 8 panes | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Next pane, next / previous tab, tab 1-9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Zoom pane (fill the tab) / restore the layout | ⇧⌘⏎ |
| Find, clear, zoom | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Sidebar, Sessions / SFTP / Tools / Macros | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, tunnels, settings | ⇧⌘M, ⇧⌘U, ⌘, |
| Newline in TUI apps | ⇧Enter or ⌥Enter |
| Paste guard dialog (multi-line or suspicious paste): paste / cancel | ⌘⏎ / Esc |
| Focused tab: move / activate / close, context menu | ← → / ⏎ / ⌫, ⇧F10 or the Menu key |
| Focused session row: move / fold / open / open in split / delete | ↑ ↓ / ← → / ⏎ / ⌘⏎ or ⇧⏎ / ⌫ |
| Focused session row or folder: context menu (folders: Move to Folder…) | ⇧F10 or the Menu key |
| Focused macro: move / play / delete, context menu | ↑ ↓ / ⏎ / ⌫, ⇧F10 or the Menu key |
| SFTP list: move / open / parent folder / delete, context menu | ↑ ↓ Home End PgUp PgDn / ⏎ / ⌫ / Del, ⇧F10 or the Menu key |
| SFTP list: extend the selection / toggle the focused row / select all | ⇧↑ ⇧↓ ⇧Home ⇧End / Space / ⌘A |
| SFTP list: sort by a column | Tab to the Name / Size / Modified header, ⏎ or Space |
| Session tree and SFTP list: jump to a name | type its first letters, spaces included (the same letter again: next match) |
| Icon and colour picks in the session editor: move / choose | ← → ↑ ↓ / ⏎ or Space |
| Side strip panel buttons / ⌘1-4 | ⏎ moves the keyboard into the panel; switching panels remembers where it was |

Help → Keyboard Shortcuts shows the same list inside the app. Tab reaches the toolbar, the side
strip, the session tree, the macros list, the SFTP list and the tab strip (each list is one Tab
stop; the arrows move inside it); dialogs keep Tab inside them and hand focus back to the tab,
row or button that opened them when they close; context menus take ↑ ↓ / ⏎ / Esc. Esc in the
session filter or the quick-connect box clears it and returns to the terminal.


## Data and privacy

Everything stays in `~/Library/Application Support/MobAlt/`: `sessions.json` (passwords and
passphrases encrypted through the macOS Keychain), `settings.json`, `known_hosts`,
`workspace.json`, and the zsh integration files. Session logs go to `~/Documents/MobAlt Logs/`.
MobAlt connects only to the hosts you configure; the optional update check reads the release list
on GitHub and nothing else. Details: [SECURITY.md](../SECURITY.md).

## Troubleshooting

- **"Timed out while waiting for handshake" / ETIMEDOUT**: nothing answered on that port. Check
  the address, VPN and router forwarding; try `nc -vz host port` in a local terminal.
- **"authentication failed — server accepts: …; tried: …"**: the server did not accept what MobAlt
  offered. Compare the "accepts" list with your session's authentication method; for key-only
  servers pick the right key file. Repeated failures can get your IP banned by fail2ban or sshd's
  per-source penalties for a while.
- **"no matching key exchange / host key / cipher / MAC: this session offers …; the server offers …"**:
  the two sides have no algorithm in common. The message lists what the server does speak: add one
  of those in Advanced SSH → Algorithms (or *Reset to defaults*); for an old appliance that only
  offers SHA-1 / CBC, tick "Legacy algorithms (old devices)".
- **Host key changed**: the server was reinstalled, or something is intercepting the connection.
  Only accept if you know why; the old key can be removed from `known_hosts` in the config folder.
- **X11 app does not appear**: install XQuartz, and make sure the remote shell does not override
  `DISPLAY` in its startup files.
- **Mosh**: "mosh client not found" means `brew install mosh` is missing locally;
  "mosh-server not found" means it is missing on the host or not on its PATH (set the path in the
  session).
- **Gatekeeper warning on a self-built app**: right-click → Open once, or
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` from `brew upgrade --cask mobalt`**: another Homebrew process
  (for example `brew audit` or `brew fetch`) had the same DMG mounted at that moment. Just run the command
  again.
