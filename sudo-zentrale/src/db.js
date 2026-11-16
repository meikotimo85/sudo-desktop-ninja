// db.js – SQLite (in Node eingebaut, keine nativen Pakete) mit Schema und kleinen Helfern
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, user TEXT, host TEXT, version TEXT, lang TEXT,
  groups_ TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL,
  last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0, ai_daily_cents INTEGER
);
CREATE TABLE IF NOT EXISTS enroll_codes (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, label TEXT, groups_ TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL, expires INTEGER, uses_left INTEGER, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT, created INTEGER NOT NULL,
  last_used INTEGER, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, expires INTEGER NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, target TEXT NOT NULL DEFAULT 'all', author TEXT
);
CREATE TABLE IF NOT EXISTS deliveries (
  message_id INTEGER NOT NULL, device_id TEXT NOT NULL, delivered INTEGER NOT NULL, PRIMARY KEY (message_id, device_id)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT NOT NULL, device_id TEXT NOT NULL, model TEXT NOT NULL, q INTEGER NOT NULL DEFAULT 0,
  tin INTEGER NOT NULL DEFAULT 0, tout INTEGER NOT NULL DEFAULT 0, usd_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, device_id, model)
);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user TEXT NOT NULL, name TEXT, via TEXT, csrf TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, day TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  kind TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'sent', result TEXT, result_at INTEGER);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS quiz_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, updated INTEGER NOT NULL, q TEXT NOT NULL, answers TEXT NOT NULL,
  ok INTEGER NOT NULL, why TEXT, link TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS quiz_stats (day TEXT NOT NULL, qid TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, qid));
CREATE TABLE IF NOT EXISTS quiz_labels (qid TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, updated INTEGER NOT NULL, resolved INTEGER, title TEXT NOT NULL, text TEXT,
  sev TEXT NOT NULL DEFAULT 'stoerung', link TEXT, target TEXT NOT NULL DEFAULT 'all', author TEXT, resolved_by TEXT, resolve_text TEXT);
CREATE TABLE IF NOT EXISTS incident_affected (incident_id INTEGER NOT NULL, device_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (incident_id, device_id));
CREATE TABLE IF NOT EXISTS restart_campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, title TEXT NOT NULL, text TEXT, deadline INTEGER,
  target TEXT NOT NULL DEFAULT 'all', mode TEXT NOT NULL DEFAULT 'all', days INTEGER NOT NULL DEFAULT 7, active INTEGER NOT NULL DEFAULT 1, ended INTEGER, author TEXT);
CREATE TABLE IF NOT EXISTS restart_status (campaign_id INTEGER NOT NULL, device_id TEXT NOT NULL, state TEXT NOT NULL, boot_at INTEGER, snooze_until INTEGER,
  snoozes INTEGER NOT NULL DEFAULT 0, up_days INTEGER, updated INTEGER NOT NULL, PRIMARY KEY (campaign_id, device_id));
CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 100, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  match_type TEXT NOT NULL DEFAULT '', field TEXT NOT NULL DEFAULT 'title', mode TEXT NOT NULL DEFAULT 'words', pattern TEXT NOT NULL, action TEXT NOT NULL,
  extract TEXT NOT NULL DEFAULT 'rest', target TEXT NOT NULL DEFAULT '', dur TEXT NOT NULL DEFAULT '', ttl INTEGER, link_tpl TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 0, last_hit INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS yt_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, handle TEXT, target TEXT NOT NULL DEFAULT 'all',
  shorts INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, last_check INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_video TEXT, last_published INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS yt_videos (video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT, published INTEGER NOT NULL, sent INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS music_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL, device_id TEXT NOT NULL, track_id TEXT NOT NULL, title TEXT, artist TEXT,
  status TEXT NOT NULL, msg TEXT, veto INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS kb_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, kind TEXT NOT NULL, site_id TEXT NOT NULL, drive_id TEXT NOT NULL DEFAULT '', folder_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_sync INTEGER NOT NULL DEFAULT 0, last_error TEXT, items INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kb_items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL, ext TEXT NOT NULL DEFAULT '', modified INTEGER NOT NULL DEFAULT 0, etag TEXT, text TEXT, norm TEXT, synced INTEGER NOT NULL DEFAULT 0, UNIQUE (source_id, item_id));
CREATE TABLE IF NOT EXISTS music_blocked (track_id TEXT PRIMARY KEY, title TEXT, artist TEXT, at INTEGER NOT NULL, by_ TEXT);
CREATE TABLE IF NOT EXISTS music_cache (device_id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS selfhelp_stats (day TEXT NOT NULL, tool TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, tool));
-- 1.10: Mitarbeiter-Erlebnis: Stimmungsbarometer (Antworten ohne Geraet), Rueckmeldung nach Stoerungen, Start-Checkliste
CREATE TABLE IF NOT EXISTS pulse_surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, question TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', period TEXT,
  target TEXT NOT NULL DEFAULT 'all', active INTEGER NOT NULL DEFAULT 1, ends INTEGER, author TEXT);
CREATE TABLE IF NOT EXISTS pulse_done (survey_id INTEGER NOT NULL, device_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (survey_id, device_id));
CREATE TABLE IF NOT EXISTS pulse_votes (survey_id INTEGER NOT NULL, score INTEGER NOT NULL, health TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (survey_id, score, health));
CREATE TABLE IF NOT EXISTS pulse_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, survey_id INTEGER NOT NULL, day TEXT NOT NULL, score INTEGER NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS incident_feedback (incident_id INTEGER NOT NULL, device_id TEXT NOT NULL, ok INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (incident_id, device_id));
CREATE TABLE IF NOT EXISTS onboard_items (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 100, title TEXT NOT NULL, text TEXT, check_ TEXT NOT NULL DEFAULT 'manual', link TEXT,
  target TEXT NOT NULL DEFAULT 'all', active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS onboard_status (device_id TEXT NOT NULL, item_id INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (device_id, item_id));
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
`;

const DEFAULT_SETTINGS = {
  ai_enabled: 'true',          // KI-Proxy an/aus
  ai_models: 'haiku,sonnet',   // erlaubte Modelle
  ai_daily_cents: '50',        // Standard-Budget pro Gerät und Tag (US-Cent)
  ai_monthly_cents: '2000',    // Gesamtbudget aller Geräte pro Monat (US-Cent), 0 = ohne
  ai_context: 'true',          // Clients dürfen IT-Lage als Hintergrund mitschicken
  message_ttl_min: '1440',     // Standard-Haltbarkeit von Meldungen für Geräte, die gerade offline sind
  visits_enabled: 'true', visits_send_per_day: '2', visits_recv_per_day: '3',  // Besuche zwischen Sudos (1.4)
  quiz_enabled: 'true', quiz_per_week: '2', health_report: 'true',              // Security-Quiz und Gerätezustand (1.5)
  // 1.10: Mitarbeiter-Erlebnis – Stimmung, Rückmeldung nach Störungen, Start-Checkliste, Tipps
  pulse_enabled: 'true', pulse_monthly: 'false', pulse_incident: 'true', pulse_min: '5',
  onboard_enabled: 'false', onboard_days: '30', tips_enabled: 'true', tips_custom: '[]'
};

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const now = () => Date.now();
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'zentrale.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings (k, v) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  // 1.4: Spalten für Besuche (einmalig)
  const schema = db.prepare("SELECT v FROM settings WHERE k = 'schema'").get();
  if (!schema || Number(schema.v) < 2) {
    for (const col of ['allow_visits INTEGER NOT NULL DEFAULT 1', 'visit_name TEXT']) { try { db.exec(`ALTER TABLE devices ADD COLUMN ${col}`); } catch { /* vorhanden */ } }
    db.prepare("INSERT INTO settings (k, v) VALUES ('schema', '2') ON CONFLICT(k) DO UPDATE SET v = '2'").run();
  }
  // 1.5: Gerätezustand je Gerät
  const schema3 = db.prepare("SELECT v FROM settings WHERE k = 'schema'").get();
  if (Number(schema3 && schema3.v) < 3) {
    for (const col of ['health TEXT', 'health_at INTEGER']) { try { db.exec(`ALTER TABLE devices ADD COLUMN ${col}`); } catch { /* vorhanden */ } }
    db.prepare("INSERT INTO settings (k, v) VALUES ('schema', '3') ON CONFLICT(k) DO UPDATE SET v = '3'").run();
  }
  // 1.5: Anmeldename (UPN) für Meldungen an eine Person (user:…)
  const schema4 = db.prepare("SELECT v FROM settings WHERE k = 'schema'").get();
  if (Number(schema4 && schema4.v) < 4) {
    try { db.exec('ALTER TABLE devices ADD COLUMN upn TEXT'); } catch { /* vorhanden */ }
    db.prepare("INSERT INTO settings (k, v) VALUES ('schema', '4') ON CONFLICT(k) DO UPDATE SET v = '4'").run();
  }

  // 1.9: Diagnose je Gerät
  for (const col of ['diag TEXT', 'diag_at INTEGER']) { try { db.exec(`ALTER TABLE devices ADD COLUMN ${col}`); } catch { /* vorhanden */ } }
  // 1.10: Start-Checkliste erneut zeigen (verlängert das Zeitfenster)
  try { db.exec('ALTER TABLE devices ADD COLUMN onboard_until INTEGER'); } catch { /* vorhanden */ }
  // 1.8.1: Musikwünsche sperren/überspringen (Spalten für Datenbanken aus 1.8.0)
  for (const col of ['veto INTEGER NOT NULL DEFAULT 0', 'skipped INTEGER NOT NULL DEFAULT 0']) { try { db.exec(`ALTER TABLE music_requests ADD COLUMN ${col}`); } catch { /* vorhanden */ } }

  const q = {
    get: (sql, ...a) => db.prepare(sql).get(...a),
    all: (sql, ...a) => db.prepare(sql).all(...a),
    run: (sql, ...a) => db.prepare(sql).run(...a)
  };
  const settings = () => Object.fromEntries(q.all('SELECT k, v FROM settings').map(r => [r.k, r.v]));
  const setSetting = (k, v) => q.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
  const audit = (actor, action, detail = '') => q.run('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)', now(), actor || 'system', action, String(detail).slice(0, 500));

  // Aufräumen: abgelaufene Sitzungen, alte Meldungen, altes Protokoll
  function cleanup() {
    const t = now();
    q.run('DELETE FROM sessions WHERE expires < ?', t);
    q.run('DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE expires < ?)', t - 30 * 864e5);
    q.run('DELETE FROM messages WHERE expires < ?', t - 30 * 864e5);
    q.run('DELETE FROM audit WHERE ts < ?', t - 180 * 864e5);
    q.run('DELETE FROM ai_usage WHERE day < ?', dayKey(new Date(t - 400 * 864e5)));
    q.run('DELETE FROM incident_affected WHERE incident_id IN (SELECT id FROM incidents WHERE resolved IS NOT NULL AND resolved < ?)', t - 90 * 864e5);
    q.run('DELETE FROM selfhelp_stats WHERE day < ?', dayKey(new Date(t - 365 * 864e5)));
    q.run('DELETE FROM yt_videos WHERE sent < ?', t - 90 * 864e5);
    q.run('DELETE FROM music_requests WHERE at < ?', t - 90 * 864e5);
    // 1.10: Rückmeldungen zu Störungen nach 90 Tagen, beendete Umfragen nach einem Jahr
    q.run('DELETE FROM incident_feedback WHERE incident_id IN (SELECT id FROM incidents WHERE resolved IS NOT NULL AND resolved < ?)', t - 90 * 864e5);
    for (const tb of ['pulse_done', 'pulse_votes', 'pulse_comments']) q.run(`DELETE FROM ${tb} WHERE survey_id IN (SELECT id FROM pulse_surveys WHERE ends IS NOT NULL AND ends < ?)`, t - 365 * 864e5);
    q.run('DELETE FROM pulse_surveys WHERE ends IS NOT NULL AND ends < ?', t - 365 * 864e5);
  }
  return { db, ...q, settings, setSetting, audit, cleanup };
}

module.exports = { openDb, sha256, randomToken, now, dayKey };
