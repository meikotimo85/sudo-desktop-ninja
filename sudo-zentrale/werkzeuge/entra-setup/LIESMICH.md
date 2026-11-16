# Sudo-Entra-Setup

Richtet die Microsoft-Entra-App der Sudo-Zentrale ein: App-Registrierung, Berechtigungen, Administratorzustimmung, Freigabe der SharePoint-Websites (nur lesen), Geheimnis – und trägt alles direkt in der Zentrale ein. Beliebig oft ausführbar: Vorhandenes wird erkannt und nur ergänzt.

**Zukunftssicher:** Das Setup fragt die Zentrale, was sie braucht (`/api/entra-manifest`, ab Zentrale 1.9.1). Bringt eine spätere Version neue Funktionen mit, die Microsoft-Berechtigungen brauchen, richtet dasselbe Setup sie mit ein. Ist die Zentrale älter oder nicht erreichbar, nimmt es die eingebauten Vorgaben (Stand 1.9).

## Voraussetzungen

- Windows PowerShell 5.1 (in Windows enthalten) oder PowerShell 7
- Modul `Microsoft.Graph.Authentication` – fehlt es, bietet das Setup die Installation für den eigenen Benutzer an
- Ein Konto mit **Globaler Administrator** oder **Anwendungsadministrator + SharePoint-Administrator** (für App anlegen, Zustimmung erteilen und Websites freigeben)
- Für das automatische Eintragen in die Zentrale: das **Admin-Passwort** (Notfall-Zugang, `local_login`). Ohne Passwort zeigt das Setup die Werte zum Abtippen an.

## Benutzung

**Geführt:** `Sudo-Entra-Setup.cmd` doppelklicken und die Fragen beantworten.

**Mit Parametern** (PowerShell):

```powershell
# Wissen aus SharePoint einrichten und direkt in der Zentrale eintragen
.\Sudo-Entra-Setup.ps1 -ZentraleUrl https://sudo.meikosoft.net -SharePoint "https://firma.sharepoint.com/sites/IT/Freigegebene Dokumente/Anleitungen"

# Zusätzlich die Microsoft-Anmeldung an der Verwaltung vorbereiten (Ausgabe für config.php)
.\Sudo-Entra-Setup.ps1 -ZentraleUrl https://sudo.meikosoft.net -Anmeldung -Admins admin@firma.de

# Erst schauen, was passieren würde (ändert nichts)
.\Sudo-Entra-Setup.ps1 -Probelauf -ZentraleUrl https://sudo.meikosoft.net -SharePoint "<Link>"

# Prüfen: Berechtigungen, Freigaben, Ablauf des Geheimnisses (Exit-Code 1 bei Problemen)
.\Sudo-Entra-Setup.ps1 -Pruefen -ZentraleUrl https://sudo.meikosoft.net -SharePoint "<Link>"

# Geheimnis erneuern (vor Ablauf), in der Zentrale eintragen und alte Geheimnisse löschen
.\Sudo-Entra-Setup.ps1 -NeuesGeheimnis -AlteGeheimnisseEntfernen -ZentraleUrl https://sudo.meikosoft.net

# Weitere SharePoint-Website freigeben
.\Sudo-Entra-Setup.ps1 -ZentraleUrl https://sudo.meikosoft.net -SharePoint "https://firma.sharepoint.com/sites/Vertrieb/SitePages"

# App komplett entfernen (mit Sicherheitsabfrage)
.\Sudo-Entra-Setup.ps1 -Entfernen
```

| Parameter | Bedeutung |
|---|---|
| `-ZentraleUrl` | Adresse der Zentrale (für Anforderungen, Umleitungs-URI und das Eintragen) |
| `-SharePoint` | Ein oder mehrere Links zu Ordnern, Bibliotheken oder Websiteseiten – die Websites werden freigegeben und als Quellen eingetragen |
| `-Anmeldung` | Auch die Microsoft-Anmeldung an der Verwaltung einrichten |
| `-Admins` | Anmeldenamen für `admin_users` (nur Ausgabe) |
| `-Funktionen` | Genau diese Funktionen aus dem Manifest einrichten (z. B. `kb`, `login`) |
| `-TenantId` | Bestimmter Tenant (bei mehreren Konten) |
| `-GeheimnisMonate` | Gültigkeit des Geheimnisses, 1–24 (Standard 24; lehnt eine Tenant-Richtlinie ab, versucht das Setup 12 und 6) |
| `-NeuesGeheimnis`, `-AlteGeheimnisseEntfernen` | Geheimnis erneuern; alte werden erst gelöscht, wenn das neue in der Zentrale getestet ist |
| `-Probelauf`, `-Pruefen` | Nichts ändern – nur zeigen bzw. prüfen |
| `-Entfernen` | App löschen (30 Tage wiederherstellbar) |

## Was eingerichtet wird

- App-Registrierung **Sudo-Zentrale** (nur dieser Tenant), markiert mit dem Tag `SudoZentrale` – daran erkennt das Setup sie wieder, auch wenn sie umbenannt wurde
- Wissen: Anwendungsberechtigung **Sites.Selected** mit Administratorzustimmung und **Lesen** nur für die angegebenen Websites
- Anmeldung (optional): `openid profile email` mit Zustimmung für alle, Umleitungs-URI `…/auth/callback`, Gruppen-Claim
- Geheimnis (Standard 24 Monate) – und eine **Kalender-Erinnerung** auf dem Desktop (`Sudo-Geheimnis-erneuern.ics`, 3 Wochen vor Ablauf)

Das Setup speichert selbst nichts. Das Geheimnis geht nur an die Zentrale (HTTPS) oder wird einmal angezeigt.

## Hinweis zum Ausführen

Aus dem Internet geladene Skripte blockiert Windows ggf. – der Starter `.cmd` nutzt deshalb `-ExecutionPolicy Bypass` nur für diesen Aufruf. Alternativ: Rechtsklick auf die `.ps1` → Eigenschaften → „Zulassen“.
