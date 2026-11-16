// security.js – Gerätezustand und Security-Quiz (1.5), gemeinsam für hub.js und server.js
'use strict';

const STATES = new Set(['ok', 'warn', 'bad', 'unknown']);
const ITEMS = ['bitlocker', 'av', 'fw', 'updates', 'reboot', 'disk'];

const healthPublic = s => ({ report: (s.health_report || 'true') === 'true' });
function quizPublic(s, store) {
  const r = store.get('SELECT COUNT(*) n, COALESCE(MAX(updated), 0) u FROM quiz_questions WHERE active = 1');
  return { enabled: (s.quiz_enabled || 'true') === 'true', perWeek: Math.max(1, Math.min(7, Number(s.quiz_per_week) || 2)), rev: `${r.n}-${r.u}` };
}
// Vom Sudo gemeldeter Gerätezustand: nur bekannte Felder, nur Ampelwerte und kleine Zahlen
function cleanHealth(h) {
  if (!h || typeof h !== 'object') return null;
  const st = v => (STATES.has(v) ? v : 'unknown');
  const int = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(100000, Math.trunc(Number(v)))) : null);
  const i = {}; for (const k of ITEMS) i[k] = st(h.i && h.i[k]);
  return { s: st(h.s), i, updDays: int(h.updDays), upDays: int(h.upDays), disk: int(h.disk), av: String(h.av || '').replace(/<[^>]*>/g, '').slice(0, 60) };
}
function storeHealth(store, devId, h) {
  if (!healthPublic(store.settings()).report) return;
  const c = cleanHealth(h);
  if (c) store.run('UPDATE devices SET health = ?, health_at = ? WHERE id = ?', JSON.stringify(c), Date.now(), devId);
}
// 1.9: Diagnose des Clients – nur Zahlen und ein gekürzter Fehlertext
function cleanDiag(d) {
  if (!d || typeof d !== 'object') return null;
  const num = (v, max) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v) * 10) / 10)) : null);
  return { cpu: num(d.cpu, 1000), ram: num(d.ram, 100000), crashes: Math.trunc(num(d.crashes, 1000) || 0), errors: Math.trunc(num(d.errors, 100000) || 0),
    up: num(d.up, 100000), last: String(d.last || '').replace(/<[^>]*>/g, '').slice(0, 220) };
}
function storeDiag(store, devId, d) { const c = cleanDiag(d); if (c) store.run('UPDATE devices SET diag = ?, diag_at = ? WHERE id = ?', JSON.stringify(c), Date.now(), devId); }
const quizQuestionPublic = q => ({ id: 'c' + q.id, q: q.q, a: JSON.parse(q.answers || '[]'), ok: q.ok, why: q.why || '', link: q.link || '' });

module.exports = { healthPublic, quizPublic, cleanHealth, storeHealth, cleanDiag, storeDiag, quizQuestionPublic };
