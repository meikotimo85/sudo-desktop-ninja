<?php
/**
 * sudo-relay-notify.php – Ereignisse von deinem Server an Sudo schicken (über das Relay)
 *
 * In deine Projekte einbinden (z. B. Backup-Prüfung, Monitoring, Deploy-Skript):
 *   require_once __DIR__ . '/sudo-relay-notify.php';
 *   sudoRelay('backup_failed', ['kunde' => 'Muster GmbH']);
 */
declare(strict_types=1);

const SUDO_RELAY_URL   = 'https://deine-domain.de/sudo-relay'; // ohne Schrägstrich am Ende
const SUDO_RELAY_TOKEN = 'HIER-DEN-SEND-TOKEN-EINTRAGEN';     // send_token aus der config.php des Relays

/**
 * @param string $type  backup_failed | server_down | deploy_ok | ticket | warning | success | message | bug
 * @param array  $data  optionale Felder: kunde, host, version, ticket, titel, text (je max. 120 Zeichen)
 * @return bool         true, wenn das Relay das Ereignis angenommen hat
 */
function sudoRelay(string $type, array $data = []): bool
{
    $ch = curl_init(SUDO_RELAY_URL . '/event.php');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['type' => $type] + $data, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Sudo-Token: ' . SUDO_RELAY_TOKEN],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $antwort = curl_exec($ch);
    $status  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($antwort === false || $status !== 200) {
        error_log("sudoRelay: Ereignis $type nicht zugestellt (HTTP $status)");
        return false;
    }
    return true;
}

/*
 * Beispiel aus einer Backup-Prüfung:
 *
 * foreach ($jobs as $job) {
 *     if ($job['status'] === 'failed') {
 *         sudoRelay('backup_failed', ['kunde' => $job['kunde'], 'text' => $job['name']]);
 *     } elseif ($job['status'] === 'warning') {
 *         sudoRelay('warning', ['text' => "Backup mit Warnung: {$job['kunde']}"]);
 *     }
 * }
 */
