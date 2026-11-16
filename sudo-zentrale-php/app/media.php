<?php
// media.php – 1.8: YouTube-Kanäle (neue Videos) und Musikwünsche über Spotify (z. B. auf der Alexa im Büro).
// Gleiche Antworten wie src/media.js der Node-Version.
declare(strict_types=1);

/* ---------- Web-Abruf ---------- */
function http_req(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 10): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'Sudo-Zentrale/' . APP_VERSION]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $out = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, $out === false ? '' : (string) $out, $err];
}

/* =====================================================================
   YouTube: öffentliche Kanal-Feeds, kein API-Schlüssel nötig
   ===================================================================== */
function yt_base(array $cfg): string { return rtrim((string) ($cfg['youtube_base'] ?? 'https://www.youtube.com'), '/'); }
// Feed lesen: neueste Videos zuerst
function yt_feed(array $cfg, string $channelId): array
{
    [$code, $xml, $err] = http_req('GET', yt_base($cfg) . '/feeds/videos.xml?channel_id=' . rawurlencode($channelId), ['Accept-Language: de-DE,de;q=0.9']);
    if ($code !== 200 || $xml === '') throw new RuntimeException($code === 404 ? 'Kanal nicht gefunden.' : 'YouTube nicht erreichbar (' . ($code ?: $err) . ').');
    $prev = libxml_use_internal_errors(true);
    $doc = simplexml_load_string($xml);
    libxml_use_internal_errors($prev);
    if (!$doc) throw new RuntimeException('Feed nicht lesbar.');
    $doc->registerXPathNamespace('a', 'http://www.w3.org/2005/Atom');
    $title = (string) ($doc->title ?? '');
    $videos = [];
    foreach ($doc->entry as $e) {
        $yt = $e->children('http://www.youtube.com/xml/schemas/2015');
        $id = (string) $yt->videoId;
        if (!preg_match('/^[\w-]{6,20}$/', $id)) continue;
        $link = '';
        foreach ($e->link as $l) if ((string) $l['rel'] === 'alternate') $link = (string) $l['href'];
        $videos[] = ['id' => $id, 'title' => mb_substr(trim((string) $e->title), 0, 200), 'published' => (int) (strtotime((string) $e->published) * 1000),
            'short' => str_contains($link, '/shorts/')];
    }
    usort($videos, fn($a, $b) => $b['published'] <=> $a['published']);
    return ['title' => mb_substr(trim($title), 0, 100), 'videos' => $videos];
}
// Eingabe → Kanal-ID: UC…-ID, Kanal-Link oder @Handle (dann Kanalseite einmal abrufen)
function yt_resolve(array $cfg, string $in): array
{
    $in = trim($in);
    if (preg_match('/(UC[\w-]{22})/', $in, $m)) return [$m[1], ''];
    if (preg_match('~(?:youtube\.com/)?@([\w.\-]{3,40})~u', $in, $m) || preg_match('~^([\w.\-]{3,40})$~u', $in, $m)) {
        $handle = $m[1];
        [$code, $html] = http_req('GET', yt_base($cfg) . '/@' . rawurlencode($handle), ['Accept-Language: de-DE,de;q=0.9', 'Cookie: SOCS=CAI; CONSENT=YES+cb']);
        if ($code === 200 && (preg_match('~<link rel="canonical" href="[^"]*/channel/(UC[\w-]{22})"~', $html, $c)
            || preg_match('~"externalId":"(UC[\w-]{22})"~', $html, $c) || preg_match('~"channelId":"(UC[\w-]{22})"~', $html, $c))) return [$c[1], '@' . $handle];
        throw new RuntimeException('Kanal „@' . $handle . '“ nicht gefunden. Tipp: Auf der Kanalseite „Teilen → Kanal-ID kopieren“ und die ID (beginnt mit UC…) eintragen.');
    }
    throw new RuntimeException('Bitte einen Kanal-Link, ein @Handle oder eine Kanal-ID (UC…) eintragen.');
}
function yt_add(Db $db, array $cfg, array $b, string $who): array
{
    [$cid, $handle] = yt_resolve($cfg, (string) ($b['input'] ?? ''));
    if ($db->get('SELECT 1 FROM yt_channels WHERE channel_id = ?', [$cid])) fail(409, 'Dieser Kanal ist schon eingetragen.');
    $target = isset($b['target']) && $b['target'] !== '' ? valid_target($b['target']) : 'all';
    $feed = yt_feed($cfg, $cid);
    $newest = $feed['videos'][0] ?? null;
    // Beim Anlegen gelten alle vorhandenen Videos als bekannt – gemeldet wird erst das nächste
    $db->run('INSERT INTO yt_channels (channel_id, title, handle, target, shorts, active, last_check, last_error, last_video, last_published, sent, created) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?)',
        [$cid, $feed['title'] ?: $cid, $handle, $target, !empty($b['shorts']) ? 1 : 0, now_ms(), '', $newest['id'] ?? '', $newest['published'] ?? 0, now_ms()]);
    $nid = $db->lastId();                         // vor dem Protokolleintrag lesen (1.10)
    $db->audit($who, 'youtube_add', ($feed['title'] ?: $cid) . ' → ' . $target);
    return ['id' => $nid, 'title' => $feed['title'], 'latest' => $newest];
}
// Alle fälligen Kanäle prüfen; neue Videos als Meldung „video“ an das Ziel des Kanals
function yt_check(Db $db, array $cfg, bool $force = false): array
{
    $s = $db->settings();
    if (($s['youtube_enabled'] ?? 'true') !== 'true' && !$force) return ['checked' => 0, 'new' => 0];
    $every = max(5, min(240, (int) ($s['youtube_interval'] ?? 15))) * 60000;
    $checked = 0; $new = 0;
    foreach ($db->all('SELECT * FROM yt_channels WHERE active = 1 ORDER BY last_check') as $c) {
        if (!$force && now_ms() - (int) $c['last_check'] < $every) continue;
        $checked++;
        try {
            $feed = yt_feed($cfg, $c['channel_id']);
            $fresh = array_values(array_filter($feed['videos'], fn($v) => $v['published'] > (int) $c['last_published'] && $v['id'] !== $c['last_video'] && ($c['shorts'] || !$v['short'])));
            $fresh = array_reverse(array_slice($fresh, 0, 3));               // höchstens 3 pro Abruf, ältestes zuerst
            foreach ($fresh as $v) {
                $title = $feed['title'] ?: $c['title'];
                publish($db, $cfg, ['type' => 'video', 'titel' => $v['title'], 'kanal' => $title, 'video' => $v['id'], 'link' => 'https://www.youtube.com/watch?v=' . $v['id']],
                    $c['target'], (int) ($s['youtube_ttl'] ?? 480), 'youtube:' . $title);
                $db->insertIgnore('yt_videos', ['video_id' => $v['id'], 'channel_id' => $c['channel_id'], 'title' => $v['title'], 'published' => $v['published'], 'sent' => now_ms()]);
                $new++;
            }
            $top = $feed['videos'][0] ?? null;
            $db->run('UPDATE yt_channels SET last_check = ?, last_error = ?, title = ?, last_video = ?, last_published = ?, sent = sent + ? WHERE id = ?',
                [now_ms(), '', $feed['title'] ?: $c['title'], $top && $top['published'] >= (int) $c['last_published'] ? $top['id'] : $c['last_video'],
                 max((int) $c['last_published'], (int) ($top['published'] ?? 0)), count($fresh), $c['id']]);
        } catch (Throwable $e) {
            $db->run('UPDATE yt_channels SET last_check = ?, last_error = ? WHERE id = ?', [now_ms(), mb_substr($e->getMessage(), 0, 200), $c['id']]);
        }
    }
    return ['checked' => $checked, 'new' => $new];
}
// Läuft nach der Antwort an einen Sudo (Webspace hat keinen Zeitplaner): höchstens ein Durchlauf pro Minute
function yt_maybe_check_later(Db $db, array $cfg): void
{
    $s = $db->settings();
    if (($s['youtube_enabled'] ?? 'true') !== 'true') return;
    if ((int) ($s['youtube_next'] ?? 0) > now_ms()) return;
    if (!$db->get('SELECT 1 FROM yt_channels WHERE active = 1 LIMIT 1')) return;
    $db->setSetting('youtube_next', (string) (now_ms() + 60000));
    register_shutdown_function(function () use ($db, $cfg) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { yt_check($db, $cfg); } catch (Throwable $e) { error_log('Sudo-Zentrale YouTube: ' . $e->getMessage()); }
    });
}
function yt_channel_public(array $c): array
{
    return ['id' => (int) $c['id'], 'channelId' => $c['channel_id'], 'title' => $c['title'], 'handle' => (string) $c['handle'], 'target' => $c['target'], 'shorts' => (bool) $c['shorts'],
        'active' => (bool) $c['active'], 'lastCheck' => (int) $c['last_check'] ?: null, 'lastError' => (string) $c['last_error'], 'sent' => (int) $c['sent'],
        'lastPublished' => (int) $c['last_published'] ?: null];
}

// Was jeder Sudo beim Abruf erfährt
function media_public(Db $db, array $dev, array $s): array
{
    $m = music_settings($s);
    return ['youtube' => ($s['youtube_enabled'] ?? 'true') === 'true', 'music' => ['enabled' => $m['enabled'] && $m['connected'] && $m['deviceId'] !== '' && target_matches($m['target'], $dev), 'cost' => $m['cost']]];
}

/* =====================================================================
   Musikwünsche: Spotify-Konto der Firma, Wiedergabe z. B. auf dem Echo im Büro
   ===================================================================== */
function sp_api(array $cfg): string { return rtrim((string) ($cfg['spotify_api'] ?? 'https://api.spotify.com'), '/'); }
function sp_accounts(array $cfg): string { return rtrim((string) ($cfg['spotify_accounts'] ?? 'https://accounts.spotify.com'), '/'); }
function sp_redirect(array $cfg): string { return $cfg['public_url'] . '/admin/spotify/callback'; }
function music_settings(array $s): array
{
    return ['enabled' => ($s['music_enabled'] ?? 'false') === 'true', 'target' => (string) ($s['music_target'] ?? 'all') ?: 'all', 'cost' => max(0, min(5000, (int) ($s['music_cost'] ?? 100))),
        'perDay' => max(1, min(20, (int) ($s['music_per_day'] ?? 3))), 'gapMin' => max(0, min(120, (int) ($s['music_gap_min'] ?? 5))),
        'from' => (string) ($s['music_from'] ?? '08:00'), 'to' => (string) ($s['music_to'] ?? '18:00'), 'explicit' => ($s['music_explicit'] ?? 'false') === 'true',
        'announce' => in_array($s['music_announce'] ?? 'name', ['name', 'anon', 'off'], true) ? ($s['music_announce'] ?? 'name') : 'name',
        'deviceId' => (string) ($s['spotify_device_id'] ?? ''), 'deviceName' => (string) ($s['spotify_device_name'] ?? ''), 'account' => (string) ($s['spotify_account'] ?? ''),
        'clientId' => (string) ($s['spotify_client_id'] ?? ''), 'secretSet' => ($s['spotify_client_secret'] ?? '') !== '', 'connected' => ($s['spotify_refresh'] ?? '') !== ''];
}
function sp_token(Db $db, array $cfg): string
{
    $s = $db->settings();
    if (($s['spotify_refresh'] ?? '') === '') throw new RuntimeException('Spotify ist nicht verbunden.');
    if (($s['spotify_access'] ?? '') !== '' && (int) ($s['spotify_access_exp'] ?? 0) > now_ms() + 60000) return $s['spotify_access'];
    [$code, $out] = http_req('POST', sp_accounts($cfg) . '/api/token', ['Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode(($s['spotify_client_id'] ?? '') . ':' . ($s['spotify_client_secret'] ?? ''))],
        http_build_query(['grant_type' => 'refresh_token', 'refresh_token' => $s['spotify_refresh']]));
    $j = json_decode($out, true) ?: [];
    if ($code !== 200 || empty($j['access_token'])) throw new RuntimeException('Spotify-Anmeldung abgelaufen – bitte in der Zentrale neu verbinden.');
    $db->setSetting('spotify_access', $j['access_token']);
    $db->setSetting('spotify_access_exp', (string) (now_ms() + ((int) ($j['expires_in'] ?? 3600)) * 1000));
    if (!empty($j['refresh_token'])) $db->setSetting('spotify_refresh', $j['refresh_token']);
    return $j['access_token'];
}
function sp_call(Db $db, array $cfg, string $method, string $path, ?array $query = null): array
{
    $url = sp_api($cfg) . $path . ($query ? '?' . http_build_query($query) : '');
    [$code, $out, $err] = http_req($method, $url, ['Authorization: Bearer ' . sp_token($db, $cfg), 'Content-Length: 0'], $method === 'GET' ? null : '');
    return [$code, $out === '' ? null : json_decode($out, true), $err];
}
function sp_track_public(array $t): array
{
    $img = '';
    foreach (array_reverse($t['album']['images'] ?? []) as $i) { if (($i['width'] ?? 0) >= 64) { $img = (string) $i['url']; break; } }
    return ['id' => (string) $t['id'], 'name' => mb_substr((string) $t['name'], 0, 120), 'artist' => mb_substr(implode(', ', array_map(fn($a) => $a['name'], $t['artists'] ?? [])), 0, 120),
        'album' => mb_substr((string) ($t['album']['name'] ?? ''), 0, 120), 'image' => preg_match('~^https://i\.scdn\.co/~', $img) ? $img : '',
        'ms' => (int) ($t['duration_ms'] ?? 0), 'explicit' => !empty($t['explicit'])];
}
function music_in_hours(array $m): bool
{
    $now = date('H:i');
    return $m['from'] <= $m['to'] ? ($now >= $m['from'] && $now < $m['to']) : ($now >= $m['from'] || $now < $m['to']);
}
// Stand für ein Gerät: darf es wünschen, wie viele noch, wann wieder
function music_status(Db $db, array $dev, array $s): array
{
    $m = music_settings($s);
    $ok = $m['enabled'] && $m['connected'] && $m['deviceId'] !== '' && target_matches($m['target'], $dev);
    $used = (int) $db->get("SELECT COUNT(*) AS n FROM music_requests WHERE day = ? AND device_id = ? AND status = 'queued'", [day_key(), $dev['id']])['n'];
    $last = (int) ($db->get("SELECT MAX(at) AS t FROM music_requests WHERE status = 'queued'")['t'] ?? 0);
    $wait = max(0, (int) ceil(($last + $m['gapMin'] * 60000 - now_ms()) / 1000));
    return ['enabled' => $ok, 'cost' => $m['cost'], 'perDay' => $m['perDay'], 'left' => max(0, $m['perDay'] - $used), 'waitSec' => $wait,
        'hours' => $m['from'] . '–' . $m['to'], 'open' => music_in_hours($m), 'device' => $m['deviceName'], 'explicit' => $m['explicit']];
}
function music_search(Db $db, array $cfg, array $dev, string $q): array
{
    $st = music_status($db, $dev, $db->settings());
    if (!$st['enabled']) fail(403, 'Musikwünsche sind gerade nicht freigeschaltet.');
    $q = trim(mb_substr($q, 0, 100));
    if (mb_strlen($q) < 2) fail(400, 'Bitte mindestens zwei Zeichen eingeben.');
    [$code, $j] = sp_call($db, $cfg, 'GET', '/v1/search', ['q' => $q, 'type' => 'track', 'limit' => 10, 'market' => 'DE']);
    if ($code !== 200) fail(502, 'Spotify-Suche gerade nicht möglich (' . $code . ').');
    $tracks = array_map('sp_track_public', $j['tracks']['items'] ?? []);
    if (!$st['explicit']) $tracks = array_values(array_filter($tracks, fn($t) => !$t['explicit']));
    $blocked = array_column($db->all('SELECT track_id FROM music_blocked'), 'track_id');
    $tracks = array_values(array_filter($tracks, fn($t) => !in_array($t['id'], $blocked, true)));
    // Nur Titel aus der eigenen letzten Suche dürfen gewünscht werden (die Zentrale prüft, nicht der PC)
    $db->upsert('music_cache', ['device_id' => $dev['id'], 'at' => now_ms(), 'data' => json_encode($tracks, JSON_UNESCAPED_UNICODE)], ['device_id']);
    return $tracks;
}
function music_request(Db $db, array $cfg, array $dev, array $b): array
{
    $s = $db->settings(); $m = music_settings($s); $st = music_status($db, $dev, $s);
    if (!$st['enabled']) fail(403, 'Musikwünsche sind gerade nicht freigeschaltet.');
    if (!$st['open']) fail(403, 'Musikwünsche gehen nur von ' . $st['hours'] . ' Uhr.');
    if ($st['left'] <= 0) fail(429, 'Für heute sind deine Wünsche aufgebraucht.');
    if ($st['waitSec'] > 0) fail(429, 'Kurz warten – der nächste Wunsch geht in ' . max(1, (int) ceil($st['waitSec'] / 60)) . ' min.');
    if (isset($b['xp']) && is_numeric($b['xp']) && (int) $b['xp'] < $m['cost']) fail(402, 'Dafür fehlen dir noch XP.');
    $cache = $db->get('SELECT * FROM music_cache WHERE device_id = ?', [$dev['id']]);
    $tracks = $cache && (int) $cache['at'] > now_ms() - 3600000 ? (json_decode($cache['data'], true) ?: []) : [];
    $t = null; foreach ($tracks as $x) if ($x['id'] === (string) ($b['id'] ?? '')) $t = $x;
    if (!$t) fail(400, 'Bitte den Titel neu suchen und dann wünschen.');
    if ($t['explicit'] && !$m['explicit']) fail(403, 'Dieser Titel ist gesperrt (explicit).');
    if ($db->get('SELECT 1 FROM music_blocked WHERE track_id = ?', [$t['id']])) fail(403, 'Dieser Titel ist im Büro gesperrt.');
    [$code, $j] = sp_call($db, $cfg, 'POST', '/v1/me/player/queue', ['uri' => 'spotify:track:' . $t['id'], 'device_id' => $m['deviceId']]);
    $ok = $code >= 200 && $code < 300;
    $reason = (string) ($j['error']['reason'] ?? '');
    $msg = $ok ? '' : ($code === 404 || $reason === 'NO_ACTIVE_DEVICE' ? 'Auf „' . ($m['deviceName'] ?: 'dem Lautsprecher') . '“ läuft gerade kein Spotify. Erst Musik starten, dann wünschen.'
        : ($code === 403 ? 'Spotify lehnt ab (Premium nötig oder Gerät gesperrt).' : 'Spotify-Fehler ' . $code . '.'));
    $db->run('INSERT INTO music_requests (at, day, device_id, track_id, title, artist, status, msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [now_ms(), day_key(), $dev['id'], $t['id'], $t['name'], $t['artist'], $ok ? 'queued' : 'failed', $msg]);
    if (!$ok) fail(502, $msg);
    $who = $m['announce'] === 'anon' ? 'Jemand' : visit_name($dev);
    if ($m['announce'] !== 'off') publish($db, $cfg, ['type' => 'music', 'titel' => $t['name'], 'artist' => $t['artist'], 'von' => $who], $m['target'], 20, 'musik');
    return ['ok' => true, 'cost' => $m['cost'], 'track' => $t];
}
// Live-Warteschlange von Spotify: was läuft, was kommt (null, wenn Spotify nicht antwortet)
function music_queue_live(Db $db, array $cfg): ?array
{
    try { [$c, $j] = sp_call($db, $cfg, 'GET', '/v1/me/player/queue'); } catch (Throwable $e) { return null; }
    if ($c !== 200 || !is_array($j)) return null;
    $t = fn($x) => is_array($x) && !empty($x['id']) ? ['id' => (string) $x['id'], 'name' => (string) ($x['name'] ?? ''), 'artist' => implode(', ', array_map(fn($a) => $a['name'], $x['artists'] ?? []))] : null;
    return ['current' => $t($j['currently_playing'] ?? null), 'queue' => array_values(array_filter(array_map($t, array_slice($j['queue'] ?? [], 0, 20))))];
}
// Status je Wunsch: läuft gerade, in der Warteschlange (Platz), gespielt, gesperrt, übersprungen
function music_live_state(array $r, ?array $live, array &$used): array
{
    if ($r['status'] !== 'queued') return ['failed', null];
    if ((int) $r['veto']) return [(int) $r['skipped'] ? 'skipped' : 'vetoed', null];
    if (!$live) return ['requested', null];
    if ($live['current'] && $live['current']['id'] === $r['track_id'] && empty($used['cur'])) { $used['cur'] = 1; return ['playing', null]; }
    foreach ($live['queue'] as $i => $q) if ($q['id'] === $r['track_id'] && empty($used['q' . $i])) { $used['q' . $i] = 1; return ['queued', $i + 1]; }
    return ['played', null];
}
function music_skip(Db $db, array $cfg): void
{
    $m = music_settings($db->settings());
    [$c] = sp_call($db, $cfg, 'POST', '/v1/me/player/next', $m['deviceId'] ? ['device_id' => $m['deviceId']] : null);
    if ($c < 200 || $c >= 300) throw new RuntimeException($c === 404 ? 'Gerade läuft nichts über Spotify.' : 'Spotify hat das Überspringen abgelehnt (' . $c . ').');
}
// Gesperrte Wünsche: sobald sie laufen, automatisch überspringen (4 Stunden lang beobachten)
function music_watch(Db $db, array $cfg): int
{
    $pending = $db->all('SELECT * FROM music_requests WHERE veto = 1 AND skipped = 0 AND at > ?', [now_ms() - 4 * 3600000]);
    if (!$pending) return 0;
    try { [$c, $j] = sp_call($db, $cfg, 'GET', '/v1/me/player/currently-playing'); } catch (Throwable $e) { return 0; }
    $cur = (string) ($j['item']['id'] ?? '');
    if ($c !== 200 || $cur === '') return 0;
    foreach ($pending as $p) if ($p['track_id'] === $cur) {
        try { music_skip($db, $cfg); } catch (Throwable $e) { return 0; }
        $db->run('UPDATE music_requests SET skipped = 1 WHERE veto = 1 AND skipped = 0 AND track_id = ?', [$cur]);
        $db->audit('musik', 'music_autoskip', $p['title'] . ' – ' . $p['artist']);
        return 1;
    }
    return 0;
}
// Nach der Antwort an einen Sudo: höchstens alle 10 Sekunden nachsehen (nur wenn etwas gesperrt ist)
function music_maybe_watch_later(Db $db, array $cfg): void
{
    $s = $db->settings();
    if ((int) ($s['music_watch_next'] ?? 0) > now_ms()) return;
    if (!$db->get('SELECT 1 FROM music_requests WHERE veto = 1 AND skipped = 0 AND at > ? LIMIT 1', [now_ms() - 4 * 3600000])) return;
    $db->setSetting('music_watch_next', (string) (now_ms() + 10000));
    register_shutdown_function(function () use ($db, $cfg) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try { music_watch($db, $cfg); } catch (Throwable $e) { error_log('Sudo-Zentrale Musik: ' . $e->getMessage()); }
    });
}
// Wunsch sperren: Titel kommt auf die Sperrliste, läuft er gerade, sofort weiter
function music_veto(Db $db, array $cfg, int $id, string $who): array
{
    $r = $db->get('SELECT * FROM music_requests WHERE id = ?', [$id]) ?? fail(404, 'Wunsch nicht gefunden.');
    $db->run('UPDATE music_requests SET veto = 1 WHERE track_id = ? AND status = ? AND at > ?', [$r['track_id'], 'queued', now_ms() - 4 * 3600000]);
    $db->insertIgnore('music_blocked', ['track_id' => $r['track_id'], 'title' => $r['title'], 'artist' => $r['artist'], 'at' => now_ms(), 'by_' => $who]);
    $db->audit($who, 'music_veto', $r['title'] . ' – ' . $r['artist']);
    $skipped = music_watch($db, $cfg) > 0;
    return ['ok' => true, 'skippedNow' => $skipped];
}

// Admin: Spotify-Geräte und was gerade läuft
function music_admin(Db $db, array $cfg): array
{
    $s = $db->settings(); $m = music_settings($s);
    $out = ['settings' => $m, 'redirectUri' => sp_redirect($cfg), 'devices' => [], 'playing' => null, 'error' => '', 'queue' => null,
        'blocked' => array_map(fn($b) => ['trackId' => $b['track_id'], 'title' => $b['title'], 'artist' => $b['artist'], 'at' => (int) $b['at'], 'by' => $b['by_']], $db->all('SELECT * FROM music_blocked ORDER BY at DESC')),
        'today' => (int) $db->get("SELECT COUNT(*) AS n FROM music_requests WHERE day = ? AND status = 'queued'", [day_key()])['n'],
        'recent' => []];
    $rows = $db->all('SELECT r.*, COALESCE(d.visit_name, d.user, d.name) AS vname FROM music_requests r LEFT JOIN devices d ON d.id = r.device_id ORDER BY r.id DESC LIMIT 20');
    if ($m['connected']) {
        try {
            [$c, $j] = sp_call($db, $cfg, 'GET', '/v1/me/player/devices');
            if ($c === 200) $out['devices'] = array_map(fn($d) => ['id' => (string) $d['id'], 'name' => (string) $d['name'], 'type' => (string) ($d['type'] ?? ''), 'active' => !empty($d['is_active'])], $j['devices'] ?? []);
            [$c, $j] = sp_call($db, $cfg, 'GET', '/v1/me/player');
            if ($c === 200 && !empty($j['item'])) $out['playing'] = ['name' => $j['item']['name'] ?? '', 'artist' => implode(', ', array_map(fn($a) => $a['name'], $j['item']['artists'] ?? [])),
                'device' => $j['device']['name'] ?? '', 'isPlaying' => !empty($j['is_playing'])];
        } catch (Throwable $e) { $out['error'] = $e->getMessage(); }
        $out['queue'] = music_queue_live($db, $cfg);
    }
    // Neueste Wünsche zuerst: der jüngste Wunsch eines Titels bekommt den Platz in der Warteschlange
    $used = [];
    foreach (array_reverse($rows) as $r) { [$st, $pos] = music_live_state($r, $out['queue'], $used); $r['_st'] = $st; $r['_pos'] = $pos; $mapped[] = $r; }
    $out['recent'] = array_map(fn($r) => ['id' => (int) $r['id'], 'at' => (int) $r['at'], 'title' => $r['title'], 'artist' => $r['artist'], 'status' => $r['_st'], 'pos' => $r['_pos'],
        'msg' => $r['msg'], 'from' => $r['vname'] ?? '?', 'trackId' => $r['track_id']], array_reverse($mapped ?? []));
    return $out;
}
