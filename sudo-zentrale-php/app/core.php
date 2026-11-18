<?php
// core.php – Helfer: Antworten, Anfragen, Geräte, Meldungen, Admin-Anmeldung (Entra ID / Passwort)
declare(strict_types=1);

const APP_VERSION = '1.14.0';
const VISIT_KINDS = ['note', 'coffee', 'duck', 'pizza', 'confetti', 'bug', 'duel'];
const EVENT_TYPES = ['backup_failed', 'server_down', 'deploy_ok', 'ticket', 'bug', 'message', 'success', 'warning', 'video', 'music'];

function json_out($data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(int $code, string $message): never { json_out(['message' => $message], $code); }
function body(): array
{
    static $b = null;
    if ($b === null) { $raw = file_get_contents('php://input', false, null, 0, 262144) ?: ''; $b = json_decode($raw, true); if (!is_array($b)) $b = []; }
    return $b;
}
function bearer(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) { foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') $h = $v; }
    return stripos($h, 'Bearer ') === 0 ? trim(substr($h, 7)) : '';
}
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }
function str(?string $v, int $max): string { return mb_substr(trim((string) $v), 0, $max); }

/* ---------- Geräte & Meldungen ---------- */
function device_from(Db $db): ?array
{
    $t = bearer();
    return $t === '' ? null : $db->get('SELECT * FROM devices WHERE token_hash = ? AND revoked = 0', [sha($t)]);
}
function groups_of(array $d): array { return array_values(array_filter(array_map('trim', explode(',', (string) $d['groups_'])), 'strlen')); }
// Ziele: all · group:<Gruppe> · device:<Name oder ID> · user:<Anmeldename/E-Mail oder Windows-Benutzer> (1.5)
const TARGET_RE = '/^(all|group:[\w .-]{1,40}|device:[\w .-]{1,60}|user:[\w .@+\'-]{1,120})$/iu';
function valid_target($t): string { return is_string($t) && preg_match(TARGET_RE, trim($t)) ? trim($t) : 'all'; }
function target_matches(string $target, array $dev): bool
{
    if ($target === '' || $target === 'all') return true;
    if (str_starts_with($target, 'group:')) return in_array(mb_strtolower(substr($target, 6)), array_map('mb_strtolower', groups_of($dev)), true);
    if (str_starts_with($target, 'device:')) { $v = mb_strtolower(substr($target, 7)); return $dev['id'] === $v || mb_strtolower($dev['name']) === $v; }
    if (str_starts_with($target, 'user:')) return user_matches(mb_strtolower(trim(substr($target, 5))), $dev);
    return false;
}
// Person: mit @ → Anmeldename (UPN) des Geräts; ohne @ → Windows-Benutzer oder der Teil vor dem @ des Anmeldenamens
function user_matches(string $v, array $dev): bool
{
    if ($v === '') return false;
    $upn = mb_strtolower((string) ($dev['upn'] ?? '')); $win = mb_strtolower((string) ($dev['user'] ?? ''));
    if (str_contains($v, '@')) return $upn === $v || ($upn === '' && $win !== '' && $win === explode('@', $v)[0]);
    return $win === $v || ($upn !== '' && explode('@', $upn)[0] === $v);
}
function clean_upn($v): ?string { $v = mb_strtolower(trim((string) $v)); return preg_match('#^[^\s@\\\\/]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$#', $v) ? $v : null; }
function clean_event(array $raw): ?array
{
    $type = trim((string) ($raw['type'] ?? ''));
    if (!in_array($type, EVENT_TYPES, true)) return null;
    $out = ['type' => $type]; $n = 0;
    foreach ($raw as $k => $v) {
        if (in_array($k, ['type', 'target', 'ttl_min'], true) || !preg_match('/^[a-z_]{1,24}$/i', (string) $k)) continue;
        if (!is_string($v) && !is_int($v) && !is_float($v)) continue;
        if (++$n > 12) break;
        $out[$k] = mb_substr(preg_replace('/[\x00-\x09\x0b-\x1f]/u', '', (string) $v), 0, 240);
    }
    return $out;
}
function online_window(array $cfg): int { return max(30, (int) ($cfg['poll_seconds'] ?? 15) * 3) * 1000; }
function is_online(array $dev, array $cfg): bool { return $dev['last_seen'] && now_ms() - (int) $dev['last_seen'] < online_window($cfg); }

function publish(Db $db, array $cfg, array $event, string $target = 'all', $ttlMin = null, ?string $author = null): array
{
    $s = $db->settings();
    $ttl = max(1, min(7 * 1440, (int) ($ttlMin ?: $s['message_ttl_min'] ?: 1440)));
    $db->run('INSERT INTO messages (created, expires, type, payload, target, author) VALUES (?, ?, ?, ?, ?, ?)',
        [now_ms(), now_ms() + $ttl * 60000, $event['type'], json_encode($event, JSON_UNESCAPED_UNICODE), $target, $author]);
    $id = $db->lastId();
    $devs = array_filter($db->all('SELECT * FROM devices WHERE revoked = 0'), fn($d) => target_matches($target, $d));
    $online = count(array_filter($devs, fn($d) => is_online($d, $cfg)));
    // Kein Push möglich (Webspace): die Sudos holen die Meldung beim nächsten Abruf ab
    $r = ['id' => $id, 'sentNow' => $online, 'targets' => count($devs)];
    if (!$devs && $target !== 'all') $r['hint'] = 'Kein Gerät passt zu „' . $target . '“. Bei user: bitte den Anmeldenamen prüfen (Zentrale → Geräte, zweite Zeile). Bereits registrierte Geräte, die sich in den nächsten ' . $ttl . ' min passend melden, bekommen die Meldung noch.';
    return $r;
}
function pending_for(Db $db, array $dev): array
{
    // Erst nach Ziel filtern, dann auf 30 begrenzen. (Bis 1.7.0 umgekehrt: Lagen über 30 Meldungen für andere
    // Empfänger in der Warteschlange – z. B. Tickets an Personen ohne Gerät –, bekam ein Gerät gar nichts mehr.)
    $rows = $db->all('SELECT m.* FROM messages m WHERE m.expires > ? AND m.created >= ?
        AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id = m.id AND d.device_id = ?) ORDER BY m.id LIMIT 2000',
        [now_ms(), (int) $dev['created'], $dev['id']]);
    return array_slice(array_values(array_filter($rows, fn($m) => target_matches((string) $m['target'], $dev))), 0, 30);
}
// Name auf dem Namensschild des Gast-Ninjas
function visit_name(array $d): string { return (string) ($d['visit_name'] ?: $d['user'] ?: $d['name']); }
function visits_public(array $s, Db $db, array $d): array
{
    $sent = (int) $db->get('SELECT COUNT(*) AS n FROM visits WHERE day = ? AND from_id = ?', [day_key(), $d['id']])['n'];
    return ['enabled' => $s['visits_enabled'] === 'true', 'sendLeft' => max(0, (int) $s['visits_send_per_day'] - $sent), 'sendMax' => (int) $s['visits_send_per_day']];
}
// 1.5: Vorgaben für Gerätezustand und Quiz, die jeder Sudo bei jedem Abruf bekommt
function health_public(array $s): array { return ['report' => ($s['health_report'] ?? 'true') === 'true']; }
function quiz_public(array $s, Db $db): array
{
    $r = $db->get('SELECT COUNT(*) AS n, COALESCE(MAX(updated), 0) AS u FROM quiz_questions WHERE active = 1');
    return ['enabled' => ($s['quiz_enabled'] ?? 'true') === 'true', 'perWeek' => max(1, min(7, (int) ($s['quiz_per_week'] ?? 2))), 'rev' => (int) $r['n'] . '-' . (int) $r['u']];
}
// Gerätezustand vom Sudo: nur bekannte Felder, nur Ampelwerte und kleine Zahlen
function clean_health($h): ?array
{
    if (!is_array($h)) return null;
    $st = fn($v) => in_array($v, ['ok', 'warn', 'bad', 'unknown'], true) ? $v : 'unknown';
    $items = [];
    foreach (['bitlocker', 'av', 'fw', 'updates', 'reboot', 'disk'] as $k) $items[$k] = $st($h['i'][$k] ?? 'unknown');
    $int = fn($v) => is_numeric($v) ? max(0, min(100000, (int) $v)) : null;
    return ['s' => $st($h['s'] ?? 'unknown'), 'i' => $items, 'updDays' => $int($h['updDays'] ?? null), 'upDays' => $int($h['upDays'] ?? null),
        'disk' => $int($h['disk'] ?? null), 'av' => mb_substr(strip_tags((string) ($h['av'] ?? '')), 0, 60)];
}
// 1.9: Diagnose des Clients – nur Zahlen und ein gekürzter Fehlertext
function clean_diag($d): ?array
{
    if (!is_array($d)) return null;
    $num = fn($v, $max) => is_numeric($v) ? max(0, min($max, round((float) $v, 1))) : null;
    return ['cpu' => $num($d['cpu'] ?? null, 1000), 'ram' => $num($d['ram'] ?? null, 100000), 'crashes' => (int) $num($d['crashes'] ?? 0, 1000),
        'errors' => (int) $num($d['errors'] ?? 0, 100000), 'up' => $num($d['up'] ?? null, 100000), 'last' => mb_substr(strip_tags((string) ($d['last'] ?? '')), 0, 220)];
}
// 1.9: Was die Zentrale von Microsoft Entra braucht – liest Sudo-Entra-Setup.ps1, damit das Setup auch künftige Versionen
// ohne Änderung einrichtet. Enthält keine Geheimnisse. Neue Funktionen hier ergänzen (Berechtigungen, Einstellungsnamen).
function entra_manifest(array $cfg): array
{
    return ['manifest' => 1, 'zentrale' => APP_VERSION, 'publicUrl' => $cfg['public_url'], 'app' => ['name' => 'Sudo-Zentrale', 'tag' => 'SudoZentrale'],
        'features' => [
            'kb' => ['title' => 'Wissen aus SharePoint (Anleitungen)', 'graph' => ['application' => ['Sites.Selected'], 'delegated' => []], 'siteRole' => 'read',
                'settings' => ['tenant' => 'kb_tenant', 'clientId' => 'kb_client_id', 'secret' => 'kb_client_secret', 'enable' => 'kb_enabled'],
                'test' => '/admin/api/kb/test', 'addSource' => '/admin/api/kb/sources'],
            'login' => ['title' => 'Anmeldung an der Verwaltung mit Microsoft', 'graph' => ['application' => [], 'delegated' => ['openid', 'profile', 'email']],
                'redirect' => '/auth/callback', 'groupClaims' => true, 'config' => 'php'],
        ]];
}
// Geheime Einstellungen, die nie an den Browser gehen
const SECRET_SETTINGS = ['spotify_client_secret', 'spotify_refresh', 'spotify_access', 'spotify_state', 'kb_client_secret', 'kb_token'];
function quiz_question_public(array $q): array
{
    return ['id' => 'c' . $q['id'], 'q' => $q['q'], 'a' => json_decode($q['answers'], true) ?: [], 'ok' => (int) $q['ok'], 'why' => (string) $q['why'], 'link' => (string) $q['link']];
}

function clean_note(string $t): string
{
    $t = preg_replace('/[\x00-\x1f\x7f]/u', ' ', strip_tags($t));
    return mb_substr(trim(preg_replace('/\s+/u', ' ', $t)), 0, 60);
}
function ai_public(array $s): array
{
    return ['enabled' => $s['ai_enabled'] === 'true', 'models' => explode(',', $s['ai_models']), 'context' => $s['ai_context'] === 'true'];
}

/* ---------- Admin-Anmeldung ---------- */
function app_secret(): string
{
    $f = dirname(__DIR__) . '/data/.secret';
    if (is_file($f)) return trim((string) file_get_contents($f));
    $s = token(48);
    @file_put_contents($f, $s);
    @chmod($f, 0600);
    return $s;
}
function is_https(array $cfg): bool { return str_starts_with($cfg['public_url'], 'https://'); }
function set_cookie(array $cfg, string $name, string $value, int $maxAge): void
{
    setcookie($name, $value, ['expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600, 'path' => '/', 'secure' => is_https($cfg), 'httponly' => true, 'samesite' => 'Lax']);
}
function signed(string $v): string { return $v . '.' . hash_hmac('sha256', $v, app_secret()); }
function unsign(?string $v): ?string
{
    if (!$v || !str_contains($v, '.')) return null;
    $i = strrpos($v, '.'); $raw = substr($v, 0, $i);
    return hash_equals(hash_hmac('sha256', $raw, app_secret()), substr($v, $i + 1)) ? $raw : null;
}
function entra_on(array $cfg): bool { $e = $cfg['entra'] ?? []; return !empty($e['tenant']) && !empty($e['client_id']) && !empty($e['client_secret']); }
function local_on(array $cfg): bool { return !empty($cfg['admin_password']) && (!empty($cfg['local_login']) || !entra_on($cfg)); }

function create_session(Db $db, array $cfg, string $user, ?string $name, string $via, int $hours = 10): void
{
    $id = token(32);
    $db->run('INSERT INTO sessions (id, user, name, via, csrf, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sha($id), $user, $name ?: $user, $via, token(24), now_ms(), now_ms() + $hours * 3600e3]);
    set_cookie($cfg, 'sz_sess', signed($id), $hours * 3600);
    $db->audit($user, 'login', $via);
}
function current_session(Db $db): ?array
{
    $id = unsign($_COOKIE['sz_sess'] ?? null);
    return $id ? $db->get('SELECT * FROM sessions WHERE id = ? AND expires > ?', [sha($id), now_ms()]) : null;
}

function entra_start(array $cfg): never
{
    $state = token(18); $nonce = token(18); $verifier = token(48);
    $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    set_cookie($cfg, 'sz_oidc', signed(base64_encode(json_encode(['state' => $state, 'nonce' => $nonce, 'verifier' => $verifier, 't' => time()]))), 600);
    $q = http_build_query(['client_id' => $cfg['entra']['client_id'], 'response_type' => 'code', 'redirect_uri' => $cfg['public_url'] . '/auth/callback',
        'response_mode' => 'query', 'scope' => 'openid profile email', 'state' => $state, 'nonce' => $nonce,
        'code_challenge' => $challenge, 'code_challenge_method' => 'S256', 'prompt' => 'select_account']);
    header('Location: https://login.microsoftonline.com/' . rawurlencode($cfg['entra']['tenant']) . '/oauth2/v2.0/authorize?' . $q, true, 302);
    exit;
}
function entra_callback(Db $db, array $cfg): never
{
    $back = function (string $msg) use ($cfg): never { header('Location: ' . $cfg['public_url'] . '/admin/?fehler=' . rawurlencode($msg), true, 302); exit; };
    $raw = unsign($_COOKIE['sz_oidc'] ?? null);
    set_cookie($cfg, 'sz_oidc', '', -1);
    $st = $raw ? json_decode((string) base64_decode($raw), true) : null;
    if (!$st) $back('Anmeldung abgelaufen, bitte noch einmal.');
    if (!empty($_GET['error'])) $back('Microsoft meldet: ' . mb_substr((string) ($_GET['error_description'] ?? $_GET['error']), 0, 200));
    if (empty($_GET['code']) || !hash_equals($st['state'], (string) ($_GET['state'] ?? '')) || time() - $st['t'] > 600) $back('Anmeldung ungültig oder abgelaufen.');
    $tenant = $cfg['entra']['tenant'];
    $ch = curl_init('https://login.microsoftonline.com/' . rawurlencode($tenant) . '/oauth2/v2.0/token');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_POSTFIELDS => http_build_query(['client_id' => $cfg['entra']['client_id'], 'client_secret' => $cfg['entra']['client_secret'],
            'grant_type' => 'authorization_code', 'code' => (string) $_GET['code'], 'redirect_uri' => $cfg['public_url'] . '/auth/callback',
            'code_verifier' => $st['verifier'], 'scope' => 'openid profile email'])]);
    $res = json_decode((string) curl_exec($ch), true);
    curl_close($ch);
    if (empty($res['id_token'])) { error_log('Sudo-Zentrale Entra: ' . json_encode($res)); $back('Token-Abruf fehlgeschlagen.'); }
    // ID-Token kommt direkt per TLS vom Token-Endpunkt (OIDC Core 3.1.3.7) – Inhalt wird geprüft
    $parts = explode('.', $res['id_token']);
    $c = json_decode((string) base64_decode(strtr($parts[1] ?? '', '-_', '+/')), true) ?: [];
    $issOk = ($c['tid'] ?? '') === $tenant && ($c['iss'] ?? '') === "https://login.microsoftonline.com/$tenant/v2.0";
    if (!$issOk || ($c['aud'] ?? '') !== $cfg['entra']['client_id'] || !hash_equals($st['nonce'], (string) ($c['nonce'] ?? '')) || ($c['exp'] ?? 0) < time()) $back('ID-Token passt nicht.');
    $user = mb_strtolower((string) ($c['preferred_username'] ?? $c['email'] ?? $c['upn'] ?? ''));
    $admins = array_map('mb_strtolower', $cfg['admin_users'] ?? []);
    $groups = is_array($c['groups'] ?? null) ? $c['groups'] : [];
    if (!in_array($user, $admins, true) && !($cfg['admin_group'] && in_array($cfg['admin_group'], $groups, true))) {
        $db->audit($user, 'login_denied', 'entra');
        $back(($user ?: 'Dieses Konto') . ' ist kein Admin der Sudo-Zentrale.');
    }
    create_session($db, $cfg, $user, $c['name'] ?? $user, 'entra');
    header('Location: ' . $cfg['public_url'] . '/admin/', true, 302);
    exit;
}
