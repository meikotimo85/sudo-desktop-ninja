<#
  zentrale-vorgabe.ps1 – gibt die Sudo-Zentrale für alle Benutzer eines PCs vor.
  Legt C:\ProgramData\Sudo\zentrale.json an. Sudo meldet sich damit selbst an und holt sich einen eigenen Geräte-Schlüssel:
  ab Sudo 1.5.1 innerhalb von 5 Minuten, ältere Versionen beim nächsten Start.

  Läuft als SYSTEM oder Administrator. Verteilen über:
    - NinjaOne:  Administration → Bibliothek → Automatisierung → neues Skript (PowerShell, „Ausführen als: System“).
                 Adresse und Code entweder unten eintragen oder als Skriptvariablen „SudoUrl“ und „SudoCode“ anlegen.
    - Intune:    Geräte → Skripts und Wartungen → Plattformskripts. „Mit Anmeldeinformationen des Benutzers“ = Nein.
    - Von Hand:  PowerShell als Administrator:  .\zentrale-vorgabe.ps1 -Url https://sudo.example.com -Code SZ-…

  Weitere Schalter:
    -Pruefen     nur prüfen (Exit 0 = Vorgabe vorhanden und gültig, 1 = fehlt/falsch) – für NinjaOne-Bedingungen oder Intune-Wartungen
    -Entfernen   Vorgabe wieder löschen (bereits angemeldete Sudos bleiben angemeldet)

  Exit-Codes: 0 = OK, 1 = Vorgabe fehlt (nur -Pruefen), 2 = falsche Eingabe, 3 = keine Adminrechte, 4 = Schreiben fehlgeschlagen
#>
param(
  [string]$Url  = 'https://sudo.example.com',   # Adresse der Zentrale
  [string]$Code = 'SZ-XXXX-XXXX-XXXX-XXXX',       # Registrierungscode aus der Verwaltung (mehrfach nutzbar, mit Ablaufdatum)
  [switch]$Pruefen,
  [switch]$Entfernen
)

# Skriptvariablen von NinjaOne (und anderen RMM-Werkzeugen) kommen als Umgebungsvariablen und haben Vorrang
if ($env:SudoUrl)  { $Url  = $env:SudoUrl }
if ($env:SudoCode) { $Code = $env:SudoCode }
if ($env:SudoEntfernen -match '^(1|true|ja|yes|on)$') { $Entfernen = $true }
if ($env:SudoPruefen   -match '^(1|true|ja|yes|on)$') { $Pruefen = $true }
$Url  = "$Url".Trim().TrimEnd('/')
$Code = "$Code".Trim()

$dir  = Join-Path $env:ProgramData 'Sudo'
$file = Join-Path $dir 'zentrale.json'

function Lies-Vorgabe {
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8) | ConvertFrom-Json } catch { return $null }
}

# ---------- Nur prüfen ----------
if ($Pruefen) {
  $v = Lies-Vorgabe
  if ($v -and $v.url -and $v.code -and ($Code -like 'SZ-XXXX*' -or ($v.url -eq $Url -and $v.code -eq $Code))) {
    Write-Output "OK: Vorgabe vorhanden ($($v.url))"; exit 0
  }
  Write-Output "Vorgabe fehlt oder weicht ab: $file"; exit 1
}

# ---------- Adminrechte ----------
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Output 'FEHLER: Bitte als Administrator oder SYSTEM ausführen.'; exit 3
}

# ---------- Entfernen ----------
if ($Entfernen) {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force; Write-Output "Vorgabe entfernt: $file" }
  else { Write-Output 'Keine Vorgabe vorhanden – nichts zu tun.' }
  exit 0
}

# ---------- Eingaben prüfen ----------
if ($Code -eq '' -or $Code -like 'SZ-XXXX*') { Write-Output 'FEHLER: Registrierungscode fehlt. Im Skript eintragen oder Skriptvariable "SudoCode" setzen.'; exit 2 }
if ($Url -notmatch '^https://[^\s/]+') { Write-Output "FEHLER: Adresse muss mit https:// beginnen (ist: '$Url')."; exit 2 }
if ($Url -match '^https://sudo\.example\.com') { Write-Output 'FEHLER: Adresse der Zentrale fehlt. Im Skript eintragen oder Skriptvariable "SudoUrl" setzen.'; exit 2 }

# ---------- Schreiben ----------
try {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $json = [ordered]@{ url = $Url; code = $Code } | ConvertTo-Json
  # Ohne BOM schreiben: Windows PowerShell 5.1 setzt bei -Encoding UTF8 eine BOM davor, ältere Sudos können die Datei dann nicht lesen
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  [IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))

  # Rechte: SYSTEM und Administratoren Vollzugriff, Benutzer nur lesen.
  # SIDs statt Namen – auf deutschem Windows heißen die Gruppen „Administratoren“ und „Benutzer“.
  $out = & icacls.exe $file /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-32-545:R' 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Output "Hinweis: Rechte konnten nicht gesetzt werden ($out). Die Vorgabe funktioniert trotzdem." }
} catch {
  Write-Output "FEHLER beim Schreiben von ${file}: $($_.Exception.Message)"; exit 4
}

# ---------- Kontrolle ----------
$v = Lies-Vorgabe
if (-not $v -or $v.url -ne $Url -or $v.code -ne $Code) { Write-Output "FEHLER: $file wurde geschrieben, lässt sich aber nicht zurücklesen."; exit 4 }

$pf  = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$exe = Join-Path $pf 'Sudo\Sudo.exe'
$installiert = if (Test-Path $exe) { 'ja (' + (Get-Item $exe).VersionInfo.ProductVersion + ')' } else { 'nicht unter Program Files gefunden' }
$laeuft = @(Get-Process -Name 'Sudo' -ErrorAction SilentlyContinue).Count

Write-Output "Sudo-Zentrale vorgegeben: $Url"
Write-Output "Datei: $file"
Write-Output "Sudo installiert: $installiert · laufende Sudo-Prozesse: $laeuft"
Write-Output 'Sudo meldet sich ab Version 1.5.1 innerhalb von 5 Minuten an, ältere Versionen beim nächsten Start.'
exit 0
