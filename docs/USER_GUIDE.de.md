# MobAlt Benutzerhandbuch

Dieses Handbuch auf: [English](USER_GUIDE.md) · [한국어](USER_GUIDE.ko.md) · [简体中文](USER_GUIDE.zh-CN.md) · [日本語](USER_GUIDE.ja.md) · [Tiếng Việt](USER_GUIDE.vi.md) · [हिन्दी](USER_GUIDE.hi.md) · [Deutsch](USER_GUIDE.de.md) · [Français](USER_GUIDE.fr.md) · [Español](USER_GUIDE.es.md) · [Português](USER_GUIDE.pt.md) · [العربية](USER_GUIDE.ar.md)

MobAlt ist eine Arbeitsumgebung im Stil von MobaXterm für macOS: links ein Sitzungsbaum, in der Mitte
Terminals in Tabs und geteilten Ansichten, in den Seitenpanels ein SFTP-Browser, Netzwerkwerkzeuge und Makros.

Siehe auch: [MobaXterm 26.6 feature parity](MOBAXTERM_PARITY.md) (Englisch) — was MobAlt bietet, was fehlt und was es anders macht, samt Roadmap.

![MobAlt mit zwei entfernten Shells nebeneinander](images/hero.png)

Inhalt: [Installation](#installation) · [Aktualisieren](#aktualisieren) · [Sitzungen](#sitzungen) · [Verbinden](#verbinden) ·
[Terminal](#terminal) · [Dateien (SFTP / FTP)](#dateien-sftp--ftp) · [Tunnel](#tunnel-portweiterleitung) ·
[X11, Mosh, seriell, RDP/VNC](#x11-mosh-seriell-rdpvnc) · [Werkzeuge und Makros](#werkzeuge-und-makros) ·
[Arbeitsbereich und Einstellungen](#arbeitsbereich-und-einstellungen) · [Tastaturkurzbefehle](#tastaturkurzbefehle) ·
[Daten und Datenschutz](#daten-und-datenschutz) · [Fehlerbehebung](#fehlerbehebung)

## Installation

- **Homebrew**: `brew tap Hyeongcheol-An/tap && brew trust Hyeongcheol-An/tap && brew install --cask mobalt`
  (Homebrew 7 fragt einmalig, ob Sie dem Tap eines Drittanbieters vertrauen; später aktualisiert `brew upgrade --cask mobalt`)
- **DMG**: Laden Sie das DMG für Apple Silicon (`arm64`) oder Intel (`x64`) von
  [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) und ziehen Sie MobAlt in den Ordner „Programme“.

Die Releases sind signiert und notarisiert. Voraussetzung: macOS 13 oder neuer. Optionale Helfer:
[XQuartz](https://www.xquartz.org/) für X11-Weiterleitung, `brew install mosh` für Mosh-Sitzungen,
Windows App für RDP.

MobAlt sucht beim Start in den GitHub-Releases nach einer neueren Version und bietet sie in einem Dialog an;
ohne Ihre Bestätigung wird nichts heruntergeladen oder installiert. Siehe [Aktualisieren](#aktualisieren).

## Aktualisieren

Drei Wege führen zu einem neuen Release; alle enden mit dem neuen Bundle unter `/Applications/MobAlt.app`:

- **Integrierte Aktualisierung**: MobAlt prüft beim Start die GitHub-Releases (abschaltbar unter „Einstellungen“ →
  „Updates“); „Hilfe“ → „Nach Updates suchen…“ oder „Jetzt suchen“ unter „Einstellungen“ → „Updates“ startet die Prüfung
  von Hand. Eine neuere Version wird in einem Dialog angeboten, nur auf Ihren Wunsch heruntergeladen und beim Beenden
  installiert — oder sofort mit „Jetzt neu starten“.
- **Homebrew**: `brew upgrade --cask mobalt` ersetzt das Programm im Ordner „Programme“.
- **DMG**: Laden Sie das neue DMG von [Releases](https://github.com/Hyeongcheol-An/MobAlt/releases) und ziehen Sie
  MobAlt in den Ordner „Programme“; die alte Version wird ersetzt.

Integrierte Aktualisierung und Homebrew vertragen sich. Ist „Beim Start nach Updates suchen“ aktiv („Einstellungen“ →
„Updates“), hält sich MobAlt selbst aktuell, und `brew upgrade --cask mobalt` kann trotzdem jederzeit gefahrlos laufen:
Hat sich das Programm bereits aktualisiert, installiert Homebrew einfach die vorhandene Version erneut. Weil der Cask
`auto_updates` deklariert, überspringt ein schlichtes `brew upgrade` (ohne Cask-Namen) MobAlt, sofern Sie nicht
`--greedy` angeben; nennen Sie den Cask oder ergänzen Sie `--greedy`, wenn Homebrew die Aktualisierung übernehmen soll.

Aktualisieren, während MobAlt läuft, ist kein Problem — auch aus einem Terminal von MobAlt selbst. Das laufende
Programm führt die alte Version weiter aus dem Speicher aus, bemerkt das neue Bundle auf der Festplatte (innerhalb
einer Minute oder sobald das Fenster wieder den Fokus erhält) und zeigt über den Tabs ein Banner: *MobAlt 0.11.0 ist
auf der Festplatte installiert — Sie verwenden 0.10.1. Zum Verwenden neu starten.* **Neustart** fragt zuerst nach
offenen SSH-/FTP-Verbindungen (wie ⌘Q), sichert den Arbeitsbereich und startet die neue Version; Ihre Tabs kehren über
die Wiederherstellung des Arbeitsbereichs zurück. **Später** blendet das Banner aus, bis eine weitere Version erscheint.
Liegt das neue Bundle schon auf der Festplatte, wenn die Aktualisierung läuft, wird nichts erneut heruntergeladen: Die
Prüfung meldet „0.11.0 ist bereits auf der Festplatte installiert; zum Verwenden neu starten“ und bietet denselben
Neustart an.

## Sitzungen

Das Panel **Sitzungen** ist Ihr Lesezeichenbaum. Legen Sie eine Sitzung mit `＋ Sitzung` (⌘N) an, wählen Sie einen
Typ und füllen Sie den Tab „Allgemein“ aus. Ein Doppelklick auf eine Sitzung verbindet; ein Rechtsklick öffnet das
Kontextmenü (öffnen, geteilt rechts/unten öffnen, bearbeiten, duplizieren, löschen, Tunnel starten, neue Sitzung in
diesem Ordner).

![Sitzungseditor](images/session-editor.png)

| Typ | Funktion |
|---|---|
| SSH | Terminal über SSH mit SFTP-Browser, Tunneln, X11- und Agent-Weiterleitung |
| Mosh | Roaming-Terminal über den `mosh`-Client (per SSH gestartet) |
| Lokal | Ihre macOS-Login-Shell (zsh/bash) mit Ordnerverfolgung |
| Telnet | Klassisches Telnet mit NAWS/TTYPE-Aushandlung |
| Seriell | USB-Seriell-Konsole (Baudrate, Datenformat, Flusskontrolle, lokales Echo) |
| FTP | FTP-/FTPS-Dateibrowser (explizites TLS) im Panel „Sftp“ |
| RDP / VNC | Übergibt an Windows App oder die macOS-Bildschirmfreigabe |

**Ordner**: Die Ordnertaste im Kopf des Panels („Neuer Ordner“) legt einen Ordner an; ziehen Sie Sitzungen und
Ordner, um sie zu bewegen (auf die leere Fläche ablegen für die Stammebene). Über das Kontextmenü eines Ordners
lassen sich alle enthaltenen Sitzungen in einem Raster oder in Tabs öffnen.

**Symbole und Farben**: Wählen Sie im Editor ein Emoji und eine Farbe. Sie erscheinen an der Zeile, am Tab und in
der Kopfzeile des Bereichs, sodass eine rote „Produktion“-Sitzung kaum mit einer grünen „Staging“-Sitzung zu
verwechseln ist.

**Import / Export**: Die Fußzeile des Panels importiert `~/.ssh/config` (Hosts, Benutzer, Ports, Schlüssel,
ProxyJump) und eine MobaXterm-Datei `MobaXterm.ini` (Lesezeichen). Über das Kontextmenü des Baums exportieren bzw.
importieren Sie alle Sitzungen als JSON. Die JSON-Datei enthält jede Sitzung und jeden Ordner, aber nie ein Passwort
oder eine Passphrase: Diese bleiben im verschlüsselten Speicher von MobAlt auf diesem Mac, und die Datei vermerkt nur,
dass eines gesichert wurde (`hasPassword`) — eine auf einem anderen Mac importierte Sitzung fragt deshalb bei der
ersten Verbindung nach. Der Import führt mit dem Vorhandenen zusammen: Eine Sitzung, deren `id` mit einer bestehenden
übereinstimmt, wird durch die Version aus der Datei ersetzt (ein hier für sie gesichertes Passwort bleibt erhalten),
jede andere wird hinzugefügt — ein von Hand geschriebener Eintrag ohne `id` wird immer hinzugefügt, und ein in die
Datei geschriebenes `password` wird übernommen und verschlüsselt gespeichert —, Ordner werden hinzugefügt und nichts
wird gelöscht; zweimaliges Importieren derselben Datei ändert also nichts. Einträge ohne Namen, mit unbekanntem Typ
oder ungültigem Port werden übersprungen und in der Meldung gezählt; eine Datei, die keine MobAlt-Sitzungsdatei ist,
wird mit Begründung abgelehnt. Beim Import von `~/.ssh/config` werden Hosts übersprungen, die Sie bereits haben
(gleicher Ordner und Name). MobaXterm-Lesezeichen landen in einem Ordner `MobaXterm`; ein früher importiertes
Lesezeichen (gleicher Ordner, Name und Host) wird an Ort und Stelle aufgefrischt — Host, Port, Benutzer, X11 und
Komprimierung folgen der `.ini`, während gesichertes Passwort, Symbol, Farbe, Tunnel und ein von Ihnen gesetzter
Schlüsselpfad bleiben —, sodass auch zweimaliges Importieren derselben `.ini` nichts ändert.

**Startbefehle** (Tab „Terminal“): ein Befehl pro Zeile, eingegeben, sobald das Terminal bereit ist. Bei SSH ist das
direkt nach dem Login, bei lokalen Shells direkt nachdem der Prompt erscheint. Beispiel: eine lokale Sitzung mit
*Startordner* auf einem Projekt und `claude --resume <id>` als Befehl. Der *Startordner* einer lokalen Sitzung nimmt
einen vollständig eingetippten Pfad an oder einen, den Sie mit der Taste „Auswählen…“ wählen; sie öffnet einen
Ordnerdialog und lässt das Feld unverändert, wenn Sie abbrechen.

## Verbinden

- **Schnellverbindung**: Tippen Sie `user@host[:port]` in der Symbolleiste ein und drücken Sie die Eingabetaste.
  Präfixe bestimmen den Typ: `ssh://`, `mosh://`, `telnet://`, `ftp://`, `ftps://`, `rdp://`, `vnc://`. Passt eine
  gesicherte Sitzung, wird sie verwendet.
- **Authentifizierung**: *Automatisch* probiert einen eingestellten Schlüssel, ein gesichertes Passwort, den SSH-Agent
  und die Standardschlüssel in `~/.ssh`, bevor gefragt wird. Wählen Sie *Passwort*, *Privater Schlüssel* oder
  *SSH-Agent*, um es einzuschränken. Bei Schlüsseln mit Passphrase wird einmal gefragt; aktivieren Sie „In Sitzung …
  sichern“, um sie zu behalten.
- **Hostschlüssel**: Die erste Verbindung zeigt den Fingerabdruck (SHA256 und MD5). „Akzeptieren“ speichert den
  Schlüssel; ein geänderter Schlüssel wird deutlich gemeldet und nie stillschweigend akzeptiert.
- **SSH-Schlüssel**: „Sitzung“ → „SSH-Schlüssel erzeugen…“ (auch im Panel „Werkzeuge“ und als *Erzeugen…* neben dem
  Feld für den privaten Schlüssel im Sitzungseditor) führt für Sie das `ssh-keygen` von macOS aus: Ed25519 (Standard),
  RSA 4096 oder ECDSA, ein Kommentar, eine optionale Passphrase mit Stärkehinweis und die Datei (Standard
  `~/.ssh/id_<type>`, nummeriert, wenn der Name vergeben ist; `~/.ssh` wird bei Bedarf privat angelegt, die Dateien
  erhalten 0600 / 0644). Angezeigt werden der öffentliche Schlüssel mit einer Taste „Kopieren“ und der Fingerabdruck.
  „Zum ssh-agent hinzufügen“ führt `ssh-add --apple-use-keychain` aus; „Auf einem Server installieren…“ verbindet sich
  mit einer gesicherten Sitzung über deren übliche Authentifizierung und hängt den öffentlichen Schlüssel wie
  `ssh-copy-id` an ihre `~/.ssh/authorized_keys` an (nie doppelt). Aus dem Editor heraus füllt *In dieser Sitzung
  verwenden* das Schlüsselfeld.
- **Algorithmen**: „Erweitert“ → „Algorithmen“ listet, was die Sitzung für Schlüsselaustausch, Hostschlüssel, Ciphers
  und MACs anbietet, vorbelegt mit den integrierten Standards; bearbeiten Sie eine Liste, um sie einzuschränken oder
  umzusortieren (unbekannte Namen werden direkt abgelehnt), *Auf Standard zurücksetzen* stellt die Listen wieder her,
  und „Alte Algorithmen (ältere Geräte)“ ist eine Voreinstellung, die die SHA-1-Schlüsselaustausche, CBC-Ciphers und
  DSA-Hostschlüssel ergänzt, die alte Geräte noch brauchen. Gespeichert werden nur Listen, die vom Standard abweichen.
- **Jump-Hosts**: „Erweitert“ → „Jump-Host“ wählt eine andere gesicherte Sitzung als Bastion-Host (ProxyJump).
- **Wenn es scheitert**: Das Terminal gibt aus, was passiert ist, zum Beispiel
  `Authentifizierung fehlgeschlagen — Server akzeptiert: publickey; versucht: ~/.ssh/id_ed25519`, oder einen Hinweis,
  dass auf dem Port nichts geantwortet hat. Siehe [Fehlerbehebung](#fehlerbehebung).

## Terminal

![Geteiltes Raster](images/split-grid.png)

- **Tabs**: Jede Sitzung öffnet einen Tab. Ziehen Sie Tabs, um sie umzuordnen; ein Doppelklick benennt um, ein
  Mittelklick schließt. Lokale Tabs tragen den Namen ihres aktuellen Ordners. Das Kontextmenü des Tabs (Rechtsklick
  oder ⇧F10 auf dem fokussierten Tab) benennt um, dupliziert, färbt, teilt und schließt: *Andere schließen*, *Tabs
  links schließen*, *Tabs rechts schließen* und *Alle schließen* schließen mehrere Tabs auf einmal und stellen eine
  einzige Frage, die jede aktive Verbindung darunter mitzählt („3 Tabs mit 2 aktiven Verbindungen schließen?“).
- **Angeheftete Tabs** (*Tab anheften* im Menü, ⇧⌘P): Ein angehefteter Tab rückt nach links in die Tableiste, in der
  Reihenfolge des Anheftens, und schrumpft auf Statuspunkt, Symbol und einen kurzen Titel mit einer kleinen Nadel
  anstelle des ✕. Die Sammelbefehle oben und ein Mittelklick lassen angeheftete Tabs unberührt (⌘W, *Schließen* im Menü
  und ⌫ auf dem fokussierten Tab schließen ihn weiterhin), und ein angehefteter Tab lässt sich nicht hinter einen nicht
  angehefteten ziehen. Anheftungen gehören zum Arbeitsbereich und kehren nach einem Neustart zurück. *Tab lösen* setzt
  den Tab direkt hinter den angehefteten Block.
- **Tab in eigenes Fenster bewegen** (*In neues Fenster bewegen* im Tab-Menü, ⌥⌘N oder im Menü „Sitzung“): Der Tab
  wandert in ein zweites MobAlt-Fenster und behält seine Terminals — nichts verbindet sich neu oder startet neu. Das
  neue Fenster zeichnet die letzten 256 KB der Ausgabe jedes Terminals neu und macht von dort aus weiter; ein geteilter
  Tab zieht mit allen Bereichen um. Das Fenster hat dieselbe Symbolleiste, dieselben Menüs und Kurzbefehle und startet
  mit eingeklappter Seitenleiste (⌘B blendet sie dort ein); MultiExec gilt pro Fenster. Ein zweites abgelöstes Fenster
  öffnet versetzt zum ersten, damit keines ein anderes verdeckt. Das Schließen eines abgelösten Fensters gibt seine Tabs
  mit weiterlaufenden Sitzungen an das Hauptfenster zurück — es beendet nie eine Sitzung; das Schließen seines letzten
  Tabs (⌘W) schließt das Fenster selbst, da nichts zurückzugeben bleibt; das Schließen des Hauptfensters beendet
  MobAlt einschließlich der abgelösten Fenster. Der Arbeitsbereich merkt sich abgelöste Fenster und öffnet sie beim
  nächsten Start wieder, wobei ihre Sitzungen wie die des Hauptfensters neu verbinden. Tabs lassen sich nicht zwischen
  Fenstern ziehen: Schließen Sie das Fenster, um sie zurückzuholen, oder lösen Sie sie von dort erneut ab.
- **Teilungen und Raster**: `Teilen ▾` (⌘D rechts, ⇧⌘D unten) fügt einen leeren Bereich hinzu; die Rastereinträge
  erzeugen Layouts von 1×2 bis 2×4 (⌥⌘2/4/6/8). Legen Sie eine Sitzung aus dem Baum auf einem leeren Bereich ab, um dort
  zu verbinden, auf dem Rand eines Bereichs, um in diese Richtung zu teilen, oder in seiner Mitte, um ihn zu ersetzen.
  Ziehen Sie einen Tab auf einen Bereich, um dessen Terminal in die Teilung zu bewegen. ⌥⌘1 („Darstellung“ → „Teilung
  aufheben“, `Teilen ▾` → „Teilung aufheben“) hebt die Teilung des Tabs auf: Standardmäßig wird jeder andere Bereich zu
  einem eigenen Tab, direkt hinter dem aktuellen Tab in der Reihenfolge der Bereiche, mit Terminal, Titel und Status
  unverändert — nichts verbindet sich neu, keine Ausgabe geht verloren; der fokussierte Bereich behält den Tab.
  „Einstellungen“ → „Terminal“ → **Teilung aufheben** legt fest, was stattdessen geschieht: *Aktiven Bereich behalten,
  die anderen schließen* (die anderen Bereiche werden geschlossen, mit der üblichen Rückfrage, wenn aktive Verbindungen
  getrennt würden) oder *Jedes Mal fragen* (ein kleiner Dialog bietet *Bereiche in Tabs bewegen*, *Nur diesen Bereich
  behalten* oder „Abbrechen“, womit die Teilung bleibt). Ein Tab mit nur einem Bereich bleibt unberührt, und ein
  maximierter Bereich wird zuerst wiederhergestellt.
- **Bereich maximieren** (⇧⌘⏎, die Taste ⤢ in der Kopfzeile des Bereichs oder `Teilen ▾` → „Bereich maximieren“): Der
  fokussierte Bereich füllt den Tab, wie Zoom in tmux oder Maximieren in iTerm2. Die anderen Bereiche bleiben verbunden,
  aber verborgen; die Kopfzeile zeigt den Chip *maximiert* und der Tab ein kleines ⤢. Erneut drücken (oder ⤡ in der
  Kopfzeile) stellt das Layout wieder her. Teilen, Schließen eines Bereichs, ein Rasterlayout oder das Fokussieren eines
  verborgenen Bereichs (⌘]) stellt das Layout zuerst wieder her. Jeder Tab behält seine eigene Maximierung, auch über
  einen Neustart hinweg.
- **MultiExec** (⇧⌘M): Solange eingeschaltet, geht jeder Tastendruck an jedes auf dem Bildschirm sichtbare Terminal —
  die aktiven Bereiche des aktiven Tabs bzw. nur den maximierten Bereich, solange einer den Tab füllt. Andere Tabs
  empfangen nie etwas; teilen Sie also den Tab (oder verwenden Sie ein Raster), um die Server, die Sie steuern wollen,
  nebeneinanderzulegen. Das Banner zeigt, wie viele sichtbare Terminals mithören, und folgt dem Tab, zu dem Sie wechseln.
- **Monitoring-Leiste**: Jeder SSH-Bereich zeigt unter seiner Kopfzeile eine einzeilige Leiste — CPU, belegter /
  gesamter Speicher, Belegung der Root-Disk, Netzwerkraten ↓ / ↑, Durchschnittslast, Betriebszeit und den Hostnamen —,
  alle 3 s aktualisiert („Einstellungen“ → „Funktionen“ → „Monitoring“, 2–30 s). Ein kleines POSIX-`sh`-Snippet läuft
  über die eigene Verbindung der Sitzung; es braucht also kein zweites Login, funktioniert über Jump-Hosts und schreibt
  nie ins Terminal. Linux-Hosts werden aus `/proc` gelesen, macOS und BSDs über `sysctl`, `vm_stat` und `netstat`. Ein
  Host, der es nicht ausführen kann (kein `sh`, Zugriff verweigert), zeigt gedimmt *Monitoring nicht verfügbar* und wird
  erst nach erneutem Verbinden wieder gefragt. Die Abfrage pausiert, solange der Bereich nicht sichtbar ist (ein anderer
  Tab vorn, ein maximierter Nachbar, das Fenster ausgeblendet), und läuft weiter, sobald er zurück ist. Schalten Sie sie
  pro Sitzung ab („Erweitert“ → *Monitoring-Leiste einblenden*), pro Bereich (die Pulstaste in der Kopfzeile des
  Bereichs, „Darstellung“ → „Monitoring-Leiste“ oder das Kontextmenü des Terminals) oder für alle Sitzungen in den
  Einstellungen. Ein Mosh-Bereich hat keinen eigenen SSH-Kanal: Seine Leiste läuft über die SFTP-Begleitverbindung,
  solange diese offen ist.
- **Suchen** (⌘F): inkrementelle Suche mit Schaltern für Groß-/Kleinschreibung und Regex sowie einem Trefferzähler.
- **Hervorhebung**: Fehler, Warnungen, OK/done, IP-Adressen, URLs und Größen (`512M`, `3.2GB`) werden beim Eintreffen
  eingefärbt, mit Farben aus dem Terminal-Thema, damit sie auf jeder Palette lesbar sind. „Einstellungen“ →
  „Funktionen“ → *Hervorhebung* schaltet sie ab; *Regeln…* öffnet die Tabelle — jede Regel ist ein einfacher Text oder
  ein regulärer Ausdruck, mit Groß-/Kleinschreibung ignorieren, einer Farbe, einem optionalen Hintergrund, fett und
  unterstrichen; *Standard wiederherstellen* bringt die integrierten Regeln zurück. Überschneiden sich Regeln, gewinnt
  der frühere Treffer, dann der längere. Der Tab „Terminal“ einer Sitzung kann sie erzwingen oder abschalten
  (*Hervorhebung: Standard / Ein / Aus*). Gescannt werden nur neu geschriebene Zeilen (Vollbildprogramme wie vim
  bleiben unberührt); pro Terminal bleiben höchstens 2.000 Treffer markiert — bei einem langen Schwall verlieren die
  ältesten Zeilen ihre Markierung zuerst —, und ⌘K entfernt sie alle.
- **Zmodem (rz/sz)**: Dateien durch das Terminal selbst bewegen, auf die klassische Art über eine serielle Konsole oder
  einen Jump-Host, wo SFTP nicht verfügbar ist. Führen Sie auf der Gegenseite `sz file …` aus, um auf den Mac
  herunterzuladen, oder `rz`, um von ihm hochzuladen; MobAlt erkennt die Übertragung im Datenstrom, hält das Terminal an
  und zeigt sie in der Übertragungsliste des Panels „Sftp“ (mit „Abbrechen“) und im Zähler der Statusleiste. Downloads
  landen im Download-Ordner („Einstellungen“ → „Allgemein“) oder, wenn keiner festgelegt ist, in einem Ordner Ihrer
  Wahl; Uploads öffnen eine Dateiauswahl. Funktioniert in SSH-, lokalen, Telnet- und seriellen Bereichen — nicht in
  Mosh (dessen Datenstrom gehört dem mosh-Client und ist kein roher Bytestrom). Abschalten können Sie es unter
  „Einstellungen“ → „Funktionen“ → „Übertragungen“ → *Zmodem-Übertragungen (rz/sz)* (standardmäßig ein); dann erscheinen
  die `rz`/`sz`-Bytes wie früher einfach als Zeichensalat. Ctrl-C im Bereich oder „Abbrechen“ in der Liste beendet eine
  Übertragung: Das entfernte `sz`/`rz` wird zum Anhalten aufgefordert, was noch unterwegs war, wird verschluckt statt
  angezeigt, und der Prompt ist binnen einer Sekunde zurück; ein abgestürztes entferntes `sz` wird innerhalb weniger
  Sekunden bemerkt. Ein zweiter Download mit demselben Namen landet als `name (1).ext` und wird unter diesem Namen
  geführt.
- **Zwischenablage**: Auswählen kopiert („Einstellungen“ → „Terminal“ → „Bei Auswahl kopieren“); ein Rechtsklick setzt
  ein (⇧-Rechtsklick öffnet das Menü). Dateien aus dem Finder, die Sie auf einem SSH-Terminal ablegen, werden
  hochgeladen; auf einem lokalen Terminal werden die Pfade eingesetzt.
- **Einsetzschutz**: Einsetzen von mehr als einer Zeile (oder über 1000 Zeichen) fragt zuerst nach — *N Zeilen in …
  einsetzen?* zeigt den Text in einer bearbeitbaren Vorschau; ⌘⏎ setzt ein, Esc bricht ab. Jedes Einsetzen wird zudem
  auf das geprüft, was die Zwischenablage nicht zeigt: breitenlose und Bidi-Zeichen, geschützte Leerzeichen (fürs Auge
  ein Leerzeichen, für die Shell Teil des Wortes), Steuerzeichen, ein abschließender Zeilenumbruch (die letzte Zeile
  würde sofort ausgeführt), ein Wagenrücklauf innerhalb einer Zeile, `curl … | sh`, Schreibzugriffe auf `~/.zshrc` und
  Verwandte oder `~/.ssh/authorized_keys`, Befehle nach Art von `rm -rf /` und lateinische Wörter mit ähnlich
  aussehenden kyrillischen oder griechischen Buchstaben. Die Funde werden aufgelistet und in der Vorschau markiert;
  *Bereinigt einsetzen* entfernt die verborgenen Zeichen und den abschließenden Zeilenumbruch, *Unverändert einsetzen*
  sendet den Text wie er ist. Beide Prüfungen sind Schalter unter „Einstellungen“ → „Funktionen“ → „Einsetzschutz“
  (standardmäßig ein); sie gelten für ⌘V, Rechtsklick und auf einem Bereich abgelegten Text, nicht für Makros. Bei
  eingeschaltetem MultiExec deckt eine Bestätigung jedes sichtbare Terminal ab.
- **Tasten**: Umschalt+Eingabe und Wahltaste+Eingabe senden ESC+CR (ein Zeilenumbruch in TUI-Programmen wie Claude
  Code); die Wahltaste wirkt standardmäßig als Meta.
- **Protokollierung**: „Terminal“ → „Sitzungsprotokoll starten/stoppen“ oder die Sitzungsoption schreibt die rohe
  Ausgabe nach `~/Documents/MobAlt Logs/`. „Einstellungen“ → „Protokoll“ → *Farben und Steuersequenzen … entfernen*
  speichert die Protokolle stattdessen als reinen Text (ANSI-Farben, Cursorbewegungen und der Hook zur Ordnerverfolgung
  werden entfernt).
- **Themen und Erscheinungsbild**: „Einstellungen“ → „Terminal“ → „Thema“ färbt das ganze Programm, nicht nur die
  Terminals. Symbolleiste, Seitenleiste, Tabs, Statusleiste, Dialoge, Menüs, Meldungen und Banner übernehmen eine aus
  dem gewählten Thema abgeleitete Oberflächenpalette — *Moba Dark* ist die vertraute dunkle Oberfläche, *Light* ein
  helles Programm mit fast weißen Panels und dunklem Text, *One Dark*, *Dracula*, *Solarized Dark* und *Gruvbox Dark*
  tönen die Oberfläche in ihrem eigenen Farbton —, und die nativen Bedienelemente sowie die Titelleiste folgen. Jede
  Textfarbe der Oberfläche hält in jedem Thema mindestens 4,5:1 Kontrast zu ihrem Hintergrund. Die Themenauswahl zeigt
  einen Beispiel-Prompt in den Farben der Palette; „Sichern“ wendet sie sofort an. „Einstellungen“ → „Terminal“ →
  „Schrift“ gilt für alle Terminals; eine Sitzung kann Thema und Schrift in ihrem Tab „Terminal“ überschreiben — ihr
  eigenes Thema färbt nur das Terminal dieses Bereichs, das Fenster behält das globale.

## Dateien (SFTP / FTP)

![Panel „Sftp“](images/sftp-panel.png)

Das Panel **Sftp** folgt dem aktiven SSH- oder FTP-Bereich. Es öffnet sich beim Verbinden automatisch
(„Einstellungen“ → „Allgemein“ → „Bei SSH-Verbindung zu ‚Sftp‘ wechseln“).

- Navigieren Sie per Doppelklick auf Ordner, durch Eintippen eines Pfads (`~` funktioniert) oder mit ⬆ / 🏠 / ⟳.
  „Terminal folgen“ hält das Panel im aktuellen Ordner der Shell (erfordert die Sitzungsoption, die einen kleinen
  Prompt-Hook einfügt). `>_` sendet `cd` an das Terminal.
- Symbolleiste und Kontextmenü: neuer Ordner, umbenennen, Zugriffsrechte, löschen, herunterladen, hochladen.
  Mehrfachauswahl mit ⌘ / ⇧. Ziehen Sie Dateien aus dem Finder auf die Liste, um sie hochzuladen; bei vorhandenen Namen
  wird vor dem Überschreiben gefragt.
- Ein Doppelklick auf eine Textdatei öffnet sie im integrierten Editor (⌘S sichert zurück). „In externem Editor
  bearbeiten“ öffnet sie in Ihrem Editor („Einstellungen“ → „Allgemein“ → „Externer Editor“) und lädt sie bei jedem
  Sichern erneut hoch.
- Übertragungen zeigen Fortschritt, Geschwindigkeit und eine Abbrechen-Taste; nach einem Download „Im Finder zeigen“.
- Die Spaltenköpfe sortieren nach Name, Größe oder Datum. Ist die Seitenleiste schmal, wird die Datumsspalte
  ausgeblendet.

## Tunnel (Portweiterleitung)

![Tunnel](images/tunnels.png)

`Tunnel` (⇧⌘U) verwaltet SSH-Portweiterleitungen:

- **Lokal (-L)**: `127.0.0.1:8080 → db.internal:5432` über den SSH-Host.
- **Remote (-R)**: ein Port auf dem Server, der zurück an einen lokalen Dienst weitergeleitet wird.
- **Dynamisch (-D)**: ein lokaler SOCKS5-Proxy über den Server.

Starten Sie einen Tunnel über eine offene Verbindung oder lassen Sie MobAlt eine eigene Verbindung zu einer
gesicherten Sitzung öffnen. Tunnel, die im Tab **Tunnel** einer Sitzung eingetragen sind, starten automatisch, wenn
diese Sitzung verbindet, und Sie erfahren es, wenn einer sich nicht binden lässt.

## X11, Mosh, seriell, RDP/VNC

- **X11**: Aktivieren Sie „X11-Weiterleitung“ unter „Erweitert“. MobAlt startet bei Bedarf XQuartz, leitet das Display
  weiter und tauscht das Auth-Cookie aus, sodass `xeyes` oder `gedit` einfach funktionieren. Die Statusleiste zeigt, ob
  X11 verfügbar ist.
- **Mosh**: braucht lokal `brew install mosh` und auf dem Host `mosh-server` (UDP 60000-61000). Der Bereich führt den
  mosh-Client aus; der SSH-Start verwendet Ihren Schlüssel, den Agent oder eine interaktive Abfrage. Legen Sie den Pfad
  zu `mosh-server` fest, wenn er nicht im entfernten PATH liegt.
- **Mosh + SFTP**: mosh transportiert keinen SFTP-Kanal, deshalb durchsucht das Panel „Sftp“ einen Mosh-Host über eine
  separate SSH-Verbindung ohne Shell zum selben Host (gleicher Schlüssel, Agent und Abfragen). Sie öffnet sich
  automatisch, wenn „SFTP-Browser automatisch öffnen“ für die Sitzung aktiv ist (und „Bei SSH-Verbindung zu ‚Sftp‘
  wechseln“ unter „Einstellungen“ → „Allgemein“), sonst über die Taste „SFTP für diesen Host öffnen (über SSH)“ im Panel
  oder „SFTP-Browser öffnen“ im Menü des Bereichs; sie wird zusammen mit dem Bereich getrennt.
- **Seriell**: Der Editor listet USB-Seriell-Geräte; stellen Sie Baudrate, Daten-/Stoppbits, Parität, Flusskontrolle,
  lokales Echo und das ein, was die Eingabetaste sendet (CR, LF, CRLF).
- **RDP / VNC**: MobAlt schreibt eine `.rdp`-Datei und öffnet Windows App oder öffnet `vnc://` in der
  Bildschirmfreigabe. Die Sitzung behält Host, Benutzer und Ordner wie jedes andere Lesezeichen.

## Werkzeuge und Makros

- Panel **Werkzeuge**: Ping, Traceroute, DNS-Abfrage, Portscan und lokale Netzinfo, mit einer Taste „Stopp“ für lange
  Läufe.
- **Wake-on-LAN** (Panel „Werkzeuge“): Geben Sie die MAC-Adresse in beliebiger Schreibweise ein (`aa:bb:cc:dd:ee:ff`,
  `aa-bb-…`, `aabb.ccdd.eeff` oder reines Hex) und klicken Sie auf „Wecken“: Das Magic Packet wird dreimal als
  UDP-Broadcast gesendet (255.255.255.255, standardmäßig Port 9; ein gerichteter Broadcast wie 192.168.1.255 erreicht
  ein anderes Subnetz). Die letzten 10 Adressen werden mit optionaler Bezeichnung gemerkt und beim Tippen angeboten.
- **Netzwerkscanner** (Panel „Werkzeuge“): Scannen Sie ein CIDR (`192.168.1.0/24`), einen Adressbereich
  (`10.0.0.1-10.0.0.50` oder `10.0.0.1-50`) oder einen Host, bis zu einem /16, per ICMP-Ping und/oder TCP-Verbindungen
  zu einer kurzen Portliste (standardmäßig 22, 80, 443, 3389, 5900), mit einstellbarer Parallelität („Parallel“) und
  „Timeout“ sowie einer Reverse-DNS-Abfrage jedes Treffers. Antwortende Hosts erscheinen beim Auffinden in einer
  sortierbaren Tabelle (IP, Hostname, Antwortzeit, offene Ports), während der Fortschrittsbalken `123/254` zählt;
  „Stopp“ bricht ab, ＋ öffnet den Sitzungseditor mit SSH zu diesem Host, und „Kopieren“ legt die Tabelle als Text in
  die Zwischenablage.
- Panel **Makros**: Zeichnen Sie Tastatureingaben in einem Terminal auf (● Rec / ■ Stopp), sichern Sie sie unter einem
  Namen und spielen Sie sie im aktiven Terminal oder in allen Terminals ab. Textmakros lassen sich direkt eintippen;
  Escape-Sequenzen wie `\n` oder `\x1b[A` werden unterstützt.

## Arbeitsbereich und Einstellungen

MobAlt stellt beim nächsten Start Ihre Tabs, Teilungen und Sitzungen wieder her (in eigene Fenster abgelöste Tabs
kehren als Fenster zurück) und verbindet SSH-Sitzungen neu (lokale Shells öffnen sich in ihrem letzten Ordner).
Abschalten lässt sich das unter „Einstellungen“ → „Allgemein“ → „Verhalten“.

![Einstellungen](images/settings.png)

Die Einstellungen haben fünf Tabs, von denen jeder ohne Scrollen ins kleinste Fenster passt: **Allgemein** (die
Sprache der Oberfläche, die Bestätigung beim Beenden, der Wechsel zum Panel „Sftp“, die Wiederherstellung des
Arbeitsbereichs, die lokale Shell und ihre Ordnerintegration, der externe Editor, der Download-Ordner, SSH-Keep-Alive
und „Konfigurationsordner öffnen“, das zeigt, wo alles gespeichert ist), **Terminal** (Schrift, Zeilenhöhe, Cursor,
Pufferzeilen, Thema — das Aussehen des ganzen Fensters, siehe *Themen und Erscheinungsbild* —, Maus/Tasten und was
*Teilung aufheben* mit den anderen Bereichen eines geteilten Tabs macht: in eigene Tabs bewegen, schließen oder jedes
Mal fragen), **Funktionen** (der Einsetzschutz, die Monitoring-Leiste und ihr Aktualisierungsintervall, die
Hervorhebung und ihre Regeltabelle sowie Zmodem-Übertragungen), **Protokoll** (Protokollordner, Sitzungsprotokolle
als reiner Text) und **Updates** (die Prüfung beim Start und „Jetzt suchen“).

### Sprache der Benutzeroberfläche

Menüs, Symbolleiste, Panels, Dialoge und Meldungen von MobAlt gibt es in elf Sprachen: English, 한국어, 简体中文,
日本語, Tiếng Việt, हिन्दी, Deutsch, Français, Español, Português und العربية (bei Arabisch wird das Fenster
gespiegelt: Seitenleiste rechts, Text rechtsbündig; Terminals bleiben linksläufig). Standardmäßig (**Systemstandard**) folgt die
Oberfläche der Sprachliste von macOS (Systemeinstellungen → Allgemein → Sprache & Region): Die erste Sprache dieser
Liste, die MobAlt mitbringt, gewinnt, Englisch, wenn keine passt. „Einstellungen“ → „Allgemein“ → **Sprache** wählt
eine Sprache ausdrücklich; die Änderung gilt sofort in jedem Fenster — nichts startet neu, Verbindungen bleiben
bestehen — und wird gemerkt. Terminalausgaben werden nie übersetzt: Was ein entfernter Host ausgibt, erscheint
unverändert. Das Benutzerhandbuch gibt es in denselben elf Sprachen (`docs/USER_GUIDE.<language>.md`); „Hilfe“ →
**Benutzerhandbuch** öffnet das für die aktuelle Sprache.

Um MobAlt einmalig in einer Sprache zu starten, ohne die Einstellung zu ändern (Bildschirmfotos, ein Test), setzen Sie
beim Start `MOBALT_LANG=<code>` in der Umgebung (`en`, `ko`, `zh-CN`, `ja`, `vi`, `hi`, `de`, `fr`, `es`, `pt`, `ar`).

## Tastaturkurzbefehle

| Aktion | Tasten |
|---|---|
| Neue Sitzung / lokales Terminal / Schnellverbindung | ⌘N / ⌘T / ⇧⌘N |
| Duplizieren / erneut verbinden / Tab schließen / Bereich schließen | ⇧⌘T / ⌘R / ⌘W / ⇧⌘W |
| Aktiven Tab anheften / lösen | ⇧⌘P |
| Aktiven Tab in eigenes Fenster bewegen | ⌥⌘N |
| Andere Tabs / Tabs links / Tabs rechts schließen | Menü „Sitzung“ oder Kontextmenü des Tabs |
| Nach rechts / unten teilen, Teilung aufheben | ⌘D / ⇧⌘D, ⌥⌘1 |
| Raster 2 / 4 / 6 / 8 Bereiche | ⌥⌘2 / ⌥⌘4 / ⌥⌘6 / ⌥⌘8 |
| Nächster Bereich, nächster / vorheriger Tab, Tab 1-9 | ⌘] , ⌃Tab / ⌃⇧Tab, ⌃⌘1-9 |
| Bereich maximieren (Tab füllen) / Layout wiederherstellen | ⇧⌘⏎ |
| Suchen, löschen, zoomen | ⌘F, ⌘K, ⌘= / ⌘- / ⌘0 |
| Seitenleiste, Sitzungen / SFTP / Werkzeuge / Makros | ⌘B, ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| MultiExec, Tunnel, Einstellungen | ⇧⌘M, ⇧⌘U, ⌘, |
| Zeilenumbruch in TUI-Programmen | ⇧Enter oder ⌥Enter |
| Einsetzschutz-Dialog (mehrzeilig oder verdächtig): einsetzen / abbrechen | ⌘⏎ / Esc |
| Fokussierter Tab: bewegen / aktivieren / schließen, Kontextmenü | ← → / ⏎ / ⌫, ⇧F10 oder die Menütaste |
| Fokussierte Sitzungszeile: bewegen / einklappen / öffnen / geteilt öffnen / löschen | ↑ ↓ / ← → / ⏎ / ⌘⏎ oder ⇧⏎ / ⌫ |
| Fokussierte Sitzungszeile oder fokussierter Ordner: Kontextmenü (Ordner: „In Ordner bewegen…“) | ⇧F10 oder die Menütaste |
| Fokussiertes Makro: bewegen / abspielen / löschen, Kontextmenü | ↑ ↓ / ⏎ / ⌫, ⇧F10 oder die Menütaste |
| SFTP-Liste: bewegen / öffnen / übergeordneter Ordner / löschen, Kontextmenü | ↑ ↓ Home End PgUp PgDn / ⏎ / ⌫ / Entf, ⇧F10 oder die Menütaste |
| SFTP-Liste: Auswahl erweitern / fokussierte Zeile umschalten / alles auswählen | ⇧↑ ⇧↓ ⇧Home ⇧End / Leertaste / ⌘A |
| SFTP-Liste: nach Spalte sortieren | Tab zur Spaltenüberschrift Name / Größe / Geändert, ⏎ oder Leertaste |
| Sitzungsbaum und SFTP-Liste: zu einem Namen springen | erste Buchstaben eintippen, Leerzeichen eingeschlossen (derselbe Buchstabe erneut: nächster Treffer) |
| Symbol- und Farbauswahl im Sitzungseditor: bewegen / wählen | ← → ↑ ↓ / ⏎ oder Leertaste |
| Panel-Tasten der Seitenleiste / ⌘1-4 | ⏎ bringt die Tastatur ins Panel; beim Wechsel merkt sich jedes Panel die Position |

„Hilfe“ → „Tastaturkurzbefehle“ zeigt dieselbe Liste in der App. Mit Tab erreichen Sie die Symbolleiste, die
Panel-Leiste, den Sitzungsbaum, die Makroliste, die SFTP-Liste und die Tableiste (jede Liste ist ein Tab-Stopp; die
Pfeiltasten bewegen sich darin); Dialoge halten Tab in sich und geben den Fokus beim Schließen an den Tab, die Zeile
oder die Taste zurück, die sie geöffnet hat; Kontextmenüs reagieren auf ↑ ↓ / ⏎ / Esc. Esc im Sitzungsfilter oder im
Feld für die Schnellverbindung leert es und kehrt zum Terminal zurück.


## Daten und Datenschutz

Alles bleibt in `~/Library/Application Support/MobAlt/`: `sessions.json` (Passwörter und Passphrasen über den
macOS-Schlüsselbund verschlüsselt), `settings.json`, `known_hosts`, `workspace.json` und die Dateien der
zsh-Integration. Sitzungsprotokolle landen in `~/Documents/MobAlt Logs/`. MobAlt verbindet sich nur mit den Hosts, die
Sie einrichten; die optionale Update-Prüfung liest die Release-Liste auf GitHub und sonst nichts. Details:
[SECURITY.md](../SECURITY.md).

## Fehlerbehebung

- **„Timed out while waiting for handshake“ / ETIMEDOUT**: Auf diesem Port hat nichts geantwortet. Prüfen Sie Adresse,
  VPN und Portweiterleitung am Router; versuchen Sie `nc -vz host port` in einem lokalen Terminal.
- **„Authentifizierung fehlgeschlagen — Server akzeptiert: …; versucht: …“**: Der Server hat nicht akzeptiert, was
  MobAlt angeboten hat. Vergleichen Sie die Liste nach „akzeptiert“ mit der Authentifizierungsmethode Ihrer Sitzung; bei
  Servern, die nur Schlüssel annehmen, wählen Sie die richtige Schlüsseldatei. Wiederholte Fehlschläge können Ihre IP
  eine Zeit lang per fail2ban oder durch die Strafen von sshd pro Quelladresse sperren lassen.
- **„kein passender Schlüsselaustausch / Hostschlüssel / Cipher / MAC: diese Sitzung bietet …; der Server bietet …“**:
  Die beiden Seiten haben keinen gemeinsamen Algorithmus. Die Meldung listet, was der Server tatsächlich spricht: Fügen
  Sie einen davon unter „Erweitert“ → „Algorithmen“ hinzu (oder *Auf Standard zurücksetzen*); bei einem alten Gerät,
  das nur SHA-1 / CBC anbietet, aktivieren Sie „Alte Algorithmen (ältere Geräte)“.
- **Hostschlüssel geändert**: Der Server wurde neu installiert, oder etwas fängt die Verbindung ab. Akzeptieren Sie nur,
  wenn Sie den Grund kennen; der alte Schlüssel lässt sich im Konfigurationsordner aus `known_hosts` entfernen.
- **X11-Programm erscheint nicht**: Installieren Sie XQuartz und stellen Sie sicher, dass die entfernte Shell `DISPLAY`
  in ihren Startdateien nicht überschreibt.
- **Mosh**: „mosh-Client nicht gefunden“ bedeutet, dass lokal `brew install mosh` fehlt; „mosh-server not found“
  bedeutet, dass er auf dem Host fehlt oder nicht in dessen PATH liegt (legen Sie den Pfad in der Sitzung fest).
- **Gatekeeper-Warnung bei einer selbst gebauten App**: einmal Rechtsklick → Öffnen, oder
  `xattr -dr com.apple.quarantine /Applications/MobAlt.app`.
- **`hdiutil: attach failed – Resource busy` bei `brew upgrade --cask mobalt`**: Ein anderer Homebrew-Prozess (zum
  Beispiel `brew audit` oder `brew fetch`) hatte im selben Moment dasselbe DMG eingebunden. Führen Sie den Befehl
  einfach erneut aus.
