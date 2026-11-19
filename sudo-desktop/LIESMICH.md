# Sudo – Desktop-Ninja 1.14.2

Sudo lebt auf deinem Windows-Desktop: Er läuft auf der Taskleiste, springt auf die Oberkanten deiner echten Fenster, tippt mit, wenn du tippst, erinnert dich an Pausen und meldet sich, wenn in der IT etwas brennt.

## Schnellstart

1. Ordner entpacken, zum Beispiel nach `C:\Tools\sudo-desktop`.
2. **START.bat** doppelklicken (fehlt Node.js, installiert das Skript es per winget; danach START.bat noch einmal starten).
3. Beim ersten Start begrüßt dich eine **Willkommens-Tour** in sechs Schritten.

## Bauen & verteilen

**BAUEN.bat** doppelklicken und auswählen:

| Wahl | Ergebnis in `dist\` | Wofür |
|---|---|---|
| **[1] Portable EXE** | `Sudo-1.0.0-portable.exe` | ohne Installation, zum Ausprobieren |
| **[2] Setup mit Updates** | `Sudo-Setup-1.0.0.exe`, `latest.yml`, `.blockmap` | für dich und Kollegen; installiert pro Benutzer ohne Adminrechte, Startmenü-Eintrag, Deinstallation über Windows, **aktualisiert sich selbst** |
| **[3] MSI für Intune** | `Sudo-1.0.0.msi` | zentrale Verteilung, Installation für alle Benutzer nach `C:\Program Files\Sudo` |
| **[4] Alles** | alle drei | |

Die EXE-Dateien sind nicht signiert. Windows SmartScreen warnt deshalb beim ersten Start („Weitere Informationen“ → „Trotzdem ausführen“). Mit einem Code-Signing-Zertifikat verschwindet die Warnung.

### Automatische Updates (Setup-Version)

1. Die Adresse deines Update-Ordners in die Datei `update-adresse.txt` neben `BAUEN.bat` schreiben, z. B. `https://updates.example.com/sudo/`. Die Datei ist von Git ausgenommen; `BAUEN.bat` übergibt die Adresse beim Bauen. Ohne Datei zeigt der Build auf die Beispieladresse aus `package.json` – das Selbst-Update funktioniert dann nicht.
2. Nach jedem Build mit [2] diese drei Dateien per FTP in genau diesen Ordner laden: `latest.yml`, `Sudo-Setup-<Version>.exe`, `Sudo-Setup-<Version>.exe.blockmap`.
3. Für eine neue Version die `version` in `package.json` erhöhen (z. B. 1.0.1), bauen, hochladen. Fertig.

Sudo prüft beim Start und alle 6 Stunden, lädt im Hintergrund, sagt Bescheid und installiert beim Beenden (oder sofort über das Tray-Menü). Die portable EXE und MSI-Installationen aktualisieren sich bewusst **nicht** selbst; die MSI kommt über Intune.

### Intune

**Empfohlen – Win32-App:** Nach dem MSI-Build **INTUNE-PAKET.bat** starten. Das Skript lädt einmalig Microsofts *Win32 Content Prep Tool*, packt MSI + `install.ps1` + `uninstall.ps1` in `intune\ausgabe\Sudo-<Version>.intunewin` und legt daneben das Erkennungsskript `Sudo-<Version>-Erkennung.ps1` und eine Textdatei mit allen Werten für Intune.

- **Installation** (`install.ps1`): beendet laufende Sudos, installiert still, startet Sudo bei angemeldeten Benutzern wieder. Protokoll: `C:\ProgramData\Sudo\Logs\install-<Version>.log`.
- **Deinstallation** (`uninstall.ps1`) und **Erkennung** arbeiten über den festen UpgradeCode – nicht über den Produktcode, der sich bei jeder Version ändert.
- **Update:** in der bestehenden App nur die neue `.intunewin` hochladen und das neue Erkennungsskript tauschen. Keine zweite App, keine Ablösung nötig.
- Sudo aktualisiert sich bei einer MSI-Installation bewusst **nicht** selbst; Updates kommen nur über Intune.

Bei Installation über MSI schaltet Sudo beim ersten Start jedes Benutzers „Mit Windows starten“ automatisch ein.

**Microsoft Defender / ASR:** Die Regel „Ausführbare Dateien blockieren, sofern sie nicht die Kriterien für Häufigkeit, Alter oder Vertrauenswürdigkeit erfüllen“ blockiert neue, unsignierte Programme – also auch jede neue Sudo-Version. Abhilfe: in der ASR-Richtlinie bei genau dieser Regel unter *ASR Only Per Rule Exclusions* `C:\Program Files\Sudo\Sudo.exe` eintragen (der Ordner ist nur für Administratoren beschreibbar). Dauerhaft besser: Sudo signieren (z. B. Azure Artifact Signing).

## Bedienung

- **Tray-Symbol** (Ninja-Kopf unten rechts), Rechtsklick: Sudo rufen · Erinnerung/Notiz · Frag Sudo · IT-Lage · Werkzeugkasten · Statistik · Arbeitstag & Pausen · Garderobe · Spielen · Wohnort · **Einstellungen** · Über Sudo · Sudo neu laden · Beenden. Linksklick ruft Sudo zur Maus.
- **Einstellungen** (eine Zentrale mit Reitern): Allgemein · Verhalten · Ninja-Leiste · System-Wächter · KI: Frag Sudo · Daten & Verbindungen · Info & Diagnose.
- **Maus:** Sudo ziehen und werfen (auch auf einen anderen Bildschirm), anklicken zum Streicheln, doppelklicken = hier wohnen, **mittlere Maustaste = Ninja-Leiste**, Bugs wegklicken. Überall sonst gehen Klicks einfach durch.
- **Tastatur, in jedem Programm:** Tippen, Strg+S, mehrfach Backspace, Strg+C/V im Wechsel, mehrfach Strg+Z.
  Sudo erfährt dabei nur die **Art** der Taste (Zeichen, Backspace, Speichern …), niemals, was du tippst. Es wird nichts gespeichert oder verschickt.
- **Vollbild:** Bei Spielen, Präsentationen oder Videos im Vollbild versteckt sich Sudo automatisch.
- Wird das Fenster geschlossen oder minimiert, auf dem Sudo steht, verschwindet er per Rauchbombe und taucht auf der Taskleiste wieder auf.

### Mehrere Bildschirme

Sudo startet auf dem Startbildschirm (Einstellungen → Allgemein) und **wandert ab und zu über die Bildschirmkante** zum Nachbarmonitor, links oder rechts. „Sudo rufen“ holt ihn immer auf den Bildschirm mit dem Mauszeiger. Hat er einen Wohnort, bleibt er lieber zu Hause. Wandern lässt sich abschalten.

Seit 1.4.2 lässt sich Sudo außerdem **mit der Maus über die Bildschirmkante ziehen** – er landet auf dem anderen Monitor genau unter dem Mauszeiger. Das klappt bei jeder Anordnung (nebeneinander, versetzt, übereinander, unterschiedliche Skalierung). Im Tray-Menü gibt es zusätzlich **„Auf Bildschirm …“**.

### Gut sichtbar im Dark Mode

Einstellungen → Allgemein → **Umriss für dunkle Hintergründe**: Der schwarze Ninja bekommt einen hellen Pixel-Rand oder ein weiches Leuchten (Weiß, Türkis, Gold oder Rangfarbe). Standard ist „Automatisch“: an, sobald Windows auf dunkles Design gestellt ist – auch Besucher-Ninjas bekommen ihn.

Einstellungen → Allgemein → **Sprechblase** (ab 1.5.1): Schrift „Pixel“ oder „Klar lesbar“ (Segoe UI), Textgröße Normal oder Groß und die Anzeigedauer. Text bleibt immer mindestens so lange stehen, wie man zum Lesen braucht. „Länger“ und „Lang“ verlängern das um den Faktor 1,8 bzw. 2,8. Mit „Bis Klick“ bleiben Meldungen, Warnungen und Erinnerungen stehen, bis man sie anklickt; kleine Sprüche verschwinden weiterhin von selbst. „Zeigen“ führt das Ergebnis sofort vor.

### Sparmodus

Einstellungen → Allgemein → Sparmodus: **Bei Akku** (Standard), **Immer** oder **Aus**. Im Sparmodus zeichnet Sudo etwa 24 statt 60 Bilder pro Sekunde und prüft Fenster seltener. Bei gesperrtem Bildschirm pausiert er komplett.

### Sichern & Wiederherstellen

Einstellungen → Daten & Verbindungen: **Sichern …** schreibt Rang, Erfolge, Garderobe, Einstellungen, Erinnerungen und Bildschirmzeit in eine Datei. **Wiederherstellen …** spielt sie zurück, z. B. auf einem neuen PC; Sudo startet danach neu. Die Sicherung enthält auch den Relay-Lese-Token – also sicher aufbewahren.

### Info & Diagnose

Einstellungen → Info & Diagnose (oder Tray → Über Sudo): Version, Installationsart, Update-Status, Changelog, Tastatur-Test, Ereignis-Simulation, Tour neu starten und **Diagnose-Bericht kopieren** – den einfach bei Problemen mitschicken. Er enthält keine Geheimnisse (Tokens und Geburtstag werden ausgeblendet).

### Sudo lässt sich nicht mehr anklicken?

Nach dem Entsperren von Windows und nach Standby erzeugt Sudo sein Fenster automatisch neu. Sollte er trotzdem einmal nicht reagieren: Tray-Menü → **Sudo neu laden**. Rang, Statistik und Wohnort bleiben dabei erhalten.

### Sudo reagiert nicht aufs Tippen?

Einstellungen → Info & Diagnose → **Tastatur-Test** und dann irgendwo tippen. Sudo sagt danach, wie viele Tasten er gehört hat.
Hört er nichts, obwohl du tippst, läuft das Programm vermutlich **als Administrator** (z. B. eine Admin-PowerShell). Windows lässt normale Programme aus Sicherheitsgründen nicht mitlesen, was in Admin-Fenstern passiert. Das ist gewollt; Sudo als Administrator zu starten, ist dafür keine gute Idee.

## Frag Sudo (Claude) – Strg+Alt+S

Sudo beantwortet Fragen mit Claude: PowerShell, Fehlermeldungen, kurze Erklärungen, auch mal ein IT-Witz. Strg+Alt+S oder Tray → **Frag Sudo …** öffnet das Fragefenster. Die Antwort kommt Wort für Wort, Code mit Kopierknopf; Sudo tippt währenddessen am Laptop. Ist das Fenster zu, steht der Anfang der Antwort in seiner Blase (Klick öffnet alles).

Einstellungen → **KI: Frag Sudo**:
- **Antworten über:** *Aus*, *Eigener Schlüssel* (Claude-API-Schlüssel von console.anthropic.com, mit Windows verschlüsselt gespeichert, nicht in der Sicherung) oder *Sudo-Zentrale* (Schlüssel und Budget liegen auf dem Firmen-Server).
- **Modell:** *Schnell* = Claude Haiku 5.5 (Standard, ca. 0,02 Cent pro Frage), *Schlau* = Claude Sonnet 5.5 (ca. 0,3 Cent). Im Fragefenster umschaltbar.
- **Tageslimit** beim eigenen Schlüssel (Standard 50 Cent), Verbrauch heute und im Monat.
- **IT-Lage mitschicken:** Uhrzeit, Microsoft-/Azure-Störungen und neue Sicherheitswarnungen als Hintergrund – so beantwortet Sudo auch „Ist Microsoft gerade gestört?“. Tasteneingaben und Fenstertitel gehen nie mit.
- Gespeichert wird nur der Verbrauch (Anzahl, Token, Kosten), keine Fragen oder Antworten. Der Gesprächsverlauf bleibt bis „Neu“ bzw. zum Beenden im Speicher.
- Die Fragen gehen an die Claude-API von Anthropic: bitte keine Passwörter, Zugangsdaten oder Kundendaten eingeben.

## Linux (ab 1.14)

Sudo läuft auch unter Linux (getestet für Ubuntu/Debian mit GNOME, KDE, Xfce):

- **AppImage** (`Sudo-<Version>.AppImage`): ausführbar machen und starten, aktualisiert sich selbst (Update-Ordner wie unter Windows, dazu `latest-linux.yml`). **.deb** (`sudo-desktop_<Version>_amd64.deb`): über die Paketverwaltung, startet beim ersten Mal automatisch mit.
- **Fensterkanten** liest Sudo über X11. Unter Wayland startet er über XWayland, weil Wayland Fenstern das freie Platzieren verbietet (`SUDO_WAYLAND=1` schaltet das zum Ausprobieren ab).
- **Tray:** GNOME zeigt Tray-Symbole nur mit der Erweiterung „AppIndicator“. Ohne sie geht alles über den **Rechtsklick auf Sudo**.
- **Ninja-Rad:** Terminal, Terminal (Root, fragt über pkexec), Dateien, Systemmonitor, Systemeinstellungen, Rechner, Ausschnitt – es wird das erste vorhandene Programm genommen.
- **Zentrale vorgeben:** `sudo sh linux/zentrale-vorgabe.sh https://sudo.example.com SZ-…` schreibt `/etc/sudo-desktop/zentrale.json` (auch über NinjaOne/Ansible mit `SudoUrl`/`SudoCode`).
- **Bauen:** am einfachsten auf GitHub → Actions → „Linux bauen“ (Ergebnis unter „Artifacts“; Update-Adresse als Variable `SUDO_UPDATE_URL`). Unter Windows lässt sich keine AppImage bauen: electron-builder bringt das nötige Packwerkzeug (mksquashfs) nur für Linux und macOS mit. Auf einem Linux-PC oder in WSL geht `npm run dist:linux`.

## Sudo-Zentrale

Die Zentrale ist ein eigener kleiner Server mit eigener Anleitung – in zwei Varianten mit gleicher Verwaltung:
- **PHP-Version** (`sudo-zentrale-php`) für normalen Webspace ohne VPS. Die Sudos fragen alle 15 Sekunden nach neuen Meldungen.
- **Node.js-Version** (`sudo-zentrale`) für einen VPS mit Docker. Meldungen kommen sofort per WebSocket.

Sudo erkennt die Variante selbst. Damit:
- **Meldungen an alle** oder an Gruppen/einzelne Geräte („Wartung heute 18 Uhr“, optional mit Link). Wie lange die Blase stehen bleibt, wählst du beim Senden (15 Sekunden bis 2 Minuten oder bis zum Wegklicken). Sudo zeigt sie als Blase, wichtige auch als Windows-Benachrichtigung. Wer offline war, bekommt sie beim nächsten Verbinden.
- **Ereignisse aus Skripten** (Backup-Prüfung, Monitoring, Deploy) per API-Schlüssel – ersetzt das PHP-Relay.
- **Frag Sudo ohne eigenen Schlüssel**, mit Budget pro Gerät und pro Monat.

**Anmelden:** Einstellungen → Daten & Verbindungen → **Sudo-Zentrale**: Adresse und Registrierungscode (aus der Verwaltung der Zentrale) eintragen → *Anmelden*. Sudo bekommt einen eigenen Geräte-Schlüssel (verschlüsselt gespeichert) und verbindet sich per WebSocket; nach Standby oder WLAN-Wechsel verbindet er sich selbst neu.

**Für alle PCs (Intune, NinjaOne, von Hand):** `intune\zentrale-vorgabe.ps1` legt `C:\ProgramData\Sudo\zentrale.json` an. Adresse und Registrierungscode im Skript eintragen, als Parameter übergeben (`-Url … -Code …`) oder in NinjaOne als Skriptvariablen `SudoUrl` und `SudoCode`. Läuft als SYSTEM oder Administrator. Ab 1.5.1 meldet sich ein laufender Sudo innerhalb von 5 Minuten an, ältere beim nächsten Start. `-Pruefen` liefert Exit 0/1 (für Bedingungen und Intune-Wartungen), `-Entfernen` löscht die Vorgabe. Das Protokoll von Sudo (Einstellungen → Info & Diagnose) zeigt, ob die Vorgabe gegriffen hat. Alternativ liest Sudo die Richtlinie `HKLM\SOFTWARE\Policies\MeikoSoft\Sudo` (Werte `ZentraleUrl`, `EnrollCode`).

## Gerätezustand: Mein PC

Sudo prüft kurz nach dem Start und dann alle 6 Stunden, ob der PC gut geschützt ist – **ohne Administratorrechte**, in einem einzigen versteckten PowerShell-Aufruf:

| Prüfung | Grün | Gelb | Rot |
|---|---|---|---|
| BitLocker (Laufwerk C:) | verschlüsselt | angehalten / wartet auf Aktivierung | nicht verschlüsselt |
| Virenschutz (Windows-Sicherheitscenter, auch Fremdprodukte) | aktiv | Signaturen veraltet | keiner aktiv |
| Firewall | in allen Profilen an (oder Fremd-Firewall aktiv) | in einem Profil aus | aus |
| Windows-Update (letzte erfolgreiche Installation) | ≤ 30 Tage | 31–45 Tage | > 45 Tage |
| Neustart | – | Neustart ausstehend oder > 14 Tage Laufzeit | – |
| Speicherplatz C: | ≥ 10 % frei | < 10 % | < 5 % |

Bei Problemen meldet sich Sudo höchstens einmal am Tag (nie im Meeting); ein Klick auf die Blase öffnet **IT-Lage → Mein PC** mit Ampel, Erklärung und Knöpfen zu Windows Update bzw. Windows-Sicherheit. Abschaltbar unter Einstellungen → System-Wächter → „Gerätezustand“.

Ist Sudo bei einer Zentrale angemeldet und hat die IT dort „Gerätezustand an die Zentrale“ eingeschaltet, geht **nur die Ampel** dorthin (je Prüfung grün/gelb/rot, Tage seit dem letzten Update, Laufzeit, freier Speicher in %, Name des Virenschutzes). Keine Dateien, Programme oder Inhalte.

## Security-Quiz

Ab und zu fragt Sudo: „Kurzes Security-Quiz? 30 Sekunden!“ – ein Klick auf die Blase öffnet eine Frage mit drei Antworten und kurzer Erklärung. Richtige Antworten bringen +10 XP und Erfolge (Wachsam, Phishing-Profi, Security-Ninja). Jederzeit auch über Tray → **Security-Quiz …** oder die Ninja-Leiste.

- 21 mitgelieferte Fragen aus dem Büroalltag: Phishing, CEO-Betrug, geänderte Bankdaten, MFA-Anfragen, QR-Codes, Teams-Nachrichten von außen, USB-Sticks, Datenpanne, Verschlüsselungsangriff …
- Nur zu Bürozeiten (Mo–Fr, 9–17 Uhr), nie im Meeting, Häufigkeit 1×/2×/täglich (Einstellungen → Verhalten).
- Mit Zentrale bestimmt die IT An/Aus und Häufigkeit, kann **eigene Fragen** anlegen und sofort anbieten und sieht eine **anonyme Auswertung** pro Frage (wie oft richtig – nicht von wem).

## Selbsthilfe

Tray → **Selbsthilfe …** (auch in der Ninja-Leiste und unter IT-Lage → Mein PC). Kleine Reparaturen, die jeder selbst ausführen darf – ohne Adminrechte, nur im eigenen Benutzerkonto:

| Werkzeug | Was passiert |
|---|---|
| Netzwerk-Check | prüft Netzwerkkarte (inkl. 169.254-Adresse = kein DHCP), VPN-Adapter, DNS, Internet (erkennt auch Hotspot-Anmeldeseiten), Microsoft 365 (Anmeldung, Exchange, Teams, Office) und die Sudo-Zentrale – mit Ampel und Klartext |
| Teams reparieren | schließt Teams, leert den Cache (neues Teams: `%LOCALAPPDATA%\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams`, klassisches Teams: Cache-Ordner unter `%APPDATA%\Microsoft\Teams`) und startet Teams neu |
| Outlook neu starten | beendet Outlook erst freundlich (Entwürfe werden gespeichert), nach 20 s hart; klassisches und neues Outlook |
| OneDrive neu starten | `OneDrive.exe /shutdown` und Neustart im Hintergrund |
| Taskleiste & Explorer neu starten | startet `explorer.exe` neu |
| Temporäre Dateien aufräumen | löscht im eigenen Temp-Ordner alles, was älter als 2 Tage ist; Belegtes bleibt |
| DNS-Zwischenspeicher leeren | `ipconfig /flushdns` (meldet sich, falls der PC dafür Adminrechte verlangt) |

Werkzeuge, die Programme schließen, fragen vorher nach. Unten steht „Hat nicht geholfen?“ mit dem Hilfe-Kontakt aus der Zentrale (Telefon, Mail, Portal). Mit Zentrale wird **anonym** gezählt, welches Werkzeug benutzt wurde und ob es geklappt hat – so sieht die IT, was häufig hakt.

## Hinweise deiner IT: Störungen und Neustarts

Nur mit Zentrale. Tray → **Hinweise deiner IT …** (mit Anzahl, wenn etwas offen ist).

**Störungen:** Meldet die IT eine Störung (in der Zentrale oder per Schnittstelle, z. B. aus dem Monitoring), zeigt Sudo sie als Sprechblase und Windows-Benachrichtigung – bei „Ausfall“ bleibt die Blase stehen, bis man sie anklickt. Im Fenster steht die Störung, bis die IT sie beendet; mit **„Ich bin auch betroffen“** meldet man sich mit einem Klick (zurücknehmbar). Die IT sieht, wie viele und welche Geräte betroffen sind. Beim Beenden kommt die Entwarnung als grüne Blase.

**Neustart-Kampagnen:** Die IT bittet z. B. zum Patchday um einen Neustart bis zu einer Frist – für alle Geräte oder nur für Geräte, bei denen Windows auf einen Neustart wartet oder die seit X Tagen laufen. Sudo fragt höflich (nie im Meeting oder Vollbild): **Jetzt neu starten** (Windows startet nach 2 Minuten neu, abbrechbar), **in 1 Stunde**, **in 3 Stunden** oder **morgen früh**. Ohne Antwort erinnert er nach 2 Stunden, nach Fristende stündlich. Ist der PC nach Kampagnenstart neu gestartet worden, gilt sie als erledigt. Sudo startet **nie ohne Zustimmung** neu – erzwingen bleibt Sache von Intune bzw. NinjaOne.

## Warum ist mein PC langsam? (ab 1.10)
Selbsthilfe → „Analysieren“. Sudo misst kurz Prozessor und Arbeitsspeicher, fasst die größten Programme zusammen (z. B. „Edge in 38 Teilen, 4,2 GB“ = viele Tabs), prüft Neustart, Speicherplatz auf C:, Autostart und Akkubetrieb und erklärt in Klartext, was bremst. Knöpfe führen zum nächsten Schritt (Task-Manager, Temp aufräumen, Speicheroptimierung, Autostart-Apps, Windows Update). Es wird nichts verändert; nur „benutzt/geholfen“ zählt die Zentrale anonym.

## Meeting-Check: Ton & Bild (ab 1.10)
Tray → „Meeting-Check: Ton & Bild …“ oder Selbsthilfe. Prüft Mikrofon (Pegel, erkennt stumm/zu leise), Kamera (Vorschau, erkennt schwarzes Bild), Lautsprecher (Testton auf dem gewählten Gerät) und die Verbindung zu Teams. Bei gesperrtem Zugriff (Windows-Datenschutz) oder belegtem Gerät sagt Sudo, was zu tun ist, und öffnet die passende Windows-Seite. Bild und Ton bleiben im Fenster – nichts wird aufgenommen oder verschickt.

## Gute Gewohnheiten: Win+L und Tipps (ab 1.10)
- **Sperr-Erinnerung:** Warst du mehr als 10 Minuten weg (kein Meeting, kein Video, keine Präsentation) und der Bildschirm war nicht gesperrt, erinnert Sudo beim Zurückkommen an Win+L – höchstens einmal am Tag. Ein Klick öffnet „Dynamische Sperre“. Hast du gesperrt, gibt es ein Lob und 3 XP (einmal am Tag).
- **Tipps im passenden Moment:** Ist Excel, Word, Outlook, Teams, PowerPoint, OneNote oder der Browser zwei Minuten am Stück vorne, zeigt Sudo ab und zu einen Kniff – „Normal“ höchstens dreimal am Tag mit 90 Minuten Abstand, „Selten“ einmal am Tag. Die IT kann eigene Tipps ergänzen oder Tipps abschalten.
- Beides unter Einstellungen → Verhalten → Gute Gewohnheiten. Alles bleibt lokal.

## Kurze Frage deiner IT und Start-Checkliste (ab 1.10, mit Zentrale)
- **Kurze Frage:** Die IT stellt eine Frage (1–5 Sterne, optional Anmerkung). Sudo bietet sie höchstens dreimal an (werktags 9–17 Uhr, nie im Meeting), sie lässt sich überspringen. Die Zentrale speichert Sterne ohne Gerät.
- **Läuft es wieder?** Nach dem Beenden einer Störung, bei der du „Ich bin auch betroffen“ geklickt hast. Diese Antwort geht mit Gerät an die IT – damit sie bei „Geht noch nicht“ helfen kann.
- **Start-Checkliste:** In den ersten Tagen nach der Registrierung (Standard 30). Sudo prüft selbst: OneDrive angemeldet, Desktop/Dokumente in OneDrive, Teams eingerichtet, Signatur (klassisches Outlook), Drucker, Quiz, Gerätezustand. Einmal täglich erinnert Sudo an offene Punkte; alles erledigt = 25 XP. Tray → „Start-Checkliste (x/y) …“.

## Plugins (ab 1.12)

Plugins sind kleine Zusatzwerkzeuge als **eine einzelne HTML-Datei** – z. B. ein Namens-Generator für Entra-Gruppen, ein Subnetzrechner oder eine Checkliste eurer Firma. So muss nicht jede Spezialfunktion fest in Sudo stecken.

- **Öffnen:** Tray-Menü → **Plugins** (Puzzle-Symbol, erscheint, sobald es mindestens ein Plugin gibt) oder Einstellungen → Reiter **Plugins**.
- **Selbst hinzufügen:** Einstellungen → Plugins → **Datei wählen …**. Gleiche Kennung ersetzt die alte Fassung. Abgelegt unter `%APPDATA%\Sudo\plugins\eigene\`.
- **Per Doppelklick (ab 1.13):** Eine Datei mit der Endung **`.sudoplugin`** (eigenes Puzzle-Symbol im Explorer) öffnet Sudo und fragt „Plugin … hinzufügen?“ – mit „Hinzufügen und öffnen“, „Nur hinzufügen“ oder „Abbrechen“. Die Endung trägt Sudo beim Start selbst für den angemeldeten Benutzer ein (`HKCU\Software\Classes`, ohne Adminrechte, gleich bei Setup, MSI und portabler EXE). Eine `.sudoplugin`-Datei ist eine normale Plugin-HTML-Datei mit anderer Endung – zum Verschicken einfach umbenennen.
- **Von der IT:** In der Sudo-Zentrale unter **Plugins** hochladen und zuweisen (alle, Gruppe, Person). Die Sudos holen sie von selbst, prüfen die Prüfsumme und löschen sie wieder, wenn die IT sie entfernt. Die IT kann eigene Plugins der Mitarbeitenden verbieten.

**Abgeschottet:** Ein Plugin läuft in einem eigenen Fenster ohne Node und ohne Brücke zu Sudo. Alle Netzwerkzugriffe (http, https, WebSocket, WebRTC) und fremde Dateien werden gesperrt und im Ereignisprotokoll vermerkt; jedes Plugin hat seinen eigenen Speicher (`localStorage`). Erlaubt sind nur: Text in die Zwischenablage schreiben, Rückfragen (`confirm`, `alert`) und Dateien über den Speichern-Dialog sichern. Pop-ups und Navigation weg von der Datei werden blockiert. Trotzdem gilt: nur Plugins aus vertrauenswürdiger Quelle hinzufügen.

**Selbst bauen:** Alles (CSS, JavaScript, Bilder als `data:`) in eine HTML-Datei, höchstens 2 MB, ohne Abruf aus dem Internet. Zum Weitergeben in `.sudoplugin` umbenennen. Firmen- oder kundenspezifische Plugins gehören nicht in dieses Repo, sondern in ein eigenes, privates. `<title>` ist der Name, freiwillig dazu:

```html
<meta name="sudo-plugin-id" content="subnetz-rechner">
<meta name="sudo-plugin-version" content="1.0">
<meta name="sudo-plugin-size" content="560x520">
```

Ein vollständiges Beispiel liegt unter `examples/plugins/subnetz-rechner.html`.

## Musikwunsch

Nur mit Zentrale und wenn die IT es freischaltet. Tray → **Musikwunsch …**: Song oder Interpret suchen, **Wünschen**, bestätigen. Der Titel kommt in die Spotify-Warteschlange des Büro-Lautsprechers (z. B. die Alexa) und läuft nach dem aktuellen Titel.

- Bezahlt wird mit **XP**. Der Rang kann dadurch sinken („Gürtel abgegeben“), Garderoben-Teile und Erfolge bleiben.
- Die IT legt fest: Kosten pro Song, Wünsche pro Tag, Mindestabstand zwischen zwei Wünschen, Uhrzeiten, ob „explicit“-Titel erlaubt sind und ob der Wunsch bei allen angesagt wird (mit oder ohne Namen).
- Die Spotify-Anmeldung liegt nur in der Zentrale – auf den PCs gibt es keine Zugangsdaten.

## Was hat Sudo gesagt? (Verlauf, ab 1.9)

Tray → **Was hat Sudo gesagt?** zeigt die letzten wichtigen Sprechblasen zum Nachlesen: Meldungen der IT und der Zentrale, Alarme, Wächter-Hinweise, Erinnerungen, neue Videos und Antworten von Frag Sudo. Auch Meldungen, die Sudo im Meeting zurückgehalten hat, stehen dort. Wurde im Meeting etwas verpasst, zeigt das Tray-Menü die Anzahl an.

**Suche (ab 1.11):** Das Suchfeld findet Meldungen nach Text, Ticket-Nummer („4711“ oder „#4711“) und Gerätekennung (z. B. Servername); mehrere Wörter müssen alle vorkommen. Daneben lässt sich der Zeitraum eingrenzen (Heute, letzte 7 oder 30 Tage, Von … bis …) und die Quelle wählen (Deine IT, Wächter, Erinnerungen, Videos, Frag Sudo). Ticket und Gerät stehen als Marke unter der Meldung.

**Aufbewahrung und Zugriff:** Unter Einstellungen → **Verlauf „Was hat Sudo gesagt?“** legt jeder selbst fest, wie lange Sudo Meldungen aufhebt: Aus, 7, 30 (Standard), 90 Tage oder 1 Jahr, höchstens 2000 Einträge. Ältere Einträge löscht Sudo von selbst aus der Datei; wer kürzer oder „Aus“ wählt, löscht sofort. Der Verlauf liegt in `%APPDATA%Sudoerlauf.json`, ist damit nur für das eigene Windows-Konto lesbar und wird nie an die Zentrale übertragen. Er steht nur in der Datenauskunft, die man selbst speichert.

## Anleitungen aus SharePoint (ab 1.9)

Wenn die IT in der Zentrale SharePoint-Ordner oder Websiteseiten eingetragen hat, erscheint im Tray **Anleitungen …**: ein Suchfenster über Titel, Ordner und Text (Word, PowerPoint, Text, SharePoint-Seiten; PDFs nur mit Namen). Ein Klick öffnet das Original in SharePoint – mit der eigenen Anmeldung, die Berechtigungen bleiben also wie gewohnt. Zusätzlich:
- Bei einer **Störung** schlägt das Fenster „Hinweise deiner IT“ passende Anleitungen vor.
- **Frag Sudo** bekommt passende Auszüge als Hintergrund und verlinkt die Anleitung in der Antwort (Links in Antworten sind jetzt anklickbar).

## Ressourcen & Stabilität (ab 1.9)

- Sudo zeichnet nur noch neu, wenn sich etwas bewegt, löscht nur den Bereich, in dem Effekte waren, und läuft in ruhigen Phasen mit 30, beim Schlafen mit 15 Bildern pro Sekunde. Die Fensterliste wird seltener abgefragt, solange sich nichts ändert. In Messungen sank die CPU-Last im Leerlauf deutlich (beim Schlafen etwa auf ein Drittel).
- **Selbstheilung:** Stürzt das Overlay ab oder hängt es länger als 10 Sekunden, startet Sudo es selbst neu (höchstens 4× pro Stunde). Braucht es über 700 MB, wird es in einer ruhigen Minute aufgefrischt. Ein Fehler in einem einzelnen Bild hält Sudo nicht mehr an.
- **Einstellungen → Info & Diagnose → Ressourcen & Stabilität** zeigt CPU und Arbeitsspeicher (jetzt, Ø 10 Minuten, je Prozess), Laufzeit, Neustarts und die letzten Fehler. Der Diagnose-Bericht enthält diese Werte ebenfalls.
- Ist der PC bei einer Zentrale angemeldet, meldet Sudo alle 10 Minuten bei Änderungen CPU, RAM, Neustarts, Fehlerzahl und den letzten Fehlertext (ohne Pfade und Namen). Die IT sieht das unter „Geräte“.

## YouTube-Videos

Die IT kann in der Zentrale YouTube-Kanäle eintragen (z. B. Technik-Kanäle). Erscheint dort ein neues Video, zeigt Sudo es als Sprechblase. Ein Klick öffnet das Video im Browser, zusätzlich gibt es eine Windows-Benachrichtigung. Abschalten: Einstellungen → Verhalten → **YouTube-Videos**.

**Eigene Kanäle (ab 1.8.1):** Unter Einstellungen → Verhalten → **YouTube-Videos** kann jeder bis zu 10 eigene Kanäle eintragen – als Link (`https://www.youtube.com/@kanal`), als `@Handle` oder als Kanal-ID (`UC…`). Sudo schaut alle 15 Minuten nach (das erste Mal 2 Minuten nach dem Start) und zeigt neue Videos genauso an. Shorts lassen sich pro Kanal zuschalten. Das funktioniert auch ohne Zentrale: Der PC fragt die öffentlichen Feeds direkt bei YouTube ab, die Liste bleibt auf dem PC. Kommt dasselbe Video auch über einen Kanal der IT, zeigt Sudo es nur einmal. Die Firewall muss `www.youtube.com` erlauben.

## Ninja-Rad und Ninja-Leiste (mittlere Maustaste)

**Mausrad auf Sudo drücken** → ab 1.14 erscheint das **Ninja-Rad**: runde Symbole im Kreis um Sudo, der Name steht beim Darüberfahren über seinem Kopf. Plugins erscheinen darin von selbst (violett umrandet, bis zu 8) und lassen sich unter Einstellungen → Ninja-Leiste → „Plugins im Rad“ einzeln ausblenden. Wer die alte Darstellung mag, stellt dort „Darstellung: Leiste“ ein. **Rechtsklick auf Sudo** öffnet sein komplettes Menü (dasselbe wie am Tray-Symbol).

In der Leiste-Darstellung klappt über Sudo eine Schnellstart-Leiste auf. Mitgeliefert (einzeln abschaltbar unter Einstellungen → **Ninja-Leiste**): PowerShell, PowerShell (Admin), CMD, Windows Terminal, Explorer, Task-Manager, Windows-Einstellungen, Rechner, Bildschirmausschnitt, Registry (Admin), Dienste sowie Sudos eigene Fenster (Werkzeugkasten, Frag Sudo, Notiz, IT-Lage).

**Eigene Einträge** (bis zu 8, insgesamt höchstens 12 in der Leiste): Programm, Ordner (auch `\\server\freigabe`), Datei oder Link (`https:`, `mailto:`, `ms-settings:` …), optional mit Argumenten und „Als Administrator starten“ (Windows fragt per UAC). Beispiele: PuTTY mit gespeicherter Sitzung, das Kundenportal, ein Skript-Ordner.

Sicherheit: Der Overlay schickt nur die Nummer eines Eintrags; was gestartet wird, steht ausschließlich in den Einstellungen. `file:`, `javascript:` und andere Protokolle werden abgelehnt. Die Leiste schließt sich nach ein paar Sekunden von selbst, bei Klick auf ✕ oder erneut per Mausrad.

## Was weiß Sudo über mich?

Tray → **Was weiß Sudo über mich?** (oder Einstellungen → Daten & Verbindungen → *Transparenz*). Die Seite zeigt mit den echten Werten dieses PCs:
- was Sudo **im Moment bemerkt** (dass getippt wird, nicht was; Fensterpositionen und -titel; Meeting ja/nein; Mausposition) und was er **nie** tut (keine Bildschirmfotos, kein Mikrofon/keine Kamera, keine Zwischenablage lesen, keine Tasteninhalte),
- was **gespeichert** ist (Zähler, Bildschirmzeit mit Programmliste, Erinnerungen, Protokoll, verschlüsselte Schlüssel) – mit Knöpfen zum Löschen der App-Liste und des Protokolls,
- was **den PC verlässt** (Zentrale, Frag Sudo, IT-Lage, HIBP, Updates, Relay, Webhook) – jeweils mit An/Aus-Status.

**Datenauskunft speichern …** schreibt alles, was Sudo auf diesem PC gespeichert hat, in eine JSON-Datei – ohne API-Schlüssel, Geräte-Schlüssel und Tokens. Für Firmen liegt eine Vorlage für ein Infoblatt bei: `DATENSCHUTZ-INFO.md`.

## Besuche: Sudo zu Kollegen schicken

Über die Sudo-Zentrale kann dein Sudo bei Kollegen vorbeischauen. Tray → **Auf Besuch schicken …** (oder Einstellungen → Verhalten → *Öffnen …*): Kollegen wählen, Mitbringsel wählen, *Losschicken!*

- **Post-it** mit kurzer Nachricht (höchstens 60 Zeichen), **Kaffee**, **Gummiente** (quietscht), **Pizzastück**: bleiben auf dem Desktop des Kollegen liegen, bis er sie anklickt (höchstens 6 Stück, auch nach einem Neustart).
- **Konfetti**: kurze Party auf dem fremden Desktop. **Bug aussetzen**: dort muss Sudo ein paar Bugs jagen.
- **Duell!**: Die beiden Ninjas werfen sich Shuriken zu. Ein bisschen Glück, ein bisschen Rang-Bonus; der Sieger bekommt +10 XP. Das Ergebnis kommt bei beiden an.

Spielregeln: Der Gast taucht auf der Taskleiste neben Sudo auf, mit Namensschild „Sudo von …“. Nie im Meeting, nie während eines Spiels oder einer Frage – er wartet dann kurz. Standardmäßig darf jeder **2 Besuche am Tag schicken** und **3 empfangen** (in der Zentrale einstellbar). Jeder Besuch steht mit Absender im Protokoll der Zentrale.

Wer keinen Besuch möchte: Einstellungen → Verhalten → **Besuche erlauben** ausschalten. Dort lässt sich auch der Name auf dem Namensschild ändern (leer = Windows-Benutzername).

## Webseiten & Programme

Sudo erkennt am Fenstertitel des Browsers, was du gerade offen hast – nur lokal, der Titel wird nie gespeichert oder verschickt – und macht gelegentlich mit:
- **YouTube, Netflix, Twitch, Mediathek …:** Fernsehabend – er läuft zur Maus, setzt sich hin und futtert Popcorn.
- **Spotify, YouTube Music, Deezer …:** Ninja-Dance mit Noten.
- **Amazon, eBay, Kleinanzeigen …:** ein Paket fällt vom Himmel, Sudo fängt es.
- **Claude, ChatGPT, Gemini …:** er tippt kollegial mit. **News-Seiten** und **Wikipedia:** er liest mit. **Reddit, LinkedIn & Co.:** „Nur kurz scrollen, ja?“. **Karten:** Ausschau halten.

Damit es nicht nervt: jede Art höchstens alle 25 Minuten, insgesamt höchstens alle 8 Minuten, nicht im Meeting, und nur mit etwas Zufall. Verlässt du die Seite, hört er auf. Abschalten: Einstellungen → Verhalten → *Programme kommentieren*.

## IT-Lage: Microsoft-Status, Sicherheitswarnungen & Datenlecks

Tray → **IT-Lage …** (oder ein Klick auf Sudos Sprechblase bei einer Meldung).

**Microsoft & Azure** – ohne Tenant und ohne Anmeldung, alle 5 Minuten:
- **Microsoft 365 (öffentlich):** die öffentliche Statusseite `status.cloud.microsoft` (Outlook.com, OneDrive, Teams, Copilot, Office im Web …). Wechselt ein Dienst auf „gestört“ oder zurück, sagt Sudo Bescheid.
- **Azure:** offizieller Azure-Status-Feed. Er enthält nur aktuelle, größere Störungen – meistens ist er leer, und das ist gut so.
- **Wichtig:** Störungen, die nur einzelne Tenants betreffen, zeigt Microsoft ausschließlich im **Admin Center → Dienstintegrität**. Der Link steht im Fenster. Die öffentliche Statusseite ist nicht offiziell als Schnittstelle dokumentiert; ändert Microsoft sie, zeigt Sudo „Nicht erreichbar“ statt falscher Werte.

**Datenlecks:**
- **Neue öffentliche Datenlecks** (kostenlos): Sudo fragt alle 6 Stunden bei *Have I Been Pwned* nach dem neuesten Leck und meldet es, ab einstellbarer Größe (Standard: ab 1 Mio. Konten).
- **Eigene Adressen** (bis zu 10): braucht einen HIBP-API-Schlüssel (kleinster Tarif ca. 4,39 $/Monat, haveibeenpwned.com/API/Key). Sudo prüft dann alle 12 Stunden und meldet **neue** Funde. Adressen und Schlüssel bleiben auf dem PC; im Diagnose-Bericht werden sie ausgeblendet.
- **Ohne Schlüssel:** Links zu Have I Been Pwned und zum **HPI Identity Leak Checker**. Beim HPI kommt das Ergebnis per E-Mail an die geprüfte Adresse – eine automatische Abfrage gibt es dort nicht.
- **Passwort prüfen** (kostenlos): Nur die ersten 5 Zeichen des SHA-1-Hashes verlassen den PC (k-Anonymität), das Passwort selbst nie.

**Sicherheitswarnungen (RSS):**
- Vorbelegt: **CERT-Bund Sicherheitswarnungen** des BSI (an), **Bürger-CERT** und **BSI Presse & Kurzmitteilungen** (aus). Abfrage alle 15 Minuten.
- Neue Warnungen zeigt Sudo als **klickbare Blase** für 5–10 Sekunden (einstellbar; mit der Maus darauf bleibt sie länger). Klick öffnet den Artikel im Browser. Kommen mehr als drei auf einmal, gibt es eine Sammelmeldung, die die Übersicht öffnet.
- **Filter:** Blase erst ab Schweregrad *kritisch*, *hoch* (Standard), *mittel* oder bei allen Meldungen; „Nur neue Warnungen“ blendet `[UPDATE]`-Meldungen aus; optional nur bei **Stichwörtern** wie `Microsoft, Exchange, Fortinet, Veeam`. In der Liste steht trotzdem alles.
- **Eigene Feeds:** bis zu 8 RSS- oder Atom-Adressen (https), z. B. Hersteller-Blogs. Feeds ohne Schweregrad melden sich nur mit Stichwörtern oder bei „alle Meldungen“.
- Beim ersten Abruf merkt sich Sudo alle vorhandenen Meldungen, damit nicht 150 Blasen auf einmal kommen. Die Inhalte der Feeds bleiben in ihrer Originalsprache.

Unkritische Hinweise (neues öffentliches Leck, Entwarnungen, normale Warnungen) hält Sudo während Meetings zurück; kritische kommen sofort.

## Sprache

Einstellungen → Allgemein → **Sprache**: Automatisch (wie Windows), Deutsch, English oder 日本語. Gilt für alle Fenster, das Tray-Menü und Sudos Sprüche und wechselt sofort.

- Die Übersetzungen stehen in `renderer/lang/en.js` und `ja.js`. Schlüssel ist jeweils der deutsche Originaltext, `{name}` sind Platzhalter. Eigene Sprüche in `lines.js` erscheinen in anderen Sprachen auf Deutsch, bis sie dort ergänzt sind.
- `node tools/i18n-extract.js en` listet Texte, die im englischen Wörterbuch noch fehlen.
- Japanisch nutzt die Pixelschrift *DotGothic16*. Erinnerungen verstehen auch `tomorrow 9am standup` oder `明日 9時 バックアップ`.
- Diagnose-Bericht und Ereignisprotokoll bleiben deutsch.

## Persönlichkeit

- **Programme:** Sudo kommentiert gelegentlich, was du gerade öffnest, höchstens alle 20 Minuten pro Programm:
  - Microsoft 365 am Desktop: Outlook (klassisch und neu), Teams, Word, Excel, PowerPoint, OneNote, Access, Visio, Project, Power BI, OneDrive, Copilot
  - Microsoft 365 im Browser: Outlook, Teams, SharePoint, OneDrive, Planner, To Do, Loop, Forms, Bookings, Copilot, Power Automate, Power Apps, Power BI
  - Admin-Center: Microsoft 365, Exchange, Intune, Entra, Defender, Purview, Teams, SharePoint sowie das Azure-Portal
  - Werkzeuge: VS Code, PhpStorm, PowerShell/Terminal, RDP, Task-Manager, Registry, MMC, FileZilla/WinSCP, PuTTY, Notepad, phpMyAdmin, GitHub, Stack Overflow und mehr
  Dafür liest Sudo den Programmnamen und den Fenstertitel des aktiven Fensters, vergleicht sie nur lokal mit seiner Liste und vergisst sie sofort wieder. Abschalten: Einstellungen → Verhalten → Programme kommentieren.
- **Tageszeit:** Begrüßung passend zu Uhrzeit und Wochentag, „Mahlzeit!“ zur Mittagszeit, Hinweis am Freitagnachmittag und am Microsoft-Patchday (zweiter Dienstag im Monat).
- **Eigenbeschäftigung:** neu sind Ping-Tests, Strecken, Ausschau halten und IT-Weisheiten. Während du arbeitest, bleibt Sudo ruhiger und springt nicht ständig herum.
- **Eigene Sprüche:** Alle Texte stehen in `renderer/lines.js` und lassen sich dort einfach ergänzen. Danach Sudo neu starten.

## Wohnort

Sudo hat ein Zuhause, zu dem er immer wieder zurückkehrt und wo er sich am liebsten aufhält.

- **Festlegen:** Sudo dorthin ziehen, wo er wohnen soll, und **doppelklicken**. Oder: Tray-Menü → Wohnort → Hier wohnen.
- Wohnen kann er auf der Taskleiste oder auf einem **Programm** (z. B. auf Outlook oder VS Code). Er merkt sich das Programm, nicht das einzelne Fenster, und findet es auch nach einem Neustart wieder.
- Ist das Programm gerade nicht offen, wartet er auf der Taskleiste. Beim Start und über „Nach Hause schicken“ springt er per Rauchbombe heim.

## Arbeitstag und Pausen

Tray-Menü → **Arbeitstag & Pausen …**

- **Arbeitsbeginn:** Sudo erkennt deine erste Aktivität am Tag (ab 4 Uhr), meldet sie und rechnet den voraussichtlichen Feierabend aus (Sollzeit + feste Pausen).
- **Feste Pausen:** z. B. 12:00 Uhr, 30 Minuten Mittagspause. Sudo kündigt sie 5 Minuten vorher an und meldet sich zur Uhrzeit.
- **Aufstehen / Stehtisch** (Standard: nach 50 Minuten), **Augenpause** mit 20 Sekunden Meditation (nach 60 Minuten) und optional **Trinken**.
  Gezählt wird nur aktive Zeit am PC. Bist du 5 Minuten weg, gilt das als Pause und die Zähler starten neu.
- **Feierabend-Hinweis**, sobald die Sollzeit erreicht ist.
- Während Meetings und Vollbild hält Sudo Erinnerungen zurück und meldet sie danach.
- Nur an den eingestellten Arbeitstagen (Standard: Montag bis Freitag).

## Bildschirmzeit

Statistik → Reiter **Mein Tag**: Arbeitsbeginn, aktive Zeit, Feierabend, nächste Pause, Zeit pro Programm heute und die aktive Zeit der letzten 7 Tage.
Gespeichert werden nur Programmnamen und Sekunden, keine Fenstertitel oder Inhalte, für 30 Tage in `%APPDATA%\Sudo\screentime.json`. Abschaltbar unter Arbeitstag & Pausen, löschbar im Statistik-Fenster.

## Erinnerungen & Notizen (Strg+Alt+N)

Ein kleines Eingabefenster, in das du in Alltagssprache tippst. Enter speichert und schließt (Umschalt+Enter speichert und lässt es offen), Esc schließt.

| Eingabe | Ergebnis |
|---|---|
| `20m Kunde zurückrufen` | in 20 Minuten |
| `1h30 Pause` | in 1,5 Stunden |
| `14:30 Teams-Call` oder `14.30 Uhr …` | heute 14:30 (schon vorbei → morgen) |
| `9 Uhr Standup` | um 9 Uhr |
| `morgen 9 Backup prüfen`, `übermorgen 10 …` | an dem Tag |
| `Ideen für BeeVentory` (ohne Zeit) | wird eine **Notiz** |

Zur Zeit hält Sudo ein Schild mit dem Text hoch und es kommt zusätzlich eine Windows-Benachrichtigung (abschaltbar). **Sudo anklicken = 10 Minuten schlummern.** War der PC aus, meldet er verpasste Erinnerungen beim nächsten Start. Offene Notizen erwähnt er morgens beim Arbeitsbeginn. Gespeichert in `%APPDATA%\Sudo\reminders.json`.

## Werkzeugkasten (Strg+Alt+K)

Alles offline, Ergebnis per Klick in die Zwischenablage:

- **Passwort-Generator** mit Länge, Zeichengruppen und Entropie-Anzeige, dazu ein merkbares Startpasswort aus Wörtern
- **GUID** in allen gängigen Schreibweisen
- **Subnetz-Rechner**: Netz, Maske, Wildcard, Host-Bereich, Broadcast, Anzahl Hosts, privat/öffentlich/APIPA
- **Zeitstempel**: Unix-Sekunden und -Millisekunden, ISO, **Windows-FILETIME** (z. B. AD `lastLogonTimestamp`), Kalenderwoche
- **Base64 / URL** in beide Richtungen
- **Hash**: SHA-256, SHA-1, SHA-512, MD5
- **JSON** prüfen und formatieren
- **JWT-Token** dekodieren: Ablauf, Benutzer, Tenant, Berechtigungen (Signatur wird nicht geprüft)

Sind die Tastenkürzel schon von einem anderen Programm belegt, stehen beide Fenster weiter im Tray-Menü; Einstellungen → Info zeigt, welches Kürzel belegt ist.

## System-Wächter

Einstellungen → **System-Wächter** (jeder Punkt einzeln abschaltbar):

- **Internet** weg und wieder da (Prüfung wie bei Windows über den Microsoft-Connect-Test; erst nach zwei Fehlversuchen, damit kurze Aussetzer nicht nerven)
- **VPN** verbunden/getrennt: erkennt NetBird, WireGuard, OpenVPN, FortiClient, AnyConnect, GlobalProtect, Tailscale, Zscaler u. a. am Netzwerkadapter
- **Akku** unter 20 % und unter 7 %, Dank beim Einstecken
- **Speicherplatz** unter 10 % oder 10 GB (einmal pro Tag und Laufwerk)
- **CPU** über 90 % oder **Arbeitsspeicher** über 92 %, jeweils eine Minute lang (höchstens alle 30 Minuten)
- **Neustart nach Windows-Updates** ausstehend (einmal pro Tag)
- **PC läuft seit über 7 Tagen** ohne Neustart (einmal pro Tag)

## Garderobe & Geschenke

Tray-Menü → **Garderobe …** Für gemeinsame Erfolge bekommt Sudo Geschenke. Ein Paket fällt vom Himmel, er packt es aus und probiert es direkt an:

| Teil | Freigeschaltet durch |
|---|---|
| Strickmütze | 10 Stunden gemeinsame Zeit |
| Basecap | 50 Bugs gefixt |
| Feuerwehrhelm | 10 Pausen wirklich gemacht (nach einer Erinnerung mind. 5 Min. weg vom PC) |
| Partyhut | Rang „Admin“ |
| Krone | Rang „root“ |
| Weihnachtsmütze | im Dezember |
| Sonnenbrille | Tipp-Combo ×100 |
| Hornbrille | 10.000 Tasten |
| Bauhelm | 250-mal gespeichert |
| Aluhut | „Was weiß Sudo über mich?“ geöffnet |
| Propellermütze | 25-mal aus dem Werkzeugkasten kopiert |
| Pixel-Sonnenbrille | Tipp-Combo ×150 |
| Monokel | 30 Punkte in der Bug-Jagd |
| Admin-Krawatte | 25 Meetings überstanden |
| Fliege | 50 Stunden gemeinsame Zeit |
| Firmenausweis | bei der Sudo-Zentrale angemeldet |

**Saison-Teile** gibt es nur in ihrem Zeitraum – wer dann einmal vorbeischaut, behält sie für immer: Hexenhut (Oktober), Hasenohren (rund um Ostern), Strohhut und Blumenkette (Juni–August), Zylinder (Silvester), Skibrille (Januar/Februar), Schal (November–Februar), Lichterkette und Weihnachtsmütze (Dezember). An Halloween, Ostern, Weihnachten und Silvester zieht Sudo das passende Teil automatisch an (abschaltbar unter Einstellungen → Verhalten → „Saisonale Hüte & Effekte“).

Seit 1.4.1 gibt es drei Plätze: Kopf, Brille und **Hals & Brust**. Gesperrte Teile zeigen in der Garderobe ihren Fortschritt. Eigene Skins ohne die neuen Teile funktionieren weiter; die fehlenden Teile werden dann einfach nicht gezeichnet.

## Erfolge

24 Erfolge, z. B. Bug-Jäger, Tastatur-Ninja, Nachteule, Frühaufsteher, Wochenend-Admin, Meeting-Marathon, Werkzeugmeister. Jeder bringt +15 XP und eine kleine Feier. Übersicht: Statistik → Reiter **Erfolge**.

## Besondere Tage

- **Weihnachten** (Dezember): Mütze und Schneefall, vom 24. bis 26. auch die Lichterkette · **Silvester/Neujahr**: Zylinder und Feuerwerk · **Ostern**: Hasenohren und Ostereier · **Halloween**: Hexenhut und Fledermäuse am Abend · **SysAdmin Day** (letzter Freitag im Juli): Krone · **Tag der Programmierer** (256. Tag), **Freitag der 13.**, **Pi-Tag**
- **Dein Geburtstag** und **Firmenjubiläum**: unter Arbeitstag & Pausen → Besondere Tage eintragen. Dann gibt's Partyhut und Konfetti.
- **Gesetzliche Feiertage in Niedersachsen**: Die Arbeitstag-Erinnerungen pausieren, und Sudo fragt, was du heute hier machst.
- **Jahreszeiten (ab 1.9):** Im Herbst wehen ab und zu ein paar Blätter vorbei, im Frühling Blüten, im Januar/Februar Schneeflocken, im Sommer stöhnt Sudo über die Hitze. Immer nur kurze Böen alle paar Minuten.
- **Tagesmomente (ab 1.9):** Montagmorgen erst mal Kaffee, „Mahlzeit!“ zur Mittagszeit, Freitagnachmittag Vorfreude aufs Wochenende, abends und am Wochenende ein Hinweis auf den Feierabend – jeweils höchstens einmal am Tag und nur, wenn Sudo gerade frei ist.
- **Neu im Leerlauf (ab 1.9):** Sudo jongliert ab und zu mit drei Bällen.
- Saisonale Hüte, Effekte und Tagesmomente lassen sich unter Einstellungen → Verhalten abschalten.

## Spielen

Tray-Menü → **Spielen**:

- **Ball geben**: Ein Stressball, den du greifen und werfen kannst. Er prallt von Fenstern und Taskleiste ab, und Sudo kickt ihn herum. Nimmst du ihn weg, schmollt Sudo eine Weile.
- **Pausenspiel: Bug-Jagd**: 30 Sekunden lang Bugs wegklicken. Sudo zählt mit und merkt sich deinen Rekord.

## Meetings und Bildschirmfreigabe

- **Im Meeting still sein** (Standard: an): Sobald ein Teams-Meeting oder -Anruf, Zoom- oder Webex-Meeting läuft, setzt Sudo sich hin, spielt keine Töne und plaudert nicht. Echte Alarme (Backup, Server) zeigt er weiterhin an, aber lautlos. Nach dem Meeting gibt's einen Spruch und Kaffee.
  Erkannt wird das am Fenstertitel. Englisch und Deutsch werden unterstützt; heißt dein Meeting-Fenster anders, bitte melden.
- **Bei Bildschirmfreigabe unsichtbar** (Standard: an): Sudo taucht in geteilten Bildschirmen, Aufzeichnungen und Screenshots nicht auf, du selbst siehst ihn aber weiter. Willst du Sudo selbst fotografieren, schalte das kurz aus. Funktioniert ab Windows 10 Version 2004.

## Statistik

Tray-Menü → **Statistik …** zeigt Rang mit Fortschritt, Tasten heute und gesamt, gefixte Bugs, Speichervorgänge, Combo-Rekord, gemeldete Alarme, Streicheleinheiten und die gemeinsame Zeit.

## Ereignisse per Webhook

Sudo lauscht lokal auf `http://127.0.0.1:4711/event` (nur von diesem PC aus erreichbar).

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4711/event -ContentType 'application/json' `
  -Body '{"type":"backup_failed","kunde":"Muster GmbH"}'
```

Für PHP liegt eine fertige Funktion in `examples\sudo-notify.php`.

| type | Felder | Reaktion |
|---|---|---|
| `backup_failed` | `kunde`, `text` | Alarm mit roter Rauchwolke |
| `server_down` | `host`, `text` | Alarm |
| `warning` | `text` | misstrauischer Blick |
| `deploy_ok` | `version` | Siegerpose mit Konfetti |
| `success` | `text` | Siegerpose mit Konfetti |
| `ticket` | `ticket`, `titel` | Schriftrolle fällt vom Himmel |
| `message` | `text` | Sprechblase |
| `bug` | – | ein Bug krabbelt los |

`GET http://127.0.0.1:4711/status` zeigt, ob Sudo läuft.

## Relay: Ereignisse von deinem Server

Der Webhook oben ist nur auf deinem PC erreichbar. Damit auch Skripte auf deinem Webspace (Backup-Prüfung, Monitoring, Deploys) Sudo erreichen, gibt es das Relay im Ordner `relay/`. Es braucht nur PHP 8.1 oder neuer, keine Datenbank und keine Konsole.

1. Den Ordner `relay` per FTP hochladen, zum Beispiel als `https://deine-domain.de/sudo-relay/`.
2. Die Adresse im Browser öffnen. Die Seite zeigt zwei frisch erzeugte Tokens.
3. Die Tokens in `config.php` eintragen und die Datei erneut hochladen. Die Startseite zeigt danach „eingerichtet“.
4. In Sudo: Einstellungen → Daten & Verbindungen → **Relay einrichten …** → Relay-Adresse und **read_token** eintragen → „Verbindung testen“ → „Speichern“.
5. Auf der Startseite des Relays ein Testereignis mit dem **send_token** abschicken. Sudo meldet sich innerhalb von etwa 15 Sekunden.

In deinen PHP-Projekten bindest du `examples/sudo-relay-notify.php` ein und rufst zum Beispiel `sudoRelay('backup_failed', ['kunde' => 'Muster GmbH']);` auf.

Sicherheit: Der send_token darf nur senden, der read_token nur abholen. Ereignisse werden nach 7 Tagen gelöscht (einstellbar in `config.php`). Der Ordner `relay/data/` ist per `.htaccess` gesperrt. War Sudo aus, holt er verpasste Ereignisse beim nächsten Start nach; sind es mehr als drei, fasst er sie in einer Sprechblase zusammen (Details im Ereignisprotokoll).

## Skin-Store (ab 1.14)

Neue Outfits für Sudo: Tray → **Skin → Skin-Store …** oder Einstellungen → Daten & Verbindungen → Skin-Store. Mitgeliefert sind 12 Skins (Ritter, Spartaner, Kenshi, Frost-Ninja, Fuchsgeist, IT-Wikinger, Netzwerk-Samurai, Cyber-Ninja, Lichtritter, Oni-Samurai, Schattenritter, Mecha-Samurai). Bezahlt wird mit **XP** (100 bis 600): „Kaufen“ fragt einmal nach, zieht die XP ab und merkt sich den Kauf auf diesem PC. Der Gürtel kann dabei sinken, Garderobe und Erfolge bleiben. Gekaufte Skins stehen danach auch im Tray unter „Skin“.

- **Von der IT:** Die Sudo-Zentrale kann eigene Skins mit XP-Preis an alle, Gruppen oder Personen verteilen oder alle Skins kostenlos machen.
- **Als Datei:** Eine `.sudoskin`-Datei (eigenes Symbol im Explorer) per Doppelklick hinzufügen – sie gehört dir sofort. Im Store unter „Skin-Datei hinzufügen …“ geht es auch. Format: JSON mit `format: "sudoskin"`, `name`, `png` (Base64 der `sudo-sheet.png`) und optional `sheet` (Inhalt der `sudo-sheet.json`).
- **Infoseite:** Abschnitt „Skin-Store“ mit Galerie. „Im Sudo ansehen“ öffnet den Store direkt beim Skin (Link `sudo-ninja://store/<id>`). Die Galerie erzeugt `node tools/build-website-skins.js` aus `assets/skins`.
- **Neue mitgelieferte Skins:** Grafik als `assets/skins/<id>/sudo-sheet.png` (Raster der Standardgrafik) ablegen und in `assets/skins/katalog.json` mit Name und Preis eintragen.

## Grafik und eigene Skins

Sudo wird aus einem Sprite-Sheet gezeichnet (`assets/sudo-sheet.png`, 48 × 52 Pixel pro Bild, 17 Posen). Augen und Stirnband-Enden sind eigene Ebenen, der magentafarbene Gürtel wird automatisch in die Rangfarbe umgefärbt.

- **Größe:** Einstellungen → Allgemein → Klein, Normal oder Groß.
- **Skin wählen (ab 1.9):** Tray → **Skin** oder Einstellungen → Daten & Verbindungen → Skin. Fertige Farbvarianten: Klassik (Türkis), Feuerwehr (Rot), Matrix (Grün), Royal (Lila), Gold, Schnee (Hell). Sie färben die Standardgrafik um, Gesicht und Rang-Gürtel bleiben gleich.
- **Eigene Skins:** Tray → Skin → „Eigene Skins (Ordner öffnen)“ öffnet `%APPDATA%\Sudo\skins`. Je Skin ein Unterordner mit `sudo-sheet.png` und `sudo-sheet.json` (Vorlage im Unterordner `vorlage`), der Ordnername erscheint in der Auswahl. In Aseprite, LibreSprite oder Piskel bearbeiten, speichern, „Neu laden“. Fehlen Hüte und Brillen, nimmt Sudo sie aus der Standardgrafik. Ein alter eigener Skin (Ordner `skin`, bis 1.8) funktioniert weiter und heißt „Eigener Skin“.
- **Sheet neu erzeugen:** `npm run sheet` zeichnet das Standard-Sheet und die Icons aus `tools/build-sheet.js` neu.

## Dateien

| Datei | Zweck |
|---|---|
| `main.js` | Overlay-Fenster, Fenstererkennung, Tastatur, Webhook, Tray |
| `win32.js` | Liest die sichtbaren Fenster über die Windows-API |
| `renderer/sudo.js` | Verhalten, Physik, Reaktionen, Effekte |
| `renderer/lines.js` | Alle Sprüche von Sudo |
| `renderer/stats.html` | Statistik-Fenster mit Reiter „Mein Tag“ |
| `renderer/work.html` | Fenster „Arbeitstag & Pausen“ |
| `work.js` | Arbeitstag, Pausen-Erinnerungen, Bildschirmzeit |
| `watch.js` | System-Wächter |
| `ask.js`, `ask-core.js` | Frag Sudo (Claude), Streaming, Kosten |
| `zentrale.js` | Verbindung zur Sudo-Zentrale |
| `renderer/visit.html` | Fenster „Auf Besuch schicken“ |
| `renderer/privacy.html` | Fenster „Was weiß Sudo über mich?“ |
| `deck.js` | Ninja-Leiste: Einträge und sicheres Starten |
| `health.js` | Gerätezustand-Selbstcheck |
| `quiz.js`, `renderer/quiz-data.js` | Security-Quiz: Ablauf und mitgelieferte Fragen |
| `selfhelp.js`, `renderer/selfhelp*` | Selbsthilfe-Werkzeuge |
| `ops.js`, `renderer/hinweise*` | Hinweise der IT: Störungen und Neustart-Kampagnen |
| `renderer/music*`, `preload-music.js` | Musikwunsch |
| `assets/menu/`, `tools/build-menu-icons.py` | Pixel-Icons im Tray-Menü (16 px und @2x) |
| `renderer/quiz.html` | Quiz-Fenster |
| `DATENSCHUTZ-INFO.md` | Vorlage: Infoblatt für Mitarbeitende, Datenschutz und Betriebsrat |
| `renderer/ask.html` | Fragefenster |
| `intune/zentrale-vorgabe.ps1` | Zentrale per Intune vorgeben |
| `intel.js` | IT-Lage: Microsoft-/Azure-Status, Datenlecks, Passwort-Check |
| `renderer/lage.html` | Fenster „IT-Lage“ |
| `renderer/i18n.js` | Übersetzung (Deutsch, Englisch, Japanisch) |
| `renderer/lang/` | Wörterbücher `en.js`, `ja.js` |
| `renderer/settings.html` | Einstellungs-Zentrale |
| `renderer/tour.html` | Willkommens-Tour |
| `intune/intune-paket.ps1` | erzeugt das .intunewin-Paket |
| `CHANGELOG.md` | Versionsgeschichte |
| `renderer/progress.js` | Garderobe, Erfolge, besondere Tage und Feiertage |
| `renderer/wardrobe.html` | Garderobe |
| `reminders.js` | Erinnerungen und Notizen, inkl. Zeit-Erkennung |
| `renderer/tools.html` | Werkzeugkasten |
| `renderer/quick.html` | Fenster Erinnerungen & Notizen |
| `renderer/sheet.js` | Lädt das Sprite-Sheet und färbt den Gürtel ein |
| `renderer/sprite.js` | Ersatzgrafik, falls das Sheet fehlt oder fehlerhaft ist |
| `tools/build-sheet.js` | Zeichnet Sprite-Sheet und Icons |
| `renderer/relay.html` | Fenster „Relay einrichten“ |
| `relay/` | PHP-Relay für deinen Webspace |

Einstellungen, Statistik und `events.log` liegen unter `%APPDATA%\Sudo\`.

## Bekannte Grenzen

- **Hier nicht unter Windows getestet:** MSI-/Setup-Build, Auto-Update, Intune-Paket und das Wandern über mehrere Monitore. Bitte zuerst auf einem Test-PC bzw. mit einer Pilotgruppe ausprobieren.
- Gebaut werden muss unter Windows (BAUEN.bat); das MSI braucht dort beim ersten Mal einen Download des WiX-Toolsets, den electron-builder automatisch erledigt.
- Die EXE/MSI ist nicht signiert (SmartScreen-Hinweis, siehe oben).
- Von selbst wandert Sudo nur zu nebeneinander angeordneten Bildschirmen; per Ziehen oder Tray-Menü geht jede Anordnung.
- Die Ninja-Leiste und das Ziehen über Monitore wurden hier mit simulierten Bildschirmen unter Linux getestet, noch nicht unter Windows.
- In Fenstern, die als Administrator laufen, hört Sudo keine Tasten (Windows-Sicherheit).
- Der öffentliche Microsoft-Status deckt die Verbraucherdienste ab; tenant-spezifische Störungen gibt es nur im Admin Center.
- Frag Sudo, die Zentrale, Spotify und SharePoint (Microsoft Graph) wurden hier gegen nachgebaute Server getestet, nicht gegen die echten Dienste und nicht unter Windows.
- Die CPU-Messungen stammen aus einer Linux-Testumgebung ohne Grafikkarte; unter Windows mit GPU sind die absoluten Werte niedriger.
- Die Webseiten-Erkennung hängt am Fenstertitel; Browser, die keinen Seitentitel zeigen, erkennt Sudo nur als „Browser“.
- Das Relay wird alle 15 Sekunden abgefragt; Meldungen kommen also mit kurzer Verzögerung an.
- Das Standard-Sheet ist per Code gezeichnet. Für echte Handarbeit-Pixelart bietet sich ein eigener Skin an.
- Besuche wurden hier mit zwei Geräten gegen beide Zentralen getestet (Linux), noch nicht im Büro unter Windows.
- **Selbsthilfe und Neustart wurden hier nur unter Linux getestet:** der Netzwerk-Check echt, die Windows-Werkzeuge (Teams, Outlook, OneDrive, Explorer, Temp, DNS) und „Jetzt neu starten“ (`shutdown /r /t 120`) nur im Testmodus. Bitte vor dem Verteilen auf einem Windows-Test-PC jedes Werkzeug einmal ausprobieren.
- Störungen und Neustart-Kampagnen wurden mit einem echten Sudo gegen die PHP-Zentrale und per WebSocket gegen die Node-Zentrale getestet.
- Der Gerätezustand wurde hier mit Testwerten geprüft; die PowerShell-Abfragen selbst laufen nur unter Windows. Auf Windows Server fehlt das Sicherheitscenter – dort zeigt Sudo für Virenschutz/Firewall ggf. „unbekannt“ bzw. nur den Defender-Status.
