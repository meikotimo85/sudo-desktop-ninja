<?php
// skins.php – Skins für den Skin-Store (1.14): Die IT lädt Skins hoch, legt einen XP-Preis fest und weist sie zu.
// Gleiche Antworten und Fehlermeldungen wie src/skins.js der Node-Version.
// Gespeichert werden die Grafik (Base64) und optional die Raster-Beschreibung als JSON-Text – beides genau so, wie es kam,
// damit die Prüfsumme (sha256 von „<Base64>|<JSON>“) in Zentrale und Sudo gleich ist.
declare(strict_types=1);

const SKIN_MAX_PNG = 1048576;                 // 1 MB Grafik
const SKIN_ID_RE = '/^[a-z0-9][a-z0-9-]{1,39}$/';

function skin_clean(array $b): array
{
    $id = (string) ($b['id'] ?? '');
    if (!preg_match(SKIN_ID_RE, $id)) fail(400, 'Kennung: 2 bis 40 Zeichen, nur a–z, 0–9 und Bindestrich.');
    $name = str((string) ($b['name'] ?? ''), 40);
    if ($name === '') fail(400, 'Name fehlt.');
    $png = (string) ($b['png'] ?? '');
    $bin = base64_decode($png, true);
    if ($png === '' || $bin === false || substr($bin, 0, 8) !== "\x89PNG\r\n\x1a\n") fail(400, 'Die Grafik ist kein PNG.');
    if (strlen($bin) > SKIN_MAX_PNG) fail(400, 'Die Grafik ist größer als 1 MB.');
    $sheet = $b['sheet'] ?? null;
    if ($sheet !== null && $sheet !== '') {
        $m = is_string($sheet) && strlen($sheet) <= 65536 ? json_decode($sheet, true) : null;
        if (!is_array($m) || !is_array($m['cell'] ?? null) || count($m['cell']) !== 2 || !isset($m['frames']['stand'])) fail(400, 'Die Raster-Beschreibung des Skins ist unvollständig.');
    } else $sheet = null;
    return ['id' => $id, 'name' => $name, 'price' => max(0, min(100000, (int) ($b['price'] ?? 0))), 'png' => $png, 'sheet' => $sheet,
        'sha' => hash('sha256', $png . '|' . ($sheet ?? '')), 'size' => strlen($bin), 'target' => valid_target($b['target'] ?? 'all')];
}

/** Für den Abruf der Sudos: welche Skins dieses Gerät im Store sieht und ob alle kostenlos sind */
function skins_public(Db $db, array $dev, array $s): array
{
    $items = [];
    foreach ($db->all('SELECT id, name, price, sha, target FROM skins WHERE active = 1 ORDER BY price, name') as $k) {
        if (target_matches((string) $k['target'], $dev)) $items[] = ['id' => $k['id'], 'name' => $k['name'], 'price' => (int) $k['price'], 'sha' => $k['sha']];
    }
    return ['free' => ($s['skins_free'] ?? 'false') === 'true', 'items' => $items];
}

function skin_for(Db $db, array $dev, string $id): array
{
    $k = preg_match(SKIN_ID_RE, $id) ? $db->get('SELECT * FROM skins WHERE id = ? AND active = 1', [$id]) : null;
    if (!$k || !target_matches((string) $k['target'], $dev)) fail(404, 'Skin nicht gefunden.');
    return ['id' => $k['id'], 'name' => $k['name'], 'price' => (int) $k['price'], 'sha' => $k['sha'], 'png' => $k['png'], 'sheet' => $k['sheet']];
}

function skins_admin(Db $db): array
{
    return ['free' => ($db->settings()['skins_free'] ?? 'false') === 'true',
        'items' => array_map(fn($k) => ['id' => $k['id'], 'name' => $k['name'], 'price' => (int) $k['price'], 'sha' => $k['sha'], 'size' => (int) $k['size'],
            'target' => $k['target'], 'active' => (int) $k['active'] === 1, 'author' => $k['author'], 'created' => (int) $k['created'], 'updated' => (int) $k['updated'],
            'png' => $k['png'], 'sheet' => $k['sheet']],
            $db->all('SELECT * FROM skins ORDER BY price, name'))];
}

/** Neu anlegen oder – bei gleicher Kennung – ersetzen */
function skin_save(Db $db, array $b, string $who): array
{
    $c = skin_clean($b);
    $old = $db->get('SELECT id FROM skins WHERE id = ?', [$c['id']]);
    if ($old) {
        $db->run('UPDATE skins SET name = ?, price = ?, png = ?, sheet = ?, sha = ?, size = ?, target = ?, author = ?, updated = ? WHERE id = ?',
            [$c['name'], $c['price'], $c['png'], $c['sheet'], $c['sha'], $c['size'], $c['target'], $who, now_ms(), $c['id']]);
    } else {
        $db->run('INSERT INTO skins (id, name, price, png, sheet, sha, size, target, active, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
            [$c['id'], $c['name'], $c['price'], $c['png'], $c['sheet'], $c['sha'], $c['size'], $c['target'], $who, now_ms(), now_ms()]);
    }
    $db->audit($who, $old ? 'skin_update' : 'skin_add', $c['name'] . ' · ' . $c['price'] . ' XP → ' . $c['target']);
    return ['ok' => true, 'id' => $c['id'], 'updated' => (bool) $old];
}

function skin_patch(Db $db, string $id, array $b, string $who): void
{
    $k = $db->get('SELECT id, name FROM skins WHERE id = ?', [$id]) ?? fail(404, 'Skin nicht gefunden.');
    if (array_key_exists('active', $b)) $db->run('UPDATE skins SET active = ?, updated = ? WHERE id = ?', [!empty($b['active']) ? 1 : 0, now_ms(), $k['id']]);
    if (array_key_exists('target', $b)) $db->run('UPDATE skins SET target = ?, updated = ? WHERE id = ?', [valid_target($b['target']), now_ms(), $k['id']]);
    if (array_key_exists('price', $b)) $db->run('UPDATE skins SET price = ?, updated = ? WHERE id = ?', [max(0, min(100000, (int) $b['price'])), now_ms(), $k['id']]);
    $db->audit($who, 'skin_edit', $k['name']);
}

function skin_delete(Db $db, string $id, string $who): void
{
    $k = $db->get('SELECT id, name FROM skins WHERE id = ?', [$id]) ?? fail(404, 'Skin nicht gefunden.');
    $db->run('DELETE FROM skins WHERE id = ?', [$k['id']]);
    $db->audit($who, 'skin_delete', $k['name']);
}
