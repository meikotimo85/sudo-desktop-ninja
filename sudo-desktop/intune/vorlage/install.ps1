<#
  install.ps1 – Installations-Befehl der Intune-Win32-App „Sudo“ (läuft als SYSTEM).
  1. Beendet laufende Sudo-Prozesse (sonst sind Dateien belegt und das Update hängt bis zum Neustart)
  2. Installiert/aktualisiert die beiliegende MSI still (MajorUpgrade entfernt die alte Version selbst)
  3. Startet Sudo für angemeldete Benutzer wieder, falls er vorher lief
  Protokoll: C:\ProgramData\Sudo\Logs\install-<Version>.log
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$msi = Get-ChildItem $here -Filter 'Sudo-*.msi' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $msi) { Write-Output 'Keine MSI im Paket gefunden.'; exit 1603 }

$logDir = Join-Path $env:ProgramData 'Sudo\Logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("install-" + ($msi.BaseName -replace '^Sudo-', '') + '.log')

# 1. Laufende Instanzen beenden (alle Sitzungen)
$wasRunning = @(Get-Process -Name 'Sudo' -ErrorAction SilentlyContinue).Count -gt 0
if ($wasRunning) {
  Get-Process -Name 'Sudo' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# 2. MSI installieren
$p = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @('/i', "`"$($msi.FullName)`"", '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
$code = $p.ExitCode
Write-Output "msiexec beendet mit $code ($($msi.Name))"

# 3. Für angemeldete Benutzer wieder starten (einmalige Aufgabe für die Gruppe „Benutzer“, läuft in deren Sitzung)
if ($wasRunning -and ($code -eq 0 -or $code -eq 3010)) {
  $pf = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
  $exe = Join-Path $pf 'Sudo\Sudo.exe'
  if (Test-Path $exe) {
    try {
      $name = 'Sudo-Neustart-nach-Update'
      $action = New-ScheduledTaskAction -Execute $exe
      $principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
      Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Force | Out-Null
      Start-ScheduledTask -TaskName $name
      Start-Sleep -Seconds 5
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
    } catch { Write-Output "Neustart für Benutzer nicht möglich: $($_.Exception.Message)" }
  }
}
exit $code
