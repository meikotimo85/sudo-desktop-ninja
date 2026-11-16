// hub.js – verbundene Sudos (WebSocket), Meldungen zustellen, Offline-Geräte beim nächsten Verbinden nachversorgen
'use strict';
const sec = require('./security');
const { sha256, now } = require('./db');

const EVENT_TYPES = new Set(['backup_failed', 'server_down', 'deploy_ok', 'ticket', 'bug', 'message', 'success', 'warning', 'video', 'music']);
const groupsOf = d => String(d.groups_ || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean);
// 1.5: Ziel „user:“ – mit @ der Anmeldename (UPN) des Geräts, ohne @ der Windows-Benutzer oder der Teil vor dem @
const TARGET_RE = /^(all|group:[\w .-]{1,40}|device:[\w .-]{1,60}|user:[\w .@+'-]{1,120})$/iu;
const validTarget = t => (typeof t === 'string' && TARGET_RE.test(t.trim()) ? t.trim() : 'all');
const cleanUpn = v => { v = String(v || '').trim().toLowerCase(); return /^[^\s@\\/]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$/.test(v) ? v : null; };
function userMatches(v, dev) {
  if (!v) return false;
  const upn = String(dev.upn || '').toLowerCase(), win = String(dev.user || '').toLowerCase();
  if (v.includes('@')) return upn === v || (!upn && !!win && win === v.split('@')[0]);
  return win === v || (!!upn && upn.split('@')[0] === v);
}
function matches(target, dev) {
  if (!target || target === 'all') return true;
  if (target.startsWith('group:')) return groupsOf(dev).includes(target.slice(6).toLowerCase());
  if (target.startsWith('device:')) { const v = target.slice(7).toLowerCase(); return dev.id === v || String(dev.name).toLowerCase() === v; }
  if (target.startsWith('user:')) return userMatches(target.slice(5).trim().toLowerCase(), dev);
  return false;
}
// Felder säubern: nur Text/Zahlen, kurz, höchstens 12 Felder
function cleanEvent(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim();
  if (!EVENT_TYPES.has(type)) return null;
  out.type = type;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'type' || k === 'target' || k === 'ttl_min' || !/^[a-z_]{1,24}$/i.test(k)) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    if (++n > 12) break;
    out[k] = String(v).replace(/[\u0000-\u0009\u000b-\u001f]/g, '').slice(0, 240);
  }
  return out;
}

function createHub({ store, log, appInfo }) {
  const conns = new Map();                 // deviceId → Set(socket)

  const online = () => [...conns.keys()];
  const isOnline = id => conns.has(id) && conns.get(id).size > 0;
  let opsFor = () => undefined, mediaFor = () => undefined, kbFor = () => undefined, dexFor = () => undefined;   // 1.10: dex = Mitarbeiter-Erlebnis   // 1.6/1.8: je Gerät (setzt server.js)                 // 1.6: Störungen/Neustarts/Hilfe je Gerät (setzt server.js)
  const sendTo = (id, obj) => { for (const ws of conns.get(id) || []) { try { ws.send(JSON.stringify(obj)); } catch { /* weg */ } } };

  function pending(dev) {
    // Erst nach Ziel filtern, dann auf 30 begrenzen (bis 1.7.0 umgekehrt – bei vielen fremden Meldungen bekam ein Gerät nichts mehr)
    return store.all(`SELECT m.* FROM messages m WHERE m.expires > ? AND m.created >= ?
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id = m.id AND d.device_id = ?) ORDER BY m.id LIMIT 2000`,
    now(), dev.created, dev.id).filter(m => matches(m.target, dev)).slice(0, 30);
  }
  function deliver(dev, m) { sendTo(dev.id, { t: 'event', id: m.id, event: JSON.parse(m.payload), created: m.created }); }

  // Neue Meldung: speichern, an alle passenden Online-Geräte schicken
  function publish(event, { target = 'all', ttlMin, author } = {}) {
    const ttl = Math.max(1, Math.min(7 * 1440, Number(ttlMin) || Number(store.settings().message_ttl_min) || 1440));
    const r = store.run('INSERT INTO messages (created, expires, type, payload, target, author) VALUES (?, ?, ?, ?, ?, ?)',
      now(), now() + ttl * 60e3, event.type, JSON.stringify(event), target, author || null);
    const m = store.get('SELECT * FROM messages WHERE id = ?', r.lastInsertRowid);
    let sent = 0;
    for (const id of online()) {
      const dev = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', id);
      if (dev && matches(target, dev)) { deliver(dev, m); sent++; }
    }
    const total = store.all('SELECT * FROM devices WHERE revoked = 0').filter(d => matches(target, d)).length;
    log.info(`Meldung #${m.id} (${event.type}) an ${target}: ${sent} sofort, ${total} insgesamt`);
    const res = { id: m.id, sentNow: sent, targets: total };
    if (!total && target !== 'all') res.hint = `Kein Gerät passt zu „${target}“. Bei user: bitte den Anmeldenamen prüfen (Zentrale → Geräte, zweite Zeile). Bereits registrierte Geräte, die sich in den nächsten ${ttl} min passend melden, bekommen die Meldung noch.`;
    return res;
  }

  // WebSocket: erst „hello“ mit Geräte-Token, dann Meldungen, Quittungen und Ping
  function handle(socket, req) {
    let dev = null;
    const authTimer = setTimeout(() => { if (!dev) socket.close(4001, 'auth timeout'); }, 8000);
    let alive = true;
    const pinger = setInterval(() => {
      if (!alive) { try { socket.terminate(); } catch { /* weg */ } return; }
      alive = false;
      try { socket.ping(); socket.send(JSON.stringify({ t: 'ping' })); } catch { /* weg */ }
    }, 30000);
    socket.on('pong', () => { alive = true; });
    socket.on('message', raw => {
      let msg; try { msg = JSON.parse(String(raw).slice(0, 20000)); } catch { return; }
      alive = true;
      if (!dev) {
        if (msg.t !== 'hello' || !msg.token) return socket.close(4001, 'auth');
        dev = store.get('SELECT * FROM devices WHERE token_hash = ? AND revoked = 0', sha256(msg.token));
        if (!dev) { log.warn('WebSocket mit unbekanntem Token von ' + req.ip); return socket.close(4003, 'unknown device'); }
        clearTimeout(authTimer);
        store.run('UPDATE devices SET last_seen = ?, version = ?, lang = ? WHERE id = ?', now(), String(msg.version || '').slice(0, 20), String(msg.lang || '').slice(0, 5), dev.id);
        const upn = cleanUpn(msg.upn);
        if (upn && upn !== dev.upn) store.run('UPDATE devices SET upn = ? WHERE id = ?', upn, dev.id);
        if (msg.visits && typeof msg.visits === 'object') store.run('UPDATE devices SET allow_visits = ?, visit_name = ? WHERE id = ?', msg.visits.allow ? 1 : 0, String(msg.visits.name || '').trim().slice(0, 30) || null, dev.id);
        if (!conns.has(dev.id)) conns.set(dev.id, new Set());
        conns.get(dev.id).add(socket);
        const s = store.settings();
        socket.send(JSON.stringify({ t: 'welcome', device: { id: dev.id, name: dev.name, groups: String(dev.groups_ || '').split(',').map(g => g.trim()).filter(Boolean) }, server: appInfo,
          ai: { enabled: s.ai_enabled === 'true', models: s.ai_models.split(','), context: s.ai_context === 'true' }, health: sec.healthPublic(s), quiz: sec.quizPublic(s, store), ops: opsFor(dev, s), media: mediaFor(dev, s), kb: kbFor(dev, s), dex: dexFor(dev, s) }));
        for (const m of pending(dev)) deliver(dev, m);
        return;
      }
      if (msg.t === 'ack' && Number.isInteger(msg.id) && store.get('SELECT 1 FROM messages WHERE id = ?', msg.id)) store.run('INSERT OR IGNORE INTO deliveries (message_id, device_id, delivered) VALUES (?, ?, ?)', msg.id, dev.id, now());
      else if (msg.t === 'health' && msg.health) sec.storeHealth(store, dev.id, msg.health);
      else if (msg.t === 'diag' && msg.diag) sec.storeDiag(store, dev.id, msg.diag);
      else if (msg.t === 'ops') { const s = store.settings(); const d = store.get('SELECT * FROM devices WHERE id = ?', dev.id) || dev; socket.send(JSON.stringify({ t: 'config', ...configFor(d, s) })); }
      else if (msg.t === 'prefs' && msg.visits) store.run('UPDATE devices SET allow_visits = ?, visit_name = ? WHERE id = ?', msg.visits.allow ? 1 : 0, String(msg.visits.name || '').trim().slice(0, 30) || null, dev.id);
      else if (msg.t === 'pong' || msg.t === 'ping') { store.run('UPDATE devices SET last_seen = ? WHERE id = ?', now(), dev.id); if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong' })); }
    });
    socket.on('close', () => {
      clearTimeout(authTimer); clearInterval(pinger);
      if (dev && conns.has(dev.id)) { conns.get(dev.id).delete(socket); if (!conns.get(dev.id).size) conns.delete(dev.id); store.run('UPDATE devices SET last_seen = ? WHERE id = ?', now(), dev.id); }
    });
    socket.on('error', () => { /* close folgt */ });
  }

  // Gerät gesperrt: Verbindung sofort trennen
  function kick(id) { for (const ws of conns.get(id) || []) { try { ws.close(4003, 'revoked'); } catch { /* weg */ } } conns.delete(id); }
  const configFor = (d, s) => ({ ai: { enabled: s.ai_enabled === 'true', models: s.ai_models.split(','), context: s.ai_context === 'true' }, health: sec.healthPublic(s), quiz: sec.quizPublic(s, store), ops: opsFor(d, s), media: mediaFor(d, s), kb: kbFor(d, s), dex: dexFor(d, s) });
  function refreshConfig() {
    const s = store.settings();
    for (const id of online()) { const d = store.get('SELECT * FROM devices WHERE id = ? AND revoked = 0', id); if (d) sendTo(id, { t: 'config', ...configFor(d, s) }); }
  }

  return { handle, publish, online, isOnline, kick, refreshConfig, matches, setOps: fn => { opsFor = fn; }, setMedia: fn => { mediaFor = fn; }, setKb: fn => { kbFor = fn; }, setDex: fn => { dexFor = fn; } };
}

module.exports = { createHub, cleanEvent, EVENT_TYPES, groupsOf, validTarget, cleanUpn, matches };
