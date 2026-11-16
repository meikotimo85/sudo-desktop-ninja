<#
  intune-paket.ps1 – packt die Sudo-MSI als .intunewin für eine Win32-App in Intune.

  Ablauf:
    1. Sucht die neueste dist\Sudo-*.msi
    2. Lädt bei Bedarf das offizielle Microsoft Win32 Content Prep Tool (IntuneWinAppUtil.exe) von GitHub
    3. Packt MSI + install.ps1 + uninstall.ps1 (aus intune\vorlage) in intune\ausgabe\Sudo-<Version>.intunewin
    4. Schreibt das Erkennungsskript Sudo-<Version>-Erkennung.ps1 und eine Textdatei mit allen Werten für Intune

  Seit 1.4.2: Installation, Deinstallation und Erkennung hängen nicht mehr am Produktcode der MSI (der ändert sich
  bei jeder Version). Für ein Update reicht es, in der bestehenden App die .intunewin und das Erkennungsskript zu tauschen.

  Start: Doppelklick auf INTUNE-PAKET.bat (oder: powershell -ExecutionPolicy Bypass -File intune\intune-paket.ps1)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $PSScriptRoot 'werkzeug'
$out = Join-Path $PSScriptRoot 'ausgabe'
$src = Join-Path $PSScriptRoot 'quelle'

$msi = Get-ChildItem (Join-Path $root 'dist') -Filter 'Sudo-*.msi' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) { Write-Host 'Keine MSI gefunden. Bitte zuerst BAUEN.bat ausführen und [3] MSI wählen.' -ForegroundColor Red; exit 1 }
Write-Host "MSI: $($msi.Name)"

# Microsoft Win32 Content Prep Tool holen (einmalig)
New-Item -ItemType Directory -Force -Path $tools, $out | Out-Null
$util = Join-Path $tools 'IntuneWinAppUtil.exe'
if (-not (Test-Path $util)) {
  Write-Host 'Lade IntuneWinAppUtil.exe von Microsoft (GitHub) ...'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe' -OutFile $util
}

# Quellordner: MSI + Installations- und Deinstallationsskript
if (Test-Path $src) { Remove-Item $src -Recurse -Force }
New-Item -ItemType Directory -Force -Path $src | Out-Null
Copy-Item $msi.FullName $src
$vorlage = Join-Path $PSScriptRoot 'vorlage'
Copy-Item (Join-Path $vorlage 'install.ps1'), (Join-Path $vorlage 'uninstall.ps1') $src

# MSI-Eigenschaften für die Erkennungsregel auslesen
function Get-MsiProperty($path, $name) {
  $wi = New-Object -ComObject WindowsInstaller.Installer
  $db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @($path, 0))
  $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='$name'"))
  $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
  $rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
  if ($rec) { return $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, 1) }
}
$product = Get-MsiProperty $msi.FullName 'ProductCode'
$version = Get-MsiProperty $msi.FullName 'ProductVersion'

& $util -c $src -s 'install.ps1' -o $out -q | Out-Null
$iw = Get-ChildItem $out -Filter '*.intunewin' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$final = Join-Path $out ("Sudo-$version.intunewin")
if ($iw.FullName -ne $final) { Move-Item $iw.FullName $final -Force }
# Erkennungsskript mit der Mindestversion dieses Pakets
$detect = Join-Path $out ("Sudo-$version-Erkennung.ps1")
(Get-Content (Join-Path $vorlage 'detect.ps1') -Raw -Encoding UTF8).Replace('__VERSION__', $version) | Set-Content -Encoding UTF8 $detect

$info = @"
Sudo $version – Werte für Intune (Win32-App)
=============================================
Datei:                  $(Split-Path $final -Leaf)
Name:                   Sudo
Herausgeber:            MeikoSoft
Installationsbefehl:    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
Deinstallationsbefehl:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
Installationsverhalten: System
Neustart:               Bestimmtes Verhalten anhand von Rückgabecodes (Standard: 0 = Erfolg, 3010 = Soft-Reboot)
Betriebssystem:         Windows 10 2004 oder neuer, 64-Bit
Erkennungsregel:        Benutzerdefiniertes Erkennungsskript verwenden
                        Datei: $(Split-Path $detect -Leaf)
                        Skript als 32-Bit-Prozess auf 64-Bit-Clients ausführen: Nein
                        Skriptsignaturprüfung erzwingen: Nein
Zuweisung:              z. B. Gruppe „Sudo-Pilot“ als Erforderlich

Update auf eine neue Version:
  App „Sudo“ öffnen > Eigenschaften > App-Informationen: neue .intunewin hochladen, Version eintragen
  > Erkennungsregeln: das neue Erkennungsskript hochladen > Speichern. Fertig – kein neuer Produktcode nötig.
Protokolle auf dem PC:  C:\ProgramData\Sudo\Logs\install-<Version>.log
"@
$info | Set-Content -Encoding UTF8 (Join-Path $out "Sudo-$version-Intune-Werte.txt")
Remove-Item $src -Recurse -Force
Write-Host ''
Write-Host "Fertig: $final" -ForegroundColor Green
Write-Host $info
explorer $out
