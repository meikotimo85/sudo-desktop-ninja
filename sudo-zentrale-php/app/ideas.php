<?php
// ideas.php – Ideen-Board (1.15): Wünsche von der Infoseite, Zustimmung per Klick, Mail an die IT.
// Gleiche Antworten und Fehlermeldungen wie src/ideas.js der Node-Version.
// Öffentlich sind nur freigegebene Ideen – Name und E-Mail der Einreichenden sieht nur die Verwaltung.
// Stimmen zählen je Browser (zufällige Kennung, gespeichert nur als Hash); IP-Adressen werden nicht gespeichert,
// sie dienen nur der kurzfristigen Begrenzung (rate_limits).
declare(strict_types=1);

const IDEA_STATES = ['neu', 'geplant', 'in_arbeit', 'umgesetzt', 'abgelehnt'];

function ideas_on(array $s): bool { return ($s['ideas_enabled'] ?? 'false') === 'true'; }

/** Liegt die Infoseite auf einer anderen Adresse, darf sie die Ideen nur mit Freigabe (Einstellung ideas_origins) abrufen */
function ideas_cors(array $s): void
{
    $o = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
    if ($o === '' || !in_array($o, ideas_origins($s), true)) return;
    header('Access-Control-Allow-Origin: ' . $o);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
}
function ideas_origins(array $s): array
{
    return array_values(array_filter(array_map(fn($x) => rtrim(trim($x), '/'), preg_split('/[\s,;]+/', (string) ($s['ideas_origins'] ?? '')) ?: [])));
}

// Steuerzeichen raus (bei mehrzeiligem Text bleiben Zeilenumbrüche), Länge begrenzen
function idea_line(string $v, int $max): string { return mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v) ?? ''), 0, $max); }
function idea_block(string $v, int $max): string
{
    $v = str_replace("\r\n", "\n", $v);
    $v = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', $v) ?? '';
    return mb_substr(trim(preg_replace("/\n{3,}/", "\n\n", $v) ?? ''), 0, $max);
}

function idea_public(array $i): array
{
    return ['id' => (int) $i['id'], 'title' => $i['title'], 'text' => $i['text'], 'status' => $i['status'], 'votes' => (int) $i['votes'],
        'answer' => (string) ($i['answer'] ?? ''), 'created' => (int) $i['created']];
}

/** Öffentliche Liste für die Infoseite */
function ideas_list(Db $db, array $s): array
{
    if (!ideas_on($s)) return ['enabled' => false, 'items' => []];
    return ['enabled' => true, 'items' => array_map('idea_public', $db->all('SELECT * FROM ideas WHERE public = 1 ORDER BY votes DESC, id DESC LIMIT 200'))];
}

function idea_submit(Db $db, array $cfg, array $s, array $b): array
{
    if (!ideas_on($s)) fail(403, 'Das Ideen-Board ist ausgeschaltet.');
    // Spam-Schutz ohne Captcha: verstecktes Feld bleibt leer, und niemand füllt das Formular in unter 3 Sekunden aus
    if (trim((string) ($b['website'] ?? '')) !== '' || (int) ($b['ms'] ?? 0) < 3000) fail(400, 'Das hat leider nicht geklappt. Bitte noch einmal versuchen.');
    $title = idea_line((string) ($b['title'] ?? ''), 80);
    $text = idea_block((string) ($b['text'] ?? ''), 2000);
    $name = idea_line((string) ($b['name'] ?? ''), 60);
    $mail = idea_line((string) ($b['email'] ?? ''), 120);
    if (mb_strlen($title) < 5) fail(400, 'Bitte einen Titel mit mindestens 5 Zeichen angeben.');
    if (mb_strlen($text) < 10) fail(400, 'Bitte die Idee in mindestens 10 Zeichen beschreiben.');
    if ($mail !== '' && !filter_var($mail, FILTER_VALIDATE_EMAIL)) fail(400, 'Die E-Mail-Adresse sieht nicht richtig aus.');
    if (!$db->limit('idea:' . client_ip(), 5, 3600)) fail(429, 'Zu viele Ideen auf einmal – bitte später noch einmal.');
    if (!$db->limit('idea:all', 50, 86400)) fail(429, 'Heute sind schon sehr viele Ideen eingegangen – bitte morgen noch einmal.');
    $pub = ($s['ideas_auto'] ?? 'false') === 'true' ? 1 : 0;
    $db->run('INSERT INTO ideas (created, updated, title, text, name, email, status, public, votes, answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        [now_ms(), now_ms(), $title, $text, $name !== '' ? $name : null, $mail !== '' ? $mail : null, 'neu', $pub, '']);
    $id = $db->lastId();
    $db->audit('Infoseite', 'idea_add', '#' . $id . ' ' . $title);
    idea_mail($cfg, $s, ['id' => $id, 'title' => $title, 'text' => $text, 'name' => $name, 'email' => $mail, 'public' => $pub]);
    return ['ok' => true, 'id' => $id, 'public' => $pub === 1,
        'message' => $pub ? 'Danke! Deine Idee steht jetzt auf der Liste.' : 'Danke! Deine Idee ist angekommen und erscheint nach einem kurzen Blick der IT auf der Liste.'];
}

/** Zustimmen (oder mit off: true zurücknehmen) – eine Stimme je Browser und Idee */
function idea_vote(Db $db, array $s, int $id, array $b): array
{
    if (!ideas_on($s)) fail(403, 'Das Ideen-Board ist ausgeschaltet.');
    $voter = (string) ($b['voter'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $voter)) fail(400, 'Ungültige Stimme.');
    $i = $db->get('SELECT id, status FROM ideas WHERE id = ? AND public = 1', [$id]) ?? fail(404, 'Diese Idee gibt es nicht (mehr).');
    if (in_array($i['status'], ['umgesetzt', 'abgelehnt'], true)) fail(409, 'Für diese Idee kann nicht mehr abgestimmt werden.');
    if (!$db->limit('vote:' . client_ip(), 60, 3600)) fail(429, 'Zu viele Stimmen – kurz warten.');
    $v = sha('idea|' . $voter);
    $had = (bool) $db->get('SELECT 1 FROM idea_votes WHERE idea_id = ? AND voter = ?', [$id, $v]);
    if (!empty($b['off'])) { if ($had) $db->run('DELETE FROM idea_votes WHERE idea_id = ? AND voter = ?', [$id, $v]); }
    elseif (!$had) $db->insertIgnore('idea_votes', ['idea_id' => $id, 'voter' => $v, 'created' => now_ms()]);
    $db->run('UPDATE ideas SET votes = (SELECT COUNT(*) FROM idea_votes WHERE idea_id = ?) WHERE id = ?', [$id, $id]);
    return ['ok' => true, 'votes' => (int) $db->get('SELECT votes FROM ideas WHERE id = ?', [$id])['votes'], 'voted' => empty($b['off'])];
}

/* ---------- Mail an die IT ----------
   PHP-Version: mail() des Webhosters. Für Tests (config.php „mail_dir“) landen Mails als Datei im Ordner. */
function idea_mail_ready(array $cfg): bool { return !empty($cfg['mail_dir']) || function_exists('mail'); }
function idea_mail(array $cfg, array $s, array $i): bool
{
    $to = (string) ($s['ideas_mail'] ?? '');
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $host = (string) (parse_url((string) $cfg['public_url'], PHP_URL_HOST) ?: 'localhost');
    $from = (string) ($cfg['mail_from'] ?? '') ?: 'sudo-zentrale@' . $host;
    $subject = 'Neue Idee für Sudo: ' . $i['title'];
    $body = implode("\r\n", [
        'Auf der Infoseite wurde eine neue Idee eingereicht.', '',
        'Titel: ' . $i['title'],
        'Von: ' . ($i['name'] !== '' ? $i['name'] : 'ohne Namen') . ($i['email'] !== '' ? ' <' . $i['email'] . '>' : ''),
        'Sichtbar: ' . ($i['public'] ? 'ja, sofort auf der Liste' : 'nein, wartet auf Freigabe'), '',
        str_replace("\n", "\r\n", $i['text']), '',
        'Verwaltung: ' . $cfg['public_url'] . '/admin/#ideas',
    ]);
    $headers = ['From' => 'Sudo-Zentrale <' . $from . '>', 'Content-Type' => 'text/plain; charset=UTF-8', 'Content-Transfer-Encoding' => '8bit', 'X-Mailer' => 'Sudo-Zentrale'];
    if ($i['email'] !== '') $headers['Reply-To'] = $i['email'];   // geprüfte Adresse, ohne Zeilenumbrüche
    $subj = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
    if (!empty($cfg['mail_dir'])) {
        $h = ''; foreach ($headers as $k => $v) $h .= "$k: $v\r\n";
        return (bool) @file_put_contents(rtrim((string) $cfg['mail_dir'], '/\\') . '/idee-' . $i['id'] . '.eml', "To: $to\r\nSubject: $subj\r\n$h\r\n$body");
    }
    if (!function_exists('mail')) return false;
    $ok = @mail($to, $subj, $body, $headers);
    if (!$ok) error_log('Sudo-Zentrale: Mail zur Idee #' . $i['id'] . ' konnte nicht verschickt werden.');
    return $ok;
}

/* ---------- Verwaltung ---------- */
function ideas_admin(Db $db, array $cfg): array
{
    $s = $db->settings();
    return ['mail' => ['to' => (string) ($s['ideas_mail'] ?? ''), 'ready' => idea_mail_ready($cfg)],
        'items' => array_map(fn($i) => idea_public($i) + ['name' => (string) ($i['name'] ?? ''), 'email' => (string) ($i['email'] ?? ''), 'public' => (int) $i['public'] === 1, 'updated' => (int) $i['updated']],
            $db->all('SELECT * FROM ideas ORDER BY public ASC, id DESC LIMIT 500'))];
}

function idea_patch(Db $db, int $id, array $b, string $who): void
{
    $i = $db->get('SELECT id, title FROM ideas WHERE id = ?', [$id]) ?? fail(404, 'Diese Idee gibt es nicht (mehr).');
    $set = [];
    if (array_key_exists('status', $b)) { if (!in_array($b['status'], IDEA_STATES, true)) fail(400, 'Unbekannter Stand.'); $set['status'] = $b['status']; }
    if (array_key_exists('public', $b)) $set['public'] = !empty($b['public']) ? 1 : 0;
    if (array_key_exists('answer', $b)) $set['answer'] = idea_block((string) $b['answer'], 500);
    if (array_key_exists('title', $b)) { $t = idea_line((string) $b['title'], 80); if (mb_strlen($t) < 5) fail(400, 'Bitte einen Titel mit mindestens 5 Zeichen angeben.'); $set['title'] = $t; }
    if (array_key_exists('text', $b)) { $t = idea_block((string) $b['text'], 2000); if (mb_strlen($t) < 10) fail(400, 'Bitte die Idee in mindestens 10 Zeichen beschreiben.'); $set['text'] = $t; }
    if (!$set) return;
    $set['updated'] = now_ms();
    $db->run('UPDATE ideas SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ' WHERE id = ?', [...array_values($set), $id]);
    $db->audit($who, 'idea_edit', '#' . $id . ' ' . $i['title'] . ' · ' . implode(', ', array_keys(array_diff_key($set, ['updated' => 1]))));
}

function idea_delete(Db $db, int $id, string $who): void
{
    $i = $db->get('SELECT id, title FROM ideas WHERE id = ?', [$id]) ?? fail(404, 'Diese Idee gibt es nicht (mehr).');
    $db->run('DELETE FROM idea_votes WHERE idea_id = ?', [$id]);
    $db->run('DELETE FROM ideas WHERE id = ?', [$id]);
    $db->audit($who, 'idea_delete', '#' . $id . ' ' . $i['title']);
}
