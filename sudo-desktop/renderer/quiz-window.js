// quiz-window.js – Security-Quiz: eine Frage, Antwort wählen, Erklärung lesen, auf Wunsch noch eine
(async () => {
  'use strict';
  const host = window.quizHost;
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
  const MAX = 3;                       // höchstens drei Fragen pro Runde – kurz und schmerzlos
  let count = 0, stats = { right: 0, answered: 0 };

  function header() {
    return el('div', { class: 'top' },
      el('img', { src: '../assets/icon.png', alt: '' }),
      el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Security-Quiz')),
      el('div', { class: 'score', 'data-noi18n': '' }, el('b', { text: `${stats.right} / ${stats.answered}` }), tr('bisher richtig')));
  }

  async function show() {
    const r = await host.next();
    if (r && r.stats) stats = r.stats;
    const q = r && r.q;
    if (!q) { main.replaceChildren(header(), el('p', { class: 'empty', text: 'Gerade keine Frage verfügbar.' })); return; }
    count++;
    // Antworten in zufälliger Reihenfolge anzeigen, die Nummer der Antwort bleibt erhalten
    const order = q.a.map((t, i) => i).sort(() => Math.random() - .5);
    const box = el('div', { class: 'answers', role: 'group', 'aria-label': 'Antworten' });
    const card = el('div', { class: 'card' },
      q.custom ? el('span', { class: 'tag', text: 'Frage deiner IT' }) : null,
      el('p', { class: 'q', text: tr(q.q) }), box);
    const buttons = order.map((idx, pos) => {
      const b = el('button', { class: 'ans', type: 'button' }, el('span', { class: 'k', text: 'ABCD'[pos], 'data-noi18n': '' }), el('span', { text: tr(q.a[idx]) }));
      b.addEventListener('click', () => pick(idx));
      box.append(b);
      return { b, idx };
    });
    main.replaceChildren(header(), card);
    buttons[0].b.focus();

    async function pick(choice) {
      buttons.forEach(x => { x.b.disabled = true; });
      const res = await host.answer(q.id, choice);
      if (!res || !res.ok) return;
      stats = res.total || stats;
      for (const x of buttons) {
        if (x.idx === res.correct) x.b.classList.add('right');
        else if (x.idx === choice) x.b.classList.add('wrong');
        else x.b.classList.add('dim');
      }
      const why = el('div', { class: 'why' + (res.right ? '' : ' no'), role: 'status' },
        el('b', { text: res.right ? 'Richtig! +10 XP' : 'Nicht ganz.' }),
        el('span', { text: tr(res.why || '') }),
        res.link ? el('span', {}, ' ', el('a', { tabindex: 0, text: 'Mehr dazu', on: { click: () => host.open(res.link), keydown: e => { if (e.key === 'Enter') host.open(res.link); } } })) : null);
      const more = count < MAX ? el('button', { class: 'act primary', type: 'button', text: 'Noch eine Frage', on: { click: show } }) : null;
      const done = el('button', { class: 'act' + (more ? '' : ' primary'), type: 'button', text: count < MAX ? 'Fertig' : 'Fertig für heute', on: { click: () => window.close() } });
      card.append(why, el('div', { class: 'actions' }, more, done));
      main.replaceChildren(header(), card);
      (more || done).focus();
    }
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.close();
    // Tasten A–D wählen eine Antwort
    const i = 'abcd'.indexOf(e.key.toLowerCase());
    if (i >= 0) { const b = main.querySelectorAll('.ans:not(:disabled)')[i]; if (b) b.click(); }
  });
  show();
})();
