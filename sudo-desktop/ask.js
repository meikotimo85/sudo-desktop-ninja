// ask.js – „Frag Sudo“: Fragen an Claude, entweder mit eigenem API-Schlüssel oder über die Sudo-Zentrale.
// Gespeichert wird nur der Verbrauch pro Tag (Anzahl, Token, Kosten) – keine Fragen, keine Antworten.
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./ask-core');

const AI_DEFAULTS = { mode: 'off', model: 'haiku', dailyUsd: 0.5, context: true, keyEnc: '', keyPlain: false };
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MAX_TURNS = 8;          // so viele Wortwechsel gehen als Gesprächsverlauf mit
const MAX_Q = 4000;           // Zeichen pro Frage

function createAsk({ dir, getSettings, getKey, fetch, log, contextFn, zentrale, lang, emit }) {
  const file = path.join(dir, 'ai-usage.json');
  let usage = {};
  try { usage = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* neu */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(usage)); } catch (e) { log('KI-Verbrauch speichern: ' + e.message); } };
  const cfg = () => ({ ...AI_DEFAULTS, ...(getSettings().ai || {}) });
  let history = [];             // [{ role, content }] – nur im Speicher, bis „Neues Gespräch“
  let busy = null;              // AbortController der laufenden Frage

  function today() { return usage[dayKey()] || { q: 0, in: 0, out: 0, usd: 0 }; }
  function record(model, u) {
    const k = dayKey(), t = usage[k] || { q: 0, in: 0, out: 0, usd: 0 };
    t.q++; t.in += u.in; t.out += u.out; t.usd += core.cost(model, u);
    usage[k] = t;
    for (const d of Object.keys(usage).sort().slice(0, -60)) delete usage[d];   // 60 Tage reichen
    save();
  }
  function status() {
    const c = cfg(), z = zentrale && zentrale.status();
    const ready = c.mode === 'key' ? !!getKey() : c.mode === 'zentrale' ? !!(z && z.enrolled) : false;
    const month = Object.entries(usage).filter(([d]) => d.startsWith(dayKey().slice(0, 7))).reduce((s, [, v]) => s + v.usd, 0);
    return { mode: c.mode, model: c.model, ready, hasKey: !!getKey(), dailyUsd: c.dailyUsd, today: today(), monthUsd: month,
      busy: !!busy, turns: history.length / 2, models: Object.fromEntries(Object.entries(core.MODELS).map(([k, m]) => [k, m.label])) };
  }

  async function ask(question, opt = {}) {
    const c = cfg();
    question = String(question || '').trim().slice(0, MAX_Q);
    if (!question) return { ok: false, msg: 'Bitte eine Frage eingeben.' };
    if (busy) return { ok: false, msg: 'Sudo denkt noch nach …' };
    if (c.mode === 'off') return { ok: false, msg: 'Frag Sudo ist ausgeschaltet (Einstellungen → KI).' };
    const model = core.MODELS[opt.model] ? opt.model : c.model;
    // Eigenes Budget nur im Schlüssel-Modus – bei der Zentrale entscheidet der Server
    if (c.mode === 'key' && c.dailyUsd > 0 && today().usd >= c.dailyUsd) return { ok: false, msg: 'Tageslimit erreicht. Morgen geht es weiter – oder Limit in den Einstellungen erhöhen.' };

    const messages = [...history.slice(-MAX_TURNS * 2), { role: 'user', content: question }];
    const system = core.systemPrompt({ lang: lang(), context: c.context && contextFn ? contextFn() : '' });
    const ac = new AbortController();
    busy = ac;
    emit('start', { question, model });
    let r;
    try {
      if (c.mode === 'key') {
        const key = getKey();
        if (!key) throw new Error('Kein API-Schlüssel hinterlegt (Einstellungen → KI).');
        r = await fetch(process.env.SUDO_ANTHROPIC_URL || core.API_URL, {
          method: 'POST', signal: ac.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': core.API_VERSION },
          body: JSON.stringify(core.buildRequest({ model, system, messages }))
        });
      } else {
        r = await zentrale.ask({ model, lang: lang(), messages, context: c.context && contextFn ? contextFn() : '' }, ac.signal);
      }
      if (!r.ok) throw new Error(await core.httpError(r));
      const res = await core.readStream(r.body, { onText: t => emit('delta', { text: t }), signal: ac.signal });
      if (ac.signal.aborted) { emit('end', { ok: false, msg: 'Abgebrochen.' }); return { ok: false, msg: 'Abgebrochen.' }; }
      if (res.error && !res.text) throw new Error(res.error);
      record(model, res.usage);
      history = [...messages, { role: 'assistant', content: res.text }].slice(-MAX_TURNS * 2);
      const usd = core.cost(model, res.usage);
      log(`Frag Sudo: ${model}, ${res.usage.in}+${res.usage.out} Token (${(usd * 100).toFixed(3)} Cent)`);
      emit('end', { ok: true, text: res.text, usage: res.usage, usd, cut: res.stop === 'max_tokens' });
      return { ok: true, text: res.text };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Abgebrochen.' : /fetch failed|ENOTFOUND|ECONNREFUSED|ERR_/.test(e.message) ? 'Keine Verbindung: ' + e.message : e.message;
      emit('end', { ok: false, msg });
      log('Frag Sudo Fehler: ' + msg);
      return { ok: false, msg };
    } finally { busy = null; }
  }

  return {
    ask, status,
    cancel() { if (busy) busy.abort(); },
    reset() { history = []; },
    history: () => history.slice()
  };
}

module.exports = { createAsk, AI_DEFAULTS };
