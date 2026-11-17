<?php
// admin.php – Admin-API (/admin/api/…): gleiche Antworten wie die Node-Version, damit admin.js für beide passt
declare(strict_types=1);

/** @var Db $db @var array $cfg @var string $path @var string $method */
$sess = current_session($db) ?? fail(401, 'Bitte anmelden.');
if ($method !== 'GET' && !hash_equals($sess['csrf'], (string) ($_SERVER['HTTP_X_CSRF'] ?? ''))) fail(403, 'Sicherheits-Token fehlt. Seite neu laden.');
$who = $sess['user'];
$sub = substr($path, strlen('/admin/api'));
$b = body();
$ms = fn($v) => $v === null ? null : (int) $v;

function messages_list(Db $db, int $limit): array
{
    $devs = $db->all('SELECT * FROM devices WHERE revoked = 0');
    return array_map(function ($m) use ($db, $devs) {
        return ['id' => (int) $m['id'], 'created' => (int) $m['created'], 'expires' => (int) $m['expires'], 'type' => $m['type'], 'event' => json_decode($m['payload'], true),
            'target' => $m['target'], 'author' => $m['author'],
            'delivered' => (int) $db->get('SELECT COUNT(*) AS n FROM deliveries WHERE message_id = ?', [$m['id']])['n'],
            'targets' => count(array_filter($devs, fn($d) => target_matches((string) $m['target'], $d) && (int) $d['created'] <= (int) $m['created'] + 1))];
    }, $db->all('SELECT * FROM messages ORDER BY id DESC LIMIT ' . max(1, min(200, $limit))));
}
$usage = function (string $where, array $p) use ($db): array {
    $r = $db->get("SELECT COALESCE(SUM(q),0) AS q, COALESCE(SUM(usd_micro),0) AS u FROM ai_usage WHERE $where", $p);
    return ['q' => (int) $r['q'], 'usd' => (int) $r['u'] / 1e6];
};

switch (true) {
    case $method === 'GET' && $sub === '/me':
        json_out(['user' => $sess['user'], 'name' => $sess['name'], 'via' => $sess['via'], 'csrf' => $sess['csrf'], 'version' => APP_VERSION,
            'publicUrl' => $cfg['public_url'], 'aiKey' => !empty($cfg['anthropic_key']), 'transport' => 'poll', 'pollSec' => $cfg['poll_seconds']]);

    case $method === 'GET' && $sub === '/dashboard':
        $devs = $db->all('SELECT * FROM devices WHERE revoked = 0');
        $s = $db->settings();
        $m = $usage('day LIKE ?', [substr(day_key(), 0, 7) . '%']);
        $hc = ['ok' => 0, 'warn' => 0, 'bad' => 0, 'unknown' => 0];
        foreach ($devs as $d) { $h = !empty($d['health']) ? json_decode($d['health'], true) : null; $hc[$h['s'] ?? 'unknown'] = ($hc[$h['s'] ?? 'unknown'] ?? 0) + 1; }
        json_out(['health' => $hc, 'devices' => count($devs), 'online' => count(array_filter($devs, fn($d) => is_online($d, $cfg))),
            'aiToday' => $usage('day = ?', [day_key()]), 'aiMonth' => $m + ['budgetUsd' => (int) $s['ai_monthly_cents'] / 100], 'messages' => messages_list($db, 8)]);

    /* Geräte */
    case $method === 'GET' && $sub === '/devices':
        json_out(array_map(fn($d) => ['id' => $d['id'], 'name' => $d['name'], 'user' => $d['user'], 'upn' => $d['upn'] ?? null, 'host' => $d['host'], 'version' => $d['version'], 'lang' => $d['lang'],
            'groups' => $d['groups_'], 'created' => (int) $d['created'], 'lastSeen' => $ms($d['last_seen']), 'online' => is_online($d, $cfg),
            'aiDailyCents' => $d['ai_daily_cents'] === null ? null : (int) $d['ai_daily_cents'], 'aiToday' => $usage('device_id = ? AND day = ?', [$d['id'], day_key()]),
            'health' => !empty($d['health']) ? json_decode($d['health'], true) : null, 'healthAt' => $ms($d['health_at'] ?? null),
            'diag' => !empty($d['diag']) ? json_decode($d['diag'], true) : null, 'diagAt' => $ms($d['diag_at'] ?? null)],
            $db->all('SELECT * FROM devices WHERE revoked = 0 ORDER BY LOWER(name)')));

    case preg_match('#^/devices/([\w-]+)$#', $sub, $mm) === 1 && in_array($method, ['PATCH', 'DELETE'], true):
        $d = $db->get('SELECT * FROM devices WHERE id = ? AND revoked = 0', [$mm[1]]) ?? fail(404, 'Gerät nicht gefunden.');
        if ($method === 'DELETE') { $db->run('UPDATE devices SET revoked = 1 WHERE id = ?', [$d['id']]); $db->audit($who, 'device_revoke', $d['name']); json_out(['ok' => true]); }
        if (is_string($b['name'] ?? null) && trim($b['name']) !== '') $db->run('UPDATE devices SET name = ? WHERE id = ?', [str($b['name'], 60), $d['id']]);
        if (is_string($b['groups'] ?? null)) $db->run('UPDATE devices SET groups_ = ? WHERE id = ?', [mb_substr(implode(',', array_filter(array_map('trim', explode(',', $b['groups'])), 'strlen')), 0, 200), $d['id']]);
        if (array_key_exists('aiDailyCents', $b)) $db->run('UPDATE devices SET ai_daily_cents = ? WHERE id = ?', [$b['aiDailyCents'] === null || $b['aiDailyCents'] === '' ? null : max(0, min(100000, (int) $b['aiDailyCents'])), $d['id']]);
        $db->audit($who, 'device_edit', $d['name'] . ': ' . mb_substr(json_encode($b, JSON_UNESCAPED_UNICODE), 0, 200));
        json_out(['ok' => true]);

    /* Registrierungscodes */
    case $method === 'GET' && $sub === '/enroll-codes':
        json_out(array_map(fn($c) => ['id' => $c['id'], 'label' => $c['label'], 'groups' => $c['groups_'], 'created' => (int) $c['created'], 'expires' => $ms($c['expires']),
            'usesLeft' => $c['uses_left'] === null ? null : (int) $c['uses_left'], 'used' => (int) $c['used']], $db->all('SELECT * FROM enroll_codes WHERE revoked = 0 ORDER BY created DESC')));
    case $method === 'POST' && $sub === '/enroll-codes':
        $code = 'SZ-' . implode('-', str_split(strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', token(18)), 0, 16)), 4));
        $id = token(6); $days = (int) ($b['days'] ?? 0);
        $uses = ($b['uses'] ?? '') === '' || $b['uses'] === null ? null : max(1, (int) $b['uses']);
        $db->run('INSERT INTO enroll_codes (id, code_hash, label, groups_, created, expires, uses_left) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$id, sha($code), str($b['label'] ?? '', 60), str($b['groups'] ?? '', 200), now_ms(), $days > 0 ? now_ms() + $days * 864e5 : null, $uses]);
        $db->audit($who, 'enroll_code_create', (string) ($b['label'] ?? $id));
        json_out(['id' => $id, 'code' => $code]);
    case preg_match('#^/enroll-codes/([\w-]+)$#', $sub, $mm) === 1 && $method === 'DELETE':
        $db->run('UPDATE enroll_codes SET revoked = 1 WHERE id = ?', [$mm[1]]); $db->audit($who, 'enroll_code_revoke', $mm[1]); json_out(['ok' => true]);

    /* API-Schlüssel */
    case $method === 'GET' && $sub === '/api-keys':
        json_out(array_map(fn($k) => ['id' => $k['id'], 'name' => $k['name'], 'prefix' => $k['prefix'], 'created' => (int) $k['created'], 'lastUsed' => $ms($k['last_used']), 'uses' => (int) $k['uses']],
            $db->all('SELECT * FROM api_keys WHERE revoked = 0 ORDER BY created DESC')));
    case $method === 'POST' && $sub === '/api-keys':
        $name = str($b['name'] ?? '', 60);
        if ($name === '') fail(400, 'Bitte einen Namen angeben, z. B. „Backup-Prüfung“.');
        $key = 'szk_' . token(30); $id = token(6);
        $db->run('INSERT INTO api_keys (id, name, key_hash, prefix, created) VALUES (?, ?, ?, ?, ?)', [$id, $name, sha($key), substr($key, 0, 8), now_ms()]);
        $db->audit($who, 'api_key_create', $name);
        json_out(['id' => $id, 'key' => $key]);
    case preg_match('#^/api-keys/([\w-]+)$#', $sub, $mm) === 1 && $method === 'DELETE':
        $db->run('UPDATE api_keys SET revoked = 1 WHERE id = ?', [$mm[1]]); $db->audit($who, 'api_key_revoke', $mm[1]); json_out(['ok' => true]);

    /* Meldungen */
    case $method === 'GET' && $sub === '/messages':
        json_out(messages_list($db, 60));
    case $method === 'POST' && $sub === '/messages':
        $ev = clean_event(array_merge((array) ($b['event'] ?? []), ['type' => $b['type'] ?? ''])) ?? fail(400, 'Unbekannte Art der Meldung.');
        if (count($ev) < 2 && $ev['type'] !== 'bug') fail(400, 'Bitte einen Text eingeben.');
        $target = valid_target($b['target'] ?? null);
        $r = publish($db, $cfg, $ev, $target, $b['ttlMin'] ?? null, $who);
        $db->audit($who, 'message_send', $ev['type'] . ' → ' . $target);
        json_out(['ok' => true] + $r);
    case preg_match('#^/messages/(\d+)$#', $sub, $mm) === 1 && $method === 'DELETE':
        $db->run('UPDATE messages SET expires = ? WHERE id = ?', [now_ms(), (int) $mm[1]]); $db->audit($who, 'message_expire', $mm[1]); json_out(['ok' => true]);

    /* KI */
    case $method === 'GET' && $sub === '/usage':
        $days = max(1, min(90, (int) ($_GET['days'] ?? 30)));
        $since = day_key(now_ms() - ($days - 1) * 86400000);
        json_out(['days' => $days,
            'perDay' => array_map(fn($r) => ['day' => $r['day'], 'q' => (int) $r['q'], 'tokens' => (int) $r['t'], 'usd' => (int) $r['u'] / 1e6],
                $db->all('SELECT day, SUM(q) AS q, SUM(tin + tout) AS t, SUM(usd_micro) AS u FROM ai_usage WHERE day >= ? GROUP BY day ORDER BY day', [$since])),
            'perDevice' => array_map(fn($r) => ['name' => $r['name'] ?: $r['device_id'], 'q' => (int) $r['q'], 'usd' => (int) $r['u'] / 1e6],
                $db->all('SELECT d.name, u.device_id, SUM(u.q) AS q, SUM(u.usd_micro) AS u FROM ai_usage u LEFT JOIN devices d ON d.id = u.device_id WHERE u.day >= ? GROUP BY u.device_id, d.name ORDER BY u DESC LIMIT 50', [$since])),
            'perModel' => array_map(fn($r) => ['model' => $r['model'], 'q' => (int) $r['q'], 'usd' => (int) $r['u'] / 1e6],
                $db->all('SELECT model, SUM(q) AS q, SUM(usd_micro) AS u FROM ai_usage WHERE day >= ? GROUP BY model', [$since]))]);
    case $method === 'GET' && $sub === '/settings':
        // Spotify-Geheimnisse nie an den Browser
        json_out(array_diff_key($db->settings(), array_flip(SECRET_SETTINGS)) + ['aiKey' => !empty($cfg['anthropic_key'])]);
    case $method === 'PUT' && $sub === '/settings':
        $check = [
            'ai_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'ai_models' => fn($v) => $v !== '' && !array_diff(explode(',', (string) $v), array_keys(CLAUDE_MODELS)),
            'ai_daily_cents' => fn($v) => is_numeric($v) && $v >= 0 && $v <= 100000,
            'ai_monthly_cents' => fn($v) => is_numeric($v) && $v >= 0 && $v <= 10000000,
            'ai_context' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'message_ttl_min' => fn($v) => ctype_digit((string) $v) && $v >= 1 && $v <= 10080,
            'visits_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'visits_send_per_day' => fn($v) => ctype_digit((string) $v) && $v >= 0 && $v <= 50,
            'visits_recv_per_day' => fn($v) => ctype_digit((string) $v) && $v >= 0 && $v <= 50,
            'quiz_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'quiz_per_week' => fn($v) => in_array((string) $v, ['1', '2', '3', '5'], true),
            'health_report' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            // 1.6: Hilfe-Kontakt in Selbsthilfe und Hinweisen
            'help_text' => fn($v) => is_string($v) && mb_strlen($v) <= 250,
            'help_phone' => fn($v) => is_string($v) && ($v === '' || preg_match('#^\+?[\d ()/-]{3,30}$#', $v)),
            'help_mail' => fn($v) => is_string($v) && ($v === '' || filter_var($v, FILTER_VALIDATE_EMAIL)),
            'help_url' => fn($v) => is_string($v) && ($v === '' || preg_match('#^https://\S{3,250}$#', $v)),
            // 1.8: YouTube und Musikwünsche
            'youtube_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'youtube_interval' => fn($v) => ctype_digit((string) $v) && $v >= 5 && $v <= 240,
            'youtube_ttl' => fn($v) => ctype_digit((string) $v) && $v >= 30 && $v <= 4320,
            'music_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'music_target' => fn($v) => is_string($v) && valid_target($v) === $v,
            'music_cost' => fn($v) => ctype_digit((string) $v) && $v <= 5000,
            'music_per_day' => fn($v) => ctype_digit((string) $v) && $v >= 1 && $v <= 20,
            'music_gap_min' => fn($v) => ctype_digit((string) $v) && $v <= 120,
            'music_from' => fn($v) => is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v),
            'music_to' => fn($v) => is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v),
            'music_explicit' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'music_announce' => fn($v) => in_array((string) $v, ['name', 'anon', 'off'], true),
            'spotify_client_id' => fn($v) => is_string($v) && preg_match('/^[a-f0-9]{0,64}$/i', $v),
            'spotify_client_secret' => fn($v) => is_string($v) && preg_match('/^[a-f0-9]{0,64}$/i', $v),
            'spotify_device_id' => fn($v) => is_string($v) && preg_match('/^[\w-]{0,80}$/', $v),
            'spotify_device_name' => fn($v) => is_string($v) && mb_strlen($v) <= 80,
            // 1.9: Wissen & Anleitungen aus SharePoint
            'kb_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'kb_ai' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'kb_interval' => fn($v) => ctype_digit((string) $v) && $v >= 15 && $v <= 1440,
            'kb_tenant' => fn($v) => is_string($v) && preg_match('/^[\w.-]{0,100}$/', $v),
            'kb_client_id' => fn($v) => is_string($v) && preg_match('/^[a-f0-9-]{0,40}$/i', $v),
            'kb_client_secret' => fn($v) => is_string($v) && mb_strlen($v) <= 200 && !preg_match('/\s/', $v),
            // 1.10: Mitarbeiter-Erlebnis
            'pulse_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'pulse_monthly' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'pulse_incident' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'pulse_min' => fn($v) => ctype_digit((string) $v) && $v >= 3 && $v <= 20,
            'onboard_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'onboard_days' => fn($v) => ctype_digit((string) $v) && $v >= 1 && $v <= 180,
            'tips_enabled' => fn($v) => in_array((string) $v, ['true', 'false'], true),
            'tips_custom' => fn($v) => is_string($v) && strlen($v) <= 20000 && tips_clean($v) !== null,
            // 1.12: Plugins
            'plugins_user' => fn($v) => in_array((string) $v, ['true', 'false'], true),
        ];
        foreach ($b as $k => $v) {
            if (!isset($check[$k])) continue;
            if (!$check[$k]($v)) fail(400, $k === 'tips_custom' ? 'Tipps: höchstens 50, je 5 bis 200 Zeichen, mit gültigem Programm.' : "Ungültiger Wert für $k.");
            $db->setSetting($k, $k === 'tips_custom' ? json_encode(tips_clean($v), JSON_UNESCAPED_UNICODE) : (string) $v);
        }
        if (array_intersect_key($b, array_flip(['kb_tenant', 'kb_client_id', 'kb_client_secret']))) $db->setSetting('kb_token', '');   // neu anmelden
        $db->audit($who, 'settings', mb_substr(json_encode(array_diff_key($b, array_flip(SECRET_SETTINGS)), JSON_UNESCAPED_UNICODE), 0, 300));
        json_out(['ok' => true, 'settings' => array_diff_key($db->settings(), array_flip(SECRET_SETTINGS))]);

    case $method === 'GET' && $sub === '/visits':
        json_out(array_map(fn($v) => ['id' => (int) $v['id'], 'created' => (int) $v['created'], 'from' => $v['fname'] ?? '?', 'to' => $v['tname'] ?? '?', 'kind' => $v['kind'], 'note' => $v['note'], 'result' => $v['result']],
            $db->all('SELECT v.*, COALESCE(f.visit_name, f.user, f.name) AS fname, COALESCE(t.visit_name, t.user, t.name) AS tname FROM visits v LEFT JOIN devices f ON f.id = v.from_id LEFT JOIN devices t ON t.id = v.to_id ORDER BY v.id DESC LIMIT 100')));

    /* Security-Quiz (1.5): eigene Fragen und anonyme Auswertung */
    case $method === 'GET' && $sub === '/quiz':
        $since = day_key(now_ms() - 30 * 86400000);
        $per = $db->all('SELECT qid, SUM(n) AS n, SUM(ok) AS ok FROM quiz_stats WHERE day >= ? GROUP BY qid', [$since]);
        $labels = []; foreach ($db->all('SELECT * FROM quiz_labels') as $l) $labels[$l['qid']] = $l['text'];
        $own = $db->all('SELECT * FROM quiz_questions ORDER BY id DESC');
        foreach ($own as $q) $labels['c' . $q['id']] = $q['q'];
        $tot = $db->get('SELECT COALESCE(SUM(n),0) AS n, COALESCE(SUM(ok),0) AS ok FROM quiz_stats WHERE day >= ?', [$since]);
        json_out(['questions' => array_map(fn($q) => quiz_question_public($q) + ['active' => (bool) $q['active'], 'created' => (int) $q['created']], $own),
            'total' => ['n' => (int) $tot['n'], 'ok' => (int) $tot['ok']],
            'perQuestion' => array_map(fn($r) => ['qid' => $r['qid'], 'label' => $labels[$r['qid']] ?? $r['qid'], 'n' => (int) $r['n'], 'ok' => (int) $r['ok']], $per)]);
    case $method === 'POST' && $sub === '/quiz':
        $q = trim(str((string) ($b['q'] ?? ''), 400));
        $a = array_values(array_filter(array_map(fn($x) => trim(str((string) $x, 200)), (array) ($b['a'] ?? [])), 'strlen'));
        $ok = (int) ($b['ok'] ?? -1);
        if ($q === '' || count($a) < 2 || count($a) > 4) fail(400, 'Bitte eine Frage und zwei bis vier Antworten angeben.');
        if ($ok < 0 || $ok >= count($a)) fail(400, 'Bitte die richtige Antwort markieren.');
        $link = (string) ($b['link'] ?? '');
        if ($link !== '' && !preg_match('#^https://\S{3,300}$#', $link)) fail(400, 'Der Link muss mit https:// beginnen.');
        $db->run('INSERT INTO quiz_questions (created, updated, q, answers, ok, why, link, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
            [now_ms(), now_ms(), $q, json_encode($a, JSON_UNESCAPED_UNICODE), $ok, str((string) ($b['why'] ?? ''), 600), $link]);
        $nid = $db->lastId();                     // vor dem Protokolleintrag lesen (1.10)
        $db->audit($who, 'quiz_create', $q);
        json_out(['ok' => true, 'id' => 'c' . $nid]);
    case preg_match('#^/quiz/(\d+)$#', $sub, $mm) === 1 && in_array($method, ['PATCH', 'DELETE'], true):
        $q = $db->get('SELECT * FROM quiz_questions WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Frage nicht gefunden.');
        if ($method === 'DELETE') { $db->run('DELETE FROM quiz_questions WHERE id = ?', [$q['id']]); $db->audit($who, 'quiz_delete', $q['q']); json_out(['ok' => true]); }
        $db->run('UPDATE quiz_questions SET active = ?, updated = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, now_ms(), $q['id']]);
        json_out(['ok' => true]);
    case preg_match('#^/quiz/(\d+)/offer$#', $sub, $mm) === 1 && $method === 'POST':
        $q = $db->get('SELECT * FROM quiz_questions WHERE id = ? AND active = 1', [(int) $mm[1]]) ?? fail(404, 'Frage nicht gefunden oder nicht aktiv.');
        $target = valid_target($b['target'] ?? null);
        $r = publish($db, $cfg, ['type' => 'quiz', 'q' => 'c' . $q['id']], $target, 480, $who);
        $db->audit($who, 'quiz_offer', $q['q'] . ' → ' . $target);
        json_out(['ok' => true] + $r);

    /* YouTube (1.8) */
    /* Wissen & Anleitungen aus SharePoint (1.9) */
    case $method === 'GET' && $sub === '/kb':
        $s = $db->settings(); $c = kb_creds($s, $cfg);
        json_out(['enabled' => ($s['kb_enabled'] ?? 'false') === 'true', 'ai' => ($s['kb_ai'] ?? 'true') === 'true', 'interval' => (int) ($s['kb_interval'] ?? 60),
            'tenant' => (string) ($s['kb_tenant'] ?? ''), 'clientId' => (string) ($s['kb_client_id'] ?? ''), 'secretSet' => ($s['kb_client_secret'] ?? '') !== '',
            'fallback' => !$c['own'] && $c['id'] !== '' && $c['secret'] !== '', 'ready' => $c['tenant'] !== '' && $c['id'] !== '' && $c['secret'] !== '',
            'items' => (int) $db->get('SELECT COUNT(*) AS n FROM kb_items')['n'], 'withText' => (int) $db->get("SELECT COUNT(*) AS n FROM kb_items WHERE text <> ''")['n'],
            'sources' => array_map('kb_source_public', $db->all('SELECT * FROM kb_sources ORDER BY id'))]);
    case $method === 'POST' && $sub === '/kb/test':
        try { kb_token($db, $cfg, true); json_out(['ok' => true]); } catch (RuntimeException $e) { fail(400, $e->getMessage()); }
    case $method === 'POST' && $sub === '/kb/sources':
        json_out(kb_add($db, $cfg, (string) ($b['url'] ?? ''), $who));
    case preg_match('#^/kb/sources/(\d+)$#', $sub, $mm) === 1 && $method === 'PATCH':
        $db->run('UPDATE kb_sources SET active = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, (int) $mm[1]]);
        json_out(['ok' => true]);
    case preg_match('#^/kb/sources/(\d+)$#', $sub, $mm) === 1 && $method === 'DELETE':
        $src = $db->get('SELECT * FROM kb_sources WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Quelle nicht gefunden.');
        $db->run('DELETE FROM kb_items WHERE source_id = ?', [$src['id']]);
        $db->run('DELETE FROM kb_sources WHERE id = ?', [$src['id']]);
        $db->audit($who, 'kb_delete', $src['title']);
        json_out(['ok' => true]);
    case preg_match('#^/kb/sources/(\d+)/sync$#', $sub, $mm) === 1 && $method === 'POST':
        $r = kb_sync_source($db, $cfg, (int) $mm[1]);
        if (!$r['ok']) fail(502, $r['error']);
        json_out($r);
    case $method === 'POST' && $sub === '/kb/search':
        $q = str((string) ($b['q'] ?? ''), 200);
        json_out(['items' => mb_strlen($q) >= 2 ? kb_search($db, $q, 10) : kb_recent($db, 10), 'ai' => mb_strlen($q) >= 2 ? kb_ai_context($db, ['kb_enabled' => 'true'] + $db->settings(), $q) !== '' : false]);

    case $method === 'GET' && $sub === '/youtube':
        $s = $db->settings();
        json_out(['enabled' => ($s['youtube_enabled'] ?? 'true') === 'true', 'interval' => (int) ($s['youtube_interval'] ?? 15), 'ttl' => (int) ($s['youtube_ttl'] ?? 480),
            'channels' => array_map('yt_channel_public', $db->all('SELECT * FROM yt_channels ORDER BY title')),
            'videos' => array_map(fn($v) => ['id' => $v['video_id'], 'title' => $v['title'], 'channel' => $v['ctitle'] ?? '', 'published' => (int) $v['published'], 'sent' => (int) $v['sent']],
                $db->all('SELECT v.*, c.title AS ctitle FROM yt_videos v LEFT JOIN yt_channels c ON c.channel_id = v.channel_id ORDER BY v.sent DESC LIMIT 15'))]);
    case $method === 'POST' && $sub === '/youtube':
        try { json_out(['ok' => true] + yt_add($db, $cfg, $b, $who)); } catch (RuntimeException $e) { fail(400, $e->getMessage()); }
    case $method === 'POST' && $sub === '/youtube/check':
        json_out(['ok' => true] + yt_check($db, $cfg, true));
    case preg_match('#^/youtube/(\d+)$#', $sub, $mm) === 1 && in_array($method, ['PATCH', 'DELETE'], true):
        $c = $db->get('SELECT * FROM yt_channels WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Kanal nicht gefunden.');
        if ($method === 'DELETE') { $db->run('DELETE FROM yt_channels WHERE id = ?', [$c['id']]); $db->audit($who, 'youtube_delete', $c['title']); json_out(['ok' => true]); }
        if (isset($b['active'])) $db->run('UPDATE yt_channels SET active = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, $c['id']]);
        if (isset($b['shorts'])) $db->run('UPDATE yt_channels SET shorts = ? WHERE id = ?', [!empty($b['shorts']) ? 1 : 0, $c['id']]);
        if (isset($b['target'])) $db->run('UPDATE yt_channels SET target = ? WHERE id = ?', [valid_target($b['target']), $c['id']]);
        json_out(['ok' => true]);

    /* Musikwünsche (1.8) */
    case $method === 'GET' && $sub === '/music':
        json_out(music_admin($db, $cfg));
    case $method === 'POST' && $sub === '/music/skip':
        try { music_skip($db, $cfg); } catch (RuntimeException $e) { fail(502, $e->getMessage()); }
        $db->audit($who, 'music_skip');
        json_out(['ok' => true]);
    case preg_match('#^/music/veto/(\d+)$#', $sub, $mm) === 1 && $method === 'POST':
        json_out(music_veto($db, $cfg, (int) $mm[1], $who));
    case preg_match('#^/music/blocked/([\w]{1,40})$#', $sub, $mm) === 1 && $method === 'DELETE':
        $db->run('DELETE FROM music_blocked WHERE track_id = ?', [$mm[1]]);
        $db->audit($who, 'music_unblock', $mm[1]);
        json_out(['ok' => true]);
    case $method === 'POST' && $sub === '/music/disconnect':
        foreach (['spotify_refresh', 'spotify_access', 'spotify_access_exp', 'spotify_account', 'spotify_device_id', 'spotify_device_name'] as $k) $db->setSetting($k, '');
        $db->audit($who, 'spotify_disconnect');
        json_out(['ok' => true]);

    /* Regeln (1.7): eingehende Meldungen einordnen */
    case $method === 'GET' && $sub === '/rules':
        json_out(['rules' => array_map('rule_public', $db->all('SELECT * FROM rules ORDER BY pos, id')), 'ticketLink' => (string) ($db->settings()['ticket_link'] ?? '')]);
    case $method === 'POST' && $sub === '/rules':
        $c = rule_clean($b);
        $pos = (int) ($db->get('SELECT COALESCE(MAX(pos), 0) AS p FROM rules')['p']) + 10;
        $db->run('INSERT INTO rules (pos, name, active, match_type, field, mode, pattern, action, extract, target, dur, ttl, link_tpl, hits, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
            [$pos, $c['name'], $c['active'], $c['match_type'], $c['field'], $c['mode'], $c['pattern'], $c['action'], $c['extract'], $c['target'], $c['dur'], $c['ttl'], $c['link_tpl'], now_ms(), now_ms()]);
        $nid = $db->lastId();                     // vor dem Protokolleintrag lesen (1.10)
        $db->audit($who, 'rule_create', $c['name']);
        json_out(['ok' => true, 'id' => $nid]);
    case preg_match('#^/rules/(\d+)$#', $sub, $mm) === 1 && in_array($method, ['PUT', 'PATCH', 'DELETE'], true):
        $r = $db->get('SELECT * FROM rules WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Regel nicht gefunden.');
        if ($method === 'DELETE') { $db->run('DELETE FROM rules WHERE id = ?', [$r['id']]); $db->audit($who, 'rule_delete', $r['name']); json_out(['ok' => true]); }
        if ($method === 'PATCH') {   // an/aus oder verschieben
            if (isset($b['active'])) $db->run('UPDATE rules SET active = ?, updated = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, now_ms(), $r['id']]);
            if (isset($b['move'])) {
                $all = $db->all('SELECT id FROM rules ORDER BY pos, id'); $ids = array_map(fn($x) => (int) $x['id'], $all);
                $i = array_search((int) $r['id'], $ids, true); $j = $i + ((int) $b['move'] < 0 ? -1 : 1);
                if ($j >= 0 && $j < count($ids)) { [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]]; }
                foreach ($ids as $n => $id) $db->run('UPDATE rules SET pos = ? WHERE id = ?', [($n + 1) * 10, $id]);
            }
            json_out(['ok' => true]);
        }
        $c = rule_clean($b);
        $db->run('UPDATE rules SET name = ?, active = ?, match_type = ?, field = ?, mode = ?, pattern = ?, action = ?, extract = ?, target = ?, dur = ?, ttl = ?, link_tpl = ?, updated = ? WHERE id = ?',
            [$c['name'], $c['active'], $c['match_type'], $c['field'], $c['mode'], $c['pattern'], $c['action'], $c['extract'], $c['target'], $c['dur'], $c['ttl'], $c['link_tpl'], now_ms(), $r['id']]);
        $db->audit($who, 'rule_edit', $c['name']);
        json_out(['ok' => true]);
    case $method === 'POST' && $sub === '/rules/test':
        // Probe ohne Senden: Was würde aus dieser Meldung?
        $ev = clean_event((array) ($b['event'] ?? [])) ?? fail(400, 'Unbekannter type. Erlaubt: ' . implode(', ', EVENT_TYPES));
        $res = rules_run($db, $ev, $db->settings(), false);
        json_out(['in' => $ev, 'rule' => $res['rule'] ? rule_public($res['rule']) : null, 'out' => $res['event'] ? clean_event($res['event']) : null, 'dropped' => $res['rule'] && $res['event'] === null]);
    case $method === 'PUT' && $sub === '/rules/settings':
        $tl = trim((string) ($b['ticketLink'] ?? ''));
        if ($tl !== '' && (!preg_match('~^https://\S{3,300}$~', $tl) || !str_contains($tl, '{ticket}'))) fail(400, 'Die Ticket-Vorlage muss mit https:// beginnen und {ticket} enthalten.');
        $db->setSetting('ticket_link', $tl);
        $db->audit($who, 'settings', 'Ticket-Link: ' . $tl);
        json_out(['ok' => true]);

    /* Betrieb (1.6): Störungen, Neustart-Kampagnen, Selbsthilfe */
    case $method === 'GET' && $sub === '/ops':
        $since = day_key(now_ms() - 30 * 86400000);
        json_out([
            'incidents' => array_map(fn($i) => incident_admin($db, $i, true), $db->all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC')),
            'resolved' => array_map(fn($i) => incident_admin($db, $i, false), $db->all('SELECT * FROM incidents WHERE resolved IS NOT NULL ORDER BY resolved DESC LIMIT 15')),
            'campaigns' => array_map(fn($c) => restart_admin($db, $c, $cfg), $db->all('SELECT * FROM restart_campaigns ORDER BY active DESC, id DESC LIMIT 12')),
            'selfhelp' => array_map(fn($r) => ['tool' => $r['tool'], 'n' => (int) $r['n'], 'ok' => (int) $r['ok']],
                $db->all('SELECT tool, SUM(n) AS n, SUM(ok) AS ok FROM selfhelp_stats WHERE day >= ? GROUP BY tool ORDER BY n DESC', [$since])),
            'help' => help_public($db->settings()) ?? ['text' => '', 'phone' => '', 'mail' => '', 'url' => '']]);
    case $method === 'POST' && $sub === '/incidents':
        json_out(['ok' => true] + incident_create($db, $cfg, $b, $who));
    case preg_match('#^/incidents/(\d+)/resolve$#', $sub, $mm) === 1 && $method === 'POST':
        incident_resolve($db, (int) $mm[1], (string) ($b['text'] ?? ''), $who);
        json_out(['ok' => true]);
    case $method === 'POST' && $sub === '/restart':
        $id = restart_create($db, $b, $who);
        json_out(['ok' => true, 'id' => $id]);
    case preg_match('#^/restart/(\d+)/end$#', $sub, $mm) === 1 && $method === 'POST':
        $c = $db->get('SELECT * FROM restart_campaigns WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Kampagne nicht gefunden.');
        $db->run('UPDATE restart_campaigns SET active = 0, ended = ? WHERE id = ?', [now_ms(), $c['id']]);
        $db->audit($who, 'restart_end', "#{$c['id']} {$c['title']}");
        json_out(['ok' => true]);

    /* Mitarbeiter-Erlebnis (1.10): Stimmungsbarometer, Rückmeldungen nach Störungen, Start-Checkliste, Tipps */
    case $method === 'GET' && $sub === '/dex':
        json_out(dex_admin($db, $cfg));
    case $method === 'POST' && $sub === '/pulse':
        json_out(['ok' => true, 'id' => pulse_create($db, $b, $who)]);
    case preg_match('#^/pulse/(\d+)/end$#', $sub, $mm) === 1 && $method === 'POST':
        $sv = $db->get('SELECT * FROM pulse_surveys WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Umfrage nicht gefunden.');
        $db->run('UPDATE pulse_surveys SET active = 0, ends = ? WHERE id = ?', [min(now_ms(), (int) ($sv['ends'] ?: now_ms())), $sv['id']]);
        $db->audit($who, 'pulse_end', "#{$sv['id']} {$sv['question']}");
        json_out(['ok' => true]);
    case preg_match('#^/pulse/(\d+)$#', $sub, $mm) === 1 && $method === 'DELETE':
        $sv = $db->get('SELECT * FROM pulse_surveys WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Umfrage nicht gefunden.');
        foreach (['pulse_done', 'pulse_votes', 'pulse_comments'] as $tb) $db->run("DELETE FROM $tb WHERE survey_id = ?", [$sv['id']]);
        $db->run('DELETE FROM pulse_surveys WHERE id = ?', [$sv['id']]);
        $db->audit($who, 'pulse_delete', $sv['question']);
        json_out(['ok' => true]);
    case $method === 'POST' && $sub === '/onboard':
        $c = onboard_item_clean($b);
        $pos = (int) ($db->get('SELECT COALESCE(MAX(pos), 0) AS p FROM onboard_items')['p']) + 10;
        $db->run('INSERT INTO onboard_items (pos, title, text, check_, link, target, active, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [$pos, $c['title'], $c['text'], $c['check_'], $c['link'], $c['target'], now_ms()]);
        $nid = $db->lastId();                     // vor dem Protokolleintrag lesen, sonst kommt dessen ID zurück
        $db->audit($who, 'onboard_add', $c['title']);
        json_out(['ok' => true, 'id' => $nid]);
    case preg_match('#^/onboard/(\d+)$#', $sub, $mm) === 1 && in_array($method, ['PATCH', 'DELETE'], true):
        $it = $db->get('SELECT * FROM onboard_items WHERE id = ?', [(int) $mm[1]]) ?? fail(404, 'Punkt nicht gefunden.');
        if ($method === 'DELETE') { $db->run('DELETE FROM onboard_status WHERE item_id = ?', [$it['id']]); $db->run('DELETE FROM onboard_items WHERE id = ?', [$it['id']]); $db->audit($who, 'onboard_delete', $it['title']); json_out(['ok' => true]); }
        if (isset($b['active'])) $db->run('UPDATE onboard_items SET active = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, $it['id']]);
        if (isset($b['move'])) {
            $ids = array_map(fn($x) => (int) $x['id'], $db->all('SELECT id FROM onboard_items ORDER BY pos, id'));
            $i = array_search((int) $it['id'], $ids, true); $j = $i + ((int) $b['move'] < 0 ? -1 : 1);
            if ($j >= 0 && $j < count($ids)) { [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]]; }
            foreach ($ids as $n => $id) $db->run('UPDATE onboard_items SET pos = ? WHERE id = ?', [($n + 1) * 10, $id]);
        }
        json_out(['ok' => true]);
    case preg_match('#^/onboard/device/([\w-]+)$#', $sub, $mm) === 1 && $method === 'POST':
        $d = $db->get('SELECT * FROM devices WHERE id = ? AND revoked = 0', [$mm[1]]) ?? fail(404, 'Gerät nicht gefunden.');
        $days = max(1, min(180, (int) ($db->settings()['onboard_days'] ?? 30)));
        $db->run('UPDATE devices SET onboard_until = ? WHERE id = ?', [now_ms() + $days * 86400000, $d['id']]);
        $db->audit($who, 'onboard_show', $d['name']);
        json_out(['ok' => true]);

    /* Plugins (1.12) */
    case $method === 'GET' && $sub === '/plugins':
        json_out(plugins_admin($db));
    case $method === 'POST' && $sub === '/plugins':
        // Eigenes Lesen: body() liest höchstens 256 KB, ein Plugin darf 2 MB haben (als JSON etwas mehr)
        $pb = json_decode(file_get_contents('php://input', false, null, 0, 3 * 1024 * 1024) ?: '', true);
        json_out(plugin_save($db, is_array($pb) ? $pb : [], $who));
    case preg_match('#^/plugins/([a-z0-9-]{2,40})$#', $sub, $mm) === 1 && in_array($method, ['PATCH', 'DELETE'], true):
        if ($method === 'DELETE') plugin_delete($db, $mm[1], $who); else plugin_patch($db, $mm[1], $b, $who);
        json_out(['ok' => true]);

    case $method === 'GET' && $sub === '/audit':
        json_out(array_map(fn($a) => ['id' => (int) $a['id'], 'ts' => (int) $a['ts'], 'actor' => $a['actor'], 'action' => $a['action'], 'detail' => $a['detail']],
            $db->all('SELECT * FROM audit ORDER BY id DESC LIMIT 200')));
}
fail(404, 'Unbekannte Admin-Adresse.');
