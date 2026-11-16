<?php
/**
 * Sudo-Relay – Konfiguration
 *
 * Vor dem Hochladen BEIDE Tokens durch eigene, lange Zufallswerte ersetzen.
 * Die Startseite (index.php) zeigt dir dafür fertige Vorschläge an.
 *
 *  send_token  → gehört in deine Server-Skripte (dürfen Ereignisse senden)
 *  read_token  → gehört in Sudo (darf Ereignisse abholen)
 */
return [
    'send_token' => 'BITTE-AENDERN-send',
    'read_token' => 'BITTE-AENDERN-read',

    // Ereignisse, die älter sind, werden automatisch gelöscht
    'keep_days'  => 7,

    // Höchstens so viele Ereignisse werden aufbewahrt
    'max_events' => 500,
];
