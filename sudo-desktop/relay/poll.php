<?php
/**
 * Sudo-Relay – Ereignisse abholen (wird von Sudo aufgerufen)
 *
 * GET https://deine-domain.de/sudo-relay/poll.php?since=<letzte id>
 * Header: X-Sudo-Token: <read_token>
 *
 * since=-1 liefert nur die aktuelle lastId (zum Einrichten, ohne alte Ereignisse nachzuspielen).
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    relayJson(405, ['ok' => false, 'error' => 'Nur GET erlaubt']);
}
relayRequireToken('read_token');

$since = (int)($_GET['since'] ?? -1);
$store = relayStore();
$lastId = (int)$store['lastId'];

if ($since < 0) {
    relayJson(200, ['ok' => true, 'lastId' => $lastId, 'events' => []]);
}

$events = array_values(array_filter($store['events'], fn($e) => $e['id'] > $since));
$events = array_slice($events, 0, 50);
// Ohne neue Ereignisse: aktuelle lastId zurückgeben (gleicht auch einen zurückgesetzten Speicher aus)
$newLast = $events ? (int)end($events)['id'] : $lastId;

relayJson(200, ['ok' => true, 'lastId' => $newLast, 'events' => $events, 'version' => RELAY_VERSION]);
