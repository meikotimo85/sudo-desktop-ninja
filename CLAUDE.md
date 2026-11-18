# Sudo – Desktop-Ninja für dich oder deine Firma

Pixel-Ninja als Windows-Desktop-Begleiter im IT-Stil, plus eine „Sudo-Zentrale“, über die die IT Meldungen, Störungen, Quiz, YouTube-Kanäle und Musikwünsche an alle Sudos verteilt. Aktueller Stand: Client **1.13.0**, Zentralen **1.13.0**.

## Arbeitsweise
- **Immer auf Deutsch antworten**, auch Zusammenfassungen. Code-Kommentare und Doku ebenfalls auf Deutsch.
- Nach jeder Version: Liste, **welche Dateien der PHP-Zentrale ersetzt werden müssen** (produktiver Server; `config.php` und `data/` nie anfassen), und ob der Client neu verteilt werden muss.
- Keine Emojis in Oberfläche oder Icons. Grafiken als Pixel-Art (siehe `sudo-desktop/tools/build-menu-icons.py`).
- Keine Zugangsdaten in Code, Beispielen oder Tests. Echte Secrets (NinjaOne, Sudo-API-Schlüssel, Spotify) gehören in Umgebungsvariablen, n8n-Credentials oder die Zentrale-Einstellungen.

## Aufbau
| Ordner | Was | Technik |
|---|---|---|
| `sudo-desktop/` | Client für Windows | Electron 44, kein Framework, Vanilla JS |
| `sudo-zentrale-php/` | Zentrale, beim Autor **produktiv** im Einsatz | PHP 8 + SQLite (PDO), ohne Composer, ohne Cron |
| `sudo-zentrale/` | Zentrale als Node-Variante (Docker) | Node ≥ 22.13, Fastify 5, `node:sqlite` |
| `sudo-website/` | Infoseite | statisches HTML/JS |
| `dev/` | Test-Nachbauten und E2E-Test | siehe `dev/TESTS.md` |

### PHP- und Node-Zentrale sind Zwillinge
Jede Änderung an der Zentrale in **beiden** umsetzen, gleiche Routen, gleiche JSON-Antworten, gleiche Fehlermeldungen:
- `app/core.php` ↔ `src/hub.js` (Ereignisse, Ziele, Warteschlange `pending_for`)
- `app/media.php` ↔ `src/media.js` (YouTube, Spotify)
- `app/kb.php` ↔ `src/kb.js` (Wissen aus SharePoint über Microsoft Graph, Suche, Kontext für Frag Sudo)
- `app/rules.php` ↔ `src/rules.js` (Regeln)
- `app/dex.php` ↔ `src/dex.js` (Mitarbeiter-Erlebnis ab 1.10: Stimmungsbarometer, „Läuft es wieder?“, Start-Checkliste, eigene Tipps)
- `app/plugins.php` ↔ `src/plugins.js` (Plugins ab 1.12: Hochladen, Ziele, Abruf `GET /api/plugins/<id>`)
- `app/admin.php` + `index.php` ↔ `src/server.js` (Routen)
- `app/db.php` ↔ `src/db.js` (Schema)
- Die Verwaltungsoberfläche ist identisch: `sudo-zentrale-php/admin/admin.js` und `admin.css` nach jeder Änderung nach `sudo-zentrale/public/admin/` kopieren.

### Wichtige Mechanik
- **Ereignistypen** stehen an drei Stellen und müssen gleich sein: `EVENT_TYPES` in `app/core.php`, `src/hub.js`, `sudo-desktop/main.js`.
- **Client-Protokoll:** Der Client ruft `/api/poll` ab (Bearer-Token aus der Registrierung). Antwort enthält Ereignisse plus `health`, `quiz`, `ops` (Hilfe/Störungen/Neustarts), `media` (`{youtube, music: {enabled, cost}}`) und ab 1.10 `dex` (`{pulse, onboard, tips}`). Ziele: `all`, `group:<Gruppe>`, `device:<Gerät>`, `user:<UPN>`.
- **Schema-Migrationen PHP:** neue Tabellen per `CREATE TABLE IF NOT EXISTS` in `db.php`. Neue Spalten seit 1.9 mit eigener Markierung (Settings-Schlüssel wie `mig_19_diag`) statt der alten `schema`-Nummer, damit die Reihenfolge egal ist. Node: `ALTER` in `try/catch` in `db.js`.
- `Db::upsert($table, $row, $keys, $inc)`: Spalten in `$inc` werden **addiert**, nicht ersetzt – zum Überschreiben `$inc` weglassen.
- **Hintergrundjobs PHP ohne Cron:** nach der Poll-Antwort per `register_shutdown_function` + `fastcgi_finish_request`, gedrosselt über Settings-Schlüssel (`youtube_next`, `music_watch_next`). Node nutzt `setInterval`.
- **Secrets in Settings** (Spotify, SharePoint) werden nie an den Browser gegeben: PHP `SECRET_SETTINGS` in `core.php`, Node `SECRET_KEYS` (aus `media.js` + `kb.js`).
- **Spotify:** Premium nötig, Dev-Modus max. 5 Nutzer. Titel lassen sich nicht aus der Warteschlange löschen → „Überspringen“ und „Sperren“ (Auto-Skip + Sperrliste `music_blocked`).

### Client (`sudo-desktop`)
- `main.js` ist der Hauptprozess (Fenster, Tray, IPC, Einstellungen, Verlauf, Skins). Module: `zentrale.js` (Verbindung zur Zentrale), `ops.js` (Störungen/Neustarts), `selfhelp.js`, `health.js`, `quiz.js`, `intel.js` (IT-Lage), `youtube.js` (eigene Kanäle), `diag.js` (CPU/RAM, Fehler, Selbstheilung), `slow.js` (Langsam-Analyse, 1.10), `habits.js` (Sperr-Erinnerung, Tipps, 1.10), `checkin.js` (Stimmung, Start-Checkliste, 1.10), `plugins.js` (Plugins, 1.12), `deck.js`, `work.js`, `reminders.js`, `ask*.js` (Claude).
- **Leistung (1.9):** `renderer/sudo.js` malt Sudo nur neu, wenn sich der Schlüssel `lastSpriteKey` ändert, und löscht auf der bildschirmgroßen Effekt-Ebene nur den Bereich `fxBox`. Neue Effekte müssen in `fxEmpty()` und `fxBounds()` berücksichtigt werden, sonst bleiben Reste stehen oder sie werden nicht gezeichnet. Ruhige Phasen laufen mit 30, Schlafen mit 15 Bildern/s.
- **Skins (1.9):** Farbvarianten in `SKIN_VARIANTS` (main.js) färben das Standard-Sheet beim Laden um (`recolor` in `renderer/sheet.js`); eigene Skins unter `%APPDATA%\Sudo\skins\<Name>`.
- Jedes Fenster: `renderer/<name>.html` + `<name>-window.js` + `preload-<name>.js`. Strikte CSP, `contextIsolation`.
- **Neues Modul? Unbedingt in `package.json → build.files` eintragen**, sonst fehlt es in der gebauten App.
- Einstellungen: `settings` in `main.js` (Defaults + Merge beim Laden), Setter in `SETTERS`, Aktionen in `ipcMain.handle('center-action')`.
- **Übersetzung:** Deutscher Text ist der Schlüssel. Wörterbücher `renderer/lang/en.js` und `ja.js` (alphabetisch). Platzhalter `{x}`, `{n}` machen einen Eintrag zum Muster. Japanisch: „Sudoハブ“ für Zentrale. Prüfen mit `node tools/i18n-extract.js en`.
- Menütexte mit „&“ über `ML()` escapen.
- **Mitarbeiter-Erlebnis (1.10):** Stimmungs-Antworten nie mit Gerät speichern (nur `pulse_done` merkt „hat geantwortet“), Auswertung erst ab `pulse_min`. Prüfen vor dem Merken (sonst zählt eine ungültige Antwort als beantwortet).
- **Plugins (1.12):** Ein Plugin ist eine HTML-Datei (≤ 2 MB), Angaben über `<title>` und `<meta name="sudo-plugin-id|version|size">`. Ablage `%APPDATA%\Sudo\plugins\eigene|zentrale\<id>\`. Fenster ohne Preload, `sandbox`, eigene Partition je Plugin; `webRequest` sperrt alles außer den eigenen Dateien, WebRTC aus, nur `clipboard-sanitized-write` erlaubt. Die Zentrale schickt in der Konfiguration `plugins: {user, items:[{id,name,version,sha,w,h}]}`, der Client lädt bei neuer Prüfsumme nach. Ab 1.13 Endung `.sudoplugin`: `plugins.registerFileType()` schreibt beim Start `HKCU\Software\Classes\.sudoplugin` → `Sudo.Plugin` (Symbol `assets/plugin-file.ico`, kopiert nach `%APPDATA%\Sudo`, Erzeugung mit `node tools/build-plugin-icon.js`); Doppelklick kommt über `process.argv` bzw. `second-instance` an `offerPlugin()` (immer mit Rückfrage). **Kunden- oder firmenspezifische Plugins nie ins Repo** – nur über die Zentrale verteilen.
- **Verlauf (1.11):** `verlauf.json` bleibt lokal und geht nie an die Zentrale. Aufbewahrung über `settings.history.days` (0 = aus, 7, 30, 90, 365; Standard 30), höchstens 2000 Einträge; `historyLoad()` löscht Abgelaufenes auch aus der Datei. Einträge tragen optional `ticket` und `device` (aus `ev.ticket` bzw. `ev.host`/`ev.device`) für die Suche.
- **Linux (Vorschau):** `x11.js` ist das Gegenstück zu `win32.js` (gleiche Schnittstelle, libX11 über koffi); `main.js` wählt per `process.platform`. Linux-Programmnamen werden auf die Windows-Schreibweise gebracht (`code` → `code.exe`, Terminals → `windowsterminal.exe`), damit `APP_TAGS`/`BROWSERS`/`MEETING` für beide gelten – neue Programme ggf. in `EXE_MAP` ergänzen. Unter Wayland erzwingt `main.js` XWayland (`--ozone-platform=x11`). Neue Windows-Aufrufe (PowerShell, `reg.exe`, `%APPDATA%`) immer mit `process.platform` absichern; Ninja-Leiste hat eigene `BUILTIN_LINUX`. Bauen: `npm run dist:linux` (AppImage + .deb).
- Electron `net.fetch` mit `redirect: 'manual'` wirft bei Weiterleitungen („Redirect was cancelled“) – das heißt „erreichbar“.
- Testmodus `SUDO_TEST=1` mit vielen Hooks, siehe `dev/TESTS.md`. Neu in 1.9: `SUDO_METRICS` (CPU/RAM alle 3 s), `SUDO_CRASH` (Overlay-Absturz), `SUDO_RENDER_ERR`, `SUDO_OVERLAY_JS` (JS im Overlay, z. B. `__sudoTest.act("juggle")`), `SUDO_OPEN_KB`, `SUDO_OPEN_HISTORY`. Neu in 1.12: `SUDO_PLUGIN_ADD=<datei>`, `SUDO_OPEN_PLUGIN=[eigene|zentrale/]<id>`, `SUDO_PLUGIN_JS` (JS im Plugin-Fenster), `SUDO_ENROLL="<url>|<code>"` (an Zentrale anmelden). Neu in 1.13: `SUDO_ASSOC_TEST=1` (Endung als `.sudoplugintest` eintragen, danach wieder löschen), `SUDO_DIALOG_ANSWER=0|1|2` (Rückfrage beim Hinzufügen beantworten); Start mit Dateipfad als Argument = Doppelklick. Neu in 1.12.1: `SUDO_TRAY_DUMP=1` (Tray-Menü als `[tray]` ausgeben). Neu in 1.11.1: `SUDO_FAKE_LOCK_MS` (Sperre ohne Entsperren nachstellen), `SUDO_FAKE_RDP_MS` (Wechsel auf RDP nachstellen). Neu in 1.11: `npm run sheet -- --vorschau` schreibt `tools/sheet-preview.png` (alle Posen vergrößert). Neu in 1.10: `SUDO_OPEN_MEET`, `SUDO_OPEN_PULSE`, `SUDO_OPEN_START`, `SUDO_TIP=<programm>`, `SUDO_FAKE_ONBOARD`. Eigener Datenordner mit `npx electron . --user-data-dir=<Ordner>` – schützt die echten Daten und läuft neben einem installierten Sudo.

## Entra-Setup (ab Zentrale 1.9.1)
- `werkzeuge/entra-setup/Sudo-Entra-Setup.ps1` (in beiden Zentralen identisch) richtet die Entra-App ein. Es liest `GET /api/entra-manifest` (PHP `entra_manifest()` in `core.php`, Node in `server.js`).
- **Braucht eine neue Funktion Microsoft-Berechtigungen, nur das Manifest erweitern** (neuer Eintrag unter `features` mit `graph.application`/`graph.delegated`, ggf. `siteRole`, `redirect`, `settings`). Das Setup verarbeitet das generisch. `manifest` nur erhöhen, wenn sich der Aufbau ändert.
- Die `.ps1` muss UTF-8 **mit** BOM und CRLF bleiben (sonst zerlegt Windows PowerShell 5.1 die Umlaute) und darf keine PS-7-Syntax nutzen (`??`, Ternary, `&&`). **Keine typografischen Anführungszeichen** („ “ ” ‘ ’ ‚) im Skript – PowerShell behandelt sie als echte Anführungszeichen, das zerlegt die Zeichenketten. Stattdessen » « oder ' verwenden.

## Release-Checkliste
1. Version erhöhen: `sudo-desktop/package.json`, Kopfzeile `sudo-desktop/LIESMICH.md`, `APP_VERSION` in `sudo-zentrale-php/app/core.php`, `sudo-zentrale/package.json`, `sudo-website/einstellungen.js`.
2. `sudo-desktop/CHANGELOG.md` oben ergänzen; LIESMICH (Client und beide Zentralen) und `DATENSCHUTZ-INFO.md` + Datenschutzfenster (`renderer/privacy-window.js`) anpassen, wenn Daten den PC verlassen.
3. EN/JA-Übersetzungen nachziehen.
4. Tests aus `dev/TESTS.md` laufen lassen.
5. Client bauen: `BAUEN.bat` (liest die echte Update-Adresse aus `sudo-desktop/update-adresse.txt`, nicht im Repo), dann `INTUNE-PAKET.bat` → Upload in Intune (Erkennung über die Versionsnummer).
6. Vorgabe-Datei für Clients: `intune/zentrale-vorgabe.ps1` (auch über NinjaOne mit `SudoUrl`/`SudoCode`).

## Bekannte Stolperfallen
- PowerShell 5.1 schreibt UTF-8 **mit BOM** → JSON immer mit `UTF8Encoding($false)` schreiben; der Client entfernt ein BOM vorsichtshalber.
- `icacls` auf deutschem Windows: Gruppen über **SIDs**, nicht über englische Namen.
- Zentrale-Warteschlange: erst filtern, dann begrenzen (Fehler aus 1.7: `LIMIT 30` vor dem Zielfilter → Geräte bekamen nichts).
- PHP-Zentrale läuft mit Zeitzone aus `config.php` (`timezone`, Standard Europe/Berlin).
