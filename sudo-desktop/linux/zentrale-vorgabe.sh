#!/bin/sh
# zentrale-vorgabe.sh – gibt die Sudo-Zentrale für alle Benutzer eines Linux-PCs vor (Gegenstück zu intune/zentrale-vorgabe.ps1).
# Legt /etc/sudo-desktop/zentrale.json an. Sudo meldet sich damit selbst an und holt sich einen eigenen Geräte-Schlüssel.
#
# Aufruf als root:
#   sudo sh zentrale-vorgabe.sh https://sudo.example.com SZ-XXXX-XXXX-XXXX-XXXX
# Oder über NinjaOne, Ansible & Co. mit den Umgebungsvariablen SudoUrl und SudoCode.
#   sudo sh zentrale-vorgabe.sh --pruefen      Exit 0 = Vorgabe vorhanden, 1 = fehlt
#   sudo sh zentrale-vorgabe.sh --entfernen    Vorgabe löschen (angemeldete Sudos bleiben angemeldet)
#
# Exit-Codes: 0 = OK, 1 = Vorgabe fehlt (nur --pruefen), 2 = falsche Eingabe, 3 = keine Root-Rechte, 4 = Schreiben fehlgeschlagen
set -u
DIR=/etc/sudo-desktop
FILE="$DIR/zentrale.json"

case "${1:-}" in
  --pruefen)
    if [ -s "$FILE" ] && grep -q '"url"' "$FILE" && grep -q '"code"' "$FILE"; then echo "OK: Vorgabe vorhanden ($FILE)"; exit 0; fi
    echo "Vorgabe fehlt"; exit 1 ;;
  --entfernen)
    [ "$(id -u)" -eq 0 ] || { echo "FEHLER: Bitte als root ausführen (sudo)."; exit 3; }
    rm -f "$FILE" && echo "Vorgabe entfernt."; exit 0 ;;
esac

URL="${1:-${SudoUrl:-}}"
CODE="${2:-${SudoCode:-}}"
URL="$(printf '%s' "$URL" | sed 's:/*$::')"

[ "$(id -u)" -eq 0 ] || { echo "FEHLER: Bitte als root ausführen (sudo)."; exit 3; }
case "$URL" in
  https://sudo.example.com*|'') echo "FEHLER: Adresse der Zentrale fehlt. Als erstes Argument oder Variable SudoUrl angeben."; exit 2 ;;
  https://*) ;;
  *) echo "FEHLER: Adresse muss mit https:// beginnen (ist: '$URL')."; exit 2 ;;
esac
case "$CODE" in
  ''|SZ-XXXX*) echo "FEHLER: Registrierungscode fehlt. Als zweites Argument oder Variable SudoCode angeben."; exit 2 ;;
esac
# Nur einfache Zeichen zulassen – dann braucht das JSON kein Escaping
printf '%s' "$URL$CODE" | grep -q '["\\]' && { echo "FEHLER: Anführungszeichen oder Backslash sind nicht erlaubt."; exit 2; }

mkdir -p "$DIR" || exit 4
# Lesbar für alle (Sudo läuft als normaler Benutzer), schreibbar nur für root
umask 022
printf '{\n  "url": "%s",\n  "code": "%s"\n}\n' "$URL" "$CODE" > "$FILE" || exit 4
chmod 644 "$FILE"
echo "OK: Vorgabe geschrieben ($FILE). Sudo meldet sich innerhalb von 5 Minuten an."
exit 0
