<?php
/**
 * Sudo-Relay – Statusseite mit Einrichtungshilfe und Testformular
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$cfg = relayConfig();
$ready = relayTokenUsable((string)$cfg['send_token']) && relayTokenUsable((string)$cfg['read_token']);
$dataOk = is_dir(__DIR__ . '/data') ? is_writable(__DIR__ . '/data') : is_writable(__DIR__);
$suggest = fn() => rtrim(strtr(base64_encode(random_bytes(30)), '+/', '-_'), '=');
$base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost')
      . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
$h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
header('Cache-Control: no-store');
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sudo-Relay</title>
<style>
  :root { --bg:#10141c; --card:#171c26; --line:#2a3242; --fg:#e3e8f0; --muted:#8a94a6; --teal:#25d3d0; --ok:#3ccf7a; --bad:#ff5a5f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, "Segoe UI", sans-serif; padding:32px 16px; }
  main { max-width:720px; margin:0 auto; display:grid; gap:18px; }
  h1 { margin:0; font-size:26px; letter-spacing:.01em; }
  h1 span { color:var(--teal); }
  h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:18px; }
  .row { display:flex; gap:10px; align-items:baseline; padding:4px 0; }
  .row b { min-width:150px; font-weight:500; color:var(--muted); }
  .pill { display:inline-block; padding:1px 9px; border-radius:99px; font-size:13px; font-weight:600; }
  .ok { background:rgba(60,207,122,.15); color:var(--ok); } .bad { background:rgba(255,90,95,.15); color:var(--bad); }
  code, pre { font:13px/1.5 ui-monospace, Consolas, monospace; }
  code { background:#0e1218; border:1px solid var(--line); border-radius:4px; padding:1px 6px; word-break:break-all; }
  pre { background:#0e1218; border:1px solid var(--line); border-radius:6px; padding:12px; overflow-x:auto; margin:8px 0 0; }
  label { display:block; font-size:13px; color:var(--muted); margin:10px 0 4px; }
  input, select { width:100%; padding:9px 10px; border-radius:6px; border:1px solid var(--line); background:#0e1218; color:var(--fg); font:inherit; }
  button { margin-top:14px; padding:9px 16px; border:0; border-radius:6px; background:var(--teal); color:#062424; font:600 14px system-ui, sans-serif; cursor:pointer; }
  #out { margin-top:12px; font-size:14px; }
  p { margin:6px 0; }
</style>
</head>
<body>
<main>
  <h1><span>sudo</span>-relay</h1>

  <section>
    <h2>Status</h2>
    <div class="row"><b>Tokens</b><span class="pill <?= $ready ? 'ok' : 'bad' ?>"><?= $ready ? 'eingerichtet' : 'noch nicht gesetzt' ?></span></div>
    <div class="row"><b>Schreibrechte data/</b><span class="pill <?= $dataOk ? 'ok' : 'bad' ?>"><?= $dataOk ? 'in Ordnung' : 'fehlen' ?></span></div>
    <div class="row"><b>Relay-Adresse für Sudo</b><code><?= $h($base) ?></code></div>
  </section>

  <?php if (!$ready): ?>
  <section>
    <h2>Einrichten</h2>
    <p>Öffne <code>config.php</code>, ersetze die beiden Tokens durch diese frisch erzeugten Werte und lade die Datei wieder hoch:</p>
    <pre>'send_token' => '<?= $h($suggest()) ?>',
'read_token' => '<?= $h($suggest()) ?>',</pre>
    <p>Die Vorschläge ändern sich bei jedem Neuladen. Notiere dir die Werte, die du verwendest.</p>
  </section>
  <?php else: ?>
  <section>
    <h2>Testereignis senden</h2>
    <form id="f">
      <label for="tok">Sende-Token (send_token aus config.php)</label>
      <input id="tok" type="password" autocomplete="off" required>
      <label for="type">Ereignis</label>
      <select id="type">
        <option value="backup_failed">backup_failed – Backup fehlgeschlagen</option>
        <option value="server_down">server_down – Server offline</option>
        <option value="deploy_ok">deploy_ok – Deploy erfolgreich</option>
        <option value="ticket">ticket – Neues Ticket</option>
        <option value="warning">warning – Warnung</option>
        <option value="message">message – Nachricht</option>
      </select>
      <label for="txt">Text (optional)</label>
      <input id="txt" maxlength="120" placeholder="z. B. Muster GmbH">
      <button type="submit">An Sudo senden</button>
      <div id="out"></div>
    </form>
  </section>
  <?php endif; ?>

  <section>
    <h2>Aus deinen Skripten</h2>
    <pre>POST <?= $h($base) ?>/event.php
X-Sudo-Token: &lt;send_token&gt;
Content-Type: application/json

{"type":"backup_failed","kunde":"Muster GmbH"}</pre>
  </section>
</main>
<?php if ($ready): ?>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const out = document.getElementById('out');
  const type = document.getElementById('type').value, txt = document.getElementById('txt').value.trim();
  const body = { type };
  if (txt) body[{ backup_failed: 'kunde', server_down: 'host', deploy_ok: 'version', ticket: 'titel' }[type] || 'text'] = txt;
  out.textContent = 'Sende …';
  try {
    const r = await fetch('event.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sudo-Token': document.getElementById('tok').value }, body: JSON.stringify(body) });
    const j = await r.json();
    out.textContent = j.ok ? `Gespeichert als Ereignis #${j.id}. Sudo holt es innerhalb von etwa 15 Sekunden ab.` : `Fehler: ${j.error}`;
  } catch (err) { out.textContent = 'Fehler: ' + err.message; }
});
</script>
<?php endif; ?>
</body>
</html>
