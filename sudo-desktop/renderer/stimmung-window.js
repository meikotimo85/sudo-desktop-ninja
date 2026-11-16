// stimmung-window.js – 1.10: „Kurze Frage deiner IT“ – Sterne-Frage und „Läuft es wieder?“ nach einer Störung
(async () => {
  'use strict';
  const host = window.pulseHost;
  const main = document.getElementById('main');
  const tr = x => (window.I18N ? I18N.t(x) : x);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'text') e.textContent = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && c !== false && e.append(c));
    return e;
  };
  const head = () => [el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Kurze Frage'))),
    el('p', { class: 'lead', text: 'Deine IT möchte wissen, wie es dir mit deinem PC geht. Dauert ein paar Sekunden – und du kannst jede Frage überspringen.' })];

  function surveyBox(q, next) {
    let score = 0;
    const msg = el('div');
    const comment = el('textarea', { class: 'inp', maxlength: 300, rows: 2, placeholder: tr('Magst du etwas dazu schreiben? (optional, ohne Namen)'), 'aria-label': tr('Anmerkung') });
    const send = el('button', { class: 'act primary', type: 'button', text: 'Senden', disabled: true });
    const btns = [1, 2, 3, 4, 5].map(n => el('button', { type: 'button', 'aria-label': tr('{n} von 5 Sternen').replace('{n}', n), text: '★', on: { click: () => { score = n; btns.forEach((b, i) => b.classList.toggle('on', i < n)); send.disabled = false; } } }));
    send.addEventListener('click', async () => {
      send.disabled = true;
      const r = await host.answer({ id: q.id, score, comment: comment.value });
      if (!r.ok) { msg.replaceChildren(el('div', { class: 'res bad', text: tr(r.msg || 'Hat nicht geklappt.') })); send.disabled = false; return; }
      next(tr('Danke! Deine Antwort ist angekommen – ohne deinen Namen.'));
    });
    return el('div', { class: 'box' },
      el('div', { class: 'head' }, el('div', { class: 't' }, el('b', { 'data-noi18n': q.kind === 'monthly' ? null : '', text: q.kind === 'monthly' ? q.q : q.q }), el('small', { text: q.kind === 'monthly' ? 'Monatsfrage deiner IT' : 'Frage deiner IT' }))),
      el('div', { class: 'stars', role: 'group', 'aria-label': tr('Bewertung') }, btns),
      el('div', { class: 'scale' }, el('span', { text: 'gar nicht' }), el('span', { text: 'sehr' })),
      comment,
      el('div', { class: 'acts' }, send, el('button', { class: 'act', type: 'button', text: 'Überspringen', on: { click: async () => { await host.answer({ id: q.id, skip: true }); next(tr('Übersprungen. Kein Problem.')); } } })),
      msg,
      el('p', { class: 'note', text: 'Gespeichert werden nur die Sterne, die Ampel deines Gerätezustands und der Tag – nicht, wer geantwortet hat. Die IT sieht Ergebnisse erst, wenn genug Kollegen geantwortet haben.' }));
  }
  function incidentBox(q, next) {
    const msg = el('div');
    const ans = async ok => { const r = await host.incident(q.id, ok); if (!r.ok) { msg.replaceChildren(el('div', { class: 'res bad', text: tr(r.msg || 'Hat nicht geklappt.') })); return; }
      next(tr(ok ? 'Prima, danke für die Rückmeldung!' : 'Danke – deine IT sieht jetzt, dass es bei dir noch hakt, und meldet sich.')); };
    return el('div', { class: 'box' },
      el('div', { class: 'head' }, el('div', { class: 't' }, el('b', { text: tr('Läuft es bei dir wieder?') }), el('small', { 'data-noi18n': '', text: q.title }))),
      el('p', { class: 'note', text: 'Du hattest gemeldet, dass du von dieser Störung betroffen bist. Deine IT hat sie inzwischen beendet.' }),
      el('div', { class: 'acts' }, el('button', { class: 'act primary', type: 'button', text: 'Ja, läuft wieder', on: { click: () => ans(true) } }),
        el('button', { class: 'act', type: 'button', text: 'Nein, geht noch nicht', on: { click: () => ans(false) } })),
      msg,
      el('p', { class: 'note', text: 'Diese Antwort geht mit deinem Gerät an die IT – damit sie dir bei „geht noch nicht“ helfen kann.' }));
  }
  async function render(thanks) {
    const list = await host.get();
    const q = list[0];
    const done = thanks ? el('div', { class: 'res', role: 'status', text: thanks }) : null;
    if (!q) { main.replaceChildren(...head(), done || el('div', { class: 'res', text: tr('Gerade gibt es keine offene Frage. Danke!') }),
      el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: 'Schließen', on: { click: () => window.close() } }))); return; }
    main.replaceChildren(...[...head(), done, q.type === 'incident' ? incidentBox(q, render) : surveyBox(q, render),
      list.length > 1 ? el('p', { class: 'note', text: tr('Danach noch {n} weitere Frage(n).').replace('{n}', list.length - 1) }) : null].filter(Boolean));
  }
  await render();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
