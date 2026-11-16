// rules.js – Regeln (1.7): Die Zentrale ordnet eingehende Meldungen der Schnittstelle selbst ein.
// Beispiel: Ticket „Datensicherung Failed Muster GmbH“ → backup_failed mit kunde = „Muster GmbH“.
// Gleiche Logik wie app/rules.php der PHP-Version.
'use strict';
const { now } = require('./db');

const RULE_ACTIONS = ['backup_failed', 'server_down', 'warning', 'message', 'success', 'deploy_ok', 'ticket', 'drop'];
const RULE_EXTRACT = ['rest', 'paren', 'regex', 'whole'];
const RULE_MAIN = { backup_failed: 'kunde', server_down: 'host', deploy_ok: 'version', warning: 'text', message: 'text', success: 'text', ticket: 'titel' };
const FILLER = new Set(['job', 'jobs', 'auf', 'bei', 'für', 'fuer', 'von', 'beim', 'mit', 'der', 'die', 'das', 'des', 'ist', 'wurde', 'status', 'meldung', 'alarm', 'alert', 'ticket', 'kunde', 'kunden', 'customer']);
const DEFAULTS = [
  ['Backup fehlgeschlagen', 'backup|datensicherung|sicherung|veeam|acronis|avepoint|synology hyper backup',
    'failed|fehlgeschlagen|fehler|error|abgebrochen|nicht erfolgreich|warning|warnung', 'backup_failed'],
  ['Server oder Dienst nicht erreichbar', 'server|host|dienst|service|vpn|firewall|website|webseite|nas|switch|drucker',
    'down|offline|nicht erreichbar|ausgefallen|unreachable|antwortet nicht|no response', 'server_down'],
  ['Zertifikat läuft ab', 'zertifikat|certificate|ssl|tls', 'läuft ab|laeuft ab|abgelaufen|expire|expiring|expiry', 'warning']
];
const TRIM = /^[\s:\-–|/.,;]+|[\s:\-–|/.,;]+$/gu;
const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class RuleError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new RuleError(code, msg); };

const mainText = ev => { for (const k of ['titel', 'text', 'kunde', 'host', 'version']) if (ev[k] != null && String(ev[k]).trim() !== '') return String(ev[k]).trim(); return ''; };
const groupsOf = p => String(p).split(',').map(part => part.split('|').map(w => w.trim().toLowerCase()).filter(Boolean)).filter(a => a.length);
const regexOf = p => { try { return new RegExp(p, 'iu'); } catch { return null; } };

function match(r, ev) {
  if (r.match_type && r.match_type !== ev.type) return null;
  const hay = r.field === 'any' ? Object.entries(ev).filter(([k, v]) => k !== 'type' && v != null && typeof v !== 'object').map(([, v]) => String(v)).join(' ') : mainText(ev);
  if (!hay) return null;
  if (r.mode === 'regex') { const re = regexOf(r.pattern); const m = re && hay.match(re); return m ? { regex: m } : null; }
  const low = hay.toLowerCase(), hits = [];
  for (const alts of groupsOf(r.pattern)) {
    const found = alts.filter(w => low.includes(w));           // alle vorkommenden Wörter (für „Rest des Titels“)
    if (!found.length) return null;
    hits.push(...found);
  }
  return hits.length ? { words: hits } : null;
}
function extract(r, ev, m) {
  const t = mainText(ev);
  if (r.extract === 'whole') return t;
  if (r.extract === 'paren') { const p = t.match(/\(([^()]+)\)\s*$/u); return p ? p[1].trim() : t; }
  if (r.extract === 'regex') return m.regex && m.regex[1] && m.regex[1].trim() ? m.regex[1].trim() : t;
  let s = t;
  for (const w of [...(m.words || [])].sort((a, b) => b.length - a.length)) {
    const q = quote(w);
    s = s.replace(w.includes(' ') ? new RegExp(q, 'giu') : new RegExp(`[\\p{L}\\p{N}_-]*${q}\\p{L}*`, 'giu'), ' ');
  }
  s = s.replace(/#\d+/gu, ' ').replace(/[[(]\s*[\])]/gu, ' ');
  s = s.split(/\s+/u).filter(w => { const c = w.replace(TRIM, ''); return c && !FILLER.has(c.toLowerCase()); }).join(' ').replace(TRIM, '');
  return s || t;
}
function apply(r, ev, m, s) {
  if (r.action === 'drop') return null;
  const type = r.action, main = RULE_MAIN[type] || 'text', t = mainText(ev);
  const val = r.extract === 'whole' && ['backup_failed', 'server_down', 'deploy_ok'].includes(type) ? t : extract(r, ev, m);
  const out = { type, [main]: ((main === 'text' || main === 'titel') && r.extract === 'rest' ? t : val).slice(0, 240) };
  if (type === 'server_down') out.text = ev.ticket ? 'Ticket #' + ev.ticket : t.slice(0, 240);
  if (main === 'text' && ev.ticket && !out.text.includes(String(ev.ticket))) out.text = ('Ticket #' + ev.ticket + ': ' + out.text).slice(0, 240);
  if (ev.ticket) out.ticket = String(ev.ticket);
  if (type === 'ticket' && !out.ticket) out.ticket = '–';
  const tpl = r.link_tpl || s.ticket_link || '';
  if (ev.link) out.link = ev.link;
  else if (tpl && ev.ticket) out.link = tpl.replace('{ticket}', encodeURIComponent(String(ev.ticket)));
  if (r.dur) out.dur = r.dur; else if (ev.dur != null) out.dur = ev.dur;
  return out;
}

function createRules(store, { validTarget, EVENT_TYPES }) {
  function seed() {
    if (store.get('SELECT COUNT(*) n FROM rules').n > 0) return;
    DEFAULTS.forEach(([name, a, b, act], i) => store.run(`INSERT INTO rules (pos, name, active, match_type, field, mode, pattern, action, extract, target, dur, ttl, link_tpl, hits, created, updated)
      VALUES (?, ?, 1, '', 'title', 'words', ?, ?, 'rest', '', '', NULL, '', 0, ?, ?)`, (i + 1) * 10, name, `${a}, ${b}`, act, now(), now()));
  }
  // Alle aktiven Regeln der Reihe nach, die erste passende gewinnt
  function run(ev, count = true) {
    const s = store.settings();
    for (const r of store.all('SELECT * FROM rules WHERE active = 1 ORDER BY pos, id')) {
      const m = match(r, ev);
      if (!m) continue;
      if (count) store.run('UPDATE rules SET hits = hits + 1, last_hit = ? WHERE id = ?', now(), r.id);
      return { rule: r, event: apply(r, ev, m, s) };
    }
    return { rule: null, event: ev };
  }
  const pub = r => ({ id: r.id, pos: r.pos, name: r.name, active: !!r.active, matchType: r.match_type, field: r.field, mode: r.mode, pattern: r.pattern, action: r.action,
    extract: r.extract, target: r.target, dur: r.dur, ttl: r.ttl ?? null, linkTpl: r.link_tpl || '', hits: r.hits, lastHit: r.last_hit || null });
  function clean(b) {
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Bitte der Regel einen Namen geben.');
    const mode = b.mode === 'regex' ? 'regex' : 'words';
    const pattern = String(b.pattern || '').trim().slice(0, 500);
    if (!pattern) fail(400, 'Bitte angeben, woran die Meldung erkannt wird.');
    if (mode === 'regex' && !regexOf(pattern)) fail(400, 'Der reguläre Ausdruck ist ungültig.');
    if (mode === 'words' && !groupsOf(pattern).length) fail(400, 'Bitte mindestens ein Wort angeben.');
    if (!RULE_ACTIONS.includes(b.action)) fail(400, 'Unbekannte Aktion.');
    const mt = String(b.matchType || '');
    if (mt && !EVENT_TYPES.has(mt)) fail(400, 'Unbekannte Meldungsart.');
    const target = String(b.target || '').trim();
    if (target && validTarget(target) !== target) fail(400, 'Ungültiges Ziel. Erlaubt: all, group:<Gruppe>, device:<Gerät>, user:<Anmeldename>');
    const dur = String(b.dur ?? '');
    if (dur && dur !== 'klick' && !(/^\d+$/.test(dur) && +dur >= 5 && +dur <= 120)) fail(400, 'Anzeigedauer: 5 bis 120 Sekunden oder „klick“.');
    const ttl = b.ttl === '' || b.ttl == null ? null : Math.max(1, Math.min(10080, Math.trunc(Number(b.ttl)) || 1));
    const link = String(b.linkTpl || '').trim();
    if (link && !/^https:\/\/\S{3,300}$/.test(link)) fail(400, 'Die Link-Vorlage muss mit https:// beginnen.');
    return { name, active: b.active === undefined || b.active ? 1 : 0, match_type: mt, field: b.field === 'any' ? 'any' : 'title', mode, pattern, action: b.action,
      extract: RULE_EXTRACT.includes(b.extract) ? b.extract : 'rest', target, dur, ttl, link_tpl: link };
  }
  function create(b) {
    const c = clean(b);
    const pos = store.get('SELECT COALESCE(MAX(pos), 0) p FROM rules').p + 10;
    const r = store.run(`INSERT INTO rules (pos, name, active, match_type, field, mode, pattern, action, extract, target, dur, ttl, link_tpl, hits, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, pos, c.name, c.active, c.match_type, c.field, c.mode, c.pattern, c.action, c.extract, c.target, c.dur, c.ttl, c.link_tpl, now(), now());
    return { id: Number(r.lastInsertRowid), name: c.name };
  }
  function update(id, b) {
    const r = store.get('SELECT * FROM rules WHERE id = ?', Number(id)); if (!r) fail(404, 'Regel nicht gefunden.');
    const c = clean(b);
    store.run(`UPDATE rules SET name = ?, active = ?, match_type = ?, field = ?, mode = ?, pattern = ?, action = ?, extract = ?, target = ?, dur = ?, ttl = ?, link_tpl = ?, updated = ? WHERE id = ?`,
      c.name, c.active, c.match_type, c.field, c.mode, c.pattern, c.action, c.extract, c.target, c.dur, c.ttl, c.link_tpl, now(), r.id);
    return c.name;
  }
  function patch(id, b) {
    const r = store.get('SELECT * FROM rules WHERE id = ?', Number(id)); if (!r) fail(404, 'Regel nicht gefunden.');
    if (b.active !== undefined) store.run('UPDATE rules SET active = ?, updated = ? WHERE id = ?', b.active ? 1 : 0, now(), r.id);
    if (b.move !== undefined) {
      const ids = store.all('SELECT id FROM rules ORDER BY pos, id').map(x => x.id);
      const i = ids.indexOf(r.id), j = i + (Number(b.move) < 0 ? -1 : 1);
      if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
      ids.forEach((x, n) => store.run('UPDATE rules SET pos = ? WHERE id = ?', (n + 1) * 10, x));
    }
  }
  function remove(id) { const r = store.get('SELECT * FROM rules WHERE id = ?', Number(id)); if (!r) fail(404, 'Regel nicht gefunden.'); store.run('DELETE FROM rules WHERE id = ?', r.id); return r.name; }
  return { seed, run, pub, create, update, patch, remove, list: () => store.all('SELECT * FROM rules ORDER BY pos, id').map(pub) };
}

module.exports = { createRules, RuleError };
