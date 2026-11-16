// music-window.js – Musikwunsch (1.8): Song suchen, mit XP bezahlen, er kommt in die Spotify-Warteschlange im Büro
(async () => {
  'use strict';
  const host = window.musicHost;
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
  const mmss = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let st = null, tracks = [], ask = null, note = null, q = '', busy = false;

  // Warum gerade nichts geht (oder null)
  function blocker() {
    if (!st || st.ok === false) return st && st.msg ? st.msg : 'Musikwünsche gerade nicht erreichbar.';
    if (!st.enabled) return 'Deine IT hat Musikwünsche für dich (noch) nicht freigeschaltet.';
    if (!st.open) return tr('Musikwünsche gehen nur von {t} Uhr.').replace('{t}', st.hours);
    if (st.left <= 0) return 'Für heute sind deine Wünsche aufgebraucht. Morgen wieder!';
    if (st.xp < st.cost) return tr('Dafür fehlen dir noch {n} XP. Tippen, Bugs fangen, Pausen machen …').replace('{n}', st.cost - st.xp);
    if (st.waitSec > 0) return tr('Gerade lief schon ein Wunsch – der nächste geht in {n} min.').replace('{n}', Math.max(1, Math.ceil(st.waitSec / 60)));
    return null;
  }
  async function load() { st = await host.get(); render(); }
  async function search() {
    if (busy || q.trim().length < 2) return;
    busy = true; note = null; ask = null;
    const r = await host.search(q);
    busy = false;
    if (r.ok === false) { note = { bad: true, text: r.msg }; tracks = []; } else tracks = r.tracks || [];
    if (r.ok !== false && !tracks.length) note = { bad: true, text: 'Nichts gefunden. Anders schreiben oder nur den Interpreten suchen.' };
    render();
  }
  async function wish(t) {
    busy = true; render();
    const r = await host.request(t.id);
    busy = false; ask = null;
    note = r.ok ? { text: tr('„{t}“ ist in der Warteschlange und läuft gleich. −{n} XP').replace('{t}', t.name).replace('{n}', r.cost) } : { bad: true, text: r.msg };
    if (r.ok) tracks = [];
    await load();
  }
  function render() {
    const b = blocker();
    const input = el('input', { type: 'search', 'aria-label': 'Song suchen', placeholder: tr('Song oder Interpret, z. B. „Africa Toto“'), value: q, maxlength: 100,
      on: { input: e => { q = e.target.value; }, keydown: e => { if (e.key === 'Enter') search(); } } });
    main.replaceChildren(...[
      el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Musikwunsch')),
        st && st.xp != null ? el('div', { class: 'xp', 'data-noi18n': '' }, el('b', { text: `${st.xp} XP` }), tr('dein Guthaben')) : null),
      el('p', { class: 'lead', text: 'Wünsch dir einen Song für den Lautsprecher im Büro. Er kommt in die Warteschlange und läuft nach dem aktuellen Titel. Bezahlt wird mit XP – dein Rang kann dadurch sinken, Garderobe und Erfolge bleiben.' }),
      st && st.ok !== false ? el('div', { class: 'facts' },
        el('span', { 'data-noi18n': '', text: tr('{n} XP pro Song').replace('{n}', st.cost) }),
        el('span', { class: st.left ? '' : 'bad', 'data-noi18n': '', text: tr('noch {n} von {m} Wünschen heute').replace('{n}', st.left).replace('{m}', st.perDay) }),
        st.device ? el('span', { 'data-noi18n': '', text: tr('Lautsprecher: {x}').replace('{x}', st.device) }) : null,
        el('span', { class: st.open ? '' : 'bad', 'data-noi18n': '', text: tr('{t} Uhr').replace('{t}', st.hours) })) : null,
      note ? el('div', { class: note.bad ? 'err' : 'done', role: 'status', text: tr(note.text) }) : null,
      b ? el('div', { class: 'err', text: tr(b) }) : null,
      el('div', { class: 'search' }, input, el('button', { class: 'act primary', type: 'button', text: busy ? 'Suche …' : 'Suchen', disabled: busy || (st && !st.enabled), on: { click: search } })),
      tracks.map(t => el('div', { class: 'track' },
        t.image ? el('img', { src: t.image, alt: '', on: { error: e => e.target.replaceWith(el('div', { class: 'ph' })) } }) : el('div', { class: 'ph' }),
        el('div', { 'data-noi18n': '' }, el('b', { text: t.name }), el('small', { text: `${t.artist} · ${mmss(t.ms)}` })),
        ask === t.id
          ? el('div', { class: 'ask' }, el('span', { text: tr('Für {n} XP?').replace('{n}', st.cost) }),
              el('button', { class: 'act primary', type: 'button', text: 'Ja', disabled: busy, on: { click: () => wish(t) } }),
              el('button', { class: 'act', type: 'button', text: 'Nein', on: { click: () => { ask = null; render(); } } }))
          : el('button', { class: 'act', type: 'button', text: 'Wünschen', disabled: !!b || busy, on: { click: () => { ask = t.id; render(); } } })))
    ].flat().filter(x => x != null && x !== false));
    if (!busy && !tracks.length) { const i = main.querySelector('input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  load();
})();
