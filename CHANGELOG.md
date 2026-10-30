## [0.10.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.9.1...v0.10.0) (2026-10-30)

### Features

* **a11y:** keyboard access for tabs, session tree, context menus, dialogs and toolbar ([813b7d6](https://github.com/Hyeongcheol-An/MobAlt/commit/813b7d6dfa33cc3891142d509058814832cdf328))
* **logging:** optional plain-text session logs (logPlainText) ([c64430c](https://github.com/Hyeongcheol-An/MobAlt/commit/c64430cd760b41f2189fb4d7fa054fb30709f8e8))
* **mosh:** SFTP browser through a companion SSH connection ([bf86305](https://github.com/Hyeongcheol-An/MobAlt/commit/bf863053497c342856aa382a7f2c6ae7bc23e2e8))
* **tabs:** overflow arrows, edge fades and an "all tabs" menu for the tab strip ([00ba49a](https://github.com/Hyeongcheol-An/MobAlt/commit/00ba49a4ca4b22d0180f71cfa46bc5e746a7d9b9))

### Bug Fixes

* **ssh:** follow-cwd hook keeps the login banner in scrollback (clear -x) ([a554f3f](https://github.com/Hyeongcheol-An/MobAlt/commit/a554f3f1f61f9d199fc1567178e9b2065d1f74cf))
* **theme:** panes keep their palette across split, grid, unsplit, move and WebGL fallback ([d884ddd](https://github.com/Hyeongcheol-An/MobAlt/commit/d884dddf85a7806170d74a09ab427965aecbe230))
* **ui:** DNS lookup names missing records; FTP panel hides "Follow terminal folder" ([e12c5c3](https://github.com/Hyeongcheol-An/MobAlt/commit/e12c5c3f3e50256b0744728af530dc1c1fcc1326))

## [0.9.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.9.0...v0.9.1) (2026-10-30)

### Bug Fixes

* hide the unused terminal cursor behind the FTP pane info ([d52aeaf](https://github.com/Hyeongcheol-An/MobAlt/commit/d52aeafc0eec58e7fb89609ce825fb404086df49))

## [0.9.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.8.1...v0.9.0) (2026-10-30)

### Features

* auto-update, Mosh and FTP/FTPS sessions ([731624f](https://github.com/Hyeongcheol-An/MobAlt/commit/731624f13abf5869209dc4ddf637d0c8988f8725))

### Bug Fixes

* QA pass across dialogs, sidebar, terminal, SFTP, tools and tunnels ([4183a49](https://github.com/Hyeongcheol-An/MobAlt/commit/4183a49c677218e373a5c7bb4fcb845f0a009242))

## [0.8.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.8.0...v0.8.1) (2026-10-30)

### Bug Fixes

* install:local waits for MobAlt to quit instead of replacing a running app ([7ad1ca5](https://github.com/Hyeongcheol-An/MobAlt/commit/7ad1ca5ee812014bbf095eba735e4d50701022ec))

## [0.8.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.7.0...v0.8.0) (2026-10-30)

### Features

* open-source release pipeline: code signing, notarization, Homebrew cask, new README ([580e24f](https://github.com/Hyeongcheol-An/MobAlt/commit/580e24f52912509324716b3a260736eaf1e4c509))

### Bug Fixes

* unit tests no longer need the Electron binary ([ac146cf](https://github.com/Hyeongcheol-An/MobAlt/commit/ac146cf8929ac4250ae1bf4e6d53fe44bd1b1240))

## [0.7.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.6.1...v0.7.0) (2026-10-30)

### Features

* startup commands and custom shell for local, telnet and serial sessions ([967b7f8](https://github.com/Hyeongcheol-An/MobAlt/commit/967b7f8ff0b92db24af4ea7efb8a26c67b0545d2))

## [0.6.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.6.0...v0.6.1) (2026-10-30)

### Bug Fixes

* session editor icon/colour pickers and serial port list rendered as "[object HTMLButtonElement]" ([1b7750f](https://github.com/Hyeongcheol-An/MobAlt/commit/1b7750fd8016546887d3d73244de0a5ab653ed99))

## [0.6.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.5.0...v0.6.0) (2026-10-30)

### Features

* workspace restore, per-session icons/colours, folder drag-move ([df3aaa7](https://github.com/Hyeongcheol-An/MobAlt/commit/df3aaa7df2a6f2334fbac75ebe3b2ea3d4ff7411))

## [0.5.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.4.1...v0.5.0) (2026-10-30)

### Features

* Shift+Enter sends ESC+CR for newline in TUIs (Claude Code) ([942f875](https://github.com/Hyeongcheol-An/MobAlt/commit/942f875c5b6af314a6ba8afbd1ae4e03b2ea78ff))

## [0.4.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.4.0...v0.4.1) (2026-10-30)

### Bug Fixes

* session/tab drag onto panes never dropped (effectAllowed mismatch) ([a7263bd](https://github.com/Hyeongcheol-An/MobAlt/commit/a7263bdf655c5e3887e39f0ed76354345fc17154))

## [0.4.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.3.0...v0.4.0) (2026-10-30)

### Features

* grid layouts up to 2×4 (8 panes), Split menu and open-folder-in-grid ([92c32c4](https://github.com/Hyeongcheol-An/MobAlt/commit/92c32c48176677113ece41bc5e1d1ff1ec34d9cd))

## [0.3.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.3...v0.3.0) (2026-10-30)

### Features

* drag sessions and tabs into split panes ([e0e3c79](https://github.com/Hyeongcheol-An/MobAlt/commit/e0e3c796f237283457d883e45541340048b90388))

## [0.2.3](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.2...v0.2.3) (2026-10-30)

### Bug Fixes

* **ssh:** do not burn auth attempts on agent keys when a password is saved ([7c77ca3](https://github.com/Hyeongcheol-An/MobAlt/commit/7c77ca3ef45928a6bd05100f88a515c76c63d8e7))
* **ssh:** try default ~/.ssh identity files like the ssh CLI ([2220928](https://github.com/Hyeongcheol-An/MobAlt/commit/2220928b4bd05b84da69d1bf2cabeef8c61543b7))

## [0.2.2](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.1...v0.2.2) (2026-10-30)

### Bug Fixes

* **ssh:** explain handshake timeouts with a reachability hint ([18b288a](https://github.com/Hyeongcheol-An/MobAlt/commit/18b288a915ba1390e9db5a20fa40772ea140c555))

## [0.2.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.0...v0.2.1) (2026-10-30)

### Bug Fixes

* **build:** flip Electron fuses so the packaged app ignores ELECTRON_RUN_AS_NODE ([719ada6](https://github.com/Hyeongcheol-An/MobAlt/commit/719ada65664e9d2be5604199579ece40a484ecc7))

## [0.2.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.1.0...v0.2.0) (2026-10-30)

### Features

* serial console sessions and async Keychain secret storage ([9901d41](https://github.com/Hyeongcheol-An/MobAlt/commit/9901d4191191a044a44b860ba37f385561d809d3))

### Bug Fixes

* **ssh:** robust auth method selection and clear failure diagnostics ([7532e3d](https://github.com/Hyeongcheol-An/MobAlt/commit/7532e3d55164d7b221b9b0a0e67007840a6d1a9e))

## [0.1.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.0.0...v0.1.0) (2026-10-30)

### Features

* session manager with folders, importers and encrypted secrets ([b2a8cb0](https://github.com/Hyeongcheol-An/MobAlt/commit/b2a8cb03257397763276f1be4069d3065b6b9de5))
* SFTP browser with transfers, remote editing and folder following ([acaff45](https://github.com/Hyeongcheol-An/MobAlt/commit/acaff4567bd74d08da43994aa17461f5b6aef51c))
* SSH tunnels, X11 forwarding, MultiExec, macros and network tools ([cf57391](https://github.com/Hyeongcheol-An/MobAlt/commit/cf573919bfca27e1bcbf3df335bc412372c41ab5))
* tabbed terminal with local shell, SSH, telnet and split panes ([79929e5](https://github.com/Hyeongcheol-An/MobAlt/commit/79929e51d9114d160f7af1e26580ad327c531b61))

### Bug Fixes

* stray "null" in session editor and session tree overflow ([c186ff0](https://github.com/Hyeongcheol-An/MobAlt/commit/c186ff0d078009b43ca9cfc6abb00aefbf12a127))
