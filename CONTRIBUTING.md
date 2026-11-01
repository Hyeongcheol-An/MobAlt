# Contributing

Thanks for helping make MobAlt better.

- **Bugs / ideas**: open an issue with macOS version, MobAlt version (Help → About) and, for SSH
  problems, the `Server accepts: … / tried: …` line from the terminal.
- **Pull requests**: branch from `main`, keep commits in
  [Conventional Commits](https://www.conventionalcommits.org/) form (`feat:`, `fix:`, `docs:`, …)
  because versions and the changelog are generated from them. Run `npm test` before pushing; the
  E2E scripts in `test/` are described in the README.
- **Interface strings**: every text the user sees is English in the code and goes through `t()`; a change
  that adds or rewords one brings all eleven dictionaries along before it merges — `npm run i18n`, then
  `npm run i18n:status -- --list` for what each language owes, translate, `npm test` (strict: an
  untranslated string fails it, here and in CI). The procedure, the dictionary rules and the translation
  brief are in [src/locales/README.md](src/locales/README.md).
- **Security issues**: see [SECURITY.md](SECURITY.md), not a public issue.
- **Code style**: plain ES modules in the renderer, CommonJS in the main process, no framework.
  Keep anything that touches the network or secrets in `src/main/` behind an IPC handler.

By contributing you agree that your contributions are licensed under the MIT License.
