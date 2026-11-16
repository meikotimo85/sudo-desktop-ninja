<?php
/**
 * Sudo-Relay – Ereignis einliefern
 *
 * POST https://deine-domain.de/sudo-relay/event.php
 * Header:  X-Sudo-Token: <send_token>
 * Body:    {"type":"backup_failed","kunde":"Muster GmbH"}
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    relayJson(405, ['ok' => false, 'error' => 'Nur POST erlaubt']);
}

$body = relayBody();
relayRequireToken('send_token', $body);

$type = (string)($body['type'] ?? '');
if (!in_array($type, RELAY_TYPES, true)) {
    relayJson(400, ['ok' => false, 'error' => 'Unbekannter type', 'erlaubt' => RELAY_TYPES]);
}

$event = ['type' => $type];
foreach (RELAY_FIELDS as $f) {
    if (isset($body[$f]) && $body[$f] !== '') {
        $event[$f] = mb_substr(trim((string)$body[$f]), 0, 120);
    }
}

$id = 0;
relayStore(function (array $store) use ($event, &$id) {
    $id = (int)$store['lastId'] + 1;
    $store['lastId'] = $id;
    $store['events'][] = ['id' => $id, 'at' => time()] + $event;
    return $store;
});

relayJson(200, ['ok' => true, 'id' => $id]);
