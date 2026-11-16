// ask-window.js – „Frag Sudo“: Chat mit Claude im Sudo-Stil (Antworten kommen Stück für Stück)
(async () => {
  'use strict';
  const host = window.askHost;
  const $ = id => document.getElementById(id);
  const tr = x => (window.I18N ? I18N.t(x) : x);
  const LOC = () => (window.I18N && I18N.locale) || 'de-DE';
  const log = $('log'), q = $('q'), sendBtn = $('send');
  let st = await host.status();
  let model = st ? st.model : 'haiku';
  let current = null, localAsk = false;            // { el, text } der Antwort, die gerade hereinkommt

  /* ---------- kleines, sicheres Markdown: erst alles escapen, dann Codeblöcke, Inline-Code, fett, Listen ---------- */
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function md(src) {
    const parts = String(src).split(/```/);
    let html = '';
    parts.forEach((part, i) => {
      if (i % 2) {                                    // Codeblock (erste Zeile = Sprache)
        const nl = part.indexOf('\n');
        const code = nl >= 0 ? part.slice(nl + 1) : part;
        html += `<div class="code"><button type="button" data-copy>${esc(tr('Kopieren'))}</button><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`;
        return;
      }
      const blocks = part.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
      for (const b of blocks) {
        const lines = b.split('\n');
        const fmt = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        // 1.9: Markdown-Links (z. B. auf SharePoint-Anleitungen) anklickbar – nur https, Öffnen über den Hauptprozess
        const inline = t => {
          let out = '', last = 0;
          for (const m of t.matchAll(/\[([^\]]{1,200})\]\((https:\/\/[^\s)]{3,800})\)/g)) {
            out += fmt(t.slice(last, m.index)) + `<a href="#" data-href="${esc(m[2]).replace(/"/g, '&quot;')}">${esc(m[1])}</a>`;
            last = m.index + m[0].length;
          }
          return out + fmt(t.slice(last));
        };
        if (lines.every(l => /^\s*[-*•]\s+/.test(l))) html += '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('') + '</ul>';
        else if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) html += '<ol>' + lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('') + '</ol>';
        else html += `<p>${lines.map(inline).join('<br>')}</p>`;
      }
    });
    return html;
  }
  log.addEventListener('click', e => {
    const a = e.target.closest('a[data-href]');
    if (a) { e.preventDefault(); if (host.open) host.open(a.getAttribute('data-href')); return; }
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    host.copy(b.nextElementSibling.textContent);
    b.textContent = tr('Kopiert!'); setTimeout(() => { b.textContent = tr('Kopieren'); }, 1200);
  });

  function bubble(kind, content, isHtml) {
    const d = document.createElement('div');
    d.className = 'msg ' + kind;
    if (kind !== 'me') { const w = document.createElement('span'); w.className = 'who'; w.textContent = 'Sudo'; d.append(w); }
    const body = document.createElement('div');
    if (kind !== 'err') body.setAttribute('data-noi18n', '');       // Fragen und Claudes Antworten nicht „übersetzen“
    if (isHtml) body.innerHTML = content; else body.textContent = content;
    d.append(body);
    $('log').querySelector('.empty, .off')?.remove();
    log.append(d); log.scrollTop = log.scrollHeight;
    return { d, body };
  }

  const usd = v => (v * 100).toLocaleString(LOC(), { maximumFractionDigits: v * 100 < 1 ? 3 : 2 }) + ' ct';
  function renderUsage() {
    if (!st) return;
    const t = st.today;
    $('usage').textContent = st.mode === 'key'
      ? `${tr('Heute')}: ${t.q} · ${usd(t.usd)}${st.dailyUsd ? ' / ' + usd(st.dailyUsd) : ''}`
      : st.mode === 'zentrale' ? `${tr('Heute')}: ${t.q} · ${tr('über die Sudo-Zentrale')}` : '';
  }
  function renderModel() {
    const seg = $('model'); seg.replaceChildren();
    for (const [k, label] of [['haiku', 'Schnell'], ['sonnet', 'Schlau']]) {
      const b = document.createElement('button');
      b.textContent = label; b.title = st && st.models ? st.models[k] : k;
      b.setAttribute('aria-pressed', String(model === k));
      b.addEventListener('click', () => { model = k; renderModel(); });
      seg.append(b);
    }
  }
  function renderEmpty() {
    if (log.children.length) return;
    if (!st || !st.ready) {
      const d = document.createElement('div'); d.className = 'off';
      const b = document.createElement('b'); b.textContent = !st || st.mode === 'off' ? 'Frag Sudo ist noch aus.' : st.mode === 'key' ? 'Es fehlt noch der API-Schlüssel.' : 'Sudo ist noch nicht mit der Zentrale verbunden.';
      const p = document.createElement('div'); p.textContent = 'In den Einstellungen unter „KI“ wählst du: eigener Claude-API-Schlüssel oder über die Sudo-Zentrale deiner Firma.';
      const btn = document.createElement('button'); btn.textContent = 'KI einrichten …'; btn.addEventListener('click', () => host.settings());
      d.append(b, p, btn); log.append(d);
      return;
    }
    const d = document.createElement('div'); d.className = 'empty';
    const b = document.createElement('b'); b.textContent = 'Frag den Ninja!';
    const p = document.createElement('div'); p.textContent = 'IT-Fragen, PowerShell, Fehlermeldungen, kurze Erklärungen. Ich antworte knapp.';
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const ex of ['Was ist der Unterschied zwischen SPF, DKIM und DMARC?', 'PowerShell: alle deaktivierten Benutzer in Entra ID anzeigen', 'Ist Microsoft 365 gerade gestört?', 'Erzähl einen IT-Witz']) {
      const c = document.createElement('button'); c.textContent = ex; c.addEventListener('click', () => { q.value = tr(ex); go(); }); chips.append(c);
    }
    d.append(b, p, chips); log.append(d);
  }

  async function go() {
    if (current) { host.cancel(); return; }
    const text = q.value.trim();
    if (!text) return;
    if (!st || !st.ready) { renderEmpty(); return; }
    q.value = ''; autosize();
    bubble('me', text); localAsk = true;
    const r = await host.send(text, model);
    if (!r.ok && !current) bubble('err', r.msg || 'Fehler');
  }
  host.onEvent(async ev => {
    if (ev.kind === 'start') {
      if (!localAsk && ev.question) bubble('me', ev.question);
      localAsk = false;
      const b = bubble('sudo', '', false);
      b.body.classList.add('cursor');
      current = { ...b, text: '' };
      sendBtn.textContent = tr('Stopp'); sendBtn.classList.add('stop');
    } else if (ev.kind === 'delta' && current) {
      current.text += ev.text;
      current.body.innerHTML = md(current.text);
      current.body.classList.add('cursor');
      log.scrollTop = log.scrollHeight;
    } else if (ev.kind === 'end') {
      if (current) {
        current.body.classList.remove('cursor');
        if (!ev.ok) {
          if (!current.text) current.d.remove();
          bubble('err', tr(ev.msg || 'Fehler'));
        } else {
          current.body.innerHTML = md(ev.text);
          const m = document.createElement('div'); m.className = 'meta';
          m.textContent = `${ev.usage.in + ev.usage.out} Token · ${usd(ev.usd)}${ev.cut ? ' · ' + tr('gekürzt') : ''}`;
          current.d.append(m);
        }
      }
      current = null;
      sendBtn.textContent = tr('Fragen'); sendBtn.classList.remove('stop');
      st = await host.status(); renderUsage();
      log.scrollTop = log.scrollHeight;
      q.focus();
    }
  });

  function autosize() { q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight + 2) + 'px'; }
  q.addEventListener('input', autosize);
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  sendBtn.addEventListener('click', go);
  $('reset').addEventListener('click', async () => { if (current) host.cancel(); await host.reset(); log.replaceChildren(); renderEmpty(); q.focus(); });
  $('settings').addEventListener('click', () => host.settings());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (current) host.cancel(); else window.close(); } });
  window.addEventListener('focus', async () => { const was = st && st.ready; st = await host.status(); renderUsage(); if (!was && st && st.ready) { log.replaceChildren(); renderEmpty(); } });

  // Bisheriges Gespräch wieder anzeigen (Fenster war zu, Verlauf liegt noch im Hauptprozess)
  for (const m of await host.history()) bubble(m.role === 'user' ? 'me' : 'sudo', m.role === 'user' ? m.content : md(m.content), m.role !== 'user');
  renderModel(); renderUsage(); renderEmpty();
  q.focus();
})();
