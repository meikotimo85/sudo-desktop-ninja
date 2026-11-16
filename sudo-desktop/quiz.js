// quiz.js – Security-Quiz (1.5): wann Sudo fragt, welche Frage drankommt, Auswertung.
// Ohne Zentrale gelten die eigenen Einstellungen, mit Zentrale deren Vorgaben (an/aus, wie oft).
// An die Zentrale geht nur „Frage X richtig/falsch“ – ohne Gerät, ohne Namen (anonyme Auswertung).
'use strict';
const { QUESTIONS } = require('./renderer/quiz-data.js');

const QUIZ_DEFAULTS = { on: true, perWeek: 2, lastDone: 0, lastOffer: 0, history: {}, right: 0, answered: 0 };
const OFFER_RETRY = 3 * 3600 * 1000;          // nicht angenommen → frühestens in 3 Stunden wieder fragen

function createQuiz({ getSettings, setQuiz, zentrale, offer, log, isBusy, test }) {
  let custom = [];                 // eigene Fragen aus der Zentrale
  let pushed = null;               // von der Zentrale gezielt angebotene Frage
  let session = [];                // in dieser Runde schon gestellt
  let loadedAt = 0;

  const st = () => ({ ...QUIZ_DEFAULTS, ...(getSettings().quiz || {}) });
  const server = () => (zentrale && zentrale.quizConfig && zentrale.status().enrolled ? zentrale.quizConfig() : null);
  function config() {
    const s = st(), z = server();
    if (z) return { on: z.enabled !== false, perWeek: Math.max(1, Math.min(7, Number(z.perWeek) || 2)), managed: true };
    return { on: s.on !== false, perWeek: Math.max(1, Math.min(7, Number(s.perWeek) || 2)), managed: false };
  }
  async function loadCustom() {
    if (!zentrale || !zentrale.status().enrolled) { custom = []; return; }
    const r = await zentrale.quizQuestions();
    if (r && r.ok) loadedAt = Date.now();
    if (r && r.ok && Array.isArray(r.questions)) {
      custom = r.questions.filter(q => q && /^c\d+$/.test(q.id) && typeof q.q === 'string' && Array.isArray(q.a) && q.a.length >= 2 && q.a.length <= 4 && Number.isInteger(q.ok) && q.ok >= 0 && q.ok < q.a.length)
        .map(q => ({ id: q.id, q: String(q.q).slice(0, 400), a: q.a.map(x => String(x).slice(0, 200)), ok: q.ok, why: String(q.why || '').slice(0, 600), link: /^https:\/\//.test(q.link || '') ? q.link : '', custom: true }));
    }
  }
  const all = () => [...custom, ...QUESTIONS];
  const byId = id => all().find(q => q.id === id);

  // Nächste Frage: gezielt angebotene, sonst neue eigene Fragen der Firma, sonst die am längsten nicht gestellte
  function next() {
    const h = st().history || {};
    if (pushed && byId(pushed) && !session.includes(pushed)) { const q = byId(pushed); pushed = null; return q; }
    const fresh = custom.filter(q => !h[q.id] && !session.includes(q.id));
    if (fresh.length) return fresh[0];
    const pool = all().filter(q => !session.includes(q.id));
    if (!pool.length) return null;
    pool.sort((a, b) => ((h[a.id] || {}).t || 0) - ((h[b.id] || {}).t || 0) || Math.random() - .5);
    return pool[0];
  }
  // Für das Fenster: ohne Lösung
  const publicQ = q => q && { id: q.id, q: q.q, a: q.a, custom: !!q.custom };

  async function answer(id, choice) {
    const q = byId(String(id));
    if (!q || !Number.isInteger(choice)) return { ok: false };
    session.push(q.id);
    const right = choice === q.ok;
    const s = st();
    const history = { ...(s.history || {}), [q.id]: { t: Date.now(), ok: right } };
    // Verlauf klein halten
    const keys = Object.keys(history); if (keys.length > 80) for (const k of keys.sort((a, b) => history[a].t - history[b].t).slice(0, keys.length - 80)) delete history[k];
    setQuiz({ ...s, history, lastDone: Date.now(), right: (s.right || 0) + (right ? 1 : 0), answered: (s.answered || 0) + 1 });
    log(`Security-Quiz: ${q.id} ${right ? 'richtig' : 'falsch'}`);
    if (zentrale && zentrale.status().enrolled) zentrale.quizAnswer({ q: q.id, ok: right, text: q.custom ? undefined : q.q.slice(0, 200) }).catch?.(() => {});
    return { ok: true, right, correct: q.ok, why: q.why, link: q.link || '', total: { right: (s.right || 0) + (right ? 1 : 0), answered: (s.answered || 0) + 1 } };
  }

  // Taktgeber: höchstens zu Bürozeiten, nicht im Meeting, nicht wenn gerade etwas anderes läuft
  function due() {
    const c = config(); if (!c.on) return false;
    const s = st(), now = new Date();
    if (!test && (now.getDay() === 0 || now.getDay() === 6 || now.getHours() < 9 || now.getHours() >= 17)) return false;
    if (isBusy()) return false;
    const every = 7 * 864e5 / c.perWeek;
    return Date.now() - (s.lastDone || 0) >= every && Date.now() - (s.lastOffer || 0) >= OFFER_RETRY;
  }
  function tick() {
    if (!due()) return;
    setQuiz({ ...st(), lastOffer: Date.now() });
    offer({});
  }
  const timer = setInterval(tick, test ? 5000 : 10 * 60000);
  setTimeout(() => loadCustom().catch(() => {}), test ? 2000 : 60000);

  return {
    config, next: () => publicQ(next()), answer, loadCustom,
    ensureLoaded: async () => { if (Date.now() - loadedAt > 10 * 60000) await loadCustom().catch(() => {}); },
    startSession: () => { session = []; },
    // Zentrale bietet gezielt eine Frage an → sofort fragen (Fenster zeigt diese zuerst)
    push: async id => { await loadCustom().catch(() => {}); if (!byId(id) || !config().on) return; pushed = id; offer({ pushed: true }); },
    serverChanged: () => loadCustom().catch(() => {}),
    stats: () => { const s = st(); return { right: s.right || 0, answered: s.answered || 0 }; },
    stop: () => clearInterval(timer)
  };
}

module.exports = { createQuiz, QUIZ_DEFAULTS };
