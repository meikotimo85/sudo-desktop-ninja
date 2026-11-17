<?php
// db.php – Datenbank (SQLite oder MySQL über PDO), Schema und kleine Helfer
declare(strict_types=1);

final class Db
{
    public PDO $pdo;
    public string $driver;

    public function __construct(array $cfg)
    {
        $this->pdo = new PDO($cfg['dsn'], $cfg['user'] ?? null, $cfg['pass'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $this->driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($this->driver === 'sqlite') {
            $this->pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000; PRAGMA foreign_keys = ON;');
        }
        $this->migrate();
    }

    private function migrate(): void
    {
        $id = $this->driver === 'mysql' ? 'VARCHAR(64)' : 'TEXT';
        $txt = $this->driver === 'mysql' ? 'VARCHAR(255)' : 'TEXT';
        $long = 'TEXT';
        $auto = $this->driver === 'mysql' ? 'BIGINT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $eng = $this->driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
        $sql = [
            "CREATE TABLE IF NOT EXISTS devices (id $id PRIMARY KEY, name $txt NOT NULL, user $txt, host $txt, version $txt, lang $txt,
              groups_ $txt NOT NULL DEFAULT '', token_hash $id NOT NULL UNIQUE, created BIGINT NOT NULL, last_seen BIGINT,
              revoked INTEGER NOT NULL DEFAULT 0, ai_daily_cents INTEGER NULL)$eng",
            "CREATE TABLE IF NOT EXISTS enroll_codes (id $id PRIMARY KEY, code_hash $id NOT NULL UNIQUE, label $txt, groups_ $txt NOT NULL DEFAULT '',
              created BIGINT NOT NULL, expires BIGINT NULL, uses_left INTEGER NULL, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)$eng",
            "CREATE TABLE IF NOT EXISTS api_keys (id $id PRIMARY KEY, name $txt NOT NULL, key_hash $id NOT NULL UNIQUE, prefix $txt, created BIGINT NOT NULL,
              last_used BIGINT NULL, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)$eng",
            "CREATE TABLE IF NOT EXISTS messages (id $auto, created BIGINT NOT NULL, expires BIGINT NOT NULL, type $txt NOT NULL,
              payload $long NOT NULL, target $txt NOT NULL DEFAULT 'all', author $txt)$eng",
            "CREATE TABLE IF NOT EXISTS deliveries (message_id BIGINT NOT NULL, device_id $id NOT NULL, delivered BIGINT NOT NULL, PRIMARY KEY (message_id, device_id))$eng",
            "CREATE TABLE IF NOT EXISTS ai_usage (day $id NOT NULL, device_id $id NOT NULL, model $id NOT NULL, q INTEGER NOT NULL DEFAULT 0,
              tin BIGINT NOT NULL DEFAULT 0, tout BIGINT NOT NULL DEFAULT 0, usd_micro BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (day, device_id, model))$eng",
            "CREATE TABLE IF NOT EXISTS settings (k $id PRIMARY KEY, v $txt NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS sessions (id $id PRIMARY KEY, user $txt NOT NULL, name $txt, via $txt, csrf $id NOT NULL, created BIGINT NOT NULL, expires BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS audit (id $auto, ts BIGINT NOT NULL, actor $txt, action $txt NOT NULL, detail $long)$eng",
            "CREATE TABLE IF NOT EXISTS rate_limits (k $txt PRIMARY KEY, n INTEGER NOT NULL, reset_at BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS visits (id $auto, created BIGINT NOT NULL, day $id NOT NULL, from_id $id NOT NULL, to_id $id NOT NULL,
              kind $id NOT NULL, note $txt, status $id NOT NULL DEFAULT 'sent', result $id, result_at BIGINT)$eng",
            // 1.5: Security-Quiz – eigene Fragen und anonyme Auswertung (nur Zählerstände pro Tag und Frage)
            "CREATE TABLE IF NOT EXISTS quiz_questions (id $auto, created BIGINT NOT NULL, updated BIGINT NOT NULL, q $long NOT NULL, answers $long NOT NULL,
              ok INTEGER NOT NULL, why $long, link $txt, active INTEGER NOT NULL DEFAULT 1)$eng",
            "CREATE TABLE IF NOT EXISTS quiz_stats (day $id NOT NULL, qid $id NOT NULL, n INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, qid))$eng",
            "CREATE TABLE IF NOT EXISTS quiz_labels (qid $id PRIMARY KEY, text $long NOT NULL)$eng",
            // 1.6: Betrieb – Störungen, Neustart-Kampagnen, Selbsthilfe-Zähler (anonym)
            "CREATE TABLE IF NOT EXISTS incidents (id $auto, created BIGINT NOT NULL, updated BIGINT NOT NULL, resolved BIGINT NULL, title $txt NOT NULL, text $long,
              sev $id NOT NULL DEFAULT 'stoerung', link $txt, target $txt NOT NULL DEFAULT 'all', author $txt, resolved_by $txt, resolve_text $long)$eng",
            "CREATE TABLE IF NOT EXISTS incident_affected (incident_id BIGINT NOT NULL, device_id $id NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (incident_id, device_id))$eng",
            "CREATE TABLE IF NOT EXISTS restart_campaigns (id $auto, created BIGINT NOT NULL, title $txt NOT NULL, text $long, deadline BIGINT NULL, target $txt NOT NULL DEFAULT 'all',
              mode $id NOT NULL DEFAULT 'all', days INTEGER NOT NULL DEFAULT 7, active INTEGER NOT NULL DEFAULT 1, ended BIGINT NULL, author $txt)$eng",
            "CREATE TABLE IF NOT EXISTS restart_status (campaign_id BIGINT NOT NULL, device_id $id NOT NULL, state $id NOT NULL, boot_at BIGINT NULL, snooze_until BIGINT NULL,
              snoozes INTEGER NOT NULL DEFAULT 0, up_days INTEGER NULL, updated BIGINT NOT NULL, PRIMARY KEY (campaign_id, device_id))$eng",
            // 1.7: Regeln – eingehende Meldungen einordnen
            "CREATE TABLE IF NOT EXISTS rules (id $auto, pos INTEGER NOT NULL DEFAULT 100, name $txt NOT NULL, active INTEGER NOT NULL DEFAULT 1, match_type $id NOT NULL DEFAULT '',
              field $id NOT NULL DEFAULT 'title', mode $id NOT NULL DEFAULT 'words', pattern $long NOT NULL, action $id NOT NULL, extract $id NOT NULL DEFAULT 'rest',
              target $txt NOT NULL DEFAULT '', dur $id NOT NULL DEFAULT '', ttl INTEGER NULL, link_tpl $txt NOT NULL DEFAULT '', hits INTEGER NOT NULL DEFAULT 0, last_hit BIGINT NULL,
              created BIGINT NOT NULL, updated BIGINT NOT NULL)$eng",
            // 1.12: Plugins – HTML-Werkzeuge für die Sudos (MySQL: MEDIUMTEXT, weil TEXT nur 64 KB fasst)
            "CREATE TABLE IF NOT EXISTS plugins (id $id PRIMARY KEY, name $txt NOT NULL, version $txt NOT NULL DEFAULT '', html " . ($this->driver === 'mysql' ? 'MEDIUMTEXT' : 'TEXT') . " NOT NULL,
              sha $id NOT NULL, size INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 900, h INTEGER NOT NULL DEFAULT 720, target $txt NOT NULL DEFAULT 'all',
              active INTEGER NOT NULL DEFAULT 1, author $txt, created BIGINT NOT NULL, updated BIGINT NOT NULL)$eng",
            // 1.8: YouTube-Kanäle und Musikwünsche
            "CREATE TABLE IF NOT EXISTS yt_channels (id $auto, channel_id $id NOT NULL UNIQUE, title $txt NOT NULL, handle $txt, target $txt NOT NULL DEFAULT 'all',
              shorts INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, last_check BIGINT NOT NULL DEFAULT 0, last_error $txt, last_video $id, last_published BIGINT NOT NULL DEFAULT 0,
              sent INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS yt_videos (video_id $id PRIMARY KEY, channel_id $id NOT NULL, title $txt, published BIGINT NOT NULL, sent BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS music_requests (id $auto, at BIGINT NOT NULL, day $id NOT NULL, device_id $id NOT NULL, track_id $id NOT NULL, title $txt, artist $txt,
              status $id NOT NULL, msg $txt, veto INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0)$eng",
            "CREATE TABLE IF NOT EXISTS music_blocked (track_id $id PRIMARY KEY, title $txt, artist $txt, at BIGINT NOT NULL, by_ $txt)$eng",
            "CREATE TABLE IF NOT EXISTS music_cache (device_id $id PRIMARY KEY, at BIGINT NOT NULL, data $long NOT NULL)$eng",
            // 1.9: Wissen & Anleitungen aus SharePoint
            "CREATE TABLE IF NOT EXISTS kb_sources (id $auto, url $long NOT NULL, kind $id NOT NULL, site_id $txt NOT NULL, drive_id $txt NOT NULL DEFAULT '', folder_id $txt NOT NULL DEFAULT '',
              title $txt NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_sync BIGINT NOT NULL DEFAULT 0, last_error $txt, items INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS kb_items (id $auto, source_id BIGINT NOT NULL, item_id $id NOT NULL, kind $id NOT NULL, title $txt NOT NULL, path $long NOT NULL,
              url $long NOT NULL, ext $id NOT NULL DEFAULT '', modified BIGINT NOT NULL DEFAULT 0, etag $txt, text $long, norm $long, synced BIGINT NOT NULL DEFAULT 0, UNIQUE (source_id, item_id))$eng",
            "CREATE TABLE IF NOT EXISTS selfhelp_stats (day $id NOT NULL, tool $id NOT NULL, n INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, tool))$eng",
            // 1.10: Mitarbeiter-Erlebnis – Stimmungsbarometer (Antworten ohne Gerät), Rückmeldung nach Störungen, Start-Checkliste
            "CREATE TABLE IF NOT EXISTS pulse_surveys (id $auto, created BIGINT NOT NULL, question $txt NOT NULL, kind $id NOT NULL DEFAULT 'custom', period $id NULL,
              target $txt NOT NULL DEFAULT 'all', active INTEGER NOT NULL DEFAULT 1, ends BIGINT NULL, author $txt)$eng",
            "CREATE TABLE IF NOT EXISTS pulse_done (survey_id BIGINT NOT NULL, device_id $id NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (survey_id, device_id))$eng",
            "CREATE TABLE IF NOT EXISTS pulse_votes (survey_id BIGINT NOT NULL, score INTEGER NOT NULL, health $id NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (survey_id, score, health))$eng",
            "CREATE TABLE IF NOT EXISTS pulse_comments (id $auto, survey_id BIGINT NOT NULL, day $id NOT NULL, score INTEGER NOT NULL, text $long NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS incident_feedback (incident_id BIGINT NOT NULL, device_id $id NOT NULL, ok INTEGER NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (incident_id, device_id))$eng",
            "CREATE TABLE IF NOT EXISTS onboard_items (id $auto, pos INTEGER NOT NULL DEFAULT 100, title $txt NOT NULL, text $long, check_ $id NOT NULL DEFAULT 'manual', link $txt,
              target $txt NOT NULL DEFAULT 'all', active INTEGER NOT NULL DEFAULT 1, created BIGINT NOT NULL)$eng",
            "CREATE TABLE IF NOT EXISTS onboard_status (device_id $id NOT NULL, item_id BIGINT NOT NULL, done INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0, at BIGINT NOT NULL, PRIMARY KEY (device_id, item_id))$eng",
        ];
        foreach ($sql as $s) $this->pdo->exec($s);
        // Spalten, die später dazugekommen sind (1.4: Besuche) – nur einmal pro Datenbank
        $schema = $this->get("SELECT v FROM settings WHERE k = 'schema'");
        if (!$schema || (int) $schema['v'] < 2) {
            foreach (['allow_visits INTEGER NOT NULL DEFAULT 1', "visit_name $txt NULL"] as $col) {
                try { $this->pdo->exec("ALTER TABLE devices ADD COLUMN $col"); } catch (Throwable $e) { /* vorhanden */ }
            }
            $this->upsert('settings', ['k' => 'schema', 'v' => '2'], ['k']);
        }
        // 1.5: Gerätezustand je Gerät (nur Ampel-Zusammenfassung)
        $schema = $this->get("SELECT v FROM settings WHERE k = 'schema'");
        if ((int) ($schema['v'] ?? 0) < 3) {
            foreach (["health $long NULL", 'health_at BIGINT NULL'] as $col) {
                try { $this->pdo->exec("ALTER TABLE devices ADD COLUMN $col"); } catch (Throwable $e) { /* vorhanden */ }
            }
            $this->upsert('settings', ['k' => 'schema', 'v' => '3'], ['k']);
        }
        // 1.8.1: Musikwünsche sperren und überspringen
        $schema = $this->get("SELECT v FROM settings WHERE k = 'schema'");
        if ((int) ($schema['v'] ?? 0) >= 5 && (int) ($schema['v'] ?? 0) < 6) {
            foreach (['veto INTEGER NOT NULL DEFAULT 0', 'skipped INTEGER NOT NULL DEFAULT 0'] as $col) {
                try { $this->pdo->exec("ALTER TABLE music_requests ADD COLUMN $col"); } catch (Throwable $e) { /* vorhanden */ }
            }
            $this->upsert('settings', ['k' => 'schema', 'v' => '6'], ['k']);
        }
        // 1.5: Anmeldename (UPN) für Meldungen an eine Person (user:…)
        $schema = $this->get("SELECT v FROM settings WHERE k = 'schema'");
        if ((int) ($schema['v'] ?? 0) < 4) {
            try { $this->pdo->exec("ALTER TABLE devices ADD COLUMN upn $txt NULL"); } catch (Throwable $e) { /* vorhanden */ }
            $this->upsert('settings', ['k' => 'schema', 'v' => '4'], ['k']);
        }
        // 1.9: Diagnose je Gerät (CPU, RAM, Abstürze, letzter Fehler) – eigene Markierung statt Schema-Nummer
        if (!$this->get("SELECT v FROM settings WHERE k = 'mig_19_diag'")) {
            foreach (["diag $long NULL", 'diag_at BIGINT NULL'] as $col) {
                try { $this->pdo->exec("ALTER TABLE devices ADD COLUMN $col"); } catch (Throwable $e) { /* vorhanden */ }
            }
            $this->upsert('settings', ['k' => 'mig_19_diag', 'v' => '1'], ['k']);
        }
        // 1.10: Start-Checkliste – Admin kann sie einem Gerät erneut zeigen (verlängert das Zeitfenster)
        if (!$this->get("SELECT v FROM settings WHERE k = 'mig_110_onboard'")) {
            try { $this->pdo->exec('ALTER TABLE devices ADD COLUMN onboard_until BIGINT NULL'); } catch (Throwable $e) { /* vorhanden */ }
            $this->upsert('settings', ['k' => 'mig_110_onboard', 'v' => '1'], ['k']);
        }
        $defaults = ['ai_enabled' => 'true', 'ai_models' => 'haiku,sonnet', 'ai_daily_cents' => '50', 'ai_monthly_cents' => '2000',
            'ai_context' => 'true', 'message_ttl_min' => '1440', 'visits_enabled' => 'true', 'visits_send_per_day' => '2', 'visits_recv_per_day' => '3',
            'quiz_enabled' => 'true', 'quiz_per_week' => '2', 'health_report' => 'true',
            // 1.10: Mitarbeiter-Erlebnis
            'pulse_enabled' => 'true', 'pulse_monthly' => 'false', 'pulse_incident' => 'true', 'pulse_min' => '5',
            'onboard_enabled' => 'false', 'onboard_days' => '30', 'tips_enabled' => 'true', 'tips_custom' => '[]',
            // 1.12: eigene Plugins der Mitarbeitenden erlaubt
            'plugins_user' => 'true'];
        foreach ($defaults as $k => $v) $this->insertIgnore('settings', ['k' => $k, 'v' => $v]);
    }

    public function all(string $sql, array $p = []): array { $s = $this->pdo->prepare($sql); $s->execute($p); return $s->fetchAll(); }
    public function get(string $sql, array $p = []): ?array { $s = $this->pdo->prepare($sql); $s->execute($p); $r = $s->fetch(); return $r ?: null; }
    public function run(string $sql, array $p = []): int { $s = $this->pdo->prepare($sql); $s->execute($p); return $s->rowCount(); }
    public function lastId(): int { return (int) $this->pdo->lastInsertId(); }

    public function insertIgnore(string $table, array $row): void
    {
        $cols = implode(', ', array_keys($row));
        $qs = implode(', ', array_fill(0, count($row), '?'));
        $verb = $this->driver === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        $this->run("$verb INTO $table ($cols) VALUES ($qs)", array_values($row));
    }
    // Zeile anlegen oder Spalten erhöhen/ersetzen; $inc = Spalten, die addiert werden, sonst überschrieben
    public function upsert(string $table, array $row, array $keys, array $inc = []): void
    {
        $cols = implode(', ', array_keys($row));
        $qs = implode(', ', array_fill(0, count($row), '?'));
        $upd = [];
        foreach (array_keys($row) as $c) {
            if (in_array($c, $keys, true)) continue;
            $upd[] = $this->driver === 'mysql'
                ? (in_array($c, $inc, true) ? "$c = $c + VALUES($c)" : "$c = VALUES($c)")
                : (in_array($c, $inc, true) ? "$c = $c + excluded.$c" : "$c = excluded.$c");
        }
        $sql = $this->driver === 'mysql'
            ? "INSERT INTO $table ($cols) VALUES ($qs) ON DUPLICATE KEY UPDATE " . implode(', ', $upd)
            : "INSERT INTO $table ($cols) VALUES ($qs) ON CONFLICT(" . implode(', ', $keys) . ") DO UPDATE SET " . implode(', ', $upd);
        $this->run($sql, array_values($row));
    }

    public function settings(): array
    {
        $out = [];
        foreach ($this->all('SELECT k, v FROM settings') as $r) $out[$r['k']] = $r['v'];
        return $out;
    }
    public function setSetting(string $k, string $v): void { $this->upsert('settings', ['k' => $k, 'v' => $v], ['k']); }
    public function audit(?string $actor, string $action, string $detail = ''): void
    {
        $this->run('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)', [now_ms(), $actor ?: 'system', $action, mb_substr($detail, 0, 500)]);
    }
    // Einfache Begrenzung: höchstens $max Aufrufe je $windowSec für einen Schlüssel
    public function limit(string $key, int $max, int $windowSec): bool
    {
        $t = now_ms();
        $r = $this->get('SELECT n, reset_at FROM rate_limits WHERE k = ?', [$key]);
        if (!$r || $r['reset_at'] < $t) { $this->upsert('rate_limits', ['k' => $key, 'n' => 1, 'reset_at' => $t + $windowSec * 1000], ['k']); return true; }
        if ($r['n'] >= $max) return false;
        $this->run('UPDATE rate_limits SET n = n + 1 WHERE k = ?', [$key]);
        return true;
    }
    public function cleanup(): void
    {
        $t = now_ms();
        $this->run('DELETE FROM sessions WHERE expires < ?', [$t]);
        $this->run('DELETE FROM rate_limits WHERE reset_at < ?', [$t - 3600e3]);
        $this->run('DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE expires < ?)', [$t - 30 * 864e5]);
        $this->run('DELETE FROM messages WHERE expires < ?', [$t - 30 * 864e5]);
        $this->run('DELETE FROM audit WHERE ts < ?', [$t - 180 * 864e5]);
        // 1.6: Betroffen-Meldungen alter Störungen nach 90 Tagen, Selbsthilfe-Zähler nach einem Jahr
        $this->run('DELETE FROM incident_affected WHERE incident_id IN (SELECT id FROM incidents WHERE resolved IS NOT NULL AND resolved < ?)', [$t - 90 * 864e5]);
        $this->run('DELETE FROM selfhelp_stats WHERE day < ?', [day_key($t - 365 * 86400000)]);
        $this->run('DELETE FROM yt_videos WHERE sent < ?', [$t - 90 * 864e5]);
        $this->run('DELETE FROM music_requests WHERE at < ?', [$t - 90 * 864e5]);
        // 1.10: Rückmeldungen zu Störungen nach 90 Tagen, beendete Umfragen nach einem Jahr
        $this->run('DELETE FROM incident_feedback WHERE incident_id IN (SELECT id FROM incidents WHERE resolved IS NOT NULL AND resolved < ?)', [$t - 90 * 864e5]);
        foreach (['pulse_done', 'pulse_votes', 'pulse_comments'] as $tb) $this->run("DELETE FROM $tb WHERE survey_id IN (SELECT id FROM pulse_surveys WHERE ends IS NOT NULL AND ends < ?)", [$t - 365 * 864e5]);
        $this->run('DELETE FROM pulse_surveys WHERE ends IS NOT NULL AND ends < ?', [$t - 365 * 864e5]);
    }
}

function now_ms(): int { return (int) floor(microtime(true) * 1000); }
function day_key(?int $ms = null): string { return date('Y-m-d', intdiv($ms ?? now_ms(), 1000)); }
function token(int $bytes = 32): string { return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '='); }
function sha(string $s): string { return hash('sha256', $s); }
