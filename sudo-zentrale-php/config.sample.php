<?php
// config.php – Einstellungen der Sudo-Zentrale (PHP). Diese Datei als config.php kopieren und ausfüllen.
// Sicherer (ab 1.14): als sudo-zentrale-config.php EINE EBENE ÜBER dem Web-Ordner ablegen – dann kann der Webserver sie nie ausliefern.
return [
    // Öffentliche Adresse – genau so, wie Sudos und Browser sie aufrufen (ohne Schrägstrich am Ende)
    'public_url' => 'https://sudo.example.com',

    // Datenbank: SQLite (nichts einzurichten, Datei liegt im geschützten Ordner data/) …
    'db' => ['dsn' => 'sqlite:' . __DIR__ . '/data/zentrale.sqlite', 'user' => null, 'pass' => null],
    // … oder MySQL/MariaDB vom Webspace:
    // 'db' => ['dsn' => 'mysql:host=localhost;dbname=sudo_zentrale;charset=utf8mb4', 'user' => 'sudo', 'pass' => 'GEHEIM'],

    // Admin-Anmeldung mit Microsoft Entra ID (App-Registrierung, Umleitungs-URI = public_url + /auth/callback)
    'entra' => ['tenant' => '', 'client_id' => '', 'client_secret' => ''],
    'admin_users' => ['meiko@example.de'],   // UPNs/E-Mails, die in die Verwaltung dürfen
    'admin_group' => '',                      // oder Objekt-ID einer Entra-Gruppe (Gruppen-Claim aktivieren)

    // Notfall-Zugang: Hash über /setup erzeugen (beginnt mit $2y$ …) – ein Klartext-Passwort wird ab 1.14 abgelehnt.
    // Neben Entra nur aktiv, wenn local_login = true.
    'admin_password' => '',
    'local_login' => false,
    // Zweiter Faktor für den Notfall-Zugang (empfohlen): Schlüssel in der Verwaltung unter „Sicherheit & Quiz“ erzeugen
    // und hier eintragen. Dann braucht die Anmeldung zusätzlich den 6-stelligen Code aus einer Authenticator-App.
    'admin_totp' => '',
    // Notfall-Zugang nur von diesen Adressen (optional), z. B. ['203.0.113.10', '198.51.100.0/24']
    'local_login_ips' => [],

    // Frag Sudo über die Zentrale: Claude-API-Schlüssel (console.anthropic.com)
    'anthropic_key' => '',

    // So oft fragen die Sudos nach neuen Meldungen (Sekunden). 15 ist ein guter Kompromiss für Webspace.
    'poll_seconds' => 15,

    // Optional: erster Registrierungscode (sonst in der Verwaltung erzeugen)
    'first_enroll_code' => '',
    // 1.15: Absender der Mails des Ideen-Boards (leer = sudo-zentrale@<Domain aus public_url>)
    'mail_from' => '',
];
