// visit-window.js – Sudo zu einem Kollegen schicken: wen besuchen, was dort machen
(async () => {
  'use strict';
  const host = window.visitHost;
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
  const KINDS = [
    ['note', '✎', 'Post-it', 'Kurze Nachricht, bleibt kleben'],
    ['coffee', '☕', 'Kaffee', 'Eine Tasse hinstellen'],
    ['duck', '◉', 'Gummiente', 'Quietscht beim Anklicken'],
    ['pizza', '◭', 'Pizzastück', 'Für die Mittagspause'],
    ['confetti', '✦', 'Konfetti', 'Kurze Party auf dem Desktop'],
    ['bug', '✱', 'Bug aussetzen', 'Dort muss Sudo jagen'],
    ['duel', '⚔', 'Duell!', 'Shuriken-Kampf, Sieger kriegt XP']
  ];
  let to = null, kind = 'duel', data = null, noteText = '';

  async function load() {
    main.replaceChildren(el('p', { class: 'empty', text: 'Frage die Zentrale, wer gerade da ist …' }));
    data = await host.peers();
    render();
  }
  function render() {
    const top = el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }),
      el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('besucht')),
      data && data.ok ? el('div', { class: 'left' }, el('b', { text: `${data.visits.sendLeft} / ${data.visits.sendMax}` }), tr('Besuche heute übrig')) : null);
    if (!data || !data.ok) { main.replaceChildren(top, el('p', { class: 'msg bad', text: tr((data && data.msg) || 'Zentrale nicht erreichbar') })); return; }
    if (!data.visits.enabled) { main.replaceChildren(top, el('p', { class: 'empty', text: 'Besuche sind in der Zentrale gerade ausgeschaltet.' })); return; }
    const peers = el('div', { class: 'peers', role: 'group', 'aria-label': 'Wen besuchen?' },
      ...data.peers.map(p => el('button', { class: 'pick', type: 'button', 'aria-pressed': String(to === p.id), disabled: p.full, 'data-noi18n': true,
        on: { click: () => { to = p.id; render(); } } }, el('b', { text: p.name }), el('small', { text: tr(p.full ? 'Hatte heute genug Besuch' : 'online') }))));
    const kinds = el('div', { class: 'kinds', role: 'group', 'aria-label': 'Was soll Sudo dort machen?' },
      ...KINDS.map(([k, ic, t, d]) => el('button', { class: 'pick', type: 'button', 'aria-pressed': String(kind === k), on: { click: () => { kind = k; render(); } } },
        el('span', { class: 'ic', text: ic }), el('b', { text: t }), el('small', { text: d }))));
    const input = el('input', { type: 'text', maxlength: 60, placeholder: 'z. B. Kaffee um 3? Ich geb einen aus!', 'aria-label': 'Text auf dem Post-it' });
    input.value = noteText;
    const count = el('span', { text: `${noteText.length} / 60` });
    input.addEventListener('input', () => { noteText = input.value; count.textContent = `${input.value.length} / 60`; });
    const msg = el('div', { class: 'msg' });
    const send = el('button', { class: 'act primary', type: 'button', text: 'Losschicken!', disabled: !to || data.visits.sendLeft <= 0 });
    send.addEventListener('click', async () => {
      if (kind === 'note' && !input.value.trim()) { msg.className = 'msg bad'; msg.textContent = tr('Bitte etwas auf das Post-it schreiben.'); return; }
      send.disabled = true;
      const r = await host.send({ to, kind, note: input.value });
      if (!r.ok) { msg.className = 'msg bad'; msg.textContent = tr(r.msg || 'Fehler'); send.disabled = false; return; }
      msg.className = 'msg'; msg.textContent = tr('Sudo ist unterwegs!');
      setTimeout(() => window.close(), 1200);
    });
    main.replaceChildren(top,
      el('section', {}, el('h3', { text: 'Wen besuchen?' }),
        data.peers.length ? peers : el('p', { class: 'empty', text: 'Gerade ist niemand online, der Besuch erlaubt.' })),
      el('section', {}, el('h3', { text: 'Was soll Sudo dort machen?' }), kinds,
        kind === 'note' ? el('div', { class: 'note' }, input, el('small', {}, el('span', { text: 'Dein Name steht mit drauf. Bitte nett bleiben – es wird protokolliert.' }), count)) : null),
      el('div', { class: 'actions' }, send, el('button', { class: 'act', type: 'button', text: 'Aktualisieren', on: { click: load } }), msg));
    if (kind === 'note') input.focus();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  load();
})();
