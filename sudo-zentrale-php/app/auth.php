<?php
// auth.php – Notfall-Zugang (1.14): Passwort nur als Hash, zweiter Faktor (TOTP aus einer Authenticator-App),
// Freigabe nur für bestimmte Adressen, Sperre pro Adresse und für alle zusammen, kurze Sitzungen.
// Gleiche Antworten und Fehlermeldungen wie src/auth.js der Node-Version.
declare(strict_types=1);

const LOCAL_SESSION_HOURS = 2;             // Notfall-Sitzungen laufen schneller ab als Entra-Sitzungen (10 h)

/** Base32 (RFC 4648) wie in Authenticator-Apps; Leerzeichen, Bindestriche und „=“ werden ignoriert */
function b32_decode(string $s): string
{
    $s = strtoupper((string) preg_replace('/[\s=-]/', '', $s));
    $alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    for ($i = 0, $n = strlen($s); $i < $n; $i++) {
        $v = strpos($alpha, $s[$i]);
        if ($v === false) return '';
        $bits .= str_pad(decbin($v), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    for ($i = 0; $i + 8 <= strlen($bits); $i += 8) $out .= chr(bindec(substr($bits, $i, 8)));
    return $out;
}
function totp_code(string $key, int $step): string
{
    $h = hash_hmac('sha1', pack('J', $step), $key, true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}
/** Zeitschritt des passenden Codes (±30 Sekunden Spielraum) oder -1 */
function totp_step(string $secret, string $code, ?int $now = null): int
{
    $key = b32_decode($secret);
    $code = (string) preg_replace('/\s/', '', $code);
    if (strlen($key) < 10 || !preg_match('/^\d{6}$/', $code)) return -1;
    $t = intdiv($now ?? time(), 30);
    foreach ([0, -1, 1] as $d) if (hash_equals(totp_code($key, $t + $d), $code)) return $t + $d;
    return -1;
}

/** Liegt die Adresse in der Freigabeliste? Einträge: einzelne Adressen oder Netze (z. B. 203.0.113.0/24, 2001:db8::/32) */
function ip_allowed(string $ip, array $list): bool
{
    $ip = (string) preg_replace('/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i', '', $ip);
    $bin = @inet_pton($ip);
    if ($bin === false) return false;
    foreach ($list as $entry) {
        [$net, $len] = array_pad(explode('/', trim((string) $entry), 2), 2, null);
        $nb = @inet_pton((string) $net);
        if ($nb === false || strlen($nb) !== strlen($bin)) continue;
        $len = $len === null ? strlen($bin) * 8 : max(0, min(strlen($bin) * 8, (int) $len));
        $bytes = intdiv($len, 8);
        if (substr($bin, 0, $bytes) !== substr($nb, 0, $bytes)) continue;
        $rest = $len % 8;
        if ($rest === 0) return true;
        $mask = (0xff << (8 - $rest)) & 0xff;
        if ((ord($bin[$bytes]) & $mask) === (ord($nb[$bytes]) & $mask)) return true;
    }
    return false;
}

function password_hashed(string $s): bool { return str_starts_with($s, '$2y$') || str_starts_with($s, '$argon2'); }

/** Stand des Notfall-Zugangs für Verwaltung und Anmeldeseite */
function local_security(array $cfg): array
{
    $totp = (string) ($cfg['admin_totp'] ?? '');
    return ['local' => local_on($cfg), 'totp' => $totp !== '' && strlen(b32_decode($totp)) >= 10,
        'hashed' => password_hashed((string) ($cfg['admin_password'] ?? '')), 'ips' => !empty($cfg['local_login_ips'])];
}

function local_login(Db $db, array $cfg): never
{
    if (!local_on($cfg)) fail(404, 'Passwort-Anmeldung ist ausgeschaltet.');
    $ip = client_ip();
    $ips = array_values(array_filter((array) ($cfg['local_login_ips'] ?? []), 'strlen'));
    if ($ips && !ip_allowed($ip, $ips)) { $db->audit($ip, 'login_denied', 'notfall: adresse'); fail(403, 'Notfall-Zugang von dieser Adresse nicht erlaubt.'); }
    if (!$db->limit('login:alle', 30, 3600)) fail(429, 'Notfall-Zugang vorübergehend gesperrt (zu viele Versuche). In einer Stunde noch mal.');
    if (!$db->limit('login:' . $ip, 5, 900)) fail(429, 'Zu viele Versuche. In 15 Minuten noch mal.');
    $stored = (string) $cfg['admin_password'];
    if (!password_hashed($stored)) { $db->audit($ip, 'login_denied', 'notfall: klartext'); fail(403, 'Das Notfall-Passwort muss als Hash eingetragen sein (über /setup erzeugen).'); }
    $secret = (string) ($cfg['admin_totp'] ?? '');
    if ($secret !== '' && strlen(b32_decode($secret)) < 10) fail(403, 'Der zweite Faktor (admin_totp) ist ungültig eingetragen.');
    $b = body();
    $ok = password_verify((string) ($b['password'] ?? ''), $stored);
    $step = -1;
    if ($ok && $secret !== '') {
        $step = totp_step($secret, (string) ($b['code'] ?? ''));
        $ok = $step > (int) ($db->settings()['totp_last'] ?? 0);       // jeder Code nur einmal
    }
    if (!$ok) {
        usleep(700000);                                                 // bremst automatisches Durchprobieren
        $db->audit($ip, 'login_failed', 'notfall');
        fail(401, $secret !== '' ? 'Passwort oder Code falsch.' : 'Passwort falsch.');
    }
    if ($secret !== '') $db->setSetting('totp_last', (string) $step);
    create_session($db, $cfg, 'admin', 'Admin (Notfall-Zugang)', 'passwort', LOCAL_SESSION_HOURS);
    json_out(['ok' => true]);
}
