// ideen.js – Ideen-Board (1.15): Formular und Liste mit Stimmen. Die Daten liegen in der Sudo-Zentrale
// (einstellungen.js → ideen). Ohne Adresse oder bei ausgeschaltetem Board bleibt der Bereich unsichtbar.
// Gespeichert wird im Browser nur eine zufällige Kennung und welche Ideen du schon unterstützt hast.
(() => {
  'use strict';
  const cfg = window.SUDO_INFO || {};
  const base = String(cfg.ideen || '').trim().replace(/\/+$/, '');
  const sec = document.getElementById('ideen');
  if (!base || !sec) return;
  const api = (p, body) => fetch(base + '/api/ideas' + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Die Zentrale antwortet gerade nicht.'); return j; });
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const shown = performance.now();

  // Browser-Kennung und eigene Stimmen – ohne Speicher (privates Fenster) gilt beides nur bis zum Neuladen
  const mem = {};
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } };
  const save = (k, v) => { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
  let voter = load('sudo-ideen-id', '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(voter)) {
    const b = new Uint8Array(18); crypto.getRandomValues(b);
    voter = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    save('sudo-ideen-id', voter);
  }
  const mine = new Set(load('sudo-ideen-stimmen', []));

  const STATES = { neu: 'neu', geplant: 'geplant', in_arbeit: 'in Arbeit', umgesetzt: 'umgesetzt', abgelehnt: 'abgelehnt' };
  const closed = s => s === 'umgesetzt' || s === 'abgelehnt';
  // Pfeil nach oben als Pixel-Grafik (7 × 7), kein Schrift-Symbol
  const ARROW = ['...#...', '..###..', '.#####.', '#######', '..###..', '..###..', '..###..'];
  const arrow = () => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 7 7'); svg.setAttribute('width', '21'); svg.setAttribute('height', '21');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('shape-rendering', 'crispEdges');
    ARROW.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '#') return; const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1); svg.append(r); }));
    return svg;
  };

  let items = [], sort = 'votes';
  const list = $('idea-list'), empty = $('idea-empty');
  const date = t => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  function render() {
    let v = items.slice();
    if (sort === 'done') v = v.filter(i => i.status === 'umgesetzt');
    else v = v.filter(i => i.status !== 'umgesetzt');
    v.sort(sort === 'new' ? (a, b) => b.created - a.created : (a, b) => b.votes - a.votes || b.created - a.created);
    list.replaceChildren(...v.map(card));
    empty.hidden = v.length > 0;
    empty.textContent = sort === 'done' ? 'Noch nichts umgesetzt – aber das kommt.' : 'Noch keine Ideen auf der Liste. Deine könnte die erste sein!';
  }

  function card(i) {
    const li = make('li', 'idea' + (closed(i.status) ? ' closed' : ''));
    const has = mine.has(i.id);
    const vote = make('button', 'vote' + (has ? ' on' : ''));
    vote.type = 'button';
    vote.disabled = closed(i.status);
    vote.setAttribute('aria-pressed', String(has));
    vote.setAttribute('aria-label', (has ? 'Stimme zurücknehmen für ' : 'Zustimmen: ') + i.title + ` (${i.votes} ${i.votes === 1 ? 'Stimme' : 'Stimmen'})`);
    vote.append(arrow(), make('span', 'n', String(i.votes)));
    vote.addEventListener('click', async () => {
      vote.disabled = true;
      try {
        const off = mine.has(i.id);
        const r = await api('/' + i.id + '/vote', { voter, off });
        i.votes = r.votes;
        if (r.voted) mine.add(i.id); else mine.delete(i.id);
        save('sudo-ideen-stimmen', [...mine].slice(-500));
        render();
        const again = list.querySelector(`[data-id="${i.id}"] .vote`); if (again) again.focus();
      } catch (e) { vote.disabled = false; flash(e.message); }
    });
    const body = make('div', 'idea-body');
    const head = make('div', 'idea-top');
    head.append(make('h4', '', i.title), make('span', 'state s-' + i.status, STATES[i.status] || i.status));
    body.append(head, make('p', 'idea-text', i.text), make('p', 'idea-meta', 'eingereicht am ' + date(i.created)));
    if (i.answer) { const a = make('div', 'answer'); a.append(make('b', '', 'Antwort der IT'), make('p', '', i.answer)); body.append(a); }
    li.dataset.id = i.id;
    li.append(vote, body);
    return li;
  }

  let flashT = 0;
  function flash(msg) { const m = $('idea-msg'); m.textContent = msg; m.className = 'form-msg bad'; clearTimeout(flashT); flashT = setTimeout(() => { if (m.textContent === msg) m.textContent = ''; }, 6000); }

  for (const b of sec.querySelectorAll('.chip')) b.addEventListener('click', () => {
    sort = b.dataset.sort;
    for (const x of sec.querySelectorAll('.chip')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
    render();
  });

  // Formular
  const form = $('idea-form'), text = $('idea-text'), count = $('idea-count'), send = $('idea-send'), msg = $('idea-msg');
  text.addEventListener('input', () => { count.textContent = text.value.length + ' / 2000'; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form), title = String(f.get('title') || '').trim(), body = String(f.get('text') || '').trim();
    msg.className = 'form-msg';
    if (title.length < 5) { msg.textContent = 'Bitte einen Titel mit mindestens 5 Zeichen angeben.'; msg.classList.add('bad'); $('idea-title').focus(); return; }
    if (body.length < 10) { msg.textContent = 'Bitte die Idee in mindestens 10 Zeichen beschreiben.'; msg.classList.add('bad'); text.focus(); return; }
    send.disabled = true; msg.textContent = 'Wird gesendet …';
    try {
      const r = await api('', { title, text: body, name: String(f.get('name') || ''), email: String(f.get('email') || ''), website: String(f.get('website') || ''), ms: Math.round(performance.now() - shown) });
      form.reset(); count.textContent = '0 / 2000';
      msg.textContent = r.message; msg.classList.add('ok');
      if (r.public) refresh();
    } catch (err) { msg.textContent = err.message; msg.classList.add('bad'); }
    send.disabled = false;
  });

  function refresh() {
    return api('').then(d => {
      if (!d.enabled) { sec.hidden = true; return; }
      const first = sec.hidden; sec.hidden = false; const nav = $('nav-ideen'); if (nav) nav.hidden = false;
      // Direkter Link auf #ideen: der Bereich war beim Laden noch versteckt, darum jetzt hinspringen
      if (first && location.hash === '#ideen') requestAnimationFrame(() => sec.scrollIntoView());
      items = Array.isArray(d.items) ? d.items : [];
      render();
    });
  }
  refresh().catch(() => {
    // Zentrale nicht erreichbar: Bereich mit Hinweis zeigen, damit niemand vor einem leeren Formular sitzt
    sec.hidden = false;
    list.replaceChildren(); empty.hidden = false;
    empty.textContent = 'Die Liste ist gerade nicht erreichbar. Versuch es später noch einmal.';
  });
})();
