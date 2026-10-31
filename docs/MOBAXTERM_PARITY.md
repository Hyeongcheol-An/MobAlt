# MobaXterm 26.6 feature parity

[한국어](MOBAXTERM_PARITY.ko.md)

MobAlt 0.12.0 compared with MobaXterm 26.6 (Mobatek, Windows; released 2026-10-25), feature by
feature. Comparison date: 2026-10-31.

**What was compared.** The MobaXterm side is an inventory built from the official feature page,
the documentation and the complete changelog (v1.0 → v26.6), plus the Home/Professional edition page,
grouped the way MobaXterm's own documentation groups things. The MobAlt side was checked row by row
against the 0.12.0 source (`src/main`, `src/renderer`), the [user guide](USER_GUIDE.md) and the
README; nothing here is taken from memory. "Settings → …" means MobAlt's Settings dialog (⌘,),
"Session editor" means ＋ Session (⌘N), "Sftp panel" is the file browser (⌘2), "Tools panel" is ⌘3.

**How to read the status column.**

| Status | Meaning |
|---|---|
| ✅ | the same user-facing capability; the last column names the panel, menu or shortcut |
| 🟡 | exists but narrower, works differently, or goes through another macOS app (RDP via Windows App, VNC via Screen Sharing, X11 via XQuartz) |
| ❌ | missing and feasible on macOS; these rows feed the [roadmap](#roadmap-what-to-build-next) |
| ➖ | Windows-only or meaningless on macOS (WSL, Cygwin plugins, CMD/PowerShell, CAPI smart cards, Home-edition limits, Customizer licensing…); the last column names what macOS users use instead |

A MobaXterm row that bundles several changelog items gets the status of its main capability; the
last column says which parts are missing.

## Summary

| Category | ✅ | 🟡 | ❌ | ➖ | Rows |
|---|---|---|---|---|---|
| 1. Session types | 7 | 6 | 4 | 4 | 21 |
| 2. SSH specifics | 15 | 10 | 10 | 2 | 37 |
| 3. Terminal | 8 | 13 | 9 | 1 | 31 |
| 4. X server and embedded Unix tools | 2 | 1 | 1 | 17 | 21 |
| 5. Network and admin tools, embedded servers, Moba* utilities | 6 | 2 | 8 | 19 | 35 |
| 6. Workspace features | 7 | 9 | 6 | 3 | 25 |
| 7. Professional-only items and Home Edition limits | 0 | 0 | 0 | 13 | 13 |
| **Sections 1–7 (each feature once)** | **45** | **41** | **38** | **59** | **183** |
| 8. Recent additions (24.3 → 26.6) | 4 | 16 | 7 | 3 | 30 |
| 9. UX details power users rely on | 6 | 11 | 2 | 1 | 20 |
| **All tables** | **55** | **68** | **47** | **63** | **233** |

Sections 8 and 9 follow the inventory's own structure and restate features that sections 1–7
already cover, so the "all tables" line counts some features twice; the 1–7 line is the one to
quote. Read another way: of the 124 features that apply on macOS at all (sections 1–7 minus ➖),
MobAlt has 45 in full, 41 in a narrower or different form and lacks 38.

## 1. Session types

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| SSH session | ✅ | SSH type in the Session editor: ssh2 terminal, Sftp panel opens on connect, X11, jump host, tunnels, startup commands |
| Telnet session | 🟡 | Telnet type with NAWS/TTYPE negotiation; host and port only, no keepalive, auto-login or "send ^M" options |
| Rsh / Rlogin session | ➖ | obsolete clear-text protocols that macOS no longer ships clients for; use SSH (or Telnet for legacy gear) |
| Xdmcp session | ❌ | no XDMCP session type; XQuartz can be started by hand with `X :1 -query host` |
| RDP session | 🟡 | RDP type writes a `.rdp` file (host, port, user, full screen) and opens Windows App; `rdp://` works in Quick connect |
| RDP — new 64-bit engine | ➖ | MobaXterm-internal engine; on macOS Windows App is the RDP engine |
| RDP — advanced (Restricted Admin, multi-monitor, drives…) | 🟡 | all of that is configured inside Windows App; MobAlt only hands over host, port and user |
| VNC session | 🟡 | VNC type opens a `vnc://` URL in macOS Screen Sharing; `vnc://` works in Quick connect; no in-app viewer |
| FTP session | ✅ | FTP type: explicit-TLS FTPS, anonymous login, self-signed certificate opt-in; browsed, transferred and edited in the Sftp panel (no ASCII mode) |
| SFTP session | 🟡 | no SFTP-only session: the Sftp panel comes with every SSH session (and with Mosh through a companion SSH connection) |
| Serial (COM) session | ✅ | Serial type: USB-serial discovery, baud, data/stop bits, parity, flow control, local echo, Enter sends CR/LF/CRLF; no named pipes |
| File session (local folder tab) | ❌ | no local file-browser tab; Finder or `open .` from a Local terminal |
| Shell session (local terminal) | ✅ | Local type: your login shell (or any path, Settings → General → Local shell), Start folder, startup commands; ⌘T for a quick one |
| Browser session | ❌ | no embedded browser tab |
| Mosh session | ✅ | Mosh type: key/agent/prompt bootstrap over SSH, `mosh-server` path, prediction mode; needs `brew install mosh` |
| Aws S3 session | ❌ | no S3 browser |
| WSL session | ➖ | Windows-only; a Local session already is a Unix shell |
| Live session (unsaved) | ✅ | Quick connect field (⇧⌘N): `user@host[:port]` with `ssh:// mosh:// telnet:// ftp:// ftps:// rdp:// vnc://` prefixes opens an unsaved session; shell commands and `-exec` are in §6 |
| Custom shell script bookmark | 🟡 | a Local session whose Startup commands hold the script; no desktop shortcut |
| "Open SFTP session with same parameters" | ✅ | pane menu → Open SFTP Browser / Sftp panel's "Open SFTP for this host (via SSH)" for Mosh; SSH sessions have the panel already |
| Session count limit (Home: 12) | ➖ | no limits; MIT licence |

## 2. SSH specifics

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| SSH engines (MoTTY + embedded OpenSSH CLI) | ✅ | ssh2 for sessions; macOS's own `ssh`/`scp`/`sftp`/`rsync`/`git` in any Local terminal; "Legacy algorithms" replaces `ssh -legacy` |
| Password auth + saved passwords | ✅ | Session editor → Authentication; the password prompt offers "Save in session (Keychain-encrypted)" |
| Keyboard-interactive / 2FA | ✅ | keyboard-interactive prompts shown in a dialog (multi-prompt PAM too); a lone hidden prompt is answered with the saved password once |
| Public-key auth | 🟡 | OpenSSH keys incl. Ed25519, passphrase prompt with optional save, default `~/.ssh` keys tried; `.ppk` must be converted with `puttygen` |
| SSH certificates (user cert, host CA) | ❌ | not supported; `@cert-authority` lines in known_hosts are skipped |
| Smart card (CAPI) auth | ➖ | CAPI is Windows; on macOS load the PKCS#11 module into `ssh-agent` (`ssh-add -s`) and pick "SSH agent" |
| GSSAPI / Kerberos | ❌ | ssh2 has no GSSAPI; use the system `ssh -K` in a Local terminal |
| Internal SSH agent "MobAgent" | 🟡 | no built-in agent: the macOS `ssh-agent` (`SSH_AUTH_SOCK`) is used; keys via `ssh-add --apple-use-keychain` |
| External agents | ✅ | whatever `SSH_AUTH_SOCK` points at: ssh-agent, 1Password, Secretive, gpg-agent… |
| Agent forwarding | ✅ | "Agent forwarding" in Advanced SSH |
| SSH gateway / jump host (chained, per-hop credentials) | 🟡 | Advanced SSH → Jump host: a saved session or `user@host:port`, chains through the jump session's own jump host (3 hops), Sftp and X11 routed through; SSH only, no CyberArk/Teleport |
| Proxy (SOCKS / HTTP / netcat) | ❌ | no per-session proxy; use a jump host or a `-D` tunnel from another session |
| Keepalive | ✅ | Settings → General → SSH keep-alive (s), per-session override in Advanced SSH; on by default (30 s) |
| "Workaround for connection reset by peer" | 🟡 | no such checkbox; Advanced SSH → "Legacy algorithms (old devices)" is the knob for old servers |
| Compression | ✅ | "Compression" in Advanced SSH (off by default; imported from `MobaXterm.ini` and `~/.ssh/config`) |
| X11-Forwarding | ✅ | "X11 forwarding (XQuartz)" in Advanced SSH: DISPLAY set remotely, cookie swapped, works through the jump host; off by default |
| Remote environment (full desktop in a windowed X server) | 🟡 | forwarded X11 carries any client; a whole desktop needs XQuartz's own full-screen mode |
| Execute command / stay connected | ✅ | Startup commands (Session editor → Terminal): typed after login, the shell stays open |
| Startup macro | 🟡 | Startup commands per session for every type, instead of attaching a recorded macro |
| Remote monitoring bar (CPU/RAM/net/disk) | ❌ | not implemented |
| Graphical SSH-browser (SFTP/SCP) | ✅ | Sftp panel (⌘2) opens on connect: upload/download with progress and cancel, mkdir, rename, chmod, delete, hidden files, double-click edits and saves back; SFTP only, no SCP mode |
| SSH-browser extras (SUDO, history, paste, diff…) | 🟡 | has overwrite confirmation, preserved mtime on download, sort, Show in Finder, host-key prompt; no SUDO, address history, ⌘V file paste, SCP fallback, diff or column memory |
| Follow terminal folder | ✅ | "SFTP follows terminal folder" session option (OSC 7 hook for bash/zsh) plus the panel's Follow checkbox; off by default |
| Zmodem (rz/sz) | ❌ | not implemented |
| Adapt locales | ❌ | no locale push to the remote shell |
| Expert SSH settings (ciphers, KEX, MAC, post-quantum) | 🟡 | one "Legacy algorithms" toggle appends SHA-1 KEX / CBC ciphers; no per-algorithm picker; ssh2 1.17 has strict KEX (Terrapin) but no ML-KEM |
| Terminal type per session | ❌ | fixed `xterm-256color` |
| SSH tunnels (MobaSSHTunnel) | 🟡 | Tunneling dialog (⇧⌘U): -L, -R and -D SOCKS5, over an open connection or a dedicated one to a saved session, per-session Tunnels tab auto-starts; no auto-reconnect, reorder or duplicate; no limit |
| Credentials manager (shared credentials) | ❌ | passwords are per session |
| Master password | 🟡 | no master password: secrets are encrypted with Electron `safeStorage` (macOS Keychain, unlocked by your login); JSON export never contains them |
| Windows Hello | ➖ | Windows-only; the login Keychain protects MobAlt's secrets |
| MobaKeyGen | ❌ | no key generator UI; `ssh-keygen` in a Local terminal |
| Known hosts | ✅ | `~/.ssh/known_hosts` plus the app's own list; first-connection fingerprint (SHA256 and MD5); a changed key is flagged and never accepted silently |
| Session logging | ✅ | "Log session output to file" per session or Terminal → Start/Stop Session Log; raw or plain text (Settings → Logging); start/stop stamps, no per-line timestamps |
| IPv6 | ✅ | IPv6 addresses in the host field and `[addr]:port` in Quick connect |
| Title lock / reconnect prompt | ✅ | Rename Tab (double-click) locks the title; a closed session prints "Press Enter to reconnect, ⌘W to close" with a Reconnect/Close overlay |
| Session presets | ❌ | no default presets; Duplicate copies one session |

## 3. Terminal

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| Tabbed terminal | ✅ | tabs: drag to reorder, double-click rename, middle-click close, ⌃Tab / ⌃⇧Tab, ⌃⌘1-9, tab list menu; no hard limit |
| Split modes (1 / 2 / 4) | ✅ | Split ▾: right (⌘D), down (⇧⌘D), grids 1×2 … 2×4 = 8 panes (⌥⌘2/4/6/8), unsplit ⌥⌘1, drop sessions on pane edges |
| MultiExec | 🟡 | ⇧⌘M broadcasts to every visible pane of the active tab; no per-pane Exclude or synchronised scrolling |
| Detach / reattach / fullscreen / stay on top | ❌ | macOS full screen through the window's green button only; no detach to a window, no always-on-top |
| Macros (keyboard) | 🟡 | Macros panel (⌘4): ● Rec records keystrokes, text macros with `\n` / `\x1b[A` escapes, play into the active or all terminals; no wait-for, folders, nesting or in-terminal picker |
| Graphical macros (mouse + keyboard) | ❌ | not implemented |
| Colour schemes | 🟡 | 6 built-in themes (Settings → Terminal → Theme) and a per-session override; no custom or imported themes |
| Fonts (bundled fonts, ligatures, fixed size) | 🟡 | any installed font, size and line height (Settings → Terminal), ⌘= / ⌘- / ⌘0, per-session font size; no ligatures, no fixed rows/cols |
| Syntax highlighting of keywords | ❌ | not implemented (URLs are underlined) |
| Search in terminal | ✅ | ⌘F incremental search with case and regex toggles and a match counter |
| Logging / save / print | 🟡 | session log to a folder; no "Save terminal text" or print (Select All + copy instead) |
| Scrollback | ✅ | Settings → Terminal → Scrollback lines (100 – 1,000,000; default 10,000); ⌘K clears |
| Paste behaviour (right-click, multi-line preview, delay) | 🟡 | Settings → Terminal → "Right-click pastes (⇧-right-click for menu)", ⌘V; bracketed paste honoured; a multi-line or long paste asks first with an editable preview (Settings → Terminal → Paste guard); no per-line delay |
| Malicious-paste guard | ✅ | every paste is checked for zero-width / bidi / control characters, a trailing newline, a lone CR, `curl \| sh`, writes to shell profiles and `authorized_keys`, `rm -rf /`-style commands and look-alike letters; findings are listed and marked in the preview, "Paste cleaned" strips the hidden characters (Settings → Terminal → "Warn about suspicious pastes") |
| Copy on select | ✅ | Settings → Terminal → Copy on select (on by default) |
| Selection modes (word, rectangular) | ✅ | double-click word, triple-click line, ⌥-drag rectangular (xterm.js column selection); word delimiters not configurable |
| Ctrl+click URLs / paths | 🟡 | URLs are underlined and open in the browser on click; file and folder paths are not linked |
| Unicode / charset / IME | 🟡 | UTF-8 only, Unicode 11 width tables, in-terminal IME composition (xterm.js); no other charsets |
| Expert terminal settings | 🟡 | cursor style/blink, scrollback, Option-as-Meta, copy-on-select, right-click paste; no alt-screen, local echo, answerback or CR/LF knobs (Serial has local echo and Enter-sends) |
| Terminal types (xterm, linux, OpenVMS2) | ❌ | `xterm-256color` only |
| Tab colours / icons / pin / close left-right | 🟡 | per-session colour and emoji icon on row, tab and pane head; Close Others, middle-click close, Duplicate; no pin, close-left/right or close-inactive |
| Activity tracking (blue dot, red title) | 🟡 | status dot on the tab (connecting / connected / disconnected) and a green dot in the tree; no output-activity marker |
| Bell (sound / flash) | ❌ | no bell sound or flash |
| Backspace ^H / ^? | ❌ | not configurable (xterm.js sends ^?) |
| Separation line between commands | ❌ | not implemented |
| Popup console (Guake-style) | ❌ | not implemented |
| Hide to tray (Ctrl+M) | ➖ | macOS ⌘H hides the app; the Dock / ⌘Tab bring it back |
| Cursor (hollow when unfocused) | ✅ | Settings → Terminal → Cursor (block / underline / bar) and blink; xterm.js outlines the block cursor when unfocused |
| Keyboard shortcuts (configurable) | 🟡 | a fixed macOS-style set (Help → Keyboard Shortcuts); not remappable |
| "Live terminal" settings | ❌ | Quick connect sessions use the defaults; no separate settings |
| Terminal lock on exit (confirm while a command runs) | 🟡 | closing a tab/pane with a live connection asks (Settings → General); not based on a running command |

## 4. X server and embedded Unix tools

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| Embedded X server ("MobaX") | 🟡 | XQuartz, started on demand when an X11 session connects; MIT-MAGIC-COOKIE swapped; status bar shows X11 availability |
| X extensions (OpenGL/GLX, Composite, Randr) | ➖ | provided and configured by XQuartz |
| Display modes (multiwindow, Fvwm2/TWM/Openbox, DWM tab) | ➖ | XQuartz rootless or full-screen mode (XQuartz preferences); no bundled window managers |
| Multi-monitor | ➖ | handled by XQuartz |
| XDMCP | ❌ | no XDMCP session (see §1) |
| X11 remote access control | ➖ | XQuartz → "Allow connections from network clients", `xhost` |
| Clipboard X11 ↔ host | ➖ | XQuartz pasteboard syncing preference |
| Keyboard (xmodmap, Unix-compatible keyboard) | ➖ | XQuartz input preferences; `xmodmap` in a Local terminal |
| DirectDraw rendering | ➖ | Windows rendering option |
| X11 fonts | ➖ | XQuartz ships its fonts; more via Homebrew |
| Alternate X servers plugin (Xephyr, Xvfb…) | ➖ | Homebrew if ever needed |
| X server only (`-noX`, `-hideterm`) | ➖ | XQuartz is a separate app and runs alone |
| Local Unix terminal (CygUtils) | ✅ | a Local session is a real Unix login shell; macOS ships the BSD userland, ssh, rsync, vim…; Homebrew adds the rest |
| 64-bit terminal (CygUtils64) | ➖ | native arm64 / x64 shell |
| MobApt / apt-get package manager | ➖ | Homebrew |
| Plugins (.mxt3) | ➖ | Homebrew |
| Windows integration from shell (`open`, `/drives`, `/registry`) | ➖ | macOS has `open`, Finder and `/Volumes` natively |
| Helper commands (MobaHwInfo, MobaTaskList, mkshortcut…) | ➖ | `system_profiler`, `ps`, `top`, `mdfind`, `man` |
| Shell choice (Bash, Zsh, CMD, PowerShell, WSL…) | ✅ | Settings → General → Local shell (any path; default: your login shell with `-l`), per-session Shell field |
| Persistent home and root | ➖ | your real home directory |
| Profile scripts (unified .profile) | ➖ | the shell's own dotfiles apply; MobAlt's zsh integration sources them and only adds the folder hook |

## 5. Network and admin tools, embedded servers, Moba* utilities

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| Network scanner (subnet) | ✅ | Tools panel (⌘3) → Network scanner: a CIDR, an address range or one host (up to a /16); ping and/or TCP connect to a port list, reverse DNS, live sortable table, Stop, "Add as session", Copy as text |
| Ports scanner | ✅ | Tools panel (⌘3) → Port scan: port range, concurrent TCP connect |
| Packet capture (TCPCapture) | ❌ | `sudo tcpdump` in a Local terminal or Wireshark |
| List open network ports (MobaListPorts) | ❌ | `lsof -iTCP -sTCP:LISTEN` in a Local terminal |
| Wake-on-LAN | ✅ | Tools panel → Wake-on-LAN: magic packet by UDP broadcast (address and port adjustable), the last 10 MACs remembered with a label |
| Ping | ✅ | Tools panel → Ping (streamed, Stop button) |
| Traceroute | ✅ | Tools panel → Traceroute (a GUI; MobaXterm only has the CLI) |
| iperf / httping | ➖ | `brew install iperf3 httping`, run in a Local session |
| DNS tools (dig, host, nslookup, whois) | ✅ | Tools panel → DNS lookup (A/AAAA, MX, TXT, reverse PTR); `dig`, `host`, `nslookup`, `whois`, `nc` ship with macOS |
| Netstat | ➖ | macOS `netstat`, `lsof` |
| Embedded TFTP server | ❌ | not implemented |
| Embedded FTP server | ❌ | not implemented |
| Embedded HTTP server | ❌ | not implemented (`python3 -m http.server` meanwhile) |
| Embedded SSH/SFTP server | ➖ | macOS Remote Login (System Settings → General → Sharing) |
| Embedded Telnet server | ➖ | obsolete; Remote Login (sshd) |
| Embedded NFS server | ➖ | macOS `nfsd` (`/etc/exports`) |
| Embedded VNC server | ➖ | macOS Screen Sharing (System Settings → Sharing) |
| Embedded Cron service | ➖ | `cron` and `launchd` are built in |
| Embedded Iperf server | ➖ | `iperf3 -s` from Homebrew |
| Services manager | ➖ | System Settings → Sharing |
| Folder sharing | ➖ | File Sharing (SMB) in System Settings |
| MobaSSHTunnel | 🟡 | Tunneling dialog (⇧⌘U); see §2 |
| MobaTextEditor | 🟡 | built-in plain-text editor for remote files (⌘S saves back) or your external editor with auto-upload; no syntax highlighting or search |
| MobaDiff / MobaTextDiff | ❌ | FileMerge (`opendiff`), `diff`, your editor |
| MobaFoldersDiff | ❌ | `diff -r`, FileMerge |
| MobaKeyGen | ❌ | `ssh-keygen` in a Local terminal (see §2) |
| MobaPictureViewer | ➖ | Quick Look / Preview after "Show in Finder" |
| MobaMonitor | ➖ | the inventory found no MobaXterm tool by this name; the nearest feature is the remote monitoring bar (§2, ❌) |
| List hardware / processes | ➖ | System Information, Activity Monitor, `ps` |
| Admin shells (CMD / PowerShell as admin) | ➖ | `sudo` in a Local session |
| Office extras (ASCII table, calculator, fdupes) | ➖ | Calculator.app, `man ascii`, `brew install fdupes` |
| Games | ➖ | none |
| Penguins screensaver | ➖ | none |
| Smart-card manager | ➖ | CAPI is Windows; PKCS#11 through `ssh-agent` on macOS |
| Windows Explorer integration (context entries, URL handler) | ➖ | Finder has no such hook; MobAlt registers no URL scheme either |

## 6. Workspace features

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| Sessions sidebar (tree, right-click, drag-drop, collapse all) | ✅ | Sessions panel (⌘1): nested folders, filter, drag & drop, context menu, Expand/Collapse All, full keyboard tree; left side only (⌘B hides it) |
| Session folders & launch groups | ✅ | nested folders; folder menu → Open All in Grid / Open All in Tabs; no desktop shortcuts |
| Open-session indicators (green dots, click to jump) | 🟡 | green dot on connected sessions in the tree; double-click opens another instance instead of jumping to the tab |
| Quick connect / search | ✅ | Quick connect field (`user@host[:port]`, scheme prefixes, reuses a matching saved session); session filter (Enter opens the first match); type-ahead in the tree; no comment search |
| Home tab (recent sessions, recover previous instance) | 🟡 | no start page; workspace restore brings the last tabs back automatically, ⌘T opens a local terminal |
| Auto-save of sessions | 🟡 | deliberate: Quick connect sessions stay unsaved (a matching saved session is reused); create sessions with ⌘N |
| Duplicate / clone | ✅ | Duplicate Session (⇧⌘T) and Duplicate in the tree menu; startup commands are part of the session |
| Session export / import (.mxtsessions per folder) | ✅ | Session → Export / Import Sessions (JSON) for the whole tree, merges by id, never contains secrets; `.mxtsessions` files are read by the MobaXterm importer |
| Third-party import (PuTTY, SuperPuTTY, mRemoteNG, SecureCRT, RDM, CSV) | 🟡 | `MobaXterm.ini` / `.mxtsessions` and `~/.ssh/config` (hosts, users, ports, keys, ProxyJump); none of the others |
| Shared sessions (team, http/ftp/sftp backends) | ❌ | not implemented; a JSON export can be shared by hand |
| Import / Export configuration (.mobaconf) | 🟡 | sessions as JSON; `settings.json` and macros copied by hand from Settings → "Open config folder"; no encrypted bundle |
| Portable mode (exe + INI) | ➖ | macOS apps keep their data in `~/Library/Application Support/MobAlt` (`MOBALT_USER_DATA` relocates it, meant for tests) |
| INI customisation (`[Misc]` keys) | 🟡 | `settings.json` is editable but only holds what the Settings dialog shows |
| Command-line parameters | ❌ | none |
| Scripting from shell (`livesession`, `createsession`) | ❌ | none |
| Themes / skins (dark theme, icon themes) | ✅ | 6 whole-window themes incl. Light (native controls follow); emoji session icons; no icon themes |
| Compact mode | 🟡 | ⌘B hides the sidebar, macOS full screen; no single compact toggle |
| Toolbar customisation | ❌ | fixed toolbar |
| Keyboard shortcuts editor | ❌ | not remappable |
| HiDPI / scaling | ➖ | Retina is handled by macOS; ⌘= / ⌘- zoom the terminal font |
| Multi-instances | 🟡 | `open -n -a MobAlt` starts a second instance, but both write the same config folder |
| "Do not exit when last tab closed" | ✅ | the window stays open with an empty tab strip; nothing to switch |
| Manual update check only | 🟡 | a startup check is on by default (Settings → Updates turns it off), Help → Check for Updates… runs it by hand; only the GitHub release manifest is read |
| Pro profile script / banner | ➖ | Customizer feature |
| Session presets | ❌ | see §2 |

## 7. Professional-only items and Home Edition limits

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| Session limit (Home: 12) | ➖ | no limit |
| SSH tunnel limit (Home: 2) | ➖ | no limit |
| Macro limit (Home: 4) | ➖ | no limit |
| Daemon run-time limit (Home: 360 s) | ➖ | no daemons, no limit |
| Home licence terms (no company deployment) | ➖ | MIT: use and deploy anywhere |
| Pro licence terms (per user, 1-year updates) | ➖ | MIT |
| Pricing | ➖ | free |
| Customizer program (branded builds) | ➖ | fork and `npm run dist` |
| Security lockdown (Customizer "Security" tab) | ➖ | no admin lockdown profile |
| Remove games / screensaver / tools | ➖ | nothing to remove |
| Deployment inside company | ➖ | MIT; Homebrew cask `mobalt` |
| Support | ➖ | GitHub issues |
| Edition switch warning | ➖ | one edition |

## 8. Recent additions (24.3 → 26.6)

| MobaXterm feature | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| 26.6 — 64-bit RDP engine | ➖ | Windows App |
| 26.6 — in-terminal IME composition | ✅ | xterm.js composes IME input at the cursor |
| 26.6 — multi-line PAM prompts, URL detection in prompts | 🟡 | multi-prompt keyboard-interactive dialog; URLs inside prompts are not linked |
| 26.6 — follow path while browser hidden; `_Username_` in root path | 🟡 | folder following runs on the OSC 7 hook whichever panel is shown; no path variables |
| 26.5 — VNC overhaul (encodings, auth, auto-resize) | 🟡 | macOS Screen Sharing |
| 26.5 — WebAuthn redirection in RDP | ➖ | Windows App |
| 26.5 — SFTP drag into a local subfolder; CygUtils integrity; Customizer options | 🟡 | downloads go to a chosen folder (Download folder setting or dialog); no drag-out to Finder |
| 26.4 — smart-card SSH auth (CAPI) + manager, smart card in MobAgent | ➖ | PKCS#11 via the macOS `ssh-agent` |
| 26.4 — SSH → SFTP with same parameters, browser beside the tree, column widths, overwrite confirmation | 🟡 | Sftp panel is attached to each session and asks before overwriting; no side-by-side docking or column memory |
| 26.4 — "linux" terminal type, compression off by default, Quick connect folder auto-expand | 🟡 | compression off by default; terminal type fixed; the filter shows matches |
| 26.3 — paste confirmation polish | ✅ | a multi-line or long paste asks first: "Paste N lines into …?" with an editable preview, ⌘⏎ / Esc |
| 26.2 — malicious-paste warning | ✅ | paste guard findings (hidden characters, pipe-to-shell, profile writes, destructive commands, homoglyphs) with "Paste cleaned" |
| 26.2 — duplicate tunnel, Alt+Space macro menu, collapse all folders, Wine compatibility | 🟡 | Collapse All in the tree menu; no duplicate tunnel or in-terminal macro menu |
| 26.1 — open-session dots in the tree (click to jump) | 🟡 | green dot, no jump |
| 26.1 — per-session icons in Customizer, >64 icons, MobaTextDiff swap, SK-SSH-Agent without MobAgent | 🟡 | any emoji as a session icon; FIDO keys through the macOS agent; no diff tool |
| 26.0 — `livesession` / `createsession`, `-exec` automation | ❌ | no scripting interface |
| 26.0 — import from Remote Desktop Manager and CSV | ❌ | not implemented |
| 26.0 — MAC-vendor lookup, DirectDraw, tunnel reorder, bracketed paste default, apt X fonts | 🟡 | bracketed paste honoured by xterm.js; the rest missing or Windows-only |
| 25.4 — Windows SSH agent, other PuTTY agents, Windows Hello | ✅ | any agent behind `SSH_AUTH_SOCK`; Hello is Windows-only |
| 25.4 — macro include, ms log timestamps, "chokes on full KEXINIT", Cisco KEX autodetect, floating popup console | ❌ | none of these ("Legacy algorithms" is the only old-device knob) |
| 25.3 — MobaTextEditor / MobaDiff overhaul | 🟡 | plain built-in editor or external editor only |
| 25.2 — ML-KEM post-quantum KEX, PuTTY engine update | ❌ | ssh2 1.17 has no ML-KEM |
| 25.2 — RDP redirection options, tunnel reconnect, 64 icons, follow-path and monitoring on by default, export password | 🟡 | icons ✅; RDP options live in Windows App; no tunnel reconnect; following is opt-in |
| 25.1 — SSH proxy via netcat/socat, user certificate + host CA, PuTTY import of proxy/certs/Teleport, CyberArk | ❌ | none |
| 25.0 — PuTTY engine + Unicode 16, dark-mode dialogs, CVE-2025-0714 | 🟡 | Unicode 11 width tables; dialogs follow the chosen theme (dark or light) |
| 24.4 — SFTP multi-block transfers, close tabs left/right, rename-tab shortcut, Pro X11 lockdown, PNG logos | 🟡 | concurrent SFTP reads/writes; Rename Tab (double-click / menu); Close Others only |
| 24.3 — graphical macros, macro folders, encrypted macros, VNC IPv6, 64-bit default, close inactive tabs | ❌ | none (macros are stored in `settings.json`) |
| 24.2 — Expert RDP settings, fullscreen across monitors, MultiExec sync-scroll, `X11MCAuth` | ❌ | RDP is Windows App's; no synchronised scrolling |
| 24.0 — Expert terminal settings, host-key prompt in the SFTP browser | 🟡 | a subset of terminal settings; the host key is checked for every connection |
| 23.x — Edge browser engine, editable shared sessions, NTRU Prime + AES-GCM, Telnet keepalive, tab pinning, Terrapin fixes | 🟡 | strict KEX (Terrapin) through ssh2; AES-GCM in ssh2's defaults; no browser, shared sessions, telnet keepalive or pinning |

## 9. UX details power users rely on

| MobaXterm behaviour | MobAlt | How MobAlt does it, or why not |
|---|---|---|
| SFTP pane that follows `cd`, edit-and-upload on save | ✅ | "SFTP follows terminal folder" session option + Follow checkbox; double-click edits, ⌘S uploads; following is off by default |
| Remote monitoring bar | ❌ | not implemented |
| Sidebar = session tree + macros + file browser, dockable, right placement | 🟡 | side strip with Sessions / Sftp / Tools / Macros (⌘1-4), one panel at a time, left side only, ⌘B hides |
| Everything auto-saves (incl. Quick connect sessions) | 🟡 | sessions and settings save on Save, the workspace every 20 s; Quick connect sessions are not saved |
| Right-click paste as a global toggle | ✅ | Settings → Terminal → "Right-click pastes (⇧-right-click for menu)", on by default |
| Copy-on-select, Alt-drag rectangle, tunable delimiters | ✅ | Copy on select (toggle), ⌥-drag column selection; delimiters not tunable |
| Multi-line paste guard with preview and malware checks | ✅ | "Paste N lines into …?" with an editable preview and the suspicious-content findings; both toggles in Settings → Terminal → Paste guard |
| MultiExec and split views (Exclude, sync scroll) | 🟡 | splits and grids up to 8 panes; MultiExec without Exclude or synchronised scrolling |
| Macros as first-class objects (WaitFor, nesting, folders, encryption) | 🟡 | recorded and text macros, play to one or all terminals; none of the extras |
| Jump hosts as a dropdown | ✅ | Advanced SSH → Jump host dropdown of saved sessions (or manual), chained through the jump session's own jump host; Sftp and X11 routed through; SSH sessions only |
| Credentials vs passwords (named credentials, master password, Hello) | 🟡 | per-session passwords in the Keychain; no named credentials |
| Tabs carry state (colour, icon, dots, pin, close-left/right, detach) | 🟡 | colour, icon, status dot, green tree dot; no pin, close-left/right, detach or activity marker |
| Home tab + Quick connect (raw `ssh user@host`) | 🟡 | Quick connect with raw `user@host` and scheme prefixes; no home tab, restore is automatic |
| Guake-style popup console, hide to tray | ❌ | no popup console; ⌘H hides the app |
| Local terminal is a real Unix shell | ✅ | natively, with your own dotfiles |
| X11 "just works" (auto-start, DISPLAY, WMs, XDMCP) | 🟡 | XQuartz started on demand and the cookie swapped; forwarding is a per-session option; no window managers or XDMCP |
| Games and penguins | ➖ | none |
| Tools menu as a Swiss-army drawer | 🟡 | Tools panel (ping, traceroute, DNS, port scan, network info, Wake-on-LAN, network scanner) and Tunneling; the rest through macOS or Homebrew |
| Expert settings everywhere (terminal, SSH, RDP) | 🟡 | "Legacy algorithms" and a few terminal knobs; no expert SSH / RDP dialogs |
| No telemetry, no auto-update, no admin rights | 🟡 | no telemetry; the startup update check is optional and only installs with consent; no admin rights (drag to Applications or Homebrew) |

## What MobAlt has that MobaXterm does not

Each item is verified against the 0.12.0 source.

- **Whole-window themes with contrast guarantees.** The chrome palette is derived from the terminal theme (`src/renderer/theme.js`); every text token keeps ≥ 4.5:1 and borders ≥ 3:1 on every surface, asserted by `test/unit/theme.test.js` for all six themes including Light. MobaXterm themes the terminal and offers one dark skin.
- **Keyboard accessibility.** Session tree and SFTP list are a tree / listbox with a roving tabindex and Finder-style type-ahead, context menus open with ⇧F10 or the Menu key, dialogs trap and return focus (`src/renderer/sidebar.js`, `src/renderer/sftp.js`, `test/e2e-a11y.js`).
- **Mosh with an SFTP companion.** A Mosh pane gets a shell-less SSH connection to the same host for the Sftp panel (`src/main/ssh.js`, `sftpOnly`).
- **FTPS** (explicit TLS) and anonymous FTP in the same file panel as SFTP (`src/main/ftp.js`); MobaXterm's FTP client is a separate tab type.
- **Plain-text session logs.** Settings → Logging strips colours, cursor movement and the folder hook from logs (`PlainTextFilter` in `src/main/terminals.js`).
- **On-disk update detection and relaunch banner.** `brew upgrade` or a DMG replacing the running bundle is noticed and offered as a relaunch that restores the workspace (`src/main/bundlewatch.js`).
- **Homebrew install and signed, notarized, consent-based auto-updates** (`Casks/mobalt.rb`, `.github/workflows/release.yml`, `src/main/updater.js`).
- **JSON export that never contains secrets** (`password`, `passphrase`, `jumpPassword` are stripped in `src/renderer/app.js`; import merges by id).
- **`MobaXterm.ini` / `.mxtsessions` and `~/.ssh/config` import** with ProxyJump, IdentityFile, ForwardX11, ForwardAgent and Compression (`src/main/importers.js`).
- **Startup commands for every session type** — SSH, Mosh, Local, Telnet, Serial (`src/renderer/terminal.js` `_sendStartup`, `src/main/ssh.js`).
- **Pane zoom** (⇧⌘⏎) remembered per tab and across restarts (`src/renderer/layout.js`).
- **Workspace restore with automatic SSH reconnect**, local shells back in their folder (`restoreWorkspace` in `src/renderer/app.js`).
- **Serial device discovery** in the Session editor (`SerialPort.list()` in `src/main/terminals.js`).
- **Native macOS Keychain storage** for passwords and passphrases through Electron `safeStorage`, no master password to type (`src/main/store.js`).
- **Grids up to 2 × 4 and drag-to-split**: sessions dropped on a pane edge split in that direction, tabs can be dragged into panes (`src/renderer/layout.js`); MobaXterm stops at 4 fixed terminals.
- **Traceroute and DNS lookup with a GUI** in the Tools panel (`src/main/tools.js`); MobaXterm only has the CLI tools.
- **Shift+Enter / Option+Enter send ESC+CR**, the newline TUI apps such as Claude Code expect (`src/renderer/terminal.js`).
- **Quit and close confirmations that count live connections** (SSH, Mosh, SFTP, FTP) instead of a blanket prompt (`src/main/live.js`).
- **Folder-following local terminals** titled after their current directory through an OSC 7 hook (`src/main/zdotdir.js`).

## Roadmap: what to build next

Priorities take the ❌ rows above; size is a rough estimate (S = days, M = a week or two, L = more).

**P1 — high value, feasible**

| Item | Why | Size |
|---|---|---|
| Zmodem (rz/sz) transfers in the terminal | the classic way to move files through serial consoles and jump hosts where SFTP is unavailable | M |
| Remote monitoring bar (CPU / RAM / disk / net) via a polling exec channel on the SSH connection | on by default in MobaXterm since 25.2; ssh2 already has the connection | M |
| Keyword syntax highlighting in the terminal | readable logs on colour-less servers; xterm.js decorations API | M |
| Tab pin, close left/right, detach-to-window | tab colour already exists; detach needs a second BrowserWindow sharing the terminal registry | M |
| SSH key generator UI (`ssh-keygen` wrapper) | the most common "first SSH" task; also closes the MobaKeyGen gap | S |
| Expert SSH algorithm / KEX / cipher / MAC settings | one legacy toggle is too coarse; ssh2's `algorithms` option takes explicit lists (ML-KEM waits on ssh2) | S |

**P2**

| Item | Why | Size |
|---|---|---|
| Embedded browser session (Electron webview) | web consoles next to the shell that manages them | M |
| Shared credentials manager (one credential used by many sessions, incl. jump hosts) | password rotation across fleets | M |
| PuTTY / SecureCRT / mRemoteNG / Remote Desktop Manager / CSV session import | migration from other Windows tools, not only MobaXterm | M |
| Font ligatures (`@xterm/addon-ligatures`) | Fira Code and friends | S |
| Popup console (global hotkey drop-down terminal) | Guake-style quick shell | M |
| Shared / team session files (read-only tree from a shared folder or URL) | teams keep one bookmark set | M |
| Open-session dot in the tree jumps to the tab | the dot exists; the click does not | S |
| SCP mode for the file panel (servers without the SFTP subsystem) | legacy appliances | M |

**P3**

| Item | Why | Size |
|---|---|---|
| AWS S3 browser | niche but real; could reuse the file panel API | L |
| VNC viewer in-app (noVNC bridge) | Screen Sharing works; in-app only matters for tunnelled VNC | L |
| Simple embedded servers (HTTP / TFTP / FTP for file hand-off to devices) | network-gear workflows | M |
| RDP in-app | keep Windows App for now | L |

**Backlog (❌ rows not scheduled)**: XDMCP session, local file-browser tab, SSH user certificates / host
CA, GSSAPI, per-session SOCKS/HTTP proxy, adapt locales, terminal type per session, session presets,
graphical macros, Save terminal text / print, bell, backspace mode, separation line, "live terminal"
settings, packet capture, open-ports list, MobaDiff / MobaFoldersDiff, command-line parameters,
shell scripting commands, toolbar customisation, keyboard-shortcut editor, config bundle export.
Smaller gaps inside 🟡 rows: MultiExec Exclude and synchronised scrolling, tunnel auto-reconnect /
duplicate / reorder, telnet keepalive and auto-login, custom colour themes, activity marker on
tabs, side-by-side docking of the file panel, right-hand sidebar.

## Out of scope on macOS

Every ➖ row, with what a Mac user uses instead:

| MobaXterm item | macOS equivalent |
|---|---|
| Rsh / Rlogin, embedded Telnet server | SSH (macOS Remote Login); MobAlt's Telnet type for legacy gear |
| RDP engine, Expert RDP settings, WebAuthn redirection | Windows App (Microsoft) |
| WSL session, 64-bit Cygwin terminal, CygUtils, MobApt, `.mxt3` plugins, persistent home/root, profile scripts | the macOS shell itself plus Homebrew |
| CMD / PowerShell shells, "start as admin" | `sudo` in a Local session |
| Windows Hello, CAPI smart cards, smart-card manager | login Keychain; PKCS#11 through `ssh-agent` |
| X extensions, display modes, multi-monitor, access control, clipboard, keyboard, DirectDraw, fonts, alternate X servers, X-server-only mode | XQuartz and its preferences |
| Windows integration (`/drives`, `/registry`, `open`), helper commands, hardware / process lists | Finder, `/Volumes`, `open`, `system_profiler`, Activity Monitor |
| iperf / httping, netstat, picture viewer, office extras | Homebrew, `netstat` / `lsof`, Quick Look, Calculator |
| Embedded SSH, NFS, VNC, Cron, Iperf servers, services manager, folder sharing | System Settings → Sharing, `nfsd`, `launchd`, `iperf3 -s` |
| Hide to tray | ⌘H |
| Portable mode, HiDPI switches | `~/Library/Application Support/MobAlt`; Retina handled by macOS |
| Windows Explorer integration, Games, penguins screensaver, MobaMonitor (no such tool) | none needed |
| Home-edition limits, licences, pricing, Customizer, security lockdown, deployment terms, support, edition switch | MIT licence, Homebrew cask, GitHub issues |
