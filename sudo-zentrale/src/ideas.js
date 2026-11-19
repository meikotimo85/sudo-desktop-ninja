// ideas.js – Ideen-Board (1.15): Wünsche von der Infoseite, Zustimmung per Klick, Mail an die IT.
// Gleiche Antworten und Fehlermeldungen wie app/ideas.php der PHP-Version.
// Öffentlich sind nur freigegebene Ideen – Name und E-Mail der Einreichenden sieht nur die Verwaltung.
// Stimmen zählen je Browser (zufällige Kennung, gespeichert nur als Hash); IP-Adressen werden nicht gespeichert,
// sie dienen nur der kurzfristigen Begrenzung im Speicher.
'use strict';
const { sha256, now } = require('./db');

const IDEA_STATES = ['neu', 'geplant', 'in_arbeit', 'umgesetzt', 'abgelehnt'];
const MAIL_RE = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;

class IdeaError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new IdeaError(code, msg); };

// Steuerzeichen raus (bei mehrzeiligem Text bleiben Zeilenumbrüche), Länge begrenzen
const line = (v, n) => String(v == null ? '' : v).replace(/[\x00-\x1F\x7F]+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/[\x00-\x09\x0B-\x1F\x7F]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const origins = s => String(s.ideas_origins || '').split(/[\s,;]+/).map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);

function createIdeas(store, { mailer, publicUrl }) {
  // Einfache Begrenzung im Speicher: höchstens max Aufrufe je Fenster
  const hits = new Map();
  function limit(key, max, sec) {
    const t = now(), h = hits.get(key);
    if (!h || h.reset < t) { hits.set(key, { n: 1, reset: t + sec * 1000 }); if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k); return true; }
    if (h.n >= max) return false;
    h.n++; return true;
  }
  const on = s => s.ideas_enabled === 'true';
  const pub = i => ({ id: i.id, title: i.title, text: i.text, status: i.status, votes: i.votes, answer: i.answer || '', created: i.created });

  /** CORS-Kopfzeilen, wenn die Infoseite auf einer freigegebenen anderen Adresse liegt */
  function cors(req, reply) {
    const o = String(req.headers.origin || '').replace(/\/+$/, '');
    if (!o || !origins(store.settings()).includes(o)) return;
    reply.header('access-control-allow-origin', o).header('vary', 'Origin').header('access-control-allow-methods', 'GET, POST')
      .header('access-control-allow-headers', 'Content-Type').header('access-control-max-age', '600');
  }

  function list() {
    const s = store.settings();
    if (!on(s)) return { enabled: false, items: [] };
    return { enabled: true, items: store.all('SELECT * FROM ideas WHERE public = 1 ORDER BY votes DESC, id DESC LIMIT 200').map(pub) };
  }

  function submit(b, ip) {
    const s = store.settings();
    if (!on(s)) fail(403, 'Das Ideen-Board ist ausgeschaltet.');
    // Spam-Schutz ohne Captcha: verstecktes Feld bleibt leer, und niemand füllt das Formular in unter 3 Sekunden aus
    if (String(b.website || '').trim() !== '' || (parseInt(b.ms, 10) || 0) < 3000) fail(400, 'Das hat leider nicht geklappt. Bitte noch einmal versuchen.');
    const title = line(b.title, 80), text = block(b.text, 2000), name = line(b.name, 60), email = line(b.email, 120);
    if (title.length < 5) fail(400, 'Bitte einen Titel mit mindestens 5 Zeichen angeben.');
    if (text.length < 10) fail(400, 'Bitte die Idee in mindestens 10 Zeichen beschreiben.');
    if (email && !MAIL_RE.test(email)) fail(400, 'Die E-Mail-Adresse sieht nicht richtig aus.');
    if (!limit('idea:' + ip, 5, 3600)) fail(429, 'Zu viele Ideen auf einmal – bitte später noch einmal.');
    if (!limit('idea:all', 50, 86400)) fail(429, 'Heute sind schon sehr viele Ideen eingegangen – bitte morgen noch einmal.');
    const isPub = s.ideas_auto === 'true' ? 1 : 0;
    const r = store.run('INSERT INTO ideas (created, updated, title, text, name, email, status, public, votes, answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      now(), now(), title, text, name || null, email || null, 'neu', isPub, '');
    const id = Number(r.lastInsertRowid);
    store.audit('Infoseite', 'idea_add', `#${id} ${title}`);
    sendMail(s, { id, title, text, name, email, public: isPub });
    return { ok: true, id, public: isPub === 1,
      message: isPub ? 'Danke! Deine Idee steht jetzt auf der Liste.' : 'Danke! Deine Idee ist angekommen und erscheint nach einem kurzen Blick der IT auf der Liste.' };
  }

  /** Zustimmen (oder mit off: true zurücknehmen) – eine Stimme je Browser und Idee */
  function vote(idRaw, b, ip) {
    const s = store.settings();
    if (!on(s)) fail(403, 'Das Ideen-Board ist ausgeschaltet.');
    const voter = String(b.voter || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(voter)) fail(400, 'Ungültige Stimme.');
    const id = Number(idRaw);
    const i = store.get('SELECT id, status FROM ideas WHERE id = ? AND public = 1', id);
    if (!i) fail(404, 'Diese Idee gibt es nicht (mehr).');
    if (['umgesetzt', 'abgelehnt'].includes(i.status)) fail(409, 'Für diese Idee kann nicht mehr abgestimmt werden.');
    if (!limit('vote:' + ip, 60, 3600)) fail(429, 'Zu viele Stimmen – kurz warten.');
    const v = sha256('idea|' + voter);
    const had = !!store.get('SELECT 1 FROM idea_votes WHERE idea_id = ? AND voter = ?', id, v);
    if (b.off) { if (had) store.run('DELETE FROM idea_votes WHERE idea_id = ? AND voter = ?', id, v); }
    else if (!had) store.run('INSERT OR IGNORE INTO idea_votes (idea_id, voter, created) VALUES (?, ?, ?)', id, v, now());
    store.run('UPDATE ideas SET votes = (SELECT COUNT(*) FROM idea_votes WHERE idea_id = ?) WHERE id = ?', id, id);
    return { ok: true, votes: store.get('SELECT votes FROM ideas WHERE id = ?', id).votes, voted: !b.off };
  }

  function sendMail(s, i) {
    const to = String(s.ideas_mail || '');
    if (!to || !MAIL_RE.test(to) || !mailer) return;
    const text = ['Auf der Infoseite wurde eine neue Idee eingereicht.', '',
      'Titel: ' + i.title,
      'Von: ' + (i.name || 'ohne Namen') + (i.email ? ` <${i.email}>` : ''),
      'Sichtbar: ' + (i.public ? 'ja, sofort auf der Liste' : 'nein, wartet auf Freigabe'), '',
      i.text, '',
      'Verwaltung: ' + publicUrl + '/admin/#ideas'].join('\n');
    mailer.send({ to, subject: 'Neue Idee für Sudo: ' + i.title, text, replyTo: i.email || '', id: i.id })
      .catch(e => console.error('[ideen] Mail zur Idee #' + i.id + ' konnte nicht verschickt werden:', e.message));
  }

  /* ---------- Verwaltung ---------- */
  function admin() {
    const s = store.settings();
    return { mail: { to: s.ideas_mail || '', ready: !!(mailer && mailer.ready) },
      items: store.all('SELECT * FROM ideas ORDER BY public ASC, id DESC LIMIT 500').map(i => ({ ...pub(i), name: i.name || '', email: i.email || '', public: i.public === 1, updated: i.updated })) };
  }
  function patch(idRaw, b, who) {
    const id = Number(idRaw);
    const i = store.get('SELECT id, title FROM ideas WHERE id = ?', id);
    if (!i) fail(404, 'Diese Idee gibt es nicht (mehr).');
    const set = {};
    if ('status' in b) { if (!IDEA_STATES.includes(b.status)) fail(400, 'Unbekannter Stand.'); set.status = b.status; }
    if ('public' in b) set.public = b.public ? 1 : 0;
    if ('answer' in b) set.answer = block(b.answer, 500);
    if ('title' in b) { const t = line(b.title, 80); if (t.length < 5) fail(400, 'Bitte einen Titel mit mindestens 5 Zeichen angeben.'); set.title = t; }
    if ('text' in b) { const t = block(b.text, 2000); if (t.length < 10) fail(400, 'Bitte die Idee in mindestens 10 Zeichen beschreiben.'); set.text = t; }
    const keys = Object.keys(set);
    if (!keys.length) return;
    store.run(`UPDATE ideas SET ${keys.map(k => k + ' = ?').join(', ')}, updated = ? WHERE id = ?`, ...keys.map(k => set[k]), now(), id);
    store.audit(who, 'idea_edit', `#${id} ${i.title} · ${keys.join(', ')}`);
  }
  function remove(idRaw, who) {
    const id = Number(idRaw);
    const i = store.get('SELECT id, title FROM ideas WHERE id = ?', id);
    if (!i) fail(404, 'Diese Idee gibt es nicht (mehr).');
    store.run('DELETE FROM idea_votes WHERE idea_id = ?', id);
    store.run('DELETE FROM ideas WHERE id = ?', id);
    store.audit(who, 'idea_delete', `#${id} ${i.title}`);
  }

  return { cors, list, submit, vote, admin, patch, remove };
}

module.exports = { createIdeas, IdeaError, IDEA_STATES, MAIL_RE };
