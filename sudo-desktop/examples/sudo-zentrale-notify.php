<?php
/**
 * sudo-zentrale-notify.php – Ereignis an die Sudo-Zentrale schicken (ersetzt sudo-relay-notify.php).
 * Einbinden: require 'sudo-zentrale-notify.php';  sudoZentrale('backup_failed', ['kunde' => 'Muster GmbH']);
 * API-Schlüssel: Verwaltung der Zentrale → Schnittstellen → Neuer API-Schlüssel
 */
declare(strict_types=1);

const SUDO_ZENTRALE_URL = 'https://sudo.meikosoft.net';
const SUDO_ZENTRALE_KEY = 'szk_HIER-DEN-API-SCHLUESSEL-EINTRAGEN';

/**
 * @param string $type   backup_failed | server_down | deploy_ok | ticket | warning | success | message | bug
 * @param array  $data   Felder, z. B. ['kunde' => '…'] oder ['text' => '…', 'link' => 'https://…']
 * @param string $target 'all', 'group:IT' oder 'device:PC-MEIKO'
 */
function sudoZentrale(string $type, array $data = [], string $target = 'all'): bool
{
    $ch = curl_init(SUDO_ZENTRALE_URL . '/api/events');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . SUDO_ZENTRALE_KEY, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode(['type' => $type, 'target' => $target] + $data, JSON_UNESCAPED_UNICODE),
    ]);
    $antwort = curl_exec($ch);
    $status  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200) {
        error_log("sudoZentrale: Ereignis $type nicht zugestellt (HTTP $status): $antwort");
        return false;
    }
    return true;
}
