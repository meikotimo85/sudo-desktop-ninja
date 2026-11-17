// server.js – Sudo-Zentrale: Meldungen an alle Sudos, Ereignis-API für Skripte, KI-Proxy mit Budget, Admin-Oberfläche
'use strict';
const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const { openDb, sha256, randomToken, now, dayKey } = require('./db');
const { createAuth } = require('./auth');
const sec = require('./security');
const { createHub, cleanEvent, EVENT_TYPES, validTarget, cleanUpn } = require('./hub');
const core = require('./anthropic');
const pkg = require('../package.json');

/* ---------- Konfiguration aus Umgebungsvariablen (.env über docker compose) ---------- */
const env = process.env;
const list = v => String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
const cfg = {
  port: Number(env.PORT) || 8080,
  host: env.HOST || '0.0.0.0',
  publicUrl: String(env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  cookieSecret: env.COOKIE_SECRET || '',
  adminUsers: list(env.ADMIN_USERS),
  adminGroup: env.ADMIN_GROUP_ID || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  localLogin: /^(1|true|ja|yes)$/i.test(env.LOCAL_LOGIN || ''),
  entra: { tenant: env.ENTRA_TENANT_ID || '', clientId: env.ENTRA_CLIENT_ID || '', clientSecret: env.ENTRA_CLIENT_SECRET || '' },
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicUrl: env.ANTHROPIC_URL || core.API_URL,
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY !== 'false' : true,
  // 1.8: YouTube/Spotify (Adressen nur für Tests änderbar), Zeitzone für Musik-Uhrzeiten
  youtubeBase: env.YOUTUBE_BASE || '', spotifyApi: env.SPOTIFY_API || '', spotifyAccounts: env.SPOTIFY_ACCOUNTS || '', timezone: env.TZ_SUDO || 'Europe/Berlin',
  // 1.9: Microsoft Graph für SharePoint-Anleitungen (Adressen nur für Tests änderbar)
  graphApi: env.GRAPH_API || '', graphLogin: env.GRAPH_LOGIN || ''
};
if (!cfg.cookieSecret || cfg.cookieSecret.length < 32) {
  // Ohne festes Geheimnis: einmalig erzeugen und im Datenordner merken (Sitzungen überleben so einen Neustart)
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const f = path.join(cfg.dataDir, '.cookie-secret');
  try { cfg.cookieSecret = fs.readFileSync(f, 'utf8').trim(); } catch { cfg.cookieSecret = randomToken(48); fs.writeFileSync(f, cfg.cookieSecret, { mode: 0o600 }); }
}

const app = Fastify({
  logger: { level: env.LOG_LEVEL || 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'] },
  trustProxy: cfg.trustProxy, bodyLimit: 256 * 1024
});
const log = app.log;
const store = openDb(cfg.dataDir);
const auth = createAuth({ cfg, store, log });
const hub = createHub({ store, log, appInfo: { name: 'Sudo-Zentrale', version: pkg.version } });
// 1.6: Betrieb – Störungen, Neustart-Kampagnen, Selbsthilfe
const { createOps, OpsError } = require('./ops');
const ops = createOps(store, { matches: hub.matches, validTarget, isOnline: id => hub.isOnline(id) });
hub.setOps(d => ops.opsPublic(d));
// 1.7: Regeln – eingehende Meldungen einordnen
const { createRules, RuleError } = require('./rules');
const rules = createRules(store, { validTarget, EVENT_TYPES });
if (Number((store.get("SELECT v FROM settings WHERE k = 'schema'") || {}).v || 0) < 5) { rules.seed(); store.setSetting('schema', '5'); }
// 1.8: YouTube und Musikwünsche
const { createMedia, MediaError, SECRET_KEYS: MEDIA_SECRETS } = require('./media');
const { createKb, KbError, KB_SECRETS } = require('./kb');
const SECRET_KEYS = [...MEDIA_SECRETS, ...KB_SECRETS];
let media = null;   // nach visitName angelegt (siehe unten)
// 1.10: Mitarbeiter-Erlebnis – Stimmungsbarometer, Start-Checkliste, Tipps
const { createDex, DexError, tipsClean } = require('./dex');
const dex = createDex(store, { matches: hub.matches, validTarget, isOnline: id => hub.isOnline(id) });
dex.seed();
hub.setDex((d, s) => dex.dexPublic(d, s));
// 1.12: Plugins – HTML-Werkzeuge, die sich die Sudos holen
const { createPlugins, PluginError } = require('./plugins');
const plugins = createPlugins(store, { matches: hub.matches, validTarget });
hub.setPlugins((d, s) => plugins.publicFor(d, s));
const opsTry = (reply, fn) => { try { return fn(); } catch (e) { if (e instanceof OpsError || e instanceof RuleError || e instanceof MediaError || e instanceof DexError || e instanceof PluginError) return err(reply, e.code, e.message); throw e; } };

app.register(require('@fastify/cookie'), { secret: cfg.cookieSecret });
app.register(require('@fastify/rate-limit'), { global: true, max: 300, timeWindow: '1 minute' });
app.register(require('@fastify/websocket'), { options: { maxPayload: 64 * 1024 } });
app.register(require('@fastify/static'), { root: path.join(__dirname, '..', 'public'), prefix: '/', index: ['index.html'] });

// Sicherheits-Header für alles; die Admin-Seite lädt nur eigene Dateien
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-frame-options', 'DENY');
  if (String(reply.getHeader('content-type') || '').includes('text/html')) {
    reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://login.microsoftonline.com; base-uri 'none'");
  }
  return payload;
});

const err = (reply, code, message) => reply.code(code).send({ message });
const bearer = req => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
const deviceFrom = req => { const t = bearer(req); return t ? store.get('SELECT * FROM devices WHERE token_hash = ? AND revoked = 0', sha256(t)) : null; };
const centsToUsd = c => Number(c) / 100;

/* =====================================================================
   Geräte (Sudo-Clients)
   ===================================================================== */
app.get('/api/info', async () => ({ name: 'Sudo-Zentrale', version: pkg.version, transport: 'ws' }));
app.get('/healthz', async () => ({ ok: true, version: pkg.version, online: hub.online().length }));

// Anmeldung eines Sudo mit Registrierungscode → eigener Geräte-Token (wird nur einmal angezeigt, gespeichert nur als Hash)
app.post('/api/enroll', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
  const b = req.body || {};
  const code = String(b.code || '').trim();
  if (!code) return err(reply, 400, 'Registrierungscode fehlt.');
  const c = store.get('SELECT * FROM enroll_codes WHERE code_hash = ? AND revoked = 0', sha256(code));
  if (!c || (c.expires && c.expires < now()) || (c.uses_left != null && c.uses_left <= 0)) { store.audit(req.ip, 'enroll_denied', 'Code ungültig'); return err(reply, 403, 'Registrierungscode ungültig oder abgelaufen.'); }
  const token = randomToken(32), id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const name = String(b.name || b.host || 'Sudo').slice(0, 60);
  store.run('INSERT INTO devices (id, name, user, upn, host, version, lang, groups_, token_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, String(b.user || '').slice(0, 80), cleanUpn(b.upn), String(b.host || '').slice(0, 80), String(b.version || '').slice(0, 20), String(b.lang || '').slice(0, 5), c.groups_, sha256(token), now(), now());
  store.run('UPDATE enroll_codes SET used = used + 1, uses_left = CASE WHEN uses_left IS NULL THEN NULL ELSE uses_left - 1 END WHERE id = ?', c.id);
  store.audit(`${name} (${b.user || '?'})`, 'enroll', `Code „${c.label || c.id}“`);
  return { id, token, name, server: { name: 'Sudo-Zentrale', version: pkg.version } };
});

app.get('/api/device', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  return { id: d.id, name: d.name, groups: d.groups_, online: hub.isOnline(d.id) };
});

app.register(async f => { f.get('/api/ws', { websocket: true }, (socket, req) => hub.handle(socket, req)); });

/* ---------- Plugins (1.12): HTML eines Plugins für dieses Gerät ---------- */
app.get('/api/plugins/:id', { config: { rateLimit: { max: 300, timeWindow: '1 hour', keyGenerator: req => bearer(req).slice(0, 16) || req.ip } } }, async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  return opsTry(reply, () => plugins.getFor(d, req.params.id));
});

/* ---------- KI-Proxy: Frage vom Sudo → Claude, mit Budget pro Gerät und Monat ---------- */
function budgetCheck(dev) {
  const s = store.settings();
  if (s.ai_enabled !== 'true' || !cfg.anthropicKey) return 'Frag Sudo ist in der Zentrale ausgeschaltet.';
  const dayCents = dev.ai_daily_cents != null ? dev.ai_daily_cents : Number(s.ai_daily_cents);
  const today = store.get('SELECT COALESCE(SUM(usd_micro), 0) AS u FROM ai_usage WHERE day = ? AND device_id = ?', dayKey(), dev.id).u / 1e6;
  if (dayCents > 0 && today >= centsToUsd(dayCents)) return 'Tagesbudget für dieses Gerät aufgebraucht – morgen geht es weiter.';
  const month = store.get('SELECT COALESCE(SUM(usd_micro), 0) AS u FROM ai_usage WHERE day LIKE ?', dayKey().slice(0, 7) + '%').u / 1e6;
  if (Number(s.ai_monthly_cents) > 0 && month >= centsToUsd(s.ai_monthly_cents)) return 'Monatsbudget der Firma aufgebraucht.';
  return null;
}
app.post('/api/ask', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: req => bearer(req).slice(0, 16) || req.ip } } }, async (req, reply) => {
  const dev = deviceFrom(req);
  if (!dev) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  const block = budgetCheck(dev);
  if (block) return err(reply, 402, block);
  const b = req.body || {}, s = store.settings();
  const model = s.ai_models.split(',').includes(b.model) && core.MODELS[b.model] ? b.model : s.ai_models.split(',')[0] || 'haiku';
  const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-16)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return err(reply, 400, 'Keine Frage gefunden.');
  const system = core.systemPrompt({ lang: ['de', 'en', 'ja'].includes(b.lang) ? b.lang : 'de', context: s.ai_context === 'true' ? String(b.context || '').slice(0, 2000) : '',
    kb: kb.aiContext(messages[messages.length - 1].content, s) });
  const ac = new AbortController();
  // Sudo hat abgebrochen (Antwort-Verbindung zu, bevor alles geschrieben ist) → Claude-Anfrage auch abbrechen
  reply.raw.on('close', () => { if (!reply.raw.writableFinished) ac.abort(); });
  let r;
  try {
    r = await fetch(cfg.anthropicUrl, { method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': core.API_VERSION },
      body: JSON.stringify(core.buildRequest({ model, system, messages })) });
  } catch (e) { log.error('Claude nicht erreichbar: ' + e.message); return err(reply, 502, 'Claude ist von der Zentrale aus nicht erreichbar.'); }
  if (!r.ok) { const m = await core.httpError(r); log.warn('Claude-Fehler: ' + m); return err(reply, r.status === 401 ? 502 : r.status, r.status === 401 ? 'Der API-Schlüssel der Zentrale ist ungültig.' : m); }
  // Datenstrom 1:1 an den Sudo weiterreichen und nebenbei den Verbrauch zählen (Inhalte werden nicht gespeichert)
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  let res;
  try { res = await core.readStream(r.body, { onEvent: block => { reply.raw.write(block + '\n\n'); }, signal: ac.signal }); }
  catch (e) { res = { usage: { in: 0, out: 0 } }; log.warn('Strom abgebrochen: ' + e.message); }
  reply.raw.end();
  const usd = core.cost(model, res.usage);
  store.run(`INSERT INTO ai_usage (day, device_id, model, q, tin, tout, usd_micro) VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(day, device_id, model) DO UPDATE SET q = q + 1, tin = tin + excluded.tin, tout = tout + excluded.tout, usd_micro = usd_micro + excluded.usd_micro`,
  dayKey(), dev.id, model, res.usage.in, res.usage.out, Math.round(usd * 1e6));
});

/* ---------- Security-Quiz (1.5) ---------- */
app.get('/api/quiz', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  return { ...sec.quizPublic(store.settings(), store), questions: store.all('SELECT * FROM quiz_questions WHERE active = 1 ORDER BY id DESC LIMIT 50').map(sec.quizQuestionPublic) };
});
// Antworten anonym zählen: pro Tag und Frage nur „beantwortet“ und „richtig“ – ohne Gerät
const quizCount = new Map();
app.post('/api/quiz/answer', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  const key = d.id + dayKey(); const n = (quizCount.get(key) || 0) + 1; quizCount.set(key, n);
  if (quizCount.size > 5000) quizCount.clear();
  if (n > 30) return err(reply, 429, 'Für heute genug Fragen beantwortet.');
  const b = req.body || {};
  const qid = String(b.q || '');
  if (!/^(b\d{2}|c\d{1,9})$/.test(qid)) return err(reply, 400, 'Unbekannte Frage.');
  store.run('INSERT INTO quiz_stats (day, qid, n, ok) VALUES (?, ?, 1, ?) ON CONFLICT(day, qid) DO UPDATE SET n = n + 1, ok = ok + excluded.ok', dayKey(), qid, b.ok ? 1 : 0);
  if (qid[0] === 'b' && typeof b.text === 'string') store.run('INSERT OR IGNORE INTO quiz_labels (qid, text) VALUES (?, ?)', qid, b.text.replace(/<[^>]*>/g, '').slice(0, 200));
  return { ok: true };
});

/* ---------- Besuche: Sudo zu einem Kollegen schicken (1.4) ---------- */
const VISIT_KINDS = new Set(['note', 'coffee', 'duck', 'pizza', 'confetti', 'bug', 'duel']);
const visitName = d => d.visit_name || d.user || d.name;
media = createMedia(store, { cfg, matches: hub.matches, validTarget, publish: (ev, o) => hub.publish(ev, o), log: app.log });
hub.setMedia((d, s) => media.mediaPublic(d, s));
// 1.9: Was die Zentrale von Microsoft Entra braucht – liest Sudo-Entra-Setup.ps1 (gleich wie die PHP-Version, ohne Geheimnisse)
app.get('/api/entra-manifest', async () => ({ manifest: 1, zentrale: pkg.version, publicUrl: cfg.publicUrl, app: { name: 'Sudo-Zentrale', tag: 'SudoZentrale' },
  features: {
    kb: { title: 'Wissen aus SharePoint (Anleitungen)', graph: { application: ['Sites.Selected'], delegated: [] }, siteRole: 'read',
      settings: { tenant: 'kb_tenant', clientId: 'kb_client_id', secret: 'kb_client_secret', enable: 'kb_enabled' }, test: '/admin/api/kb/test', addSource: '/admin/api/kb/sources' },
    login: { title: 'Anmeldung an der Verwaltung mit Microsoft', graph: { application: [], delegated: ['openid', 'profile', 'email'] }, redirect: '/auth/callback', groupClaims: true, config: 'env' }
  } }));
// 1.9: Wissen & Anleitungen aus SharePoint
const kb = createKb(store, { cfg, log: app.log });
hub.setKb((d, s) => kb.isPublic(s));
const kbTry = async (reply, fn) => { try { return await fn(); } catch (e) { if (e instanceof KbError) return err(reply, e.code, e.message); throw e; } };
app.post('/api/kb/search', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (!kb.isPublic().enabled) return err(reply, 403, 'Anleitungen sind in der Zentrale nicht eingerichtet.');
  const q = String((req.body || {}).q || '').trim().slice(0, 200);
  return { items: q.length >= 2 ? kb.search(q, 10) : kb.recent(10), recent: q.length < 2 };
});
const mediaTry = async (reply, fn) => { try { return await fn(); } catch (e) { if (e instanceof MediaError) return err(reply, e.code, e.message); throw e; } };

/* ---------- Musikwünsche (1.8) ---------- */
app.get('/api/music', async (req, reply) => { const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.'); return media.status(d); });
app.post('/api/music/search', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('ms' + d.id + new Date().getHours(), 40)) return err(reply, 429, 'Zu viele Suchen – kurz warten.');
  return mediaTry(reply, async () => ({ tracks: await media.search(d, (req.body || {}).q) }));
});
app.post('/api/music/request', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('mr' + d.id + new Date().getHours(), 10)) return err(reply, 429, 'Zu viele Wünsche – kurz warten.');
  return mediaTry(reply, () => media.request(d, req.body || {}, visitName));
});
// Spotify verbinden (nur angemeldete Admins)
app.get('/admin/spotify/login', async (req, reply) => {
  if (!auth.session(req)) return err(reply, 401, 'Bitte in der Verwaltung anmelden.');
  return mediaTry(reply, () => reply.redirect(media.loginUrl()));
});
app.get('/admin/spotify/callback', async (req, reply) => {
  const s = auth.session(req); if (!s) return err(reply, 401, 'Bitte in der Verwaltung anmelden.');
  const msg = await media.callback(req.query || {}, s.user);
  return reply.redirect('/admin/?spotify=' + encodeURIComponent(msg) + '#music');
});
function visitsPublic(s, dev) {
  const sent = store.get('SELECT COUNT(*) n FROM visits WHERE day = ? AND from_id = ?', dayKey(), dev.id).n;
  return { enabled: s.visits_enabled === 'true', sendLeft: Math.max(0, Number(s.visits_send_per_day) - sent), sendMax: Number(s.visits_send_per_day) };
}
const cleanNote = t => String(t || '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
app.get('/api/peers', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  const s = store.settings();
  const peers = store.all('SELECT * FROM devices WHERE revoked = 0 AND allow_visits = 1 AND id <> ?', d.id).filter(p => hub.isOnline(p.id))
    .map(p => ({ id: p.id, name: visitName(p), full: store.get('SELECT COUNT(*) n FROM visits WHERE day = ? AND to_id = ?', dayKey(), p.id).n >= Number(s.visits_recv_per_day) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { peers, visits: visitsPublic(s, d) };
});
app.post('/api/visit', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  const s = store.settings(), b = req.body || {};
  if (s.visits_enabled !== 'true') return err(reply, 403, 'Besuche sind in der Zentrale ausgeschaltet.');
  if (!VISIT_KINDS.has(b.kind)) return err(reply, 400, 'Unbekannte Art von Besuch.');
  const to = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', String(b.to || ''));
  if (!to) return err(reply, 404, 'Diesen Kollegen gibt es nicht (mehr).');
  if (to.id === d.id) return err(reply, 400, 'Sich selbst besuchen ist geschummelt.');
  if (!to.allow_visits) return err(reply, 403, `${visitName(to)} möchte gerade keinen Besuch.`);
  if (!hub.isOnline(to.id)) return err(reply, 409, `${visitName(to)} ist gerade nicht online.`);
  if (store.get('SELECT COUNT(*) n FROM visits WHERE day = ? AND from_id = ?', dayKey(), d.id).n >= Number(s.visits_send_per_day)) return err(reply, 429, 'Für heute sind deine Besuche aufgebraucht. Morgen wieder!');
  if (store.get('SELECT COUNT(*) n FROM visits WHERE day = ? AND to_id = ?', dayKey(), to.id).n >= Number(s.visits_recv_per_day)) return err(reply, 429, `${visitName(to)} hatte heute schon genug Besuch.`);
  const note = b.kind === 'note' ? cleanNote(b.note) : '';
  if (b.kind === 'note' && !note) return err(reply, 400, 'Bitte etwas auf das Post-it schreiben.');
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? b.color : '#eef1f5';
  const r = store.run('INSERT INTO visits (created, day, from_id, to_id, kind, note) VALUES (?, ?, ?, ?, ?, ?)', now(), dayKey(), d.id, to.id, b.kind, note || null);
  const vid = Number(r.lastInsertRowid);
  hub.publish({ type: 'visit', visit: vid, kind: b.kind, note, from: visitName(d), color, rank: Math.max(0, Math.min(20, Number(b.rank) || 0)) }, { target: 'device:' + to.id, ttlMin: 120, author: 'visit:' + visitName(d) });
  store.audit(visitName(d), 'visit', `→ ${visitName(to)}: ${b.kind}${note ? ` „${note}“` : ''}`);
  return { ok: true, id: vid, to: visitName(to), visits: visitsPublic(s, d) };
});
app.post('/api/visit/result', async (req, reply) => {
  const d = deviceFrom(req);
  if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  const b = req.body || {};
  const v = store.get('SELECT * FROM visits WHERE id = ? AND to_id = ?', Number(b.id) || 0, d.id);
  if (!v) return err(reply, 404, 'Besuch unbekannt.');
  if (v.result) return { ok: true };
  const result = ['done', 'host_won', 'guest_won'].includes(b.result) ? b.result : 'done';
  store.run('UPDATE visits SET status = ?, result = ?, result_at = ? WHERE id = ?', 'done', result, now(), v.id);
  hub.publish({ type: 'visit_result', visit: v.id, kind: v.kind, to: visitName(d), result }, { target: 'device:' + v.from_id, ttlMin: 1440, author: 'visit' });
  if (v.kind === 'duel') {
    const from = store.get('SELECT * FROM devices WHERE id = ?', v.from_id);
    const gname = from ? visitName(from) : '?';
    store.audit(visitName(d), 'duel', `${gname} gegen ${visitName(d)}: ${result === 'host_won' ? visitName(d) : gname} gewinnt`);
  }
  return { ok: true };
});

/* ---------- Betrieb (1.6): Geräte melden Betroffenheit, Neustart-Stand und Selbsthilfe ---------- */
const perDevice = new Map();
const tooMany = (key, max) => { const n = (perDevice.get(key) || 0) + 1; perDevice.set(key, n); if (perDevice.size > 20000) perDevice.clear(); return n > max; };
app.post('/api/incident/affected', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('aff' + d.id + new Date().getHours(), 60)) return err(reply, 429, 'Zu viele Meldungen.');
  return opsTry(reply, () => { const r = ops.affected(d, req.body || {}); hub.refreshConfig(); return r; });
});
app.post('/api/restart/status', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('rst' + d.id + new Date().getHours(), 120)) return err(reply, 429, 'Zu viele Meldungen.');
  return opsTry(reply, () => ops.restartStatus(d, req.body || {}));
});
// Anonym: pro Tag und Werkzeug nur „benutzt“ und „hat geklappt“ – ohne Gerät
app.post('/api/selfhelp', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('sh' + d.id + dayKey(), 40)) return err(reply, 429, 'Für heute genug gezählt.');
  return opsTry(reply, () => ops.selfhelpCount(req.body || {}, dayKey()));
});

/* ---------- Mitarbeiter-Erlebnis (1.10): Stimmung, Rückmeldung nach Störungen, Start-Checkliste ---------- */
app.post('/api/pulse', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('pulse' + d.id + dayKey(), 30)) return err(reply, 429, 'Für heute genug geantwortet.');
  return opsTry(reply, () => dex.pulseAnswer(d, req.body || {}));
});
app.post('/api/pulse/incident', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('pinc' + d.id + dayKey(), 30)) return err(reply, 429, 'Für heute genug geantwortet.');
  return opsTry(reply, () => dex.incidentFeedback(d, req.body || {}));
});
app.post('/api/onboard', async (req, reply) => {
  const d = deviceFrom(req); if (!d) return err(reply, 401, 'Gerät unbekannt oder gesperrt.');
  if (tooMany('onb' + d.id + dayKey(), 200)) return err(reply, 429, 'Zu viele Meldungen.');
  return opsTry(reply, () => dex.onboardMark(d, req.body || {}));
});

// API-Schlüssel prüfen (Skripte, n8n, Monitoring)
function apiKeyFrom(req) {
  const key = bearer(req) || String(req.headers['x-api-key'] || '');
  const k = key && store.get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0', sha256(key));
  if (k) store.run('UPDATE api_keys SET last_used = ?, uses = uses + 1 WHERE id = ?', now(), k.id);
  return k;
}
// Störungen per Schnittstelle (1.6): z. B. Monitoring → n8n → Störung öffnen und wieder beenden
const apiLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
app.get('/api/incidents', apiLimit, async (req, reply) => {
  if (!apiKeyFrom(req)) return err(reply, 401, 'API-Schlüssel fehlt oder ist ungültig.');
  return store.all('SELECT * FROM incidents WHERE resolved IS NULL ORDER BY id DESC LIMIT 50').map(i => ops.incidentAdmin(i, false));
});
app.post('/api/incidents', apiLimit, async (req, reply) => {
  const k = apiKeyFrom(req); if (!k) return err(reply, 401, 'API-Schlüssel fehlt oder ist ungültig.');
  return opsTry(reply, () => { const r = ops.incidentCreate(req.body || {}, 'api:' + k.name); hub.refreshConfig(); return { ok: true, ...r }; });
});
app.post('/api/incidents/:id/resolve', apiLimit, async (req, reply) => {
  const k = apiKeyFrom(req); if (!k) return err(reply, 401, 'API-Schlüssel fehlt oder ist ungültig.');
  return opsTry(reply, () => { ops.incidentResolve(req.params.id, (req.body || {}).text, 'api:' + k.name); hub.refreshConfig(); return { ok: true }; });
});

/* ---------- Ereignis-API für Skripte (Backup-Prüfung, Monitoring …) ---------- */
app.post('/api/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
  const k = apiKeyFrom(req);
  if (!k) return err(reply, 401, 'API-Schlüssel fehlt oder ist ungültig.');
  const b = req.body || {};
  const ev = cleanEvent(b);
  if (!ev) return err(reply, 400, `Unbekannter type. Erlaubt: ${[...EVENT_TYPES].join(', ')}`);
  // Ungültiges Ziel ist ein Fehler – nie still „an alle“
  if (b.target != null && validTarget(b.target) !== String(b.target).trim()) return err(reply, 400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename oder E-Mail>');
  let target = validTarget(b.target == null ? 'all' : b.target);
  // 1.7: Regeln ordnen die Meldung ein (z. B. Ticket „Datensicherung Failed …“ → Backup fehlgeschlagen)
  const rr = rules.run(ev);
  let out = ev, ttlMin = b.ttl_min, author = 'api:' + k.name;
  if (rr.rule) {
    if (rr.event === null) return { ok: true, dropped: true, rule: rr.rule.name };
    out = cleanEvent(rr.event) || ev;
    if (rr.rule.target) target = rr.rule.target;
    if (rr.rule.ttl != null) ttlMin = rr.rule.ttl;
    author += ' · Regel ' + rr.rule.name;
  }
  const res = hub.publish(out, { target, ttlMin, author });
  return { ok: true, type: out.type, ...(rr.rule ? { rule: rr.rule.name } : {}), ...res };
});

/* =====================================================================
   Admin-Anmeldung und Admin-API
   ===================================================================== */
app.get('/auth/login', async (req, reply) => (auth.entraOn ? auth.entraStart(req, reply) : reply.redirect('/admin/?fehler=' + encodeURIComponent('Entra ID ist nicht eingerichtet.'))));
app.get('/auth/callback', async (req, reply) => auth.entraCallback(req, reply));
app.post('/auth/password', async (req, reply) => auth.localLogin(req, reply));
app.post('/auth/logout', async (req, reply) => { auth.logout(req, reply); return { ok: true }; });
app.get('/auth/info', async () => ({ entra: auth.entraOn, password: auth.localOn, version: pkg.version }));

app.register(async a => {
  // Jede Admin-Anfrage: gültige Sitzung; ändernde Anfragen zusätzlich mit CSRF-Token aus /admin/api/me
  a.addHook('preHandler', async (req, reply) => {
    const s = auth.session(req);
    if (!s) return err(reply, 401, 'Bitte anmelden.');
    if (req.method !== 'GET' && req.headers['x-csrf'] !== s.csrf) return err(reply, 403, 'Sicherheits-Token fehlt. Seite neu laden.');
    req.admin = s;
  });
  const who = req => req.admin.user;

  a.get('/me', async req => ({ user: req.admin.user, name: req.admin.name, via: req.admin.via, csrf: req.admin.csrf, version: pkg.version, publicUrl: cfg.publicUrl, aiKey: !!cfg.anthropicKey, transport: 'ws' }));

  a.get('/dashboard', async () => {
    const devs = store.all('SELECT id, name, user, last_seen FROM devices WHERE revoked = 0');
    const today = store.get('SELECT COALESCE(SUM(q),0) q, COALESCE(SUM(usd_micro),0) u FROM ai_usage WHERE day = ?', dayKey());
    const month = store.get('SELECT COALESCE(SUM(q),0) q, COALESCE(SUM(usd_micro),0) u FROM ai_usage WHERE day LIKE ?', dayKey().slice(0, 7) + '%');
    const s = store.settings();
    return {
      health: store.all('SELECT health FROM devices WHERE revoked = 0').reduce((a, r) => { const h = r.health ? JSON.parse(r.health) : null; const k = (h && h.s) || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, { ok: 0, warn: 0, bad: 0, unknown: 0 }),
      devices: devs.length, online: devs.filter(d => hub.isOnline(d.id)).length,
      aiToday: { q: today.q, usd: today.u / 1e6 }, aiMonth: { q: month.q, usd: month.u / 1e6, budgetUsd: centsToUsd(s.ai_monthly_cents) },
      messages: messagesList(8)
    };
  });

  /* Geräte */
  a.get('/devices', async () => store.all('SELECT * FROM devices WHERE revoked = 0 ORDER BY name COLLATE NOCASE').map(d => {
    const u = store.get('SELECT COALESCE(SUM(q),0) q, COALESCE(SUM(usd_micro),0) u FROM ai_usage WHERE device_id = ? AND day = ?', d.id, dayKey());
    return { id: d.id, name: d.name, user: d.user, upn: d.upn || null, host: d.host, version: d.version, lang: d.lang, groups: d.groups_, created: d.created, lastSeen: d.last_seen,
      online: hub.isOnline(d.id), aiDailyCents: d.ai_daily_cents, aiToday: { q: u.q, usd: u.u / 1e6 }, health: d.health ? JSON.parse(d.health) : null, healthAt: d.health_at || null,
      diag: d.diag ? JSON.parse(d.diag) : null, diagAt: d.diag_at || null };
  }));
  a.patch('/devices/:id', async (req, reply) => {
    const d = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', req.params.id);
    if (!d) return err(reply, 404, 'Gerät nicht gefunden.');
    const b = req.body || {};
    if (typeof b.name === 'string' && b.name.trim()) store.run('UPDATE devices SET name = ? WHERE id = ?', b.name.trim().slice(0, 60), d.id);
    if (typeof b.groups === 'string') store.run('UPDATE devices SET groups_ = ? WHERE id = ?', b.groups.split(',').map(g => g.trim()).filter(Boolean).join(',').slice(0, 200), d.id);
    if ('aiDailyCents' in b) store.run('UPDATE devices SET ai_daily_cents = ? WHERE id = ?', b.aiDailyCents === null || b.aiDailyCents === '' ? null : Math.max(0, Math.min(100000, Number(b.aiDailyCents) || 0)), d.id);
    store.audit(who(req), 'device_edit', `${d.name}: ${JSON.stringify(b).slice(0, 200)}`);
    return { ok: true };
  });
  a.delete('/devices/:id', async (req, reply) => {
    const d = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', req.params.id);
    if (!d) return err(reply, 404, 'Gerät nicht gefunden.');
    store.run('UPDATE devices SET revoked = 1 WHERE id = ?', d.id);
    hub.kick(d.id);
    store.audit(who(req), 'device_revoke', d.name);
    return { ok: true };
  });

  /* Registrierungscodes (z. B. per Intune an alle Sudos verteilt) */
  a.get('/enroll-codes', async () => store.all('SELECT id, label, groups_ AS groups, created, expires, uses_left AS usesLeft, used FROM enroll_codes WHERE revoked = 0 ORDER BY created DESC'));
  a.post('/enroll-codes', async req => {
    const b = req.body || {};
    const code = 'SZ-' + randomToken(15).replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
    const id = randomToken(6);
    const days = Number(b.days) || 0, uses = b.uses === '' || b.uses == null ? null : Math.max(1, Number(b.uses) || 1);
    store.run('INSERT INTO enroll_codes (id, code_hash, label, groups_, created, expires, uses_left) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, sha256(code), String(b.label || '').slice(0, 60), String(b.groups || '').slice(0, 200), now(), days > 0 ? now() + days * 864e5 : null, uses);
    store.audit(who(req), 'enroll_code_create', b.label || id);
    return { id, code };
  });
  a.delete('/enroll-codes/:id', async req => { store.run('UPDATE enroll_codes SET revoked = 1 WHERE id = ?', req.params.id); store.audit(who(req), 'enroll_code_revoke', req.params.id); return { ok: true }; });

  /* API-Schlüssel für Skripte */
  a.get('/api-keys', async () => store.all('SELECT id, name, prefix, created, last_used AS lastUsed, uses FROM api_keys WHERE revoked = 0 ORDER BY created DESC'));
  a.post('/api-keys', async (req, reply) => {
    const name = String((req.body || {}).name || '').trim().slice(0, 60);
    if (!name) return err(reply, 400, 'Bitte einen Namen angeben, z. B. „Backup-Prüfung“.');
    const key = 'szk_' + randomToken(30), id = randomToken(6);
    store.run('INSERT INTO api_keys (id, name, key_hash, prefix, created) VALUES (?, ?, ?, ?, ?)', id, name, sha256(key), key.slice(0, 8), now());
    store.audit(who(req), 'api_key_create', name);
    return { id, key };
  });
  a.delete('/api-keys/:id', async req => { store.run('UPDATE api_keys SET revoked = 1 WHERE id = ?', req.params.id); store.audit(who(req), 'api_key_revoke', req.params.id); return { ok: true }; });

  /* Meldungen */
  function messagesList(limit = 50) {
    const all = store.all('SELECT * FROM devices WHERE revoked = 0');
    return store.all('SELECT * FROM messages ORDER BY id DESC LIMIT ?', limit).map(m => ({
      id: m.id, created: m.created, expires: m.expires, type: m.type, event: JSON.parse(m.payload), target: m.target, author: m.author,
      delivered: store.get('SELECT COUNT(*) n FROM deliveries WHERE message_id = ?', m.id).n,
      targets: all.filter(d => hub.matches(m.target, d) && d.created <= m.created + 1).length
    }));
  }
  a.get('/messages', async () => messagesList(60));
  a.post('/messages', async (req, reply) => {
    const b = req.body || {};
    const ev = cleanEvent({ ...(b.event || {}), type: b.type });
    if (!ev) return err(reply, 400, 'Unbekannte Art der Meldung.');
    if (!Object.keys(ev).some(k => k !== 'type') && !['bug'].includes(ev.type)) return err(reply, 400, 'Bitte einen Text eingeben.');
    const target = validTarget(b.target);
    const r = hub.publish(ev, { target, ttlMin: b.ttlMin, author: who(req) });
    store.audit(who(req), 'message_send', `${ev.type} → ${target}`);
    return { ok: true, ...r };
  });
  a.delete('/messages/:id', async req => { store.run('UPDATE messages SET expires = ? WHERE id = ?', now(), Number(req.params.id)); store.audit(who(req), 'message_expire', req.params.id); return { ok: true }; });

  /* KI: Verbrauch und Einstellungen */
  a.get('/usage', async req => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    const since = dayKey(new Date(now() - (days - 1) * 864e5));
    const perDay = store.all('SELECT day, SUM(q) q, SUM(tin) tin, SUM(tout) tout, SUM(usd_micro) u FROM ai_usage WHERE day >= ? GROUP BY day ORDER BY day', since)
      .map(r => ({ day: r.day, q: r.q, tokens: r.tin + r.tout, usd: r.u / 1e6 }));
    const perDevice = store.all(`SELECT d.name, u.device_id, SUM(u.q) q, SUM(u.usd_micro) u FROM ai_usage u LEFT JOIN devices d ON d.id = u.device_id
      WHERE u.day >= ? GROUP BY u.device_id ORDER BY u DESC LIMIT 50`, since).map(r => ({ name: r.name || r.device_id, q: r.q, usd: r.u / 1e6 }));
    const perModel = store.all('SELECT model, SUM(q) q, SUM(usd_micro) u FROM ai_usage WHERE day >= ? GROUP BY model', since).map(r => ({ model: r.model, q: r.q, usd: r.u / 1e6 }));
    return { days, perDay, perDevice, perModel };
  });
  const noSecrets = o => Object.fromEntries(Object.entries(o).filter(([k]) => !SECRET_KEYS.includes(k)));   // Spotify-Geheimnisse nie an den Browser
  a.get('/settings', async () => ({ ...noSecrets(store.settings()), aiKey: !!cfg.anthropicKey, transport: 'ws' }));
  a.put('/settings', async (req, reply) => {
    const b = req.body || {};
    const ok = {
      ai_enabled: v => ['true', 'false'].includes(String(v)),
      ai_models: v => String(v).split(',').every(m => core.MODELS[m]) && String(v).length > 0,
      ai_daily_cents: v => Number.isFinite(+v) && +v >= 0 && +v <= 100000,
      ai_monthly_cents: v => Number.isFinite(+v) && +v >= 0 && +v <= 10000000,
      ai_context: v => ['true', 'false'].includes(String(v)),
      message_ttl_min: v => Number.isInteger(+v) && +v >= 1 && +v <= 10080,
      visits_enabled: v => ['true', 'false'].includes(String(v)),
      visits_send_per_day: v => Number.isInteger(+v) && +v >= 0 && +v <= 50,
      visits_recv_per_day: v => Number.isInteger(+v) && +v >= 0 && +v <= 50,
      quiz_enabled: v => ['true', 'false'].includes(String(v)),
      quiz_per_week: v => ['1', '2', '3', '5'].includes(String(v)),
      health_report: v => ['true', 'false'].includes(String(v)),
      // 1.6: Hilfe-Kontakt in Selbsthilfe und Hinweisen
      help_text: v => typeof v === 'string' && v.length <= 250,
      help_phone: v => typeof v === 'string' && (v === '' || /^\+?[\d ()/-]{3,30}$/.test(v)),
      help_mail: v => typeof v === 'string' && (v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)),
      help_url: v => typeof v === 'string' && (v === '' || /^https:\/\/\S{3,250}$/.test(v)),
      // 1.8: YouTube und Musikwünsche
      youtube_enabled: v => ['true', 'false'].includes(String(v)),
      youtube_interval: v => /^\d+$/.test(String(v)) && +v >= 5 && +v <= 240,
      youtube_ttl: v => /^\d+$/.test(String(v)) && +v >= 30 && +v <= 4320,
      music_enabled: v => ['true', 'false'].includes(String(v)),
      music_target: v => typeof v === 'string' && validTarget(v) === v,
      music_cost: v => /^\d+$/.test(String(v)) && +v <= 5000,
      music_per_day: v => /^\d+$/.test(String(v)) && +v >= 1 && +v <= 20,
      music_gap_min: v => /^\d+$/.test(String(v)) && +v <= 120,
      music_from: v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)),
      music_to: v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)),
      music_explicit: v => ['true', 'false'].includes(String(v)),
      music_announce: v => ['name', 'anon', 'off'].includes(String(v)),
      spotify_client_id: v => /^[a-f0-9]{0,64}$/i.test(String(v)),
      spotify_client_secret: v => /^[a-f0-9]{0,64}$/i.test(String(v)),
      spotify_device_id: v => /^[\w-]{0,80}$/.test(String(v)),
      spotify_device_name: v => typeof v === 'string' && v.length <= 80,
      // 1.9: Wissen & Anleitungen aus SharePoint
      kb_enabled: v => ['true', 'false'].includes(String(v)), kb_ai: v => ['true', 'false'].includes(String(v)),
      kb_interval: v => /^\d+$/.test(String(v)) && +v >= 15 && +v <= 1440,
      kb_tenant: v => typeof v === 'string' && /^[\w.-]{0,100}$/.test(v),
      kb_client_id: v => typeof v === 'string' && /^[a-f0-9-]{0,40}$/i.test(v),
      kb_client_secret: v => typeof v === 'string' && v.length <= 200 && !/\s/.test(v),
      // 1.10: Mitarbeiter-Erlebnis
      pulse_enabled: v => ['true', 'false'].includes(String(v)), pulse_monthly: v => ['true', 'false'].includes(String(v)), pulse_incident: v => ['true', 'false'].includes(String(v)),
      pulse_min: v => /^\d+$/.test(String(v)) && +v >= 3 && +v <= 20,
      onboard_enabled: v => ['true', 'false'].includes(String(v)), onboard_days: v => /^\d+$/.test(String(v)) && +v >= 1 && +v <= 180,
      tips_enabled: v => ['true', 'false'].includes(String(v)),
      tips_custom: v => typeof v === 'string' && v.length <= 20000 && tipsClean(v) !== null,
      // 1.12: Plugins
      plugins_user: v => ['true', 'false'].includes(String(v))
    };
    for (const [k, v] of Object.entries(b)) {
      if (!ok[k]) continue;
      if (!ok[k](v)) return err(reply, 400, k === 'tips_custom' ? 'Tipps: höchstens 50, je 5 bis 200 Zeichen, mit gültigem Programm.' : `Ungültiger Wert für ${k}.`);
      store.setSetting(k, k === 'tips_custom' ? JSON.stringify(tipsClean(v)) : String(v));
    }
    if (['kb_tenant', 'kb_client_id', 'kb_client_secret'].some(k => k in b)) store.setSetting('kb_token', '');   // neu anmelden
    hub.refreshConfig();
    store.audit(who(req), 'settings', JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k]) => !SECRET_KEYS.includes(k)))).slice(0, 300));
    return { ok: true, settings: noSecrets(store.settings()) };
  });

  a.get('/visits', async () => store.all(`SELECT v.*, COALESCE(f.visit_name, f.user, f.name) AS fname, COALESCE(t.visit_name, t.user, t.name) AS tname FROM visits v
    LEFT JOIN devices f ON f.id = v.from_id LEFT JOIN devices t ON t.id = v.to_id ORDER BY v.id DESC LIMIT 100`).map(v => ({ id: v.id, created: v.created, from: v.fname || '?', to: v.tname || '?', kind: v.kind, note: v.note, result: v.result })));
  /* Security-Quiz (1.5): eigene Fragen und anonyme Auswertung */
  /* YouTube (1.8) */
  a.get('/youtube', async () => {
    const s = store.settings();
    return { enabled: (s.youtube_enabled || 'true') === 'true', interval: Number(s.youtube_interval) || 15, ttl: Number(s.youtube_ttl) || 480,
      channels: store.all('SELECT * FROM yt_channels ORDER BY title').map(media.ytPublic),
      videos: store.all('SELECT v.*, c.title ctitle FROM yt_videos v LEFT JOIN yt_channels c ON c.channel_id = v.channel_id ORDER BY v.sent DESC LIMIT 15')
        .map(v => ({ id: v.video_id, title: v.title, channel: v.ctitle || '', published: v.published, sent: v.sent })) };
  });
  a.post('/youtube', async (req, reply) => mediaTry(reply, async () => ({ ok: true, ...(await media.ytAdd(req.body || {}, who(req))) })));
  a.post('/youtube/check', async () => ({ ok: true, ...(await media.ytCheck(true)) }));
  a.patch('/youtube/:id', async (req, reply) => {
    const c = store.get('SELECT * FROM yt_channels WHERE id = ?', Number(req.params.id)); if (!c) return err(reply, 404, 'Kanal nicht gefunden.');
    const b = req.body || {};
    if (b.active !== undefined) store.run('UPDATE yt_channels SET active = ? WHERE id = ?', b.active ? 1 : 0, c.id);
    if (b.shorts !== undefined) store.run('UPDATE yt_channels SET shorts = ? WHERE id = ?', b.shorts ? 1 : 0, c.id);
    if (b.target !== undefined) store.run('UPDATE yt_channels SET target = ? WHERE id = ?', validTarget(b.target), c.id);
    return { ok: true };
  });
  a.delete('/youtube/:id', async (req, reply) => {
    const c = store.get('SELECT * FROM yt_channels WHERE id = ?', Number(req.params.id)); if (!c) return err(reply, 404, 'Kanal nicht gefunden.');
    store.run('DELETE FROM yt_channels WHERE id = ?', c.id); store.audit(who(req), 'youtube_delete', c.title); return { ok: true };
  });
  /* Musikwünsche (1.8) */
  // 1.9: Wissen & Anleitungen aus SharePoint
  a.get('/kb', async () => kb.overview());
  a.post('/kb/test', async (req, reply) => kbTry(reply, async () => { await kb.test(); return { ok: true }; }));
  a.post('/kb/sources', async (req, reply) => kbTry(reply, async () => { const r = await kb.add((req.body || {}).url, who(req)); hub.refreshConfig(); return r; }));
  a.patch('/kb/sources/:id', async req => { kb.setActive(req.params.id, !!(req.body || {}).active); hub.refreshConfig(); return { ok: true }; });
  a.delete('/kb/sources/:id', async (req, reply) => kbTry(reply, async () => { kb.remove(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.post('/kb/sources/:id/sync', async (req, reply) => kbTry(reply, async () => { const r = await kb.sync(req.params.id); if (!r.ok) return err(reply, 502, r.error); return r; }));
  a.post('/kb/search', async req => { const q = String((req.body || {}).q || '').trim().slice(0, 200); return { items: q.length >= 2 ? kb.search(q, 10) : kb.recent(10), ai: q.length >= 2 ? kb.aiContext(q, { ...store.settings(), kb_enabled: 'true' }) !== '' : false }; });
  a.get('/music', async () => media.admin());
  a.post('/music/skip', async (req, reply) => mediaTry(reply, async () => { await media.skip(); store.audit(who(req), 'music_skip'); return { ok: true }; }));
  a.post('/music/veto/:id', async (req, reply) => mediaTry(reply, () => media.veto(req.params.id, who(req))));
  a.delete('/music/blocked/:track', async req => { media.unblock(req.params.track, who(req)); return { ok: true }; });
  a.post('/music/disconnect', async req => { media.disconnect(); store.audit(who(req), 'spotify_disconnect'); hub.refreshConfig(); return { ok: true }; });

  /* Regeln (1.7) */
  a.get('/rules', async () => ({ rules: rules.list(), ticketLink: store.settings().ticket_link || '' }));
  a.post('/rules', async (req, reply) => opsTry(reply, () => { const r = rules.create(req.body || {}); store.audit(who(req), 'rule_create', r.name); return { ok: true, id: r.id }; }));
  a.put('/rules/settings', async (req, reply) => {
    const tl = String((req.body || {}).ticketLink || '').trim();
    if (tl && (!/^https:\/\/\S{3,300}$/.test(tl) || !tl.includes('{ticket}'))) return err(reply, 400, 'Die Ticket-Vorlage muss mit https:// beginnen und {ticket} enthalten.');
    store.setSetting('ticket_link', tl); store.audit(who(req), 'settings', 'Ticket-Link: ' + tl);
    return { ok: true };
  });
  a.post('/rules/test', async (req, reply) => {
    const ev = cleanEvent((req.body || {}).event || {});
    if (!ev) return err(reply, 400, `Unbekannter type. Erlaubt: ${[...EVENT_TYPES].join(', ')}`);
    const r = rules.run(ev, false);
    return { in: ev, rule: r.rule ? rules.pub(r.rule) : null, out: r.event ? cleanEvent(r.event) : null, dropped: !!r.rule && r.event === null };
  });
  a.put('/rules/:id', async (req, reply) => opsTry(reply, () => { const n = rules.update(req.params.id, req.body || {}); store.audit(who(req), 'rule_edit', n); return { ok: true }; }));
  a.patch('/rules/:id', async (req, reply) => opsTry(reply, () => { rules.patch(req.params.id, req.body || {}); return { ok: true }; }));
  a.delete('/rules/:id', async (req, reply) => opsTry(reply, () => { const n = rules.remove(req.params.id); store.audit(who(req), 'rule_delete', n); return { ok: true }; }));

  /* Betrieb (1.6) */
  a.get('/ops', async () => ops.adminOverview(dayKey(new Date(Date.now() - 30 * 864e5))));
  a.post('/incidents', async (req, reply) => opsTry(reply, () => { const r = ops.incidentCreate(req.body || {}, who(req)); hub.refreshConfig(); return { ok: true, ...r }; }));
  a.post('/incidents/:id/resolve', async (req, reply) => opsTry(reply, () => { ops.incidentResolve(req.params.id, (req.body || {}).text, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.post('/restart', async (req, reply) => opsTry(reply, () => { const id = ops.restartCreate(req.body || {}, who(req)); hub.refreshConfig(); return { ok: true, id }; }));
  a.post('/restart/:id/end', async (req, reply) => opsTry(reply, () => { ops.restartEnd(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.get('/quiz', async () => {
    const since = dayKey(new Date(Date.now() - 30 * 864e5));
    const labels = Object.fromEntries(store.all('SELECT * FROM quiz_labels').map(l => [l.qid, l.text]));
    const own = store.all('SELECT * FROM quiz_questions ORDER BY id DESC');
    for (const q of own) labels['c' + q.id] = q.q;
    const tot = store.get('SELECT COALESCE(SUM(n),0) n, COALESCE(SUM(ok),0) ok FROM quiz_stats WHERE day >= ?', since);
    return { questions: own.map(q => ({ ...sec.quizQuestionPublic(q), active: !!q.active, created: q.created })), total: { n: tot.n, ok: tot.ok },
      perQuestion: store.all('SELECT qid, SUM(n) n, SUM(ok) ok FROM quiz_stats WHERE day >= ? GROUP BY qid', since).map(r => ({ qid: r.qid, label: labels[r.qid] || r.qid, n: r.n, ok: r.ok })) };
  });
  a.post('/quiz', async (req, reply) => {
    const b = req.body || {};
    const q = String(b.q || '').trim().slice(0, 400);
    const ans = (Array.isArray(b.a) ? b.a : []).map(x => String(x).trim().slice(0, 200)).filter(Boolean);
    const ok = Number(b.ok);
    if (!q || ans.length < 2 || ans.length > 4) return err(reply, 400, 'Bitte eine Frage und zwei bis vier Antworten angeben.');
    if (!Number.isInteger(ok) || ok < 0 || ok >= ans.length) return err(reply, 400, 'Bitte die richtige Antwort markieren.');
    const link = String(b.link || '');
    if (link && !/^https:\/\/\S{3,300}$/.test(link)) return err(reply, 400, 'Der Link muss mit https:// beginnen.');
    const r = store.run('INSERT INTO quiz_questions (created, updated, q, answers, ok, why, link, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', now(), now(), q, JSON.stringify(ans), ok, String(b.why || '').slice(0, 600), link);
    store.audit(who(req), 'quiz_create', q);
    hub.refreshConfig();
    return { ok: true, id: 'c' + r.lastInsertRowid };
  });
  a.patch('/quiz/:id', async (req, reply) => {
    const q = store.get('SELECT * FROM quiz_questions WHERE id = ?', Number(req.params.id));
    if (!q) return err(reply, 404, 'Frage nicht gefunden.');
    store.run('UPDATE quiz_questions SET active = ?, updated = ? WHERE id = ?', req.body && req.body.active ? 1 : 0, now(), q.id);
    hub.refreshConfig();
    return { ok: true };
  });
  a.delete('/quiz/:id', async (req, reply) => {
    const q = store.get('SELECT * FROM quiz_questions WHERE id = ?', Number(req.params.id));
    if (!q) return err(reply, 404, 'Frage nicht gefunden.');
    store.run('DELETE FROM quiz_questions WHERE id = ?', q.id);
    store.audit(who(req), 'quiz_delete', q.q);
    hub.refreshConfig();
    return { ok: true };
  });
  a.post('/quiz/:id/offer', async (req, reply) => {
    const q = store.get('SELECT * FROM quiz_questions WHERE id = ? AND active = 1', Number(req.params.id));
    if (!q) return err(reply, 404, 'Frage nicht gefunden oder nicht aktiv.');
    const t = String((req.body || {}).target || 'all');
    const target = validTarget(t);
    const r = hub.publish({ type: 'quiz', q: 'c' + q.id }, { target, ttlMin: 480, author: who(req) });
    store.audit(who(req), 'quiz_offer', `${q.q} → ${target}`);
    return { ok: true, ...r };
  });

  /* Mitarbeiter-Erlebnis (1.10): Stimmungsbarometer, Rückmeldungen nach Störungen, Start-Checkliste, Tipps */
  a.get('/dex', async () => dex.admin());
  a.post('/pulse', async (req, reply) => opsTry(reply, () => { const id = dex.pulseCreate(req.body || {}, who(req)); hub.refreshConfig(); return { ok: true, id }; }));
  a.post('/pulse/:id/end', async (req, reply) => opsTry(reply, () => { dex.pulseEnd(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.delete('/pulse/:id', async (req, reply) => opsTry(reply, () => { dex.pulseDelete(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.post('/onboard', async (req, reply) => opsTry(reply, () => { const id = dex.itemAdd(req.body || {}, who(req)); hub.refreshConfig(); return { ok: true, id }; }));
  a.patch('/onboard/:id', async (req, reply) => opsTry(reply, () => { dex.itemPatch(req.params.id, req.body || {}); hub.refreshConfig(); return { ok: true }; }));
  a.delete('/onboard/:id', async (req, reply) => opsTry(reply, () => { dex.itemDelete(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.post('/onboard/device/:id', async (req, reply) => opsTry(reply, () => { dex.showAgain(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));

  /* Plugins (1.12) – ein Plugin darf 2 MB haben, als JSON etwas mehr */
  a.get('/plugins', async () => plugins.admin());
  a.post('/plugins', { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => opsTry(reply, () => { const r = plugins.save(req.body || {}, who(req)); hub.refreshConfig(); return r; }));
  a.patch('/plugins/:id', async (req, reply) => opsTry(reply, () => { plugins.patch(req.params.id, req.body || {}, who(req)); hub.refreshConfig(); return { ok: true }; }));
  a.delete('/plugins/:id', async (req, reply) => opsTry(reply, () => { plugins.remove(req.params.id, who(req)); hub.refreshConfig(); return { ok: true }; }));

  a.get('/audit', async () => store.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200'));
}, { prefix: '/admin/api' });

/* ---------- Start ---------- */
setInterval(() => { try { store.cleanup(); } catch (e) { log.error(e.message); } }, 3600e3).unref();
app.listen({ port: cfg.port, host: cfg.host }).then(() => {
  log.info(`Sudo-Zentrale ${pkg.version} läuft auf ${cfg.publicUrl} (Port ${cfg.port}) · Entra: ${auth.entraOn ? 'an' : 'aus'} · Passwort-Login: ${auth.localOn ? 'an' : 'aus'} · KI: ${cfg.anthropicKey ? 'Schlüssel da' : 'kein Schlüssel'}`);
  if (!auth.entraOn && !auth.localOn) log.warn('Keine Admin-Anmeldung eingerichtet! ENTRA_* oder ADMIN_PASSWORD in der .env setzen.');
  if (!store.get('SELECT 1 FROM enroll_codes LIMIT 1') && env.FIRST_ENROLL_CODE) {
    store.run('INSERT INTO enroll_codes (id, code_hash, label, created) VALUES (?, ?, ?, ?)', randomToken(6), sha256(env.FIRST_ENROLL_CODE), 'Erster Code (.env)', now());
    log.info('Registrierungscode aus FIRST_ENROLL_CODE angelegt.');
  }
}).catch(e => { log.error(e); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.close().then(() => process.exit(0)); });
