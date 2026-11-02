<!-- Title in Conventional Commits form: feat(scope): …, fix(scope): …, docs: …, test: … — it becomes the
     changelog line and decides the version bump (feat → minor, fix → patch, feat! → major). -->

## What changed and why

<!-- One paragraph for the reader of the changelog: the behaviour before, the behaviour now, what prompted it. -->

## How it was verified

<!-- Commands and numbers, not adjectives: `npm test` (… tests), the e2e script(s) run and their RESULTS line,
     the test sshd / FTP server / httpsrv used, a before/after measurement for a perf change. -->

- [ ] `npm test` passes (strict i18n — or `I18N_STRICT=0 npm test` with the untranslated strings listed below)
- [ ] The e2e script(s) that cover the change were run: `…`

## Checklist

- [ ] **Strings**: every new or reworded user-visible text goes through `t()` / `tn()`; `npm run i18n` was run and
      `src/locales/catalog.json` is committed. Languages still owed (`npm run i18n:status`): …
- [ ] **Docs**: a change the user can see has its paragraph in `docs/USER_GUIDE.md`; a feature has its line in
      `README.md` / `README.ko.md` and its row in `docs/MOBAXTERM_PARITY.md` + `.ko.md` with the summary counts updated.
- [ ] **Screenshots** for a visible UI change (made with `test/qa/run.sh`, made-up hosts, nothing personal).
- [ ] **Hygiene**: no real host name, public IP, e-mail, key or token anywhere in the diff (fixtures use
      `example.com`, `192.0.2.x`); no secrets or cookies in logs the PR quotes.
- [ ] **Main/renderer boundary**: anything that touches the network, the file system or secrets lives in `src/main/`
      behind an IPC handler.

## Left for later

<!-- Translations, follow-up issues, known gaps. -->
