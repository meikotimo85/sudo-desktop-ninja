<#
  detect.ps1 – Erkennungsskript der Intune-Win32-App „Sudo“.
  „Installiert“, wenn über den festen UpgradeCode eine Sudo-Version gefunden wird, die mindestens so neu ist wie dieses Paket.
  Die Mindestversion setzt intune-paket.ps1 beim Packen ein.
#>
$UpgradeCode = '{07483F7E-961E-4428-B7E4-754ECF4F2568}'
$Mindestens = [version]'__VERSION__'
try {
  $wi = New-Object -ComObject WindowsInstaller.Installer
  foreach ($pc in @($wi.GetType().InvokeMember('RelatedProducts', 'GetProperty', $null, $wi, @($UpgradeCode)))) {
    $v = $wi.GetType().InvokeMember('ProductInfo', 'GetProperty', $null, $wi, @($pc, 'VersionString'))
    if ([version]$v -ge $Mindestens) { Write-Output "Sudo $v installiert"; exit 0 }
  }
} catch { }
exit 1
