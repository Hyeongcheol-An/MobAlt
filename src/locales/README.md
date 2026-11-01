# Interface languages

MobAlt's interface is in eleven languages — Settings → General → Language; *System default* follows the Mac's
language list: English, 한국어, 简体中文, 日本語, Tiếng Việt, हिन्दी, Deutsch, Français, Español, Português and
العربية (right to left, the window mirrored). English is the source: every string in the code is written in English
and is the key the dictionaries translate, gettext style, with no identifiers in between.

| What | Where |
|---|---|
| The lookup (`t`, `tn`, placeholders, plural forms), the language list, `MOBALT_LANG` | `src/main/i18n.js` (main process, header comment), `src/renderer/i18n.js` (windows, `data-i18n` hooks, live switch) |
| The catalog: every source string, the files that use it, the plural form of a `tn()` pair | `src/locales/catalog.json` — written by `npm run i18n`, never edited by hand |
| One dictionary per language | `src/locales/<code>.json` |
| One user guide per language | `docs/USER_GUIDE.<code>.md` (English `docs/USER_GUIDE.md`), its pictures in `docs/images/<code>/` |
| The checks | `test/unit/i18n.test.js` (in `npm test` and CI), `scripts/i18n-status.js` (`npm run i18n:status`) |
| Every view in one language, with an overflow report | `test/qa/i18n-shots.js` |

## Adding or changing interface strings — the procedure

A change that adds, removes or rewords a string the user sees brings all eleven dictionaries along before it merges.
`npm test` is strict about it — a branch with an untranslated string fails the unit tests, locally and in CI — so the
order on a feature branch is **feature → `npm run i18n` → delta translation, every language → `npm test` → merge**.

1. **Write the string in English, through `t()`**: `t('Close Tab')`, `t('Connected to {host}', { host })`,
   `tn('{n} tab', '{n} tabs', n)`; in `index.html`, `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` /
   `data-i18n-aria-label` on the element. The first argument is a literal (a template without `${}` or a `?:` of
   literals will do): the extractor reads it and reports `t(variable)`. Never build a label table while a module
   loads — it would stay in the language of that moment — call `t()` where the label is rendered, and give a component
   that keeps rendered labels an `onChange()` handler that renders them again (`src/renderer/i18n.js`). Messages of
   the main process use `src/main/i18n.js` the same way. A sentence is one string (`'{n} connection is still open.
   Quit anyway?'`), never glued from fragments: word order differs between languages.
2. **`npm run i18n`** rewrites the catalog; commit it with the change (`npm run i18n -- --check` says whether it is
   current, the unit test checks the same).
3. **`npm run i18n:status -- --list`** prints what every language now owes: `missing` (new strings), `stale`
   (strings that no longer exist — delete them, carrying their wording over to the reworded key) and whatever else
   the checks find. Each language that is not `ok` needs its delta translated.
4. **Translate**, in every `src/locales/<code>.json`, by the dictionary rules below and the file's own `@glossary`,
   `@keep` and `@notes`: the same words as the rest of the file. One translator, or one agent, per language works
   well (the brief at the end of this file); nothing but that file and the language's guide is touched.
5. **See it**: `MOBALT_LANG=<code> test/qa/run.sh test/qa/i18n-shots.js /tmp/i18n-<code> 180000` writes every view
   in that language to `/tmp/i18n-<code>/shots/` and logs an `OVERFLOW` line for a label that is clipped, wider than
   its box or wrapped onto a second line. Shorten until there is none.
6. **The guide**: a change the user can see gets its paragraph in `docs/USER_GUIDE.md` and the same paragraph, in
   the same place, in every `docs/USER_GUIDE.<code>.md`, with the labels as the dictionary now has them.
   `npm run docs:shots` renews the pictures in every language when the screens changed.
7. **`npm test`** passes. `I18N_STRICT=0` relaxes the dictionary checks only while a new language is being written.

## The dictionary

```json
{
  "@language": "Deutsch",
  "@glossary": { "session": "Sitzung", "tab": "Tab", "pane": "Bereich", "split": "teilen" },
  "@keep": ["Ping + TCP", "Traceroute"],
  "@notes": "Sie-Form; Apples Begriffe (Einstellungen, Tab schließen).",
  "Close Tab": "Tab schließen",
  "Connected to {host}": "Verbunden mit {host}",
  "{n} session": ["{n} Sitzung", "{n} Sitzungen"]
}
```

- One entry per key of the catalog, the key copied **byte for byte** (punctuation, …, spaces, case). A missing key,
  a stale key and an empty value fail the test.
- Placeholders `{name}` stay exactly as in the key — same names, each one present; they may be reordered. A `tn()`
  pair may leave out a placeholder that only the other English form has (`{what}: {why}` vs `{what} ×{n}: {why}`).
- A key with a `plural` field in the catalog is a `tn()` pair: **either** one string (a language without a
  grammatical plural — Korean, Japanese, Chinese, Vietnamese: `"세션 {n}개"`) **or** `[one, other]`, `{n}` in both;
  the first form is used for n = 1 and the second for everything else. A key without `plural` is one string.
- A string that stays as in English on purpose (a protocol name standing alone, "Ping", "RTT", key glyphs) is listed
  under `@keep` **and** still mapped to itself; the test flags any key of three words or more whose value equals the
  key unless `@keep` has it. Keep that list short and honest.
- Keys that start with `@` are the translator's (`@language`, `@glyphs`, `@glossary`, `@keep`, `@notes`); nothing
  else. Glyphs and symbols stay: ⌘ ⇧ ⌥ ⌃ ⏎ ⎋ ▾ ‹ › ● — … ×; shortcut text such as `(⌘N)` stays. Product and protocol
  names stay in Latin script: MobAlt, MobaXterm, SSH, SFTP, FTP, Mosh, Telnet, RDP, VNC, X11, XQuartz, Zmodem,
  Wake-on-LAN, MultiExec, Finder, Keychain (as Apple translates it), Homebrew, GitHub, JSON, CIDR, UDP, TCP, DNS.
- **Length.** The window can be 900 px wide, the sidebar 180 px, Settings must fit 900 × 560, the toolbar shows seven
  buttons and a quick-connect box: toolbar texts ≤ 10 Latin / ≤ 5 CJK characters, side-strip texts ≤ 8 / ≤ 4,
  Settings tab names ≤ 10 / ≤ 4, session-editor tab names ≤ 12, table headers ≤ 10, Tools-panel buttons ≤ 10.
  When a faithful translation is long, drop words rather than let the interface clip them.
- Captions copied from MobaXterm (`Exclude "{title}" from MultiExec mode`, `Activate all`, `Activate none`,
  `Invert selection`, `Synchronize mouse wheel scrolling`) read the way a localized MobaXterm would; the Window
  menu uses the Mac's own words (Minimize, Zoom, Bring All to Front).
- Tone: the platform's conventions, one word per concept across the file (`@glossary` first, then use it). Korean:
  macOS-style noun phrases and `…` for commands (탭 닫기, 설정…), `…합니다` for sentences. Japanese: macOS style
  (タブを閉じる, 設定…), です・ます. Simplified Chinese: macOS style (关闭标签页, 设置…). German: Sie, Apple's terms.
  French: vouvoiement, Apple's terms, French typography (espace insécable before : ; ? !). Spanish: neutral
  imperative labels. Portuguese: Brazilian, macOS style. Vietnamese: concise, Apple's terms. Hindi: Devanagari, the
  common loanwords for technical terms (सेशन, टैब, टर्मिनल). Arabic: Modern Standard Arabic, Apple's macOS terms,
  Latin script for technical values. Error and status texts are read by administrators: precise, no softening.

## Adding a language

`LANGUAGES` in `src/main/i18n.js` (`{ code, name, guide, dir }` — `dir: 'rtl'` for a right-to-left language),
`src/locales/<code>.json` covering the catalog, `docs/USER_GUIDE.<code>.md`, the language bars (line 3 of every guide,
the README), `npm run docs:shots -- <code>`, the language list in `test/unit/i18n.test.js` and `test/e2e-i18n.js`.

## Brief for a translator or a translation agent

You bring ONE language up to date, in `src/locales/<code>.json` and `docs/USER_GUIDE.<code>.md`, and touch nothing
else (no source, no tests, no catalog, no other language).

1. Read `src/main/i18n.js` (header), `src/locales/catalog.json`, your dictionary's `@glossary` / `@keep` / `@notes`,
   and `docs/USER_GUIDE.md` next to your guide.
2. `npm run i18n:status -- --list <code>` is your work list: translate every `missing` string by the rules above,
   delete every `stale` key (carry its wording to the reworded key), fix what else is listed; run it until the
   language is `ok`, then `npm test`.
3. `MOBALT_LANG=<code> test/qa/run.sh test/qa/i18n-shots.js /tmp/i18n-<code> 180000` — no `OVERFLOW` line, and read
   the pictures of the views your strings appear in.
4. Bring the guide in line with the English one, section by section: same headings in the same order, same tables,
   links and pictures, UI labels written as your dictionary has them, code spans untouched.
5. Report: how many strings were translated and removed, the unit-test result for your language, the screenshot
   verdict, the guide sections you changed, and every English source string that is unclear.
