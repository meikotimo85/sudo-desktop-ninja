// dex.js – Mitarbeiter-Erlebnis (1.10): Stimmungsbarometer, Start-Checkliste für neue Kollegen, Tipps im passenden Moment.
// Gleiche Antworten wie app/dex.php der PHP-Version.
// Datenschutz: Stimmungs-Antworten werden ohne Gerät gespeichert (nur Note, Ampel des Gerätezustands, Tag);
// gemerkt wird je Gerät nur, DASS es geantwortet hat. Auswertung erst ab pulse_min Antworten.
'use strict';
const { now, dayKey } = require('./db');

const ONBOARD_CHECKS = ['manual', 'onedrive', 'kfm', 'signature', 'printer', 'teams', 'quiz', 'health'];
const TIP_APPS = ['all', 'excel', 'word', 'outlook', 'teams', 'powerpoint', 'onenote', 'browser', 'sharepoint', 'onedrive'];
const PULSE_MONTHLY_Q = 'Wie zufrieden bist du gerade mit deinem PC und deinen IT-Werkzeugen?';
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const clean = v => String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const linkOk = l => l === '' || /^https:\/\/\S{3,300}$/.test(l) || /^sudo:[a-z]{2,12}(\/[a-z]{2,12})?$/.test(l);
const on = (s, k, def = 'true') => (s[k] || def) === 'true';

class DexError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new DexError(code, msg); };

function tipsClean(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(list) || list.length > 50) return null;
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object' || !TIP_APPS.includes(t.app)) return null;
    const text = clean(t.text);
    if (text.length < 5 || text.length > 200) return null;
    out.push({ app: t.app, text });
  }
  return out;
}

function createDex(store, { matches, validTarget, isOnline }) {
  const tz = () => new Date();
  const period = () => { const d = tz(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  /* ---------- Einmalige Vorbereitung: mitgelieferte Checkliste ---------- */
  function seed() {
    if (store.get("SELECT v FROM settings WHERE k = 'mig_110_onboard_seed'")) return;
    const items = [
      ['Mehrstufige Anmeldung (MFA) einrichten', 'Authenticator-App auf dem Handy einrichten – so kommt niemand mit deinem Passwort allein in dein Konto.', 'manual', 'https://mysignins.microsoft.com/security-info'],
      ['OneDrive anmelden', 'OneDrive mit deinem Firmenkonto anmelden (Wolken-Symbol unten rechts).', 'onedrive', ''],
      ['Desktop und Dokumente in OneDrive sichern', 'OneDrive → Einstellungen → Synchronisieren und sichern → Sicherung verwalten.', 'kfm', ''],
      ['Teams einrichten', 'Teams starten und mit deinem Firmenkonto anmelden.', 'teams', ''],
      ['E-Mail-Signatur anlegen', 'Outlook → Einstellungen → Signaturen.', 'signature', ''],
      ['Drucker verbinden', 'Einstellungen → Bluetooth und Geräte → Drucker und Scanner.', 'printer', ''],
      ['Gerätezustand prüfen', 'Sudo schaut, ob Verschlüsselung, Virenschutz und Updates passen.', 'health', 'sudo:lage/pc'],
      ['Einmal das Security-Quiz spielen', 'Eine Frage, ein paar Sekunden – und du erkennst Phishing schneller.', 'quiz', 'sudo:quiz']
    ];
    items.forEach(([t, x, c, l], n) => store.run('INSERT INTO onboard_items (pos, title, text, check_, link, target, active, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', (n + 1) * 10, t, x, c, l, 'all', now()));
    store.setSetting('mig_110_onboard_seed', '1');
  }

  /* ---------- Was ein Sudo bekommt ---------- */
  function monthlyEnsure(s) {
    if (!on(s, 'pulse_enabled') || !on(s, 'pulse_monthly', 'false')) return;
    const p = period();
    if (s.pulse_month === p) return;
    if (!store.get("SELECT 1 FROM pulse_surveys WHERE kind = 'monthly' AND period = ?", p)) {
      const d = tz(), end = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
      store.run('INSERT INTO pulse_surveys (created, question, kind, period, target, active, ends, author) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', now(), PULSE_MONTHLY_Q, 'monthly', p, 'all', end, 'system');
    }
    store.setSetting('pulse_month', p);
  }
  function pulsePublic(dev, s) {
    if (!on(s, 'pulse_enabled')) return { enabled: false, surveys: [], incident: false };
    const rows = store.all(`SELECT * FROM pulse_surveys WHERE active = 1 AND (ends IS NULL OR ends > ?)
      AND NOT EXISTS (SELECT 1 FROM pulse_done d WHERE d.survey_id = pulse_surveys.id AND d.device_id = ?) ORDER BY id LIMIT 20`, now(), dev.id).filter(r => matches(r.target, dev));
    return { enabled: true, incident: on(s, 'pulse_incident'), surveys: rows.slice(0, 3).map(r => ({ id: r.id, q: r.question, kind: r.kind })) };
  }
  const windowEnd = (dev, s) => Math.max(dev.created + Math.max(1, Math.min(180, Number(s.onboard_days) || 30)) * 864e5, Number(dev.onboard_until) || 0);
  function onboardPublic(dev, s) {
    if (!on(s, 'onboard_enabled', 'false') || windowEnd(dev, s) < now()) return null;
    const items = store.all('SELECT * FROM onboard_items WHERE active = 1 ORDER BY pos, id').filter(i => matches(i.target, dev));
    if (!items.length) return null;
    const done = store.all('SELECT item_id FROM onboard_status WHERE device_id = ? AND done = 1', dev.id).map(r => r.item_id);
    return { until: windowEnd(dev, s), done, items: items.slice(0, 20).map(i => ({ id: i.id, title: i.title, text: i.text || '', check: i.check_, link: i.link || '' })) };
  }
  const tipsPublic = s => ({ enabled: on(s, 'tips_enabled'), items: tipsClean(s.tips_custom || '[]') || [] });
  function dexPublic(dev, s = store.settings()) {
    monthlyEnsure(s);
    return { pulse: pulsePublic(dev, s), onboard: onboardPublic(dev, s), tips: tipsPublic(s) };
  }

  /* ---------- Antworten der Geräte ---------- */
  function pulseAnswer(dev, b) {
    if (!on(store.settings(), 'pulse_enabled')) fail(403, 'Das Stimmungsbarometer ist in der Zentrale ausgeschaltet.');
    const sv = store.get('SELECT * FROM pulse_surveys WHERE id = ? AND active = 1 AND (ends IS NULL OR ends > ?)', Number(b.id) || 0, now());
    if (!sv) fail(404, 'Diese Frage ist schon beendet.');
    if (!matches(sv.target, dev)) fail(404, 'Diese Frage gilt nicht für dieses Gerät.');
    if (store.get('SELECT 1 FROM pulse_done WHERE survey_id = ? AND device_id = ?', sv.id, dev.id)) return { ok: true, already: true };
    // Erst prüfen, dann merken – sonst zählt eine ungültige Antwort als „schon beantwortet“
    const score = Number(b.score);
    if (!b.skip && (!Number.isInteger(score) || score < 1 || score > 5)) fail(400, 'Bitte 1 bis 5 Sterne vergeben.');
    store.run('INSERT OR IGNORE INTO pulse_done (survey_id, device_id, at) VALUES (?, ?, ?)', sv.id, dev.id, now());
    if (b.skip) return { ok: true, skipped: true };
    let h = 'unknown'; try { h = (JSON.parse(dev.health || 'null') || {}).s || 'unknown'; } catch { /* egal */ }
    if (!['ok', 'warn', 'bad'].includes(h)) h = 'unknown';
    store.run('INSERT INTO pulse_votes (survey_id, score, health, n) VALUES (?, ?, ?, 1) ON CONFLICT(survey_id, score, health) DO UPDATE SET n = n + 1', sv.id, score, h);
    const c = clean(b.comment);
    if (c) store.run('INSERT INTO pulse_comments (survey_id, day, score, text) VALUES (?, ?, ?, ?)', sv.id, dayKey(), score, c.slice(0, 300));
    return { ok: true };
  }
  // Nach einer Störung: „Läuft es bei dir wieder?“ – mit Gerät, damit die IT bei „Nein“ helfen kann (steht so im Client)
  function incidentFeedback(dev, b) {
    const i = store.get('SELECT * FROM incidents WHERE id = ? AND resolved IS NOT NULL', Number(b.id) || 0);
    if (!i) fail(404, 'Diese Störung ist nicht beendet.');
    if (!matches(i.target, dev)) fail(404, 'Diese Störung betrifft dieses Gerät nicht.');
    store.run('INSERT INTO incident_feedback (incident_id, device_id, ok, at) VALUES (?, ?, ?, ?) ON CONFLICT(incident_id, device_id) DO UPDATE SET ok = excluded.ok, at = excluded.at', i.id, dev.id, b.ok ? 1 : 0, now());
    if (!b.ok) store.audit(`${dev.upn || dev.user} (${dev.name})`, 'incident_still', `#${i.id} ${i.title}`);
    return { ok: true };
  }
  function onboardMark(dev, b) {
    const item = store.get('SELECT * FROM onboard_items WHERE id = ? AND active = 1', Number(b.id) || 0);
    if (!item) fail(404, 'Diesen Punkt gibt es nicht mehr.');
    if (!matches(item.target, dev)) fail(404, 'Dieser Punkt gilt nicht für dieses Gerät.');
    store.run(`INSERT INTO onboard_status (device_id, item_id, done, auto, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, item_id) DO UPDATE SET done = excluded.done, auto = excluded.auto, at = excluded.at`, dev.id, item.id, b.done ? 1 : 0, b.auto ? 1 : 0, now());
    return { ok: true };
  }

  /* ---------- Verwaltung ---------- */
  function pulseAdmin(sv, min) {
    const votes = store.all('SELECT score, health, n FROM pulse_votes WHERE survey_id = ?', sv.id);
    const sum = l => l.reduce((a, v) => a + v.n, 0);
    const avg = l => { const m = sum(l); return m ? Math.round(l.reduce((a, v) => a + v.score * v.n, 0) / m * 10) / 10 : null; };
    const n = sum(votes), asked = store.get('SELECT COUNT(*) n FROM pulse_done WHERE survey_id = ?', sv.id).n;
    const out = { id: sv.id, question: sv.question, kind: sv.kind, period: sv.period, target: sv.target, active: !!sv.active && (!sv.ends || sv.ends > now()),
      created: sv.created, ends: sv.ends || null, author: sv.author, n, skipped: Math.max(0, asked - n), enough: n >= min, avg: null, dist: null, byHealth: null, comments: [] };
    if (n < min) return out;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const v of votes) dist[v.score] += v.n;
    const by = {};
    for (const h of ['ok', 'warn', 'bad', 'unknown']) { const l = votes.filter(v => v.health === h), hn = sum(l); by[h] = { n: hn, avg: hn >= min ? avg(l) : null }; }
    Object.assign(out, { avg: avg(votes), dist, byHealth: by,
      comments: store.all('SELECT * FROM pulse_comments WHERE survey_id = ? ORDER BY id DESC LIMIT 50', sv.id).map(c => ({ day: c.day, score: c.score, text: c.text })) });
    return out;
  }
  function admin() {
    monthlyEnsure(store.settings());
    const s = store.settings();
    const min = Math.max(3, Math.min(20, Number(s.pulse_min) || 5));
    const feedback = [];
    for (const i of store.all('SELECT * FROM incidents WHERE resolved IS NOT NULL ORDER BY resolved DESC LIMIT 10')) {
      const rows = store.all('SELECT f.ok, f.at, d.name, d.user, d.upn FROM incident_feedback f LEFT JOIN devices d ON d.id = f.device_id WHERE f.incident_id = ? ORDER BY f.at', i.id);
      if (!rows.length) continue;
      feedback.push({ id: i.id, title: i.title, resolved: i.resolved, ok: rows.filter(r => r.ok === 1).length,
        still: rows.filter(r => r.ok === 0).map(r => ({ name: r.name || '?', user: r.upn || r.user || '', at: r.at })) });
    }
    const items = store.all('SELECT * FROM onboard_items ORDER BY pos, id');
    const devices = [];
    for (const d of store.all('SELECT * FROM devices WHERE revoked = 0 ORDER BY created DESC')) {
      if (windowEnd(d, s) < now() - 7 * 864e5) continue;     // eine Woche nach Ablauf noch sichtbar
      const mine = items.filter(i => i.active === 1 && matches(i.target, d)), ids = mine.map(i => i.id);
      const done = store.all('SELECT item_id, at FROM onboard_status WHERE device_id = ? AND done = 1', d.id).filter(r => ids.includes(r.item_id));
      const doneIds = done.map(r => r.item_id);
      devices.push({ id: d.id, name: d.name, user: d.upn || d.user, created: d.created, until: windowEnd(d, s), total: ids.length, done: done.length,
        open: mine.filter(i => !doneIds.includes(i.id)).map(i => i.title), last: done.length ? Math.max(...done.map(r => r.at)) : null, online: isOnline(d.id) });
    }
    return { min, pulse: store.all('SELECT * FROM pulse_surveys ORDER BY id DESC LIMIT 20').map(sv => pulseAdmin(sv, min)), feedback,
      onboard: { items: items.map(i => ({ id: i.id, title: i.title, text: i.text || '', check: i.check_, link: i.link || '', target: i.target, active: !!i.active })), devices, checks: ONBOARD_CHECKS },
      tips: tipsClean(s.tips_custom || '[]') || [], tipApps: TIP_APPS };
  }
  function pulseCreate(b, who) {
    const q = str(b.question, 200);
    if (q.length < 8) fail(400, 'Bitte eine Frage eingeben (mind. 8 Zeichen), z. B. „Wie zufrieden bist du mit dem neuen Drucker?“');
    if (b.target != null && validTarget(b.target) !== String(b.target).trim()) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    const days = Math.max(1, Math.min(60, Number(b.days) || 7));
    const r = store.run('INSERT INTO pulse_surveys (created, question, kind, period, target, active, ends, author) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)',
      now(), q, 'custom', validTarget(b.target == null ? 'all' : b.target), now() + days * 864e5, who);
    const id = Number(r.lastInsertRowid);
    store.audit(who, 'pulse_start', `#${id} ${q}`);
    return id;
  }
  function pulseEnd(id, who) {
    const sv = store.get('SELECT * FROM pulse_surveys WHERE id = ?', Number(id));
    if (!sv) fail(404, 'Umfrage nicht gefunden.');
    store.run('UPDATE pulse_surveys SET active = 0, ends = ? WHERE id = ?', Math.min(now(), sv.ends || now()), sv.id);
    store.audit(who, 'pulse_end', `#${sv.id} ${sv.question}`);
  }
  function pulseDelete(id, who) {
    const sv = store.get('SELECT * FROM pulse_surveys WHERE id = ?', Number(id));
    if (!sv) fail(404, 'Umfrage nicht gefunden.');
    for (const t of ['pulse_done', 'pulse_votes', 'pulse_comments']) store.run(`DELETE FROM ${t} WHERE survey_id = ?`, sv.id);
    store.run('DELETE FROM pulse_surveys WHERE id = ?', sv.id);
    store.audit(who, 'pulse_delete', sv.question);
  }
  function itemClean(b) {
    const title = str(b.title, 120);
    if (title.length < 3) fail(400, 'Bitte einen Titel angeben, z. B. „VPN einrichten“.');
    const check = b.check == null ? 'manual' : String(b.check);
    if (!ONBOARD_CHECKS.includes(check)) fail(400, 'Unbekannte Prüfung.');
    const link = String(b.link || '').trim();
    if (!linkOk(link)) fail(400, 'Der Link muss mit https:// beginnen.');
    if (b.target != null && validTarget(b.target) !== String(b.target).trim()) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    return { title, text: str(b.text, 300), check, link, target: validTarget(b.target == null ? 'all' : b.target) };
  }
  function itemAdd(b, who) {
    const c = itemClean(b);
    const pos = (store.get('SELECT COALESCE(MAX(pos), 0) p FROM onboard_items').p || 0) + 10;
    const r = store.run('INSERT INTO onboard_items (pos, title, text, check_, link, target, active, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', pos, c.title, c.text, c.check, c.link, c.target, now());
    store.audit(who, 'onboard_add', c.title);
    return Number(r.lastInsertRowid);
  }
  function itemPatch(id, b) {
    const it = store.get('SELECT * FROM onboard_items WHERE id = ?', Number(id));
    if (!it) fail(404, 'Punkt nicht gefunden.');
    if (b.active !== undefined) store.run('UPDATE onboard_items SET active = ? WHERE id = ?', b.active ? 1 : 0, it.id);
    if (b.move !== undefined) {
      const ids = store.all('SELECT id FROM onboard_items ORDER BY pos, id').map(x => x.id);
      const i = ids.indexOf(it.id), j = i + (Number(b.move) < 0 ? -1 : 1);
      if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
      ids.forEach((x, n) => store.run('UPDATE onboard_items SET pos = ? WHERE id = ?', (n + 1) * 10, x));
    }
  }
  function itemDelete(id, who) {
    const it = store.get('SELECT * FROM onboard_items WHERE id = ?', Number(id));
    if (!it) fail(404, 'Punkt nicht gefunden.');
    store.run('DELETE FROM onboard_status WHERE item_id = ?', it.id);
    store.run('DELETE FROM onboard_items WHERE id = ?', it.id);
    store.audit(who, 'onboard_delete', it.title);
  }
  function showAgain(devId, who) {
    const d = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', String(devId));
    if (!d) fail(404, 'Gerät nicht gefunden.');
    const days = Math.max(1, Math.min(180, Number(store.settings().onboard_days) || 30));
    store.run('UPDATE devices SET onboard_until = ? WHERE id = ?', now() + days * 864e5, d.id);
    store.audit(who, 'onboard_show', d.name);
  }
  return { seed, dexPublic, pulseAnswer, incidentFeedback, onboardMark, admin, pulseCreate, pulseEnd, pulseDelete, itemAdd, itemPatch, itemDelete, showAgain };
}

module.exports = { createDex, DexError, tipsClean, ONBOARD_CHECKS, TIP_APPS };
