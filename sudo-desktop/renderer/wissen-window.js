// wissen-window.js – „Anleitungen“ (1.9): SharePoint-Anleitungen der Firma über die Zentrale durchsuchen, Klick öffnet das Original
(async () => {
  'use strict';
  const host = window.kbHost;
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
  const EXT = { docx: 'DOC', doc: 'DOC', pptx: 'PPT', ppt: 'PPT', xlsx: 'XLS', xls: 'XLS', pdf: 'PDF', aspx: 'WEB', txt: 'TXT', md: 'TXT', one: 'ONE', mp4: 'VID', vsdx: 'VSD', url: 'URL' };
  const date = ms => (ms ? new Date(ms).toLocaleDateString(lang(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  // Suchwörter im Auszug markieren (ohne innerHTML)
  function marked(text, q) {
    const words = String(q).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3);
    if (!words.length || !text) return [text];
    const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'giu');
    return String(text).split(re).map((part, i) => (i % 2 ? el('mark', { text: part }) : part));
  }

  const input = el('input', { type: 'search', maxlength: 200, 'aria-label': 'Suchbegriff', placeholder: tr('Wonach suchst du? z. B. VPN, Drucker, MFA …') });
  const list = el('div', { 'aria-live': 'polite' });
  let timer = null, seq = 0;
  async function run() {
    const q = input.value.trim(), my = ++seq;
    const r = await host.search(q);
    if (my !== seq) return;                                  // veraltete Antwort
    if (!r.ok) { list.replaceChildren(el('div', { class: 'calm' }, el('b', { text: 'Gerade nicht erreichbar.' }), r.msg || '')); return; }
    if (!r.items.length) { list.replaceChildren(el('div', { class: 'calm' }, el('b', { text: 'Nichts gefunden.' }), tr('Andere Wörter probieren – oder Frag Sudo bzw. deine IT.'))); return; }
    list.replaceChildren(el('h2', { class: 'sec', text: r.recent ? 'Zuletzt geändert' : 'Treffer' }), ...r.items.map(i => {
      const open = () => host.open(i.url);
      return el('div', { class: 'hit', tabindex: '0', role: 'link', on: { click: open, keydown: e => { if (e.key === 'Enter') open(); } } },
        el('span', { class: 'ico ' + (i.ext || ''), 'data-noi18n': '', text: EXT[i.ext] || (i.ext || '').toUpperCase().slice(0, 3) || 'DOC' }),
        el('div', { 'data-noi18n': '' }, el('b', { text: i.title }), el('small', { text: [i.path || i.source, date(i.modified)].filter(Boolean).join(' · ') }),
          i.snippet ? el('p', {}, ...marked(i.snippet, q)) : null),
        el('button', { class: 'act', type: 'button', text: 'Öffnen', on: { click: e => { e.stopPropagation(); open(); } } }));
    }));
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 280); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });

  const st = await host.get();
  main.replaceChildren(
    el('div', { class: 'top' }, el('h1', { text: 'Anleitungen' })),
    el('p', { class: 'lead', text: 'Die Anleitungen deiner IT aus SharePoint. Ein Klick öffnet das Original im Browser.' }),
    el('div', { class: 'search' }, input),
    list,
    el('p', { class: 'foot', text: st.on ? 'Gesucht wird in Titeln, Ordnern und im Text von Word-, PowerPoint- und SharePoint-Seiten.' : 'Deine Zentrale hat gerade keine Anleitungen freigegeben.' }));
  input.value = st.query || '';
  host.onQuery(q => { input.value = q; run(); });
  input.focus();
  run();
})();
