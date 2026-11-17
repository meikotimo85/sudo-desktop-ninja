# Sudo – Infoblatt für Mitarbeitende, Datenschutz und Betriebsrat

*Vorlage, Stand Sudo 1.8. Bitte an eure Einstellungen anpassen (Zentrale ja/nein, Frag Sudo ja/nein, Bildschirmzeit an/aus). Kein Rechtsrat – für die Bewertung im eigenen Unternehmen bitte Datenschutzbeauftragte und ggf. Betriebsrat einbeziehen.*

## Was ist Sudo?

Sudo ist ein kleiner Pixel-Ninja, der auf der Taskleiste und den Fenstern lebt. Er reagiert auf Tippen und Speichern, erinnert an Pausen, zeigt IT-Störungen und Sicherheitswarnungen und kann Firmen-Meldungen anzeigen. Er läuft lokal auf dem PC.

Jede Person kann jederzeit selbst nachsehen, was Sudo weiß: **Tray-Menü → „Was weiß Sudo über mich?“**. Dort lässt sich auch eine vollständige **Datenauskunft** als Datei speichern.

## Was Sudo im Moment bemerkt (nicht gespeichert)

| Was | Wozu | Gespeichert? |
|---|---|---|
| *Dass* getippt wird – nur „Zeichen“, Rücktaste, Strg+S/Z/C/V | Reaktionen, Zähler | Nur Zähler (z. B. „1.234 Tasten“), nie Inhalte |
| Position und Titel sichtbarer Fenster | Darauf stehen, Programme/Webseiten erkennen | Nein (Titel werden verworfen) |
| Ob ein Meeting läuft | Dann ist Sudo still | Nein |
| Mausposition | Anklicken und Tragen | Nein |

**Sudo macht nie:** Bildschirmfotos oder Aufnahmen, Zwischenablage lesen, Tasteninhalte speichern oder senden, Dateien/Mails/Browserverlauf lesen, Daten an Werbe- oder Analysedienste.

**Mikrofon und Kamera (ab 1.10)** nutzt Sudo nur im Fenster „Meeting-Check“ und nur, wenn man dort auf „testen“ klickt: Pegel und Vorschau erscheinen im Fenster, nichts wird aufgenommen, gespeichert oder verschickt. Die **Langsam-Analyse** liest kurz die Prozessliste (Name, Speicher, Prozessor) – nur auf dem PC, nichts davon verlässt ihn.

## Was auf dem PC gespeichert wird

Ordner `%APPDATA%\Sudo\` – nur für das eigene Windows-Konto lesbar:

- **Zähler** (Tasten, gefixte Bugs, Pausen, Meetings …), Rang, Erfolge, Garderobe
- **Bildschirmzeit** (abschaltbar): aktive Minuten pro Tag und Programmnamen im Vordergrund, höchstens 30 Tage
- **Erinnerungen und Notizen**, die man selbst einträgt
- **Verlauf „Was hat Sudo gesagt?“** (ab 1.9, durchsuchbar ab 1.11): wichtige Sprechblasen, bei Meldungen mit Ticket- und Gerätekennung. Aufbewahrung selbst einstellbar: Aus, 7, 30 (Standard), 90 Tage oder 1 Jahr, höchstens 2000 Einträge; Abgelaufenes wird aus der Datei gelöscht. Wird nie an die Zentrale übertragen
- **Gewohnheiten** (ab 1.10): an welchem Tag zuletzt an Win+L erinnert oder gelobt wurde und welche Tipps zuletzt kamen – nicht, was man tut
- **Plugins** (ab 1.12): Zusatzwerkzeuge der IT oder eigene, jedes mit eigenem Speicher. Plugins haben keinen Internetzugang und keinen Zugriff auf Sudo oder Dateien – was man darin eingibt, bleibt auf dem PC
- **Ereignisprotokoll** für die Fehlersuche (technische Meldungen)
- **Schlüssel** (API-/Geräte-Schlüssel) – mit Windows verschlüsselt (DPAPI)

## Was den PC verlässt

| Dienst | Was wird übertragen | Abschaltbar |
|---|---|---|
| Sudo-Zentrale (falls genutzt) | Gerätename, Windows-Benutzername, Anmeldename (UPN, meist die E-Mail-Adresse – damit Meldungen wie zugewiesene Tickets an die Person gehen), Version, Sprache, „ist online“. Bei Besuchen: Name auf dem Namensschild und ggf. Post-it-Text (im Protokoll der Zentrale). Bei „Frag Sudo“ über die Zentrale: Anzahl der Fragen und Kosten pro Gerät. | Zentrale: durch die IT · Besuche: pro PC |
| Gerätezustand (falls von der IT eingeschaltet) | Nur eine Ampel je Prüfung: BitLocker, Virenschutz (mit Produktname), Firewall, Windows-Update (Tage seit dem letzten Update), Neustart (Laufzeit in Tagen), freier Speicher auf C: in Prozent. Keine Dateien, Programme oder Inhalte. | durch die IT |
| Security-Quiz (falls genutzt) | Anonym: welche Frage richtig oder falsch beantwortet wurde – ohne Gerät, ohne Namen. | Quiz: durch die IT bzw. selbst |
| Hinweise der IT (falls genutzt) | Bei Störungen nur „ich bin auch betroffen“ (mit Gerät, damit die IT das Ausmaß sieht). Bei Neustart-Aufforderungen: Stand (offen/verschoben/erledigt), Anzahl Verschiebungen, Tage seit dem letzten Neustart. | Betroffen-Meldung: freiwillig pro Klick |
| Musikwünsche (falls genutzt) | Nur beim Wunsch: Titel, Gerät, Uhrzeit (90 Tage), XP-Stand zur Prüfung. Je nach Einstellung wird der Wunsch mit Namen bei allen angesagt. | Wünschen ist freiwillig |
| Anleitungen (falls die IT sie eingerichtet hat, ab 1.9) | Suchbegriffe aus dem Fenster „Anleitungen“ und Titel von Störungen gehen zur Suche an die Zentrale (werden dort nicht gespeichert). Die Zentrale liest SharePoint mit einer eigenen App-Berechtigung (nur lesen); geöffnet wird das Original mit der eigenen Anmeldung. | Nein (Teil der Zentrale) |
| Ressourcen & Fehler (mit Zentrale, ab 1.9) | Alle 10 Minuten bei Änderungen: CPU/RAM von Sudo, Zahl der Selbst-Neustarts und Fehler (24 h), letzter Fehlertext ohne Pfade und Namen | Nein (Teil der Zentrale) |
| YouTube-Videos (falls genutzt) | Kanäle der IT: nichts – die Zentrale liest öffentliche Kanal-Feeds. Eigene Kanäle (ab 1.8.1): Der PC ruft alle 15 Minuten die öffentlichen Feeds dieser Kanäle direkt bei YouTube ab, ohne Anmeldung und ohne Cookies außer der Einwilligungs-Ablehnung. YouTube sieht dabei die Firmen-IP und die abgefragten Kanal-IDs. Die Kanalliste bleibt auf dem PC und geht nicht an die Zentrale. Erst ein Klick auf ein Video öffnet YouTube im Browser. | Einstellungen → Verhalten |
| Selbsthilfe | Anonym: welches Werkzeug benutzt wurde und ob es geklappt hat – ohne Gerät, ohne Namen (ab 1.10 auch Langsam-Analyse und Meeting-Check). | – |
| Kurze Frage der IT (falls genutzt, ab 1.10) | Sterne (1–5), optional eine Anmerkung, dazu die Ampel des Gerätezustands und der Tag – **ohne Gerät und Namen**. Die Zentrale merkt sich pro Gerät nur, *dass* geantwortet oder übersprungen wurde (damit nicht doppelt gefragt wird). Auswertung erst ab 5 Antworten. | Jede Frage überspringbar; Funktion: durch die IT |
| „Läuft es wieder?“ (ab 1.10) | Nur wer bei einer Störung „Ich bin auch betroffen“ gemeldet hat: „läuft wieder“ oder „geht noch nicht“ – **mit Gerät**, damit die IT helfen kann. Steht so im Fenster. | Antworten ist freiwillig |
| Start-Checkliste (falls genutzt, ab 1.10) | Je Punkt nur „erledigt ja/nein“ mit Gerät (OneDrive angemeldet, Ordnersicherung, Teams, Signatur vorhanden, Drucker verbunden, Quiz, Gerätezustand bzw. selbst abgehakt) – keine Inhalte, keine Adressen. Nur in den ersten Wochen nach der Registrierung. | durch die IT |
| Frag Sudo / Claude (falls genutzt) | Nur die gestellte Frage, optional eine kurze IT-Lage als Kontext. Kein Verlauf auf dem PC gespeichert. | Ja |
| IT-Lage | Abruf öffentlicher Seiten (Microsoft-Status, Azure, CERT-Bund) ohne Anmeldung | Ja |
| Have I Been Pwned | Ohne Schlüssel: nur öffentliche Liste. Passwort-Check: nur 5 Zeichen eines Hashes. Mit Schlüssel: eingetragene Adressen | Ja |
| Updates | Abfrage der neuesten Version beim Update-Server | Ja |

Wie bei jedem Abruf im Internet sehen die angefragten Server die IP-Adresse des Anschlusses.

## Keine Leistungs- oder Verhaltenskontrolle

- Zähler und Bildschirmzeit bleiben **auf dem PC**. Die Zentrale erhält sie nicht.
- Die Zentrale sieht nur, **ob und wann** ein Gerät online war und – falls eingeschaltet – die **Ampel des Gerätezustands**. Nicht, wie viel jemand tippt oder womit er arbeitet.
- Die **Quiz-Auswertung ist anonym**: Die IT sieht pro Frage, wie oft sie richtig beantwortet wurde, nicht von wem.
- Die **Stimmungsfragen sind anonym** und werden erst ab 5 Antworten ausgewertet. Namentlich sieht die IT nur „geht noch nicht“ nach einer Störung (freiwillig, um zu helfen) und den Stand der Start-Checkliste neuer Kollegen.
- Sperr-Erinnerung und Tipps laufen nur auf dem PC; die Zentrale erfährt davon nichts.
- Neustart-Aufforderungen zeigen der IT pro Gerät, ob der Neustart erledigt ist – nicht, was am PC gemacht wurde. Sudo startet nie ohne Zustimmung neu.
- In der Zentrale protokolliert werden Verwaltungsaktionen, gesendete Meldungen, Besuche (Absender, Empfänger, Art, Post-it-Text) und Duell-Ergebnisse.

## Ansprechpartner

IT: ……………………………………  ·  Datenschutz: ……………………………………
