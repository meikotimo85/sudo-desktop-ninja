<?php
// config.php – Einstellungen der Sudo-Zentrale (PHP). Diese Datei als config.php kopieren und ausfüllen.
return [
    // Öffentliche Adresse – genau so, wie Sudos und Browser sie aufrufen (ohne Schrägstrich am Ende)
    'public_url' => 'https://sudo.meikosoft.net',

    // Datenbank: SQLite (nichts einzurichten, Datei liegt im geschützten Ordner data/) …
    'db' => ['dsn' => 'sqlite:' . __DIR__ . '/data/zentrale.sqlite', 'user' => null, 'pass' => null],
    // … oder MySQL/MariaDB vom Webspace:
    // 'db' => ['dsn' => 'mysql:host=localhost;dbname=sudo_zentrale;charset=utf8mb4', 'user' => 'sudo', 'pass' => 'GEHEIM'],

    // Admin-Anmeldung mit Microsoft Entra ID (App-Registrierung, Umleitungs-URI = public_url + /auth/callback)
    'entra' => ['tenant' => '', 'client_id' => '', 'client_secret' => ''],
    'admin_users' => ['meiko@example.de'],   // UPNs/E-Mails, die in die Verwaltung dürfen
    'admin_group' => '',                      // oder Objekt-ID einer Entra-Gruppe (Gruppen-Claim aktivieren)

    // Notfall-Zugang: Hash über /setup erzeugen (beginnt mit $2y$ …). Neben Entra nur aktiv, wenn local_login = true.
    'admin_password' => '',
    'local_login' => false,

    // Frag Sudo über die Zentrale: Claude-API-Schlüssel (console.anthropic.com)
    'anthropic_key' => '',

    // So oft fragen die Sudos nach neuen Meldungen (Sekunden). 15 ist ein guter Kompromiss für Webspace.
    'poll_seconds' => 15,

    // Optional: erster Registrierungscode (sonst in der Verwaltung erzeugen)
    'first_enroll_code' => '',
];
