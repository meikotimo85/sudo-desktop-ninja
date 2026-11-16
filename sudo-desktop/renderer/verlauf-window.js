// verlauf-window.js – „Was hat Sudo gesagt?“ (1.9): wichtige Sprechblasen zum Nachlesen
// 1.11: Suche nach Text, Ticket- und Gerätekennung, Filter nach Zeitraum und Quelle. Alles bleibt auf diesem PC.
(async () => {
  'use strict';
  const host = window.historyHost;
  const main = document.getElementById('main');
  const tr = x => (window.I18N ? I18N.t(x) : x);
  const lang = () => document.documentElement.lang || 'de';
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
  const CATS = [['all', 'Alle'], ['zentrale', 'Deine IT'], ['sys', 'Wächter'], ['reminder', 'Erinnerungen'], ['youtube', 'Videos'], ['ask', 'Frag Sudo']];
  const CAT_NAME = { zentrale: 'Deine IT', relay: 'Relay', event: 'Meldung', youtube: 'Eigener Kanal', sys: 'Wächter', reminder: 'Erinnerung', ask: 'Frag Sudo' };
  const SPANS = [['all', 'Gesamter Zeitraum'], ['today', 'Heute'], ['7', 'Letzte 7 Tage'], ['30', 'Letzte 30 Tage'], ['range', 'Von … bis …']];
  const ALERT = /fehlgeschlagen|antwortet nicht|Störung|Ausfall|Achtung|Warnung|failed|down|offline/i;
  const PAGE = 200;
  let data = { items: [], seen: 0, days: 30, max: 2000 };
  const f = { cat: 'all', q: '', span: 'all', from: '', to: '', shown: PAGE };

  const dayOf = ms => { const d = new Date(ms), t = new Date(); const y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return tr('Heute');
    if (d.toDateString() === y.toDateString()) return tr('Gestern');
    return d.toLocaleDateString(lang(), { weekday: 'long', day: '2-digit', month: '2-digit' }); };
  const time = ms => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  const linkLabel = l => (l === 'sudo:ask' ? 'Antwort öffnen' : l.startsWith('sudo:lage') ? 'IT-Lage öffnen' : l.startsWith('sudo:') ? 'Öffnen' : /youtube\.com/.test(l) ? 'Video öffnen' : 'Link öffnen');
  const dayStart = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };

  // Zeitfenster [von, bis) in Millisekunden; null = offen
  function window_() {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    if (f.span === 'today') return [t0.getTime(), null];
    if (f.span === '7' || f.span === '30') return [Date.now() - Number(f.span) * 864e5, null];
    if (f.span === 'range') { const a = dayStart(f.from), b = dayStart(f.to); return [a, b == null ? null : b + 864e5]; }
    return [null, null];
  }
  // Suche: alle Wörter müssen vorkommen – im Text, in der Ticket- oder Gerätekennung oder im Namen der Quelle. „#4711“ findet auch „4711“.
  function matches(h, words) {
    if (!words.length) return true;
    const hay = [h.text, h.ticket ? '#' + h.ticket : '', h.device || '', tr(CAT_NAME[h.cat] || '')].join('\n').toLowerCase();
    return words.every(w => hay.includes(w) || (w.length > 1 && w[0] === '#' && hay.includes(w.slice(1))));
  }
  function filtered() {
    const [from, to] = window_(), words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.items.filter(h => (f.cat === 'all' || h.cat === f.cat || (f.cat === 'zentrale' && (h.cat === 'relay' || h.cat === 'event')))
      && (from == null || h.at >= from) && (to == null || h.at < to) && matches(h, words));
  }
  const active = () => f.cat !== 'all' || f.q.trim() !== '' || (f.span !== 'all' && !(f.span === 'range' && !f.from && !f.to));

  /* ---------- Gerüst: bleibt stehen, damit das Suchfeld beim Tippen den Fokus behält ---------- */
  const lead = el('p', { class: 'lead' });
  const search = el('input', { type: 'search', class: 'q', placeholder: 'Suchen: Text, Ticket-Nummer, Gerät …', 'aria-label': 'Verlauf durchsuchen', maxlength: 80,
    on: { input: e => { f.q = e.target.value; f.shown = PAGE; renderList(); } } });
  const span = el('select', { 'aria-label': 'Zeitraum', on: { change: e => { f.span = e.target.value; f.shown = PAGE; range.hidden = f.span !== 'range'; renderList(); } } },
    SPANS.map(([v, l]) => el('option', { value: v, text: l })));
  const dateIn = (key, label) => el('label', {}, el('span', { text: label }), el('input', { type: 'date', on: { change: e => { f[key] = e.target.value; f.shown = PAGE; renderList(); } } }));
  const range = el('div', { class: 'range', hidden: true }, dateIn('from', 'Von'), dateIn('to', 'Bis'));
  const cats = el('div', { class: 'filters', role: 'group', 'aria-label': 'Quelle' });
  const list = el('div', { class: 'list' });
  const foot = el('div', { class: 'foot' });
  main.replaceChildren(
    el('div', { class: 'top' }, el('h1', { text: 'Was hat Sudo gesagt?' })), lead,
    el('div', { class: 'find' }, search, span), range, cats, list, foot);

  function reset() {
    Object.assign(f, { cat: 'all', q: '', span: 'all', from: '', to: '', shown: PAGE });
    search.value = ''; span.value = 'all'; range.hidden = true; range.querySelectorAll('input').forEach(i => { i.value = ''; });
    renderList();
  }
  function renderList() {
    cats.replaceChildren(...CATS.map(([k, l]) => el('button', { type: 'button', 'aria-pressed': String(f.cat === k), text: l, on: { click: () => { f.cat = k; f.shown = PAGE; renderList(); } } })));
    const hits = filtered(), kids = [];
    if (!hits.length) {
      kids.push(el('div', { class: 'calm' }, el('b', { text: data.items.length ? 'Nichts gefunden.' : 'Alles ruhig.' }),
        tr(!data.days ? 'Der Verlauf ist ausgeschaltet. Sudo merkt sich keine Meldungen.' : data.items.length ? 'Zu dieser Suche gibt es keinen Eintrag.' : 'Sudo hat bisher nichts Wichtiges gesagt.'),
        active() && data.items.length ? el('div', {}, el('button', { class: 'act', type: 'button', text: 'Filter zurücksetzen', on: { click: reset } })) : null));
    }
    let day = '';
    for (const h of hits.slice(0, f.shown)) {
      const d = dayOf(h.at);
      if (d !== day) { day = d; kids.push(el('h2', { class: 'day', 'data-noi18n': '', text: d })); }
      const cls = 'item ' + (h.cat === 'sys' || h.cat === 'reminder' || h.cat === 'youtube' ? h.cat : '') + (ALERT.test(h.text) ? ' bad' : '');
      kids.push(el('div', { class: cls },
        el('time', { 'data-noi18n': '', text: time(h.at) }),
        el('div', {}, el('p', { 'data-noi18n': '', text: h.text }),
          el('small', {}, tr(CAT_NAME[h.cat] || ''),
            h.ticket ? el('span', { class: 'tag', 'data-noi18n': '', text: tr('Ticket') + ' #' + h.ticket }) : null,
            h.device ? el('span', { class: 'tag', 'data-noi18n': '', text: h.device }) : null,
            h.meeting ? [' · ', el('b', { text: tr(h.at > data.seen ? 'im Meeting – neu' : 'im Meeting') })] : null)),
        h.link ? el('button', { class: 'act', type: 'button', text: linkLabel(h.link), on: { click: () => host.open(h.link) } }) : el('span')));
    }
    if (hits.length > f.shown) kids.push(el('button', { class: 'act more', type: 'button', text: tr('{n} weitere zeigen').replace('{n}', Math.min(PAGE, hits.length - f.shown)), on: { click: () => { f.shown += PAGE; renderList(); } } }));
    list.replaceChildren(...kids);

    lead.textContent = tr(!data.days ? 'Der Verlauf ist ausgeschaltet. Sudo merkt sich keine Meldungen.'
      : 'Wichtige Meldungen der letzten {n} Tage zum Nachlesen und Durchsuchen – auch die, die Sudo im Meeting zurückgehalten hat. Bleibt nur auf diesem PC.').replace('{n}', data.days);
    foot.replaceChildren(
      el('span', { text: tr(active() ? '{n} von {m} Einträgen gefunden' : '{n} Einträge').replace('{n}', hits.length).replace('{m}', data.items.length) }),
      el('span', { class: 'acts' },
        el('button', { class: 'act', type: 'button', text: 'Aufbewahrung ändern …', on: { click: () => host.settings() } }),
        data.items.length ? el('button', { class: 'act', type: 'button', text: 'Verlauf leeren', on: { click: async () => { if (!confirm(tr('Den ganzen Verlauf löschen?'))) return; await host.clear(); await load(); } } }) : null));
  }
  async function load() { data = await host.get(); renderList(); }
  host.onChange(load);
  await load();
})();
