<?php
// index.php – Sudo-Zentrale (PHP-Version für Webspace): ein Einstiegspunkt für alle Adressen
// Unterschied zur Node-Version: kein WebSocket. Die Sudos fragen alle paar Sekunden nach (/api/poll).
declare(strict_types=1);

$base = __DIR__;
$path = '/' . ltrim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
// Unterordner-Installation: Apache setzt SCRIPT_NAME zuverlässig, der eingebaute PHP-Testserver nicht
$dir = PHP_SAPI === 'cli-server' ? '' : rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
if ($dir !== '' && str_starts_with($path, $dir)) $path = substr($path, strlen($dir)) ?: '/';

// Eingebauter PHP-Server (Test): echte Dateien direkt ausliefern, interne Ordner sperren
if (PHP_SAPI === 'cli-server') {
    if (preg_match('#^/(app|data)(/|$)|^/config(\.sample)?\.php$#', $path)) { http_response_code(403); exit; }
    if ($path !== '/' && is_file($base . $path)) return false;
    if (is_dir($base . $path) && is_file($base . rtrim($path, '/') . '/index.html')) { readfile($base . rtrim($path, '/') . '/index.html'); exit; }
}

require $base . '/app/db.php';
require $base . '/app/core.php';
require $base . '/app/anthropic.php';
require $base . '/app/ops.php';
require $base . '/app/rules.php';
require $base . '/app/media.php';
require $base . '/app/kb.php';
require $base . '/app/dex.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$hasConfig = is_file($base . '/config.php');
if (!$hasConfig && $path !== '/setup') { header('Location: ' . $dir . '/setup', true, 302); exit; }
$cfg = $hasConfig ? require $base . '/config.php' : ['public_url' => '', 'db' => ['dsn' => 'sqlite::memory:']];
$cfg['public_url'] = rtrim((string) ($cfg['public_url'] ?? ''), '/');
$cfg['poll_seconds'] = max(5, min(120, (int) ($cfg['poll_seconds'] ?? 15)));

if ($path === '/setup') { require $base . '/app/setup.php'; exit; }

// Verwaltung: Viele Hoster leiten Ordner an index.php weiter oder kennen index.html nicht als Startdatei –
// darum liefert PHP die Seite selbst aus (und ergänzt bei /admin den Schrägstrich, damit relative Pfade stimmen)
if ($method === 'GET' && ($path === '/admin' || $path === '/admin/index.html')) { header('Location: ' . $dir . '/admin/', true, 301); exit; }
if ($method === 'GET' && $path === '/admin/') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://login.microsoftonline.com; base-uri 'none'");
    readfile($base . '/admin/index.html');
    exit;
}

date_default_timezone_set((string) ($cfg['timezone'] ?? 'Europe/Berlin'));   // 1.8: Uhrzeiten (Musikwünsche, Tage) in Ortszeit
try { $db = new Db($cfg['db']); }
catch (Throwable $e) { error_log('Sudo-Zentrale DB: ' . $e->getMessage()); fail(500, 'Datenbank nicht erreichbar. Siehe /setup.'); }

// 1.7: Mitgelieferte Regeln einmalig anlegen (Backup fehlgeschlagen, Server nicht erreichbar, Zertifikat)
if ((int) ($db->get("SELECT v FROM settings WHERE k = 'schema'")['v'] ?? 0) < 5) { rules_seed($db); $db->setSetting('schema', '5'); }
// 1.10: Mitgelieferte Start-Checkliste einmalig anlegen (bleibt aus, bis sie eingeschaltet wird)
onboard_seed($db);

// Gelegentlich aufräumen und ersten Registrierungscode anlegen
if (random_int(1, 200) === 1) $db->cleanup();
if (!empty($cfg['first_enroll_code']) && !$db->get('SELECT 1 FROM enroll_codes LIMIT 1')) {
    $db->run('INSERT INTO enroll_codes (id, code_hash, label, created) VALUES (?, ?, ?, ?)', [token(6), sha($cfg['first_enroll_code']), 'Erster Code (config.php)', now_ms()]);
}

$route = $method . ' ' . $path;

/* =====================================================================
   Öffentlich & Geräte
   ===================================================================== */
// Info-Seite für Mitarbeitende (Ordner info/), z. B. als Link im Unternehmensportal
if ($method === 'GET' && ($path === '/info' || $path === '/info/') && is_file(__DIR__ . '/info/index.html')) {
    if ($path === '/info') { header('Location: ' . $cfg['public_url'] . '/info/', true, 301); exit; }
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    readfile(__DIR__ . '/info/index.html');
    exit;
}
if ($route === 'GET /' ) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sudo-Zentrale</title>',
        '<link rel="icon" href="icon.png"><link rel="stylesheet" href="admin/admin.css"></head><body class="landing"><main class="center">',
        '<img src="icon.png" alt="" class="logo"><h1><span>sudo</span> zentrale</h1><p>Hier melden sich die Sudos deiner Firma an. Für Menschen gibt es nur die Verwaltung.</p>',
        '<a class="btn primary" href="admin/">Zur Verwaltung</a>', is_file(__DIR__ . '/info/index.html') ? ' <a class="btn" href="info/">Was ist Sudo?</a>' : '', '</main></body></html>';
    exit;
}
if ($route === 'GET /healthz') json_out(['ok' => true, 'version' => APP_VERSION, 'php' => PHP_VERSION, 'db' => $db->driver]);
// Sudo fragt beim Start, wie er sich verbinden soll
if ($route === 'GET /api/info') json_out(['name' => 'Sudo-Zentrale', 'version' => APP_VERSION, 'transport' => 'poll', 'pollSec' => $cfg['poll_seconds']]);

if ($route === 'POST /api/enroll') {
    if (!$db->limit('enroll:' . client_ip(), 10, 60)) fail(429, 'Zu viele Versuche. Kurz warten.');
    $b = body();
    $code = trim((string) ($b['code'] ?? ''));
    if ($code === '') fail(400, 'Registrierungscode fehlt.');
    $c = $db->get('SELECT * FROM enroll_codes WHERE code_hash = ? AND revoked = 0', [sha($code)]);
    if (!$c || ($c['expires'] && $c['expires'] < now_ms()) || ($c['uses_left'] !== null && (int) $c['uses_left'] <= 0)) {
        $db->audit(client_ip(), 'enroll_denied', 'Code ungültig');
        fail(403, 'Registrierungscode ungültig oder abgelaufen.');
    }
    $tok = token(32);
    $id = strtolower(preg_replace('/[^a-z0-9]/i', 'x', token(9)));
    $name = str($b['name'] ?? $b['host'] ?? 'Sudo', 60) ?: 'Sudo';
    $db->run('INSERT INTO devices (id, name, user, upn, host, version, lang, groups_, token_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$id, $name, str($b['user'] ?? '', 80), clean_upn($b['upn'] ?? ''), str($b['host'] ?? '', 80), str($b['version'] ?? '', 20), str($b['lang'] ?? '', 5), $c['groups_'], sha($tok), now_ms(), now_ms()]);
    $db->run('UPDATE enroll_codes SET used = used + 1, uses_left = CASE WHEN uses_left IS NULL THEN NULL ELSE uses_left - 1 END WHERE id = ?', [$c['id']]);
    $db->audit($name . ' (' . ($b['user'] ?? '?') . ')', 'enroll', 'Code „' . ($c['label'] ?: $c['id']) . '“');
    json_out(['id' => $id, 'token' => $tok, 'name' => $name, 'server' => ['name' => 'Sudo-Zentrale', 'version' => APP_VERSION]]);
}

if ($route === 'GET /api/device') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    json_out(['id' => $d['id'], 'name' => $d['name'], 'groups' => $d['groups_'], 'online' => true]);
}

// Abruf: Quittungen entgegennehmen, Lebenszeichen setzen, neue Meldungen ausliefern
if ($route === 'POST /api/poll') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    $b = body();
    // Nur Quittungen für Meldungen annehmen, die es wirklich gibt
    foreach (array_slice((array) ($b['ack'] ?? []), 0, 50) as $mid) {
        if (is_int($mid) && $db->get('SELECT 1 FROM messages WHERE id = ?', [$mid])) $db->insertIgnore('deliveries', ['message_id' => $mid, 'device_id' => $d['id'], 'delivered' => now_ms()]);
    }
    $db->run('UPDATE devices SET last_seen = ?, version = ?, lang = ? WHERE id = ?', [now_ms(), str($b['version'] ?? $d['version'], 20), str($b['lang'] ?? $d['lang'], 5), $d['id']]);
    if (($u = clean_upn($b['upn'] ?? '')) && $u !== ($d['upn'] ?? null)) $db->run('UPDATE devices SET upn = ? WHERE id = ?', [$u, $d['id']]);
    if (is_array($b['health'] ?? null) && health_public($db->settings())['report'] && ($h = clean_health($b['health']))) {
        $db->run('UPDATE devices SET health = ?, health_at = ? WHERE id = ?', [json_encode($h, JSON_UNESCAPED_UNICODE), now_ms(), $d['id']]);
    }
    if (is_array($b['diag'] ?? null) && ($dg = clean_diag($b['diag']))) {
        $db->run('UPDATE devices SET diag = ?, diag_at = ? WHERE id = ?', [json_encode($dg, JSON_UNESCAPED_UNICODE), now_ms(), $d['id']]);
    }
    if (is_array($b['visits'] ?? null)) {
        $db->run('UPDATE devices SET allow_visits = ?, visit_name = ? WHERE id = ?', [!empty($b['visits']['allow']) ? 1 : 0, str((string) ($b['visits']['name'] ?? ''), 30) ?: null, $d['id']]);
    }
    $events = array_map(fn($m) => ['id' => (int) $m['id'], 'event' => json_decode($m['payload'], true), 'created' => (int) $m['created']], pending_for($db, $d));
    yt_maybe_check_later($db, $cfg);                     // 1.8: neue YouTube-Videos – läuft nach der Antwort
    music_maybe_watch_later($db, $cfg);                  // 1.8.1: gesperrte Musikwünsche überspringen
    kb_maybe_sync_later($db, $cfg);                      // 1.9: SharePoint-Anleitungen abgleichen
    $s = $db->settings();
    json_out(['device' => ['id' => $d['id'], 'name' => $d['name'], 'groups' => groups_of($d)], 'ai' => ai_public($s), 'visits' => visits_public($s, $db, $d), 'health' => health_public($s), 'quiz' => quiz_public($s, $db), 'ops' => ops_public($db, $d, $s), 'media' => media_public($db, $d, $s), 'kb' => kb_public($s, $db), 'dex' => dex_public($db, $d, $s), 'events' => $events, 'pollSec' => $cfg['poll_seconds']]);
}

/* ---------- Security-Quiz (1.5) ---------- */
if ($route === 'GET /api/quiz') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    $s = $db->settings();
    json_out(quiz_public($s, $db) + ['questions' => array_map('quiz_question_public', $db->all('SELECT * FROM quiz_questions WHERE active = 1 ORDER BY id DESC LIMIT 50'))]);
}
// Antworten anonym zählen: pro Tag und Frage nur „beantwortet“ und „richtig“ – ohne Gerät
if ($route === 'POST /api/quiz/answer') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('quiz:' . $d['id'], 30, 86400)) fail(429, 'Für heute genug Fragen beantwortet.');
    $b = body();
    $qid = (string) ($b['q'] ?? '');
    if (!preg_match('/^(b\d{2}|c\d{1,9})$/', $qid)) fail(400, 'Unbekannte Frage.');
    $db->upsert('quiz_stats', ['day' => day_key(), 'qid' => $qid, 'n' => 1, 'ok' => !empty($b['ok']) ? 1 : 0], ['day', 'qid'], ['n', 'ok']);
    if ($qid[0] === 'b' && is_string($b['text'] ?? null)) $db->insertIgnore('quiz_labels', ['qid' => $qid, 'text' => mb_substr(strip_tags($b['text']), 0, 200)]);
    json_out(['ok' => true]);
}

/* ---------- Besuche: Sudo zu einem Kollegen schicken (1.4) ---------- */
if ($route === 'GET /api/peers') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    $s = $db->settings();
    $recvMax = (int) $s['visits_recv_per_day'];
    $peers = [];
    foreach ($db->all('SELECT * FROM devices WHERE revoked = 0 AND allow_visits = 1 AND id <> ?', [$d['id']]) as $p) {
        if (!is_online($p, $cfg)) continue;
        $got = (int) $db->get('SELECT COUNT(*) AS n FROM visits WHERE day = ? AND to_id = ?', [day_key(), $p['id']])['n'];
        $peers[] = ['id' => $p['id'], 'name' => visit_name($p), 'full' => $got >= $recvMax];
    }
    usort($peers, fn($a, $b) => strcasecmp($a['name'], $b['name']));
    json_out(['peers' => $peers, 'visits' => visits_public($s, $db, $d)]);
}
if ($route === 'POST /api/visit') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    $s = $db->settings();
    if ($s['visits_enabled'] !== 'true') fail(403, 'Besuche sind in der Zentrale ausgeschaltet.');
    $b = body();
    $kind = in_array($b['kind'] ?? '', VISIT_KINDS, true) ? $b['kind'] : fail(400, 'Unbekannte Art von Besuch.');
    $to = $db->get('SELECT * FROM devices WHERE id = ? AND revoked = 0', [(string) ($b['to'] ?? '')]) ?? fail(404, 'Diesen Kollegen gibt es nicht (mehr).');
    if ($to['id'] === $d['id']) fail(400, 'Sich selbst besuchen ist geschummelt.');
    if (!(int) $to['allow_visits']) fail(403, visit_name($to) . ' möchte gerade keinen Besuch.');
    if (!is_online($to, $cfg)) fail(409, visit_name($to) . ' ist gerade nicht online.');
    $sent = (int) $db->get('SELECT COUNT(*) AS n FROM visits WHERE day = ? AND from_id = ?', [day_key(), $d['id']])['n'];
    if ($sent >= (int) $s['visits_send_per_day']) fail(429, 'Für heute sind deine Besuche aufgebraucht. Morgen wieder!');
    $got = (int) $db->get('SELECT COUNT(*) AS n FROM visits WHERE day = ? AND to_id = ?', [day_key(), $to['id']])['n'];
    if ($got >= (int) $s['visits_recv_per_day']) fail(429, visit_name($to) . ' hatte heute schon genug Besuch.');
    $note = $kind === 'note' ? clean_note((string) ($b['note'] ?? '')) : '';
    if ($kind === 'note' && $note === '') fail(400, 'Bitte etwas auf das Post-it schreiben.');
    $color = preg_match('/^#[0-9a-f]{6}$/i', (string) ($b['color'] ?? '')) ? $b['color'] : '#eef1f5';
    $db->run('INSERT INTO visits (created, day, from_id, to_id, kind, note) VALUES (?, ?, ?, ?, ?, ?)', [now_ms(), day_key(), $d['id'], $to['id'], $kind, $note ?: null]);
    $vid = $db->lastId();
    // Zustellung wie eine Meldung, aber nur an dieses eine Gerät und nur 2 Stunden haltbar
    $db->run('INSERT INTO messages (created, expires, type, payload, target, author) VALUES (?, ?, ?, ?, ?, ?)', [now_ms(), now_ms() + 2 * 3600e3, 'visit',
        json_encode(['type' => 'visit', 'visit' => $vid, 'kind' => $kind, 'note' => $note, 'from' => visit_name($d), 'color' => $color, 'rank' => max(0, min(20, (int) ($b['rank'] ?? 0)))], JSON_UNESCAPED_UNICODE),
        'device:' . $to['id'], 'visit:' . visit_name($d)]);
    $db->audit(visit_name($d), 'visit', '→ ' . visit_name($to) . ': ' . $kind . ($note !== '' ? ' „' . $note . '“' : ''));
    json_out(['ok' => true, 'id' => $vid, 'to' => visit_name($to), 'visits' => visits_public($s, $db, $d)]);
}
if ($route === 'POST /api/visit/result') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    $b = body();
    $v = $db->get('SELECT * FROM visits WHERE id = ? AND to_id = ?', [(int) ($b['id'] ?? 0), $d['id']]) ?? fail(404, 'Besuch unbekannt.');
    if ($v['result']) json_out(['ok' => true]);
    $result = in_array($b['result'] ?? '', ['done', 'host_won', 'guest_won'], true) ? $b['result'] : 'done';
    $db->run('UPDATE visits SET status = ?, result = ?, result_at = ? WHERE id = ?', ['done', $result, now_ms(), $v['id']]);
    $db->run('INSERT INTO messages (created, expires, type, payload, target, author) VALUES (?, ?, ?, ?, ?, ?)', [now_ms(), now_ms() + 24 * 3600e3, 'visit_result',
        json_encode(['type' => 'visit_result', 'visit' => (int) $v['id'], 'kind' => $v['kind'], 'to' => visit_name($d), 'result' => $result], JSON_UNESCAPED_UNICODE),
        'device:' . $v['from_id'], 'visit']);
    if ($v['kind'] === 'duel') {
        $from = $db->get('SELECT * FROM devices WHERE id = ?', [$v['from_id']]);
        $gname = $from ? visit_name($from) : '?';
        $db->audit(visit_name($d), 'duel', $gname . ' gegen ' . visit_name($d) . ': ' . ($result === 'host_won' ? visit_name($d) : $gname) . ' gewinnt');
    }
    json_out(['ok' => true]);
}

// Frag Sudo über die Zentrale
if ($route === 'POST /api/ask') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('ask:' . $d['id'], 20, 60)) fail(429, 'Zu viele Fragen – kurz warten.');
    $s = $db->settings();
    if ($s['ai_enabled'] !== 'true' || empty($cfg['anthropic_key'])) fail(402, 'Frag Sudo ist in der Zentrale ausgeschaltet.');
    $dayCents = $d['ai_daily_cents'] !== null ? (int) $d['ai_daily_cents'] : (int) $s['ai_daily_cents'];
    $today = (int) ($db->get('SELECT COALESCE(SUM(usd_micro), 0) AS u FROM ai_usage WHERE day = ? AND device_id = ?', [day_key(), $d['id']])['u'] ?? 0) / 1e6;
    if ($dayCents > 0 && $today >= $dayCents / 100) fail(402, 'Tagesbudget für dieses Gerät aufgebraucht – morgen geht es weiter.');
    $month = (int) ($db->get('SELECT COALESCE(SUM(usd_micro), 0) AS u FROM ai_usage WHERE day LIKE ?', [substr(day_key(), 0, 7) . '%'])['u'] ?? 0) / 1e6;
    if ((int) $s['ai_monthly_cents'] > 0 && $month >= (int) $s['ai_monthly_cents'] / 100) fail(402, 'Monatsbudget der Firma aufgebraucht.');

    $b = body();
    $allowed = explode(',', $s['ai_models']);
    $model = in_array($b['model'] ?? '', $allowed, true) && isset(CLAUDE_MODELS[$b['model']]) ? $b['model'] : ($allowed[0] ?: 'haiku');
    $msgs = [];
    foreach (array_slice((array) ($b['messages'] ?? []), -16) as $m) {
        if (is_array($m) && in_array($m['role'] ?? '', ['user', 'assistant'], true) && is_string($m['content'] ?? null)) $msgs[] = ['role' => $m['role'], 'content' => mb_substr($m['content'], 0, 6000)];
    }
    if (!$msgs || end($msgs)['role'] !== 'user') fail(400, 'Keine Frage gefunden.');
    $lang = in_array($b['lang'] ?? '', ['de', 'en', 'ja'], true) ? $b['lang'] : 'de';
    $context = $s['ai_context'] === 'true' ? mb_substr((string) ($b['context'] ?? ''), 0, 2000) : '';
    $kb = kb_ai_context($db, $s, (string) end($msgs)['content']);       // 1.9: passende Firmen-Anleitungen
    @set_time_limit(150);
    $r = claude_stream($cfg['anthropic_url'] ?? CLAUDE_API, $cfg['anthropic_key'],
        ['model' => CLAUDE_MODELS[$model]['id'], 'max_tokens' => 700, 'system' => claude_system($lang, $context, $kb), 'messages' => $msgs, 'stream' => true]);
    if (!$r['started']) {
        error_log('Sudo-Zentrale Claude: HTTP ' . $r['status'] . ' ' . ($r['error'] ?? '') . ' ' . mb_substr($r['body'], 0, 300));
        if ($r['status'] === 0) fail(502, 'Claude ist von der Zentrale aus nicht erreichbar.');
        if ($r['status'] === 401) fail(502, 'Der API-Schlüssel der Zentrale ist ungültig.');
        $j = json_decode($r['body'], true);
        fail($r['status'] >= 400 ? $r['status'] : 502, (string) ($j['error']['message'] ?? 'Fehler bei Claude (HTTP ' . $r['status'] . ')'));
    }
    $usd = claude_cost($model, $r['in'], $r['out']);
    $db->upsert('ai_usage', ['day' => day_key(), 'device_id' => $d['id'], 'model' => $model, 'q' => 1, 'tin' => $r['in'], 'tout' => $r['out'], 'usd_micro' => (int) round($usd * 1e6)],
        ['day', 'device_id', 'model'], ['q', 'tin', 'tout', 'usd_micro']);
    exit;
}

/* ---------- Entra-Setup (1.9): öffentliche Beschreibung der benötigten Berechtigungen ---------- */
if ($route === 'GET /api/entra-manifest') json_out(entra_manifest($cfg));

/* ---------- Wissen & Anleitungen (1.9) ---------- */
if ($route === 'POST /api/kb/search') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('kb:' . $d['id'], 120, 3600)) fail(429, 'Zu viele Suchen – kurz warten.');
    $s = $db->settings();
    if (!kb_public($s, $db)['enabled']) fail(403, 'Anleitungen sind in der Zentrale nicht eingerichtet.');
    $q = str((string) (body()['q'] ?? ''), 200);
    json_out(['items' => mb_strlen($q) >= 2 ? kb_search($db, $q, 10) : kb_recent($db, 10), 'recent' => mb_strlen($q) < 2]);
}

/* ---------- Musikwünsche (1.8) ---------- */
if ($route === 'GET /api/music') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    json_out(music_status($db, $d, $db->settings()));
}
if ($route === 'POST /api/music/search') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('msearch:' . $d['id'], 40, 3600)) fail(429, 'Zu viele Suchen – kurz warten.');
    try { json_out(['tracks' => music_search($db, $cfg, $d, (string) (body()['q'] ?? ''))]); }
    catch (RuntimeException $e) { fail(502, $e->getMessage()); }
}
if ($route === 'POST /api/music/request') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('mreq:' . $d['id'], 10, 3600)) fail(429, 'Zu viele Wünsche – kurz warten.');
    try { json_out(music_request($db, $cfg, $d, body())); }
    catch (RuntimeException $e) { fail(502, $e->getMessage()); }
}
// Spotify verbinden (nur angemeldete Admins): Weiterleitung zu Spotify und zurück
if ($route === 'GET /admin/spotify/login') {
    current_session($db) ?? fail(401, 'Bitte in der Verwaltung anmelden.');
    $s = $db->settings();
    if (($s['spotify_client_id'] ?? '') === '' || ($s['spotify_client_secret'] ?? '') === '') fail(400, 'Bitte zuerst Client-ID und Client-Secret speichern.');
    $state = token(16);
    $db->setSetting('spotify_state', $state . '|' . (now_ms() + 600000));
    header('Location: ' . sp_accounts($cfg) . '/authorize?' . http_build_query(['client_id' => $s['spotify_client_id'], 'response_type' => 'code',
        'redirect_uri' => sp_redirect($cfg), 'scope' => 'user-read-playback-state user-modify-playback-state', 'state' => $state, 'show_dialog' => 'true']));
    exit;
}
if ($route === 'GET /admin/spotify/callback') {
    $sess = current_session($db) ?? fail(401, 'Bitte in der Verwaltung anmelden.');
    $s = $db->settings();
    [$want, $exp] = array_pad(explode('|', (string) ($s['spotify_state'] ?? '')), 2, '0');
    $back = fn(string $msg) => (header('Location: ' . $cfg['public_url'] . '/admin/?spotify=' . rawurlencode($msg) . '#music') ?: exit);
    if ($want === '' || !hash_equals($want, (string) ($_GET['state'] ?? '')) || (int) $exp < now_ms()) $back('Anmeldung abgelaufen – bitte noch einmal verbinden.');
    if (!empty($_GET['error'])) $back('Spotify: ' . (string) $_GET['error']);
    [$code, $out] = http_req('POST', sp_accounts($cfg) . '/api/token', ['Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode($s['spotify_client_id'] . ':' . $s['spotify_client_secret'])],
        http_build_query(['grant_type' => 'authorization_code', 'code' => (string) ($_GET['code'] ?? ''), 'redirect_uri' => sp_redirect($cfg)]));
    $j = json_decode($out, true) ?: [];
    if ($code !== 200 || empty($j['refresh_token'])) $back('Spotify hat die Anmeldung abgelehnt (' . $code . ').');
    $db->setSetting('spotify_refresh', $j['refresh_token']);
    $db->setSetting('spotify_access', (string) $j['access_token']);
    $db->setSetting('spotify_access_exp', (string) (now_ms() + ((int) ($j['expires_in'] ?? 3600)) * 1000));
    $db->setSetting('spotify_state', '');
    [$c, $me] = sp_call($db, $cfg, 'GET', '/v1/me');
    $db->setSetting('spotify_account', mb_substr((string) ($me['display_name'] ?? $me['id'] ?? 'Spotify'), 0, 80));
    $db->audit($sess['user'], 'spotify_connect', (string) ($me['display_name'] ?? ''));
    $back('verbunden');
}

/* ---------- Betrieb (1.6): Geräte melden Betroffenheit, Neustart-Stand und Selbsthilfe ---------- */
if ($route === 'POST /api/incident/affected') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('aff:' . $d['id'], 60, 3600)) fail(429, 'Zu viele Meldungen.');
    $b = body();
    $i = $db->get('SELECT * FROM incidents WHERE id = ? AND resolved IS NULL', [(int) ($b['id'] ?? 0)]) ?? fail(404, 'Diese Störung ist schon beendet.');
    if (!target_matches((string) $i['target'], $d)) fail(404, 'Diese Störung betrifft dieses Gerät nicht.');
    if (!empty($b['on'])) $db->insertIgnore('incident_affected', ['incident_id' => (int) $i['id'], 'device_id' => $d['id'], 'at' => now_ms()]);
    else $db->run('DELETE FROM incident_affected WHERE incident_id = ? AND device_id = ?', [$i['id'], $d['id']]);
    json_out(['ok' => true, 'affected' => incident_affected_count($db, (int) $i['id'])]);
}
if ($route === 'POST /api/restart/status') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('rst:' . $d['id'], 120, 3600)) fail(429, 'Zu viele Meldungen.');
    $b = body();
    $c = $db->get('SELECT * FROM restart_campaigns WHERE id = ?', [(int) ($b['id'] ?? 0)]) ?? fail(404, 'Kampagne unbekannt.');
    $state = in_array($b['state'] ?? '', RESTART_STATES, true) ? $b['state'] : fail(400, 'Unbekannter Stand.');
    $int = fn($v, $max) => is_numeric($v) ? max(0, min($max, (int) $v)) : null;
    $db->upsert('restart_status', ['campaign_id' => (int) $c['id'], 'device_id' => $d['id'], 'state' => $state, 'boot_at' => $int($b['bootAt'] ?? null, 9e15),
        'snooze_until' => $int($b['snoozeUntil'] ?? null, 9e15), 'snoozes' => $int($b['snoozes'] ?? 0, 1000) ?? 0, 'up_days' => $int($b['upDays'] ?? null, 10000), 'updated' => now_ms()], ['campaign_id', 'device_id']);
    json_out(['ok' => true]);
}
// Anonym: pro Tag und Werkzeug nur „benutzt“ und „hat geklappt“ – ohne Gerät
if ($route === 'POST /api/selfhelp') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('sh:' . $d['id'], 40, 86400)) fail(429, 'Für heute genug gezählt.');
    $b = body();
    $tool = in_array($b['tool'] ?? '', SELFHELP_TOOLS, true) ? $b['tool'] : fail(400, 'Unbekanntes Werkzeug.');
    $db->upsert('selfhelp_stats', ['day' => day_key(), 'tool' => $tool, 'n' => 1, 'ok' => !empty($b['ok']) ? 1 : 0], ['day', 'tool'], ['n', 'ok']);
    json_out(['ok' => true]);
}

/* ---------- Mitarbeiter-Erlebnis (1.10): Stimmung, Rückmeldung nach Störungen, Start-Checkliste ---------- */
if ($route === 'POST /api/pulse') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('pulse:' . $d['id'], 30, 86400)) fail(429, 'Für heute genug geantwortet.');
    json_out(pulse_answer($db, $d, body()));
}
if ($route === 'POST /api/pulse/incident') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('pinc:' . $d['id'], 30, 86400)) fail(429, 'Für heute genug geantwortet.');
    json_out(incident_feedback($db, $d, body()));
}
if ($route === 'POST /api/onboard') {
    $d = device_from($db) ?? fail(401, 'Gerät unbekannt oder gesperrt.');
    if (!$db->limit('onb:' . $d['id'], 200, 86400)) fail(429, 'Zu viele Meldungen.');
    json_out(onboard_mark($db, $d, body()));
}

// API-Schlüssel prüfen (für Skripte, n8n, Monitoring)
function api_key_from(Db $db): array
{
    if (!$db->limit('events:' . client_ip(), 60, 60)) fail(429, 'Zu viele Anfragen – kurz warten.');
    $key = bearer() ?: (string) ($_SERVER['HTTP_X_API_KEY'] ?? '');
    $k = $key !== '' ? $db->get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0', [sha($key)]) : null;
    if (!$k) fail(401, 'API-Schlüssel fehlt oder ist ungültig.');
    $db->run('UPDATE api_keys SET last_used = ?, uses = uses + 1 WHERE id = ?', [now_ms(), $k['id']]);
    return $k;
}
// Störungen per Schnittstelle (1.6): z. B. Monitoring → n8n → Störung öffnen und wieder beenden
if ($route === 'GET /api/incidents') {
    api_key_from($db);
    json_out(array_map(fn($i) => incident_admin($db, $i, false), $db->all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC LIMIT 50')));
}
if ($route === 'POST /api/incidents') {
    $k = api_key_from($db);
    json_out(['ok' => true] + incident_create($db, $cfg, body(), 'api:' . $k['name']));
}
if ($method === 'POST' && preg_match('#^/api/incidents/(\d+)/resolve$#', $path, $mm)) {
    $k = api_key_from($db);
    incident_resolve($db, (int) $mm[1], (string) (body()['text'] ?? ''), 'api:' . $k['name']);
    json_out(['ok' => true]);
}

// Ereignis-API für Skripte
if ($route === 'POST /api/events') {
    $k = api_key_from($db);
    $b = body();
    $ev = clean_event($b) ?? fail(400, 'Unbekannter type. Erlaubt: ' . implode(', ', EVENT_TYPES));
    // Ungültiges Ziel ist ein Fehler – nie still „an alle“
    if (isset($b['target']) && valid_target($b['target']) !== trim((string) $b['target'])) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename oder E-Mail>');
    $target = valid_target($b['target'] ?? 'all');
    // 1.7: Regeln ordnen die Meldung ein (z. B. Ticket „Datensicherung Failed …“ → Backup fehlgeschlagen)
    $res = rules_run($db, $ev, $db->settings());
    $author = 'api:' . $k['name'];
    $ttl = $b['ttl_min'] ?? null;
    if ($res['rule']) {
        $r = $res['rule'];
        if ($res['event'] === null) json_out(['ok' => true, 'dropped' => true, 'rule' => $r['name']]);
        $ev = clean_event($res['event']) ?? $ev;
        if ($r['target'] !== '') $target = $r['target'];
        if ($r['ttl'] !== null) $ttl = (int) $r['ttl'];
        $author .= ' · Regel ' . $r['name'];
    }
    json_out(['ok' => true, 'type' => $ev['type']] + ($res['rule'] ? ['rule' => $res['rule']['name']] : []) + publish($db, $cfg, $ev, $target, $ttl, $author));
}

/* =====================================================================
   Admin-Anmeldung
   ===================================================================== */
if ($route === 'GET /auth/info') json_out(['entra' => entra_on($cfg), 'password' => local_on($cfg), 'version' => APP_VERSION]);
if ($route === 'GET /auth/login') { if (!entra_on($cfg)) { header('Location: ' . $cfg['public_url'] . '/admin/?fehler=' . rawurlencode('Entra ID ist nicht eingerichtet.')); exit; } entra_start($cfg); }
if ($route === 'GET /auth/callback') entra_callback($db, $cfg);
if ($route === 'POST /auth/password') {
    if (!local_on($cfg)) fail(404, 'Passwort-Anmeldung ist ausgeschaltet.');
    if (!$db->limit('login:' . client_ip(), 8, 900)) fail(429, 'Zu viele Versuche. In 15 Minuten noch mal.');
    $pw = (string) (body()['password'] ?? '');
    $stored = (string) $cfg['admin_password'];
    $ok = str_starts_with($stored, '$2y$') || str_starts_with($stored, '$argon2') ? password_verify($pw, $stored) : ($pw !== '' && hash_equals(sha($stored), sha($pw)));
    if (!$ok) { $db->audit(client_ip(), 'login_failed', 'passwort'); fail(401, 'Passwort falsch.'); }
    create_session($db, $cfg, 'admin', 'Admin (Passwort)', 'passwort');
    json_out(['ok' => true]);
}
if ($route === 'POST /auth/logout') {
    $s = current_session($db);
    if ($s) { $db->run('DELETE FROM sessions WHERE id = ?', [$s['id']]); $db->audit($s['user'], 'logout'); }
    set_cookie($cfg, 'sz_sess', '', -1);
    json_out(['ok' => true]);
}

/* =====================================================================
   Admin-API (gleiche Adressen wie die Node-Version, die Oberfläche ist identisch)
   ===================================================================== */
if (str_starts_with($path, '/admin/api/')) {
    require $base . '/app/admin.php';
    exit;
}

fail(404, 'Nicht gefunden.');
