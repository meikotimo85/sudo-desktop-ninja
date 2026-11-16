<?php
// kb.php – 1.9: Wissen & Anleitungen aus SharePoint.
// Die Zentrale liest per Microsoft Graph (App-Berechtigung, nur lesend) SharePoint-Bibliotheken und Websiteseiten,
// merkt sich Titel, Ordner, Link und den Text (Websiteseiten, Word, PowerPoint, Text) und durchsucht ihn für die Sudos.
// Die Inhalte bleiben in SharePoint – Sudo verlinkt nur dorthin. Gleiche Logik wie src/kb.js der Node-Version.
declare(strict_types=1);

const KB_TEXT_MAX = 12000;          // Zeichen Text je Dokument
const KB_ITEMS_MAX = 1500;          // Dokumente je Quelle
const KB_FILE_MAX = 8 * 1024 * 1024;
const KB_TEXT_EXT = ['docx', 'pptx', 'txt', 'md'];
const KB_LIST_EXT = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'pdf', 'txt', 'md', 'url', 'aspx', 'one', 'vsdx', 'mp4'];
const KB_STOP = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'ich', 'du', 'wir', 'ihr', 'sie', 'es', 'mein', 'meine',
    'meinen', 'wie', 'was', 'wo', 'wer', 'warum', 'kann', 'koennen', 'muss', 'mit', 'auf', 'fuer', 'von', 'zu', 'zum', 'zur', 'im', 'in', 'an', 'am', 'ist', 'sind', 'bei', 'nicht',
    'mehr', 'mir', 'mich', 'dir', 'auch', 'noch', 'schon', 'bitte', 'hilfe', 'geht', 'gibt', 'man', 'uns', 'unser', 'unsere', 'heisst', 'haben', 'habe', 'hat',
    'wird', 'werden', 'dass', 'kein', 'keine', 'wenn', 'dann', 'so', 'da', 'hier', 'jetzt', 'immer', 'gerade', 'the', 'and', 'how', 'can', 'to', 'of', 'for', 'is', 'my', 'a', 'an'];

/* ---------- Microsoft Graph ---------- */
function kb_graph_api(array $cfg): string { return rtrim((string) ($cfg['graph_api'] ?? 'https://graph.microsoft.com/v1.0'), '/'); }
function kb_graph_login(array $cfg): string { return rtrim((string) ($cfg['graph_login'] ?? 'https://login.microsoftonline.com'), '/'); }
// Zugangsdaten: eigene Angaben unter „Wissen“, sonst die App-Registrierung der Anmeldung aus config.php
function kb_creds(array $s, array $cfg): array
{
    $e = $cfg['entra'] ?? [];
    $own = trim((string) ($s['kb_client_id'] ?? '')) !== '';
    return ['tenant' => trim((string) ($s['kb_tenant'] ?? '')) ?: (string) ($e['tenant'] ?? ''),
        'id' => $own ? trim((string) $s['kb_client_id']) : (string) ($e['client_id'] ?? ''),
        'secret' => $own ? (string) ($s['kb_client_secret'] ?? '') : (string) ($e['client_secret'] ?? ''), 'own' => $own];
}
function kb_token(Db $db, array $cfg, bool $fresh = false): string
{
    $s = $db->settings();
    if (!$fresh && ($s['kb_token'] ?? '') !== '' && (int) ($s['kb_token_exp'] ?? 0) > now_ms() + 60000) return (string) $s['kb_token'];
    $c = kb_creds($s, $cfg);
    if ($c['tenant'] === '' || $c['id'] === '' || $c['secret'] === '') throw new RuntimeException('Bitte Tenant, Client ID und Client Secret eintragen.');
    [$code, $out, $err] = http_req('POST', kb_graph_login($cfg) . '/' . rawurlencode($c['tenant']) . '/oauth2/v2.0/token', ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query(['grant_type' => 'client_credentials', 'client_id' => $c['id'], 'client_secret' => $c['secret'], 'scope' => 'https://graph.microsoft.com/.default']), 15);
    $j = json_decode($out, true) ?: [];
    if ($code !== 200 || empty($j['access_token'])) {
        $m = (string) ($j['error_description'] ?? $j['error'] ?? $err ?: "HTTP $code");
        throw new RuntimeException('Anmeldung bei Microsoft fehlgeschlagen: ' . mb_substr(strtok($m, "\r\n") ?: $m, 0, 200));
    }
    $db->setSetting('kb_token', (string) $j['access_token']);
    $db->setSetting('kb_token_exp', (string) (now_ms() + ((int) ($j['expires_in'] ?? 3600)) * 1000));
    return (string) $j['access_token'];
}
// GET auf Graph; $raw = Inhalt statt JSON (Dateiinhalt)
function kb_graph(Db $db, array $cfg, string $pathOrUrl, bool $raw = false, int $timeout = 20)
{
    $url = str_starts_with($pathOrUrl, 'http') ? $pathOrUrl : kb_graph_api($cfg) . $pathOrUrl;
    for ($try = 0; $try < 2; $try++) {
        [$code, $out, $err] = http_req('GET', $url, ['Authorization: Bearer ' . kb_token($db, $cfg, $try > 0), 'Accept: application/json'], null, $timeout);
        if ($code === 401 && $try === 0) continue;
        break;
    }
    if ($code === 200) return $raw ? $out : (json_decode($out, true) ?: []);
    $j = json_decode($out, true) ?: [];
    $m = (string) ($j['error']['message'] ?? $err ?: '');
    if ($code === 403 || $code === 401) throw new RuntimeException('Keine Berechtigung für diese SharePoint-Website. Die App braucht „Sites.Selected“ (mit Freigabe für die Website) oder „Sites.Read.All“.');
    if ($code === 404) throw new RuntimeException('Nicht gefunden – stimmt der Link?');
    if ($code === 0) throw new RuntimeException('Microsoft Graph nicht erreichbar (' . $err . ').');
    throw new RuntimeException("Graph-Fehler $code" . ($m !== '' ? ': ' . mb_substr($m, 0, 160) : ''));
}
function kb_graph_all(Db $db, array $cfg, string $path, int $max = 2000): array
{
    $out = []; $next = $path;
    while ($next && count($out) < $max) {
        $j = kb_graph($db, $cfg, $next);
        foreach ($j['value'] ?? [] as $v) $out[] = $v;
        $next = $j['@odata.nextLink'] ?? null;
    }
    return $out;
}

/* ---------- Quelle aus einem SharePoint-Link ermitteln ---------- */
// Beispiele: https://firma.sharepoint.com/sites/IT/Freigegebene Dokumente/Anleitungen
//            https://firma.sharepoint.com/sites/IT/Shared Documents/Forms/AllItems.aspx?id=%2Fsites%2FIT%2FShared%20Documents%2FAnleitungen
//            https://firma.sharepoint.com/sites/IT/SitePages
function kb_resolve(Db $db, array $cfg, string $url): array
{
    $u = parse_url(trim($url));
    if (!$u || ($u['scheme'] ?? '') !== 'https' || empty($u['host']) || !preg_match('/\.sharepoint\.(com|de|us)$/i', $u['host']))
        throw new RuntimeException('Bitte einen SharePoint-Link einfügen (https://…sharepoint.com/sites/…).');
    $host = strtolower($u['host']);
    $path = rawurldecode($u['path'] ?? '/');
    parse_str($u['query'] ?? '', $q);
    if (!empty($q['id']) && is_string($q['id'])) $path = $q['id'];                   // Ordneransicht „AllItems.aspx?id=…“
    elseif (!empty($q['RootFolder']) && is_string($q['RootFolder'])) $path = $q['RootFolder'];
    $path = preg_replace('~/Forms/[^/]+\.aspx$~i', '', $path);
    $path = rtrim($path, '/');
    if (preg_match('~^/(sites|teams)/([^/]+)(/.*)?$~i', $path, $m)) {
        $site = kb_graph($db, $cfg, '/sites/' . $host . ':/' . $m[1] . '/' . rawurlencode($m[2]) . '?$select=id,displayName,webUrl');
        $sitePath = '/' . $m[1] . '/' . $m[2]; $rest = $m[3] ?? '';
    } else {
        $site = kb_graph($db, $cfg, '/sites/' . $host . '?$select=id,displayName,webUrl');
        $sitePath = ''; $rest = $path;
    }
    $siteId = (string) $site['id'];
    if ($rest === '' || preg_match('~^/SitePages(/.*)?$~i', $rest)) {
        return ['kind' => 'pages', 'site_id' => $siteId, 'drive_id' => '', 'folder_id' => '', 'title' => ($site['displayName'] ?? 'Website') . ' · Seiten'];
    }
    // Bibliothek finden: deren Adresse ist der längste Anfang des Links
    $best = null; $bestLen = -1;
    foreach (kb_graph($db, $cfg, '/sites/' . rawurlencode($siteId) . '/drives?$select=id,name,webUrl')['value'] ?? [] as $d) {
        $dp = rtrim(rawurldecode((string) parse_url((string) $d['webUrl'], PHP_URL_PATH)), '/');
        $rel = substr($dp, strlen($sitePath));
        if ($rel !== '' && (strcasecmp($rest, $rel) === 0 || stripos($rest, $rel . '/') === 0) && strlen($rel) > $bestLen) { $best = $d; $bestLen = strlen($rel); }
    }
    if (!$best) throw new RuntimeException('In dieser Website keine passende Dokumentbibliothek gefunden.');
    $folder = trim(substr($rest, $bestLen), '/');
    $folderId = 'root'; $title = (string) $best['name'];
    if ($folder !== '') {
        $it = kb_graph($db, $cfg, '/drives/' . rawurlencode($best['id']) . '/root:/' . implode('/', array_map('rawurlencode', explode('/', $folder))) . '?$select=id,name,folder');
        if (empty($it['folder'])) throw new RuntimeException('Der Link zeigt auf eine Datei. Bitte den Ordner verlinken.');
        $folderId = (string) $it['id']; $title .= ' / ' . $folder;
    }
    return ['kind' => 'library', 'site_id' => $siteId, 'drive_id' => (string) $best['id'], 'folder_id' => $folderId, 'title' => ($site['displayName'] ?? '') . ' · ' . $title];
}
function kb_add(Db $db, array $cfg, string $url, string $who): array
{
    $url = trim($url);
    if (mb_strlen($url) > 800) fail(400, 'Der Link ist zu lang.');
    if ((int) $db->get('SELECT COUNT(*) AS n FROM kb_sources')['n'] >= 20) fail(400, 'Höchstens 20 Quellen.');
    try { $r = kb_resolve($db, $cfg, $url); } catch (RuntimeException $e) { fail(400, $e->getMessage()); }
    if ($db->get('SELECT 1 FROM kb_sources WHERE site_id = ? AND drive_id = ? AND folder_id = ? AND kind = ?', [$r['site_id'], $r['drive_id'], $r['folder_id'], $r['kind']])) fail(409, 'Diese Quelle ist schon eingetragen.');
    $db->run('INSERT INTO kb_sources (url, kind, site_id, drive_id, folder_id, title, active, last_sync, last_error, items, created) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, 0, ?)',
        [$url, $r['kind'], $r['site_id'], $r['drive_id'], $r['folder_id'], mb_substr($r['title'], 0, 200), '', now_ms()]);
    $id = (int) $db->lastId();
    $db->audit($who, 'kb_add', $r['title']);
    $res = kb_sync_source($db, $cfg, $id);
    return ['id' => $id, 'title' => $r['title']] + $res;
}

/* ---------- Text aus Dokumenten ---------- */
// Kleiner ZIP-Leser (docx/pptx sind ZIP-Archive) – braucht nur zlib, keine Erweiterung „zip“
function kb_zip_entries(string $zip, string $pattern, int $maxFiles = 80): array
{
    $out = [];
    $eocd = strrpos($zip, "PK\x05\x06");
    if ($eocd === false || strlen($zip) < $eocd + 22) return $out;
    $e = unpack('vdisk/vcd_disk/vn_disk/vn/Vsize/Voffset', substr($zip, $eocd + 4, 16));
    $p = $e['offset'];
    for ($i = 0; $i < $e['n'] && count($out) < $maxFiles; $i++) {
        if (substr($zip, $p, 4) !== "PK\x01\x02") break;
        $h = unpack('vver/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/velen/vclen/vdisk/vint/Vext/Voff', substr($zip, $p + 4, 42));
        $name = substr($zip, $p + 46, $h['nlen']);
        $p += 46 + $h['nlen'] + $h['elen'] + $h['clen'];
        if (!preg_match($pattern, $name) || $h['usize'] > 20 * 1024 * 1024) continue;
        $lh = unpack('vnlen/velen', substr($zip, $h['off'] + 26, 4));
        $data = substr($zip, $h['off'] + 30 + $lh['nlen'] + $lh['elen'], $h['csize']);
        if ($h['method'] === 8) $data = @gzinflate($data);
        elseif ($h['method'] !== 0) $data = false;
        if (is_string($data)) $out[$name] = $data;
    }
    return $out;
}
function kb_xml_text(string $xml, string $paraTag): string
{
    $xml = preg_replace('~</' . $paraTag . '>~', "\n", $xml);
    $xml = preg_replace('~<w:tab/>|<w:br/>|<a:br/>~', ' ', $xml);
    return html_entity_decode(strip_tags($xml), ENT_QUOTES | ENT_XML1, 'UTF-8');
}
function kb_extract(string $ext, string $data): string
{
    $t = '';
    if ($ext === 'docx') { foreach (kb_zip_entries($data, '~^word/(document|header\d*|footer\d*)\.xml$~') as $x) $t .= kb_xml_text($x, 'w:p') . "\n"; }
    elseif ($ext === 'pptx') {
        $slides = kb_zip_entries($data, '~^ppt/slides/slide\d+\.xml$~', 200);
        uksort($slides, fn($a, $b) => (int) preg_replace('~\D~', '', $a) <=> (int) preg_replace('~\D~', '', $b));
        foreach ($slides as $x) $t .= kb_xml_text($x, 'a:p') . "\n";
    } elseif ($ext === 'txt' || $ext === 'md') $t = mb_convert_encoding($data, 'UTF-8', 'UTF-8, Windows-1252');
    return kb_clean_text($t);
}
function kb_clean_text(string $t): string
{
    $t = preg_replace("~[ \t\x{00A0}]+~u", ' ', $t);
    $t = preg_replace("~\s*\n\s*~u", "\n", trim((string) $t));
    return mb_substr((string) $t, 0, KB_TEXT_MAX);
}
function kb_html_text(string $html): string
{
    $html = preg_replace('~<(br|/p|/div|/li|/h\d)[^>]*>~i', "\n", $html);
    return kb_clean_text(html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}
// Für die Suche: klein, Umlaute ausgeschrieben, nur Buchstaben/Ziffern
function kb_fold(string $s): string
{
    $s = mb_strtolower($s);
    $s = strtr($s, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss', 'é' => 'e', 'è' => 'e', 'á' => 'a', 'à' => 'a']);
    return ' ' . trim((string) preg_replace('~[^\p{L}\p{N}]+~u', ' ', $s)) . ' ';
}

/* ---------- Abgleich ---------- */
function kb_store_item(Db $db, int $sourceId, array $it, int $syncAt): void
{
    $norm = kb_fold($it['title'] . ' ' . $it['path'] . ' ' . $it['text']);
    $db->upsert('kb_items', ['source_id' => $sourceId, 'item_id' => $it['item_id'], 'kind' => $it['kind'], 'title' => mb_substr($it['title'], 0, 250), 'path' => mb_substr($it['path'], 0, 400),
        'url' => mb_substr($it['url'], 0, 1000), 'ext' => $it['ext'], 'modified' => $it['modified'], 'etag' => mb_substr($it['etag'], 0, 200), 'text' => $it['text'], 'norm' => $norm, 'synced' => $syncAt],
        ['source_id', 'item_id']);
}
function kb_sync_source(Db $db, array $cfg, int $id): array
{
    $src = $db->get('SELECT * FROM kb_sources WHERE id = ?', [$id]);
    if (!$src) fail(404, 'Quelle nicht gefunden.');
    @set_time_limit(240);
    $t0 = now_ms(); $n = 0; $read = 0;
    $known = [];
    foreach ($db->all('SELECT item_id, etag FROM kb_items WHERE source_id = ?', [$id]) as $r) $known[$r['item_id']] = $r['etag'];
    try {
        if ($src['kind'] === 'pages') {
            $pages = kb_graph_all($db, $cfg, '/sites/' . rawurlencode($src['site_id']) . '/pages/microsoft.graph.sitePage?$select=id,title,description,webUrl,lastModifiedDateTime,eTag,name&$top=100', KB_ITEMS_MAX);
            foreach ($pages as $p) {
                $etag = (string) ($p['eTag'] ?? $p['lastModifiedDateTime'] ?? '');
                $title = (string) ($p['title'] ?? $p['name'] ?? 'Seite');
                if (isset($known[$p['id']]) && $known[$p['id']] === $etag && $etag !== '') { $db->run('UPDATE kb_items SET synced = ? WHERE source_id = ? AND item_id = ?', [$t0, $id, $p['id']]); $n++; continue; }
                $text = (string) ($p['description'] ?? '');
                try {
                    $wp = kb_graph($db, $cfg, '/sites/' . rawurlencode($src['site_id']) . '/pages/' . rawurlencode($p['id']) . '/microsoft.graph.sitePage/webParts');
                    foreach ($wp['value'] ?? [] as $w) if (!empty($w['innerHtml'])) $text .= "\n" . kb_html_text((string) $w['innerHtml']);
                    $read++;
                } catch (RuntimeException $e) { /* nur Titel und Beschreibung */ }
                kb_store_item($db, $id, ['item_id' => (string) $p['id'], 'kind' => 'page', 'title' => $title, 'path' => 'Websiteseiten', 'url' => (string) ($p['webUrl'] ?? ''), 'ext' => 'aspx',
                    'modified' => (int) (strtotime((string) ($p['lastModifiedDateTime'] ?? '')) ?: 0) * 1000, 'etag' => $etag, 'text' => kb_clean_text($text)], $t0);
                $n++;
            }
        } else {
            $drive = rawurlencode($src['drive_id']);
            $queue = [[$src['folder_id'], '']];
            while ($queue && $n < KB_ITEMS_MAX) {
                [$fid, $fpath] = array_shift($queue);
                $base = $fid === 'root' ? "/drives/$drive/root/children" : "/drives/$drive/items/" . rawurlencode($fid) . '/children';
                foreach (kb_graph_all($db, $cfg, $base . '?$select=id,name,webUrl,file,folder,lastModifiedDateTime,eTag,size&$top=200', KB_ITEMS_MAX) as $it) {
                    if (!empty($it['folder'])) { if (substr_count($fpath, '/') < 5) $queue[] = [(string) $it['id'], $fpath . '/' . $it['name']]; continue; }
                    $ext = strtolower(pathinfo((string) $it['name'], PATHINFO_EXTENSION));
                    if (!in_array($ext, KB_LIST_EXT, true) || str_starts_with((string) $it['name'], '~$')) continue;
                    $etag = (string) ($it['eTag'] ?? '');
                    if (isset($known[$it['id']]) && $known[$it['id']] === $etag && $etag !== '') { $db->run('UPDATE kb_items SET synced = ? WHERE source_id = ? AND item_id = ?', [$t0, $id, $it['id']]); $n++; continue; }
                    $text = '';
                    if (in_array($ext, KB_TEXT_EXT, true) && (int) ($it['size'] ?? 0) <= KB_FILE_MAX) {
                        try { $text = kb_extract($ext, (string) kb_graph($db, $cfg, "/drives/$drive/items/" . rawurlencode((string) $it['id']) . '/content', true, 40)); $read++; }
                        catch (RuntimeException $e) { /* nur Name */ }
                    }
                    kb_store_item($db, $id, ['item_id' => (string) $it['id'], 'kind' => 'file', 'title' => preg_replace('~\.[^.]+$~', '', (string) $it['name']), 'path' => ltrim($fpath, '/'),
                        'url' => (string) ($it['webUrl'] ?? ''), 'ext' => $ext, 'modified' => (int) (strtotime((string) ($it['lastModifiedDateTime'] ?? '')) ?: 0) * 1000, 'etag' => $etag, 'text' => $text], $t0);
                    $n++;
                    if ($n >= KB_ITEMS_MAX) break;
                }
            }
        }
        // Was es in SharePoint nicht mehr gibt, fällt raus
        $db->run('DELETE FROM kb_items WHERE source_id = ? AND synced < ?', [$id, $t0]);
        $db->run('UPDATE kb_sources SET last_sync = ?, last_error = ?, items = ? WHERE id = ?', [now_ms(), '', $n, $id]);
        return ['ok' => true, 'items' => $n, 'read' => $read];
    } catch (RuntimeException $e) {
        $db->run('UPDATE kb_sources SET last_sync = ?, last_error = ? WHERE id = ?', [now_ms(), mb_substr($e->getMessage(), 0, 300), $id]);
        return ['ok' => false, 'items' => $n, 'read' => $read, 'error' => $e->getMessage()];
    }
}
// Im Hintergrund: höchstens eine Quelle pro Durchgang, gemäß Intervall
function kb_maybe_sync_later(Db $db, array $cfg): void
{
    $s = $db->settings();
    if (($s['kb_enabled'] ?? 'false') !== 'true' || (int) ($s['kb_next'] ?? 0) > now_ms()) return;
    $every = max(15, min(1440, (int) ($s['kb_interval'] ?? 60))) * 60000;
    $src = $db->get('SELECT id FROM kb_sources WHERE active = 1 AND last_sync < ? ORDER BY last_sync LIMIT 1', [now_ms() - $every]);
    $db->setSetting('kb_next', (string) (now_ms() + 120000));
    if (!$src) return;
    register_shutdown_function(function () use ($db, $cfg, $src) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { kb_sync_source($db, $cfg, (int) $src['id']); } catch (Throwable $e) { error_log('Sudo-Zentrale Wissen: ' . $e->getMessage()); }
    });
}

/* ---------- Suche ---------- */
function kb_terms(string $q): array
{
    $t = array_values(array_unique(array_filter(explode(' ', trim(kb_fold($q))), fn($w) => mb_strlen($w) >= 2 && !in_array($w, KB_STOP, true))));
    return array_slice($t, 0, 8);
}
function kb_snippet(string $text, array $terms): string
{
    if ($text === '') return '';
    $low = mb_strtolower($text); $pos = null;
    foreach ($terms as $t) {
        $raw = strtr($t, ['ae' => 'ä', 'oe' => 'ö', 'ue' => 'ü']);
        foreach ([$t, $raw] as $x) { $p = mb_strpos($low, $x); if ($p !== false && ($pos === null || $p < $pos)) $pos = $p; }
    }
    $start = max(0, ($pos ?? 0) - 70);
    $s = mb_substr($text, $start, 220);
    $s = preg_replace('~\s+~u', ' ', $s);
    return ($start > 0 ? '… ' : '') . trim((string) $s) . (mb_strlen($text) > $start + 220 ? ' …' : '');
}
function kb_search(Db $db, string $q, int $limit = 8): array
{
    $terms = kb_terms($q);
    if (!$terms) return [];
    $where = implode(' OR ', array_fill(0, count($terms), 'i.norm LIKE ?'));
    $rows = $db->all("SELECT i.*, s.title AS source FROM kb_items i JOIN kb_sources s ON s.id = i.source_id WHERE s.active = 1 AND ($where) LIMIT 400",
        array_map(fn($t) => '%' . $t . '%', $terms));
    $scored = [];
    foreach ($rows as $r) {
        $title = kb_fold($r['title']); $path = kb_fold($r['path']); $norm = $r['norm'];
        $score = 0; $hit = 0;
        foreach ($terms as $t) {
            $inT = substr_count($title, $t); $inP = substr_count($path, $t); $inX = min(6, substr_count($norm, $t) - $inT - $inP);
            if ($inT + $inP + max(0, $inX) > 0) $hit++;
            $score += $inT * 8 + (str_contains($title, ' ' . $t . ' ') ? 6 : 0) + $inP * 3 + max(0, $inX);
        }
        if (!$hit) continue;
        $score = $score * (0.4 + 0.6 * $hit / count($terms)) + ($hit === count($terms) ? 10 : 0);
        $r['_match'] = $hit / count($terms);
        $scored[] = [$score, $r];
    }
    usort($scored, fn($a, $b) => $b[0] <=> $a[0] ?: $b[1]['modified'] <=> $a[1]['modified']);
    // Schwache Zufallstreffer neben einem klaren Treffer weglassen
    $top = $scored ? $scored[0][0] : 0;
    $scored = array_values(array_filter($scored, fn($x) => $x[0] >= max(3, $top * 0.15)));
    return array_map(fn($x) => kb_item_public($x[1], $terms, (int) round($x[0])), array_slice($scored, 0, $limit));
}
function kb_item_public(array $r, array $terms = [], int $score = 0): array
{
    return ['id' => (int) $r['id'], 'title' => $r['title'], 'path' => $r['path'], 'url' => $r['url'], 'ext' => $r['ext'], 'kind' => $r['kind'], 'source' => (string) ($r['source'] ?? ''),
        'modified' => (int) $r['modified'] ?: null, 'snippet' => kb_snippet((string) $r['text'], $terms), 'score' => $score, 'match' => round((float) ($r['_match'] ?? 0), 2)];
}
function kb_recent(Db $db, int $limit = 10): array
{
    return array_map('kb_item_public', $db->all('SELECT i.*, s.title AS source FROM kb_items i JOIN kb_sources s ON s.id = i.source_id WHERE s.active = 1 ORDER BY i.modified DESC LIMIT ' . max(1, min(30, $limit))));
}
// Für „Frag Sudo“: die passendsten Anleitungen als Hintergrund
function kb_ai_context(Db $db, array $s, string $question): string
{
    if (($s['kb_enabled'] ?? 'false') !== 'true' || ($s['kb_ai'] ?? 'true') !== 'true') return '';
    // Relevant genug: klarer Treffer oder mindestens die Hälfte der Suchwörter kommt vor
    $hits = array_filter(kb_search($db, $question, 3), fn($h) => $h['score'] >= 8 || ($h['score'] >= 3 && $h['match'] >= 0.5));
    if (!$hits) return '';
    $ids = array_map(fn($h) => $h['id'], $hits);
    $out = [];
    foreach ($db->all('SELECT id, title, url, text FROM kb_items WHERE id IN (' . implode(',', array_map('intval', $ids)) . ')') as $r)
        $out[] = '- ' . $r['title'] . ' (' . $r['url'] . "):\n" . mb_substr(preg_replace('~\s+~u', ' ', (string) $r['text']), 0, 900);
    return implode("\n", $out);
}
function kb_public(array $s, Db $db): array
{
    return ['enabled' => ($s['kb_enabled'] ?? 'false') === 'true' && (bool) $db->get('SELECT 1 FROM kb_items LIMIT 1')];
}
function kb_source_public(array $r): array
{
    return ['id' => (int) $r['id'], 'url' => $r['url'], 'kind' => $r['kind'], 'title' => $r['title'], 'active' => (bool) $r['active'], 'lastSync' => (int) $r['last_sync'] ?: null,
        'lastError' => (string) $r['last_error'], 'items' => (int) $r['items']];
}
