// selfhelp-window.js – Selbsthilfe: kleine Reparaturen mit einem Klick, ohne Adminrechte (1.6)
(async () => {
  'use strict';
  const host = window.helpHost;
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
  const d = await host.get();
  let running = false;

  function result(box, r) {
    const cls = r.state === 'bad' ? 'bad' : r.state === 'warn' ? 'warn' : r.ok ? '' : 'bad';
    const res = el('div', { class: 'res ' + cls, role: 'status' }, el('div', { text: tr(r.msg || (r.ok ? 'Erledigt.' : 'Hat nicht geklappt.')) + (r.note ? ' ' + tr(r.note) : '') }));
    if (Array.isArray(r.checks)) res.append(el('ul', { class: 'checks' }, r.checks.map(c =>
      el('li', {}, el('i', { class: c.state }), el('span', { text: tr(c.title) }), el('small', { text: tr(c.detail || '') })))));
    // 1.10: Knöpfe mit dem nächsten Schritt (Windows-Seite öffnen oder ein anderes Werkzeug starten)
    if (Array.isArray(r.actions) && r.actions.length) res.append(el('div', { class: 'acts' }, r.actions.map(a => el('button', { class: 'act', type: 'button', text: tr(a.label), on: { click: () => {
      if (a.link) return host.open(a.link);
      const other = document.querySelector('#tool-' + a.tool + ' .head button'); if (other) { other.scrollIntoView({ block: 'center' }); other.click(); }
    } } }))));
    box.replaceChildren(res);
  }
  async function exec(t, box, btn) {
    if (running) return;
    running = true; btn.disabled = true;
    document.querySelectorAll('.tool button').forEach(b => { b.disabled = true; });
    box.replaceChildren(el('div', { class: 'res busy', text: tr(t.id === 'net' ? 'Prüfe …' : t.id === 'slow' ? 'Schaue nach, was bremst … (dauert ein paar Sekunden)' : 'Läuft …') }));
    try { result(box, await host.run(t.id)); }
    catch (e) { result(box, { ok: false, msg: e.message }); }
    finally { running = false; document.querySelectorAll('.tool button').forEach(b => { b.disabled = false; }); }
  }
  function tool(t) {
    const box = el('div');
    const btn = el('button', { class: 'act' + (t.id === 'net' || t.id === 'slow' ? ' primary' : ''), type: 'button', text: t.button, on: { click: () => {
      if (t.open) return host.open(t.open);
      if (!t.confirm) return exec(t, box, btn);
      box.replaceChildren(el('div', { class: 'confirm' }, el('span', { text: tr(t.confirm) }),
        el('button', { class: 'act primary', type: 'button', text: 'Weiter', on: { click: () => exec(t, box, btn) } }),
        el('button', { class: 'act', type: 'button', text: 'Abbrechen', on: { click: () => box.replaceChildren() } })));
    } } });
    return el('div', { class: 'tool', id: 'tool-' + t.id }, el('div', { class: 'head' }, el('div', { class: 't' }, el('b', { text: t.title }), el('small', { text: t.text })), btn), box);
  }
  const h = d.help || {};
  const links = [];
  if (h.phone) links.push(el('a', { 'data-noi18n': '', text: '☎ ' + h.phone, on: { click: () => host.open('tel:' + h.phone.replace(/[^\d+]/g, '')) } }));
  if (h.mail) links.push(el('a', { 'data-noi18n': '', text: '✉ ' + h.mail, on: { click: () => host.open('mailto:' + h.mail) } }));
  if (h.url) links.push(el('a', { text: 'Hilfe-Portal öffnen', on: { click: () => host.open(h.url) } }));
  main.replaceChildren(...[
    el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Selbsthilfe'))),
    el('p', { class: 'lead', text: 'Kleine Reparaturen, die du selbst ausführen kannst – ohne Adminrechte und ohne Ticket. Es wird nur in deinem Benutzerkonto etwas geändert.' }),
    d.tools.map(tool),
    el('div', { class: 'help' }, el('b', { text: 'Hat nicht geholfen?' }),
      el('div', { 'data-noi18n': h.text ? '' : null, text: h.text || tr('Dann melde dich bei deiner IT und sag dazu, welche Werkzeuge du schon probiert hast.') }),
      links.length ? el('div', { style: 'margin-top:6px' }, links) : null)].flat());
  if (d.focus) { const f = document.getElementById('tool-' + d.focus); if (f) { f.scrollIntoView(); const b = f.querySelector('button'); if (b) b.focus(); } }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
