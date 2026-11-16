<?php
// rules.php – Regeln (1.7): Die Zentrale ordnet eingehende Meldungen der Schnittstelle selbst ein.
// Beispiel: Ticket „Datensicherung Failed Muster GmbH“ → backup_failed mit kunde = „Muster GmbH“.
// Gleiche Logik wie src/rules.js der Node-Version.
declare(strict_types=1);

const RULE_ACTIONS = ['backup_failed', 'server_down', 'warning', 'message', 'success', 'deploy_ok', 'ticket', 'drop'];
const RULE_EXTRACT = ['rest', 'paren', 'regex', 'whole'];
// Hauptfeld je Meldungsart: dorthin kommt der erkannte Name (Kunde, Server …)
const RULE_MAIN = ['backup_failed' => 'kunde', 'server_down' => 'host', 'deploy_ok' => 'version', 'warning' => 'text', 'message' => 'text', 'success' => 'text', 'ticket' => 'titel'];
// Füllwörter, die beim „Rest des Titels“ wegfallen
const RULE_FILLER = ['job', 'jobs', 'auf', 'bei', 'für', 'fuer', 'von', 'beim', 'mit', 'der', 'die', 'das', 'des', 'ist', 'wurde', 'status', 'meldung', 'alarm', 'alert', 'ticket', 'kunde', 'kunden', 'customer'];

function rule_defaults(): array
{
    return [
        ['Backup fehlgeschlagen', 'backup|datensicherung|sicherung|veeam|acronis|avepoint|synology hyper backup',
            'failed|fehlgeschlagen|fehler|error|abgebrochen|nicht erfolgreich|warning|warnung', 'backup_failed'],
        ['Server oder Dienst nicht erreichbar', 'server|host|dienst|service|vpn|firewall|website|webseite|nas|switch|drucker',
            'down|offline|nicht erreichbar|ausgefallen|unreachable|antwortet nicht|no response', 'server_down'],
        ['Zertifikat läuft ab', 'zertifikat|certificate|ssl|tls', 'läuft ab|laeuft ab|abgelaufen|expire|expiring|expiry', 'warning'],
    ];
}
function rules_seed(Db $db): void
{
    if ((int) $db->get('SELECT COUNT(*) AS n FROM rules')['n'] > 0) return;
    foreach (rule_defaults() as $i => [$name, $a, $b, $act]) {
        $db->run('INSERT INTO rules (pos, name, active, match_type, field, mode, pattern, action, extract, target, dur, ttl, link_tpl, hits, created, updated)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)', [($i + 1) * 10, $name, '', 'title', 'words', "$a, $b", $act, 'rest', '', '', '', now_ms(), now_ms()]);
    }
}

function rule_main_text(array $ev): string
{
    foreach (['titel', 'text', 'kunde', 'host', 'version'] as $k) if (isset($ev[$k]) && trim((string) $ev[$k]) !== '') return trim((string) $ev[$k]);
    return '';
}
// Wörter-Muster: Gruppen mit Komma getrennt (alle müssen passen), Alternativen mit | (eine reicht)
function rule_groups(string $pattern): array
{
    $g = [];
    foreach (explode(',', $pattern) as $part) {
        $alts = array_values(array_filter(array_map(fn($w) => mb_strtolower(trim($w)), explode('|', $part)), 'strlen'));
        if ($alts) $g[] = $alts;
    }
    return $g;
}
function rule_regex(string $p): ?string
{
    $re = '~' . str_replace('~', '\~', $p) . '~iu';
    return @preg_match($re, '') === false ? null : $re;
}
// Passt die Regel? Gibt die Treffer zurück (Wörter oder Regex-Gruppen), sonst null
function rule_match(array $r, array $ev): ?array
{
    if ($r['match_type'] !== '' && $r['match_type'] !== $ev['type']) return null;
    $hay = $r['field'] === 'any'
        ? implode(' ', array_map('strval', array_filter($ev, fn($v, $k) => $k !== 'type' && is_scalar($v), ARRAY_FILTER_USE_BOTH)))
        : rule_main_text($ev);
    if ($hay === '') return null;
    if ($r['mode'] === 'regex') {
        $re = rule_regex((string) $r['pattern']);
        return $re && preg_match($re, $hay, $m) ? ['regex' => $m] : null;
    }
    $low = mb_strtolower($hay);
    $hits = [];
    foreach (rule_groups((string) $r['pattern']) as $alts) {
        $found = array_values(array_filter($alts, fn($w) => mb_strpos($low, $w) !== false));   // alle vorkommenden Wörter (für „Rest des Titels“)
        if (!$found) return null;
        array_push($hits, ...$found);
    }
    return $hits ? ['words' => $hits] : null;
}
// Den Namen (Kunde, Server …) aus dem Titel holen
function rule_extract(array $r, array $ev, array $m): string
{
    $t = rule_main_text($ev);
    switch ($r['extract']) {
        case 'whole': return $t;
        case 'paren': return preg_match('~\(([^()]+)\)\s*$~u', $t, $p) ? trim($p[1]) : $t;
        case 'regex': return isset($m['regex'][1]) && trim($m['regex'][1]) !== '' ? trim($m['regex'][1]) : $t;
    }
    // Rest: Wörter mit Treffer (ganzes Wort, z. B. „Datensicherung“ für „sicherung“) und Füllwörter entfernen
    $s = $t;
    $ws = $m['words'] ?? []; usort($ws, fn($a, $b) => mb_strlen($b) <=> mb_strlen($a));
    foreach ($ws as $w) {
        $q = preg_quote($w, '~');
        $s = (string) preg_replace(str_contains($w, ' ') ? "~$q~iu" : "~[\\p{L}\\p{N}_-]*$q\\p{L}*~iu", ' ', $s);
    }
    $s = (string) preg_replace('~#\d+~u', ' ', $s);                                  // Ticketnummern
    $s = (string) preg_replace('~[\[(]\s*[\])]~u', ' ', $s);                         // leere Klammern
    $words = preg_split('~\s+~u', $s) ?: [];
    $words = array_filter($words, fn($w) => $w !== '' && !in_array(mb_strtolower(trim($w, ':-–|/.,;')), RULE_FILLER, true) && trim($w, ':-–|/.,;') !== '');
    $s = trim(implode(' ', $words), " \t:-–|/.,;");
    return $s !== '' ? $s : $t;
}
// Regel anwenden: neue Meldung bauen (nur erlaubte Felder), null = verwerfen
function rule_apply(array $r, array $ev, array $m, array $s): ?array
{
    if ($r['action'] === 'drop') return null;
    $type = $r['action'];
    $main = RULE_MAIN[$type] ?? 'text';
    $t = rule_main_text($ev);
    $val = $r['extract'] === 'whole' && in_array($type, ['backup_failed', 'server_down', 'deploy_ok'], true) ? $t : rule_extract($r, $ev, $m);
    $out = ['type' => $type, $main => mb_substr(in_array($main, ['text', 'titel'], true) && $r['extract'] === 'rest' ? $t : $val, 0, 240)];
    if ($type === 'server_down') $out['text'] = !empty($ev['ticket']) ? 'Ticket #' . $ev['ticket'] : mb_substr($t, 0, 240);
    if ($main === 'text' && !empty($ev['ticket']) && !str_contains($out['text'], (string) $ev['ticket'])) $out['text'] = mb_substr('Ticket #' . $ev['ticket'] . ': ' . $out['text'], 0, 240);
    if (!empty($ev['ticket'])) $out['ticket'] = (string) $ev['ticket'];
    if ($type === 'ticket' && empty($out['ticket'])) $out['ticket'] = '–';
    // Link: aus der Meldung, sonst aus der Vorlage der Regel bzw. der globalen Ticket-Vorlage
    $tpl = (string) ($r['link_tpl'] ?: ($s['ticket_link'] ?? ''));
    if (!empty($ev['link'])) $out['link'] = $ev['link'];
    elseif ($tpl !== '' && !empty($ev['ticket'])) $out['link'] = str_replace('{ticket}', rawurlencode((string) $ev['ticket']), $tpl);
    if ($r['dur'] !== '' && $r['dur'] !== null) $out['dur'] = $r['dur'];
    elseif (isset($ev['dur'])) $out['dur'] = $ev['dur'];
    return $out;
}
// Alle aktiven Regeln der Reihe nach, die erste passende gewinnt
function rules_run(Db $db, array $ev, array $s, bool $count = true): array
{
    foreach ($db->all('SELECT * FROM rules WHERE active = 1 ORDER BY pos, id') as $r) {
        $m = rule_match($r, $ev);
        if ($m === null) continue;
        if ($count) $db->run('UPDATE rules SET hits = hits + 1, last_hit = ? WHERE id = ?', [now_ms(), $r['id']]);
        return ['rule' => $r, 'event' => rule_apply($r, $ev, $m, $s)];
    }
    return ['rule' => null, 'event' => $ev];
}
function rule_public(array $r): array
{
    return ['id' => (int) $r['id'], 'pos' => (int) $r['pos'], 'name' => $r['name'], 'active' => (bool) $r['active'], 'matchType' => $r['match_type'], 'field' => $r['field'],
        'mode' => $r['mode'], 'pattern' => $r['pattern'], 'action' => $r['action'], 'extract' => $r['extract'], 'target' => $r['target'], 'dur' => $r['dur'],
        'ttl' => $r['ttl'] !== null ? (int) $r['ttl'] : null, 'linkTpl' => (string) $r['link_tpl'], 'hits' => (int) $r['hits'], 'lastHit' => $r['last_hit'] ? (int) $r['last_hit'] : null];
}
// Eingaben aus der Verwaltung prüfen
function rule_clean(array $b): array
{
    $name = trim(str((string) ($b['name'] ?? ''), 80));
    if ($name === '') fail(400, 'Bitte der Regel einen Namen geben.');
    $mode = ($b['mode'] ?? 'words') === 'regex' ? 'regex' : 'words';
    $pattern = trim(str((string) ($b['pattern'] ?? ''), 500));
    if ($pattern === '') fail(400, 'Bitte angeben, woran die Meldung erkannt wird.');
    if ($mode === 'regex' && !rule_regex($pattern)) fail(400, 'Der reguläre Ausdruck ist ungültig.');
    if ($mode === 'words' && !rule_groups($pattern)) fail(400, 'Bitte mindestens ein Wort angeben.');
    $action = in_array($b['action'] ?? '', RULE_ACTIONS, true) ? $b['action'] : fail(400, 'Unbekannte Aktion.');
    $mt = (string) ($b['matchType'] ?? '');
    if ($mt !== '' && !in_array($mt, EVENT_TYPES, true)) fail(400, 'Unbekannte Meldungsart.');
    $target = trim((string) ($b['target'] ?? ''));
    if ($target !== '' && valid_target($target) !== $target) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    $dur = (string) ($b['dur'] ?? '');
    if ($dur !== '' && $dur !== 'klick' && !(ctype_digit($dur) && $dur >= 5 && $dur <= 120)) fail(400, 'Anzeigedauer: 5 bis 120 Sekunden oder „klick“.');
    $ttl = isset($b['ttl']) && $b['ttl'] !== '' && $b['ttl'] !== null ? max(1, min(10080, (int) $b['ttl'])) : null;
    $link = trim((string) ($b['linkTpl'] ?? ''));
    if ($link !== '' && !preg_match('~^https://\S{3,300}$~', $link)) fail(400, 'Die Link-Vorlage muss mit https:// beginnen.');
    return ['name' => $name, 'active' => !empty($b['active']) || !isset($b['active']) ? 1 : 0, 'match_type' => $mt, 'field' => ($b['field'] ?? 'title') === 'any' ? 'any' : 'title',
        'mode' => $mode, 'pattern' => $pattern, 'action' => $action, 'extract' => in_array($b['extract'] ?? '', RULE_EXTRACT, true) ? $b['extract'] : 'rest',
        'target' => $target, 'dur' => $dur, 'ttl' => $ttl, 'link_tpl' => $link];
}
