<?php
// dex.php – Mitarbeiter-Erlebnis (1.10): Stimmungsbarometer, Start-Checkliste für neue Kollegen, Tipps im passenden Moment.
// Gleiche Antworten wie src/dex.js der Node-Version.
// Datenschutz: Stimmungs-Antworten werden ohne Gerät gespeichert (nur Note, Ampel des Gerätezustands, Tag);
// gemerkt wird je Gerät nur, DASS es geantwortet hat. Auswertung erst ab pulse_min Antworten.
declare(strict_types=1);

const ONBOARD_CHECKS = ['manual', 'onedrive', 'kfm', 'signature', 'printer', 'teams', 'quiz', 'health'];
const TIP_APPS = ['all', 'excel', 'word', 'outlook', 'teams', 'powerpoint', 'onenote', 'browser', 'sharepoint', 'onedrive'];
const PULSE_MONTHLY_Q = 'Wie zufrieden bist du gerade mit deinem PC und deinen IT-Werkzeugen?';

// Erlaubte Links: https:// oder feste Sudo-Seiten (Quiz, IT-Lage, Selbsthilfe, Anleitungen)
function dex_link_ok(string $l): bool { return $l === '' || preg_match('#^https://\S{3,300}$#', $l) || preg_match('#^sudo:[a-z]{2,12}(/[a-z]{2,12})?$#', $l); }
function dex_on(array $s, string $k, string $def = 'true'): bool { return ($s[$k] ?? $def) === 'true'; }

/* ---------- Einmalige Vorbereitung: mitgelieferte Checkliste ---------- */
function onboard_seed(Db $db): void
{
    if ($db->get("SELECT v FROM settings WHERE k = 'mig_110_onboard_seed'")) return;
    $items = [
        ['Mehrstufige Anmeldung (MFA) einrichten', 'Authenticator-App auf dem Handy einrichten – so kommt niemand mit deinem Passwort allein in dein Konto.', 'manual', 'https://mysignins.microsoft.com/security-info'],
        ['OneDrive anmelden', 'OneDrive mit deinem Firmenkonto anmelden (Wolken-Symbol unten rechts).', 'onedrive', ''],
        ['Desktop und Dokumente in OneDrive sichern', 'OneDrive → Einstellungen → Synchronisieren und sichern → Sicherung verwalten.', 'kfm', ''],
        ['Teams einrichten', 'Teams starten und mit deinem Firmenkonto anmelden.', 'teams', ''],
        ['E-Mail-Signatur anlegen', 'Outlook → Einstellungen → Signaturen.', 'signature', ''],
        ['Drucker verbinden', 'Einstellungen → Bluetooth und Geräte → Drucker und Scanner.', 'printer', ''],
        ['Gerätezustand prüfen', 'Sudo schaut, ob Verschlüsselung, Virenschutz und Updates passen.', 'health', 'sudo:lage/pc'],
        ['Einmal das Security-Quiz spielen', 'Eine Frage, ein paar Sekunden – und du erkennst Phishing schneller.', 'quiz', 'sudo:quiz'],
    ];
    foreach ($items as $n => [$t, $x, $c, $l]) {
        $db->run('INSERT INTO onboard_items (pos, title, text, check_, link, target, active, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [($n + 1) * 10, $t, $x, $c, $l, 'all', now_ms()]);
    }
    $db->setSetting('mig_110_onboard_seed', '1');
}

/* ---------- Was ein Sudo bei jedem Abruf bekommt ---------- */
function dex_public(Db $db, array $dev, array $s): array
{
    pulse_monthly_ensure($db, $s);
    return ['pulse' => pulse_public($db, $dev, $s), 'onboard' => onboard_public($db, $dev, $s), 'tips' => tips_public($s)];
}
function pulse_public(Db $db, array $dev, array $s): array
{
    if (!dex_on($s, 'pulse_enabled')) return ['enabled' => false, 'surveys' => [], 'incident' => false];
    $rows = $db->all('SELECT * FROM pulse_surveys WHERE active = 1 AND (ends IS NULL OR ends > ?)
        AND NOT EXISTS (SELECT 1 FROM pulse_done d WHERE d.survey_id = pulse_surveys.id AND d.device_id = ?) ORDER BY id LIMIT 20', [now_ms(), $dev['id']]);
    $rows = array_values(array_filter($rows, fn($r) => target_matches((string) $r['target'], $dev)));
    return ['enabled' => true, 'incident' => dex_on($s, 'pulse_incident'),
        'surveys' => array_map(fn($r) => ['id' => (int) $r['id'], 'q' => $r['question'], 'kind' => $r['kind']], array_slice($rows, 0, 3))];
}
// Monatliche Frage: legt sich selbst an, sobald der Monat beginnt (nur wenn eingeschaltet)
function pulse_monthly_ensure(Db $db, array $s): void
{
    if (!dex_on($s, 'pulse_enabled') || !dex_on($s, 'pulse_monthly', 'false')) return;
    $period = date('Y-m');
    if (($s['pulse_month'] ?? '') === $period) return;
    if (!$db->get("SELECT 1 FROM pulse_surveys WHERE kind = 'monthly' AND period = ?", [$period])) {
        $end = (new DateTimeImmutable('first day of next month 00:00'))->getTimestamp() * 1000;
        $db->run('INSERT INTO pulse_surveys (created, question, kind, period, target, active, ends, author) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
            [now_ms(), PULSE_MONTHLY_Q, 'monthly', $period, 'all', $end, 'system']);
    }
    $db->setSetting('pulse_month', $period);
}
function onboard_window_end(array $dev, array $s): int
{
    $days = max(1, min(180, (int) ($s['onboard_days'] ?? 30)));
    return max((int) $dev['created'] + $days * 86400000, (int) ($dev['onboard_until'] ?? 0));
}
function onboard_public(Db $db, array $dev, array $s): ?array
{
    if (!dex_on($s, 'onboard_enabled', 'false') || onboard_window_end($dev, $s) < now_ms()) return null;
    $items = array_values(array_filter($db->all('SELECT * FROM onboard_items WHERE active = 1 ORDER BY pos, id'), fn($i) => target_matches((string) $i['target'], $dev)));
    if (!$items) return null;
    $done = array_map(fn($r) => (int) $r['item_id'], $db->all('SELECT item_id FROM onboard_status WHERE device_id = ? AND done = 1', [$dev['id']]));
    return ['until' => onboard_window_end($dev, $s), 'done' => $done,
        'items' => array_map(fn($i) => ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => (string) $i['text'], 'check' => $i['check_'], 'link' => (string) $i['link']], array_slice($items, 0, 20))];
}
function tips_clean($raw): ?array
{
    $list = is_string($raw) ? json_decode($raw, true) : $raw;
    if (!is_array($list) || count($list) > 50) return null;
    $out = [];
    foreach ($list as $t) {
        if (!is_array($t) || !in_array($t['app'] ?? '', TIP_APPS, true)) return null;
        $text = trim(preg_replace('/[\x00-\x1f\x7f]/u', ' ', strip_tags((string) ($t['text'] ?? ''))));
        if (mb_strlen($text) < 5 || mb_strlen($text) > 200) return null;
        $out[] = ['app' => $t['app'], 'text' => $text];
    }
    return $out;
}
function tips_public(array $s): array
{
    return ['enabled' => dex_on($s, 'tips_enabled'), 'items' => tips_clean($s['tips_custom'] ?? '[]') ?? []];
}

/* ---------- Antworten der Geräte ---------- */
function pulse_answer(Db $db, array $dev, array $b): array
{
    $s = $db->settings();
    if (!dex_on($s, 'pulse_enabled')) fail(403, 'Das Stimmungsbarometer ist in der Zentrale ausgeschaltet.');
    $sv = $db->get('SELECT * FROM pulse_surveys WHERE id = ? AND active = 1 AND (ends IS NULL OR ends > ?)', [(int) ($b['id'] ?? 0), now_ms()]) ?? fail(404, 'Diese Frage ist schon beendet.');
    if (!target_matches((string) $sv['target'], $dev)) fail(404, 'Diese Frage gilt nicht für dieses Gerät.');
    if ($db->get('SELECT 1 FROM pulse_done WHERE survey_id = ? AND device_id = ?', [$sv['id'], $dev['id']])) json_out(['ok' => true, 'already' => true]);
    // Erst prüfen, dann merken – sonst zählt eine ungültige Antwort als „schon beantwortet“
    $score = (int) ($b['score'] ?? 0);
    if (empty($b['skip']) && ($score < 1 || $score > 5)) fail(400, 'Bitte 1 bis 5 Sterne vergeben.');
    $db->insertIgnore('pulse_done', ['survey_id' => (int) $sv['id'], 'device_id' => $dev['id'], 'at' => now_ms()]);
    if (!empty($b['skip'])) json_out(['ok' => true, 'skipped' => true]);
    $h = !empty($dev['health']) ? (json_decode($dev['health'], true)['s'] ?? 'unknown') : 'unknown';
    if (!in_array($h, ['ok', 'warn', 'bad'], true)) $h = 'unknown';
    $db->upsert('pulse_votes', ['survey_id' => (int) $sv['id'], 'score' => $score, 'health' => $h, 'n' => 1], ['survey_id', 'score', 'health'], ['n']);
    $c = trim(preg_replace('/[\x00-\x1f\x7f]/u', ' ', strip_tags((string) ($b['comment'] ?? ''))));
    if ($c !== '') $db->run('INSERT INTO pulse_comments (survey_id, day, score, text) VALUES (?, ?, ?, ?)', [(int) $sv['id'], day_key(), $score, mb_substr($c, 0, 300)]);
    return ['ok' => true];
}
// Nach einer Störung: „Läuft es bei dir wieder?“ – mit Gerät, damit die IT bei „Nein“ helfen kann (steht so im Client)
function incident_feedback(Db $db, array $dev, array $b): array
{
    $i = $db->get('SELECT * FROM incidents WHERE id = ? AND resolved IS NOT NULL', [(int) ($b['id'] ?? 0)]) ?? fail(404, 'Diese Störung ist nicht beendet.');
    if (!target_matches((string) $i['target'], $dev)) fail(404, 'Diese Störung betrifft dieses Gerät nicht.');
    $db->upsert('incident_feedback', ['incident_id' => (int) $i['id'], 'device_id' => $dev['id'], 'ok' => !empty($b['ok']) ? 1 : 0, 'at' => now_ms()], ['incident_id', 'device_id']);
    if (empty($b['ok'])) $db->audit(($dev['upn'] ?: $dev['user']) . ' (' . $dev['name'] . ')', 'incident_still', "#{$i['id']} {$i['title']}");
    return ['ok' => true];
}
function onboard_mark(Db $db, array $dev, array $b): array
{
    $item = $db->get('SELECT * FROM onboard_items WHERE id = ? AND active = 1', [(int) ($b['id'] ?? 0)]) ?? fail(404, 'Diesen Punkt gibt es nicht mehr.');
    if (!target_matches((string) $item['target'], $dev)) fail(404, 'Dieser Punkt gilt nicht für dieses Gerät.');
    $db->upsert('onboard_status', ['device_id' => $dev['id'], 'item_id' => (int) $item['id'], 'done' => !empty($b['done']) ? 1 : 0, 'auto' => !empty($b['auto']) ? 1 : 0, 'at' => now_ms()], ['device_id', 'item_id']);
    return ['ok' => true];
}

/* ---------- Verwaltung ---------- */
function pulse_admin(Db $db, array $sv, int $min): array
{
    $votes = $db->all('SELECT score, health, n FROM pulse_votes WHERE survey_id = ?', [$sv['id']]);
    $n = array_sum(array_map(fn($v) => (int) $v['n'], $votes));
    $asked = (int) $db->get('SELECT COUNT(*) AS n FROM pulse_done WHERE survey_id = ?', [$sv['id']])['n'];
    $avg = fn(array $l) => ($m = array_sum(array_map(fn($v) => (int) $v['n'], $l))) ? round(array_sum(array_map(fn($v) => (int) $v['score'] * (int) $v['n'], $l)) / $m, 1) : null;
    $out = ['id' => (int) $sv['id'], 'question' => $sv['question'], 'kind' => $sv['kind'], 'period' => $sv['period'], 'target' => $sv['target'], 'active' => (bool) $sv['active'] && (!$sv['ends'] || (int) $sv['ends'] > now_ms()),
        'created' => (int) $sv['created'], 'ends' => $sv['ends'] ? (int) $sv['ends'] : null, 'author' => $sv['author'], 'n' => $n, 'skipped' => max(0, $asked - $n), 'enough' => $n >= $min,
        'avg' => null, 'dist' => null, 'byHealth' => null, 'comments' => []];
    if ($n < $min) return $out;
    $dist = [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0];
    foreach ($votes as $v) $dist[(int) $v['score']] += (int) $v['n'];
    $by = [];
    foreach (['ok', 'warn', 'bad', 'unknown'] as $h) {
        $l = array_values(array_filter($votes, fn($v) => $v['health'] === $h));
        $hn = array_sum(array_map(fn($v) => (int) $v['n'], $l));
        $by[$h] = ['n' => $hn, 'avg' => $hn >= $min ? $avg($l) : null];
    }
    $out['avg'] = $avg($votes); $out['dist'] = $dist; $out['byHealth'] = $by;
    $out['comments'] = array_map(fn($c) => ['day' => $c['day'], 'score' => (int) $c['score'], 'text' => $c['text']], $db->all('SELECT * FROM pulse_comments WHERE survey_id = ? ORDER BY id DESC LIMIT 50', [$sv['id']]));
    return $out;
}
function dex_admin(Db $db, array $cfg): array
{
    pulse_monthly_ensure($db, $db->settings());
    $s = $db->settings();
    $min = max(3, min(20, (int) ($s['pulse_min'] ?? 5)));
    $feedback = [];
    foreach ($db->all('SELECT * FROM incidents WHERE resolved IS NOT NULL ORDER BY resolved DESC LIMIT 10') as $i) {
        $rows = $db->all('SELECT f.ok, f.at, d.name, d.user, d.upn FROM incident_feedback f LEFT JOIN devices d ON d.id = f.device_id WHERE f.incident_id = ? ORDER BY f.at', [$i['id']]);
        if (!$rows) continue;
        $feedback[] = ['id' => (int) $i['id'], 'title' => $i['title'], 'resolved' => (int) $i['resolved'], 'ok' => count(array_filter($rows, fn($r) => (int) $r['ok'] === 1)),
            'still' => array_values(array_map(fn($r) => ['name' => $r['name'] ?? '?', 'user' => ($r['upn'] ?? '') ?: ($r['user'] ?? ''), 'at' => (int) $r['at']], array_filter($rows, fn($r) => (int) $r['ok'] === 0)))];
    }
    $items = $db->all('SELECT * FROM onboard_items ORDER BY pos, id');
    $devs = [];
    foreach ($db->all('SELECT * FROM devices WHERE revoked = 0 ORDER BY created DESC') as $d) {
        if (onboard_window_end($d, $s) < now_ms() - 7 * 86400000) continue;     // eine Woche nach Ablauf noch sichtbar
        $mine = array_values(array_filter($items, fn($i) => (int) $i['active'] === 1 && target_matches((string) $i['target'], $d)));
        $ids = array_map(fn($i) => (int) $i['id'], $mine);
        $st = $db->all('SELECT item_id, at FROM onboard_status WHERE device_id = ? AND done = 1', [$d['id']]);
        $done = array_values(array_filter($st, fn($r) => in_array((int) $r['item_id'], $ids, true)));
        $devs[] = ['id' => $d['id'], 'name' => $d['name'], 'user' => ($d['upn'] ?? '') ?: $d['user'], 'created' => (int) $d['created'], 'until' => onboard_window_end($d, $s),
            'total' => count($ids), 'done' => count($done), 'open' => array_values(array_map(fn($i) => $i['title'], array_filter($mine, fn($i) => !in_array((int) $i['id'], array_map(fn($r) => (int) $r['item_id'], $done), true)))),
            'last' => $done ? max(array_map(fn($r) => (int) $r['at'], $done)) : null, 'online' => is_online($d, $cfg)];
    }
    return ['min' => $min,
        'pulse' => array_map(fn($sv) => pulse_admin($db, $sv, $min), $db->all('SELECT * FROM pulse_surveys ORDER BY id DESC LIMIT 20')),
        'feedback' => $feedback,
        'onboard' => ['items' => array_map(fn($i) => ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => (string) $i['text'], 'check' => $i['check_'], 'link' => (string) $i['link'],
            'target' => $i['target'], 'active' => (bool) $i['active']], $items), 'devices' => $devs, 'checks' => ONBOARD_CHECKS],
        'tips' => tips_clean($s['tips_custom'] ?? '[]') ?? [], 'tipApps' => TIP_APPS];
}
function pulse_create(Db $db, array $b, string $who): int
{
    $q = trim(str((string) ($b['question'] ?? ''), 200));
    if (mb_strlen($q) < 8) fail(400, 'Bitte eine Frage eingeben (mind. 8 Zeichen), z. B. „Wie zufrieden bist du mit dem neuen Drucker?“');
    if (isset($b['target']) && valid_target($b['target']) !== trim((string) $b['target'])) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    $days = max(1, min(60, (int) ($b['days'] ?? 7)));
    $db->run('INSERT INTO pulse_surveys (created, question, kind, period, target, active, ends, author) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)',
        [now_ms(), $q, 'custom', valid_target($b['target'] ?? 'all'), now_ms() + $days * 86400000, $who]);
    $id = $db->lastId();
    $db->audit($who, 'pulse_start', "#$id $q");
    return $id;
}
function onboard_item_clean(array $b): array
{
    $title = trim(str((string) ($b['title'] ?? ''), 120));
    if (mb_strlen($title) < 3) fail(400, 'Bitte einen Titel angeben, z. B. „VPN einrichten“.');
    $check = in_array($b['check'] ?? 'manual', ONBOARD_CHECKS, true) ? (string) ($b['check'] ?? 'manual') : fail(400, 'Unbekannte Prüfung.');
    $link = trim((string) ($b['link'] ?? ''));
    if (!dex_link_ok($link)) fail(400, 'Der Link muss mit https:// beginnen.');
    if (isset($b['target']) && valid_target($b['target']) !== trim((string) $b['target'])) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    return ['title' => $title, 'text' => str((string) ($b['text'] ?? ''), 300), 'check_' => $check, 'link' => $link, 'target' => valid_target($b['target'] ?? 'all')];
}
