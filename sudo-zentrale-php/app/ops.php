<?php
// ops.php – Betrieb (1.6): Störungen mit „Ich bin auch betroffen“, Neustart-Kampagnen, Selbsthilfe-Zähler, Hilfe-Kontakt.
// Gleiche Antworten wie src/ops.js der Node-Version.
declare(strict_types=1);

const INCIDENT_SEV = ['info', 'stoerung', 'ausfall'];
const RESTART_STATES = ['open', 'snoozed', 'restarting', 'done', 'notneeded'];
const SELFHELP_TOOLS = ['net', 'teams', 'outlook', 'onedrive', 'explorer', 'temp', 'dns', 'slow', 'meet'];   // 1.10: + Langsam-Analyse, Meeting-Check

function help_public(array $s): ?array
{
    $h = ['text' => (string) ($s['help_text'] ?? ''), 'phone' => (string) ($s['help_phone'] ?? ''), 'mail' => (string) ($s['help_mail'] ?? ''), 'url' => (string) ($s['help_url'] ?? '')];
    return array_filter($h, 'strlen') ? $h : null;
}
function incident_affected_count(Db $db, int $id): int
{
    return (int) $db->get('SELECT COUNT(*) AS n FROM incident_affected WHERE incident_id = ?', [$id])['n'];
}
// Was ein Sudo bei jedem Abruf bekommt: nur, was zu ihm passt
function ops_public(Db $db, array $dev, array $s): array
{
    $inc = array_values(array_filter($db->all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC LIMIT 20'), fn($i) => target_matches((string) $i['target'], $dev)));
    $res = array_values(array_filter($db->all('SELECT * FROM incidents WHERE resolved IS NOT NULL AND resolved > ? ORDER BY resolved DESC LIMIT 10', [now_ms() - 86400000]),
        fn($i) => target_matches((string) $i['target'], $dev)));
    $camp = array_values(array_filter($db->all('SELECT * FROM restart_campaigns WHERE active = 1 ORDER BY id DESC LIMIT 5'), fn($c) => target_matches((string) $c['target'], $dev)));
    return [
        'help' => help_public($s),
        'incidents' => array_map(fn($i) => ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => (string) $i['text'], 'sev' => $i['sev'], 'link' => (string) $i['link'],
            'since' => (int) $i['created'], 'affected' => incident_affected_count($db, (int) $i['id'])], array_slice($inc, 0, 10)),
        'resolved' => array_map(fn($i) => ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => (string) $i['resolve_text'], 'at' => (int) $i['resolved']], $res),
        'restart' => array_map(fn($c) => ['id' => (int) $c['id'], 'title' => $c['title'], 'text' => (string) $c['text'], 'created' => (int) $c['created'],
            'deadline' => $c['deadline'] ? (int) $c['deadline'] : null, 'mode' => $c['mode'], 'days' => (int) $c['days']], $camp),
    ];
}

/* ---------- Störungen ---------- */
function incident_create(Db $db, array $cfg, array $b, string $author): array
{
    $title = trim(str((string) ($b['title'] ?? ''), 120));
    if (mb_strlen($title) < 3) fail(400, 'Bitte einen Titel angeben (mind. 3 Zeichen), z. B. „Teams: Anmeldung gestört“.');
    $sev = in_array($b['sev'] ?? '', INCIDENT_SEV, true) ? $b['sev'] : 'stoerung';
    $link = trim((string) ($b['link'] ?? ''));
    if ($link !== '' && !preg_match('#^https://\S{3,300}$#', $link)) fail(400, 'Der Link muss mit https:// beginnen.');
    if (isset($b['target']) && valid_target($b['target']) !== trim((string) $b['target'])) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    $target = valid_target($b['target'] ?? 'all');
    // Doppelte Meldungen (z. B. Monitoring alle 5 Minuten) landen in der bestehenden Störung
    $dup = $db->get('SELECT id FROM incidents WHERE resolved IS NULL AND title = ? AND target = ?', [$title, $target]);
    if ($dup) return ['id' => (int) $dup['id'], 'existing' => true];
    $db->run('INSERT INTO incidents (created, updated, title, text, sev, link, target, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [now_ms(), now_ms(), $title, str((string) ($b['text'] ?? ''), 500), $sev, $link, $target, $author]);
    $id = $db->lastId();
    $db->audit($author, 'incident_open', "#$id $title → $target");
    $devs = array_filter($db->all('SELECT * FROM devices WHERE revoked = 0'), fn($d) => target_matches($target, $d));
    return ['id' => $id, 'existing' => false, 'targets' => count($devs)];
}
function incident_resolve(Db $db, int $id, string $text, string $who): void
{
    $i = $db->get('SELECT * FROM incidents WHERE id = ?', [$id]) ?? fail(404, 'Störung nicht gefunden.');
    if ($i['resolved']) fail(409, 'Diese Störung ist schon beendet.');
    $db->run('UPDATE incidents SET resolved = ?, resolved_by = ?, resolve_text = ?, updated = ? WHERE id = ?', [now_ms(), $who, str($text, 300), now_ms(), $id]);
    $db->audit($who, 'incident_resolve', "#$id {$i['title']}");
}
function incident_admin(Db $db, array $i, bool $detail): array
{
    $out = ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => (string) $i['text'], 'sev' => $i['sev'], 'link' => (string) $i['link'], 'target' => $i['target'],
        'author' => $i['author'], 'created' => (int) $i['created'], 'resolved' => $i['resolved'] ? (int) $i['resolved'] : null, 'resolvedBy' => $i['resolved_by'],
        'resolveText' => (string) $i['resolve_text'], 'affected' => incident_affected_count($db, (int) $i['id'])];
    if ($detail) $out['devices'] = array_map(fn($r) => ['name' => $r['name'] ?? '?', 'user' => $r['upn'] ?: ($r['user'] ?? ''), 'at' => (int) $r['at']],
        $db->all('SELECT a.at, d.name, d.user, d.upn FROM incident_affected a LEFT JOIN devices d ON d.id = a.device_id WHERE a.incident_id = ? ORDER BY a.at', [$i['id']]));
    return $out;
}

/* ---------- Neustart-Kampagnen ---------- */
function restart_create(Db $db, array $b, string $who): int
{
    $title = trim(str((string) ($b['title'] ?? ''), 120));
    if (mb_strlen($title) < 3) fail(400, 'Bitte einen Titel angeben, z. B. „Patchday: bitte bis Freitag neu starten“.');
    $deadline = isset($b['deadline']) && $b['deadline'] !== '' && $b['deadline'] !== null ? (int) $b['deadline'] : null;
    if ($deadline !== null && ($deadline < now_ms() || $deadline > now_ms() + 60 * 86400000)) fail(400, 'Die Frist muss in der Zukunft liegen (höchstens 60 Tage).');
    $mode = ($b['mode'] ?? 'all') === 'pending' ? 'pending' : 'all';
    $days = max(1, min(60, (int) ($b['days'] ?? 7)));
    $target = valid_target($b['target'] ?? 'all');
    $db->run('INSERT INTO restart_campaigns (created, title, text, deadline, target, mode, days, active, author) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
        [now_ms(), $title, str((string) ($b['text'] ?? ''), 500), $deadline, $target, $mode, $days, $who]);
    $id = $db->lastId();
    $db->audit($who, 'restart_start', "#$id $title → $target");
    return $id;
}
function restart_admin(Db $db, array $c, array $cfg): array
{
    $devs = array_values(array_filter($db->all('SELECT * FROM devices WHERE revoked = 0'), fn($d) => target_matches((string) $c['target'], $d)));
    $st = []; foreach ($db->all('SELECT * FROM restart_status WHERE campaign_id = ?', [$c['id']]) as $r) $st[$r['device_id']] = $r;
    $count = ['done' => 0, 'notneeded' => 0, 'open' => 0, 'snoozed' => 0, 'restarting' => 0, 'unknown' => 0];
    $rows = [];
    foreach ($devs as $d) {
        $r = $st[$d['id']] ?? null;
        $state = $r ? $r['state'] : 'unknown';
        $count[$state] = ($count[$state] ?? 0) + 1;
        $rows[] = ['name' => $d['name'], 'user' => $d['upn'] ?: $d['user'], 'state' => $state, 'snoozes' => $r ? (int) $r['snoozes'] : 0,
            'snoozeUntil' => $r ? (int) $r['snooze_until'] : 0, 'upDays' => $r ? (int) $r['up_days'] : null, 'updated' => $r ? (int) $r['updated'] : null, 'online' => is_online($d, $cfg)];
    }
    $order = ['open' => 0, 'snoozed' => 1, 'unknown' => 2, 'restarting' => 3, 'done' => 4, 'notneeded' => 5];
    usort($rows, fn($a, $b) => ($order[$a['state']] ?? 9) <=> ($order[$b['state']] ?? 9) ?: strcmp($a['name'], $b['name']));
    return ['id' => (int) $c['id'], 'title' => $c['title'], 'text' => (string) $c['text'], 'created' => (int) $c['created'], 'deadline' => $c['deadline'] ? (int) $c['deadline'] : null,
        'target' => $c['target'], 'mode' => $c['mode'], 'days' => (int) $c['days'], 'active' => (bool) $c['active'], 'ended' => $c['ended'] ? (int) $c['ended'] : null,
        'author' => $c['author'], 'total' => count($devs), 'count' => $count, 'devices' => $rows];
}
