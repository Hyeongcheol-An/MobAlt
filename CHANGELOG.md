## [0.14.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.13.1...v0.14.0) (2026-10-31)

### Features

* **i18n:** Arabic as the eleventh language (right-to-left: <html dir> follows the language) ([3f11a3a](https://github.com/Hyeongcheol-An/MobAlt/commit/3f11a3a78f3ccb2e4e1a5925fc9a5940147ffb53))
* **i18n:** Arabic dictionary and user guide ([359e1d8](https://github.com/Hyeongcheol-An/MobAlt/commit/359e1d82768f3492e46ef060eb6e43c500228048))
* **i18n:** Arabic in the guides' language bars, the READMEs, the parity docs and the language e2e (direction checks) ([87f12ad](https://github.com/Hyeongcheol-An/MobAlt/commit/87f12adc0516ada04ab2e2702e6de5a6ceed054a))
* **i18n:** French dictionary and user guide ([567ea75](https://github.com/Hyeongcheol-An/MobAlt/commit/567ea751cd559c095184f0442a4f897af8009dae))
* **i18n:** German dictionary and user guide ([7a3bfc6](https://github.com/Hyeongcheol-An/MobAlt/commit/7a3bfc6e0023d054a71305aa76de770d16487df9))
* **i18n:** Hindi dictionary and user guide ([faa0a42](https://github.com/Hyeongcheol-An/MobAlt/commit/faa0a42787495a7f61c4f2130dd3447124c6ace6))
* **i18n:** interface language setting — t()/tn() lookup, Settings → General → Language, string catalog and dictionary checks ([52c18f1](https://github.com/Hyeongcheol-An/MobAlt/commit/52c18f1a8811cb610772c6a5a3727432a1e7f4db))
* **i18n:** Japanese dictionary and user guide ([a691ce6](https://github.com/Hyeongcheol-An/MobAlt/commit/a691ce66a473d390da5cc450eca93435830edd96))
* **i18n:** Korean dictionary and user guide ([f5722b6](https://github.com/Hyeongcheol-An/MobAlt/commit/f5722b64ecb76646e2d9b586801287ecf858122f))
* **i18n:** Portuguese dictionary and user guide ([093bb59](https://github.com/Hyeongcheol-An/MobAlt/commit/093bb5917f79f74d67a5c9f317862243fa30bfeb))
* **i18n:** session editor, tunnel and highlight-rule dialogs through t(); Browse… for a local session's start folder ([deee180](https://github.com/Hyeongcheol-An/MobAlt/commit/deee180d0c8d5b7cbbbfdec648e00c8b548b2c65))
* **i18n:** sidebar, SFTP, Tools and Macros panels — data-i18n hooks in index.html, t()/tn() in sidebar/sftp/panels, live re-render on i18n:changed ([942887f](https://github.com/Hyeongcheol-An/MobAlt/commit/942887f9e20043a8f7d84bdc8aa236624b4d678f))
* **i18n:** Simplified Chinese dictionary and user guide ([26623ac](https://github.com/Hyeongcheol-An/MobAlt/commit/26623ac0ab59eacfa42276273f615f6c9635cb5b))
* **i18n:** Spanish dictionary and user guide ([7c9a455](https://github.com/Hyeongcheol-An/MobAlt/commit/7c9a455a39ec36b0d060392ee175c5bb1e039cd0))
* **i18n:** terminal pane, paste guard and keyword highlighting strings through t()/tn() ([d8d4142](https://github.com/Hyeongcheol-An/MobAlt/commit/d8d414271be78aff3eff75b7e8b00b75b27d367e))
* **i18n:** Vietnamese dictionary and user guide ([8490b73](https://github.com/Hyeongcheol-An/MobAlt/commit/8490b73c4fac06c69ef035be6319470ac442c546))
* **i18n:** wrap app.js / ui.js / layout.js / monitor.js / nettools.js strings, live re-render of the status bar, banners and tab strip ([fdc4f12](https://github.com/Hyeongcheol-An/MobAlt/commit/fdc4f12c604046e4afff3441878a4db2534a7038))
* **i18n:** wrap the main process's user-visible strings in t()/tn() ([872bca0](https://github.com/Hyeongcheol-An/MobAlt/commit/872bca0c5de01e2ba6c43239a39d4b36b1908384))
* **i18n:** wrap the Settings, host-key, password, paste-guard, shortcuts and key-generator dialogs ([245acae](https://github.com/Hyeongcheol-An/MobAlt/commit/245acaec5c4b17117a212e530737af49a6466d85))
* **layout:** unsplit mode — the other panes become tabs of their own, close, or ask ([53304e2](https://github.com/Hyeongcheol-An/MobAlt/commit/53304e2648fccb370e7395c766884eb14cb7bcb4))
* **multiexec:** exclude individual panes — MobaXterm's per-terminal checkbox, bulk menu ([66c0346](https://github.com/Hyeongcheol-An/MobAlt/commit/66c034647da8c30fed09dcac59ffd7f3c055aa9d)), closes [#multiexec-count](https://github.com/Hyeongcheol-An/MobAlt/issues/multiexec-count)
* **pane:** pane menu — Rename Pane, Pane Settings, Background Label, Font Size, Read-Only ([602bf82](https://github.com/Hyeongcheol-An/MobAlt/commit/602bf8228a004ea1158ca8b4a5a43837ddc28f76))
* **terminal:** Shift+Enter newline and image paste for Claude Code — keypress fix, Ctrl+V for a clipboard image ([b6d2561](https://github.com/Hyeongcheol-An/MobAlt/commit/b6d2561eabbd43b1a5614fec28c89a562eeea9bb)), closes [#1](https://github.com/Hyeongcheol-An/MobAlt/issues/1)
* **ui:** right-to-left layout for Arabic — mirrored chrome, LTR islands, physical splits ([ecbde45](https://github.com/Hyeongcheol-An/MobAlt/commit/ecbde451f003dfd3d3775d55fb3acc57f848abcd))

### Bug Fixes

* **i18n:** Arabic — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([b9e7808](https://github.com/Hyeongcheol-An/MobAlt/commit/b9e7808ac32167b1876780bb048d1ffe8b249a66))
* **i18n:** Deutsch — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([2dfb452](https://github.com/Hyeongcheol-An/MobAlt/commit/2dfb4522cc80485e705fd8722d978af286f53c8c))
* **i18n:** French — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([db5eb9b](https://github.com/Hyeongcheol-An/MobAlt/commit/db5eb9bf94fed6292dacde9eaccced51b23285b5))
* **i18n:** French review — macOS menu terms, plural agreement, Zmodem/tunnel messages, guide sync ([043283d](https://github.com/Hyeongcheol-An/MobAlt/commit/043283d41de5c857fe2b8d6c70d9f14544c508d1))
* **i18n:** German review — macOS menu terms, plural forms, banner button, guide sync ([6b36944](https://github.com/Hyeongcheol-An/MobAlt/commit/6b3694450ddac220ca67a95c830d86decac2e448))
* **i18n:** Hindi — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([2cb8eb8](https://github.com/Hyeongcheol-An/MobAlt/commit/2cb8eb8d6b6bbc305867ceeb7996429c1c3aabc4))
* **i18n:** Hindi review — macOS menu terms, Quit/View/Edit wording, guide fixes ([8f9b5a6](https://github.com/Hyeongcheol-An/MobAlt/commit/8f9b5a6813b1dc401a7e822685e99c4cf851c98c))
* **i18n:** Japanese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([f6ae4d2](https://github.com/Hyeongcheol-An/MobAlt/commit/f6ae4d2397d4349e5bfbe16aaac9d7c68911021e))
* **i18n:** Japanese review — macOS menu terms, error wording, guide sync ([2bde21d](https://github.com/Hyeongcheol-An/MobAlt/commit/2bde21d5e5088227a49e81a8ca008f833fb1c296))
* **i18n:** Korean — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([68e4eb7](https://github.com/Hyeongcheol-An/MobAlt/commit/68e4eb7e2a444368d7ef86d7a3d73d17a11f1da9))
* **i18n:** Korean review — macOS menu terms, scan/record terminology, guide sync ([2733abc](https://github.com/Hyeongcheol-An/MobAlt/commit/2733abcbe9db34bb2f7304832b126ed829e28198))
* **i18n:** MOBALT_LANG stands in for the Mac's language list (and the saved setting at startup) — a language chosen in Settings still applies while running ([d66e231](https://github.com/Hyeongcheol-An/MobAlt/commit/d66e2316e8c559589aa9bb0c26c7408a650e8ced))
* **i18n:** Portuguese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([5f55601](https://github.com/Hyeongcheol-An/MobAlt/commit/5f55601cf6128d8125a8b4544754624406b14a8a))
* **i18n:** Portuguese review — macOS menu terms, pt-BR wording, guide language list ([ed8f227](https://github.com/Hyeongcheol-An/MobAlt/commit/ed8f2276009725f7d10edca44db1ad7c8e54d161))
* **i18n:** Simplified Chinese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([4781e97](https://github.com/Hyeongcheol-An/MobAlt/commit/4781e97d5b4eeba7aa31b594fccb7a56c897a51c))
* **i18n:** Simplified Chinese review — macOS menu terms, error wording, guide sync ([e39009e](https://github.com/Hyeongcheol-An/MobAlt/commit/e39009eafbb312979a894c04d92b8931e1ac7d18))
* **i18n:** Spanish — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([26d5e1e](https://github.com/Hyeongcheol-An/MobAlt/commit/26d5e1edc844abaf1c89b1fd9d1e221f821c24ec))
* **i18n:** Spanish review — macOS menu terms, plural agreement, side-strip label, guide sync ([c5a0682](https://github.com/Hyeongcheol-An/MobAlt/commit/c5a0682e1212d755bad8b4190146d25c4c1a5818))
* **i18n:** the relaunch banner is one sentence key (no stray space before the kept part), its buttons never wrap; 'Zoom text' and 'Enabled' keys no longer share the Window menu's Zoom and the On toggle ([1518e79](https://github.com/Hyeongcheol-An/MobAlt/commit/1518e79cb881b51a6104fcd9a67ed0c1594e0f37))
* **i18n:** the status bar names an empty pane in the interface language; Korean guide: the right-to-left paragraph ([1b8c67a](https://github.com/Hyeongcheol-An/MobAlt/commit/1b8c67aa3b9db0c5b1e41938def005f45917c5fb))
* **i18n:** translated labels for the role menu items and the Window / Help menus; Local and Serial type labels follow the language; a tn() form may omit a placeholder only one English form has ([269225c](https://github.com/Hyeongcheol-An/MobAlt/commit/269225c25568112934153a9f40ed2de6e2cdc746))
* **i18n:** Vietnamese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([12b96d4](https://github.com/Hyeongcheol-An/MobAlt/commit/12b96d4c65fffdb23b16f2099cdd4634e2f7acf7))
* **i18n:** Vietnamese review — macOS menu terms, View → Xem, guide language list ([402ec31](https://github.com/Hyeongcheol-An/MobAlt/commit/402ec316b245aaaff3aa522eaf21fbff2556980b))
* **i18n:** whole-sentence quit / relaunch questions, the tunnel-failure plural follows the failed count, a translatable list joiner; i18n-shots flags wrapped buttons and opens the real pane menu ([4998b69](https://github.com/Hyeongcheol-An/MobAlt/commit/4998b69782a2e1d8b1575003db7f88f723bc5b8c))
* **test:** e2e-qa-fixes — restore the expression a trailing comment had swallowed ([6887fcf](https://github.com/Hyeongcheol-An/MobAlt/commit/6887fcf02eeb3f74ffd6e1d95e036117502e6ff1))
* **ui:** CJK side-strip labels stand upright instead of upside down ([6e88cb8](https://github.com/Hyeongcheol-An/MobAlt/commit/6e88cb83e15d860f9c5f28e2c9ac43cc338429bc))
* **ui:** the Pane Settings dialog uses the wide width and the theme preview shrinks before the row overflows; i18n-shots covers the MultiExec menu, the pane menu in MultiExec and Pane Settings; the dictionary checks are strict by default ([468daf5](https://github.com/Hyeongcheol-An/MobAlt/commit/468daf5a7f21dfceb51b2a6226019b64d70e7c01))

## [0.13.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.13.0...v0.13.1) (2026-10-31)

### Bug Fixes

* **ssh:** stop probing every DH group at startup — the app froze for ~35 s before its window appeared ([ca173d5](https://github.com/Hyeongcheol-An/MobAlt/commit/ca173d5a587ff02ead12b4524d56204e6d7bbaf7))

## [0.13.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.12.0...v0.13.0) (2026-10-31)

### Features

* **settings:** a Features tab for the paste guard, monitoring bar and keyword highlighting ([835a007](https://github.com/Hyeongcheol-An/MobAlt/commit/835a00715b9dcc5e72ddc6db545f0c0e2479178b))
* **ssh:** expert algorithm settings ([73b532a](https://github.com/Hyeongcheol-An/MobAlt/commit/73b532a486b0fdaa5f60d259c6b56450c4396b2a))
* **ssh:** key generator ([e3acfcb](https://github.com/Hyeongcheol-An/MobAlt/commit/e3acfcb5dc8afa44aaaf9ad0ac59cdc9ac79a758))
* **ssh:** remote monitoring bar ([90eec89](https://github.com/Hyeongcheol-An/MobAlt/commit/90eec89052a68365226bbdaf0989fe5ec3c24b77))
* **tabs:** detach a tab to its own window ([7fd5f76](https://github.com/Hyeongcheol-An/MobAlt/commit/7fd5f760007deb522aa1548d30c1687fdc0a706d))
* **tabs:** pin and close-left/right ([beb2b2b](https://github.com/Hyeongcheol-An/MobAlt/commit/beb2b2bbc4f90bdb2ee683ef5b9fee1af46c19aa))
* **terminal:** keyword highlighting ([12ad503](https://github.com/Hyeongcheol-An/MobAlt/commit/12ad50392a7a7608b70bd1cdff171dd59b93db8f))
* **terminal:** paste guard — confirm multi-line pastes, flag suspicious content ([e8f7137](https://github.com/Hyeongcheol-An/MobAlt/commit/e8f7137fbd583fe474c716564cb3db29a885fd81))
* **terminal:** zmodem rz/sz transfers ([14d4927](https://github.com/Hyeongcheol-An/MobAlt/commit/14d4927ef2719564d310c20be107795138ca53f3))
* **tools:** Wake-on-LAN and network scanner ([21e9455](https://github.com/Hyeongcheol-An/MobAlt/commit/21e9455c477405dc135b2abc57bfe6afc9e5b6c2))

### Bug Fixes

* **keygen:** lock the dialog while it installs, say "folder" and "~user" plainly, refuse ~user remote files ([6c8fa75](https://github.com/Hyeongcheol-An/MobAlt/commit/6c8fa757c8ae88320574ecaa3d8855061d6487b8))
* **monitor:** fold the strip to the pane's width and mark a stale sample ([d0a0de8](https://github.com/Hyeongcheol-An/MobAlt/commit/d0a0de84e9672168a726d3033dd63ea76511fa65))
* **session:** a Mosh session keeps and applies its Advanced SSH algorithm settings ([c9ac210](https://github.com/Hyeongcheol-An/MobAlt/commit/c9ac21039bba3468fef3edf6230fdd712a5be9d9))
* **ssh:** legacy preset without the 1024-bit DH group, one host-key prompt per host, readable DH error ([e7e3146](https://github.com/Hyeongcheol-An/MobAlt/commit/e7e3146edeba0353d3dd36be92bc8cdaf4358625))
* **tabs:** pinned tab keeps focus, Session menu items grey out, detached windows close and cascade ([52dd4c7](https://github.com/Hyeongcheol-An/MobAlt/commit/52dd4c79528c69c5f459686f8548a22eddb0e9ed))
* **terminal:** drain the Zmodem stream after an abort, notice a dead peer in seconds, keep replays and logs clean ([05371ef](https://github.com/Hyeongcheol-An/MobAlt/commit/05371ef1ff6ffb73492345e1d01901d006fd258a))
* **terminal:** keep keyword decorations off the alternate screen, notice rows rewritten in place ([18ad120](https://github.com/Hyeongcheol-An/MobAlt/commit/18ad120fd2a2c296f03056984e201e6b0937fd8e))
* **terminal:** no stray byte reaches the pane after a dead Zmodem peer ([a11e519](https://github.com/Hyeongcheol-An/MobAlt/commit/a11e519e344de4b81913ac20b1c6c01a8249fd74))
* **terminal:** paste guard edges, a fluid preview, readable marks; one Zmodem checkbox ([3f70149](https://github.com/Hyeongcheol-An/MobAlt/commit/3f701496403d43f50a32046f2066e9d9ea808d42))
* **terminal:** webgl budget — a GPU context only for the panes on screen ([f300f96](https://github.com/Hyeongcheol-An/MobAlt/commit/f300f96e4545ff8e96aa2d4c67a9312af9ade6fe))
* **theme:** readable monitor meters, detached marker, scan ＋ hover, a ring on the rDNS box ([5452c08](https://github.com/Hyeongcheol-An/MobAlt/commit/5452c08c3428fdafab2d19545ef5585609cadc2f))
* **tools:** keep the scanner's Workers and Timeout fields on their own rows in a narrow sidebar ([bf5eca7](https://github.com/Hyeongcheol-An/MobAlt/commit/bf5eca70b949a15c68aeeab0a7f848173e3c7b74))
* **tools:** one scan at a time, dual-stack targets, port prefill, Ports sort, narrow and short layouts, WoL polish ([078da52](https://github.com/Hyeongcheol-An/MobAlt/commit/078da52f7ed1d607d68d2a568a13b5ae2ddca91e))

## [0.12.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.11.0...v0.12.0) (2026-10-31)

### Features

* **layout:** zoom a pane to fill its tab ([228ae9a](https://github.com/Hyeongcheol-An/MobAlt/commit/228ae9adce47caa85973d6df62f3af8438198b17))
* **theme:** apply the selected theme to the whole app ([0cf57bb](https://github.com/Hyeongcheol-An/MobAlt/commit/0cf57bbc3445cd26012fe4ac7b10b72a6801fc93))
* **ui:** settings in tabs that fit the minimum window; compact shortcuts dialog ([8303d7c](https://github.com/Hyeongcheol-An/MobAlt/commit/8303d7ca61a74e8e87105672b192615a17941d32))

### Bug Fixes

* **a11y:** keep the pane zoom button's name constant, aria-pressed carries the state ([acbd3a7](https://github.com/Hyeongcheol-An/MobAlt/commit/acbd3a754442ce062890a233354cf8236025811d))
* **a11y:** name every form control, focus cues on find/tools boxes, editor tab roles, live toasts ([d6d6742](https://github.com/Hyeongcheol-An/MobAlt/commit/d6d6742bed8f981a4d4673f75b5824e7051e01f2)), closes [#find-input](https://github.com/Hyeongcheol-An/MobAlt/issues/find-input) [#tool-host](https://github.com/Hyeongcheol-An/MobAlt/issues/tool-host) [#sftp-path](https://github.com/Hyeongcheol-An/MobAlt/issues/sftp-path) [#qc-input](https://github.com/Hyeongcheol-An/MobAlt/issues/qc-input) [#session-filter](https://github.com/Hyeongcheol-An/MobAlt/issues/session-filter) [#toast-root](https://github.com/Hyeongcheol-An/MobAlt/issues/toast-root) [#multiexec-banner](https://github.com/Hyeongcheol-An/MobAlt/issues/multiexec-banner)
* **sessions:** readable export errors, BOM/UTF-16 JSON, honest import counts, MobaXterm validation ([bfeef18](https://github.com/Hyeongcheol-An/MobAlt/commit/bfeef1839ce5055243143d300378cd36116cd845)), closes [#130](https://github.com/Hyeongcheol-An/MobAlt/issues/130)
* **sessions:** validate imported JSON, strip exporter flags, dedup MobaXterm re-imports ([8ff8a02](https://github.com/Hyeongcheol-An/MobAlt/commit/8ff8a0202c6bbd29fc4cbe34ec94fca108edb9aa))
* **settings:** give macOptionIsMeta a stored default ([ce085e0](https://github.com/Hyeongcheol-An/MobAlt/commit/ce085e095beac31d611763602e5949a1f213ba65))
* **settings:** hold the dialog at the height of its tallest section ([1ccc550](https://github.com/Hyeongcheol-An/MobAlt/commit/1ccc550f6b8ad0d13c576dc8cff792f3b5625676))
* **theme:** contrast and consistency fixes from the theme and keyboard QA ([ed2b0f1](https://github.com/Hyeongcheol-An/MobAlt/commit/ed2b0f13d6d05db3b735262d9e1772572b8ed32e))
* **theme:** paint the first frame in the saved theme ([7f9bb60](https://github.com/Hyeongcheol-An/MobAlt/commit/7f9bb60ec486b4ecceddebf9b39e011e6c2473cb))
* **tools:** drop a stopped tool's late output when another tool starts ([9d4104f](https://github.com/Hyeongcheol-An/MobAlt/commit/9d4104f33de5113f2fb376d797dad7a8c7138f30))
* **ui:** real plurals in toasts and a quit label that names every connection kind ([2290ff3](https://github.com/Hyeongcheol-An/MobAlt/commit/2290ff331fd1e6e51b4b5120591ed02678394237))

## [0.11.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.10.1...v0.11.0) (2026-10-31)

### Features

* **a11y:** per-row focus and type-ahead in the SFTP list and session tree ([497240a](https://github.com/Hyeongcheol-An/MobAlt/commit/497240a1be53b91881ae90c2af0ef40c72b769d0))
* **brand:** design the app icon and DMG background as SVG sources ([9108ac1](https://github.com/Hyeongcheol-An/MobAlt/commit/9108ac169b685dfbf97f23353ccf4abd020d564b))
* **multiexec:** broadcast only to the terminals visible in the active tab ([5e55a89](https://github.com/Hyeongcheol-An/MobAlt/commit/5e55a89681e7d1241cc35ac22645fb50176ef964))
* **update:** notice a newer MobAlt.app on disk and offer a relaunch ([f060f60](https://github.com/Hyeongcheol-An/MobAlt/commit/f060f6099a0037dbe723a4170b4b6e002c263512))

### Bug Fixes

* **a11y:** keyboard follow-ups in the SFTP list, session tree, panels and Shortcuts dialog ([4ea3ddb](https://github.com/Hyeongcheol-An/MobAlt/commit/4ea3ddb81e8bd84d98fe9f02511bd6e1f18bd4dc))
* **brand:** give the DMG labels a mid-tone band readable in light and dark Finder ([056f192](https://github.com/Hyeongcheol-An/MobAlt/commit/056f192dd2d4bba725b14ffe045f66e0b1a6bc39)), closes [#6b84b3](https://github.com/Hyeongcheol-An/MobAlt/issues/6b84b3)
* **build:** use the personal bundle id io.github.hyeongcheol-an.mobalt ([5a359cc](https://github.com/Hyeongcheol-An/MobAlt/commit/5a359cc3a746a2ef2cadab2412ea868c062785bb))
* **repo:** drop the node_modules symlink that slipped into v0.10.1 and ignore symlinked node_modules too ([d8d39cb](https://github.com/Hyeongcheol-An/MobAlt/commit/d8d39cb75713f5a858ec9b642f3fbee5e75f8a9d))
* **ssh:** announce a connection the server dropped ([ab0af87](https://github.com/Hyeongcheol-An/MobAlt/commit/ab0af8711d7a3f082d34509a681fbb6c782b7be9))
* **test:** drop the committed test/sshd-runtime symlink and ignore it as a link too ([d980cdf](https://github.com/Hyeongcheol-An/MobAlt/commit/d980cdfcc1cb6a0a4b1e769350a107cd1e74dd83))
* **ui:** keep the all-tabs menu inside the window and clip long dialog titles ([b3c93fc](https://github.com/Hyeongcheol-An/MobAlt/commit/b3c93fcf16a2c737d1ca5a7ddceb892ebb2bcd22))
* **ui:** light-theme find matches and FTP card contrast, unbreakable update call to action ([fb908dd](https://github.com/Hyeongcheol-An/MobAlt/commit/fb908dd3a60ed22c10213e87e5a39ba8ce67fe2b))
* **ui:** name a tab after its session while other panes are used ([602d32b](https://github.com/Hyeongcheol-An/MobAlt/commit/602d32bf624a3866ac8cfd0a81e0bf3ec6357530))
* **ui:** toasts clear the find bar, long notices wrap, cards sit below the pane head ([06d1dd8](https://github.com/Hyeongcheol-An/MobAlt/commit/06d1dd821d6142dd20e201986fcbce3b88ec9787)), closes [#toast-root](https://github.com/Hyeongcheol-An/MobAlt/issues/toast-root) [#multiexec-count](https://github.com/Hyeongcheol-An/MobAlt/issues/multiexec-count)
* **update:** quiet "Check now" in Settings; the relaunch question says Relaunch ([ebf36b7](https://github.com/Hyeongcheol-An/MobAlt/commit/ebf36b781bd5dc32f29dc875aa43a27049988621))
* **update:** relaunch through LaunchServices and surface main-process notices ([109ae56](https://github.com/Hyeongcheol-An/MobAlt/commit/109ae5668fda5b65b5bbc1c4b852a80514b31fe1))

## [0.10.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.10.0...v0.10.1) (2026-10-30)

### Bug Fixes

* **a11y:** dialogs hand focus back to their opener; one Tab stop per picker ([96d3cfc](https://github.com/Hyeongcheol-An/MobAlt/commit/96d3cfcba6b837cd36ac80f4937f4a73ab236124))
* **a11y:** keyboard follow-ups in the session tree, macros list and SFTP list ([9b8349b](https://github.com/Hyeongcheol-An/MobAlt/commit/9b8349bd798bd76aa13220821c406340a02213f3))
* **a11y:** tab strip never drops keyboard focus on <body> ([1f1f68a](https://github.com/Hyeongcheol-An/MobAlt/commit/1f1f68aeb4c49af6937db3a50e3394f71a5f8bb3))
* **a11y:** unclipped focus rings for the toolbar, tab bar arrows, SFTP list and pickers ([93073a7](https://github.com/Hyeongcheol-An/MobAlt/commit/93073a73aa3b324df63fc0da60c1bd2b530046bb)), closes [#sftp-list](https://github.com/Hyeongcheol-An/MobAlt/issues/sftp-list)
* **app:** quit confirmation for ⌘Q counts every live connection ([ad84806](https://github.com/Hyeongcheol-An/MobAlt/commit/ad848067ec5582b6fd894aa858db2bc5d4551b77))
* **ftp:** disconnect on close, readable errors, password prompt, safe rename and cancel ([fff4863](https://github.com/Hyeongcheol-An/MobAlt/commit/fff4863d23c0c40248e7a1f5794e3f7d49507d94))
* **mosh:** verify the host key in the app before the bootstrap; failures read as failed ([954fb40](https://github.com/Hyeongcheol-An/MobAlt/commit/954fb40935538d4ecc9fc3644084fd62a9b8d22d))
* **ssh:** only a retry of the passphrase prompt says "Incorrect passphrase" ([7f7725f](https://github.com/Hyeongcheol-An/MobAlt/commit/7f7725fe87c2ca47c0ae1a670c41913b94714497))
* **ui:** regression-sweep follow-ups — editor rows survive type changes, tunnel edits mark it dirty, find bar tolerates bad patterns ([7b1b819](https://github.com/Hyeongcheol-An/MobAlt/commit/7b1b81981c27873658343a377eae7bfa79fcd338))
* **ui:** visual QA follow-ups — plain logs mirror the terminal line, toasts clear the find bar, last glyph icons replaced ([edc2e43](https://github.com/Hyeongcheol-An/MobAlt/commit/edc2e435a965325e11544bef197abc50934a8c49))

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
