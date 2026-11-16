<#
.SYNOPSIS
  Sudo-Entra-Setup – richtet die Microsoft-Entra-App der Sudo-Zentrale ein, prüft sie oder erneuert ihr Geheimnis.

.DESCRIPTION
  Legt die App-Registrierung »Sudo-Zentrale« an (oder findet die vorhandene), vergibt die Berechtigungen, erteilt die
  Administratorzustimmung, gibt SharePoint-Websites frei (nur lesen), erzeugt ein Geheimnis und trägt alles direkt in
  die Sudo-Zentrale ein. Beliebig oft ausführbar: Vorhandenes wird erkannt und nur ergänzt.

  Welche Berechtigungen nötig sind, fragt das Setup bei der Zentrale ab (/api/entra-manifest). Bringt eine künftige
  Zentrale neue Funktionen mit, richtet dieses Setup sie ohne Änderung mit ein.

  Läuft mit Windows PowerShell 5.1 und PowerShell 7. Braucht das Modul Microsoft.Graph.Authentication (wird bei Bedarf
  für den aktuellen Benutzer installiert) und ein Konto mit Rechten zum Anlegen von Apps und zum Erteilen der
  Administratorzustimmung (z. B. Globaler Administrator oder Anwendungsadministrator + SharePoint-Administrator).

.EXAMPLE
  .\Sudo-Entra-Setup.ps1
  Geführte Einrichtung mit Fragen.

.EXAMPLE
  .\Sudo-Entra-Setup.ps1 -ZentraleUrl https://sudo.meikosoft.net -SharePoint "https://firma.sharepoint.com/sites/IT/Freigegebene Dokumente/Anleitungen"
  Wissen aus SharePoint einrichten und direkt in der Zentrale eintragen.

.EXAMPLE
  .\Sudo-Entra-Setup.ps1 -Pruefen -ZentraleUrl https://sudo.meikosoft.net
  Nur prüfen (ändert nichts): Berechtigungen, Freigaben, Ablauf des Geheimnisses.

.EXAMPLE
  .\Sudo-Entra-Setup.ps1 -NeuesGeheimnis -AlteGeheimnisseEntfernen -ZentraleUrl https://sudo.meikosoft.net
  Geheimnis erneuern (z. B. kurz vor Ablauf), in der Zentrale eintragen, alte Geheimnisse löschen.
#>
[CmdletBinding()]
param(
  [string]$ZentraleUrl,
  [string]$TenantId,
  [string[]]$SharePoint,
  [string[]]$Funktionen,
  [switch]$Anmeldung,
  [string[]]$Admins,
  [ValidateRange(1, 24)][int]$GeheimnisMonate = 24,
  [switch]$NeuesGeheimnis,
  [switch]$AlteGeheimnisseEntfernen,
  [switch]$Probelauf,
  [switch]$Pruefen,
  [switch]$Entfernen,
  [string]$AppName
)

$ErrorActionPreference = 'Stop'
$SetupVersion = '1.0.1'
$ManifestVersion = 1                       # höchste Manifest-Version, die dieses Setup versteht
$GraphAppId = '00000003-0000-0000-c000-000000000000'
$Interaktiv = ($PSBoundParameters.Count -eq 0)
$Probleme = New-Object System.Collections.ArrayList

# Eingebaute Vorgaben (Stand Zentrale 1.9) – falls die Zentrale nicht erreichbar oder älter ist
$StandardManifest = @'
{ "manifest": 1, "zentrale": "1.9.0", "publicUrl": "", "app": { "name": "Sudo-Zentrale", "tag": "SudoZentrale" },
  "features": {
    "kb": { "title": "Wissen aus SharePoint (Anleitungen)", "graph": { "application": ["Sites.Selected"], "delegated": [] }, "siteRole": "read",
            "settings": { "tenant": "kb_tenant", "clientId": "kb_client_id", "secret": "kb_client_secret", "enable": "kb_enabled" },
            "test": "/admin/api/kb/test", "addSource": "/admin/api/kb/sources" },
    "login": { "title": "Anmeldung an der Verwaltung mit Microsoft", "graph": { "application": [], "delegated": ["openid", "profile", "email"] },
               "redirect": "/auth/callback", "groupClaims": true, "config": "php" } } }
'@

# ---------------------------------------------------------------- Ausgabe
function Schritt([string]$t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info([string]$t) { Write-Host "       $t" }
function Hinweis([string]$t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Problem([string]$t) { Write-Host "  [X]  $t" -ForegroundColor Red; [void]$Probleme.Add($t) }
function Frage([string]$t, [string]$standard) {
  $a = Read-Host ("  " + $t + $(if ($standard) { " [$standard]" } else { '' }))
  if ([string]::IsNullOrWhiteSpace($a)) { return $standard } else { return $a.Trim() }
}
function JaNein([string]$t, [bool]$standard) {
  $s = if ($standard) { 'J' } else { 'N' }
  $a = Frage "$t (J/N)" $s
  return ($a -match '^(j|ja|y|yes)$')
}
function Fehlertext($err) {
  $m = ''
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $m = $err.ErrorDetails.Message }
  if (-not $m) { $m = $err.Exception.Message }
  try { $j = $m | ConvertFrom-Json; if ($j.message) { return [string]$j.message }; if ($j.error.message) { return [string]$j.error.message } } catch { }
  return ($m -split "`n")[0]
}

# ---------------------------------------------------------------- Microsoft Graph
function G([string]$Method, [string]$Uri, $Body) {
  $p = @{ Method = $Method; Uri = ('https://graph.microsoft.com/v1.0/' + $Uri.TrimStart('/')) }
  if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Depth 20 -Compress); $p.ContentType = 'application/json' }
  return Invoke-MgGraphRequest @p
}
# Schreibender Aufruf – im Probelauf und beim Prüfen nur anzeigen
function W([string]$Method, [string]$Uri, $Body, [string]$Was) {
  if ($Probelauf -or $Pruefen) { Info "[Probelauf] würde: $Was"; return $null }
  return G $Method $Uri $Body
}
function GFilter([string]$f) { return '$filter=' + [uri]::EscapeDataString($f) }
function Wiederholen([scriptblock]$Aktion, [string]$Was, [int]$Versuche = 8) {
  for ($i = 1; $i -le $Versuche; $i++) {
    try { return & $Aktion }
    catch { if ($i -eq $Versuche) { throw }; Info "$Was – Microsoft braucht noch einen Moment (Versuch $i) …"; Start-Sleep -Seconds 6 }
  }
}

# ---------------------------------------------------------------- Zentrale
function ZentraleBasis([string]$u) { return ($u.Trim() -replace '/+$', '') }
function JsonBytes($o) { return [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 10 -Compress)) }
function ZentraleAnmelden([string]$basis) {
  $pw = Read-Host '  Admin-Passwort der Zentrale (Notfall-Zugang; leer = überspringen)' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
  if (-not $plain) { return $null }
  try {
    $null = Invoke-WebRequest -Uri "$basis/auth/password" -Method Post -Body (JsonBytes @{ password = $plain }) -ContentType 'application/json; charset=utf-8' -SessionVariable sz -UseBasicParsing -TimeoutSec 20
    $me = Invoke-RestMethod -Uri "$basis/admin/api/me" -WebSession $sz -UseBasicParsing -TimeoutSec 20
    if (-not $me.csrf) { throw 'Keine Sitzung' }
    return @{ Session = $sz; Csrf = [string]$me.csrf; Basis = $basis }
  } catch {
    Hinweis ('Anmeldung an der Zentrale fehlgeschlagen: ' + (Fehlertext $_) + '. Ist der Notfall-Zugang (local_login) aktiv?')
    return $null
  } finally { $plain = $null }
}
function ZentraleAufruf($z, [string]$Method, [string]$Pfad, $Body) {
  $p = @{ Uri = ($z.Basis + $Pfad); Method = $Method; WebSession = $z.Session; Headers = @{ 'x-csrf' = $z.Csrf }; UseBasicParsing = $true; TimeoutSec = 120 }
  if ($null -ne $Body) { $p.Body = (JsonBytes $Body); $p.ContentType = 'application/json; charset=utf-8' }
  return Invoke-RestMethod @p
}

# ---------------------------------------------------------------- SharePoint-Link → Website
function WebsiteAusLink([string]$link) {
  $u = [uri]$link.Trim()
  if ($u.Scheme -ne 'https' -or $u.Host -notmatch '\.sharepoint\.(com|de|us)$') { throw "Kein SharePoint-Link: $link" }
  $pfad = [uri]::UnescapeDataString($u.AbsolutePath)
  if ($u.Query -match '[?&](id|RootFolder)=([^&]+)') { $pfad = [uri]::UnescapeDataString($Matches[2]) }
  if ($pfad -match '^/(sites|teams)/([^/]+)') { return @{ Host = $u.Host.ToLower(); Pfad = "/$($Matches[1])/$($Matches[2])"; Graph = "sites/$($u.Host.ToLower()):/$($Matches[1])/$($Matches[2])" } }
  return @{ Host = $u.Host.ToLower(); Pfad = '/'; Graph = "sites/$($u.Host.ToLower())" }
}

# ================================================================= Start
Write-Host ''
Write-Host "  sudo  Entra-Setup $SetupVersion" -ForegroundColor Cyan
Write-Host '  App-Registrierung für die Sudo-Zentrale einrichten, prüfen oder erneuern'
if ($Probelauf) { Hinweis 'Probelauf: Es wird nichts geändert.' }
if ($Pruefen) { Hinweis 'Prüfen: Es wird nichts geändert.' }

if ($Interaktiv) {
  Write-Host ''
  Write-Host '  1  Einrichten oder ergänzen'
  Write-Host '  2  Nur prüfen (ändert nichts)'
  Write-Host '  3  Geheimnis erneuern'
  Write-Host '  4  Probelauf (zeigt, was passieren würde)'
  $wahl = Frage 'Was möchtest du tun?' '1'
  switch ($wahl) { '2' { $Pruefen = $true } '3' { $NeuesGeheimnis = $true } '4' { $Probelauf = $true } }
  $ZentraleUrl = Frage 'Adresse der Sudo-Zentrale' 'https://sudo.meikosoft.net'
}

# ---------------------------------------------------------------- Manifest der Zentrale
Schritt 'Anforderungen der Zentrale'
$manifest = $null
if ($ZentraleUrl) {
  $ZentraleUrl = ZentraleBasis $ZentraleUrl
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $manifest = Invoke-RestMethod -Uri "$ZentraleUrl/api/entra-manifest" -UseBasicParsing -TimeoutSec 20
    Ok "Zentrale $($manifest.zentrale) unter $ZentraleUrl"
  } catch { Hinweis "Die Zentrale liefert keine Anforderungen (älter als 1.9 oder nicht erreichbar) – nutze die eingebauten Vorgaben." }
}
if (-not $manifest) { $manifest = $StandardManifest | ConvertFrom-Json; if ($ZentraleUrl) { $manifest.publicUrl = $ZentraleUrl } }
if ([int]$manifest.manifest -gt $ManifestVersion) { Hinweis 'Die Zentrale ist neuer als dieses Setup. Es läuft trotzdem; hol dir bei Gelegenheit das aktuelle Setup aus dem Paket der Zentrale.' }
$tag = [string]$manifest.app.tag
if (-not $AppName) { $AppName = [string]$manifest.app.name }
$alleFunktionen = @($manifest.features.PSObject.Properties | ForEach-Object { $_.Name })

if (-not $Funktionen) {
  if ($Interaktiv) {
    $Funktionen = @()
    foreach ($f in $alleFunktionen) {
      $std = ($f -eq 'kb')
      if (JaNein ("Einrichten: " + $manifest.features.$f.title + '?') $std) { $Funktionen += $f }
    }
  } else {
    $Funktionen = @('kb'); if ($Anmeldung) { $Funktionen += 'login' }
  }
}
$Funktionen = @($Funktionen | Where-Object { $alleFunktionen -contains $_ })
if (-not $Funktionen.Count -and -not $Entfernen) { Hinweis 'Keine Funktion gewählt – nichts zu tun.'; return }
foreach ($f in $Funktionen) { Info ('- ' + $manifest.features.$f.title) }

if ($Interaktiv -and ($Funktionen -contains 'kb') -and -not $Pruefen -and -not $SharePoint) {
  Info 'SharePoint-Links zu den Anleitungen (Ordner, Bibliothek oder …/SitePages). Leer = fertig.'
  $SharePoint = @()
  while ($true) { $l = Frage 'Link' ''; if (-not $l) { break }; $SharePoint += $l }
}

# ---------------------------------------------------------------- Anmelden bei Microsoft
Schritt 'Anmeldung bei Microsoft'
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
  Hinweis 'Das Modul Microsoft.Graph.Authentication fehlt.'
  if (-not $Interaktiv -or (JaNein 'Jetzt für deinen Benutzer installieren?' $true)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue)) { Install-PackageProvider -Name NuGet -Scope CurrentUser -Force | Out-Null }
    Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force -AllowClobber
  } else { throw 'Ohne das Modul geht es nicht: Install-Module Microsoft.Graph.Authentication -Scope CurrentUser' }
}
Import-Module Microsoft.Graph.Authentication
$scopes = @('Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'DelegatedPermissionGrant.ReadWrite.All', 'Sites.FullControl.All')
$cp = @{ Scopes = $scopes }
if ($TenantId) { $cp.TenantId = $TenantId }
if ((Get-Command Connect-MgGraph).Parameters.ContainsKey('NoWelcome')) { $cp.NoWelcome = $true }
Connect-MgGraph @cp | Out-Null
$ctx = Get-MgContext
if (-not $ctx) { throw 'Anmeldung bei Microsoft fehlgeschlagen.' }
$tenant = [string]$ctx.TenantId
Ok "Angemeldet als $($ctx.Account) (Tenant $tenant)"

$graphSp = @((G GET ('servicePrincipals?' + (GFilter "appId eq '$GraphAppId'"))).value | Where-Object { $_ })[0]
if (-not $graphSp) { throw 'Microsoft Graph ist in diesem Tenant nicht zu finden.' }

# Benötigte Berechtigungen aus dem Manifest
$appRollen = @(); $delegiert = @(); $redirects = @(); $gruppen = $false; $seitenRolle = $null
foreach ($f in $Funktionen) {
  $ft = $manifest.features.$f
  if ($ft.graph) { $appRollen += @($ft.graph.application); $delegiert += @($ft.graph.delegated) }
  if ($ft.redirect) { $redirects += ($manifest.publicUrl.TrimEnd('/') + $ft.redirect) }
  if ($ft.groupClaims) { $gruppen = $true }
  if ($ft.siteRole) { $seitenRolle = [string]$ft.siteRole }
}
$appRollen = @($appRollen | Where-Object { $_ } | Select-Object -Unique)
$delegiert = @($delegiert | Where-Object { $_ } | Select-Object -Unique)
$redirects = @($redirects | Where-Object { $_ -match '^https?://[^/]+/' } | Select-Object -Unique)
$rollenIds = @{}; foreach ($r in $appRollen) { $x = @($graphSp.appRoles | Where-Object { $_.value -eq $r })[0]; if (-not $x) { throw "Unbekannte Graph-Berechtigung: $r" }; $rollenIds[$r] = [string]$x.id }
$scopeIds = @{}; foreach ($s in $delegiert) { $x = @($graphSp.oauth2PermissionScopes | Where-Object { $_.value -eq $s })[0]; if (-not $x) { throw "Unbekannte Graph-Berechtigung: $s" }; $scopeIds[$s] = [string]$x.id }

# ---------------------------------------------------------------- App-Registrierung
Schritt 'App-Registrierung'
$apps = @((G GET ('applications?' + (GFilter "tags/any(t:t eq '$tag')"))).value | Where-Object { $_ })
if (-not $apps.Count) { $apps = @((G GET ('applications?' + (GFilter "displayName eq '$($AppName.Replace("'", "''"))'"))).value | Where-Object { $_ }) }
if ($apps.Count -gt 1) { Hinweis "Mehrere passende Apps gefunden – nutze »$($apps[0].displayName)« ($($apps[0].appId))." }
$app = if ($apps.Count) { $apps[0] } else { $null }
$neu = $false

if ($Entfernen) {
  if (-not $app) { Ok 'Keine Sudo-App vorhanden – nichts zu entfernen.'; return }
  Hinweis "Das löscht die App »$($app.displayName)« ($($app.appId)). Wissen aus SharePoint und die Microsoft-Anmeldung der Zentrale funktionieren danach nicht mehr."
  if ((Frage "Zum Bestätigen den Namen der App eintippen" '') -ne $app.displayName) { Info 'Abgebrochen.'; return }
  W DELETE "applications/$($app.id)" $null 'App löschen' | Out-Null
  Ok 'App gelöscht (30 Tage in Entra unter »Gelöschte Anwendungen« wiederherstellbar).'
  return
}

# Gewünschte API-Berechtigungen (vorhandene bleiben erhalten)
$rra = @(); $graphEintrag = $null
if ($app) { foreach ($e in @($app.requiredResourceAccess)) { if ($e.resourceAppId -eq $GraphAppId) { $graphEintrag = $e } else { $rra += $e } } }
$zugriffe = @(); if ($graphEintrag) { $zugriffe = @($graphEintrag.resourceAccess | ForEach-Object { @{ id = [string]$_.id; type = [string]$_.type } }) }
$fehlt = 0
foreach ($id in $rollenIds.Values) { if (-not ($zugriffe | Where-Object { $_.id -eq $id -and $_.type -eq 'Role' })) { $zugriffe += @{ id = $id; type = 'Role' }; $fehlt++ } }
foreach ($id in $scopeIds.Values) { if (-not ($zugriffe | Where-Object { $_.id -eq $id -and $_.type -eq 'Scope' })) { $zugriffe += @{ id = $id; type = 'Scope' }; $fehlt++ } }
$rra += @{ resourceAppId = $GraphAppId; resourceAccess = @($zugriffe) }

if (-not $app) {
  if ($Pruefen) { Problem "Es gibt noch keine App »$AppName«. Setup ohne -Pruefen ausführen."; }
  else {
    $body = @{ displayName = $AppName; signInAudience = 'AzureADMyOrg'; tags = @($tag); requiredResourceAccess = @($rra)
      notes = "Sudo-Zentrale ($($manifest.publicUrl)) – angelegt mit Sudo-Entra-Setup $SetupVersion am $(Get-Date -Format 'dd.MM.yyyy')." }
    if ($redirects.Count) { $body.web = @{ redirectUris = @($redirects) } }
    if ($gruppen) { $body.groupMembershipClaims = 'SecurityGroup' }
    $app = W POST 'applications' $body "App »$AppName« anlegen"
    if ($app) { $neu = $true; Ok "App angelegt: $AppName ($($app.appId))" }
  }
} else {
  Ok "Vorhanden: $($app.displayName) ($($app.appId))"
  if ($fehlt) {
    if ($Pruefen) { Problem "$fehlt API-Berechtigung(en) fehlen in der App." }
    else { W PATCH "applications/$($app.id)" @{ requiredResourceAccess = @($rra) } "$fehlt API-Berechtigung(en) ergänzen" | Out-Null; if (-not $Probelauf) { Ok "$fehlt API-Berechtigung(en) ergänzt" } }
  } else { Ok 'API-Berechtigungen vollständig' }
  $vorh = @(); if ($app.web -and $app.web.redirectUris) { $vorh = @($app.web.redirectUris) }
  $fehlendeUris = @($redirects | Where-Object { $vorh -notcontains $_ })
  if ($fehlendeUris.Count) {
    if ($Pruefen) { Problem ('Umleitungs-URI fehlt: ' + ($fehlendeUris -join ', ')) }
    else { W PATCH "applications/$($app.id)" @{ web = @{ redirectUris = @($vorh + $fehlendeUris) } } 'Umleitungs-URI ergänzen' | Out-Null; if (-not $Probelauf) { Ok ('Umleitungs-URI ergänzt: ' + ($fehlendeUris -join ', ')) } }
  }
  if ($gruppen -and -not $app.groupMembershipClaims) {
    if ($Pruefen) { Hinweis 'Gruppen-Claim ist aus (nur nötig, wenn admin_group genutzt wird).' }
    else { W PATCH "applications/$($app.id)" @{ groupMembershipClaims = 'SecurityGroup' } 'Gruppen-Claim einschalten' | Out-Null }
  }
}
if (-not $app) {
  if ($Probelauf) { Info '[Probelauf] Danach würden Dienstprinzipal, Zustimmung, Website-Freigaben und Geheimnis eingerichtet.' }
  if ($Probleme.Count) { exit 1 }; return
}

# ---------------------------------------------------------------- Dienstprinzipal und Administratorzustimmung
Schritt 'Administratorzustimmung'
$sp = Wiederholen { @((G GET ('servicePrincipals?' + (GFilter "appId eq '$($app.appId)'"))).value | Where-Object { $_ })[0] } 'Dienstprinzipal suchen' 2
if (-not $sp) {
  if ($Pruefen) { Problem 'Der App fehlt der Dienstprinzipal (Unternehmensanwendung).' }
  else { $sp = Wiederholen { W POST 'servicePrincipals' @{ appId = [string]$app.appId; tags = @('WindowsAzureActiveDirectoryIntegratedApp') } 'Unternehmensanwendung anlegen' } 'Unternehmensanwendung anlegen'; if ($sp) { Ok 'Unternehmensanwendung angelegt' } }
}
if ($sp) {
  $vorhanden = @((G GET "servicePrincipals/$($sp.id)/appRoleAssignments").value | ForEach-Object { [string]$_.appRoleId })
  foreach ($r in $rollenIds.Keys) {
    if ($vorhanden -contains $rollenIds[$r]) { Ok "$r (Anwendung) – Zustimmung erteilt" }
    elseif ($Pruefen) { Problem "$r (Anwendung) – Administratorzustimmung fehlt" }
    else {
      $null = Wiederholen { W POST "servicePrincipals/$($sp.id)/appRoleAssignments" @{ principalId = [string]$sp.id; resourceId = [string]$graphSp.id; appRoleId = $rollenIds[$r] } "Zustimmung für $r erteilen" } "Zustimmung für $r"
      if (-not $Probelauf) { Ok "$r (Anwendung) – Zustimmung erteilt" }
    }
  }
  if ($delegiert.Count) {
    $grant = @((G GET ('oauth2PermissionGrants?' + (GFilter "clientId eq '$($sp.id)'"))).value | Where-Object { $_ -and $_.consentType -eq 'AllPrincipals' -and $_.resourceId -eq $graphSp.id })[0]
    $haben = @(); if ($grant) { $haben = @(([string]$grant.scope).Split(' ') | Where-Object { $_ }) }
    $fehlend = @($delegiert | Where-Object { $haben -notcontains $_ })
    if (-not $fehlend.Count) { Ok ("Anmeldung (" + ($delegiert -join ', ') + ') – Zustimmung erteilt') }
    elseif ($Pruefen) { Problem ('Zustimmung für die Anmeldung fehlt: ' + ($fehlend -join ', ')) }
    elseif ($grant) { W PATCH "oauth2PermissionGrants/$($grant.id)" @{ scope = (($haben + $fehlend) -join ' ') } 'Zustimmung für die Anmeldung ergänzen' | Out-Null; Ok 'Zustimmung für die Anmeldung ergänzt' }
    else { $null = Wiederholen { W POST 'oauth2PermissionGrants' @{ clientId = [string]$sp.id; consentType = 'AllPrincipals'; resourceId = [string]$graphSp.id; scope = ($delegiert -join ' ') } 'Zustimmung für die Anmeldung erteilen' } 'Zustimmung für die Anmeldung'; if (-not $Probelauf) { Ok 'Zustimmung für die Anmeldung erteilt' } }
  }
}

# ---------------------------------------------------------------- SharePoint-Websites freigeben
if ($seitenRolle -and $SharePoint) {
  Schritt "SharePoint-Websites freigeben ($seitenRolle)"
  $erledigt = @{}
  foreach ($link in $SharePoint) {
    try {
      $w = WebsiteAusLink $link
      if ($erledigt.ContainsKey($w.Graph)) { continue }; $erledigt[$w.Graph] = 1
      $site = G GET $w.Graph
      $perms = @((G GET "sites/$($site.id)/permissions").value | Where-Object { $_ })
      $treffer = @($perms | Where-Object {
          $ids = @(); foreach ($g in @($_.grantedToIdentitiesV2) + @($_.grantedToIdentities)) { if ($g -and $g.application) { $ids += [string]$g.application.id } }
          $ids -contains [string]$app.appId })
      if ($treffer.Count) { Ok "$($site.displayName) ($($w.Pfad)) – bereits freigegeben" }
      elseif ($Pruefen) { Problem "$($site.displayName) ($($w.Pfad)) – nicht freigegeben" }
      else {
        W POST "sites/$($site.id)/permissions" @{ roles = @($seitenRolle); grantedToIdentities = @(@{ application = @{ id = [string]$app.appId; displayName = [string]$app.displayName } }) } "$($site.displayName) freigeben" | Out-Null
        if (-not $Probelauf) { Ok "$($site.displayName) ($($w.Pfad)) – freigegeben ($seitenRolle)" }
      }
    } catch { Problem ("$link – " + (Fehlertext $_)) }
  }
} elseif ($seitenRolle -and -not $Pruefen) {
  Hinweis 'Keine SharePoint-Links angegeben – die App darf noch keine Website lesen. Später mit -SharePoint "<Link>" ergänzen.'
}

# ---------------------------------------------------------------- Geheimnis
Schritt 'Geheimnis (Client Secret)'
$app = G GET "applications/$($app.id)"
$jetzt = Get-Date
$gueltig = @(@($app.passwordCredentials) | Where-Object { $_ -and ([datetime]$_.endDateTime) -gt $jetzt })
foreach ($c in @($app.passwordCredentials)) {
  if (-not $c) { continue }
  $ende = ([datetime]$c.endDateTime).ToLocalTime(); $tage = [int]($ende - (Get-Date)).TotalDays
  $name = if ($c.displayName) { $c.displayName } else { $c.hint + '…' }
  if ($tage -lt 0) { Hinweis "$name – abgelaufen am $($ende.ToString('dd.MM.yyyy'))" }
  elseif ($tage -lt 45) { Problem "$name – läuft in $tage Tagen ab ($($ende.ToString('dd.MM.yyyy'))). Erneuern: -NeuesGeheimnis -AlteGeheimnisseEntfernen" }
  else { Ok "$name – gültig bis $($ende.ToString('dd.MM.yyyy'))" }
}
$geheimnis = $null
$brauchtNeues = $neu -or $NeuesGeheimnis -or -not $gueltig.Count
if (-not $brauchtNeues -and $Interaktiv -and -not $Pruefen -and -not $Probelauf) {
  Info 'Ein vorhandenes Geheimnis kann Microsoft nicht noch einmal anzeigen.'
  $brauchtNeues = JaNein 'Neues Geheimnis erzeugen und in der Zentrale eintragen?' $false
}
if ($brauchtNeues -and $Pruefen) { if (-not $gueltig.Count) { Problem 'Kein gültiges Geheimnis vorhanden.' } }
elseif ($brauchtNeues) {
  foreach ($monate in (@($GeheimnisMonate, 12, 6) | Select-Object -Unique)) {
    if ($monate -gt $GeheimnisMonate) { continue }
    try {
      $geheimnis = W POST "applications/$($app.id)/addPassword" @{ passwordCredential = @{ displayName = "Sudo-Zentrale $(Get-Date -Format 'yyyy-MM-dd')"; endDateTime = (Get-Date).AddMonths($monate).ToUniversalTime().ToString('o') } } "Neues Geheimnis ($monate Monate) erzeugen"
      break
    } catch { Hinweis ("$monate Monate abgelehnt (Richtlinie im Tenant?): " + (Fehlertext $_)) }
  }
  if ($geheimnis) { Ok ("Neues Geheimnis erzeugt, gültig bis " + ([datetime]$geheimnis.endDateTime).ToLocalTime().ToString('dd.MM.yyyy')) }
}

# ---------------------------------------------------------------- In die Zentrale eintragen
$eingetragen = $false
if ($geheimnis -and ($Funktionen -contains 'kb') -and $ZentraleUrl) {
  Schritt 'In der Sudo-Zentrale eintragen'
  $z = ZentraleAnmelden $ZentraleUrl
  if ($z) {
    try {
      $s = $manifest.features.kb.settings
      $werte = @{}; $werte[[string]$s.tenant] = $tenant; $werte[[string]$s.clientId] = [string]$app.appId; $werte[[string]$s.secret] = [string]$geheimnis.secretText
      if ($s.enable) { $werte[[string]$s.enable] = 'true' }
      $null = ZentraleAufruf $z PUT '/admin/api/settings' $werte
      Ok 'Tenant, Client ID und Geheimnis gespeichert'
      $null = Wiederholen { ZentraleAufruf $z POST $manifest.features.kb.test @{} } 'Verbindung testen' 15
      Ok 'Verbindungstest der Zentrale erfolgreich'
      $eingetragen = $true
      foreach ($link in @($SharePoint)) {
        if (-not $link) { continue }
        try { $r = ZentraleAufruf $z POST $manifest.features.kb.addSource @{ url = $link }; Ok ("Quelle »$($r.title)«: $($r.items) Einträge") }
        catch { $m = Fehlertext $_; if ($m -match 'schon eingetragen') { Ok "Quelle schon eingetragen: $link" } else { Hinweis "Quelle $link – $m" } }
      }
    } catch { Hinweis ('Eintragen fehlgeschlagen: ' + (Fehlertext $_)) }
  }
}

# Alte Geheimnisse entfernen – erst, wenn das neue in der Zentrale funktioniert
if ($geheimnis -and $AlteGeheimnisseEntfernen) {
  if (-not $eingetragen -and ($Funktionen -contains 'kb')) { Hinweis 'Alte Geheimnisse bleiben, weil das neue noch nicht in der Zentrale getestet ist.' }
  else {
    foreach ($c in @($app.passwordCredentials)) { if ($c -and $c.keyId -ne $geheimnis.keyId) { W POST "applications/$($app.id)/removePassword" @{ keyId = [string]$c.keyId } 'Altes Geheimnis entfernen' | Out-Null; Ok ("Altes Geheimnis entfernt: " + $c.displayName) } }
  }
}

# ---------------------------------------------------------------- Ergebnis
Schritt 'Ergebnis'
Info "Tenant:      $tenant"
Info "Client ID:   $($app.appId)"
if ($geheimnis -and -not $eingetragen) {
  Write-Host "       Geheimnis:   $($geheimnis.secretText)" -ForegroundColor Yellow
  Hinweis 'Das Geheimnis wird nur jetzt angezeigt. Bitte in der Zentrale unter »Wissen (SharePoint)« eintragen.'
  if ($Interaktiv -and (JaNein 'Geheimnis in die Zwischenablage kopieren?' $true)) { Set-Clipboard -Value $geheimnis.secretText; Ok 'In der Zwischenablage (danach bitte überschreiben)' }
}
if ($Funktionen -contains 'login') {
  $admins = @($Admins); if (-not $admins.Count -and $ctx.Account) { $admins = @([string]$ctx.Account) }
  $geh = if ($geheimnis) { $geheimnis.secretText } else { '<Client Secret>' }
  Write-Host ''
  if ($manifest.features.login.config -eq 'env') {
    Info 'Für die Anmeldung an der Verwaltung in der .env / docker-compose der Zentrale eintragen:'
    Write-Host "       ENTRA_TENANT_ID=$tenant`n       ENTRA_CLIENT_ID=$($app.appId)`n       ENTRA_CLIENT_SECRET=$geh`n       ADMIN_USERS=$($admins -join ',')" -ForegroundColor Gray
  } else {
    Info 'Für die Anmeldung an der Verwaltung in der config.php der Zentrale eintragen:'
    Write-Host "       'entra' => ['tenant' => '$tenant', 'client_id' => '$($app.appId)', 'client_secret' => '$geh'],`n       'admin_users' => ['$($admins -join "', '")']," -ForegroundColor Gray
  }
}
if ($geheimnis) {
  $ende = ([datetime]$geheimnis.endDateTime).ToLocalTime(); $erinnerung = $ende.AddDays(-21)
  $ics = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sudo-Geheimnis-erneuern.ics'
  $uid = [guid]::NewGuid().ToString()
  $inhalt = @("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sudo//Entra-Setup//DE", "BEGIN:VEVENT", "UID:$uid", "DTSTAMP:$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))",
    "DTSTART;VALUE=DATE:$($erinnerung.ToString('yyyyMMdd'))", "SUMMARY:Sudo-Zentrale: Entra-Geheimnis erneuern (läuft am $($ende.ToString('dd.MM.yyyy')) ab)",
    "DESCRIPTION:Sudo-Entra-Setup.ps1 -NeuesGeheimnis -AlteGeheimnisseEntfernen -ZentraleUrl $($manifest.publicUrl)", "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", "DESCRIPTION:Sudo-Geheimnis erneuern", "END:VALARM", "END:VEVENT", "END:VCALENDAR") -join "`r`n"
  if (-not $Probelauf) { [IO.File]::WriteAllText($ics, $inhalt, (New-Object Text.UTF8Encoding($false))); Ok "Kalender-Erinnerung (3 Wochen vor Ablauf) auf dem Desktop: $(Split-Path $ics -Leaf)" }
}
Write-Host ''
if ($Probleme.Count) { Write-Host "  $($Probleme.Count) Punkt(e) offen – siehe [X] oben." -ForegroundColor Red; Disconnect-MgGraph | Out-Null; exit 1 }
Write-Host '  Fertig.' -ForegroundColor Green
Disconnect-MgGraph | Out-Null
