<?php
/**
 * Sudo-Relay – gemeinsame Funktionen
 */
declare(strict_types=1);

const RELAY_VERSION = '1.0';
const RELAY_TYPES   = ['backup_failed', 'server_down', 'deploy_ok', 'ticket', 'bug', 'message', 'success', 'warning'];
const RELAY_FIELDS  = ['text', 'kunde', 'host', 'version', 'ticket', 'titel'];

function relayConfig(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/config.php';
    }
    return $cfg;
}

function relayJson(int $status, array $data): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Ein Token gilt nur, wenn es geändert wurde und lang genug ist */
function relayTokenUsable(string $token): bool
{
    return strlen($token) >= 24 && !str_starts_with($token, 'BITTE-AENDERN');
}

/** Token aus Header (X-Sudo-Token oder Authorization: Bearer) oder Feld "token" */
function relayRequestToken(array $body = []): string
{
    $t = $_SERVER['HTTP_X_SUDO_TOKEN'] ?? '';
    if ($t === '' && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) {
        $t = $m[1];
    }
    if ($t === '') {
        $t = (string)($body['token'] ?? $_GET['token'] ?? '');
    }
    return trim($t);
}

function relayRequireToken(string $which, array $body = []): void
{
    $expected = (string)(relayConfig()[$which] ?? '');
    if (!relayTokenUsable($expected)) {
        relayJson(503, ['ok' => false, 'error' => 'Relay ist noch nicht eingerichtet: Tokens in config.php setzen.']);
    }
    $given = relayRequestToken($body);
    if ($given === '' || !hash_equals($expected, $given)) {
        usleep(300000); // bremst Rateversuche
        relayJson(401, ['ok' => false, 'error' => 'Token ungültig']);
    }
}

/**
 * Speicher lesen und optional ändern – mit Dateisperre, damit gleichzeitige Aufrufe nichts verlieren.
 * @param callable|null $change  fn(array $store): array
 */
function relayStore(?callable $change = null): array
{
    $dir = __DIR__ . '/data';
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        relayJson(500, ['ok' => false, 'error' => 'Ordner data/ kann nicht angelegt werden (Schreibrechte prüfen).']);
    }
    $file = $dir . '/events.json';
    $fh = fopen($file, 'c+');
    if (!$fh) {
        relayJson(500, ['ok' => false, 'error' => 'data/events.json kann nicht geöffnet werden.']);
    }
    flock($fh, $change ? LOCK_EX : LOCK_SH);
    $raw = stream_get_contents($fh);
    $store = json_decode($raw ?: '', true);
    if (!is_array($store)) {
        $store = ['lastId' => 0, 'events' => []];
    }
    if ($change) {
        $store = $change($store);
        $cfg = relayConfig();
        $minTime = time() - 86400 * (int)$cfg['keep_days'];
        $store['events'] = array_values(array_filter($store['events'], fn($e) => $e['at'] >= $minTime));
        $store['events'] = array_slice($store['events'], -(int)$cfg['max_events']);
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($store, JSON_UNESCAPED_UNICODE));
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $store;
}

/** Eingaben lesen: JSON oder normales Formular */
function relayBody(): array
{
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($type, 'application/json') !== false) {
        $raw = file_get_contents('php://input', false, null, 0, 16384);
        $data = json_decode($raw ?: '', true);
        return is_array($data) ? $data : [];
    }
    return $_POST;
}
