// ops.js – Betrieb (1.6): Störungen mit „Ich bin auch betroffen“, Neustart-Kampagnen, Selbsthilfe-Zähler, Hilfe-Kontakt.
// Gleiche Antworten wie app/ops.php der PHP-Version.
'use strict';
const { now } = require('./db');

const INCIDENT_SEV = ['info', 'stoerung', 'ausfall'];
const RESTART_STATES = ['open', 'snoozed', 'restarting', 'done', 'notneeded'];
const SELFHELP_TOOLS = ['net', 'teams', 'outlook', 'onedrive', 'explorer', 'temp', 'dns', 'slow', 'meet'];   // 1.10: + Langsam-Analyse, Meeting-Check
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

class OpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new OpsError(code, msg); };

function createOps(store, { matches, validTarget, isOnline }) {
  const helpPublic = s => {
    const h = { text: s.help_text || '', phone: s.help_phone || '', mail: s.help_mail || '', url: s.help_url || '' };
    return Object.values(h).some(Boolean) ? h : null;
  };
  const affectedCount = id => store.get('SELECT COUNT(*) n FROM incident_affected WHERE incident_id = ?', id).n;

  // Was ein Sudo bekommt: nur, was zu ihm passt
  function opsPublic(dev, s = store.settings()) {
    const inc = store.all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC LIMIT 20').filter(i => matches(i.target, dev)).slice(0, 10);
    const res = store.all('SELECT * FROM incidents WHERE resolved IS NOT NULL AND resolved > ? ORDER BY resolved DESC LIMIT 10', now() - 864e5).filter(i => matches(i.target, dev));
    const camp = store.all('SELECT * FROM restart_campaigns WHERE active = 1 ORDER BY id DESC LIMIT 5').filter(c => matches(c.target, dev));
    return {
      help: helpPublic(s),
      incidents: inc.map(i => ({ id: i.id, title: i.title, text: i.text || '', sev: i.sev, link: i.link || '', since: i.created, affected: affectedCount(i.id) })),
      resolved: res.map(i => ({ id: i.id, title: i.title, text: i.resolve_text || '', at: i.resolved })),
      restart: camp.map(c => ({ id: c.id, title: c.title, text: c.text || '', created: c.created, deadline: c.deadline || null, mode: c.mode, days: c.days }))
    };
  }

  /* ---------- Störungen ---------- */
  function incidentCreate(b, author) {
    const title = str(b.title, 120);
    if (title.length < 3) fail(400, 'Bitte einen Titel angeben (mind. 3 Zeichen), z. B. „Teams: Anmeldung gestört“.');
    const sev = INCIDENT_SEV.includes(b.sev) ? b.sev : 'stoerung';
    const link = str(b.link, 400);
    if (link && !/^https:\/\/\S{3,300}$/.test(link)) fail(400, 'Der Link muss mit https:// beginnen.');
    if (b.target != null && validTarget(b.target) !== String(b.target).trim()) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    const target = validTarget(b.target == null ? 'all' : b.target);
    // Doppelte Meldungen (z. B. Monitoring alle 5 Minuten) landen in der bestehenden Störung
    const dup = store.get('SELECT id FROM incidents WHERE resolved IS NULL AND title = ? AND target = ?', title, target);
    if (dup) return { id: dup.id, existing: true };
    const r = store.run('INSERT INTO incidents (created, updated, title, text, sev, link, target, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      now(), now(), title, str(b.text, 500), sev, link, target, author);
    const id = Number(r.lastInsertRowid);
    store.audit(author, 'incident_open', `#${id} ${title} → ${target}`);
    return { id, existing: false, targets: store.all('SELECT * FROM devices WHERE revoked = 0').filter(d => matches(target, d)).length };
  }
  function incidentResolve(id, text, who) {
    const i = store.get('SELECT * FROM incidents WHERE id = ?', Number(id));
    if (!i) fail(404, 'Störung nicht gefunden.');
    if (i.resolved) fail(409, 'Diese Störung ist schon beendet.');
    store.run('UPDATE incidents SET resolved = ?, resolved_by = ?, resolve_text = ?, updated = ? WHERE id = ?', now(), who, str(text, 300), now(), i.id);
    store.audit(who, 'incident_resolve', `#${i.id} ${i.title}`);
  }
  function incidentAdmin(i, detail) {
    const out = { id: i.id, title: i.title, text: i.text || '', sev: i.sev, link: i.link || '', target: i.target, author: i.author, created: i.created,
      resolved: i.resolved || null, resolvedBy: i.resolved_by, resolveText: i.resolve_text || '', affected: affectedCount(i.id) };
    if (detail) out.devices = store.all('SELECT a.at, d.name, d.user, d.upn FROM incident_affected a LEFT JOIN devices d ON d.id = a.device_id WHERE a.incident_id = ? ORDER BY a.at', i.id)
      .map(r => ({ name: r.name || '?', user: r.upn || r.user || '', at: r.at }));
    return out;
  }
  function affected(dev, b) {
    const i = store.get('SELECT * FROM incidents WHERE id = ? AND resolved IS NULL', Number(b.id) || 0);
    if (!i) fail(404, 'Diese Störung ist schon beendet.');
    if (!matches(i.target, dev)) fail(404, 'Diese Störung betrifft dieses Gerät nicht.');
    if (b.on) store.run('INSERT OR IGNORE INTO incident_affected (incident_id, device_id, at) VALUES (?, ?, ?)', i.id, dev.id, now());
    else store.run('DELETE FROM incident_affected WHERE incident_id = ? AND device_id = ?', i.id, dev.id);
    return { ok: true, affected: affectedCount(i.id) };
  }

  /* ---------- Neustart-Kampagnen ---------- */
  function restartCreate(b, who) {
    const title = str(b.title, 120);
    if (title.length < 3) fail(400, 'Bitte einen Titel angeben, z. B. „Patchday: bitte bis Freitag neu starten“.');
    const deadline = b.deadline === '' || b.deadline == null ? null : Number(b.deadline);
    if (deadline !== null && (!Number.isFinite(deadline) || deadline < now() || deadline > now() + 60 * 864e5)) fail(400, 'Die Frist muss in der Zukunft liegen (höchstens 60 Tage).');
    const mode = b.mode === 'pending' ? 'pending' : 'all';
    const days = Math.max(1, Math.min(60, Math.trunc(Number(b.days) || 7)));
    const target = validTarget(b.target == null ? 'all' : b.target);
    const r = store.run('INSERT INTO restart_campaigns (created, title, text, deadline, target, mode, days, active, author) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      now(), title, str(b.text, 500), deadline, target, mode, days, who);
    const id = Number(r.lastInsertRowid);
    store.audit(who, 'restart_start', `#${id} ${title} → ${target}`);
    return id;
  }
  function restartEnd(id, who) {
    const c = store.get('SELECT * FROM restart_campaigns WHERE id = ?', Number(id));
    if (!c) fail(404, 'Kampagne nicht gefunden.');
    store.run('UPDATE restart_campaigns SET active = 0, ended = ? WHERE id = ?', now(), c.id);
    store.audit(who, 'restart_end', `#${c.id} ${c.title}`);
  }
  function restartStatus(dev, b) {
    const c = store.get('SELECT * FROM restart_campaigns WHERE id = ?', Number(b.id) || 0);
    if (!c) fail(404, 'Kampagne unbekannt.');
    if (!RESTART_STATES.includes(b.state)) fail(400, 'Unbekannter Stand.');
    const int = (v, max) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(max, Math.trunc(Number(v)))) : null);
    store.run(`INSERT INTO restart_status (campaign_id, device_id, state, boot_at, snooze_until, snoozes, up_days, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, device_id) DO UPDATE SET state = excluded.state, boot_at = excluded.boot_at, snooze_until = excluded.snooze_until,
      snoozes = excluded.snoozes, up_days = excluded.up_days, updated = excluded.updated`,
    c.id, dev.id, b.state, int(b.bootAt, 9e15), int(b.snoozeUntil, 9e15), int(b.snoozes, 1000) || 0, int(b.upDays, 10000), now());
    return { ok: true };
  }
  function restartAdmin(c) {
    const devs = store.all('SELECT * FROM devices WHERE revoked = 0').filter(d => matches(c.target, d));
    const st = Object.fromEntries(store.all('SELECT * FROM restart_status WHERE campaign_id = ?', c.id).map(r => [r.device_id, r]));
    const count = { done: 0, notneeded: 0, open: 0, snoozed: 0, restarting: 0, unknown: 0 };
    const order = { open: 0, snoozed: 1, unknown: 2, restarting: 3, done: 4, notneeded: 5 };
    const rows = devs.map(d => {
      const r = st[d.id]; const state = r ? r.state : 'unknown';
      count[state] = (count[state] || 0) + 1;
      return { name: d.name, user: d.upn || d.user, state, snoozes: r ? r.snoozes : 0, snoozeUntil: r ? r.snooze_until || 0 : 0, upDays: r ? r.up_days : null, updated: r ? r.updated : null, online: isOnline(d.id) };
    }).sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || String(a.name).localeCompare(String(b.name)));
    return { id: c.id, title: c.title, text: c.text || '', created: c.created, deadline: c.deadline || null, target: c.target, mode: c.mode, days: c.days,
      active: !!c.active, ended: c.ended || null, author: c.author, total: devs.length, count, devices: rows };
  }

  /* ---------- Selbsthilfe (anonym) ---------- */
  function selfhelpCount(b, day) {
    if (!SELFHELP_TOOLS.includes(b.tool)) fail(400, 'Unbekanntes Werkzeug.');
    store.run('INSERT INTO selfhelp_stats (day, tool, n, ok) VALUES (?, ?, 1, ?) ON CONFLICT(day, tool) DO UPDATE SET n = n + 1, ok = ok + excluded.ok', day, b.tool, b.ok ? 1 : 0);
    return { ok: true };
  }
  function adminOverview(since) {
    return {
      incidents: store.all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC').map(i => incidentAdmin(i, true)),
      resolved: store.all('SELECT * FROM incidents WHERE resolved IS NOT NULL ORDER BY resolved DESC LIMIT 15').map(i => incidentAdmin(i, false)),
      campaigns: store.all('SELECT * FROM restart_campaigns ORDER BY active DESC, id DESC LIMIT 12').map(restartAdmin),
      selfhelp: store.all('SELECT tool, SUM(n) n, SUM(ok) ok FROM selfhelp_stats WHERE day >= ? GROUP BY tool ORDER BY n DESC', since),
      help: helpPublic(store.settings()) || { text: '', phone: '', mail: '', url: '' }
    };
  }
  return { opsPublic, incidentCreate, incidentResolve, incidentAdmin, affected, restartCreate, restartEnd, restartStatus, selfhelpCount, adminOverview };
}

module.exports = { createOps, OpsError, INCIDENT_SEV, RESTART_STATES, SELFHELP_TOOLS };
