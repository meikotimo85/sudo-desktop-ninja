<?php
// setup.php – Einrichtungshilfe: Systemprüfung und Passwort-Hash. Nach der Einrichtung zeigt die Seite nichts mehr an.
declare(strict_types=1);

/** @var array $cfg @var bool $hasConfig @var string $base */
$done = $hasConfig && (entra_on($cfg) || !empty($cfg['admin_password']));
// 1.14: Klartext-Passwörter werden abgelehnt – den Hash-Generator deshalb auch nach der Einrichtung anbieten, solange keiner eingetragen ist
$needHash = !password_hashed((string) ($cfg['admin_password'] ?? ''));
$hash = '';
if ((!$done || $needHash) && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && isset($_POST['pw'])) {
    $pw = (string) $_POST['pw'];
    $hash = strlen($pw) >= 12 ? password_hash($pw, PASSWORD_DEFAULT) : 'zu kurz – mindestens 12 Zeichen';
}
$checks = [];
if (!$done) {
    $checks[] = ['PHP 8.1 oder neuer', version_compare(PHP_VERSION, '8.1', '>='), PHP_VERSION];
    $checks[] = ['PDO SQLite oder MySQL', extension_loaded('pdo_sqlite') || extension_loaded('pdo_mysql'), implode(', ', array_filter(['pdo_sqlite', 'pdo_mysql'], 'extension_loaded'))];
    $checks[] = ['cURL (für Claude und Entra ID)', extension_loaded('curl'), extension_loaded('curl') ? 'vorhanden' : 'fehlt'];
    $checks[] = ['mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'vorhanden' : 'fehlt'];
    $checks[] = ['Ordner data/ beschreibbar', is_writable($base . '/data'), is_writable($base . '/data') ? 'ja' : 'nein – Rechte 755/775 setzen'];
    $checks[] = ['config.php vorhanden', $hasConfig, $hasConfig ? 'ja' : 'config.sample.php kopieren und ausfüllen'];
    if ($hasConfig) {
        try { new Db($cfg['db']); $checks[] = ['Datenbank', true, 'verbunden']; }
        catch (Throwable $e) { $checks[] = ['Datenbank', false, $e->getMessage()]; }
    }
}
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'");
?><!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sudo-Zentrale – Einrichtung</title><link rel="stylesheet" href="admin/admin.css"></head>
<body class="landing"><main class="center wide">
<img src="icon.png" alt="" class="logo"><h1><span>sudo</span> einrichtung</h1>
<?php if ($done): ?>
  <p>Die Einrichtung ist abgeschlossen. <a href="admin/">Zur Verwaltung</a></p>
<?php endif; ?>
<?php if (!$done): ?>
  <section class="card left">
    <h3>Systemprüfung</h3>
    <table class="tbl"><tbody>
    <?php foreach ($checks as [$name, $ok, $info]): ?>
      <tr><td><?= $ok ? '[OK]' : '[FEHLT]' ?> <?= $h($name) ?></td><td class="muted"><?= $h($info) ?></td></tr>
    <?php endforeach; ?>
    </tbody></table>
  </section>
<?php endif; ?>
<?php if (!$done || $needHash): ?>
  <section class="card left">
    <h3>Notfall-Passwort als Hash</h3>
    <form method="post" class="row">
      <input type="password" name="pw" placeholder="Neues Admin-Passwort (mind. 12 Zeichen)" autocomplete="new-password" aria-label="Passwort">
      <button class="btn primary" type="submit">Hash erzeugen</button>
    </form>
    <?php if ($hash): ?>
      <p class="muted">In die config.php bei <code>'admin_password'</code> eintragen:</p>
      <pre class="code"><?= $h($hash) ?></pre>
    <?php endif; ?>
    <p class="muted">Ein Klartext-Passwort in der config.php wird ab 1.14 abgelehnt. Für den zweiten Faktor (<code>'admin_totp'</code>) erzeugst du nach der Anmeldung einen Schlüssel unter „Sicherheit &amp; Quiz“.</p>
  </section>
<?php endif; ?>
</main></body></html>
