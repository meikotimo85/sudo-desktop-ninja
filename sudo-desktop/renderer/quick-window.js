// quick-window.js – Schnell-Erinnerungen und Notizen
(() => {
  'use strict';
  const host = window.quickHost;
  const $ = id => document.getElementById(id);
  const inp = $('inp'), prev = $('prev');
  const pad = n => String(n).padStart(2, '0');
  const fmt = iso => {
    const d = new Date(iso), now = new Date();
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return days === 0 ? `heute ${t}` : days === 1 ? `morgen ${t}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${t}`;
  };

  async function render() {
    const { reminders, notes } = await host.list();
    const item = (i, isNote) => {
      const li = document.createElement('li'); if (isNote) li.className = 'note';
      if (!isNote) li.append(Object.assign(document.createElement('span'), { className: 'w', textContent: fmt(i.at) }));
      li.append(Object.assign(document.createElement('span'), { className: 'x', textContent: i.text }));
      const b = Object.assign(document.createElement('button'), { textContent: isNote ? 'Erledigt' : 'Löschen', title: isNote ? 'Notiz abhaken' : 'Erinnerung löschen' });
      b.addEventListener('click', async () => { await host.remove(i.id); render(); });
      li.append(b); return li;
    };
    const empty = t => Object.assign(document.createElement('li'), { className: 'empty', textContent: t, style: 'background:none;border:0;display:block;padding:0 2px' });
    $('rem').replaceChildren(...(reminders.length ? reminders.map(i => item(i, false)) : [empty('Keine.')]));
    $('notes').replaceChildren(...(notes.length ? notes.map(i => item(i, true)) : [empty('Keine.')]));
  }

  inp.addEventListener('input', async () => {
    const v = inp.value.trim();
    if (!v) { prev.textContent = ''; return; }
    const p = await host.parse(v);
    prev.replaceChildren();
    const s = document.createElement('span'); s.className = p.when ? 't' : 'n';
    s.textContent = p.when ? `⏰ ${p.when}` : '📝 Notiz';
    const b = document.createElement('b'); b.textContent = p.text;
    prev.append(s, ' · ', b);
  });
  inp.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && inp.value.trim()) {
      const r = await host.add(inp.value);
      if (r.ok) { inp.value = ''; prev.textContent = '✓ ' + r.msg; render(); if (!e.shiftKey) setTimeout(() => window.close(), 700); }
      else prev.textContent = r.msg;
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  window.addEventListener('focus', () => { inp.focus(); render(); });
  inp.focus();
  render();
})();
