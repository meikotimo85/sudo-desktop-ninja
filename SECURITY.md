# Sicherheitslücken melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue.

Nutze stattdessen die vertrauliche Meldung von GitHub: im Repository unter **Security → Report a vulnerability**. Die Meldung sehen nur die Betreuer. Alternativ per E-Mail an info@meikosoft.net.

Hilfreich sind:

- betroffener Teil (Client, PHP-Zentrale, Node-Zentrale) und Version
- Schritte zum Nachstellen
- Einschätzung, was ein Angreifer damit erreichen kann

Du bekommst eine Rückmeldung, sobald die Meldung gesichtet ist. Bitte gib uns Zeit für eine Korrektur, bevor du Einzelheiten veröffentlichst.

## Unterstützte Versionen

Korrekturen gibt es für die jeweils neueste Version von Client und Zentrale.

## Hinweise für Betreiber

- Zugangsdaten gehören in `config.php`, Umgebungsvariablen oder die Einstellungen der Zentrale, nie ins Repository.
- Die Passwort-Anmeldung der Verwaltung ist für den Notfall gedacht. Im Betrieb die Anmeldung über Microsoft Entra ID verwenden.
- Die gebauten Programme sind nicht signiert. Verteile nur selbst gebaute oder geprüfte Pakete.
