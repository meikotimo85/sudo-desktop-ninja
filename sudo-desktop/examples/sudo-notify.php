<?php
/**
 * sudo-notify.php – schickt Ereignisse an Sudo (Desktop-Ninja)
 *
 * Sudo lauscht nur lokal auf http://127.0.0.1:4711/event.
 * Das Skript muss also auf demselben Rechner laufen wie Sudo
 * (z. B. lokales PHP, XAMPP oder ein geplanter Task).
 */
declare(strict_types=1);

function sudoNotify(string $type, array $data = []): bool
{
    $ch = curl_init('http://127.0.0.1:4711/event');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['type' => $type] + $data, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_TIMEOUT        => 2,
    ]);
    $antwort = curl_exec($ch);
    $status  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $antwort !== false && $status === 200;
}

// Mögliche Ereignisse:
// backup_failed  – Felder: kunde, text
// server_down    – Felder: host, text
// deploy_ok      – Felder: version
// ticket         – Felder: ticket, titel
// warning        – Felder: text
// success        – Felder: text
// message        – Felder: text
// bug            – keine Felder

if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    $ok = sudoNotify('backup_failed', ['kunde' => 'Muster GmbH']);
    echo $ok ? "Sudo hat das Ereignis bekommen.\n" : "Sudo nicht erreichbar. Läuft die App?\n";
}
