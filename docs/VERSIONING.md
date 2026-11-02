# Versioning and compatibility

MobAlt follows [Semantic Versioning](https://semver.org/) from 1.0.0 on. The number is computed by
`semantic-release` from the commit messages on `main` (`fix:` → patch, `feat:` → minor, a `!` or a
`BREAKING CHANGE:` footer → major), so a version says what kind of change it carries, not how large it is.

## What a version number promises

- **Patch (1.0.x)**: fixes only. Nothing you configured changes meaning; no file format changes.
- **Minor (1.x.0)**: new features and options. Everything below still holds; a new setting defaults to the
  behaviour you had.
- **Major (2.0.0)**: something below is broken on purpose — a removed session type, a renamed field, a changed file
  layout — and the release notes say what to do about it.

## Your files under `~/Library/Application Support/MobAlt/`

`sessions.json`, `settings.json`, `workspace.json` and `known_hosts` carry no format version of their own; the app
version is the format version.

- **Upgrading** never loses anything: a newer MobAlt reads every file an older one wrote. A setting the old version
  did not know is absent and takes its default (`src/main/store.js` lays the file over `DEFAULT_SETTINGS`); a session
  keeps every field it had.
- **Downgrading within 1.x** keeps your data: an older MobAlt ignores the fields it does not know and carries them
  along when it saves (the store and the session editor copy the stored object rather than rebuilding it), so they
  are still there when you upgrade again. A feature the older version lacks is simply not there meanwhile.
- **Secrets** (`password`, `passphrase`, `jumpPassword` in `sessions.json`) are encrypted with Electron
  `safeStorage`, whose key is in this Mac's login keychain ("MobAlt Safe Storage"). Copying `sessions.json` to
  another Mac moves the sessions, not the passwords.
- **Writes are atomic** (a `.tmp` file renamed into place), so a crash mid-save leaves the previous file intact. A
  file that cannot be parsed is treated as empty — MobAlt starts with defaults and overwrites it on the next save —
  so keep a copy before you edit one by hand.
- **Sessions export** (Session → Export Sessions (JSON)) is the interchange format: a file exported by any 1.x
  imports into any later 1.x, and it never contains a secret.

## What is not covered

- The test hooks (`MOBALT_TEST_SCRIPT`, `window.api.app.test*`) and the e2e scripts are development tools, not an
  API; they change without notice.
- The renderer's `window.app` object and the IPC channel names are internal.
- `Casks/mobalt.rb` in this repository mirrors the tap and is rewritten by every release.

## Release channels

Every release is a GitHub Release with a signed and notarized DMG and zip for arm64 and x64, a `latest-mac.yml`
manifest for the in-app updater, and an updated cask in
[Hyeongcheol-An/homebrew-tap](https://github.com/Hyeongcheol-An/homebrew-tap). Releases are cut from `main` only.

A release candidate would be tagged `vX.Y.Z-rc.N` and marked as a pre-release, which the in-app updater and the
cask's `livecheck` (`:github_latest`) both skip, so it is installed by hand from its DMG. Making one first needs a
prerelease branch in `.releaserc.json` (for example `{ "name": "rc", "prerelease": "rc" }`), the release workflow
triggered on that branch, and the cask update skipped for it; none of that exists yet.
