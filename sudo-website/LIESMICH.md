# Sudo – Info-Seite für Mitarbeitende

Eine kleine, eigenständige Website, die erklärt, was Sudo ist, wie man ihn bedient und was er über einen weiß. Gedacht als Link im Unternehmensportal (Intune) oder im Intranet.

- Reines HTML, CSS und JavaScript – kein PHP, keine Datenbank, keine Cookies, keine externen Abrufe (Schriften liegen bei, also auch kein Google Fonts).
- Läuft auch hinter einer strengen Content-Security-Policy (kein Inline-CSS oder -JavaScript).
- Für Suchmaschinen gesperrt (`noindex`).

## 1. Angaben eintragen

`einstellungen.js` öffnen und ausfüllen. Leere Felder blendet die Seite einfach aus.

| Feld | Wirkung |
|---|---|
| `firma` | erscheint im Fenstertitel |
| `itName` | „Wende dich an …“ im Hilfe-Bereich, z. B. `'den IT-Service der Muster GmbH'` |
| `mail`, `telefon`, `portal` | Kontaktzeile im Hilfe-Bereich |
| `impressum`, `datenschutz` | Links im Fuß der Seite (nur `https://`-Links werden übernommen) |
| `version` | angezeigte Sudo-Version |

**Wichtig:** Ist die Seite öffentlich erreichbar, braucht sie in Deutschland ein Impressum und einen Link zur Datenschutzerklärung. Für eine reine Intranet-Seite ist das je nach Fall anders zu bewerten – im Zweifel die Links eurer Firmen-Website eintragen.

## 2. Hochladen

**Variante A – in der Sudo-Zentrale (empfohlen):** den kompletten Ordner als `info/` neben die `index.php` der PHP-Zentrale hochladen (ab Zentrale 1.4.1). Adresse: `https://sudo.meikosoft.net/info/`. Die Startseite der Zentrale zeigt dann zusätzlich „Was ist Sudo?“.
Bei der Node-Zentrale den Ordner nach `public/info/` legen.

**Variante B – eigener Webspace oder Intranet:** Ordner an beliebiger Stelle hochladen, `index.html` ist die Startseite.

## 3. In Intune verlinken

Bei der Win32-App „Sudo“ (Apps → Windows → Sudo → Eigenschaften → App-Informationen):
- **Informations-URL:** `https://sudo.meikosoft.net/info/`
- **Datenschutz-URL:** z. B. `https://sudo.meikosoft.net/info/#datenschutz` oder eure Datenschutzerklärung

Beide Links erscheinen im Unternehmensportal bei der App.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die Seite |
| `einstellungen.js` | eure Angaben |
| `css/sudo.css` | Gestaltung |
| `js/sudo.js` | der laufende Sudo auf der Taskleiste, Uhr, Angaben einsetzen |
| `img/` | Sudo-Grafiken, direkt aus dem Original-Sprite-Sheet erzeugt |
| `fonts/` | Pixelify Sans (Überschriften), Atkinson Hyperlegible (Text) – beide unter SIL Open Font License |

Wer in Windows „Animationen anzeigen“ ausgeschaltet hat, sieht Sudo still stehen; anklicken geht trotzdem.
