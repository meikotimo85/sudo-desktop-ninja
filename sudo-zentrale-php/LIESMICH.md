# Sudo-Zentrale 1.9.1 – PHP-Version für Webspace

Die Sudo-Zentrale für ganz normales Webhosting, **ohne VPS, ohne Docker, ohne Node.js**. Sie kann dasselbe wie die Node-Version und hat dieselbe Verwaltung:

- **Meldungen** an alle Sudos, an Gruppen oder einzelne Geräte (optional mit Link)
- **Ereignis-API** für Skripte (Backup-Prüfung, Monitoring …) mit API-Schlüsseln – ersetzt das alte PHP-Relay
- **Frag Sudo über die Zentrale**: Claude-API-Schlüssel nur auf dem Server, Budget pro Gerät/Tag und pro Monat
- **Verwaltung** mit Anmeldung über **Microsoft Entra ID** (plus Notfall-Passwort), Geräte, Registrierungscodes, Verbrauch, Protokoll

**Der einzige Unterschied:** Webspace kann keine dauerhaften WebSocket-Verbindungen. Die Sudos fragen deshalb alle **15 Sekunden** nach (`poll_seconds` in der `config.php`). Meldungen kommen also mit bis zu 15 Sekunden Verzögerung an. Sudo erkennt die Art der Zentrale selbst – du musst im Sudo nichts umstellen.

**Voraussetzungen:** PHP 8.1 oder neuer, PDO mit SQLite *oder* MySQL/MariaDB, cURL, mbstring, Apache mit `mod_rewrite` (Standard bei fast allen Hostern). HTTPS mit Let's Encrypt.

---

## 1. Installation

1. **Subdomain** `sudo.meikosoft.net` im Hosting-Panel anlegen, Dokumentenverzeichnis z. B. `/sudo-zentrale`, **SSL (Let's Encrypt) aktivieren**.
2. Den Inhalt dieses Ordners per FTP in das Dokumentenverzeichnis laden (inklusive der versteckten Dateien `.htaccess`, `app/.htaccess`, `data/.htaccess`).
3. Den Ordner `data/` beschreibbar machen (Rechte 755 oder 775 – je nach Hoster).
4. `https://sudo.meikosoft.net/setup` aufrufen: Die Seite prüft PHP, Erweiterungen, Schreibrechte und erzeugt den Hash fürs Notfall-Passwort.
5. `config.sample.php` als **`config.php`** kopieren und ausfüllen (Abschnitt 2), wieder hochladen.
6. `https://sudo.meikosoft.net/admin/` → anmelden. Sobald eine Anmeldung eingerichtet ist, zeigt `/setup` nichts mehr an.

Test: `https://sudo.meikosoft.net/healthz` → `{"ok":true,…}`; `https://sudo.meikosoft.net/config.php` und `/data/` müssen **403 – Verboten** liefern.

**Unterordner statt Subdomain** (z. B. `meikosoft.net/sudo`): In der `.htaccess` `RewriteBase /sudo/` setzen und `public_url` entsprechend eintragen.

## 2. `config.php`

| Eintrag | Bedeutung |
|---|---|
| `public_url` | `https://sudo.meikosoft.net` – ohne Schrägstrich am Ende |
| `db` | Standard: SQLite-Datei in `data/` (nichts einzurichten). Alternativ MySQL: `'dsn' => 'mysql:host=localhost;dbname=…;charset=utf8mb4'`, `user`, `pass` |
| `entra` | `tenant`, `client_id`, `client_secret` aus der App-Registrierung (siehe 3.) |
| `admin_users` | Wer in die Verwaltung darf, z. B. `['admin@firma.de']` |
| `admin_group` | Alternativ: Objekt-ID einer Entra-Gruppe (Gruppen-Claim aktivieren) |
| `admin_password` | Notfall-Zugang: Hash von `/setup` (`$2y$…`). Neben Entra nur aktiv mit `local_login => true` |
| `anthropic_key` | Claude-API-Schlüssel für Frag Sudo (console.anthropic.com) |
| `poll_seconds` | Wie oft die Sudos nachfragen (Standard 15, erlaubt 5–120) |
| `first_enroll_code` | Optional: erster Registrierungscode |

Die Tabellen legt die Zentrale beim ersten Aufruf selbst an – auch bei MySQL.

## 3. Anmeldung mit Microsoft Entra ID

1. **Entra Admin Center → App-Registrierungen → Neue Registrierung**: Name `Sudo-Zentrale`, *Nur Konten in diesem Organisationsverzeichnis*, Umleitungs-URI **Web** `https://sudo.meikosoft.net/auth/callback`.
2. **Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel** → Wert kopieren.
3. **Verzeichnis-ID (Mandant)** und **Anwendungs-ID (Client)** von der Übersichtsseite übernehmen.
4. Standard-Berechtigungen (`openid`, `profile`, `email`) reichen. Optional Gruppenanspruch für `admin_group`.
5. Ablaufdatum des Geheimnisses notieren.

## 4. Erste Schritte

1. **Registrierung → Neuer Code**, im Sudo: Einstellungen → Daten & Verbindungen → *Sudo-Zentrale* → Adresse + Code → *Anmelden*. Für alle PCs: `intune\zentrale-vorgabe.ps1` aus dem Sudo-Ordner per Intune verteilen.
2. **Meldung senden** → nach spätestens 15 Sekunden zeigt Sudo sie an. Unter *Sprechblase zeigen* wählst du, wie lange: 15 Sekunden bis 2 Minuten oder *Bis zum Wegklicken*. In Skripten geht das mit dem Feld `"dur"` (Sekunden oder `"klick"`).
3. **KI & Budget** einstellen, im Sudo unter *KI: Frag Sudo* „Sudo-Zentrale“ wählen.
4. **Schnittstellen → API-Schlüssel** für Skripte. Beispiel in PHP: `examples/sudo-zentrale-notify.php` im Sudo-Ordner.

```bash
curl -X POST https://sudo.meikosoft.net/api/events \
  -H "Authorization: Bearer szk_…" -H "Content-Type: application/json" \
  -d '{"type":"backup_failed","kunde":"Muster GmbH","target":"group:IT"}'
```

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

**Mitarbeiter-Erlebnis (ab 1.10):** Im Bereich **Mitarbeiter-Erlebnis** stellst du kurze **Stimmungsfragen** (1–5 Sterne, an alle oder eine Gruppe, mit Laufzeit) und schaltest optional eine **Monatsfrage** zur Zufriedenheit ein. Antworten speichert die Zentrale ohne Gerät – nur Sterne, Ampel des Gerätezustands und Tag; ausgewertet wird erst ab 5 Antworten (einstellbar 3–20), dann auch getrennt nach Gerätezustand. Nach einer beendeten Störung fragt Sudo die Betroffenen **„Läuft es wieder?“** – wer „Geht noch nicht“ antwortet, steht mit Namen in der Liste und im Protokoll. Die **Start-Checkliste** (mitgeliefert: MFA, OneDrive, Ordnersicherung, Teams, Signatur, Drucker, Gerätezustand, Quiz – eigene Punkte möglich) ist zunächst aus; eingeschaltet zeigen neue Sudos sie in den ersten 30 Tagen, du siehst den Stand je Gerät und kannst sie einem Gerät „erneut zeigen“. Außerdem: **eigene Tipps** je Programm, die Sudo im passenden Moment zeigt. Die neuen Tabellen legt die Zentrale beim ersten Aufruf selbst an.

**Störungen & Neustarts (ab 1.6):** Unter **Störungen & Neustarts** meldest du Störungen (Info, Störung, Ausfall – an alle, eine Gruppe oder eine Person). Sie stehen bei den Sudos, bis du sie beendest; Kollegen melden sich mit „Ich bin auch betroffen“, du siehst Anzahl und Geräte. Beim Beenden geht eine Entwarnung raus. Störungen lassen sich auch per Schnittstelle öffnen und beenden (siehe API-ANLEITUNG.md, z. B. aus dem Monitoring). **Neustart-Kampagnen** bitten um einen Neustart bis zu einer Frist – für alle oder nur Geräte mit ausstehendem Neustart/langer Laufzeit – und zeigen pro Gerät: offen, verschoben (wie oft), erledigt. Außerdem: anonyme Nutzung der **Selbsthilfe** (welches Werkzeug hilft wie oft) und der **Hilfe-Kontakt** (Telefon, Mail, Portal), den die Sudos unter „Hat nicht geholfen?“ anzeigen. Die neuen Tabellen legt die Zentrale beim ersten Aufruf selbst an.

**Besuche (ab 1.4):** Unter **KI & Besuche** schaltest du Besuche zwischen den Sudos ein/aus und legst fest, wie viele ein Gerät pro Tag schicken (Standard 2) und empfangen (Standard 3) darf. Darunter stehen die letzten Besuche; jeder Besuch und jedes Duell landet auch im **Protokoll** – mit Absender und Post-it-Text. Post-its sind auf 60 Zeichen begrenzt, HTML wird entfernt. Die Datenbank wird beim ersten Aufruf automatisch erweitert (Tabelle `visits`, zwei neue Spalten bei `devices`).

**Info-Seite für Mitarbeitende (ab 1.4.1):** Den Ordner der Sudo-Website als `info/` neben `index.php` hochladen. Sie ist dann unter `https://sudo.meikosoft.net/info/` erreichbar, und die Startseite der Zentrale verlinkt sie mit „Was ist Sudo?“. Details stehen in der LIESMICH der Website.

## 5. Gut zu wissen

- **Last:** Jeder Sudo macht alle 15 Sekunden eine kleine Anfrage (wenige hundert Byte). 25 PCs sind etwa 100 Anfragen pro Minute – für normalen Webspace kein Problem. Bei sehr vielen Geräten `poll_seconds` erhöhen.
- **Frag Sudo-Antworten:** Die Zentrale reicht Claudes Antwort Stück für Stück weiter. Puffert der Hoster die Ausgabe (manche FastCGI-Einstellungen tun das), kommt die Antwort erst komplett am Ende – sie funktioniert trotzdem.
- **Sicherung:** bei SQLite die Dateien `data/zentrale.sqlite*` per FTP sichern; bei MySQL über das Hosting-Panel.
- **Update:** neue Dateien hochladen, `config.php` und `data/` behalten. Von 1.3.x auf 1.4 reichen `index.php`, `app/core.php`, `app/db.php`, `app/admin.php` und `admin/admin.js`.
- **Sicherheit:** Schlüssel, Codes und Sitzungen nur als SHA-256-Hash; Admin-Sitzung `HttpOnly`, 10 Stunden, CSRF-Schutz; Entra-Anmeldung mit PKCE und Prüfung von Mandant, Client-ID, Nonce und Ablauf; Begrenzungen für Registrierung, Login, Fragen und Ereignisse. `app/`, `data/` und `config.php` sind per `.htaccess` gesperrt.
- **Nginx statt Apache?** Alle Anfragen ohne vorhandene Datei an `index.php` leiten und `/app`, `/data`, `/config.php` sperren.
