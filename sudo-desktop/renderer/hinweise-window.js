// hinweise-window.js – „Hinweise deiner IT“: aktuelle Störungen (mit „Ich bin auch betroffen“) und Neustart-Aufforderungen (1.6)
(async () => {
  'use strict';
  const host = window.opsHost;
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
  const when = ms => new Date(ms).toLocaleString(lang(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const time = ms => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  const SEV = { info: ['Info', ''], stoerung: ['Störung', 'gold'], ausfall: ['Ausfall', 'bad'] };
  let confirmFor = null, busy = false, msg = '';

  async function act(fn) {
    if (busy) return; busy = true; msg = '';
    try { const r = await fn(); if (r && r.ok === false && r.msg) msg = tr(r.msg); } finally { busy = false; render(); }
  }

  function restartCard(c, d) {
    const overdue = c.deadline && Date.now() > c.deadline;
    const cls = 'card ' + (c.state === 'done' || c.state === 'notneeded' ? 'done' : overdue ? 'ausfall' : 'stoerung');
    const meta = [];
    if (c.deadline) meta.push(tr(overdue ? 'Frist abgelaufen: {t}' : 'Bitte bis {t}').replace('{t}', when(c.deadline)));
    meta.push(c.upDays === 0 ? tr('Dein PC läuft seit heute.') : tr(c.upDays === 1 ? 'Dein PC läuft seit 1 Tag.' : 'Dein PC läuft seit {n} Tagen.').replace('{n}', c.upDays));
    if (c.pending) meta.push(tr('Windows wartet auf einen Neustart nach Updates.'));
    if (c.state === 'snoozed') meta.push(tr('Erinnerung um {t}').replace('{t}', time(c.snoozeUntil)));
    let btns;
    if (c.state === 'done') btns = el('div', { class: 'btns' }, el('span', { class: 'pill ok', text: 'Erledigt – danke!' }));
    else if (c.state === 'notneeded') btns = el('div', { class: 'btns' }, el('span', { class: 'pill ok', text: 'Für deinen PC gerade nicht nötig' }));
    else if (d.restarting || c.state === 'restarting') btns = el('div', { class: 'btns' }, el('span', { class: 'pill gold', text: 'Neustart in 2 Minuten – bitte alles speichern' }), el('span', { class: 'sep' }),
      el('button', { class: 'act', type: 'button', text: 'Neustart abbrechen', on: { click: () => act(() => host.cancel()) } }));
    else if (confirmFor === c.id) btns = el('div', { class: 'btns' }, el('span', { text: 'Alles gespeichert? Windows startet in 2 Minuten neu.' }), el('span', { class: 'sep' }),
      el('button', { class: 'act primary', type: 'button', text: 'Jetzt neu starten', on: { click: () => { confirmFor = null; act(() => host.restart(c.id)); } } }),
      el('button', { class: 'act', type: 'button', text: 'Abbrechen', on: { click: () => { confirmFor = null; render(); } } }));
    else btns = el('div', { class: 'btns' },
      el('button', { class: 'act primary', type: 'button', text: 'Jetzt neu starten …', on: { click: () => { confirmFor = c.id; render(); } } }),
      el('span', { class: 'sep' }),
      ...c.options.map(o => el('button', { class: 'act', type: 'button', text: o.label, on: { click: () => act(() => host.snooze(c.id, o.id)) } })));
    return el('div', { class: cls },
      el('h3', {}, el('span', { text: '🔄' }), el('span', { 'data-noi18n': '', text: c.title })),
      c.text ? el('p', { 'data-noi18n': '', text: c.text }) : null,
      el('div', { class: 'meta', text: meta.join(' · ') }), btns);
  }

  // 1.9: passende Anleitungen aus SharePoint zur Störung (einmal je Störung abfragen)
  const kbCache = new Map();
  function kbBox(i) {
    const box = el('div', { class: 'kbhint' });
    const fill = items => { if (!items || !items.length) return; box.replaceChildren(el('small', { text: tr('Passende Anleitung:') }), ...items.map(k => el('a', { 'data-noi18n': '', text: k.title, title: k.path || '', on: { click: () => host.open(k.url) } }))); };
    if (kbCache.has(i.id)) fill(kbCache.get(i.id));
    else if (host.kb) host.kb(`${i.title} ${i.text || ''}`).then(items => { kbCache.set(i.id, items || []); fill(items); }).catch(() => kbCache.set(i.id, []));
    return box;
  }
  function incidentCard(i) {
    const [label, pill] = SEV[i.sev] || SEV.stoerung;
    const n = i.affected || 0;
    return el('div', { class: 'card ' + (i.sev || 'stoerung') },
      el('h3', {}, el('span', { class: 'pill ' + pill, text: label }), el('span', { 'data-noi18n': '', text: i.title })),
      i.text ? el('p', { 'data-noi18n': '', text: i.text }) : null,
      kbBox(i),
      el('div', { class: 'meta', text: [tr('seit {t}').replace('{t}', when(i.since)), n === 1 ? tr('1 Person meldet sich betroffen') : tr('{n} Personen melden sich betroffen').replace('{n}', n)].join(' · ') }),
      el('div', { class: 'btns' },
        el('button', { class: 'act' + (i.mine ? ' on' : ''), type: 'button', 'aria-pressed': String(!!i.mine), text: i.mine ? '✓ Du bist als betroffen gemeldet' : 'Ich bin auch betroffen',
          on: { click: () => act(() => host.affected(i.id, !i.mine)) } }),
        i.mine ? el('button', { class: 'act', type: 'button', text: 'Zurücknehmen', on: { click: () => act(() => host.affected(i.id, false)) } }) : null,
        el('span', { class: 'sep' }),
        i.link ? el('button', { class: 'act', type: 'button', text: 'Details', on: { click: () => host.open(i.link) } }) : null));
  }

  async function render() {
    const d = await host.get();
    const restart = d.restart || [], inc = d.incidents || [], res = d.resolved || [];
    const parts = [el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Hinweise deiner IT')))];
    if (msg) parts.push(el('div', { class: 'msg bad', role: 'status', text: msg }));
    if (restart.length) parts.push(el('h2', { class: 'sec', text: 'Neustart' }), restart.map(c => restartCard(c, d)));
    if (inc.length) parts.push(el('h2', { class: 'sec', text: 'Aktuelle Störungen' }), inc.map(incidentCard));
    if (res.length) parts.push(el('h2', { class: 'sec', text: 'Behoben' }), res.map(r => el('div', { class: 'card done' },
      el('h3', {}, el('span', { class: 'pill ok', text: 'Behoben' }), el('span', { 'data-noi18n': '', text: r.title })),
      r.text ? el('p', { 'data-noi18n': '', text: r.text }) : null,
      el('div', { class: 'meta', text: tr('behoben {t}').replace('{t}', when(r.at)) }))));
    if (!restart.length && !inc.length && !res.length) parts.push(el('div', { class: 'calm' }, el('b', { text: 'Alles ruhig.' }), tr('Deine IT meldet gerade keine Störungen und keine Neustarts.')));
    const h = d.help || {};
    const links = [el('a', { text: 'Selbsthilfe öffnen', on: { click: () => host.open('sudo:hilfe') } })];
    if (h.phone) links.push(el('a', { 'data-noi18n': '', text: '☎ ' + h.phone, on: { click: () => host.open('tel:' + h.phone.replace(/[^\d+]/g, '')) } }));
    if (h.mail) links.push(el('a', { 'data-noi18n': '', text: '✉ ' + h.mail, on: { click: () => host.open('mailto:' + h.mail) } }));
    if (h.url) links.push(el('a', { text: 'Hilfe-Portal öffnen', on: { click: () => host.open(h.url) } }));
    parts.push(el('div', { class: 'help' }, h.text ? el('div', { 'data-noi18n': '', text: h.text, style: 'margin-bottom:6px' }) : null, el('div', {}, links)));
    main.replaceChildren(...parts.flat());
  }
  host.onChange(() => { if (!busy && !confirmFor) render(); });
  setInterval(() => { if (!busy && !confirmFor) render(); }, 60000);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  render();
})();
