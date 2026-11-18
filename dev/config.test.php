<?php
// Test-Konfiguration für die PHP-Zentrale – NUR lokal verwenden.
// Kopieren nach sudo-zentrale-php/config.php (danach wieder löschen, nie committen oder hochladen).
// Admin-Passwort: test-passwort-16   ·   Registrierungscode: TEST-PHP-1234
return [
  'public_url' => 'http://127.0.0.1:8091',
  'db' => ['dsn' => 'sqlite:' . __DIR__ . '/data/zentrale.sqlite'],
  'entra' => ['tenant' => '', 'client_id' => '', 'client_secret' => ''],
  'admin_users' => [], 'admin_group' => '',
  'admin_password' => password_hash('test-passwort-16', PASSWORD_DEFAULT),
  'local_login' => true,
  // 1.14: Für test-auth.py startet tests.sh den Server mit SUDO_TEST_TOTP (öffentlicher Beispielschlüssel, kein Geheimnis)
  'admin_totp' => getenv('SUDO_TEST_TOTP') ?: '',
  'anthropic_key' => 'sk-ant-test',
  'anthropic_url' => 'http://127.0.0.1:4799/v1/messages',   // sudo-desktop/tools/mock-anthropic.js
  'poll_seconds' => 5,
  'first_enroll_code' => 'TEST-PHP-1234',
  // Nachbau von YouTube und Spotify: node dev/mock-spotify-youtube.js
  'youtube_base' => 'http://127.0.0.1:4800',
  'spotify_api' => 'http://127.0.0.1:4800',
  'spotify_accounts' => 'http://127.0.0.1:4800',
  // Nachbau von Microsoft Graph (SharePoint): node dev/mock-graph.js – Client Secret dort: geheim
  'graph_login' => 'http://127.0.0.1:4801',
  'graph_api' => 'http://127.0.0.1:4801/v1.0',
];
