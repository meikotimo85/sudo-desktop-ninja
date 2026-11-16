// relay.js – Logik des Fensters "Relay einrichten"
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const url = $('url'), token = $('token'), enabled = $('enabled'), msg = $('msg');

  function show(text, kind) { msg.textContent = text; msg.className = kind || ''; }
  function status(s) {
    $('dot').className = 'dot ' + (s.state || '');
    $('state').textContent = 'Status: ' + s.text;
  }
  const values = () => ({ url: url.value.trim(), token: token.value.trim(), enabled: enabled.checked });
  async function busy(btn, fn) { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }

  const cur = await window.relayHost.get();
  url.value = cur.url || ''; token.value = cur.token || ''; enabled.checked = !!cur.enabled;
  status(cur.status);
  window.relayHost.onStatus(status);

  $('test').addEventListener('click', e => busy(e.currentTarget, async () => {
    show('Teste Verbindung …');
    const r = await window.relayHost.test(values());
    show(r.msg, r.ok ? 'ok' : 'bad');
  }));
  $('save').addEventListener('click', e => busy(e.currentTarget, async () => {
    if (!enabled.checked && url.value && token.value) enabled.checked = true;
    const r = await window.relayHost.save(values());
    show(r.msg, r.ok ? 'ok' : 'bad');
  }));
})();
