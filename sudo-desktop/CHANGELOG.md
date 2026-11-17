1.13.0 – Plugins per Doppelklick: Endung .sudoplugin (Zentrale 1.13.0)
  • Dateien mit der Endung .sudoplugin haben im Explorer ein eigenes Pixel-Symbol (Blatt mit violettem Puzzleteil). Ein Doppelklick öffnet Sudo und fragt, ob das Plugin hinzugefügt werden soll – „Hinzufügen und öffnen“, „Nur hinzufügen“ oder „Abbrechen“; läuft Sudo schon, kommt die Frage dort
  • Sudo trägt die Endung beim Start für den angemeldeten Benutzer ein (ohne Adminrechte, für Setup, MSI und portable EXE) und nur dann neu, wenn sich etwas geändert hat
  • Einstellungen → Plugins und die Verwaltung der Zentrale nehmen .sudoplugin- und HTML-Dateien an
  • Hat die IT eigene Plugins verboten oder ist die Datei kein Plugin, sagt Sudo das statt still nichts zu tun

1.12.1 – Plugins im Tray-Menü sichtbarer (Zentrale bleibt 1.12.0)
  • Repo als Vorlage: Beispiele und Vorgaben nutzen sudo.example.com und updates.example.com. Die echte Update-Adresse steht in update-adresse.txt neben BAUEN.bat (nicht im Repo); BAUEN.bat übergibt sie beim Bauen. zentrale-vorgabe.ps1 bricht mit Hinweis ab, wenn keine Adresse eingetragen ist
  • Das Untermenü „Plugins“ im Tray hat ein eigenes Puzzle-Symbol statt des Werkzeugkasten-Symbols. Es erscheint, sobald die Zentrale Plugins vorgibt oder du selbst eins hinzufügst, und listet alle mit „Plugins verwalten …“ am Ende

1.12.0 – Plugins (Zentrale 1.12.0)
  • Plugins: kleine Zusatzwerkzeuge als einzelne HTML-Datei, z. B. ein Namens-Generator für eure Kunden. Sie erscheinen im Tray-Menü unter „Plugins“ und in den Einstellungen im neuen Reiter „Plugins“
  • Selbst hinzufügen (Einstellungen → Plugins → Datei wählen) oder von der IT über die Sudo-Zentrale verteilen lassen – an alle, eine Gruppe oder einzelne Personen; neue Fassungen kommen von selbst
  • Abgeschottet: Ein Plugin läuft in einem eigenen Fenster ohne Internet, ohne Zugriff auf Sudo, Dateien oder andere Plugins und mit eigenem Speicher. Erlaubt sind Zwischenablage (schreiben), Rückfragen und Speichern über den Speichern-Dialog
  • Zentrale: neuer Bereich „Plugins“ (Hochladen, Ziel, Pausieren, Entfernen) und Schalter, ob Mitarbeitende eigene Plugins hinzufügen dürfen
  • Beispiel-Plugin „Subnetzrechner“ unter examples/plugins

1.11.1 – Klicken nach RDP-Wechsel (Zentrale bleibt 1.10.0)
  • Sudo ließ sich nach einem Wechsel zwischen lokaler und Remotedesktop-Sitzung manchmal nicht mehr ziehen oder anklicken: Meldete Windows „gesperrt“, aber nie „entsperrt“, blieb Sudo pausiert und durchklickbar. Sudo erkennt das jetzt selbst und erzeugt das Overlay neu
  • Wechsel lokal ↔ Remotedesktop wird erkannt, das Overlay wird dann wie nach dem Entsperren frisch erzeugt
  • Diagnose-Bericht zeigt zusätzlich Remotedesktop, Sperre und ob das Overlay gerade klickbar ist

1.11.0 – Verlauf mit Suche, Sudo im Detail (Zentrale bleibt 1.10.0)
  • Verlauf „Was hat Sudo gesagt?“ durchsuchen: Text, Ticket-Nummer und Gerätekennung, dazu Zeitraum (Heute, 7 oder 30 Tage, Von … bis …) und Quelle; Ticket und Gerät stehen als Marke unter der Meldung
  • Aufbewahrung einstellbar: Aus, 7, 30 (neuer Standard, bisher 7), 90 Tage oder 1 Jahr, höchstens 2000 Einträge (bisher 50); Abgelaufenes wird aus der Datei gelöscht, kürzer stellen löscht sofort
  • Zugriff: Der Verlauf bleibt im eigenen Windows-Konto auf dem PC und geht nie an die Zentrale
  • Sudo feiner gezeichnet: fünf Helligkeitsstufen mit Glanzpunkt, Kapuzensaum, Schatten im Gesicht, Maskensaum, Iris, Bündchen, Strickbund, Stofffalten – gleiches Raster, eigene Skins bleiben gültig

1.10.0 – Hilfe im Alltag & Mitarbeiter-Erlebnis (Zentrale 1.10.0)
  • Selbsthilfe „Warum ist mein PC langsam?“: Analyse in Klartext – Prozessor, Arbeitsspeicher, größte Programme (z. B. „Edge in 38 Teilen, 4,2 GB“), Neustart, Speicherplatz, Autostart, Akku – mit Knöpfen für den nächsten Schritt
  • Meeting-Check: Ton & Bild: Mikrofon mit Pegel, Kamera mit Vorschau (erkennt schwarzes Bild/Schieber), Testton auf dem gewählten Lautsprecher, Verbindung zu Teams; verständliche Hinweise bei gesperrtem oder belegtem Gerät. Nichts wird aufgenommen oder verschickt
  • Sperr-Erinnerung: Warst du über 10 Minuten weg und der Bildschirm war offen, erinnert Sudo an Win+L (einmal am Tag, Klick öffnet „Dynamische Sperre“); Lob und XP fürs Sperren
  • Tipps im passenden Moment: kurze Kniffe für Excel, Word, Outlook, Teams, PowerPoint, OneNote und Browser, wenn das Programm eine Weile vorne ist; Normal/Selten/Aus, eigene Tipps der Firma aus der Zentrale
  • Kurze Frage deiner IT (Stimmungsbarometer): 1–5 Sterne, überspringbar, nie im Meeting; die Zentrale speichert Antworten ohne Gerät und wertet erst ab 5 Antworten aus. Optional Monatsfrage zur Zufriedenheit
  • „Läuft es wieder?“: Nach einer beendeten Störung fragt Sudo nach – nur, wer „Ich bin auch betroffen“ gemeldet hatte; „Geht noch nicht“ sieht die IT mit Namen
  • Start-Checkliste für neue Kollegen: Punkte aus der Zentrale; OneDrive, Ordnersicherung, Teams, Signatur, Drucker, Quiz und Gerätezustand hakt Sudo selbst ab; Fortschritt je Gerät in der Zentrale
  • Zentrale: neuer Bereich „Mitarbeiter-Erlebnis“ (Umfragen, Rückmeldungen nach Störungen, Checkliste mit Stand je Gerät, eigene Tipps)
  • Zwei neue Erfolge: Bildschirm-Wächter, Startklar
  • Behoben: Netzwerk-Check meldete Microsoft 365 fälschlich als „nicht erreichbar“, wenn die Seite weiterleitet

Zentrale 1.9.1 – Entra-Setup
  • Neues Werkzeug werkzeuge/entra-setup: richtet die Entra-App komplett ein (App, Sites.Selected mit Zustimmung, Website-Freigabe, Geheimnis, Eintrag in der Zentrale), prüft sie und erneuert das Geheimnis; optional auch die Microsoft-Anmeldung an der Verwaltung
  • Neue Schnittstelle /api/entra-manifest: Die Zentrale beschreibt selbst, welche Microsoft-Berechtigungen sie braucht – das Setup richtet so auch künftige Versionen ein
  • Sudo Desktop bleibt bei 1.9.0

1.9.0 – Wissen, Verlauf, Stabilität & neue Looks
  • Anleitungen aus SharePoint: Die Zentrale liest Ordner und Websiteseiten (Microsoft Graph, nur lesen) und Sudo durchsucht sie – Tray → Anleitungen, Vorschläge bei Störungen, Auszüge für Frag Sudo; die Inhalte bleiben in SharePoint
  • Verlauf „Was hat Sudo gesagt?“: wichtige Sprechblasen der letzten 7 Tage zum Nachlesen, auch die im Meeting verschluckten
  • Weniger Last: Sudo malt nur noch bei Bewegung neu, ruhige Phasen mit 30, Schlafen mit 15 Bildern pro Sekunde, Fensterliste seltener abgefragt
  • Selbstheilung: Overlay startet sich nach Absturz oder Hänger selbst neu, Fehler in einzelnen Bildern halten Sudo nicht mehr an; Ressourcen-Anzeige unter Info & Diagnose; Werte gehen an die Zentrale (Geräte-Übersicht)
  • Skins: Farbvarianten Feuerwehr, Matrix, Royal, Gold, Schnee; eigene Skins in Unterordnern; Auswahl im Tray
  • Neue Animationen: Jonglieren, Jahreszeiten (Laub, Blüten, Flocken, Hitze), Tagesmomente (Montag, Mahlzeit, Freitag, Feierabend, Wochenende)
  • Frag Sudo: Links in Antworten sind anklickbar

1.8.1 – Eigene YouTube-Kanäle, Musik im Griff
  • YouTube: Jeder kann bis zu 10 eigene Kanäle eintragen (Link, @Handle oder Kanal-ID), Shorts pro Kanal zuschaltbar – funktioniert auch ohne Zentrale, der PC fragt die öffentlichen Feeds direkt ab
  • YouTube: Kommt ein Video über einen eigenen Kanal und über die IT, zeigt Sudo es nur einmal
  • Zentrale: Musikwünsche zeigen den echten Stand (läuft gerade, Platz n, gespielt) statt dauerhaft „in der Warteschlange“
  • Zentrale: Aktuellen Titel überspringen; schlimme Songs sperren – sie werden automatisch übersprungen und können nicht mehr gewünscht werden; Sperrliste mit Entsperren

1.8.0 – Musik, YouTube & ein aufgeräumtes Menü
  • Musikwunsch: Song suchen und mit XP bezahlen – er kommt in die Spotify-Warteschlange des Büro-Lautsprechers (z. B. Alexa); Rang kann sinken, Garderobe bleibt
  • Zentrale: Spotify-Konto verbinden, Lautsprecher wählen, Spielregeln (Kosten, pro Tag, Abstand, Uhrzeit, explicit, Ansage)
  • YouTube: Die IT trägt Kanäle ein, neue Videos zeigt Sudo als klickbare Sprechblase (abschaltbar); kein API-Schlüssel nötig
  • Tray-Menü mit Pixel-Icons, neu gruppiert
  • Behoben: „Arbeitstag & Pausen“ zeigte im Menü kein „&“

Zentrale 1.7.1 – Fehlerbehebung
  • Behoben: Lagen mehr als 30 noch gültige Meldungen für andere Empfänger in der Warteschlange (z. B. Tickets an Personen ohne Sudo), bekam ein Gerät keine Meldungen mehr
  • Sudo (nächste Version) schreibt fehlgeschlagene Abrufe ins Ereignisprotokoll

1.7.0 – Regeln in der Zentrale
  • Zentrale ordnet eingehende Meldungen selbst ein (Regeln): z. B. Ticket „Datensicherung Failed Muster GmbH“ → „Backup fehlgeschlagen – Muster GmbH“
  • Drei mitgelieferte Regeln (Backup fehlgeschlagen, Server nicht erreichbar, Zertifikat läuft ab), eigene Regeln mit Wörtern oder regulären Ausdrücken, Testfeld
  • Ticket-Link-Vorlage: eingeordnete Meldungen öffnen per Klick das Ticket
  • Sudo zeigt bei „Backup fehlgeschlagen“ und „Server antwortet nicht“ die Ticket-Nummer, die Blase ist dann klickbar

1.6.0 – Selbsthilfe, Störungen & Neustarts
  • Selbsthilfe ohne Adminrechte: Netzwerk-Check (DNS, Internet, Hotspot, Microsoft 365, VPN), Teams reparieren (Cache), Outlook/OneDrive/Explorer neu starten, Temp aufräumen, DNS-Cache leeren
  • „Hat nicht geholfen?“ mit Hilfe-Kontakt aus der Zentrale; anonyme Nutzungszahlen für die IT
  • Störungen: Sprechblase + Benachrichtigung, Fenster „Hinweise deiner IT“, Knopf „Ich bin auch betroffen“, Entwarnung als grüne Blase
  • Neustart-Kampagnen: höfliche Aufforderung mit Frist, Jetzt/1 h/3 h/morgen, nie im Meeting, Stand für die IT; Neustart nur mit Zustimmung (abbrechbar)
  • Zentrale: neuer Bereich „Störungen & Neustarts“, Störungen auch per API (z. B. Monitoring → n8n), Doppelmeldungen werden zusammengeführt
  • Ninja-Leiste: neuer Eintrag „Selbsthilfe“; IT-Lage → Mein PC mit Knopf zur Selbsthilfe

1.5.1 – Lesbare Sprechblasen
  • Einstellungen → Allgemein → Sprechblase: Schrift „Pixel“ oder „Klar lesbar“, Textgröße Normal/Groß
  • Anzeigedauer Normal, Länger, Lang oder „Bis Klick“ (Meldungen und Erinnerungen bleiben, bis man sie anklickt)
  • Text bleibt immer mindestens so lange stehen, wie man zum Lesen braucht – lange Meldungen verschwinden nicht mehr zu früh
  • Vorschau-Knopf zeigt die Blase sofort mit den gewählten Einstellungen
  • Zentrale-Vorgabe: Behoben – eine mit „Set-Content -Encoding UTF8“ geschriebene zentrale.json (mit BOM) wurde nicht gelesen
  • Zentrale-Vorgabe greift ohne Neustart: nicht angemeldete Sudos prüfen alle 5 Minuten erneut
  • zentrale-vorgabe.ps1: für NinjaOne/RMM (Skriptvariablen SudoUrl/SudoCode), Parameter, -Pruefen und -Entfernen, Rechte per SID (deutsches Windows), klare Exit-Codes

1.5.0 – Gerätezustand & Security-Quiz
  • Gerätezustand-Selbstcheck ohne Adminrechte: BitLocker, Virenschutz, Firewall, Windows-Update, Neustart, Speicherplatz
  • Neuer Reiter „Mein PC“ in der IT-Lage mit Ampel, Erklärungen und Knöpfen zu Windows Update / Windows-Sicherheit
  • Sudo weist höchstens einmal am Tag auf Probleme hin; mit Zentrale geht (wenn gewünscht) nur die Ampel an die IT
  • Security-Quiz: 21 Fragen aus dem Büroalltag, kurze Erklärungen, +10 XP, drei neue Erfolge
  • Zentrale: eigene Fragen anlegen und sofort anbieten, anonyme Auswertung, Häufigkeit zentral steuern
  • Transparenz-Seite und Infoblatt um Gerätezustand und Quiz ergänzt
  • Meldungen an eine Person: Sudo meldet den Anmeldenamen (UPN), Skripte und n8n senden an "user:vorname.nachname@firma.de" – alle Geräte dieser Person bekommen sie
  • Schnittstelle: ungültiges Ziel wird abgelehnt statt an alle verteilt

1.4.2 – Ninja-Leiste, Dark Mode & Monitore
  • Intune-Paket: Installation/Deinstallation/Erkennung per Skript (unabhängig vom MSI-Produktcode), beendet und startet Sudo beim Update
  • Ninja-Leiste: mittlere Maustaste auf Sudo → Schnellstart für PowerShell, CMD, Terminal, Explorer, Task-Manager … und eigene Einträge (Programme, Ordner, Links, auch als Administrator)
  • Umriss für dunkle Hintergründe: Pixel-Rand oder Leuchten, automatisch bei dunklem Windows-Design
  • Behoben: Sudo ließ sich nach „Sudo rufen“ nicht mehr auf einen anderen Bildschirm bringen – jetzt einfach über die Kante ziehen (jede Monitor-Anordnung)
  • Tray-Menü „Auf Bildschirm …“, toleranteres Wandern bei unterschiedlicher Skalierung

1.4.1 – Garderobe & Transparenz
  • 16 neue Teile: Bauhelm, Aluhut, Propellermütze, Pixel-Sonnenbrille, Monokel, Admin-Krawatte, Fliege, Firmenausweis
  • Saison-Teile: Hexenhut, Hasenohren, Strohhut, Zylinder, Skibrille, Schal, Lichterkette, Blumenkette
  • Neuer Garderoben-Platz „Hals & Brust“, herangezoomte Vorschau für Brillen und Halsteile
  • An Halloween, Ostern, Weihnachten und Silvester zieht Sudo das passende Teil selbst an
  • „Was weiß Sudo über mich?“: was Sudo bemerkt, speichert und sendet – mit echten Werten, Löschknöpfen und Datenauskunft
  • Vorlage DATENSCHUTZ-INFO.md für Mitarbeitende, Datenschutz und Betriebsrat
  • Neue Erfolge: Kleiderschrank, Modeikone, Datenschützer
  • Besuche: keine Plauderei mehr mitten im Duell, doppelt zugestellte Besuche werden ignoriert

1.4.0 – Besuche
  • Sudo zu Kollegen schicken (über die Sudo-Zentrale): Post-it, Kaffee, Gummiente, Pizza, Konfetti, Bug oder Duell
  • Shuriken-Duell zwischen zwei Ninjas, Sieger bekommt +10 XP, Ergebnis kommt beim Absender an
  • Mitbringsel bleiben auf dem Desktop liegen, bis man sie anklickt
  • Begrenzt: 2 Besuche schicken, 3 empfangen pro Tag (einstellbar), Post-its höchstens 60 Zeichen, alles im Protokoll
  • Besuche lassen sich pro PC abschalten, Name auf dem Namensschild wählbar
  • Neue Erfolge: Hausbesuch, Erster Sieg, Shuriken-Meister

1.3.2
  • Firmen-Meldungen bleiben länger stehen (Standard 15 s), Dauer wählbar bis „bis zum Wegklicken“
  • Lange Meldungen werden von dringenden Warnungen nur kurz verdrängt und erscheinen danach wieder

1.3.1
  • Sudo-Zentrale gibt es jetzt auch als PHP-Version für Webspace (ohne VPS/Docker)
  • Sudo erkennt die Art der Zentrale selbst: WebSocket (Node) oder Abruf alle 15 Sekunden (PHP)

1.3.0 – Sudo-Zentrale
  • Anbindung an die Sudo-Zentrale (eigener Node.js-Server): Meldungen an alle/Gruppen/Geräte in Echtzeit per WebSocket
  • Automatische Anmeldung per Intune-Vorgabe (zentrale.json oder Richtlinie), Geräte-Schlüssel verschlüsselt
  • Frag Sudo auch über die Zentrale (Schlüssel und Budget auf dem Server)
  • Webseiten-Aktivitäten: Fernsehabend bei YouTube & Co., Tanzen bei Musik, Paket beim Shoppen, Mitlesen bei News …

1.2.0 – Frag Sudo
  • Fragen an Claude (Strg+Alt+S): Antwort Wort für Wort, Code mit Kopierknopf, Sudo tippt mit
  • Schnell (Haiku 5.5) oder Schlau (Sonnet 5.5), Tageslimit, Verbrauchsanzeige
  • API-Schlüssel mit Windows verschlüsselt, keine Fragen/Antworten gespeichert

1.1.1 – Sicherheitswarnungen
  • RSS-/Atom-Leser in der IT-Lage, vorbelegt mit CERT-Bund (BSI), Bürger-CERT und BSI-News
  • Neue Warnungen als klickbare Blase (5–10 Sekunden, Klick öffnet den Artikel)
  • Filter nach Schweregrad, nur neue Meldungen, optionale Stichwörter (z. B. Microsoft, Fortinet)
  • Eigene Feeds hinzufügen (bis zu 8), Übersicht der neuesten Meldungen

1.1.0 – IT-Lage & Sprachen
  • IT-Lage: öffentlicher Microsoft-365- und Azure-Status ohne Tenant, Sudo meldet Störungen und Entwarnungen
  • Datenlecks: neue öffentliche Lecks (Have I Been Pwned), eigene Adressen mit HIBP-Schlüssel, Link zum HPI
  • Passwort-Check per k-Anonymität (Passwort verlässt den PC nie)
  • Klickbare Sprechblasen: Klick öffnet Details
  • Sprachen: Deutsch, Englisch und Japanisch (mit japanischer Pixelschrift)
  • Erinnerungen verstehen auch englische und japanische Zeitangaben
  • Wichtige Meldungen stehen Schlange statt sich zu überschreiben

1.0.1
  • Garderobe: Hüte und Brillen fehlten, wenn früher einmal der Skin-Ordner geöffnet wurde
    (ältere Skin-Kopie ohne Zubehör). Zubehör kommt jetzt bei Bedarf aus der Standardgrafik.
  • Skin-Ordner öffnen aktiviert keinen Skin mehr – die Vorlage liegt im Unterordner „vorlage“
  • Einstellungen → Skin zeigt, welche Grafik aktiv ist, und kann zur Standardgrafik zurück

1.0.0 – Final
  • Einstellungs-Zentrale mit Reitern, schlankes Tray-Menü
  • Willkommens-Tour beim ersten Start
  • Sichern & Wiederherstellen aller Daten (z. B. für einen neuen PC)
  • Installer (Setup) mit automatischen Updates vom eigenen Webspace
  • MSI für Intune und zentrale Verteilung, Anleitung inkl. .intunewin
  • Sudo wandert zwischen mehreren Bildschirmen, „Sudo rufen“ holt ihn zur Maus
  • Sparmodus bei Akku-Betrieb, Pause bei gesperrtem Bildschirm
  • Info & Diagnose: Version, Diagnose-Bericht per Klick

0.9 – Spaß
  • Garderobe mit 8 Teilen, Geschenke für gemeinsame Erfolge
  • 24 Erfolge, besondere Tage & Feiertage (Niedersachsen)
  • Stressball und Pausenspiel „Bug-Jagd“

0.8 – Arbeit & IT
  • Erinnerungen & Notizen (Strg+Alt+N), Werkzeugkasten (Strg+Alt+K)
  • System-Wächter: Internet, VPN, Akku, Speicher, CPU/RAM, Neustart

0.7 – Wohnort, Arbeitstag & Pausen, Bildschirmzeit
0.6 – Microsoft-365-Reaktionen, Meeting-Modus, unsichtbar bei Freigabe
0.5 – Persönlichkeit, Statistik, Tastatur-Test
0.4 – Sprite-Sheet 48 × 52, Skins
0.3 – Relay für Server-Ereignisse
0.2 – Erste Windows-Desktop-App
