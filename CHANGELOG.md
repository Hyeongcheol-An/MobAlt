## [1.0.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v1.0.0...v1.0.1) (2026-11-03)

### Bug Fixes

* **browser:** name the pane after the session when a load fails ([180ba2e](https://github.com/Hyeongcheol-An/MobAlt/commit/180ba2e7bd886724cb4ea4381891084453f1a6a5))
* **browser:** shut a page that keeps sending itself to user@ ([4071339](https://github.com/Hyeongcheol-An/MobAlt/commit/40713398fc8658d40bb4e57cbb68c8e8a8b81673))
* **browser:** shut a slow user@ loop too, drop a stale stop message ([79a0462](https://github.com/Hyeongcheol-An/MobAlt/commit/79a0462de2b6bf9c38f82f478e9ef1f4dafde6f5))
* **i18n:** natural Korean particles, accurate Net info labels, the Japanese realm line ([8e4530b](https://github.com/Hyeongcheol-An/MobAlt/commit/8e4530bbd9a341df2c23fb845dc6e735b5d47b54))
* **keygen:** drain the key when it is already installed ([cbcd088](https://github.com/Hyeongcheol-An/MobAlt/commit/cbcd088f08165c52b6661da62dcbdc246126b820))
* **terminal:** hand a failed mosh / FTP start back as a reply ([354dbb0](https://github.com/Hyeongcheol-An/MobAlt/commit/354dbb0fa0da8e7c2a73a454eb4adc9d1420f4a2))

## [1.0.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.18.0...v1.0.0) (2026-11-02)

### Features

* **i18n:** translate the 1.0 polish strings ([50b559f](https://github.com/Hyeongcheol-An/MobAlt/commit/50b559fb127f7d85e440fc925ec3e249a8862a92))
* **i18n:** translate the other-window install sheet ([8a7fdd5](https://github.com/Hyeongcheol-An/MobAlt/commit/8a7fdd5fb54b8b581cd0519738dc312d83dac97a))
* **i18n:** translate the security-review strings ([2bb0eee](https://github.com/Hyeongcheol-An/MobAlt/commit/2bb0eee976b1d3864e426ebbd0592bf39cb5d202))

### Bug Fixes

* **a11y:** close the find bar with Esc from any of its controls ([171cf5c](https://github.com/Hyeongcheol-An/MobAlt/commit/171cf5c56bc2ac18fd3d6ecfc4de38c103ab41e2))
* **a11y:** make a disabled primary button readable in every theme ([b3a4ee2](https://github.com/Hyeongcheol-An/MobAlt/commit/b3a4ee2cea68d76c5ac2dc6408da041d23ca5580))
* **a11y:** name the session editor's colour swatches ([8b886e0](https://github.com/Hyeongcheol-An/MobAlt/commit/8b886e02d47ffafe8f3cfc0b283966536ab80a8c))
* **a11y:** stop the endless animations under Reduce motion ([4b7addb](https://github.com/Hyeongcheol-An/MobAlt/commit/4b7addb6783440c1e3308ff07aa1d2580c8742df))
* **editor:** find the external editor on the login shell's PATH and report a failed start ([c78c228](https://github.com/Hyeongcheol-An/MobAlt/commit/c78c228ea93c8f3cc2747cc9d26d6b7c706c020b))
* **editor:** sweep edit folders a killed run left behind ([c8c54ff](https://github.com/Hyeongcheol-An/MobAlt/commit/c8c54ff61c1d3582e75b4939532507acde6026c7))
* **find:** close the find bar when the last tab closes ([b1e2ae1](https://github.com/Hyeongcheol-An/MobAlt/commit/b1e2ae1c3b9a5a3a7302bf4ba3569c9716fec1dd))
* **i18n:** accept a tn() pair kept in English in the [@keep](https://github.com/keep) check ([f7a1380](https://github.com/Hyeongcheol-An/MobAlt/commit/f7a13801d55396a18e05fab59bdd7bd40a226f61))
* **i18n:** keep terminal status lines in English for Arabic and Hindi ([635628e](https://github.com/Hyeongcheol-An/MobAlt/commit/635628ea33266d39a456f1f9937a0e51eea61173))
* **i18n:** print a failed start in the terminal language too ([0fe54a9](https://github.com/Hyeongcheol-An/MobAlt/commit/0fe54a981ce5e317d8197e3ff1951e1fe2b61c73))
* **import:** RDP files take one line per setting; JSON import counts commands ([e8f8b0d](https://github.com/Hyeongcheol-An/MobAlt/commit/e8f8b0d3b4712ec7ebed9f2287bca3566118b14b))
* **main:** keep the test hooks out of release builds ([88e22e8](https://github.com/Hyeongcheol-An/MobAlt/commit/88e22e8b690b230eda3d2bf88c8c58c68070f3fc))
* **main:** keep the window on its page and allowlist what it may open ([3ea1bec](https://github.com/Hyeongcheol-An/MobAlt/commit/3ea1becb5225ea09004941b156e729339c38b499))
* **main:** open-path also allows the app's own userData and logs folders ([a857574](https://github.com/Hyeongcheol-An/MobAlt/commit/a8575743a79f0a2d03c598eca8790e7761b1cce2))
* **multiexec:** plural forms for the banner's visible-terminal count ([bfd678f](https://github.com/Hyeongcheol-An/MobAlt/commit/bfd678fa74ecea27dff3463da8ea3e6065e86e4f))
* **rtl:** read the find counter left to right in Arabic ([dc2d63a](https://github.com/Hyeongcheol-An/MobAlt/commit/dc2d63a6b098d947a198ee17421d5e8fdeb4d837))
* **sftp:** start the external editor without a shell ([d943994](https://github.com/Hyeongcheol-An/MobAlt/commit/d94399495efa5a84ba0a5ff8bf41c98cf17e804b))
* **ssh:** a refused connection drops a pending Cancel ([bf48632](https://github.com/Hyeongcheol-An/MobAlt/commit/bf4863255f000c2c5adfc73ec91c815c8558d989))
* **ssh:** close known_hosts gaps (revoked keys, other key types, case, patterns) ([46801ee](https://github.com/Hyeongcheol-An/MobAlt/commit/46801ee0945dff369dca1afcee25b55ccf5ff1da))
* **ssh:** honour Cancel in the first milliseconds of "Connecting…" ([ae8add3](https://github.com/Hyeongcheol-An/MobAlt/commit/ae8add3110acdf52dfcace9041e393ee37642b66))
* **ssh:** one connection attempt per pane when Reconnect races Cancel ([23e8167](https://github.com/Hyeongcheol-An/MobAlt/commit/23e81672b3665851b728fb22f29b380db6308d8a))
* **ssh:** say "Connection attempt cancelled." when cancelled before the shell opened ([9a4b720](https://github.com/Hyeongcheol-An/MobAlt/commit/9a4b7202fa7c43898f437cf84def7c3ab66531e3))
* **store:** 0600 user files and a warning when secrets cannot be encrypted ([dbc6d3d](https://github.com/Hyeongcheol-An/MobAlt/commit/dbc6d3dc557f3c9d1a818547f03e8760f1baa0a2))
* **terminal:** keep the dead line above the Reconnect / Close strip ([3e4dae3](https://github.com/Hyeongcheol-An/MobAlt/commit/3e4dae3c202e4db8c793b592239a36d86c79fde0))
* **terminal:** open OSC 8 links through the allowlisted external-open IPC ([363ada6](https://github.com/Hyeongcheol-An/MobAlt/commit/363ada6c679f6f3eedfb2a1a747ce49adf00a94f))
* **terminal:** pad under the dead line only as far as the strip needs ([1fbdd75](https://github.com/Hyeongcheol-An/MobAlt/commit/1fbdd752fa5cc9f643a0943c8b989cab055833a4))
* **tools:** a host is never read as an option of ping, traceroute or mosh ([308c992](https://github.com/Hyeongcheol-An/MobAlt/commit/308c9920f25ed354139d57748ad27e7877123491))
* **ui:** a changed host key is not accepted by pressing Enter ([58bcb2c](https://github.com/Hyeongcheol-An/MobAlt/commit/58bcb2c94259b357b8b30203e27074dcfc39b7ad))
* **ui:** label the side strip's file browser "SFTP" ([8abb47c](https://github.com/Hyeongcheol-An/MobAlt/commit/8abb47c1532b643386c9608efae8b234bed8eebf))
* **updater:** count this user's instances only; hold the latch while the sheet is open ([69422e0](https://github.com/Hyeongcheol-An/MobAlt/commit/69422e0a5db226f14aac1b2cbf09de75a4e712d1))
* **updater:** say when another MobAlt window blocks the install ([1aed61e](https://github.com/Hyeongcheol-An/MobAlt/commit/1aed61eeb7916b64bc46c25d205012bd75ca148c))
* **x11:** never block main on xauth; time out a shell that does not open ([098a3df](https://github.com/Hyeongcheol-An/MobAlt/commit/098a3dfcc7f01768f272f9991979f6eecd4e84a3))
* **x11:** refuse forwarded X clients that lack the session's fake cookie ([fc4bc6d](https://github.com/Hyeongcheol-An/MobAlt/commit/fc4bc6da0cfbe84ca29f5e2ade7b894b1b8f5904))
* **zmodem:** keep the failure reason English in the terminal line too ([f2ee096](https://github.com/Hyeongcheol-An/MobAlt/commit/f2ee09697cfd5acdcc1f6248f84c1182841c211e))

## [0.18.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.17.0...v0.18.0) (2026-11-02)

### Features

* **browser:** built-in browser session — a web page in a pane ([1d99e7a](https://github.com/Hyeongcheol-An/MobAlt/commit/1d99e7a23217dc25f59d1abfc564bfc18d92b5c4))
* **i18n:** translate the browser session ([79fc111](https://github.com/Hyeongcheol-An/MobAlt/commit/79fc11107398c83833af01918ed960e57770c16a))

### Bug Fixes

* **browser:** an odd guest id is no guest, not an exception ([81eaa31](https://github.com/Hyeongcheol-An/MobAlt/commit/81eaa31d43d128638965350570b631d22130db6d))
* **browser:** leave the page its own shortcuts, steady titles, user-name links ([0c5f7f0](https://github.com/Hyeongcheol-An/MobAlt/commit/0c5f7f04a4d13d2ba90cd4326717a7c848081846))
* **browser:** let user@ redirects through so the redirect limit ends a loop ([16a0810](https://github.com/Hyeongcheol-An/MobAlt/commit/16a0810d6eca528aae52fabea9d3cfc8dc79b1cf))
* **browser:** no credentials in an address; the web's ports, IPv6 and octal hosts ([5df27a1](https://github.com/Hyeongcheol-An/MobAlt/commit/5df27a12db70c4caea1e1aaaec0f0d054a2c5a56))
* **browser:** sign-in prompt, downloads, dialogs and the guest guards ([e797c55](https://github.com/Hyeongcheol-An/MobAlt/commit/e797c55856649238578b4d4d1872e4ea9f8a3e01))
* **browser:** the pane after review — focus, titles, zoom, errors, keyboard ([2a6cdbd](https://github.com/Hyeongcheol-An/MobAlt/commit/2a6cdbdbbb78ac2f9a5a300a686e242bbc398d27))
* **session:** sessions without a port survive export → import ([341864c](https://github.com/Hyeongcheol-An/MobAlt/commit/341864c7480112ca2c060dbd77c1b2fdf1adab22))

## [0.17.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.16.1...v0.17.0) (2026-11-02)

### Features

* **i18n:** shorten the German download lines ([43bb2b6](https://github.com/Hyeongcheol-An/MobAlt/commit/43bb2b68fddc63cb3f68d8fe612eb06b08b46e5f))
* **i18n:** translate the download-progress strings ([4ccd809](https://github.com/Hyeongcheol-An/MobAlt/commit/4ccd809ef557ad8ff4f5a83bac3f052a5bec2b16))
* **updater:** show download progress ([c2d7e39](https://github.com/Hyeongcheol-An/MobAlt/commit/c2d7e399802333c97ad8481988ba9902cb7ab85d))

### Bug Fixes

* **updater:** keep the download reachable after Later, stable row, install hardening ([f9f0752](https://github.com/Hyeongcheol-An/MobAlt/commit/f9f0752bcdc0f342dab31e5e37efe32908c16a18))
* **updater:** Later on the on-disk banner after a dismissed download ([d6fbf8b](https://github.com/Hyeongcheol-An/MobAlt/commit/d6fbf8b6c82c2fe6039ad5f4fd3d310f5bab045f))
* **updater:** review fixes for the download progress ([71b817d](https://github.com/Hyeongcheol-An/MobAlt/commit/71b817dc7b232d5bc36324fabc6dc641c373c1ef))

## [0.16.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.16.0...v0.16.1) (2026-11-02)

### Bug Fixes

* say so when macOS Local Network privacy refuses a LAN connection ([a846059](https://github.com/Hyeongcheol-An/MobAlt/commit/a8460596489c7698237ed653de0313b74981ddac))

## [0.16.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.15.2...v0.16.0) (2026-11-01)

### Features

* **ssh:** post-quantum key exchange (ML-KEM, sntrup761) as a session option ([8df2b24](https://github.com/Hyeongcheol-An/MobAlt/commit/8df2b2405d68345bf1bed6159a8db6382af5b935))

### Bug Fixes

* **i18n:** the round's strings after review — French typography, Spanish and Vietnamese terms, quoting, the cancelled row ([42f7fc7](https://github.com/Hyeongcheol-An/MobAlt/commit/42f7fc7c43a091f584c2c0a679a890eb646409c0))
* **log:** the session log's file-name stamp in local time; test runs log under their user-data folder ([6717416](https://github.com/Hyeongcheol-An/MobAlt/commit/6717416f1d90a58ee0147c259a51b25db413d922))
* **serial:** a vanished device ends the pane as a drop; Send Break; Backspace in the local echo; plain open errors ([0545182](https://github.com/Hyeongcheol-An/MobAlt/commit/0545182da96b95d7a4a8a792f4e5301891d84497))
* **sftp:** a filter box over the list, tooltips led by the name, broken links said so; tunnels worded and counted ([f8b00d3](https://github.com/Hyeongcheol-An/MobAlt/commit/f8b00d343fcb0d2cc0b4dfc342896ef05da4e7e6))
* **sftp:** a Finder drop on a terminal that does not follow the shell uploads where the panel is, or asks ([e0ed7b1](https://github.com/Hyeongcheol-An/MobAlt/commit/e0ed7b1115dd65fa9834e110e801c1c27703f1b9))
* **sftp:** a folder deleted under the panel is announced once and the panel climbs; a reconnect returns to the last folder; a jump hop's failure names the jump host ([3d67d24](https://github.com/Hyeongcheol-An/MobAlt/commit/3d67d243514798adc784fd18dea1384209663324))
* **sftp:** a plain cancel's row stays "cancelled" — the reason is appended only when there is one ([c7fa7d9](https://github.com/Hyeongcheol-An/MobAlt/commit/c7fa7d9b8da97c45443cca230fda949f4de39ab4))
* **sftp:** a session with the SFTP browser off is not listed until asked for ([bea278d](https://github.com/Hyeongcheol-An/MobAlt/commit/bea278d4393e630a841f6670912412494ea91b67))
* **sftp:** a vanished folder is an answer to sftp:list, not a handler fault ([1ea772e](https://github.com/Hyeongcheol-An/MobAlt/commit/1ea772eb7e734fe17f2b65c93c09e75254c308a9))
* **sftp:** an operation in a vanished folder re-lists it; End and type-ahead no longer wait for the whole 20k fill ([9c67c36](https://github.com/Hyeongcheol-An/MobAlt/commit/9c67c364ece8438af53b32261ff4f9acc794487d))
* **sftp:** downloads land in <name>.part and resume from it; a Disconnect marks its transfers cancelled ([d32d7bc](https://github.com/Hyeongcheol-An/MobAlt/commit/d32d7bc6746edf9a6aefec22081fa2f83d60f4ea))
* **sftp:** the panel follows only a change of folder, keeps a listing from being overtaken, lists FTP panes ([075c596](https://github.com/Hyeongcheol-An/MobAlt/commit/075c5966d744bdd7d0e9a5c5d5af4559b7885fd9))
* **ssh:** a cancelled connection attempt is torn down, with a Cancel button in the connecting pane ([c45a76b](https://github.com/Hyeongcheol-An/MobAlt/commit/c45a76b0b43a9e5413c5a05f20c5402104207791))
* **ssh:** an aborted post-quantum exchange drops its secrets at once (dispose) ([566f821](https://github.com/Hyeongcheol-An/MobAlt/commit/566f8210dfd44a4844cbc969d800923b94bbd03d))
* **ssh:** post-quantum review — Mosh host check and companion, wiping, IANA alias, patch guard ([0f7b0df](https://github.com/Hyeongcheol-An/MobAlt/commit/0f7b0df8fd4c95306010bc76fd31c86037330e87))
* **ssh:** the lost-connection toast ends its first sentence before counting the stopped tunnels ([1207bb9](https://github.com/Hyeongcheol-An/MobAlt/commit/1207bb94625d1d4e7422583e4c8e76b505dea9f2))
* **telnet:** the session's username answers the login: prompt ([ee81a81](https://github.com/Hyeongcheol-An/MobAlt/commit/ee81a81be7cfc2b901131cbc970fbb5e8d6f4b89))
* **x11:** a forwarded window closes with its client ([878eabb](https://github.com/Hyeongcheol-An/MobAlt/commit/878eabb33861114fcb9c9ddc5a89ff83778f51c3))

### Performance Improvements

* **main:** load electron-updater, ssh2 and basic-ftp on first use, not at start ([1cbe490](https://github.com/Hyeongcheol-An/MobAlt/commit/1cbe49094e46b00872820bab1cdeb0615b6285c6))
* **renderer:** release the WebGL addon's cursor-blink timer when a pane's renderer goes ([4d73c35](https://github.com/Hyeongcheol-An/MobAlt/commit/4d73c351b2a923f2a5f4b1090ed99161de696520))
* **sftp:** list() keeps 8 READDIR requests in flight — a 20 000-entry listing 1.8 s → 0.3 s; symlinks resolved readlink-first ([536e737](https://github.com/Hyeongcheol-An/MobAlt/commit/536e73747b456b2c6d3c27674dd95dec2614bb33))
* **sftp:** the list renders the first screen now and the rest in frames — a sort click 720 → 25 ms on 20 000 entries ([798d004](https://github.com/Hyeongcheol-An/MobAlt/commit/798d00437ed46f076f85b758baa9335edcaebdbf))
* **ssh:** @noble/post-quantum is loaded by the first ML-KEM key generation, not at startup ([ce1ac7e](https://github.com/Hyeongcheol-An/MobAlt/commit/ce1ac7e19dc61bdd26e442656f0fa99bf955c0db))
* **ssh:** TCP_NODELAY on every SSH socket — sequential SFTP round trip 54 → 7 ms, 20k listing 11.4 → 1.8 s ([d06a4ea](https://github.com/Hyeongcheol-An/MobAlt/commit/d06a4eabb4bdc8d827874a3901ba1792b94e60f5))

## [0.15.2](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.15.1...v0.15.2) (2026-11-01)

### Bug Fixes

* **pane:** a narrow head hides the read-only chip too; a menu a few pixels too tall is not shortened ([9467d06](https://github.com/Hyeongcheol-An/MobAlt/commit/9467d06091fd14a6fa113db10f9588924b37bf79))
* **terminal:** a pane opened into a split is fitted again once the GPU renderer is in ([ff21970](https://github.com/Hyeongcheol-An/MobAlt/commit/ff219703c15cf318cffeac4d04114fa93fb02bd1))

## [0.15.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.15.0...v0.15.1) (2026-11-01)

### Bug Fixes

* **pane:** the ⚙ menu keeps the keyboard in the terminal, toggles, opens upwards, fits a narrow head ([e7a2943](https://github.com/Hyeongcheol-An/MobAlt/commit/e7a29435505ce247cd27f7630b2f601035ecfe7c))
* **x11:** the forwarded display gets this Mac's own cookie ([f38a1f6](https://github.com/Hyeongcheol-An/MobAlt/commit/f38a1f653be54e99619b7832cc51a60d4bddcafd))

## [0.15.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.14.0...v0.15.0) (2026-11-01)

### Features

* **pane:** a ⚙ button in the pane header opens the pane menu ([b5cbf6a](https://github.com/Hyeongcheol-An/MobAlt/commit/b5cbf6af3dc8eb696008daf1086c676516a4b2c8))

## [0.14.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.13.1...v0.14.0) (2026-10-31)

### Features

* **i18n:** Arabic as the eleventh language (right-to-left: <html dir> follows the language) ([97caffc](https://github.com/Hyeongcheol-An/MobAlt/commit/97caffceac237319595c5473d65649a92ea6f259))
* **i18n:** Arabic dictionary and user guide ([b505016](https://github.com/Hyeongcheol-An/MobAlt/commit/b5050165250a59ad826b3a87c5ef5a0885a5141d))
* **i18n:** Arabic in the guides' language bars, the READMEs, the parity docs and the language e2e (direction checks) ([7840531](https://github.com/Hyeongcheol-An/MobAlt/commit/78405313a7dbe9529ffaaaea5592d9554546cf3e))
* **i18n:** French dictionary and user guide ([0a5b9bb](https://github.com/Hyeongcheol-An/MobAlt/commit/0a5b9bb5bfb4d6de53d27018b83db5e52d34e832))
* **i18n:** German dictionary and user guide ([f0c10d0](https://github.com/Hyeongcheol-An/MobAlt/commit/f0c10d0490fe3827afbb9bcfa5bcfde33942d49b))
* **i18n:** Hindi dictionary and user guide ([279a008](https://github.com/Hyeongcheol-An/MobAlt/commit/279a0081cbedf5ec05d474818a8c7750f151c2c3))
* **i18n:** interface language setting — t()/tn() lookup, Settings → General → Language, string catalog and dictionary checks ([a22467a](https://github.com/Hyeongcheol-An/MobAlt/commit/a22467abe83c426ff11ffcb9c4f7b72472a3dc7a))
* **i18n:** Japanese dictionary and user guide ([d6e5718](https://github.com/Hyeongcheol-An/MobAlt/commit/d6e5718b07f600b2579ef53360c5a373d951e8f7))
* **i18n:** Korean dictionary and user guide ([4fd83c0](https://github.com/Hyeongcheol-An/MobAlt/commit/4fd83c03354c319b254f0ee4a0c11881eb5f9e5a))
* **i18n:** Portuguese dictionary and user guide ([81d0dcf](https://github.com/Hyeongcheol-An/MobAlt/commit/81d0dcffb07958ce8a1910a70e776b2f6916c246))
* **i18n:** session editor, tunnel and highlight-rule dialogs through t(); Browse… for a local session's start folder ([e514833](https://github.com/Hyeongcheol-An/MobAlt/commit/e514833b7414c1097a011afd82c5e5e662421f3a))
* **i18n:** sidebar, SFTP, Tools and Macros panels — data-i18n hooks in index.html, t()/tn() in sidebar/sftp/panels, live re-render on i18n:changed ([b683b40](https://github.com/Hyeongcheol-An/MobAlt/commit/b683b4073ee8e84514f1986e7184544c2f89e67e))
* **i18n:** Simplified Chinese dictionary and user guide ([1b2c258](https://github.com/Hyeongcheol-An/MobAlt/commit/1b2c25857b7e7253cbe188054e0df21e5cf03bc9))
* **i18n:** Spanish dictionary and user guide ([9aa7f51](https://github.com/Hyeongcheol-An/MobAlt/commit/9aa7f5180760b4103913b9f8a6698453509b32ce))
* **i18n:** terminal pane, paste guard and keyword highlighting strings through t()/tn() ([4120a39](https://github.com/Hyeongcheol-An/MobAlt/commit/4120a39446aa453515f8439db0ad6c3759a886e3))
* **i18n:** Vietnamese dictionary and user guide ([07bc556](https://github.com/Hyeongcheol-An/MobAlt/commit/07bc556d41c271c7ef6a7b96b125344b411399bd))
* **i18n:** wrap app.js / ui.js / layout.js / monitor.js / nettools.js strings, live re-render of the status bar, banners and tab strip ([f460db9](https://github.com/Hyeongcheol-An/MobAlt/commit/f460db9254291941c36e51d0c88bfb4dc7676323))
* **i18n:** wrap the main process's user-visible strings in t()/tn() ([6ec4292](https://github.com/Hyeongcheol-An/MobAlt/commit/6ec4292968237f5e89c8aafdcec30c9571102ea1))
* **i18n:** wrap the Settings, host-key, password, paste-guard, shortcuts and key-generator dialogs ([09cbd5b](https://github.com/Hyeongcheol-An/MobAlt/commit/09cbd5bef0281b35122a4756a5be97c2ca786055))
* **layout:** unsplit mode — the other panes become tabs of their own, close, or ask ([ef1b57e](https://github.com/Hyeongcheol-An/MobAlt/commit/ef1b57ea29fa96f81d43f61596796b3268164ae9))
* **multiexec:** exclude individual panes — MobaXterm's per-terminal checkbox, bulk menu ([1be6679](https://github.com/Hyeongcheol-An/MobAlt/commit/1be66790cae70af603c7b0efdf9134ec0e94c1ab))
* **pane:** pane menu — Rename Pane, Pane Settings, Background Label, Font Size, Read-Only ([dd24927](https://github.com/Hyeongcheol-An/MobAlt/commit/dd24927c5a06b9d18e1b81b2a7bb06953b194c2a))
* **terminal:** Shift+Enter newline and image paste for Claude Code — keypress fix, Ctrl+V for a clipboard image ([c612002](https://github.com/Hyeongcheol-An/MobAlt/commit/c6120028c288ac54444c2272c4f7bd3a5944b8c4))
* **ui:** right-to-left layout for Arabic — mirrored chrome, LTR islands, physical splits ([d03674d](https://github.com/Hyeongcheol-An/MobAlt/commit/d03674dd91d95465a563b832ad0be525ba0e9727))

### Bug Fixes

* **i18n:** Arabic — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([1fd284e](https://github.com/Hyeongcheol-An/MobAlt/commit/1fd284ec06370bf0b491c4c3b1aa67b9bf1b68bf))
* **i18n:** Deutsch — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([63068a7](https://github.com/Hyeongcheol-An/MobAlt/commit/63068a70120036d06f14fdf63b6ac6818c797057))
* **i18n:** French — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([eabbd0c](https://github.com/Hyeongcheol-An/MobAlt/commit/eabbd0c075de6cc3e2ec0f6ed09c5d46f82125f4))
* **i18n:** French review — macOS menu terms, plural agreement, Zmodem/tunnel messages, guide sync ([94241d8](https://github.com/Hyeongcheol-An/MobAlt/commit/94241d8aac9048e98b4a1dbc290ad259f90e3f1e))
* **i18n:** German review — macOS menu terms, plural forms, banner button, guide sync ([e6b72c6](https://github.com/Hyeongcheol-An/MobAlt/commit/e6b72c630569358f993ce2f6810a22bb16021022))
* **i18n:** Hindi — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([21f66e3](https://github.com/Hyeongcheol-An/MobAlt/commit/21f66e3fb363bb8d408ae3d33292446d77771297))
* **i18n:** Hindi review — macOS menu terms, Quit/View/Edit wording, guide fixes ([f7b9c63](https://github.com/Hyeongcheol-An/MobAlt/commit/f7b9c63cc37dd52ebe3f7260cff877549983b904))
* **i18n:** Japanese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([d0db528](https://github.com/Hyeongcheol-An/MobAlt/commit/d0db528d74755ca024c9b884995ed10dcef76276))
* **i18n:** Japanese review — macOS menu terms, error wording, guide sync ([07a5d4c](https://github.com/Hyeongcheol-An/MobAlt/commit/07a5d4c29f097c5bf0dbcfd1a5095d24a5e2621c))
* **i18n:** Korean — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([215048b](https://github.com/Hyeongcheol-An/MobAlt/commit/215048b149f485aaec722e6081773c977964b140))
* **i18n:** Korean review — macOS menu terms, scan/record terminology, guide sync ([afb845c](https://github.com/Hyeongcheol-An/MobAlt/commit/afb845c2d8682e6584a03407f79717163c1ed3df))
* **i18n:** MOBALT_LANG stands in for the Mac's language list (and the saved setting at startup) — a language chosen in Settings still applies while running ([3b5583c](https://github.com/Hyeongcheol-An/MobAlt/commit/3b5583cce00b7e444c04cd3956e3a733f6460dfc))
* **i18n:** Portuguese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([e8eefd3](https://github.com/Hyeongcheol-An/MobAlt/commit/e8eefd3d961729896cefa24ad7f31c58e7919bd4))
* **i18n:** Portuguese review — macOS menu terms, pt-BR wording, guide language list ([18fe674](https://github.com/Hyeongcheol-An/MobAlt/commit/18fe6744053b6f2078c2b42e1b3e3d93995486cc))
* **i18n:** Simplified Chinese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([315e5f9](https://github.com/Hyeongcheol-An/MobAlt/commit/315e5f9892ae708d68be33f762bb1905361e56f9))
* **i18n:** Simplified Chinese review — macOS menu terms, error wording, guide sync ([1ed5263](https://github.com/Hyeongcheol-An/MobAlt/commit/1ed5263b72ba16aac0126ea30cd8c52ec10c17e1))
* **i18n:** Spanish — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([1cc1942](https://github.com/Hyeongcheol-An/MobAlt/commit/1cc194292177a063995904da50e46fbb8115a61c))
* **i18n:** Spanish review — macOS menu terms, plural agreement, side-strip label, guide sync ([63bfd41](https://github.com/Hyeongcheol-An/MobAlt/commit/63bfd418e7c9d1fa8faca7ad6b15aa290cc0dc0f))
* **i18n:** the relaunch banner is one sentence key (no stray space before the kept part), its buttons never wrap; 'Zoom text' and 'Enabled' keys no longer share the Window menu's Zoom and the On toggle ([eac3025](https://github.com/Hyeongcheol-An/MobAlt/commit/eac3025629d67e9ede2db2476488aec276c81890))
* **i18n:** the status bar names an empty pane in the interface language; Korean guide: the right-to-left paragraph ([8d11874](https://github.com/Hyeongcheol-An/MobAlt/commit/8d11874e8ec8999e1327b95a80b6fd99011e6adf))
* **i18n:** translated labels for the role menu items and the Window / Help menus; Local and Serial type labels follow the language; a tn() form may omit a placeholder only one English form has ([4182dc8](https://github.com/Hyeongcheol-An/MobAlt/commit/4182dc87bdb544c1ba6369077c47ad51d3db2dce))
* **i18n:** Vietnamese — strings for the pane menu, MultiExec exclusion, background label, Claude Code keys ([f504133](https://github.com/Hyeongcheol-An/MobAlt/commit/f5041339cfe6fa447cb0e7565ddafdc7a31f6c73))
* **i18n:** Vietnamese review — macOS menu terms, View → Xem, guide language list ([09befa4](https://github.com/Hyeongcheol-An/MobAlt/commit/09befa4eaf45357d1723110973699ae88c652eda))
* **i18n:** whole-sentence quit / relaunch questions, the tunnel-failure plural follows the failed count, a translatable list joiner; i18n-shots flags wrapped buttons and opens the real pane menu ([fb99f48](https://github.com/Hyeongcheol-An/MobAlt/commit/fb99f4878d82db8d503fbf87afbdeef4fb7f8cab))
* **test:** e2e-qa-fixes — restore the expression a trailing comment had swallowed ([0577c64](https://github.com/Hyeongcheol-An/MobAlt/commit/0577c6456fa856b9170e03a308d924321857267e))
* **ui:** CJK side-strip labels stand upright instead of upside down ([ff46283](https://github.com/Hyeongcheol-An/MobAlt/commit/ff462838319ce90b7a2fafbd05fefc739af6602a))
* **ui:** the Pane Settings dialog uses the wide width and the theme preview shrinks before the row overflows; i18n-shots covers the MultiExec menu, the pane menu in MultiExec and Pane Settings; the dictionary checks are strict by default ([612ecfe](https://github.com/Hyeongcheol-An/MobAlt/commit/612ecfed278bceafa3adc7ae745239a2b0d9eb0d))

## [0.13.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.13.0...v0.13.1) (2026-10-31)

### Bug Fixes

* **ssh:** stop probing every DH group at startup — the app froze for ~35 s before its window appeared ([bcfe5f4](https://github.com/Hyeongcheol-An/MobAlt/commit/bcfe5f44707412eeea4f9875e918013bbb6c7a06))

## [0.13.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.12.0...v0.13.0) (2026-10-31)

### Features

* **settings:** a Features tab for the paste guard, monitoring bar and keyword highlighting ([f049bdf](https://github.com/Hyeongcheol-An/MobAlt/commit/f049bdf42a8495b1b503ddf59f424ed06277f9eb))
* **ssh:** expert algorithm settings ([73b532a](https://github.com/Hyeongcheol-An/MobAlt/commit/73b532a486b0fdaa5f60d259c6b56450c4396b2a))
* **ssh:** key generator ([e3acfcb](https://github.com/Hyeongcheol-An/MobAlt/commit/e3acfcb5dc8afa44aaaf9ad0ac59cdc9ac79a758))
* **ssh:** remote monitoring bar ([1ec2958](https://github.com/Hyeongcheol-An/MobAlt/commit/1ec29583738abb52771290d72e18e9fece73dfc2))
* **tabs:** detach a tab to its own window ([7fd5f76](https://github.com/Hyeongcheol-An/MobAlt/commit/7fd5f760007deb522aa1548d30c1687fdc0a706d))
* **tabs:** pin and close-left/right ([beb2b2b](https://github.com/Hyeongcheol-An/MobAlt/commit/beb2b2bbc4f90bdb2ee683ef5b9fee1af46c19aa))
* **terminal:** keyword highlighting ([12ad503](https://github.com/Hyeongcheol-An/MobAlt/commit/12ad50392a7a7608b70bd1cdff171dd59b93db8f))
* **terminal:** paste guard — confirm multi-line pastes, flag suspicious content ([e8f7137](https://github.com/Hyeongcheol-An/MobAlt/commit/e8f7137fbd583fe474c716564cb3db29a885fd81))
* **terminal:** zmodem rz/sz transfers ([14d4927](https://github.com/Hyeongcheol-An/MobAlt/commit/14d4927ef2719564d310c20be107795138ca53f3))
* **tools:** Wake-on-LAN and network scanner ([21e9455](https://github.com/Hyeongcheol-An/MobAlt/commit/21e9455c477405dc135b2abc57bfe6afc9e5b6c2))

### Bug Fixes

* **keygen:** lock the dialog while it installs, say "folder" and "~user" plainly, refuse ~user remote files ([30aa5a8](https://github.com/Hyeongcheol-An/MobAlt/commit/30aa5a86f12cb5faa48d63aead412cefebbd722b))
* **monitor:** fold the strip to the pane's width and mark a stale sample ([1640db5](https://github.com/Hyeongcheol-An/MobAlt/commit/1640db5cb704a510efb6084d3797191b8ce71e4e))
* **session:** a Mosh session keeps and applies its Advanced SSH algorithm settings ([7d5bb9b](https://github.com/Hyeongcheol-An/MobAlt/commit/7d5bb9b62df9ccc425cd3023fcd3dcb8533bcb3a))
* **ssh:** legacy preset without the 1024-bit DH group, one host-key prompt per host, readable DH error ([fbb526d](https://github.com/Hyeongcheol-An/MobAlt/commit/fbb526defdf7fe784ae0b890dec4c391acd85b47))
* **tabs:** pinned tab keeps focus, Session menu items grey out, detached windows close and cascade ([e40c646](https://github.com/Hyeongcheol-An/MobAlt/commit/e40c6462aa15bee99bdfc95423af803220ac8984))
* **terminal:** drain the Zmodem stream after an abort, notice a dead peer in seconds, keep replays and logs clean ([e0d6d51](https://github.com/Hyeongcheol-An/MobAlt/commit/e0d6d515a2b3ded83d8e3dc674cfd593434d7741))
* **terminal:** keep keyword decorations off the alternate screen, notice rows rewritten in place ([7104e16](https://github.com/Hyeongcheol-An/MobAlt/commit/7104e16e4f3d9231401a6a5a0c2f93e630e7352a))
* **terminal:** no stray byte reaches the pane after a dead Zmodem peer ([a97adf1](https://github.com/Hyeongcheol-An/MobAlt/commit/a97adf1ba3525e7ef5626044537c6339d641cde2))
* **terminal:** paste guard edges, a fluid preview, readable marks; one Zmodem checkbox ([5156298](https://github.com/Hyeongcheol-An/MobAlt/commit/5156298533e103cd844f27617b1c98f1b5b9124e))
* **terminal:** webgl budget — a GPU context only for the panes on screen ([68c4633](https://github.com/Hyeongcheol-An/MobAlt/commit/68c4633a7f5db58c8361967905cb6b7c7d5bc17a))
* **theme:** readable monitor meters, detached marker, scan ＋ hover, a ring on the rDNS box ([958608e](https://github.com/Hyeongcheol-An/MobAlt/commit/958608ebe226cc823ee8f7579248ba5ea00937d0))
* **tools:** keep the scanner's Workers and Timeout fields on their own rows in a narrow sidebar ([a1e7f37](https://github.com/Hyeongcheol-An/MobAlt/commit/a1e7f377a09ea0eb34c30ad3d7960e48cba0c7e8))
* **tools:** one scan at a time, dual-stack targets, port prefill, Ports sort, narrow and short layouts, WoL polish ([ff9003f](https://github.com/Hyeongcheol-An/MobAlt/commit/ff9003f9c5202970016f0dabbeff28e5adb89db0))

## [0.12.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.11.0...v0.12.0) (2026-10-31)

### Features

* **layout:** zoom a pane to fill its tab ([a187126](https://github.com/Hyeongcheol-An/MobAlt/commit/a18712699a6d841cf017212923227af78d59e4b6))
* **theme:** apply the selected theme to the whole app ([5dca6e6](https://github.com/Hyeongcheol-An/MobAlt/commit/5dca6e6169b3b549a39211728dec0d2ffd612da6))
* **ui:** settings in tabs that fit the minimum window; compact shortcuts dialog ([6dcdf11](https://github.com/Hyeongcheol-An/MobAlt/commit/6dcdf11a921d9abd8aa916ba8533562a77796ff5))

### Bug Fixes

* **a11y:** keep the pane zoom button's name constant, aria-pressed carries the state ([7b333d7](https://github.com/Hyeongcheol-An/MobAlt/commit/7b333d7d6d3fc37aa5ffecbb6728882536de6c86))
* **a11y:** name every form control, focus cues on find/tools boxes, editor tab roles, live toasts ([894a0af](https://github.com/Hyeongcheol-An/MobAlt/commit/894a0af2a7bd70e2b6feccbb0ab011c1db125e62))
* **sessions:** readable export errors, BOM/UTF-16 JSON, honest import counts, MobaXterm validation ([4f7e04e](https://github.com/Hyeongcheol-An/MobAlt/commit/4f7e04e97ba13a54c5e34e19c5bc693f2f193716))
* **sessions:** validate imported JSON, strip exporter flags, dedup MobaXterm re-imports ([e8e99fb](https://github.com/Hyeongcheol-An/MobAlt/commit/e8e99fbf40f42dd8e7ada86b0af16831dee863fa))
* **settings:** give macOptionIsMeta a stored default ([2c23d08](https://github.com/Hyeongcheol-An/MobAlt/commit/2c23d08459f15839c425c00b806c7d9ad229811b))
* **settings:** hold the dialog at the height of its tallest section ([58d3898](https://github.com/Hyeongcheol-An/MobAlt/commit/58d3898d52919485203ed1b78258e0231d8d7e22))
* **theme:** contrast and consistency fixes from the theme and keyboard QA ([6fc2a2a](https://github.com/Hyeongcheol-An/MobAlt/commit/6fc2a2a6f17f25ff5f2bfec3c28665238885b6b7))
* **theme:** paint the first frame in the saved theme ([9a8ce5f](https://github.com/Hyeongcheol-An/MobAlt/commit/9a8ce5f73dfa1ee0708d949b0b450f3cd1dd0657))
* **tools:** drop a stopped tool's late output when another tool starts ([a0dcb5d](https://github.com/Hyeongcheol-An/MobAlt/commit/a0dcb5d6de9f28563b0768db15d26f37269c5cae))
* **ui:** real plurals in toasts and a quit label that names every connection kind ([4a5659a](https://github.com/Hyeongcheol-An/MobAlt/commit/4a5659a04d0424746ac5b5b6a2eed33b1d4ebc37))

## [0.11.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.10.1...v0.11.0) (2026-10-31)

### Features

* **a11y:** per-row focus and type-ahead in the SFTP list and session tree ([4b93e9b](https://github.com/Hyeongcheol-An/MobAlt/commit/4b93e9bc20c052235fc752d691fcabf084c62310))
* **brand:** design the app icon and DMG background as SVG sources ([46e1a02](https://github.com/Hyeongcheol-An/MobAlt/commit/46e1a02f49cc8abc4bd513baa20ff66b9d32fe75))
* **multiexec:** broadcast only to the terminals visible in the active tab ([6ff8151](https://github.com/Hyeongcheol-An/MobAlt/commit/6ff815139cc4c47f8090f27ab99b2a3fcb5e405c))
* **update:** notice a newer MobAlt.app on disk and offer a relaunch ([c0a9ed3](https://github.com/Hyeongcheol-An/MobAlt/commit/c0a9ed3aee886517437eff885cfc1c44e6efcf57))

### Bug Fixes

* **a11y:** keyboard follow-ups in the SFTP list, session tree, panels and Shortcuts dialog ([156af50](https://github.com/Hyeongcheol-An/MobAlt/commit/156af50efcefff2b504d77c0e08a1bb4e44f3167))
* **brand:** give the DMG labels a mid-tone band readable in light and dark Finder ([626e639](https://github.com/Hyeongcheol-An/MobAlt/commit/626e639cf5216c00309526b8c5b198a13f845955))
* **build:** use the personal bundle id io.github.hyeongcheol-an.mobalt
* **repo:** drop the node_modules symlink that slipped into v0.10.1 and ignore symlinked node_modules too ([0e16072](https://github.com/Hyeongcheol-An/MobAlt/commit/0e16072203d14fde303e100c9c586ff0cf72e16a))
* **ssh:** announce a connection the server dropped ([9ea4a5e](https://github.com/Hyeongcheol-An/MobAlt/commit/9ea4a5e267dc3a4412fee0968e0df52bb593f6af))
* **test:** drop the committed test/sshd-runtime symlink and ignore it as a link too ([db8a942](https://github.com/Hyeongcheol-An/MobAlt/commit/db8a9422d745640b3ed5b792800b1d58fcb9aa1c))
* **ui:** keep the all-tabs menu inside the window and clip long dialog titles ([6c7e30f](https://github.com/Hyeongcheol-An/MobAlt/commit/6c7e30f4cc82eeb2f92979df1f57b2dbda863b4b))
* **ui:** light-theme find matches and FTP card contrast, unbreakable update call to action ([0910545](https://github.com/Hyeongcheol-An/MobAlt/commit/09105450a00d5274e0bed8ef0949344b0dff4cd1))
* **ui:** name a tab after its session while other panes are used ([2d5b59a](https://github.com/Hyeongcheol-An/MobAlt/commit/2d5b59a6c4d40c6ba7eebf8b3f6ec22816e6fef9))
* **ui:** toasts clear the find bar, long notices wrap, cards sit below the pane head ([a814719](https://github.com/Hyeongcheol-An/MobAlt/commit/a814719810e7f92a448afb450c677723e460b698))
* **update:** quiet "Check now" in Settings; the relaunch question says Relaunch ([d7c6ccf](https://github.com/Hyeongcheol-An/MobAlt/commit/d7c6ccf9c885e9cee42737f1e5bde6a55bda8c51))
* **update:** relaunch through LaunchServices and surface main-process notices ([7ceaa90](https://github.com/Hyeongcheol-An/MobAlt/commit/7ceaa90694613071a227ad33ea9cb94d0c0d58d2))

## [0.10.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.10.0...v0.10.1) (2026-10-30)

### Bug Fixes

* **a11y:** dialogs hand focus back to their opener; one Tab stop per picker ([2bd5540](https://github.com/Hyeongcheol-An/MobAlt/commit/2bd55408fe31567942b01d2ff9eadf61321b7f9c))
* **a11y:** keyboard follow-ups in the session tree, macros list and SFTP list ([6d373bd](https://github.com/Hyeongcheol-An/MobAlt/commit/6d373bd3a4c3c75ee06acd8311cf819a4eff1fbb))
* **a11y:** tab strip never drops keyboard focus on <body> ([5e41e9d](https://github.com/Hyeongcheol-An/MobAlt/commit/5e41e9dfa9b6e203e336082fc4f73b1575343bfe))
* **a11y:** unclipped focus rings for the toolbar, tab bar arrows, SFTP list and pickers ([ed21b12](https://github.com/Hyeongcheol-An/MobAlt/commit/ed21b12cce2de8472e12239930d0c5ef2b6a6f86))
* **app:** quit confirmation for ⌘Q counts every live connection ([be99f80](https://github.com/Hyeongcheol-An/MobAlt/commit/be99f8012fead1cb2356e81c1e1217b8711e4605))
* **ftp:** disconnect on close, readable errors, password prompt, safe rename and cancel ([fffcc0b](https://github.com/Hyeongcheol-An/MobAlt/commit/fffcc0bcfa7e0b5b4c721bf046f2644bb5cdc9c3))
* **mosh:** verify the host key in the app before the bootstrap; failures read as failed ([0653b47](https://github.com/Hyeongcheol-An/MobAlt/commit/0653b476f1b640aa81bbd15e07746eccb2a5adeb))
* **ssh:** only a retry of the passphrase prompt says "Incorrect passphrase" ([d27b00f](https://github.com/Hyeongcheol-An/MobAlt/commit/d27b00f14d1760aeb49978897c16ad96ac551562))
* **ui:** regression-sweep follow-ups — editor rows survive type changes, tunnel edits mark it dirty, find bar tolerates bad patterns ([e07940a](https://github.com/Hyeongcheol-An/MobAlt/commit/e07940a58e7da67c5de0f24a4253a2a583a0a61c))
* **ui:** visual QA follow-ups — plain logs mirror the terminal line, toasts clear the find bar, last glyph icons replaced ([03023b2](https://github.com/Hyeongcheol-An/MobAlt/commit/03023b2ac399c9ac63accc8e42f4577934a7d1be))

## [0.10.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.9.1...v0.10.0) (2026-10-30)

### Features

* **a11y:** keyboard access for tabs, session tree, context menus, dialogs and toolbar ([c2211bb](https://github.com/Hyeongcheol-An/MobAlt/commit/c2211bb6002341757d662bb4b0021c7ef2dd0f4e))
* **logging:** optional plain-text session logs (logPlainText) ([8099d91](https://github.com/Hyeongcheol-An/MobAlt/commit/8099d918ab88554248b2e23864510f9e792f7565))
* **mosh:** SFTP browser through a companion SSH connection ([1096113](https://github.com/Hyeongcheol-An/MobAlt/commit/10961137cf7c96e8deae18936d2ff03ffe2d260d))
* **tabs:** overflow arrows, edge fades and an "all tabs" menu for the tab strip ([1b51127](https://github.com/Hyeongcheol-An/MobAlt/commit/1b51127400aeb94c33858ef8aade4efa60f226bf))

### Bug Fixes

* **ssh:** follow-cwd hook keeps the login banner in scrollback (clear -x) ([c649a49](https://github.com/Hyeongcheol-An/MobAlt/commit/c649a4955e0345b37cb188e4f7a5c697081da9a0))
* **theme:** panes keep their palette across split, grid, unsplit, move and WebGL fallback ([d179e3f](https://github.com/Hyeongcheol-An/MobAlt/commit/d179e3f194cd7d1170acc87a884923315f52fb77))
* **ui:** DNS lookup names missing records; FTP panel hides "Follow terminal folder" ([541bf09](https://github.com/Hyeongcheol-An/MobAlt/commit/541bf09d3d79f9125bff72c3c729480a136691d4))

## [0.9.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.9.0...v0.9.1) (2026-10-30)

### Bug Fixes

* hide the unused terminal cursor behind the FTP pane info ([2c37620](https://github.com/Hyeongcheol-An/MobAlt/commit/2c37620539b128a1331cb496dbbfc3c96cfee456))

## [0.9.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.8.1...v0.9.0) (2026-10-30)

### Features

* auto-update, Mosh and FTP/FTPS sessions ([6820c88](https://github.com/Hyeongcheol-An/MobAlt/commit/6820c88fa4382887f71985be89a095c92f3c780e))

### Bug Fixes

* QA pass across dialogs, sidebar, terminal, SFTP, tools and tunnels ([023801f](https://github.com/Hyeongcheol-An/MobAlt/commit/023801fa4e1b26146f0582e430d97b4bfba9381f))

## [0.8.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.8.0...v0.8.1) (2026-10-30)

### Bug Fixes

* install:local waits for MobAlt to quit instead of replacing a running app ([d9d0399](https://github.com/Hyeongcheol-An/MobAlt/commit/d9d0399532a203dfbc7d281f4e2259fc7b657e6e))

## [0.8.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.7.0...v0.8.0) (2026-10-30)

### Features

* open-source release pipeline: code signing, notarization, Homebrew cask, new README ([046dfb7](https://github.com/Hyeongcheol-An/MobAlt/commit/046dfb7a21aee4cf8be68c34dba3a81fc61474f5))

### Bug Fixes

* unit tests no longer need the Electron binary ([ef2c224](https://github.com/Hyeongcheol-An/MobAlt/commit/ef2c2242b95511e1f851a87a7c41412f14512263))

## [0.7.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.6.1...v0.7.0) (2026-10-30)

### Features

* startup commands and custom shell for local, telnet and serial sessions ([b389d5f](https://github.com/Hyeongcheol-An/MobAlt/commit/b389d5fb0e4ddbae039a5aef4a7bbd9d72b540b5))

## [0.6.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.6.0...v0.6.1) (2026-10-30)

### Bug Fixes

* session editor icon/colour pickers and serial port list rendered as "[object HTMLButtonElement]" ([a793d96](https://github.com/Hyeongcheol-An/MobAlt/commit/a793d96de10d0c8a759d1bfa0568e1bd708a6324))

## [0.6.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.5.0...v0.6.0) (2026-10-30)

### Features

* workspace restore, per-session icons/colours, folder drag-move ([c2a86fc](https://github.com/Hyeongcheol-An/MobAlt/commit/c2a86fcb194ac1dd068f1ecb7488b76468299348))

## [0.5.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.4.1...v0.5.0) (2026-10-30)

### Features

* Shift+Enter sends ESC+CR for newline in TUIs (Claude Code) ([2fe2b07](https://github.com/Hyeongcheol-An/MobAlt/commit/2fe2b0762532ad7414ee166e57da83ea86384c1e))

## [0.4.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.4.0...v0.4.1) (2026-10-30)

### Bug Fixes

* session/tab drag onto panes never dropped (effectAllowed mismatch) ([5ea3f04](https://github.com/Hyeongcheol-An/MobAlt/commit/5ea3f04a7d622ee4289d8d732382ef39da1ab370))

## [0.4.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.3.0...v0.4.0) (2026-10-30)

### Features

* grid layouts up to 2×4 (8 panes), Split menu and open-folder-in-grid ([4e0c9f2](https://github.com/Hyeongcheol-An/MobAlt/commit/4e0c9f28a67869903927fecd958f4e73596bca12))

## [0.3.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.3...v0.3.0) (2026-10-30)

### Features

* drag sessions and tabs into split panes ([4438c95](https://github.com/Hyeongcheol-An/MobAlt/commit/4438c954e9d82a5bcd1e760b3a6fd36f6f268f2d))

## [0.2.3](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.2...v0.2.3) (2026-10-30)

### Bug Fixes

* **ssh:** do not burn auth attempts on agent keys when a password is saved ([4fcffd0](https://github.com/Hyeongcheol-An/MobAlt/commit/4fcffd0e13f5997a86b04209a6c019692c9d3f67))
* **ssh:** try default ~/.ssh identity files like the ssh CLI ([ae1fb60](https://github.com/Hyeongcheol-An/MobAlt/commit/ae1fb606fcff31b1d51ab5e3ddca5854f83e5eb1))

## [0.2.2](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.1...v0.2.2) (2026-10-30)

### Bug Fixes

* **ssh:** explain handshake timeouts with a reachability hint ([8144d52](https://github.com/Hyeongcheol-An/MobAlt/commit/8144d5285a10ff8000b7289193d670f7a9d702ef))

## [0.2.1](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.2.0...v0.2.1) (2026-10-30)

### Bug Fixes

* **build:** flip Electron fuses so the packaged app ignores ELECTRON_RUN_AS_NODE ([6221222](https://github.com/Hyeongcheol-An/MobAlt/commit/6221222576e0efbc3f10c1e5f267fcf69dda260e))

## [0.2.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.1.0...v0.2.0) (2026-10-30)

### Features

* serial console sessions and async Keychain secret storage ([d012301](https://github.com/Hyeongcheol-An/MobAlt/commit/d0123019bddfd608fe5027cd61b66467db9d9880))

### Bug Fixes

* **ssh:** robust auth method selection and clear failure diagnostics ([e9fb17c](https://github.com/Hyeongcheol-An/MobAlt/commit/e9fb17cad0e8a7403de93f6ef96eddf6b393f3a1))

## [0.1.0](https://github.com/Hyeongcheol-An/MobAlt/compare/v0.0.0...v0.1.0) (2026-10-30)

### Features

* session manager with folders, importers and encrypted secrets ([89d63fd](https://github.com/Hyeongcheol-An/MobAlt/commit/89d63fd6e7f99869dfe7abb341dce59732e6a85f))
* SFTP browser with transfers, remote editing and folder following ([4baaa13](https://github.com/Hyeongcheol-An/MobAlt/commit/4baaa13f1a30d6e1c71c06184b8c84c55c5f25a8))
* SSH tunnels, X11 forwarding, MultiExec, macros and network tools ([4357e26](https://github.com/Hyeongcheol-An/MobAlt/commit/4357e2643685022f5b7eb05447678a7c78993190))
* tabbed terminal with local shell, SSH, telnet and split panes ([7f4fbf9](https://github.com/Hyeongcheol-An/MobAlt/commit/7f4fbf9b2f82f27d4a105b1daf8cfd6f2f851f13))

### Bug Fixes

* stray "null" in session editor and session tree overflow ([f5421e3](https://github.com/Hyeongcheol-An/MobAlt/commit/f5421e3011e1479f8bd8e3f78bad6e22fe6fd542))
