<?php
// plugins.php – Plugins (1.12): kleine HTML-Werkzeuge, die sich die Sudos von der Zentrale holen.
// Gleiche Antworten und Fehlermeldungen wie src/plugins.js der Node-Version.
// Die Zentrale speichert das HTML nur und liefert es aus – ausgeführt wird es abgeschottet im Client.
declare(strict_types=1);

const PLUGIN_MAX_BYTES = 2097152;                 // 2 MB HTML
const PLUGIN_ID_RE = '/^[a-z0-9][a-z0-9-]{1,39}$/';

function plugin_clamp(mixed $v, int $min, int $max, int $def): int { $n = (int) $v; return $n ? max($min, min($max, $n)) : $def; }

/** Hochgeladenes Plugin prüfen; liefert die Spalten für die Tabelle */
function plugin_clean(array $b): array
{
    $id = (string) ($b['id'] ?? '');
    if (!preg_match(PLUGIN_ID_RE, $id)) fail(400, 'Kennung: 2 bis 40 Zeichen, nur a–z, 0–9 und Bindestrich.');
    $name = str((string) ($b['name'] ?? ''), 60);
    if ($name === '') fail(400, 'Name fehlt.');
    $html = $b['html'] ?? null;
    if (!is_string($html) || trim($html) === '') fail(400, 'Die Datei ist leer.');
    if (strlen($html) > PLUGIN_MAX_BYTES) fail(400, 'Das Plugin ist größer als 2 MB.');
    if (!preg_match('/<(!doctype\s+html|html|body)[\s>]/i', $html)) fail(400, 'Das ist keine HTML-Datei.');
    return ['id' => $id, 'name' => $name, 'version' => str((string) ($b['version'] ?? ''), 20),
        'w' => plugin_clamp($b['w'] ?? 0, 360, 1600, 900), 'h' => plugin_clamp($b['h'] ?? 0, 300, 1200, 720),
        'target' => valid_target($b['target'] ?? 'all'), 'html' => $html, 'sha' => hash('sha256', $html), 'size' => strlen($html)];
}

function plugin_item(array $p): array
{
    return ['id' => $p['id'], 'name' => $p['name'], 'version' => (string) $p['version'], 'sha' => $p['sha'], 'w' => (int) $p['w'], 'h' => (int) $p['h']];
}

/** Für den Abruf der Sudos: welche Plugins dieses Gerät bekommt und ob eigene erlaubt sind */
function plugins_public(Db $db, array $dev, array $s): array
{
    $items = [];
    foreach ($db->all('SELECT id, name, version, sha, w, h, target FROM plugins WHERE active = 1 ORDER BY name') as $p) {
        if (target_matches((string) $p['target'], $dev)) $items[] = plugin_item($p);
    }
    return ['user' => ($s['plugins_user'] ?? 'true') !== 'false', 'items' => $items];
}

/** Ein Plugin samt HTML für ein Gerät (nur aktiv und passendes Ziel) */
function plugin_for(Db $db, array $dev, string $id): array
{
    $p = preg_match(PLUGIN_ID_RE, $id) ? $db->get('SELECT * FROM plugins WHERE id = ? AND active = 1', [$id]) : null;
    if (!$p || !target_matches((string) $p['target'], $dev)) fail(404, 'Plugin nicht gefunden.');
    return plugin_item($p) + ['html' => $p['html']];
}

function plugins_admin(Db $db): array
{
    return ['user' => ($db->settings()['plugins_user'] ?? 'true') !== 'false',
        'items' => array_map(fn($p) => plugin_item($p) + ['size' => (int) $p['size'], 'target' => $p['target'], 'active' => (int) $p['active'] === 1,
            'author' => $p['author'], 'created' => (int) $p['created'], 'updated' => (int) $p['updated']],
            $db->all('SELECT id, name, version, sha, w, h, size, target, active, author, created, updated FROM plugins ORDER BY name'))];
}

/** Neu anlegen oder – bei gleicher Kennung – ersetzen */
function plugin_save(Db $db, array $b, string $who): array
{
    $c = plugin_clean($b);
    $old = $db->get('SELECT id FROM plugins WHERE id = ?', [$c['id']]);
    if ($old) {
        $db->run('UPDATE plugins SET name = ?, version = ?, html = ?, sha = ?, size = ?, w = ?, h = ?, target = ?, author = ?, updated = ? WHERE id = ?',
            [$c['name'], $c['version'], $c['html'], $c['sha'], $c['size'], $c['w'], $c['h'], $c['target'], $who, now_ms(), $c['id']]);
    } else {
        $db->run('INSERT INTO plugins (id, name, version, html, sha, size, w, h, target, active, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
            [$c['id'], $c['name'], $c['version'], $c['html'], $c['sha'], $c['size'], $c['w'], $c['h'], $c['target'], $who, now_ms(), now_ms()]);
    }
    $db->audit($who, $old ? 'plugin_update' : 'plugin_add', $c['name'] . ($c['version'] !== '' ? ' ' . $c['version'] : '') . ' → ' . $c['target']);
    return ['ok' => true, 'id' => $c['id'], 'updated' => (bool) $old];
}

function plugin_patch(Db $db, string $id, array $b, string $who): void
{
    $p = $db->get('SELECT id, name FROM plugins WHERE id = ?', [$id]) ?? fail(404, 'Plugin nicht gefunden.');
    if (array_key_exists('active', $b)) $db->run('UPDATE plugins SET active = ?, updated = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, now_ms(), $p['id']]);
    if (array_key_exists('target', $b)) $db->run('UPDATE plugins SET target = ?, updated = ? WHERE id = ?', [valid_target($b['target']), now_ms(), $p['id']]);
    $db->audit($who, 'plugin_edit', $p['name']);
}

function plugin_delete(Db $db, string $id, string $who): void
{
    $p = $db->get('SELECT id, name FROM plugins WHERE id = ?', [$id]) ?? fail(404, 'Plugin nicht gefunden.');
    $db->run('DELETE FROM plugins WHERE id = ?', [$p['id']]);
    $db->audit($who, 'plugin_delete', $p['name']);
}
