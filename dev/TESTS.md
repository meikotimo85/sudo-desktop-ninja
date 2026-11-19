# Lokal testen (Windows, PowerShell)

Voraussetzungen: Node.js 22.13 oder neuer, Python 3, PHP 8.2+ mit `pdo_sqlite` (z. B. `winget install PHP.PHP.8.3`).

## Nachgebaute Dienste
| Dienst | Start | Port |
|---|---|---|
| YouTube-Feeds + Spotify-API | `node dev/mock-spotify-youtube.js` | 4800 |
| Claude-API (Frag Sudo, KI-Besuche) | `node sudo-desktop/tools/mock-anthropic.js` (mit `$env:MOCK_LOG="claude.json"` wird die letzte Anfrage gespeichert) | 4799 |
| Microsoft Graph (SharePoint, ab 1.9) | `node dev/mock-graph.js` (Client Secret im Nachbau: `geheim`) | 4801 |

Der Spotify-Nachbau kennt das Gerät `echo1` („Echo Büro“), drei Titel (`t1`, `t2`, `t3` explicit) und eine echte Warteschlange.
Hilfsadressen: `/_queue`, `/_state`, `/_next` (nächster Titel), `/_add?ch=…&id=…&title=…` (neues YouTube-Video).

## PHP-Zentrale
```powershell
copy dev\config.test.php sudo-zentrale-php\config.php
Remove-Item sudo-zentrale-php\data\*.sqlite*, sudo-zentrale-php\data\.secret -ErrorAction SilentlyContinue
cd sudo-zentrale-php; php -S 127.0.0.1:8091 index.php
```
Verwaltung: http://127.0.0.1:8091/admin (Passwort `test-passwort-16`).

## Node-Zentrale
```powershell
cd sudo-zentrale; npm install
$env:PORT=8090; $env:PUBLIC_URL='http://127.0.0.1:8090'; $env:DATA_DIR="$PWD\data-test"
$env:ADMIN_PASSWORD='test-passwort-16'; $env:LOCAL_LOGIN='true'; $env:FIRST_ENROLL_CODE='TEST-PHP-1234'
$env:YOUTUBE_BASE='http://127.0.0.1:4800'; $env:SPOTIFY_API='http://127.0.0.1:4800'; $env:SPOTIFY_ACCOUNTS='http://127.0.0.1:4800'
npm start
```

## End-to-End-Test YouTube + Musikwünsche
Frische Datenbank und frisch gestarteter Nachbau nötig.
```powershell
python dev\test-media.py                          # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-media.py   # gegen Node
```
Erwartet u. a.: `live2 … ('Never Gonna Give You Up', 'playing')`, `veto Africa: (200 …)`, `live3 … ('Africa', 'skipped')`, am Ende `Durchgelaufen (PHP …)` bzw. `(Node …)`.
Gegen Node überspringt der Test die Abrufe über `/api/poll` (Zeilen `poll media`, `poll events`, `ansage`), weil die Node-Zentrale über WebSocket liefert.

## End-to-End-Test Wissen (SharePoint, ab 1.9)
Frische Datenbank und frisch gestarteter Graph-Nachbau nötig.
```powershell
python dev\test-kb.py                             # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-kb.py      # gegen Node (vorher $env:GRAPH_API='http://127.0.0.1:4801/v1.0'; $env:GRAPH_LOGIN='http://127.0.0.1:4801')
```
Erwartet u. a.: `ordner (AllItems-Link): 200 … 'items': 4, 'read': 3`, `abgleich ohne änderung … downloads + 0`, `suche wireguard: ['VPN einrichten']`.

## End-to-End-Test Mitarbeiter-Erlebnis (ab 1.10)
Frische Datenbank nötig, kein Nachbau.
```powershell
python dev\test-dex.py                             # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-dex.py      # gegen Node
```
Erwartet: alle Zeilen „OK“, am Ende „Alles gut“. Gegen PHP prüft der Test zusätzlich, was `/api/poll` unter `dex` liefert.

## End-to-End-Test Plugins (ab 1.12)
Frische Datenbank nötig, kein Nachbau. Gegen Node holt der Test die Konfiguration per WebSocket (braucht `node` ab 22 im PATH).
```powershell
python dev\test-plugins.py                         # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-plugins.py  # gegen Node
```
Erwartet: 32 Zeilen „OK“, am Ende „Alles gut“.

Im Client: `SUDO_PLUGIN_ADD=<html-datei>` fügt ein eigenes Plugin hinzu, `SUDO_OPEN_PLUGIN=<id>` (oder `zentrale/<id>`) öffnet es, `SUDO_PLUGIN_JS` führt JS darin aus (Ergebnis als `[plugin-js]`). `SUDO_ENROLL="http://127.0.0.1:8091|TEST-PHP-1234"` meldet den Test-Sudo an der Zentrale an – so lässt sich die Verteilung von der Zentrale bis ins Fenster prüfen. Endung `.sudoplugin` (ab 1.13): `npx electron . --user-data-dir=<Ordner> "<pfad>\x.sudoplugin"` entspricht einem Doppelklick, `SUDO_DIALOG_ANSWER=0` (öffnen), `1` (nur hinzufügen) oder `2` (abbrechen) beantwortet die Rückfrage. Läuft schon ein Test-Sudo mit demselben Datenordner, kommt die Datei dort an. `SUDO_ASSOC_TEST=1` trägt die Endung testweise als `.sudoplugintest` unter `HKCU\Software\Classes` ein (danach `.sudoplugintest` und `Sudo.PluginTest` wieder löschen). `SUDO_TRAY_DUMP=1` gibt das Tray-Menü als `[tray]` aus (prüft, ob „Plugins“ mit allen Einträgen erscheint). Abschottung prüfen: ein Plugin mit `fetch('http://127.0.0.1:9/')` muss mit „Failed to fetch“ scheitern, im `events.log` steht „Plugin: Zugriff gesperrt“.

## End-to-End-Test Notfall-Zugang (ab 1.14)
Frische Datenbank nötig. Der Server muss mit dem öffentlichen Beispielschlüssel `JBSWY3DPEHPK3PXP` starten: PHP mit `$env:SUDO_TEST_TOTP`, Node mit `$env:ADMIN_TOTP`.
```powershell
$env:SUDO_TEST_TOTP='JBSWY3DPEHPK3PXP'; cd sudo-zentrale-php; php -S 127.0.0.1:8091 index.php   # dann: python dev\test-auth.py
```
Erwartet: alle Zeilen „OK“ (PHP prüft zusätzlich, dass `config.php.bak`, `/app` und `/data` gesperrt sind), am Ende „Alles gut“.

## End-to-End-Test Skins (ab 1.14)
Frische Datenbank nötig, kein Nachbau.
```powershell
python dev\test-skins.py                           # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-skins.py    # gegen Node
```
Erwartet: 24 Zeilen „OK“, am Ende „Alles gut“. Im Client: `SUDO_OPEN_STORE=1500` öffnet den Skin-Store, `SUDO_TEST_XP=350` gibt Startguthaben, `SUDO_STORE_JS` führt JS im Store aus (`[store-js]`).

## End-to-End-Test Ideen-Board (ab 1.15)
Frische Datenbank nötig, kein Nachbau. Für die Mail-Prüfung die Zentrale mit Mail-Ordner starten (PHP: `$env:SUDO_TEST_MAILDIR` vor `php -S`, Node: `MAIL_DIR`) und denselben Ordner beim Test als `SUDO_TEST_MAILDIR` setzen.
```powershell
python dev\test-ideas.py                           # gegen PHP (8091)
$env:SUDO_BASE='http://127.0.0.1:8090'; python dev\test-ideas.py    # gegen Node
```
Erwartet: 40 Zeilen „OK“ (ohne Mail-Ordner 38), am Ende „Alles grün.“

## Klick-Prüfung (ab Client 1.14.2)
`SUDO_FAKE_COVER=1` lässt Sudo als dauerhaft verdeckt gelten: Im Protokoll stehen zweimal „nach vorn geholt“, dann „Overlay wird neu erzeugt“ und danach nur noch ein Hinweis (`[click-check]` in der Konsole). `SUDO_CLICK_PROBE=1` schaltet das Overlay kurz klickbar und prüft mit WindowFromPoint, ob Windows Sudo an seiner Stelle findet (`[click-probe] {"sudo":true}`). `SUDO_RECREATE=hand` stellt „Sudo neu laden“ mit Momentaufnahme nach („Neu laden von Hand – …“ im Protokoll).

## Client (Sudo Desktop)
```powershell
cd sudo-desktop; npm install; npm start
```
Testmodus: `$env:SUDO_TEST='1'` aktiviert Test-Hooks (Fenster öffnen, JS ausführen, Screenshot, dann beenden), z. B.:
```powershell
$env:SUDO_TEST='1'; $env:SUDO_OPEN_SETTINGS='behavior'; $env:SUDO_TEST_MS='8000'; $env:SUDO_SHOT="$PWD\shot.png"; npx electron .
```
Weitere Hooks: `SUDO_OPEN_MUSIC`, `SUDO_MUSIC_JS`, `SUDO_SETTINGS_JS`, `SUDO_OPEN_HELP`, `SUDO_OPEN_QUIZ`, `SUDO_OPEN_PRIVACY`, `SUDO_YT_BASE` (eigene Kanäle gegen den Nachbau, prüft dann alle 6 s), `SUDO_TEST_XP`, `SUDO_UNLOCK_ALL` – siehe Ende von `main.js`.
Achtung: Der Testmodus nutzt sonst die echten Einstellungen unter `%APPDATA%\Sudo`. Besser mit eigenem Datenordner starten: `npx electron . --user-data-dir=C:\temp\sudo-test` – das schützt die echten Daten und läuft auch neben einem installierten Sudo.
Neu in 1.11.1: `SUDO_FAKE_LOCK_MS=3000` meldet nach 3 s „gesperrt“ ohne „entsperrt“ – im `events.log` muss nach gut 10 s „Entsperrt (ohne Meldung von Windows erkannt)“ stehen; `SUDO_FAKE_RDP_MS=20000` meldet ab 20 s eine RDP-Sitzung („Sitzung jetzt über Remotedesktop“).
Neu in 1.11: `SUDO_HISTORY_JS` (JS im Verlaufsfenster, zusammen mit `SUDO_OPEN_HISTORY`; Ergebnis als `[history-js]` in der Konsole) – damit lässt sich die Suche prüfen, z. B. Suchfeld `.q` füllen und `.item` zählen. Sprite-Vorschau: `npm run sheet -- --vorschau`.
Neu in 1.10: `SUDO_OPEN_MEET`, `SUDO_OPEN_PULSE`, `SUDO_OPEN_START` (Fenster öffnen, Wert = Verzögerung in ms), `SUDO_TIP=excel` (Tipp-Blase), `SUDO_CARE=lockhint` (Sperr-Erinnerung), `SUDO_FAKE_ONBOARD=1` (Checkliste mit erfundenen Prüfergebnissen), `SUDO_FAKE_SELFHELP=1` (Langsam-Analyse mit Beispielwerten).

Übersetzungen prüfen: `node sudo-desktop/tools/i18n-extract.js en` (bzw. `ja`) listet fehlende Einträge.
