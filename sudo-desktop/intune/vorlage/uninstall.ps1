<#
  uninstall.ps1 – Deinstallations-Befehl der Intune-Win32-App „Sudo“ (läuft als SYSTEM).
  Findet jede installierte Sudo-Version über den festen UpgradeCode – egal, welche Version gerade drauf ist.
#>
$UpgradeCode = '{07483F7E-961E-4428-B7E4-754ECF4F2568}'
Get-Process -Name 'Sudo' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$wi = New-Object -ComObject WindowsInstaller.Installer
$codes = @($wi.GetType().InvokeMember('RelatedProducts', 'GetProperty', $null, $wi, @($UpgradeCode)))
if (-not $codes.Count) { Write-Output 'Sudo ist nicht installiert.'; exit 0 }
$result = 0
foreach ($pc in $codes) {
  $p = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @('/x', $pc, '/qn', '/norestart') -Wait -PassThru
  Write-Output "Deinstalliert $pc – Ergebnis $($p.ExitCode)"
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { $result = $p.ExitCode } elseif ($p.ExitCode -eq 3010 -and $result -eq 0) { $result = 3010 }
}
exit $result
