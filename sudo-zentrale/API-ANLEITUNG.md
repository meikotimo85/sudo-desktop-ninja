# Sudo-Zentrale – Schnittstelle für Skripte, Monitoring und n8n

Über die Schnittstelle schicken eure Systeme Ereignisse an die Zentrale, zum Beispiel n8n, ein Backup-Skript, Uptime Kuma oder ein Ticketsystem. Die Zentrale verteilt sie an alle Sudos, an eine Gruppe, an einen einzelnen PC oder an eine Person (ab 1.5). Bei der PHP-Zentrale holen die Sudos neue Meldungen alle 15 Sekunden ab, bei der Node-Zentrale kommen sie sofort.

## 1. API-Schlüssel anlegen

Verwaltung → **Schnittstellen** → Name eintragen (z. B. `n8n`) → **Erzeugen** → Schlüssel kopieren.

- Der Schlüssel (`szk_…`) wird **nur einmal angezeigt**. In der Zentrale steht danach nur noch sein Anfang.
- **Pro System ein eigener Schlüssel.** So siehst du unter „Aktive Schlüssel“, wer wie oft sendet, und kannst einen einzelnen Schlüssel widerrufen, ohne die anderen zu stören.
- Jeder Aufruf steht mit dem Schlüsselnamen im Protokoll (Autor `api:n8n`).

## 2. Die Anfrage

```
POST https://sudo.example.com/api/events
Authorization: Bearer szk_…
Content-Type: application/json

{ "type": "warning", "text": "Backup NAS-01 fehlgeschlagen", "link": "https://…", "target": "group:IT" }
```

Statt `Authorization: Bearer …` geht auch die Kopfzeile `X-API-Key: szk_…`.

**Antwort bei Erfolg:** `{"ok":true,"id":17,"sentNow":4,"targets":12}`. `targets` ist die Zahl der passenden Geräte, `sentNow` die Zahl davon, die gerade online sind. Geräte, die offline sind, bekommen die Meldung beim nächsten Verbinden, solange sie haltbar ist. Passt kein Gerät (`"targets":0`), steht in der Antwort zusätzlich ein `hint` mit dem Grund.

| Status | Bedeutung |
|---|---|
| 200 | angenommen |
| 400 | unbekannter `type` oder ungültiges `target` (die Antwort nennt die erlaubten). Ein falsches Ziel geht nie „an alle“. |
| 401 | Schlüssel fehlt, ist falsch oder widerrufen |
| 429 | mehr als 60 Ereignisse pro Minute von derselben Adresse – kurz warten |

## 3. Ereignisse

| `type` | Felder | Was Sudo macht |
|---|---|---|
| `message` | `text`, optional `link` | Mitteilung in der Sprechblase, mit Link klickbar |
| `warning` | `text`, optional `link` | Warnung (rot umrandet), mit Link klickbar |
| `success` | `text` | jubelt mit Konfetti |
| `backup_failed` | `kunde` (oder `text`) | Alarm mit Ton: „Backup fehlgeschlagen! …“ |
| `server_down` | `host`, optional `text` | Alarm mit Ton: „web01 antwortet nicht! …“ |
| `deploy_ok` | `version` | „Deploy erfolgreich! v2.4.1 ist live.“ mit Konfetti |
| `ticket` | `ticket`, `titel` | eine Schriftrolle fällt vom Himmel, Sudo fängt sie und liest „Ticket #4711: …“ vor |
| `bug` | – | ein Bug krabbelt los, Sudo jagt ihn |

`message`, `warning`, `backup_failed` und `server_down` erscheinen zusätzlich als Windows-Benachrichtigung, wenn der Benutzer sie nicht abgeschaltet hat.

**Optionale Felder für alle Typen:**

| Feld | Werte | Standard |
|---|---|---|
| `target` | `all` · `group:IT` · `device:PC-NB-014` (Gerätename oder -ID aus „Geräte“) · `user:vorname.nachname@firma.de` (Person, siehe unten) | `all` |
| `ttl_min` | Minuten, wie lange die Meldung für Offline-Geräte aufbewahrt wird (1 bis 10080) | Einstellung „Haltbarkeit“ (1 Tag) |
| `dur` | nur `message`/`warning`: Anzeigedauer in Sekunden (5 bis 120) oder `"klick"` = bleibt, bis man sie wegklickt | 15 |

### Meldungen an eine Person: `user:`

Ab Sudo 1.5 meldet jeder Sudo den **Anmeldenamen** der angemeldeten Person (UPN, bei Microsoft 365 in der Regel die E-Mail-Adresse) an die Zentrale. Damit lässt sich eine Meldung an einen Menschen richten statt an einen PC:

```json
{ "type": "ticket", "ticket": "4711", "titel": "Drucker 2. OG", "target": "user:vorname.nachname@firma.de" }
```

- Die Zentrale sucht **alle Geräte** dieser Person, also z. B. Notebook und Büro-PC. Beide bekommen die Meldung.
- Groß-/Kleinschreibung ist egal.
- **Mit @** wird der Anmeldename verglichen. Meldet ein Gerät keinen (lokales Konto, Sudo älter als 1.5), zählt ersatzweise der Windows-Benutzername, wenn er dem Teil vor dem @ entspricht.
- **Ohne @** (`user:vnachname`) wird der Windows-Benutzername verglichen oder der Teil vor dem @ des Anmeldenamens.
- Welche Anmeldenamen bekannt sind, steht unter **Geräte** in der zweiten Zeile unter dem Gerätenamen. Im Formular „Meldung senden“ erscheinen sie als „Person: …“.
- Der Anmeldename ist meist, aber nicht immer, die E-Mail-Adresse, z. B. wenn jemand umbenannt wurde und der alte UPN geblieben ist. Bei `"targets":0` deshalb den Namen unter „Geräte“ prüfen.

Grenzen: höchstens 12 Felder, je Feld 240 Zeichen. Text wird als reiner Text angezeigt; HTML wird nicht ausgeführt. `link` sollte mit `https://` beginnen.

## 3a. Regeln: Die Zentrale ordnet selbst ein (ab 1.7)

Ihr müsst in n8n nichts vorsortieren. Schickt eure Tickets einfach als `ticket`. Unter **Verwaltung → Regeln** legt ihr fest, woran die Zentrale eine Meldung erkennt und was Sudo daraus macht. Beispiel:

| Ankommendes Ticket | Sudo zeigt |
|---|---|
| `Datensicherung Failed Muster GmbH` | Alarm „Backup fehlgeschlagen! Muster GmbH · Ticket #4711“, Klick öffnet das Ticket |
| `Veeam Backup Job NAS-01 fehlgeschlagen (Muster GmbH)` | „Backup fehlgeschlagen! NAS-01 (Muster GmbH)“ |
| `Server DC01 nicht erreichbar` | Alarm „DC01 antwortet nicht!“ |
| `SSL-Zertifikat shop.kunde.de läuft ab` | Warnung mit Ticket-Link |
| `Drucker im 2. OG druckt nicht` | bleibt ein normales Ticket (Schriftrolle) |

So funktioniert es:
- **Mitgeliefert sind drei Regeln:** Backup fehlgeschlagen, Server/Dienst nicht erreichbar, Zertifikat läuft ab. Ihr könnt sie bearbeiten, abschalten oder löschen.
- **Erkennen an Wörtern:** `backup|datensicherung, failed|fehlgeschlagen` bedeutet (backup ODER datensicherung) UND (failed ODER fehlgeschlagen). Groß- und Kleinschreibung ist egal, Wortteile zählen. Für Profis gibt es auch reguläre Ausdrücke.
- **Name des Kunden oder Servers:**
  - Standard ist der „Rest des Titels“: Die erkannten Wörter, Ticketnummern und Füllwörter (Job, bei, Kunde …) fallen weg.
  - Alternativ: Text in Klammern am Ende, erste Gruppe eines regulären Ausdrucks oder der ganze Titel.
- **Wird zu:** Backup fehlgeschlagen, Server down, Warnung, Mitteilung, Erfolg, Deploy, Ticket oder **verwerfen**. Verwerfen eignet sich z. B. für „Datensicherung erfolgreich“, das nicht angezeigt werden soll.
- **Optional pro Regel:** anderes Ziel (z. B. `group:IT`), Anzeigedauer, Haltbarkeit, Link-Vorlage.
- **Ticket-Link:** Unter „Regeln → Ticket-Link“ die Vorlage eintragen, z. B. `https://firma.rmmservice.eu/#/ticketing/ticket/{ticket}`. Dann ist jede eingeordnete Meldung mit Ticketnummer anklickbar.
- **Reihenfolge:** Die Regeln laufen von oben nach unten, die erste passende gewinnt.
- **Ausprobieren:** Mit dem Testfeld oben auf der Seite seht ihr sofort, was aus einem Titel wird. Dabei wird nichts gesendet.
- **Antwort der Schnittstelle:**
  - Hat eine Regel gegriffen, enthält die Antwort `"rule": "Backup fehlgeschlagen"` und `"type": "backup_failed"`.
  - Bei „verwerfen“: `"dropped": true`.
- **Im Protokoll** steht der Autor als `api:n8n · Regel Backup fehlgeschlagen`.

Regeln gelten nur für Meldungen über die Schnittstelle (`/api/events`). Was ihr in der Verwaltung unter „Meldung senden“ verschickt, bleibt unverändert.

## 3b. Störungen per Schnittstelle (ab 1.6)

Eine Störung bleibt bei den Sudos sichtbar, bis sie beendet wird. Kollegen können „Ich bin auch betroffen“ drücken. Damit passt sie zum Monitoring: Wenn ein Dienst ausfällt, wird die Störung geöffnet, und wenn er wieder läuft, wird sie beendet.

```
POST /api/incidents
Authorization: Bearer szk_…
Content-Type: application/json

{ "title": "VPN: Verbindung bricht ab", "text": "Wir prüfen die Firewall.", "sev": "ausfall", "link": "https://status.firma.de", "target": "all" }
```

| Feld | Werte |
|---|---|
| `title` | Pflicht, 3–120 Zeichen. Gleicher Titel + gleiches Ziel bei einer offenen Störung = **dieselbe Störung**. Die Antwort enthält dann `"existing": true`. Ein Monitoring, das alle 5 Minuten meldet, erzeugt also keine Flut. |
| `text` | optional, bis 500 Zeichen |
| `sev` | `info` (blau), `stoerung` (gelb, Standard), `ausfall` (rot, Blase bleibt bis zum Klick) |
| `link` | optional, `https://…` |
| `target` | wie bei Ereignissen: `all`, `group:…`, `device:…`, `user:…` |

**Antwort:** `{"ok":true,"id":7,"existing":false,"targets":23}`

**Beenden:** `POST /api/incidents/7/resolve` mit `{ "text": "Läuft wieder." }`. Die Sudos zeigen die Entwarnung als grüne Blase.

**Offene Störungen abfragen:** `GET /api/incidents` liefert eine Liste mit `id`, `title`, `affected` (Zahl der Betroffenen) und weiteren Feldern. Damit findet ein Workflow die `id` zum Beenden, wenn er sie sich nicht gemerkt hat.

**n8n mit Uptime Kuma oder Zabbix:**
1. Webhook empfängt die Meldung.
2. IF „Status = down“:
   - **ja:** `POST /api/incidents` mit dem Dienstnamen als Titel.
   - **nein:** `GET /api/incidents`, dann den Eintrag mit passendem Titel suchen und `POST /api/incidents/{id}/resolve`.

## 4. Beispiele

**PowerShell** (z. B. am Ende eines Backup-Skripts):

```powershell
$body = @{ type = 'backup_failed'; kunde = 'Muster GmbH – Veeam Job NAS'; target = 'group:IT' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://sudo.example.com/api/events' `
  -Headers @{ Authorization = 'Bearer szk_…' } -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

**curl:**

```bash
curl -X POST https://sudo.example.com/api/events \
  -H "Authorization: Bearer szk_…" -H "Content-Type: application/json" \
  -d '{"type":"server_down","host":"web01","text":"Ping weg seit 5 Minuten","target":"group:IT"}'
```

**PHP:** siehe Verwaltung → Schnittstellen.

## 5. n8n

Ja, n8n kann direkt an die Zentrale senden. Dafür braucht es nur den Baustein **HTTP Request**.

### Einmalig: Zugangsdaten anlegen
n8n → **Credentials** → **Add credential** → **Header Auth**
- Name der Zugangsdaten: `Sudo-Zentrale`
- **Name:** `Authorization`
- **Value:** `Bearer szk_…` (mit dem Wort „Bearer“, einem Leerzeichen und dem Schlüssel)

So steht der Schlüssel nicht im Klartext im Workflow und taucht beim Teilen oder Exportieren nicht auf.

### Baustein „HTTP Request“
| Einstellung | Wert |
|---|---|
| Method | `POST` |
| URL | `https://sudo.example.com/api/events` |
| Authentication | `Generic Credential Type` → `Header Auth` → `Sudo-Zentrale` |
| Send Body | an, Body Content Type `JSON`, Specify Body `Using JSON` |
| JSON | siehe unten |

```json
{
  "type": "warning",
  "text": "{{ $json.subject }}",
  "link": "https://n8n.firma.intern/workflow/{{ $workflow.id }}",
  "target": "group:IT",
  "dur": 30
}
```

Felder lassen sich wie gewohnt mit Ausdrücken `{{ … }}` aus vorherigen Bausteinen füllen.

**Fertig zum Importieren:** `beispiele/n8n-sudo-meldung.json`. In n8n links oben im Menü **Import from File** wählen, danach im HTTP-Baustein die Zugangsdaten `Sudo-Zentrale` auswählen und die Adresse prüfen.

### Beispiel: Ticketsystem → zugewiesener Techniker (NinjaOne)

Der Workflow fragt alle 5 Minuten ein Ticket-Board ab, erkennt neue oder geänderte Tickets, macht aus dem zugewiesenen Techniker eine E-Mail-Adresse und schickt die Meldung mit `"target": "user:<E-Mail>"`. Eine Zuordnungsliste „Techniker → Gerät“ ist nicht nötig.

```
Schedule → HTTP „Tickets vom Board laden“ (OAuth2) → Code „Neue Tickets filtern“
         → Code „Techniker → E-Mail“ → Code „Sudo-Meldung bauen“ → HTTP „An Sudo senden“ (Header Auth)
```

Der Baustein „Sudo-Meldung bauen“ gibt pro Ticket `{ sudo: { type, …, target: "user:…" } }` aus. „An Sudo senden“ schickt `{{ JSON.stringify($json.sudo) }}` als JSON-Body, mit Batching 1 Anfrage pro 300 ms.

Zugangsdaten gehören in n8n unter **Credentials**, nicht in Code-Bausteine:
- **Sudo:** `Header Auth`, Name `Authorization`, Wert `Bearer szk_…`.
- **NinjaOne:** `OAuth2 API`, Grant Type `Client Credentials`, Access Token URL `https://<instanz>/ws/oauth/token`, Scope `monitoring management`, Authentication `Send credentials in body`. Der HTTP-Baustein holt und erneuert das Token dann selbst, ein eigener Token-Baustein entfällt.

### Ideen für n8n-Workflows
- **Backup-Mails auswerten:** IMAP- oder Outlook-Trigger → IF „Betreff enthält Failed/Fehler“ → `backup_failed` mit Kunde aus dem Betreff an `group:IT`.
- **Monitoring:** Uptime Kuma oder Zabbix → Webhook in n8n → `server_down` bzw. bei Entwarnung `success`.
- **Tickets:** neues Ticket mit Priorität „hoch“ → `ticket` mit Nummer und Titel an `group:Support`. Zugewiesene Tickets direkt an den Techniker mit `user:<E-Mail>` (siehe oben).
- **Firmen-Info zur festen Zeit:** Schedule-Trigger, z. B. jeden 1. Dienstag 9 Uhr → `message` „Heute Abend Patchday – bitte PCs anlassen“ mit `"dur": "klick"`.
- **Deploys:** GitLab-Webhook „Pipeline erfolgreich“ → `deploy_ok` mit Version an `group:Entwicklung`.

Tipp: Bei Meldungen in Schleifen (z. B. 20 Backup-Jobs) lieber eine zusammengefasste Meldung schicken. Das schont die Kollegen und die Grenze von 60 Ereignissen pro Minute.

## 6. Sicherheit

- Schlüssel wie ein Passwort behandeln: nicht in Skripte im Klartext auf Netzlaufwerke, nicht in Screenshots, nicht ins Git. Gespeichert wird in der Zentrale nur ein SHA-256-Hash.
- Ein Schlüssel kann **nur Meldungen senden**. Er kann nichts lesen, keine Geräte verwalten und keine Einstellungen ändern.
- Wird ein Schlüssel bekannt: unter „Aktive Schlüssel“ **widerrufen** und einen neuen erzeugen. Das wirkt sofort.
