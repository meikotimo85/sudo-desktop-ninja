<p align="center"><img src="sudo-website/img/icon.png" width="96" alt="Sudo"></p>

# Sudo - der Desktop-Ninja für die IT

Sudo ist ein kleiner Pixel-Ninja, der auf dem Windows-Desktop lebt. Er läuft über die Taskleiste, erinnert an Pausen und hilft bei Alltagsproblemen am PC. Über die **Sudo-Zentrale** erreicht die IT damit alle Mitarbeitenden: Meldungen, Störungen, Neustart-Aufforderungen, Quiz und Wissen aus dem Intranet kommen dort an, wo sie gesehen werden.

Stand: Client 1.14.2 (Windows und Linux), Zentrale 1.15.0.

## Was Sudo kann

**Für Mitarbeitende**

- Selbsthilfe in Klartext: „Warum ist mein PC langsam?“, Meeting-Check für Ton und Bild, Gerätezustand
- Meldungen der IT mit durchsuchbarem Verlauf, der auf dem eigenen PC bleibt
- „Frag Sudo“: Antworten aus den Anleitungen der Firma (SharePoint) und von Claude
- Pausen- und Sperr-Erinnerung, Tipps zu Office-Programmen, Quiz, eigene Skins

**Für die IT**

- Meldungen an alle, an Gruppen, einzelne Geräte oder Personen
- Störungen mit Betroffenen-Zählung und der Rückfrage „Läuft es wieder?“
- Ereignis-API für Skripte und Monitoring, mit Regeln, die Tickets in verständliche Meldungen übersetzen
- Stimmungsbarometer ohne Gerätebezug, Start-Checkliste für neue Geräte
- Plugins: eigene kleine Werkzeuge als HTML-Datei an alle oder einzelne Gruppen verteilen, abgeschottet ohne Internet
- Skin-Store: neue Outfits für Sudo, bezahlt mit XP – mitgeliefert, von der IT über die Zentrale oder als .sudoskin-Datei
- Notfall-Zugang der Verwaltung mit zweitem Faktor (Authenticator-App), Adressfreigabe und Sperren
- Ideen-Board: Wünsche über die Infoseite einreichen und unterstützen, Mail an die IT, Freigabe und Antworten in der Verwaltung
- Verwaltung mit Anmeldung über Microsoft Entra ID, Protokoll aller Aktionen

## Aufbau

| Ordner | Inhalt | Technik |
|---|---|---|
| [`sudo-desktop/`](sudo-desktop/) | Client für Windows und Linux (AppImage, .deb) | Electron, Vanilla JS |
| [`sudo-zentrale-php/`](sudo-zentrale-php/) | Zentrale für normales Webhosting | PHP 8 und SQLite oder MySQL, ohne Composer und Cron |
| [`sudo-zentrale/`](sudo-zentrale/) | Zentrale für Docker | Node 22, Fastify, SQLite |
| [`sudo-website/`](sudo-website/) | Infoseite für Mitarbeitende | statisches HTML |
| [`dev/`](dev/) | Test-Nachbauten und Tests | Python, Node |

Die beiden Zentralen sind Zwillinge: gleiche Routen, gleiche Antworten, gleiche Verwaltungsoberfläche. Du brauchst nur eine davon.

## Schnellstart

**Client ausprobieren**

1. Repository klonen und in `sudo-desktop` die Datei `START.bat` starten. Fehlt Node.js, installiert das Skript es über winget.
2. Sudo läuft auch ohne Zentrale. Mit Zentrale trägst du in den Einstellungen deren Adresse und einen Registrierungscode ein.

**Zentrale aufsetzen**

- Webhosting: Anleitung in [`sudo-zentrale-php/LIESMICH.md`](sudo-zentrale-php/LIESMICH.md)
- Docker: Anleitung in [`sudo-zentrale/LIESMICH.md`](sudo-zentrale/LIESMICH.md)

**Bauen und verteilen**

`BAUEN.bat` erzeugt portable EXE, Setup mit Selbst-Update oder MSI; `INTUNE-PAKET.bat` packt die MSI für Intune. Einzelheiten stehen in [`sudo-desktop/LIESMICH.md`](sudo-desktop/LIESMICH.md).

## Vor dem eigenen Einsatz anpassen

Im Code stehen die Adressen der Instanz des Autors als Vorgabe. Für einen eigenen Betrieb ersetzt du sie:

- Update-Adresse in `sudo-desktop/package.json` unter `build.publish`
- Adresse der Zentrale in `sudo-desktop/intune/zentrale-vorgabe.ps1`
- Angaben der Infoseite in `sudo-website/einstellungen.js`

Die gebauten Programme sind nicht signiert. Windows SmartScreen warnt deshalb beim ersten Start; für den Einsatz im Unternehmen empfiehlt sich ein Code-Signing-Zertifikat.

## Dokumentation

- Client: [`sudo-desktop/LIESMICH.md`](sudo-desktop/LIESMICH.md), Änderungen in [`sudo-desktop/CHANGELOG.md`](sudo-desktop/CHANGELOG.md)
- Ereignis-API: [`sudo-zentrale-php/API-ANLEITUNG.md`](sudo-zentrale-php/API-ANLEITUNG.md)
- Datenschutz: [`sudo-desktop/DATENSCHUTZ-INFO.md`](sudo-desktop/DATENSCHUTZ-INFO.md)
- Tests: [`dev/TESTS.md`](dev/TESTS.md)

## Datenschutz

Sudo ist kein Überwachungswerkzeug. Verlauf, Statistik und Bildschirmzeit bleiben auf dem PC. Antworten auf Stimmungsfragen speichert die Zentrale ohne Gerät und wertet sie erst ab einer Mindestzahl aus. Was den PC verlässt, steht vollständig in der Datenschutz-Information und im Datenschutzfenster des Clients.

## Mitmachen

Fehler und Wünsche bitte als Issue melden. Bei Änderungen an der Zentrale gilt: immer beide Varianten anpassen. Sicherheitslücken bitte nicht öffentlich melden, siehe [SECURITY.md](SECURITY.md).

## Lizenz

Sudo steht unter der [GNU Affero General Public License 3.0](LICENSE) (AGPL-3.0-or-later). Du darfst Sudo nutzen, verändern und weitergeben. Wer eine veränderte Zentrale als Dienst für andere betreibt, muss den geänderten Quelltext den Nutzenden zugänglich machen.

Copyright © 2026 Meiko von Oesen (MeikoSoft), info@meikosoft.net. Die mitgelieferten Schriften Pixelify Sans und DotGothic16 stehen unter der SIL Open Font License.
