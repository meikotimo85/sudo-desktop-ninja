// start-window.js – 1.10: Start-Checkliste für neue Kollegen. Viele Punkte prüft Sudo selbst, den Rest hakt man ab.
(async () => {
  'use strict';
  const host = window.startHost;
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
  const AUTO = { onedrive: 'Sudo prüft: OneDrive angemeldet', kfm: 'Sudo prüft: Desktop und Dokumente in OneDrive', signature: 'Sudo prüft: Signatur in Outlook (klassisch) vorhanden',
    printer: 'Sudo prüft: Drucker verbunden', teams: 'Sudo prüft: Teams eingerichtet', quiz: 'Sudo prüft: Quizfrage beantwortet', health: 'Sudo prüft: Gerätezustand in Ordnung' };
  let busy = false;

  async function render() {
    const v = await host.get();
    const head = [el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Start-Checkliste'))),
      el('p', { class: 'lead', text: 'Willkommen! Diese Punkte hat deine IT für den Start zusammengestellt. Was Sudo selbst erkennen kann, hakt er von allein ab.' })];
    if (!v) { main.replaceChildren(...head, el('div', { class: 'res', text: tr('Gerade gibt es keine Start-Checkliste für diesen PC.') })); return; }
    const pct = v.total ? Math.round(v.done / v.total * 100) : 0;
    main.replaceChildren(...head,
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${pct}%` })),
      el('p', { class: 'note', text: v.done >= v.total ? tr('Alles erledigt – stark! Du bist startklar.') : tr('{d} von {t} erledigt.').replace('{d}', v.done).replace('{t}', v.total) }),
      el('div', { class: 'box' }, v.items.map(i => {
        const id = 'c' + i.id;
        const cb = el('input', { type: 'checkbox', id, checked: i.done, on: { change: async e => { if (busy) return; busy = true; e.target.disabled = true; await host.mark(i.id, e.target.checked); busy = false; render(); } } });
        return el('div', { class: 'check' + (i.done ? ' done' : '') }, cb,
          el('label', { class: 't', for: id, 'data-noi18n': '' }, el('b', { text: i.title }), i.text ? el('small', { text: i.text }) : null,
            i.check !== 'manual' ? el('span', { class: 'tag', text: tr(AUTO[i.check] || 'Sudo prüft das selbst') + (i.auto ? ' ✓' : '') }) : null),
          i.link ? el('button', { class: 'act', type: 'button', text: tr('Öffnen'), on: { click: () => host.open(i.link) } }) : null);
      })),
      el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: 'Neu prüfen', on: { click: async b => { b.target.disabled = true; await host.recheck(); render(); } } })),
      el('p', { class: 'note', text: 'Deine IT sieht, welche Punkte auf diesem PC erledigt sind – damit sie dir beim Rest helfen kann. Sudo prüft nur „ja oder nein“, keine Inhalte.' }));
  }
  host.onChange(() => { if (!busy) render(); });
  await render();
  host.recheck().then(render);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
