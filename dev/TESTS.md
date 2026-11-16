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
Neu in 1.11: `SUDO_HISTORY_JS` (JS im Verlaufsfenster, zusammen mit `SUDO_OPEN_HISTORY`; Ergebnis als `[history-js]` in der Konsole) – damit lässt sich die Suche prüfen, z. B. Suchfeld `.q` füllen und `.item` zählen. Sprite-Vorschau: `npm run sheet -- --vorschau`.
Neu in 1.10: `SUDO_OPEN_MEET`, `SUDO_OPEN_PULSE`, `SUDO_OPEN_START` (Fenster öffnen, Wert = Verzögerung in ms), `SUDO_TIP=excel` (Tipp-Blase), `SUDO_CARE=lockhint` (Sperr-Erinnerung), `SUDO_FAKE_ONBOARD=1` (Checkliste mit erfundenen Prüfergebnissen), `SUDO_FAKE_SELFHELP=1` (Langsam-Analyse mit Beispielwerten).

Übersetzungen prüfen: `node sudo-desktop/tools/i18n-extract.js en` (bzw. `ja`) listet fehlende Einträge.
