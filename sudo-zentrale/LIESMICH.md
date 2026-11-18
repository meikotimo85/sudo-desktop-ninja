# Sudo-Zentrale 1.13.0 – Node.js-Version (VPS mit Docker)

> Kein VPS? Die **PHP-Version** (`sudo-zentrale-php`) läuft auf normalem Webspace und hat dieselbe Verwaltung.

Der kleine Server für alle Sudos einer Firma, z. B. unter **https://sudo.example.com**.

- **Meldungen** an alle Sudos, an Gruppen oder einzelne Geräte – sofort per WebSocket, Offline-Geräte bekommen sie beim nächsten Verbinden.
- **Ereignis-API** für Skripte (Backup-Prüfung, Monitoring, Deploy) mit eigenen API-Schlüsseln. Ersetzt das PHP-Relay.
- **Frag Sudo über die Zentrale:** Der Claude-API-Schlüssel liegt nur hier; Budget pro Gerät und Tag sowie pro Monat. Gezählt werden Token und Kosten, **Fragen und Antworten werden nicht gespeichert**.
- **Verwaltung** im Browser mit Anmeldung über **Microsoft Entra ID** (plus optionalem Notfall-Passwort), Geräteliste, Registrierungscodes, Verbrauch, Protokoll.

Technik: Node.js 24 (läuft ab 22.13), Fastify, WebSockets, SQLite (in Node eingebaut – keine nativen Pakete). Alles in einem Docker-Container, Daten in `./data`.

---

## 1. Installation auf dem VPS (Docker + aaPanel)

1. **DNS:** `sudo.example.com` als A-Record auf den VPS zeigen lassen.
2. Ordner hochladen, z. B. nach `/opt/sudo-zentrale`, dann per SSH:
   ```bash
   cd /opt/sudo-zentrale
   cp .env.example .env && nano .env      # ausfüllen, siehe Abschnitt 2
   mkdir -p data && chown 1000:1000 data  # der Container läuft als Benutzer „node“ (1000)
   docker compose up -d --build
   docker compose logs -f                 # „Sudo-Zentrale 1.3.0 läuft …“
   ```
   Die Zentrale lauscht nur lokal auf `127.0.0.1:8080`.
3. **aaPanel:** Website `sudo.example.com` anlegen → **SSL** (Let's Encrypt) aktivieren, „HTTPS erzwingen“ an → **Reverse Proxy** auf `http://127.0.0.1:8080`.
   Wichtig sind WebSockets und das Streaming der KI-Antworten. In der Proxy-Konfiguration (Konfigurationsdatei der Seite) sollte stehen:
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 3600s;      # WebSocket offen halten
       proxy_buffering off;           # KI-Antworten sofort durchreichen
   }
   ```
4. Test: `https://sudo.example.com/healthz` zeigt `{"ok":true,…}`, `https://sudo.example.com/admin/` die Anmeldung.

Ohne Docker geht es auch: Node.js 22.13 oder neuer, `npm ci --omit=dev`, Umgebungsvariablen setzen, `npm start` (z. B. mit PM2).

## 2. Einstellungen (`.env`)

| Variable | Bedeutung |
|---|---|
| `PUBLIC_URL` | Öffentliche Adresse, z. B. `https://sudo.example.com` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Anmeldung mit Microsoft (siehe 3.) |
| `GRAPH_API`, `GRAPH_LOGIN` | Nur für Tests: andere Adressen für Microsoft Graph (Standard: die echten) |
| `ADMIN_USERS` | Wer in die Verwaltung darf, z. B. `admin@firma.de, kollege@firma.de` |
| `ADMIN_GROUP_ID` | Alternativ: Objekt-ID einer Entra-Gruppe (Gruppen-Claim im Token aktivieren) |
| `ADMIN_PASSWORD` | Notfall-Zugang (Hash erzeugen, siehe unten). Gilt neben Entra nur mit `LOCAL_LOGIN=true` |
| `ANTHROPIC_API_KEY` | Claude-API-Schlüssel für „Frag Sudo“ (console.anthropic.com) |
| `FIRST_ENROLL_CODE` | Optional: erster Registrierungscode, sonst in der Verwaltung erzeugen |
| `COOKIE_SECRET` | Optional; leer = wird erzeugt und in `data/.cookie-secret` gemerkt |

Notfall-Passwort als Hash erzeugen:
```bash
docker compose run --rm zentrale npm run passwort
```
Ausgabe (`ADMIN_PASSWORD=scrypt$…`) in die `.env` kopieren, dann `docker compose up -d`.

## 3. Anmeldung mit Microsoft Entra ID einrichten

1. **Entra Admin Center → Anwendungen → App-Registrierungen → Neue Registrierung**
   - Name: `Sudo-Zentrale`, Kontotyp: *Nur Konten in diesem Organisationsverzeichnis*
   - Umleitungs-URI: Plattform **Web**, `https://sudo.example.com/auth/callback`
2. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel** – den *Wert* sofort kopieren (`ENTRA_CLIENT_SECRET`).
3. Auf der Übersichtsseite **Verzeichnis-ID (Mandant)** → `ENTRA_TENANT_ID`, **Anwendungs-ID (Client)** → `ENTRA_CLIENT_ID`.
4. Berechtigungen: Standard (`openid`, `profile`, `email`) genügt, kein Admin-Consent nötig.
5. Optional für Gruppen statt Einzelpersonen: **Tokenkonfiguration → Gruppenanspruch hinzufügen** (Sicherheitsgruppen), Gruppen-ID in `ADMIN_GROUP_ID`.
6. Ablaufdatum des Geheimnisses in den Kalender eintragen – danach neues Geheimnis erzeugen und `.env` aktualisieren.

## 4. Erste Schritte in der Verwaltung

1. **Registrierung → Neuer Code** (z. B. 30 Tage gültig, Gruppe „Büro“). Der Code wird nur einmal angezeigt.
2. Im Sudo: Einstellungen → Daten & Verbindungen → **Sudo-Zentrale** → Adresse + Code → *Anmelden*.
   Für alle PCs: im Sudo-Ordner `intune\zentrale-vorgabe.ps1` anpassen und als Intune-Plattformskript verteilen – Sudo meldet sich dann selbst an.
3. **Meldung senden** → Mitteilung „Hallo vom Server!“ → Sudo zeigt sie sofort.
4. **KI & Budget:** Frag Sudo an/aus, erlaubte Modelle, Budget pro Gerät/Tag und pro Monat. Im Sudo unter *KI: Frag Sudo* „Sudo-Zentrale“ wählen.
5. **Schnittstellen → API-Schlüssel** für Skripte erzeugen.

**Sicherheit & Quiz (ab 1.5):** Unter **Sicherheit & Quiz** legst du fest, ob die Sudos ihren **Gerätezustand** melden (nur Ampel: BitLocker, Virenschutz, Firewall, Windows-Update, Neustart, Speicher) und ob/wie oft das **Security-Quiz** läuft. Dort siehst du alle Geräte nach Zustand sortiert, die anonyme Quiz-Auswertung der letzten 30 Tage (schwierigste Fragen oben) und legst **eigene Fragen** an, die du mit „Jetzt anbieten“ sofort an alle oder eine Gruppe schickst. Die Ampel steht auch in der Geräteliste und auf der Übersicht. Die Datenbank wird beim ersten Aufruf automatisch erweitert. **An eine Person senden (ab 1.5):** Jeder Sudo meldet den Anmeldenamen (UPN) – er steht unter **Geräte** in der zweiten Zeile. Meldungen mit Ziel `user:vorname.nachname@firma.de` gehen an alle Geräte dieser Person, z. B. ein zugewiesenes Ticket aus n8n (Beispiel in API-ANLEITUNG.md). Ein ungültiges Ziel lehnt die Schnittstelle ab, statt an alle zu senden.

**YouTube (ab 1.8):** Unter **YouTube** trägst du Kanäle ein, als Link, @Handle oder Kanal-ID (UC…). Neue Videos zeigen die Sudos als klickbare Sprechblase, ganz ohne YouTube-Konto oder API-Schlüssel, denn die Zentrale liest die öffentlichen Kanal-Feeds. Shorts lassen sich pro Kanal ausblenden, das Ziel ist wählbar (alle oder eine Gruppe). Klappt das @Handle nicht, weil YouTube aus der EU manchmal eine Zustimmungsseite zeigt, nimm die Kanal-ID: Kanalseite → Teilen → Kanal-ID kopieren.

**Musikwünsche (ab 1.8):** Kollegen wünschen sich in Sudo einen Song und bezahlen mit XP. Der Titel landet in der Spotify-Warteschlange eures Büro-Lautsprechers. Einrichtung:
1. Auf **developer.spotify.com** mit dem Büro-Konto (**Spotify Premium** nötig) unter Dashboard → *Create app* eine App anlegen. Als *Redirect URI* genau die Adresse eintragen, die die Zentrale unter „Musikwünsche“ anzeigt (`…/admin/spotify/callback`). Als API „Web API“ wählen.
2. In der Zentrale **Client ID** und **Client Secret** eintragen, speichern, **Mit Spotify verbinden** und mit dem Büro-Konto anmelden.
3. **Alexa:** In der Alexa-App Spotify als Musikdienst verknüpfen und einmal über Spotify Musik auf dem Echo abspielen. Danach erscheint er unter „Lautsprecher“; auswählen und übernehmen.
4. **Spielregeln** setzen: Kosten (XP), Wünsche pro Person und Tag, Abstand, Uhrzeiten, Explicit-Titel, Ansage.

Wünsche kommen in die **Warteschlange**, auf dem Echo muss also gerade Spotify laufen. Sonst bekommt der Kollege einen klaren Hinweis, und es werden keine XP abgezogen. Die Spotify-Zugangsdaten bleiben in der Zentrale und werden nie an Browser oder PCs geschickt.

**Status, Überspringen und Sperren (ab 1.8.1):** Unter „Musikwünsche → Wünsche“ zeigt die Zentrale live, was mit jedem Wunsch passiert: *läuft gerade*, *Platz n in der Warteschlange*, *gespielt*. Dafür fragt sie die Warteschlange direkt bei Spotify ab. **Aktuellen Titel überspringen** springt sofort zum nächsten Song. Einzelne Titel aus der Warteschlange löschen erlaubt Spotify nicht. Deshalb gibt es **Sperren**: Der Titel wird automatisch übersprungen, sobald er läuft (die Zentrale prüft das alle paar Sekunden, solange Sudos online sind), und kommt auf die Sperrliste. Gesperrte Titel tauchen in der Suche nicht mehr auf und können nicht mehr gewünscht werden. Entsperren geht unter „Gesperrte Titel“.

**Wissen aus SharePoint (ab 1.9):** Unter „Wissen (SharePoint)“ trägt die IT Links zu SharePoint-Ordnern, Dokumentbibliotheken oder Websiteseiten (`…/SitePages`) ein. Die Zentrale liest per Microsoft Graph Titel, Ordner und Text (Word, PowerPoint, Text, Websiteseiten; PDFs und andere Dateien nur mit Namen) und gleicht stündlich ab. Geänderte Dateien werden neu gelesen, gelöschte fallen raus. Kollegen suchen in Sudo unter „Anleitungen“, bekommen bei Störungen passende Anleitungen vorgeschlagen, und „Frag Sudo“ erhält passende Auszüge. Ein Klick öffnet immer das Original in SharePoint – mit der Anmeldung des Kollegen.
Einrichtung:
1. In Entra ID eine App-Registrierung anlegen (oder die der Anmeldung verwenden – dann bleiben die Felder leer) und unter *API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen* **Sites.Selected** hinzufügen und die Administratorzustimmung erteilen.
2. Die App für die Website freigeben (nur lesen), z. B. mit PowerShell (Microsoft Graph SDK):
   ```powershell
   Connect-MgGraph -Scopes Sites.FullControl.All
   $site = Get-MgSite -SiteId "firma.sharepoint.com:/sites/IT"
   New-MgSitePermission -SiteId $site.Id -BodyParameter @{ roles = @("read"); grantedToIdentities = @(@{ application = @{ id = "<Client ID>"; displayName = "Sudo-Zentrale" } }) }
   ```
   Einfacher, aber weitreichender: **Sites.Read.All** (alle Websites lesbar).
3. In der Zentrale Tenant, Client ID und Client Secret eintragen, „Verbindung testen“, dann den Link aus der Browser-Adresszeile als Quelle hinzufügen und „In Sudo anzeigen“ einschalten.

**Automatisch mit dem Entra-Setup (ab 1.9.1):** `werkzeuge/entra-setup/Sudo-Entra-Setup.cmd` auf einem Windows-PC doppelklicken. Das Setup erledigt die Schritte 1 bis 3 selbst (App anlegen, Sites.Selected mit Zustimmung, Website freigeben, Geheimnis erzeugen und in der Zentrale eintragen) und legt eine Kalender-Erinnerung für den Ablauf des Geheimnisses an. Es ist beliebig oft ausführbar, prüft mit `-Pruefen` und erneuert mit `-NeuesGeheimnis -AlteGeheimnisseEntfernen`. Welche Berechtigungen nötig sind, liest es bei der Zentrale unter `/api/entra-manifest` – künftige Versionen werden dadurch automatisch mit eingerichtet. Details: `werkzeuge/entra-setup/LIESMICH.md`.

**Diagnose der Clients (ab 1.9):** Sudo 1.9 meldet alle 10 Minuten bei Änderungen CPU, Arbeitsspeicher, Selbst-Neustarts und Fehler der letzten 24 Stunden. Die Werte stehen unter „Geräte“ in der Spalte Version, der letzte Fehlertext erscheint beim Darüberfahren.

**Regeln (ab 1.7):** Unter **Regeln** ordnet die Zentrale Meldungen der Schnittstelle selbst ein. So wird z. B. aus dem Ticket „Datensicherung Failed Muster GmbH“ ein Alarm „Backup fehlgeschlagen – Muster GmbH“ mit Klick zum Ticket. Drei Regeln sind dabei (Backup, Server nicht erreichbar, Zertifikat). Mit dem Testfeld prüfst du jeden Titel, ohne etwas zu senden. Einzelheiten stehen in API-ANLEITUNG.md, Abschnitt 3a.

**Plugins (ab 1.12):** Unter **Plugins** lädst du kleine Werkzeuge als einzelne `.sudoplugin`- oder HTML-Datei hoch (höchstens 2 MB) und weist sie allen, einer Gruppe oder einer Person zu. Die Sudos holen sie sich von selbst und öffnen sie abgeschottet: ohne Internet, ohne Zugriff auf Sudo oder Dateien. Gleiche Kennung ersetzt die alte Fassung, „pausiert“ blendet ein Plugin aus, „Entfernen“ löscht es auch auf den PCs. Mit dem Schalter „Eigene Plugins der Mitarbeitenden“ legst du fest, ob jeder zusätzlich eigene hinzufügen darf. Die Tabelle legt die Zentrale beim ersten Aufruf selbst an.

**Mitarbeiter-Erlebnis (ab 1.10):** Im Bereich **Mitarbeiter-Erlebnis** stellst du kurze **Stimmungsfragen** (1–5 Sterne, an alle oder eine Gruppe, mit Laufzeit) und schaltest optional eine **Monatsfrage** zur Zufriedenheit ein. Antworten speichert die Zentrale ohne Gerät – nur Sterne, Ampel des Gerätezustands und Tag; ausgewertet wird erst ab 5 Antworten (einstellbar 3–20), dann auch getrennt nach Gerätezustand. Nach einer beendeten Störung fragt Sudo die Betroffenen **„Läuft es wieder?“** – wer „Geht noch nicht“ antwortet, steht mit Namen in der Liste und im Protokoll. Die **Start-Checkliste** (mitgeliefert: MFA, OneDrive, Ordnersicherung, Teams, Signatur, Drucker, Gerätezustand, Quiz – eigene Punkte möglich) ist zunächst aus; eingeschaltet zeigen neue Sudos sie in den ersten 30 Tagen, du siehst den Stand je Gerät und kannst sie einem Gerät „erneut zeigen“. Außerdem: **eigene Tipps** je Programm, die Sudo im passenden Moment zeigt. Die neuen Tabellen legt die Zentrale beim ersten Aufruf selbst an.

**Störungen & Neustarts (ab 1.6):** Unter **Störungen & Neustarts** meldest du Störungen (Info, Störung, Ausfall – an alle, eine Gruppe oder eine Person). Sie stehen bei den Sudos, bis du sie beendest; Kollegen melden sich mit „Ich bin auch betroffen“, du siehst Anzahl und Geräte. Beim Beenden geht eine Entwarnung raus. Störungen lassen sich auch per Schnittstelle öffnen und beenden (siehe API-ANLEITUNG.md, z. B. aus dem Monitoring). **Neustart-Kampagnen** bitten um einen Neustart bis zu einer Frist – für alle oder nur Geräte mit ausstehendem Neustart/langer Laufzeit – und zeigen pro Gerät: offen, verschoben (wie oft), erledigt. Außerdem: anonyme Nutzung der **Selbsthilfe** (welches Werkzeug hilft wie oft) und der **Hilfe-Kontakt** (Telefon, Mail, Portal), den die Sudos unter „Hat nicht geholfen?“ anzeigen. Die neuen Tabellen legt die Zentrale beim ersten Aufruf selbst an.

**Besuche (ab 1.4):** Unter **KI & Besuche** schaltest du Besuche zwischen den Sudos ein/aus und legst fest, wie viele ein Gerät pro Tag schicken (Standard 2) und empfangen (Standard 3) darf. Darunter stehen die letzten Besuche; jeder Besuch und jedes Duell landet auch im **Protokoll** – mit Absender und Post-it-Text. Post-its sind auf 60 Zeichen begrenzt, HTML wird entfernt. Die Datenbank wird beim ersten Aufruf automatisch erweitert (Tabelle `visits`, zwei neue Spalten bei `devices`).

## 5. Ereignisse aus Skripten

```bash
curl -X POST https://sudo.example.com/api/events \
  -H "Authorization: Bearer szk_…" -H "Content-Type: application/json" \
  -d '{"type":"backup_failed","kunde":"Muster GmbH","target":"group:IT"}'
```

| `type` | Felder |
|---|---|
| `backup_failed` | `kunde` |
| `server_down` | `host`, `text` |
| `warning` / `message` | `text`, optional `link` (https), optional `dur` = Anzeigedauer in Sekunden (5–120, Standard 15) oder `klick` (bleibt bis zum Wegklicken) |
| `success` | `text` |
| `deploy_ok` | `version` |
| `ticket` | `ticket`, `titel` |
| `bug` | – |

Optional: `target` = `all` (Standard), `group:<Name>` oder `device:<Name>`; `ttl_min` = wie lange Offline-Geräte die Meldung noch bekommen (Standard 1 Tag).

**Umstieg vom PHP-Relay:** In euren Skripten nur Adresse und Kopfzeile tauschen – statt `…/sudo-relay/event.php` mit `send_token` jetzt `…/api/events` mit `Authorization: Bearer szk_…`. Die Felder bleiben gleich.

## 6. Betrieb

- **Sicherung:** `data/zentrale.db*` (SQLite). Am sichersten mit `docker compose stop`, Dateien kopieren, `docker compose start`.
- **Update:** neue Dateien hochladen, `docker compose up -d --build`. Die Datenbank wird bei Bedarf automatisch erweitert.
- **Protokoll:** `docker compose logs`; Admin-Aktionen zusätzlich in der Verwaltung unter *Protokoll* (180 Tage).
- **Gerät verloren?** In *Geräte* sperren – die Verbindung wird sofort getrennt, der Schlüssel ist wertlos.

## 7. Sicherheit kurz erklärt

- Geräte-Schlüssel, API-Schlüssel, Registrierungscodes und Sitzungen werden nur als SHA-256-Hash gespeichert und sind einzeln widerrufbar.
- Verwaltung: Entra-ID-Anmeldung mit PKCE, Prüfung von Mandant, Client-ID, Nonce und Ablauf; Sitzungs-Cookie `HttpOnly`, signiert, 10 Stunden; ändernde Aktionen brauchen zusätzlich ein CSRF-Token. Strenge Content-Security-Policy.
- Begrenzungen: allgemein 300 Anfragen/Minute je IP, Registrierung 10/Minute, KI 20/Minute je Gerät, Passwort-Login 8 Versuche je 15 Minuten.
- KI-Proxy: Fragen werden durchgereicht und nicht gespeichert; gezählt werden nur Token und Kosten. In den Logs werden `Authorization`-Kopfzeilen und Cookies ausgeblendet.
- Hinweis: Fragen gehen an die Claude-API von Anthropic. Klärt intern, welche Daten dort hinein dürfen (keine Passwörter, keine Kundendaten).
