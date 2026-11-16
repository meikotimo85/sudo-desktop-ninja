// admin.js – Verwaltung der Sudo-Zentrale (ohne Framework, nur eigene Dateien wegen strenger CSP)
(() => {
  'use strict';
  const app = document.getElementById('app');
  // Läuft die Zentrale in einem Unterordner (z. B. /sudo/admin/), gelten alle Adressen relativ dazu
  const BASE = location.pathname.replace(/\/admin(\/.*)?$/, '');
  let me = null, view = 'home';

  /* ---------- Bausteine ---------- */
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;          // per CSSOM – erlaubt trotz strenger CSP
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && c !== false && e.append(c));
    return e;
  };
  async function api(method, url, body) {
    const r = await fetch(BASE + url, { method, credentials: 'same-origin',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(me ? { 'x-csrf': me.csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch { /* leer */ }
    if (r.status === 401 && url.startsWith('/admin/api')) { me = null; renderLogin(); throw new Error('Bitte anmelden.'); }
    if (!r.ok) throw new Error((data && data.message) || 'Fehler ' + r.status);
    return data;
  }
  function toast(text, bad) {
    const t = el('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', text });
    document.body.append(t); setTimeout(() => t.remove(), 3500);
  }
  const fmtDate = t => t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
  const ago = t => { if (!t) return 'nie'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tagen`; };
  const usd = v => v < 1 ? (v * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ct' : v.toLocaleString('de-DE', { style: 'currency', currency: 'USD' });
  const card = (title, ...kids) => el('section', { class: 'card' }, title ? el('h3', { text: title }) : null, ...kids);
  // Gerätezustand (1.5): Ampel und Klartext je Prüfung
  const H_NAME = { bitlocker: 'BitLocker', av: 'Virenschutz', fw: 'Firewall', updates: 'Windows-Update', reboot: 'Neustart', disk: 'Speicher C:' };
  const H_WORD = { ok: 'in Ordnung', warn: 'ansehen', bad: 'Problem', unknown: 'unbekannt' };
  const healthCell = h => {
    if (!h) return el('span', { class: 'muted', text: '–' });
    const issues = Object.entries(h.i || {}).filter(([, v]) => v === 'warn' || v === 'bad');
    const extra = [h.updDays != null ? `Update vor ${h.updDays} T.` : '', h.upDays != null ? `Laufzeit ${h.upDays} T.` : '', h.disk != null ? `C: ${h.disk} % frei` : ''].filter(Boolean).join(' · ');
    return el('div', {}, el('span', { class: 'pill ' + (h.s === 'ok' ? 'ok' : h.s === 'bad' ? 'bad' : h.s === 'warn' ? 'warn' : ''), text: H_WORD[h.s] || h.s }),
      issues.length ? el('div', { class: 'muted', text: issues.map(([k, v]) => `${H_NAME[k] || k}${v === 'bad' ? ' !' : ''}`).join(', ') }) : null,
      el('div', { class: 'muted', text: extra }));
  };
  const action = (label, fn, cls = '') => {
    const b = el('button', { class: 'btn ' + cls, type: 'button', text: label });
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message, true); } finally { b.disabled = false; } });
    return b;
  };
  const secretBox = (title, value, hint) => el('div', { class: 'secret' }, el('b', { text: title }), el('code', { text: value }), el('small', { class: 'muted', text: hint }),
    action('Kopieren', async () => { await navigator.clipboard.writeText(value); toast('Kopiert.'); }, 'small'));

  const TYPES = {
    message: { label: 'Mitteilung', fields: [['text', 'Text', 'textarea'], ['link', 'Link (optional, https://…)']] },
    warning: { label: 'Warnung', fields: [['text', 'Text', 'textarea'], ['link', 'Link (optional, https://…)']] },
    success: { label: 'Erfolg', fields: [['text', 'Text', 'textarea']] },
    server_down: { label: 'Server down', fields: [['host', 'Server'], ['text', 'Details']] },
    backup_failed: { label: 'Backup fehlgeschlagen', fields: [['kunde', 'Kunde / Job']] },
    deploy_ok: { label: 'Deploy erfolgreich', fields: [['version', 'Version']] },
    ticket: { label: 'Ticket', fields: [['ticket', 'Ticket-Nr.'], ['titel', 'Titel']] },
    bug: { label: 'Bug aussetzen', fields: [] },
    quiz: { label: 'Quizfrage', fields: [], hidden: true },
    video: { label: 'YouTube-Video', fields: [], hidden: true },
    music: { label: 'Musikwunsch', fields: [], hidden: true }
  };
  const summary = ev => Object.entries(ev).filter(([k]) => k !== 'type' && k !== 'dur').map(([, v]) => v).join(' · ') || '–';

  /* ---------- Anmeldung ---------- */
  async function renderLogin() {
    const info = await fetch(BASE + '/auth/info').then(r => r.json()).catch(() => ({}));
    const q = new URLSearchParams(location.search);
    const msg = el('div', { class: 'msg bad', text: q.get('fehler') || '' });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Admin-Passwort', placeholder: 'Admin-Passwort' });
    const form = el('form', { on: { submit: async e => {
      e.preventDefault();
      try { await api('POST', '/auth/password', { password: pw.value }); location.href = BASE + '/admin/'; } catch (x) { msg.textContent = x.message; }
    } } }, el('div', { class: 'row' }, pw, el('button', { class: 'btn', type: 'submit', text: 'Anmelden' })));
    app.className = 'login';
    app.replaceChildren(el('div', { class: 'center' },
      el('img', { src: BASE + '/icon.png', alt: '', class: 'logo' }), el('h1', {}, el('span', { text: 'sudo' }), ' zentrale'),
      el('div', { class: 'card' },
        info.entra ? el('a', { class: 'btn ms', href: BASE + '/auth/login', text: 'Mit Microsoft anmelden' }) : null,
        info.entra && info.password ? el('div', { class: 'or', text: 'oder Notfall-Zugang' }) : null,
        info.password ? form : null,
        !info.entra && !info.password ? el('p', { text: 'Es ist noch keine Anmeldung eingerichtet. Bitte ENTRA_* oder ADMIN_PASSWORD in der .env setzen.' }) : null,
        msg),
      el('p', { class: 'muted', text: 'Version ' + (info.version || '') })));
    if (q.get('fehler')) history.replaceState(null, '', BASE + '/admin/');
  }

  /* ---------- Rahmen ---------- */
  const NAV = [['home', 'Übersicht'], ['send', 'Meldung senden'], ['devices', 'Geräte'], ['enroll', 'Registrierung'], ['api', 'Schnittstellen'], ['rules', 'Regeln'], ['ai', 'KI & Besuche'], ['ops', 'Störungen & Neustarts'], ['dex', 'Mitarbeiter-Erlebnis'], ['kb', 'Wissen (SharePoint)'], ['youtube', 'YouTube'], ['music', 'Musikwünsche'], ['security', 'Sicherheit & Quiz'], ['audit', 'Protokoll']];
  function shell(content) {
    const nav = el('nav', { class: 'side', 'aria-label': 'Bereiche' },
      el('p', { class: 'brand' }, el('img', { src: BASE + '/icon.png', alt: '' }), el('span', {}, el('span', { text: 'sudo' }), ' zentrale')),
      ...NAV.map(([k, l]) => el('button', { 'aria-selected': String(view === k), text: l, on: { click: () => go(k) } })),
      el('div', { class: 'me' }, el('b', { text: me.name }), el('span', { text: me.via === 'entra' ? 'Microsoft-Konto' : 'Notfall-Zugang' }), ' · ',
        el('a', { href: '#', text: 'Abmelden', on: { click: async e => { e.preventDefault(); await api('POST', '/auth/logout', {}); location.reload(); } } })));
    app.className = 'shell';
    app.replaceChildren(nav, el('main', { class: 'content' }, content));
  }
  async function go(v) {
    view = v; location.hash = v;
    try { shell(await VIEWS[v]()); } catch (e) { if (me) shell(el('p', { class: 'msg bad', text: e.message })); }
  }

  /* ---------- Ansichten ---------- */
  const VIEWS = {
    async home() {
      const d = await api('GET', '/admin/api/dashboard');
      const pct = d.aiMonth.budgetUsd ? Math.min(100, d.aiMonth.usd / d.aiMonth.budgetUsd * 100) : 0;
      return el('div', {},
        el('h2', { text: 'Übersicht' }), el('p', { class: 'sub', text: me.transport === 'poll' ? `Erreichbar unter ${me.publicUrl}. Die Sudos fragen alle ${me.pollSec} Sekunden nach neuen Meldungen (Webspace-Version).` : `Erreichbar unter ${me.publicUrl}. Sudos verbinden sich per WebSocket und bekommen Meldungen sofort.` }),
        el('div', { class: 'kpis' },
          el('div', { class: 'kpi' }, el('small', { text: 'Sudos online' }), el('b', { text: `${d.online}` }), el('i', { text: `von ${d.devices} angemeldeten` })),
          el('div', { class: 'kpi' }, el('small', { text: 'KI-Fragen heute' }), el('b', { text: String(d.aiToday.q) }), el('i', { text: usd(d.aiToday.usd) })),
          el('div', { class: 'kpi' }, el('small', { text: 'KI diesen Monat' }), el('b', { text: usd(d.aiMonth.usd) }),
            el('i', { text: d.aiMonth.budgetUsd ? `von ${usd(d.aiMonth.budgetUsd)} Budget` : 'ohne Monatsbudget' }), d.aiMonth.budgetUsd ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null),
          d.health ? el('div', { class: 'kpi' }, el('small', { text: 'Gerätezustand' }), el('b', { text: `${d.health.ok} in Ordnung` }),
            el('i', { text: `${d.health.warn} ansehen · ${d.health.bad} mit Problem · ${d.health.unknown} ohne Angabe` })) : null),
        card('Letzte Meldungen', messagesTable(d.messages, false)),
        el('div', { class: 'row' }, action('Meldung senden …', () => go('send'), 'primary'), action('Sudo registrieren …', () => go('enroll'))));
    },

    async send() {
      let type = 'message';
      const target = el('select', { 'aria-label': 'Empfänger' });
      const devs = await api('GET', '/admin/api/devices');
      const groups = [...new Set(devs.flatMap(d => String(d.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      target.append(el('option', { value: 'all', text: `Alle Sudos (${devs.length})` }),
        ...groups.map(g => el('option', { value: 'group:' + g, text: `Gruppe: ${g} (${devs.filter(d => String(d.groups).split(',').map(x => x.trim()).includes(g)).length})` })),
        ...[...new Set(devs.map(d => d.upn).filter(Boolean))].sort().map(u => el('option', { value: 'user:' + u, text: `Person: ${u} (${devs.filter(d => d.upn === u).length})` })),
        ...devs.map(d => el('option', { value: 'device:' + d.id, text: `Gerät: ${d.name}${d.user ? ' – ' + d.user : ''}${d.online ? ' ●' : ''}` })));
      const ttl = el('select', { 'aria-label': 'Haltbarkeit' }, ...[[60, '1 Stunde'], [480, '8 Stunden'], [1440, '1 Tag'], [4320, '3 Tage'], [10080, '7 Tage']].map(([v, l]) => el('option', { value: v, text: l, selected: v === 1440 })));
      const show = el('select', { 'aria-label': 'Anzeigedauer' }, ...[['15', '15 Sekunden (Standard)'], ['30', '30 Sekunden'], ['60', '1 Minute'], ['120', '2 Minuten'], ['klick', 'Bis zum Wegklicken']]
        .map(([v, l]) => el('option', { value: v, text: l })));
      const fieldsBox = el('div', { class: 'grid2' });
      const inputs = {};
      const typeBtns = el('div', { class: 'types', role: 'group', 'aria-label': 'Art der Meldung' });
      const drawFields = () => {
        fieldsBox.replaceChildren();
        for (const k of Object.keys(inputs)) delete inputs[k];
        for (const [k, label, kind] of TYPES[type].fields) {
          const inp = kind === 'textarea' ? el('textarea', { maxlength: 240 }) : el('input', { type: 'text', maxlength: 240 });
          inputs[k] = inp;
          fieldsBox.append(el('label', { class: 'f' + (kind === 'textarea' ? '' : '') }, label, inp));
        }
        if (!TYPES[type].fields.length) fieldsBox.append(el('p', { class: 'muted', text: 'Ein Bug krabbelt über den Bildschirm – zum Auflockern.' }));
        typeBtns.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === type)));
      };
      for (const [k, t] of Object.entries(TYPES)) if (!t.hidden) typeBtns.append(el('button', { type: 'button', 'data-t': k, text: t.label, on: { click: () => { type = k; drawFields(); } } }));
      drawFields();
      const msg = el('div', { class: 'msg' });
      return el('div', {},
        el('h2', { text: 'Meldung senden' }),
        el('p', { class: 'sub', text: 'Sudo zeigt die Meldung als Sprechblase mit passender Reaktion. Geräte, die gerade offline sind, bekommen sie beim nächsten Verbinden – solange sie haltbar ist.' }),
        card('Art', typeBtns),
        card('Inhalt', fieldsBox),
        card('Empfänger', el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'An', target), el('label', { class: 'f' }, 'Sprechblase zeigen', show), el('label', { class: 'f' }, 'Haltbar für Offline-Geräte', ttl)),
          el('p', { class: 'muted', text: 'Gilt für Mitteilungen und Warnungen. Lange Blasen lassen sich per Klick schließen; dringende Meldungen des Sudo gehen kurz vor und danach erscheint die Mitteilung wieder.' })),
        el('div', { class: 'row' }, action('Senden', async () => {
          const event = {};
          for (const [k, inp] of Object.entries(inputs)) if (inp.value.trim()) event[k] = inp.value.trim();
          if (event.link && !/^https:\/\//.test(event.link)) throw new Error('Der Link muss mit https:// beginnen.');
          if (type === 'message' || type === 'warning') event.dur = show.value;
          const r = await api('POST', '/admin/api/messages', { type, event, target: target.value, ttlMin: Number(ttl.value) });
          msg.textContent = me.transport === 'poll' ? `Gesendet an ${r.targets} Empfänger – ${r.sentNow} davon sind online und haben sie in spätestens ${me.pollSec} Sekunden.` : `Gesendet: ${r.sentNow} sofort zugestellt, ${r.targets} Empfänger insgesamt.`;
          for (const inp of Object.values(inputs)) inp.value = '';
        }, 'primary'), msg),
        card('Zuletzt gesendet', messagesTable((await api('GET', '/admin/api/messages')).slice(0, 15), true)));
    },

    // 1.9: Ressourcen und Stabilität des Clients
    async devices() {
      const diagCell = d => {
        const g = d.diag;
        if (!g) return null;
        const bad = g.crashes > 0 || g.errors > 0;
        return el('div', { class: 'muted diag', title: g.last ? 'Letzter Fehler: ' + g.last : 'Keine Fehler in den letzten 24 Stunden' },
          g.cpu != null ? `CPU ${g.cpu} % · ${g.ram} MB` : '',
          bad ? el('span', { class: 'pill ' + (g.crashes ? 'bad' : 'warn'), text: [g.crashes ? `${g.crashes}× neu gestartet` : '', g.errors ? `${g.errors} Fehler` : ''].filter(Boolean).join(' · ') }) : null);
      };
      const devs = await api('GET', '/admin/api/devices');
      const rows = devs.map(d => {
        const groups = el('input', { type: 'text', value: d.groups || '', 'aria-label': 'Gruppen', placeholder: 'z. B. IT, Büro' });
        const budget = el('input', { type: 'number', min: 0, value: d.aiDailyCents ?? '', 'aria-label': 'KI-Budget pro Tag in Cent', placeholder: 'Standard' });
        return el('tr', {},
          el('td', {}, el('span', { class: 'dot' + (d.online ? ' on' : '') }), el('b', { text: d.name }), el('div', { class: 'muted', text: [d.user, d.upn, d.host !== d.name ? d.host : ''].filter(Boolean).join(' · ') })),
          el('td', {}, el('span', { class: 'mono', text: d.version || '–' }), el('div', { class: 'muted', text: (d.lang || '').toUpperCase() }), diagCell(d)),
          el('td', { text: d.online ? 'online' : ago(d.lastSeen) }),
          el('td', {}, healthCell(d.health)),
          el('td', {}, groups),
          el('td', { class: 'num' }, budget, el('div', { class: 'muted', text: `heute ${d.aiToday.q} · ${usd(d.aiToday.usd)}` })),
          el('td', {}, el('div', { class: 'row' },
            action('Speichern', async () => { await api('PATCH', '/admin/api/devices/' + d.id, { groups: groups.value, aiDailyCents: budget.value === '' ? null : Number(budget.value) }); toast('Gespeichert.'); }, 'small'),
            action('Sperren', async () => { if (!confirm(`„${d.name}“ wirklich sperren? Der Sudo muss danach neu registriert werden.`)) return; await api('DELETE', '/admin/api/devices/' + d.id); go('devices'); }, 'small danger'))));
      });
      return el('div', {},
        el('h2', { text: 'Geräte' }),
        el('p', { class: 'sub', text: 'Jeder registrierte Sudo. Gruppen (Komma-getrennt) helfen beim gezielten Senden. Ein leeres KI-Budget nutzt den Standard aus „KI & Budget“.' }),
        card(null, devs.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Gerät', 'Version', 'Zuletzt', 'Zustand', 'Gruppen', 'KI-Budget/Tag (ct)', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, rows))) : el('p', { class: 'empty', text: 'Noch kein Sudo registriert. Unter „Registrierung“ einen Code erzeugen.' })));
    },

    async enroll() {
      const codes = await api('GET', '/admin/api/enroll-codes');
      const label = el('input', { type: 'text', placeholder: 'z. B. Intune-Rollout November', maxlength: 60 });
      const groups = el('input', { type: 'text', placeholder: 'z. B. Büro', maxlength: 200 });
      const days = el('select', {}, ...[[0, 'unbegrenzt'], [1, '1 Tag'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage']].map(([v, l]) => el('option', { value: v, text: l, selected: v === 30 })));
      const uses = el('input', { type: 'number', min: 1, placeholder: 'unbegrenzt' });
      const out = el('div');
      let tbl = codesTable(codes);
      return el('div', {},
        el('h2', { text: 'Registrierung' }),
        el('p', { class: 'sub', text: 'Ein Sudo meldet sich einmalig mit einem Code an und bekommt danach einen eigenen Schlüssel. Codes kannst du per Intune verteilen (siehe LIESMICH) oder einzeln weitergeben.' }),
        card('Neuer Code',
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Bezeichnung', label), el('label', { class: 'f' }, 'Gruppen für neue Geräte', groups),
            el('label', { class: 'f' }, 'Gültig', days), el('label', { class: 'f' }, 'Wie oft nutzbar', uses)),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Code erzeugen', async () => {
            const r = await api('POST', '/admin/api/enroll-codes', { label: label.value, groups: groups.value, days: Number(days.value), uses: uses.value });
            out.replaceChildren(secretBox('Registrierungscode', r.code, 'Wird nur jetzt angezeigt. Im Sudo: Einstellungen → Daten & Verbindungen → Sudo-Zentrale.'));
            const list = await api('GET', '/admin/api/enroll-codes'); tbl.replaceWith(tbl = codesTable(list));
          }, 'primary')), out),
        card('Aktive Codes', tbl),
        card('Adresse für die Sudos', el('pre', { class: 'code', text: me.publicUrl })));
    },

    async api() {
      const keys = await api('GET', '/admin/api/api-keys');
      const name = el('input', { type: 'text', placeholder: 'z. B. Backup-Prüfung', maxlength: 60 });
      const out = el('div');
      let activeBox;
      const keyTable = list => list.length ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['Name', 'Beginnt mit', 'Angelegt', 'Zuletzt benutzt', 'Aufrufe', ''].map(h => el('th', { text: h })))),
        el('tbody', {}, list.map(k => el('tr', {}, el('td', { text: k.name }), el('td', { class: 'mono', text: k.prefix + '…' }), el('td', { text: fmtDate(k.created) }), el('td', { text: ago(k.lastUsed) }), el('td', { class: 'num', text: k.uses }),
          el('td', {}, action('Widerrufen', async () => { if (!confirm(`Schlüssel „${k.name}“ widerrufen?`)) return; await api('DELETE', '/admin/api/api-keys/' + k.id); go('api'); }, 'small danger'))))))
        : el('p', { class: 'empty', text: 'Noch kein Schlüssel.' });
      activeBox = el('div', {}, keyTable(keys));
      const curl = `curl -X POST ${me.publicUrl}/api/events \\\n  -H "Authorization: Bearer szk_…" -H "Content-Type: application/json" \\\n  -d '{"type":"backup_failed","kunde":"Muster GmbH","target":"group:IT"}'`;
      const php = `<?php\n$ch = curl_init('${me.publicUrl}/api/events');\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5,\n  CURLOPT_HTTPHEADER => ['Authorization: Bearer szk_…', 'Content-Type: application/json'],\n  CURLOPT_POSTFIELDS => json_encode(['type' => 'server_down', 'host' => 'web01', 'text' => 'Ping weg']),\n]);\ncurl_exec($ch);`;
      return el('div', {},
        el('h2', { text: 'Schnittstellen' }),
        el('p', { class: 'sub', text: 'Skripte (Backup-Prüfung, Monitoring, Deploy) schicken Ereignisse an die Zentrale; die verteilt sie sofort an die Sudos. Ersetzt das alte PHP-Relay.' }),
        card('Neuer API-Schlüssel', el('div', { class: 'row' }, name, action('Erzeugen', async () => {
          const r = await api('POST', '/admin/api/api-keys', { name: name.value });
          out.replaceChildren(secretBox('API-Schlüssel', r.key, 'Wird nur jetzt angezeigt. Im Skript als Bearer-Token verwenden.'));
          name.value = '';
          activeBox.replaceChildren(keyTable(await api('GET', '/admin/api/api-keys')));   // Liste sofort aktualisieren
        }, 'primary')), out),
        card('Aktive Schlüssel', activeBox),
        card('Beispiel: curl', el('pre', { class: 'code', text: curl })),
        card('Beispiel: PHP', el('pre', { class: 'code', text: php })),
        card('Ereignisse', el('p', { class: 'muted', text: 'type: backup_failed (kunde) · server_down (host, text) · warning (text, link) · message (text, link) · success (text) · deploy_ok (version) · ticket (ticket, titel) · bug. Optional: target = all | group:<Name> | device:<Name> | user:<Anmeldename/E-Mail>, ttl_min = Haltbarkeit in Minuten, dur = Anzeigedauer in Sekunden oder "klick". Ausführliche Anleitung (auch für n8n): API-ANLEITUNG.md im Zentrale-Ordner.' })));
    },

    // 1.8: YouTube-Kanäle – neue Videos erscheinen bei den Sudos
    // 1.9: Wissen & Anleitungen aus SharePoint
    async kb() {
      const d = await api('GET', '/admin/api/kb');
      const sel = (opts, cur) => el('select', {}, ...opts.map(([v, l]) => el('option', { value: v, text: l, selected: String(cur) === String(v) })));
      const tenant = el('input', { type: 'text', maxlength: 100, value: d.tenant, placeholder: d.fallback ? 'aus der Anmeldung (config.php)' : 'firma.onmicrosoft.com oder Tenant-ID' });
      const cid = el('input', { type: 'text', maxlength: 40, value: d.clientId, placeholder: d.fallback ? 'aus der Anmeldung (config.php)' : 'Application (client) ID' });
      const sec = el('input', { type: 'password', maxlength: 200, placeholder: d.secretSet ? '•••••• (gespeichert – nur zum Ändern ausfüllen)' : d.fallback ? 'aus der Anmeldung (config.php)' : 'Client Secret (Wert, nicht die ID)' });
      const on = sel([['true', 'an'], ['false', 'aus']], d.enabled), ai = sel([['true', 'ja'], ['false', 'nein']], d.ai);
      const every = sel([['30', 'alle 30 Minuten'], ['60', 'stündlich'], ['240', 'alle 4 Stunden'], ['1440', 'täglich']], d.interval);
      const url = el('input', { type: 'url', maxlength: 800, placeholder: 'https://firma.sharepoint.com/sites/IT/Freigegebene Dokumente/Anleitungen', style: 'flex:1' });
      const q = el('input', { type: 'search', maxlength: 200, placeholder: 'z. B. VPN geht nicht', style: 'flex:1' });
      const res = el('div');
      const KIND = { library: 'Bibliothek/Ordner', pages: 'Websiteseiten' };
      const runSearch = async () => {
        const r = await api('POST', '/admin/api/kb/search', { q: q.value });
        res.replaceChildren(r.items.length ? el('table', { class: 'tbl' }, el('tbody', {}, r.items.map(i => el('tr', {},
          el('td', {}, el('a', { href: i.url, target: '_blank', rel: 'noopener', text: i.title }), el('div', { class: 'muted', text: [i.source, i.path].filter(Boolean).join(' · ') }), i.snippet ? el('div', { class: 'muted kbsnip', text: i.snippet }) : null),
          el('td', { class: 'num muted', text: (i.ext || '').toUpperCase() + (q.value.length >= 2 ? ' · ' + i.score : '') }))))) : el('p', { class: 'empty', text: 'Nichts gefunden.' }),
          q.value.length >= 2 ? el('p', { class: 'muted', text: r.ai ? 'Frag Sudo bekommt bei dieser Frage passende Auszüge als Hintergrund.' : 'Für Frag Sudo ist hier kein Treffer stark genug.' }) : null);
      };
      return el('div', {},
        el('h2', { text: 'Wissen (SharePoint)' }),
        el('p', { class: 'sub', text: 'Eure Anleitungen bleiben in SharePoint. Die Zentrale liest nur Titel, Ordner und Text, damit Kollegen in Sudo danach suchen können – ein Klick öffnet das Original in SharePoint (mit den normalen Berechtigungen). Gelesen werden Word, PowerPoint, Text und Websiteseiten; PDFs und andere Dateien nur mit Namen.' }),
        card('1. Zugriff auf SharePoint',
          el('p', { class: 'muted' }, 'In Entra ID eine App-Registrierung anlegen (oder die der Zentrale-Anmeldung nutzen) und unter ', el('b', { text: 'API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen' }), ' die Berechtigung ', el('b', { text: 'Sites.Selected' }), ' hinzufügen und die Administratorzustimmung erteilen. Danach die App für die Website mit den Anleitungen freigeben (nur lesen), z. B. in PowerShell:'),
          el('pre', { class: 'code', text: 'Connect-MgGraph -Scopes Sites.FullControl.All\n$site = Get-MgSite -SiteId "firma.sharepoint.com:/sites/IT"\nNew-MgSitePermission -SiteId $site.Id -BodyParameter @{\n  roles = @("read")\n  grantedToIdentities = @(@{ application = @{ id = "<Client ID>"; displayName = "Sudo-Zentrale" } })\n}' }),
          el('p', { class: 'muted', text: 'Einfacher, aber weitreichender: „Sites.Read.All“ – dann darf die Zentrale alle Websites lesen.' }),
          el('p', { class: 'msg' }, el('b', { text: 'Automatisch: ' }), 'Im Paket der Zentrale liegt ', el('code', { text: 'werkzeuge\\entra-setup\\Sudo-Entra-Setup.cmd' }),
            ' – auf einem Windows-PC doppelklicken. Es legt die App an, erteilt die Zustimmung, gibt die Websites frei, erzeugt das Geheimnis und trägt alles hier ein. Später auch zum Prüfen und Erneuern des Geheimnisses.'),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Tenant', tenant), el('label', { class: 'f' }, 'Client ID', cid), el('label', { class: 'f' }, 'Client Secret', sec)),
          el('div', { class: 'row', style: 'margin-top:10px' },
            action('Speichern', async () => { const b = { kb_tenant: tenant.value.trim(), kb_client_id: cid.value.trim() }; if (sec.value.trim()) b.kb_client_secret = sec.value.trim(); await api('PUT', '/admin/api/settings', b); toast('Gespeichert.'); go('kb'); }),
            action('Verbindung testen', async () => { await api('POST', '/admin/api/kb/test'); toast('Anmeldung bei Microsoft klappt.'); }),
            d.ready ? el('span', { class: 'pill ok', text: d.fallback ? 'nutzt die Anmelde-App' : 'eingerichtet' }) : el('span', { class: 'pill', text: 'noch nicht eingerichtet' }))),
        card('2. Quellen',
          d.sources.length ? el('table', { class: 'tbl' }, el('tbody', {}, d.sources.map(s => el('tr', {},
            el('td', {}, el('b', { text: s.title }), el('div', { class: 'muted', text: KIND[s.kind] || s.kind }), s.lastError ? el('div', { class: 'msg bad', text: s.lastError }) : null),
            el('td', { class: 'num' }, `${s.items} Einträge`, el('div', { class: 'muted', text: s.lastSync ? 'abgeglichen ' + fmtDate(s.lastSync) : 'noch nie' })),
            el('td', {}, el('div', { class: 'row' },
              action('Abgleichen', async () => { const r = await api('POST', `/admin/api/kb/sources/${s.id}/sync`); toast(`${r.items} Einträge, ${r.read} neu gelesen.`); go('kb'); }, 'small'),
              action(s.active ? 'Pausieren' : 'Aktivieren', async () => { await api('PATCH', '/admin/api/kb/sources/' + s.id, { active: !s.active }); go('kb'); }, 'small'),
              action('Entfernen', async () => { if (!confirm(`„${s.title}“ entfernen? In SharePoint bleibt alles, wie es ist.`)) return; await api('DELETE', '/admin/api/kb/sources/' + s.id); go('kb'); }, 'small danger'))))))) :
            el('p', { class: 'empty', text: 'Noch keine Quelle. Link zu einem Ordner, einer Dokumentbibliothek oder zu den Websiteseiten (…/SitePages) einfügen.' }),
          el('div', { class: 'row', style: 'margin-top:10px' }, url, action('Hinzufügen', async () => {
            const r = await api('POST', '/admin/api/kb/sources', { url: url.value.trim() });
            toast(r.ok ? `„${r.title}“: ${r.items} Einträge gefunden.` : `Hinzugefügt, aber: ${r.error}`, !r.ok); go('kb');
          }, 'primary')),
          el('p', { class: 'muted', text: `Insgesamt ${d.items} Einträge, davon ${d.withText} mit durchsuchbarem Text. Der Link aus der Adresszeile des Browsers reicht.` })),
        card('3. Einstellungen',
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'In Sudo anzeigen', on), el('label', { class: 'f' }, 'Abgleich', every), el('label', { class: 'f' }, 'Für „Frag Sudo“ nutzen', ai)),
          el('p', { class: 'muted', text: '„Frag Sudo“: Passen Anleitungen zur Frage, bekommt Claude kurze Auszüge davon (höchstens drei) und verlinkt sie in der Antwort.' }),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { kb_enabled: on.value, kb_interval: every.value, kb_ai: ai.value }); toast('Gespeichert. Die Sudos übernehmen es beim nächsten Abruf.'); go('kb');
          }, 'primary'))),
        card('Testsuche', el('div', { class: 'row' }, q, action('Suchen', runSearch, 'primary')), res));
    },

    async youtube() {
      const d = await api('GET', '/admin/api/youtube');
      const devs = await api('GET', '/admin/api/devices');
      const groups = [...new Set(devs.flatMap(x => String(x.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const tSel = cur => el('select', { 'aria-label': 'Für wen' }, el('option', { value: 'all', text: 'alle Sudos', selected: cur === 'all' }), ...groups.map(g => el('option', { value: 'group:' + g, text: 'Gruppe ' + g, selected: cur === 'group:' + g })));
      const inp = el('input', { type: 'text', maxlength: 200, placeholder: 'z. B. https://www.youtube.com/@ct3003 oder @heiseonline oder UC…' });
      const tgt = tSel('all');
      const shorts = el('input', { type: 'checkbox' });
      const on = el('select', {}, el('option', { value: 'true', text: 'an', selected: d.enabled }), el('option', { value: 'false', text: 'aus', selected: !d.enabled }));
      const every = el('select', {}, ...[[10, 'alle 10 Minuten'], [15, 'alle 15 Minuten'], [30, 'alle 30 Minuten'], [60, 'stündlich']].map(([v, l]) => el('option', { value: v, text: l, selected: d.interval === v })));
      const ttl = el('select', {}, ...[[120, '2 Stunden'], [480, '8 Stunden'], [1440, '1 Tag']].map(([v, l]) => el('option', { value: v, text: l, selected: d.ttl === v })));
      return el('div', {},
        el('h2', { text: 'YouTube' }),
        el('p', { class: 'sub', text: 'Neue Videos eurer Lieblings-Kanäle zeigt Sudo als Sprechblase – ein Klick öffnet das Video. Die Zentrale liest dafür die öffentlichen Kanal-Feeds, ein YouTube-Konto oder API-Schlüssel ist nicht nötig. Jeder kann die Videos in Sudo unter Einstellungen → Verhalten abschalten.' }),
        card(`Kanäle (${d.channels.length})`, d.channels.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Kanal', 'Für wen', 'Shorts', 'Gemeldet', 'Zuletzt geprüft', ''].map(h => el('th', { text: h })))),
          el('tbody', {}, d.channels.map(c => { const t = tSel(c.target); t.addEventListener('change', async () => { await api('PATCH', '/admin/api/youtube/' + c.id, { target: t.value }); toast('Gespeichert.'); });
            return el('tr', { class: c.active ? '' : 'off' },
              el('td', {}, el('b', { text: c.title }), el('div', { class: 'muted', text: c.handle || c.channelId }), c.lastError ? el('div', { class: 'msg bad', text: c.lastError }) : null),
              el('td', {}, t),
              el('td', {}, action(c.shorts ? 'mit Shorts' : 'ohne Shorts', async () => { await api('PATCH', '/admin/api/youtube/' + c.id, { shorts: !c.shorts }); go('youtube'); }, 'small')),
              el('td', { class: 'num', text: String(c.sent) }), el('td', { class: 'muted', text: c.lastCheck ? ago(c.lastCheck) : '–' }),
              el('td', {}, el('div', { class: 'row' }, action(c.active ? 'aktiv' : 'pausiert', async () => { await api('PATCH', '/admin/api/youtube/' + c.id, { active: !c.active }); go('youtube'); }, 'small'),
                action('Entfernen', async () => { if (!confirm(`„${c.title}“ entfernen?`)) return; await api('DELETE', '/admin/api/youtube/' + c.id); go('youtube'); }, 'small danger')))); }))))
          : el('p', { class: 'empty', text: 'Noch kein Kanal. Trag unten einen ein – gemeldet werden nur Videos, die danach erscheinen.' }),
          el('div', { class: 'qform' }, el('h4', { text: 'Kanal hinzufügen' }),
            el('label', { class: 'f' }, 'Kanal (Link, @Handle oder Kanal-ID)', inp),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Für wen', tgt), el('label', { class: 'f chk' }, shorts, ' Auch Shorts melden')),
            el('div', { class: 'row' }, action('Hinzufügen', async () => {
              const r = await api('POST', '/admin/api/youtube', { input: inp.value, target: tgt.value, shorts: shorts.checked });
              toast(`„${r.title}“ hinzugefügt.` + (r.latest ? ` Neuestes Video: ${r.latest.title}` : '')); go('youtube');
            }, 'primary'), action('Jetzt prüfen', async () => { const r = await api('POST', '/admin/api/youtube/check'); toast(`${r.checked} Kanäle geprüft, ${r.new} neue Videos.`); go('youtube'); })))),
        d.videos.length ? card('Zuletzt gemeldet', el('table', { class: 'tbl' }, el('tbody', {}, d.videos.map(v => el('tr', {},
          el('td', {}, el('a', { href: 'https://www.youtube.com/watch?v=' + v.id, target: '_blank', rel: 'noopener', text: v.title })), el('td', { class: 'muted', text: v.channel }), el('td', { class: 'muted', text: fmtDate(v.sent) })))))) : null,
        card('Einstellungen', el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'YouTube-Meldungen', on), el('label', { class: 'f' }, 'Prüfen', every), el('label', { class: 'f' }, 'Haltbarkeit', ttl)),
          el('p', { class: 'muted', text: 'Die Zentrale prüft die Kanäle von selbst – ein Zeitplaner (Cron) ist nicht nötig.' }),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => { await api('PUT', '/admin/api/settings', { youtube_enabled: on.value, youtube_interval: every.value, youtube_ttl: ttl.value }); toast('Gespeichert.'); }, 'primary'))));
    },

    // 1.8: Musikwünsche – Spotify-Konto der Firma, Wiedergabe z. B. auf dem Echo im Büro
    async music() {
      const d = await api('GET', '/admin/api/music');
      const devs = await api('GET', '/admin/api/devices');
      const m = d.settings;
      const q = new URLSearchParams(location.search);
      if (q.get('spotify')) { toast(q.get('spotify') === 'verbunden' ? 'Spotify verbunden.' : q.get('spotify'), q.get('spotify') !== 'verbunden'); history.replaceState(null, '', location.pathname + '#music'); }
      const groups = [...new Set(devs.flatMap(x => String(x.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const sel = (opts, cur) => el('select', {}, ...opts.map(([v, l]) => el('option', { value: v, text: l, selected: String(cur) === String(v) })));
      const on = sel([['true', 'an'], ['false', 'aus']], m.enabled);
      const tgt = sel([['all', 'alle Sudos'], ...groups.map(g => ['group:' + g, 'Gruppe ' + g])], m.target);
      const cost = el('input', { type: 'number', min: 0, max: 5000, value: m.cost });
      const per = el('input', { type: 'number', min: 1, max: 20, value: m.perDay });
      const gap = el('input', { type: 'number', min: 0, max: 120, value: m.gapMin });
      const from = el('input', { type: 'time', value: m.from }), to = el('input', { type: 'time', value: m.to });
      const expl = sel([['false', 'gesperrt'], ['true', 'erlaubt']], m.explicit);
      const ann = sel([['name', 'mit Namen'], ['anon', 'ohne Namen'], ['off', 'gar nicht']], m.announce);
      const cid = el('input', { type: 'text', maxlength: 64, value: m.clientId, placeholder: 'Client ID aus developer.spotify.com' });
      const sec = el('input', { type: 'password', maxlength: 64, placeholder: m.secretSet ? '•••••• (gespeichert – nur zum Ändern ausfüllen)' : 'Client Secret' });
      const devSel = el('select', { 'aria-label': 'Lautsprecher' }, el('option', { value: '', text: d.devices.length ? '– Lautsprecher wählen –' : 'keine Geräte gefunden' }),
        ...d.devices.map(x => el('option', { value: x.id, text: `${x.name} (${x.type})${x.active ? ' · spielt gerade' : ''}`, selected: x.id === m.deviceId })));
      if (m.deviceId && !d.devices.some(x => x.id === m.deviceId)) devSel.append(el('option', { value: m.deviceId, text: `${m.deviceName} (gerade nicht sichtbar)`, selected: true }));
      const STAT = { playing: ['läuft gerade', 'ok'], queued: ['Platz {n} in der Warteschlange', 'ok'], played: ['gespielt', ''], requested: ['gewünscht', ''],
        vetoed: ['gesperrt – wird übersprungen', 'warn'], skipped: ['gesperrt · übersprungen', 'bad'], failed: ['fehlgeschlagen', 'bad'] };
      const statPill = r => { const s = STAT[r.status] || [r.status, '']; return el('span', { class: 'pill ' + s[1], text: s[0].replace('{n}', r.pos || '?') }); };
      const veto = r => action('Sperren', async () => {
        if (!confirm(`„${r.title}“ sperren?\n\nDer Titel wird übersprungen, sobald er läuft, und kann nicht mehr gewünscht werden.`)) return;
        const x = await api('POST', '/admin/api/music/veto/' + r.id); toast(x.skippedNow ? 'Gesperrt und sofort übersprungen.' : 'Gesperrt – wird übersprungen, sobald er dran ist.'); go('music');
      }, 'small danger');
      const skipBtn = action('Aktuellen Titel überspringen', async () => { await api('POST', '/admin/api/music/skip'); toast('Übersprungen.'); setTimeout(() => go('music'), 800); }, 'small');
      return el('div', {},
        el('h2', { text: 'Musikwünsche' }),
        el('p', { class: 'sub', text: 'Kollegen wünschen sich in Sudo einen Song und bezahlen mit XP – der Titel kommt in die Spotify-Warteschlange eures Büro-Lautsprechers (z. B. der Alexa). Die Zentrale hält die Spotify-Anmeldung; die PCs bekommen nie Zugangsdaten.' }),
        card('1. Spotify verbinden',
          el('p', { class: 'muted', text: 'Einmalig: Auf developer.spotify.com mit dem Büro-Konto (Spotify Premium) eine App anlegen und als Redirect URI genau diese Adresse eintragen:' }),
          el('div', { class: 'row' }, el('code', { text: d.redirectUri }), action('Kopieren', async () => { await navigator.clipboard.writeText(d.redirectUri); toast('Kopiert.'); }, 'small')),
          el('div', { class: 'grid2', style: 'margin-top:10px' }, el('label', { class: 'f' }, 'Client ID', cid), el('label', { class: 'f' }, 'Client Secret', sec)),
          el('div', { class: 'row', style: 'margin-top:10px' },
            action('Speichern', async () => { const b = { spotify_client_id: cid.value.trim() }; if (sec.value.trim()) b.spotify_client_secret = sec.value.trim(); await api('PUT', '/admin/api/settings', b); toast('Gespeichert.'); go('music'); }),
            m.clientId && m.secretSet ? el('a', { class: 'btn primary', href: BASE + '/admin/spotify/login', text: m.connected ? 'Neu verbinden' : 'Mit Spotify verbinden' }) : null,
            m.connected ? el('span', { class: 'pill ok', text: 'verbunden: ' + m.account }) : el('span', { class: 'pill', text: 'nicht verbunden' }),
            m.connected ? action('Trennen', async () => { if (!confirm('Spotify trennen?')) return; await api('POST', '/admin/api/music/disconnect'); go('music'); }, 'small danger') : null),
          d.error ? el('p', { class: 'msg bad', text: d.error }) : null),
        m.connected ? card('2. Lautsprecher',
          el('p', { class: 'muted', text: 'Damit der Echo hier erscheint: In der Alexa-App Spotify als Musikdienst verknüpfen und einmal Musik über Spotify auf dem Echo abspielen. Wünsche landen in der Warteschlange – es muss also gerade Spotify laufen.' }),
          el('div', { class: 'row' }, devSel, action('Übernehmen', async () => {
            const opt = devSel.selectedOptions[0];
            await api('PUT', '/admin/api/settings', { spotify_device_id: devSel.value, spotify_device_name: devSel.value ? opt.text.replace(/ \(.*$/, '') : '' }); toast('Gespeichert.'); go('music');
          }, 'primary'), action('Aktualisieren', () => go('music'))),
          d.playing ? el('div', { class: 'row', style: 'margin-top:8px' }, el('span', {}, el('b', { text: d.playing.isPlaying ? 'Läuft gerade: ' : 'Pausiert: ' }), `${d.playing.name} – ${d.playing.artist}`, el('span', { class: 'muted', text: ` (${d.playing.device})` })), skipBtn)
            : el('p', { class: 'muted', text: 'Gerade läuft nichts über Spotify.' }),
          d.queue && d.queue.queue.length ? el('details', { style: 'margin-top:8px' }, el('summary', { text: `Als Nächstes bei Spotify (${d.queue.queue.length})` }),
            el('ol', { class: 'mq' }, ...d.queue.queue.map(t => el('li', {}, el('b', { text: t.name }), el('span', { class: 'muted', text: ' – ' + t.artist }))))) : null) : null,
        card('3. Spielregeln',
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Musikwünsche', on), el('label', { class: 'f' }, 'Wer darf wünschen', tgt), el('label', { class: 'f' }, 'Kosten pro Song (XP)', cost)),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Wünsche pro Person und Tag', per), el('label', { class: 'f' }, 'Abstand zwischen zwei Wünschen (min, für alle)', gap), el('label', { class: 'f' }, 'Explicit-Titel', expl)),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Von', from), el('label', { class: 'f' }, 'Bis', to), el('label', { class: 'f' }, 'Wunsch bei allen ansagen', ann)),
          el('p', { class: 'muted', text: 'XP sammelt jeder in Sudo (Tippen, Bugs, Pausen, Quiz …). Ein Wunsch zieht die XP ab, der Rang kann dadurch sinken – Garderoben-Teile bleiben.' }),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { music_enabled: on.value, music_target: tgt.value, music_cost: String(cost.value), music_per_day: String(per.value), music_gap_min: String(gap.value),
              music_from: from.value, music_to: to.value, music_explicit: expl.value, music_announce: ann.value });
            toast('Gespeichert. Die Sudos übernehmen es beim nächsten Abruf.'); go('music');
          }, 'primary'))),
        card(`Wünsche · heute ${d.today}`, d.recent.length ? el('table', { class: 'tbl' }, el('tbody', {}, d.recent.map(r => el('tr', {},
          el('td', { class: 'muted', text: fmtDate(r.at) }), el('td', {}, el('b', { text: r.title }), el('div', { class: 'muted', text: r.artist })), el('td', { text: r.from }),
          el('td', {}, statPill(r), r.msg ? el('div', { class: 'muted', text: r.msg }) : null),
          el('td', { class: 'num' }, ['playing', 'queued', 'requested'].includes(r.status) ? veto(r) : null))))) : el('p', { class: 'empty', text: 'Noch keine Wünsche.' }),
          el('p', { class: 'muted', text: 'Spotify erlaubt nicht, einzelne Titel aus der Warteschlange zu löschen. „Sperren“ überspringt den Titel deshalb automatisch, sobald er läuft (die Zentrale schaut alle paar Sekunden nach, solange Sudos online sind), und setzt ihn auf die Sperrliste. Die XP bekommt der Wünschende nicht zurück.' })),
        card('Gesperrte Titel', d.blocked && d.blocked.length ? el('table', { class: 'tbl' }, el('tbody', {}, d.blocked.map(b => el('tr', {},
          el('td', {}, el('b', { text: b.title }), el('div', { class: 'muted', text: b.artist })), el('td', { class: 'muted', text: `${fmtDate(b.at)} · ${b.by || ''}` }),
          el('td', { class: 'num' }, action('Entsperren', async () => { await api('DELETE', '/admin/api/music/blocked/' + encodeURIComponent(b.trackId)); toast('Entsperrt.'); go('music'); }, 'small')))))) :
          el('p', { class: 'empty', text: 'Keine. Gesperrte Titel tauchen in der Suche der Kollegen nicht mehr auf.' })));
    },

    // 1.7: Regeln – eingehende Meldungen der Schnittstelle einordnen
    async rules(editId) {
      const d = await api('GET', '/admin/api/rules');
      const devs = await api('GET', '/admin/api/devices');
      const edit = d.rules.find(r => r.id === editId) || null;
      const ACT = { backup_failed: 'Backup fehlgeschlagen', server_down: 'Server down', warning: 'Warnung', message: 'Mitteilung', success: 'Erfolg', deploy_ok: 'Deploy erfolgreich', ticket: 'Ticket', drop: 'verwerfen (nicht anzeigen)' };
      const NAMEFIELD = { backup_failed: 'Kunde / Job', server_down: 'Server', deploy_ok: 'Version' };
      const EXT = { rest: 'Rest des Titels (erkannte Wörter fallen weg)', paren: 'Text in Klammern am Ende', regex: 'erste Klammer-Gruppe des Ausdrucks', whole: 'ganzer Titel' };
      const opt = (v, l, cur) => el('option', { value: v, text: l, selected: String(cur ?? '') === String(v) });
      const groups = [...new Set(devs.flatMap(x => String(x.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const people = [...new Set(devs.map(x => x.upn).filter(Boolean))].sort();
      const pretty = r => r.mode === 'regex' ? 'Ausdruck: ' + r.pattern : r.pattern.split(',').map(g => g.split('|').map(w => w.trim()).filter(Boolean).join(' / ')).filter(Boolean).join('  UND  ');
      const e = edit || { name: '', matchType: '', field: 'title', mode: 'words', pattern: '', action: 'backup_failed', extract: 'rest', target: '', dur: '', ttl: null, linkTpl: '', active: true };
      // Formular
      const fName = el('input', { type: 'text', maxlength: 80, value: e.name, placeholder: 'z. B. Backup fehlgeschlagen' });
      const fType = el('select', {}, opt('', 'alle Meldungsarten', e.matchType), ...Object.entries(TYPES).filter(([, t]) => !t.hidden).map(([k, t]) => opt(k, 'nur ' + t.label, e.matchType)));
      const fMode = el('select', {}, opt('words', 'Wörter', e.mode), opt('regex', 'regulärer Ausdruck (für Profis)', e.mode));
      const fPattern = el('textarea', { rows: 2, maxlength: 500, placeholder: 'backup|datensicherung, failed|fehlgeschlagen|error' }); fPattern.value = e.pattern;
      const fField = el('select', {}, opt('title', 'im Titel bzw. Text', e.field), opt('any', 'in allen Feldern', e.field));
      const fAction = el('select', {}, ...Object.entries(ACT).map(([k, l]) => opt(k, l, e.action)));
      const fExtract = el('select', {}, ...Object.entries(EXT).map(([k, l]) => opt(k, l, e.extract)));
      const fTarget = el('select', {}, opt('', 'wie gesendet', e.target), opt('all', 'alle Sudos', e.target), ...groups.map(g => opt('group:' + g, 'Gruppe ' + g, e.target)), ...people.map(u => opt('user:' + u, u, e.target)));
      const fDur = el('select', {}, opt('', 'wie gesendet', e.dur), ...[['15', '15 Sekunden'], ['30', '30 Sekunden'], ['60', '1 Minute'], ['120', '2 Minuten'], ['klick', 'bis zum Wegklicken']].map(([v, l]) => opt(v, l, e.dur)));
      const fTtl = el('select', {}, opt('', 'wie gesendet', e.ttl), ...[[60, '1 Stunde'], [480, '8 Stunden'], [1440, '1 Tag'], [4320, '3 Tage']].map(([v, l]) => opt(v, l, e.ttl)));
      const fLink = el('input', { type: 'url', maxlength: 300, value: e.linkTpl, placeholder: 'leer = Ticket-Link von oben' });
      const nameHint = el('small', { class: 'muted' });
      const sync = () => { nameHint.textContent = NAMEFIELD[fAction.value] ? `→ landet im Feld „${NAMEFIELD[fAction.value]}“` : fAction.value === 'drop' ? '' : '→ Text der Meldung'; };
      fAction.addEventListener('change', sync); sync();
      const body = () => ({ name: fName.value, matchType: fType.value, mode: fMode.value, pattern: fPattern.value, field: fField.value, action: fAction.value, extract: fExtract.value,
        target: fTarget.value, dur: fDur.value, ttl: fTtl.value === '' ? null : Number(fTtl.value), linkTpl: fLink.value, active: e.active !== false });
      // Ausprobieren
      const tType = el('select', {}, ...Object.entries(TYPES).filter(([, t]) => !t.hidden && t.fields.length).map(([k, t]) => opt(k, t.label, 'ticket')));
      const tTitle = el('input', { type: 'text', maxlength: 240, value: 'Datensicherung Failed Muster GmbH', placeholder: 'Titel bzw. Text' });
      const tNo = el('input', { type: 'text', maxlength: 20, value: '4711', placeholder: 'Ticket-Nr. (optional)' });
      const tOut = el('div', { class: 'testout', role: 'status' });
      const runTest = async () => {
        const ty = tType.value, main = (TYPES[ty].fields.find(f => f[0] === 'titel' || f[0] === 'text' || f[0] === 'kunde' || f[0] === 'host' || f[0] === 'version') || ['text'])[0];
        const ev = { type: ty, [main]: tTitle.value }; if (tNo.value.trim()) ev.ticket = tNo.value.trim();
        const r = await api('POST', '/admin/api/rules/test', { event: ev });
        tOut.replaceChildren(r.rule
          ? el('div', {}, el('b', { text: `Regel „${r.rule.name}“ greift → ` }), r.dropped ? el('span', { class: 'pill bad', text: 'wird verworfen' }) : el('span', { class: 'pill teal', text: (TYPES[r.out.type] || {}).label || r.out.type }),
            r.out ? el('dl', { class: 'kv' }, ...Object.entries(r.out).filter(([k]) => k !== 'type').flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })])) : null)
          : el('div', {}, el('b', { text: 'Keine Regel greift' }), ' – die Meldung bleibt, wie sie ist (', el('span', { class: 'pill teal', text: TYPES[ty].label }), ').'));
      };
      const rows = d.rules.map((r, i) => el('tr', { class: r.active ? '' : 'off' },
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', {}, el('b', { text: r.name }), el('div', { class: 'muted', text: (r.matchType ? 'nur ' + ((TYPES[r.matchType] || {}).label || r.matchType) + ' · ' : '') + pretty(r) })),
        el('td', {}, el('span', { class: 'pill ' + (r.action === 'drop' ? 'bad' : 'teal'), text: ACT[r.action] || r.action }), r.action !== 'drop' && NAMEFIELD[r.action] ? el('div', { class: 'muted', text: `${NAMEFIELD[r.action]}: ${EXT[r.extract].split(' (')[0]}` }) : null,
          r.target ? el('div', { class: 'muted', text: 'an ' + r.target.replace(/^group:/, 'Gruppe ').replace(/^user:/, '') }) : null),
        el('td', { class: 'num' }, el('b', { text: String(r.hits) }), el('div', { class: 'muted', text: r.lastHit ? ago(r.lastHit) : '–' })),
        el('td', {}, el('div', { class: 'row' },
          action(r.active ? 'aktiv' : 'aus', async () => { await api('PATCH', '/admin/api/rules/' + r.id, { active: !r.active }); go('rules'); }, 'small'),
          action('↑', async () => { await api('PATCH', '/admin/api/rules/' + r.id, { move: -1 }); go('rules'); }, 'small'),
          action('↓', async () => { await api('PATCH', '/admin/api/rules/' + r.id, { move: 1 }); go('rules'); }, 'small'),
          action('Bearbeiten', async () => { shell(await VIEWS.rules(r.id)); }, 'small'),
          action('Löschen', async () => { if (!confirm(`Regel „${r.name}“ löschen?`)) return; await api('DELETE', '/admin/api/rules/' + r.id); go('rules'); }, 'small danger')))));
      const tl = el('input', { type: 'url', maxlength: 300, value: d.ticketLink, placeholder: 'https://firma.rmmservice.eu/#/ticketing/ticket/{ticket}' });
      return el('div', {},
        el('h2', { text: 'Regeln' }),
        el('p', { class: 'sub', text: 'Die Zentrale ordnet Meldungen der Schnittstelle selbst ein: Kommt z. B. ein Ticket „Datensicherung Failed Muster GmbH“, macht Sudo daraus „Backup fehlgeschlagen – Muster GmbH“ mit Alarm. Die Regeln laufen von oben nach unten, die erste passende gewinnt. Meldungen aus „Meldung senden“ bleiben unverändert.' }),
        card('Ausprobieren', el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Art', tType), el('label', { class: 'f' }, 'Titel / Text', tTitle), el('label', { class: 'f' }, 'Ticket-Nr.', tNo)),
          el('div', { class: 'row', style: 'margin-top:10px' }, action('Prüfen', runTest, 'primary')), tOut),
        card(`Regeln (${d.rules.length})`, d.rules.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl rules' },
          el('thead', {}, el('tr', {}, ...['#', 'Erkennt', 'Wird zu', 'Treffer', ''].map(h => el('th', { text: h })))), el('tbody', {}, rows)))
          : el('p', { class: 'empty', text: 'Keine Regeln – alle Meldungen bleiben, wie sie gesendet werden.' })),
        card(edit ? `Regel bearbeiten: ${edit.name}` : 'Neue Regel',
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Name', fName), el('label', { class: 'f' }, 'Gilt für', fType)),
          el('label', { class: 'f' }, 'Erkennen an', fPattern),
          el('p', { class: 'muted', text: 'Wörter: Komma = UND, senkrechter Strich | = ODER. Groß-/Kleinschreibung egal, Wortteile zählen („sicherung“ passt auch auf „Datensicherung“). Beispiel: backup|datensicherung, failed|fehlgeschlagen = (backup ODER datensicherung) UND (failed ODER fehlgeschlagen).' }),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Art des Musters', fMode), el('label', { class: 'f' }, 'Suchen', fField), el('label', { class: 'f' }, 'Wird zu', fAction, nameHint)),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Name/Kunde aus', fExtract), el('label', { class: 'f' }, 'An wen', fTarget), el('label', { class: 'f' }, 'Anzeigedauer', fDur)),
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Haltbarkeit', fTtl), el('label', { class: 'f' }, 'Link-Vorlage (optional, {ticket})', fLink)),
          el('div', { class: 'row', style: 'margin-top:12px' },
            action(edit ? 'Speichern' : 'Regel anlegen', async () => {
              if (edit) await api('PUT', '/admin/api/rules/' + edit.id, body()); else await api('POST', '/admin/api/rules', body());
              toast(edit ? 'Gespeichert.' : 'Regel angelegt.'); go('rules');
            }, 'primary'), edit ? action('Abbrechen', () => go('rules')) : null)),
        card('Ticket-Link', el('p', { class: 'muted', text: 'Hat eine Meldung eine Ticket-Nummer, wird daraus ein Link – ein Klick auf Sudos Sprechblase öffnet das Ticket. {ticket} wird durch die Nummer ersetzt.' }),
          el('div', { class: 'row' }, tl, action('Speichern', async () => { await api('PUT', '/admin/api/rules/settings', { ticketLink: tl.value.trim() }); toast('Gespeichert.'); }, 'primary'))));
    },

    // 1.6: Betrieb – Störungen, Neustart-Kampagnen, Selbsthilfe, Hilfe-Kontakt
    async ops() {
      const o = await api('GET', '/admin/api/ops');
      const devs = await api('GET', '/admin/api/devices');
      const groups = [...new Set(devs.flatMap(d => String(d.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const people = [...new Set(devs.map(d => d.upn).filter(Boolean))].sort();
      const targetSel = () => el('select', { 'aria-label': 'Für wen' }, el('option', { value: 'all', text: `Alle Sudos (${devs.length})` }),
        ...groups.map(g => el('option', { value: 'group:' + g, text: `Gruppe: ${g}` })), ...people.map(u => el('option', { value: 'user:' + u, text: `Person: ${u}` })));
      const SEV = { info: ['Info', ''], stoerung: ['Störung', 'warn'], ausfall: ['Ausfall', 'bad'] };
      const tname = t => t === 'all' ? 'alle' : t.replace(/^group:/, 'Gruppe ').replace(/^user:/, '').replace(/^device:/, 'Gerät ');
      // Störung melden
      const iTitle = el('input', { type: 'text', maxlength: 120, placeholder: 'z. B. Teams: Anmeldung gestört' });
      const iText = el('textarea', { rows: 2, maxlength: 500, placeholder: 'Was ist los, was sollen die Kollegen tun? (optional)' });
      const iSev = el('select', {}, el('option', { value: 'stoerung', text: 'Störung (gelb)' }), el('option', { value: 'ausfall', text: 'Ausfall (rot, bleibt stehen)' }), el('option', { value: 'info', text: 'Info' }));
      const iLink = el('input', { type: 'url', maxlength: 300, placeholder: 'https://… (optional, z. B. Statusseite)' });
      const iTarget = targetSel();
      const incCard = i => {
        const done = el('input', { type: 'text', maxlength: 300, placeholder: 'Entwarnung, z. B. „Läuft wieder – bitte Teams neu starten.“' });
        return el('div', { class: 'opsitem ' + (i.sev || '') },
          el('div', { class: 'row' }, el('span', { class: 'pill ' + (SEV[i.sev] || SEV.stoerung)[1], text: (SEV[i.sev] || SEV.stoerung)[0] }), el('b', { text: i.title }),
            el('span', { class: 'muted', text: `seit ${fmtDate(i.created)} · ${tname(i.target)} · von ${i.author || '?'}` })),
          i.text ? el('p', { text: i.text }) : null,
          el('p', {}, el('b', { text: `${i.affected} betroffen` }), i.devices && i.devices.length ? el('span', { class: 'muted', text: ' – ' + i.devices.map(d => d.user || d.name).join(', ') }) : null),
          el('div', { class: 'row' }, done, action('Störung beenden', async () => {
            await api('POST', `/admin/api/incidents/${i.id}/resolve`, { text: done.value });
            toast('Entwarnung gesendet.'); go('ops');
          }, 'primary')));
      };
      // Neustart-Kampagne
      const rTitle = el('input', { type: 'text', maxlength: 120, placeholder: 'z. B. Patchday: bitte bis Donnerstag neu starten' });
      const rText = el('textarea', { rows: 2, maxlength: 500, placeholder: 'Warum? z. B. „Sicherheitsupdates werden erst nach dem Neustart aktiv.“' });
      const dl = new Date(Date.now() + 2 * 864e5); dl.setHours(16, 0, 0, 0);
      const pad = n => String(n).padStart(2, '0');
      const rDeadline = el('input', { type: 'datetime-local', value: `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())}T16:00` });
      const rMode = el('select', {}, el('option', { value: 'all', text: 'alle Geräte (Neustart nach Kampagnenstart)' }), el('option', { value: 'pending', text: 'nur Geräte mit ausstehendem Neustart oder langer Laufzeit' }));
      const rDays = el('input', { type: 'number', min: 1, max: 60, value: 7 });
      const rTarget = targetSel();
      const STATE = { done: ['erledigt', 'ok'], notneeded: ['nicht nötig', 'ok'], open: ['offen', 'bad'], snoozed: ['verschoben', 'warn'], restarting: ['startet neu', 'warn'], unknown: ['noch keine Rückmeldung', ''] };
      const campCard = c => {
        const need = c.total - c.count.notneeded;
        const pct = need ? Math.round(c.count.done / need * 100) : 100;
        return el('div', { class: 'opsitem' + (c.active ? '' : ' ended') },
          el('div', { class: 'row' }, el('b', { text: c.title }), el('span', { class: 'muted', text: `${tname(c.target)} · ${c.deadline ? 'Frist ' + fmtDate(c.deadline) : 'ohne Frist'}${c.mode === 'pending' ? ` · nur bei Bedarf (≥ ${c.days} Tage)` : ''}${c.active ? '' : ' · beendet ' + fmtDate(c.ended)}` })),
          c.text ? el('p', { text: c.text }) : null,
          el('div', { class: 'row' }, el('div', { class: 'bar wide' }, el('i', { style: `width:${pct}%` })), el('b', { text: `${c.count.done} von ${need} erledigt (${pct} %)` })),
          el('div', { class: 'row' }, ...Object.entries(c.count).filter(([, n]) => n).map(([k, n]) => el('span', { class: 'pill ' + STATE[k][1], text: `${n} ${STATE[k][0]}` }))),
          c.devices.length ? el('details', {}, el('summary', { text: 'Geräte anzeigen' }), el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['Gerät', 'Person', 'Stand', 'Verschoben', 'Laufzeit', 'Rückmeldung'].map(h => el('th', { text: h })))),
            el('tbody', {}, c.devices.map(d => el('tr', {}, el('td', {}, el('span', { class: 'dot' + (d.online ? ' on' : '') }), el('b', { text: d.name })), el('td', { class: 'muted', text: d.user || '' }),
              el('td', {}, el('span', { class: 'pill ' + STATE[d.state][1], text: STATE[d.state][0] })), el('td', { class: 'num', text: d.snoozes ? d.snoozes + '×' : '–' }),
              el('td', { class: 'num', text: d.upDays != null ? d.upDays + ' T.' : '–' }), el('td', { class: 'muted', text: d.updated ? ago(d.updated) : '–' }))))))) : null,
          c.active ? el('div', { class: 'row' }, action('Kampagne beenden', async () => { if (!confirm('Kampagne beenden? Die Sudos hören auf zu erinnern.')) return; await api('POST', `/admin/api/restart/${c.id}/end`); go('ops'); }, 'small')) : null);
      };
      // Hilfe-Kontakt
      const h = o.help || {};
      const hText = el('input', { type: 'text', maxlength: 250, value: h.text || '', placeholder: 'z. B. IT-Hotline Mo–Fr 8–17 Uhr' });
      const hPhone = el('input', { type: 'text', maxlength: 30, value: h.phone || '', placeholder: '+49 …' });
      const hMail = el('input', { type: 'email', maxlength: 120, value: h.mail || '', placeholder: 'it@firma.de' });
      const hUrl = el('input', { type: 'url', maxlength: 250, value: h.url || '', placeholder: 'https://… (Ticketportal)' });
      const TOOL = { net: 'Netzwerk-Check', teams: 'Teams reparieren', outlook: 'Outlook neu starten', onedrive: 'OneDrive neu starten', explorer: 'Explorer neu starten', temp: 'Temp aufräumen', dns: 'DNS-Cache leeren', slow: 'Warum ist mein PC langsam?', meet: 'Meeting-Check Ton & Bild' };
      return el('div', {},
        el('h2', { text: 'Störungen & Neustarts' }),
        el('p', { class: 'sub', text: 'Störungen bleiben bei den Sudos sichtbar, bis du sie beendest – Kollegen melden mit einem Klick „Ich bin auch betroffen“. Neustart-Kampagnen erinnern, bis der PC neu gestartet wurde.' }),
        card(`Aktuelle Störungen (${o.incidents.length})`, o.incidents.length ? o.incidents.map(incCard) : el('p', { class: 'empty', text: 'Keine aktiven Störungen.' }),
          el('div', { class: 'qform' }, el('h4', { text: 'Störung melden' }),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Titel', iTitle), el('label', { class: 'f' }, 'Schwere', iSev)),
            el('label', { class: 'f' }, 'Beschreibung', iText),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Link', iLink), el('label', { class: 'f' }, 'Für wen', iTarget)),
            el('div', { class: 'row' }, action('Störung melden', async () => {
              const r = await api('POST', '/admin/api/incidents', { title: iTitle.value, text: iText.value, sev: iSev.value, link: iLink.value, target: iTarget.value });
              toast(r.existing ? 'Diese Störung ist schon offen.' : `Gemeldet an ${r.targets} Gerät(e).`); go('ops');
            }, 'primary')))),
        card('Neustart-Kampagnen', o.campaigns.length ? o.campaigns.map(campCard) : el('p', { class: 'empty', text: 'Noch keine Kampagne.' }),
          el('div', { class: 'qform' }, el('h4', { text: 'Kampagne starten' }),
            el('label', { class: 'f' }, 'Titel', rTitle), el('label', { class: 'f' }, 'Text', rText),
            el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Frist', rDeadline), el('label', { class: 'f' }, 'Welche Geräte', rMode), el('label', { class: 'f' }, 'Laufzeit ab (Tage)', rDays)),
            el('label', { class: 'f' }, 'Für wen', rTarget),
            el('p', { class: 'muted', text: 'Sudo fragt höflich nach (Jetzt / später) und nie im Meeting. Neu gestartet wird nur, wenn der Anwender zustimmt – erzwingen bleibt Sache von Intune bzw. NinjaOne.' }),
            el('div', { class: 'row' }, action('Kampagne starten', async () => {
              const deadline = rDeadline.value ? new Date(rDeadline.value).getTime() : null;
              await api('POST', '/admin/api/restart', { title: rTitle.value, text: rText.value, deadline, mode: rMode.value, days: Number(rDays.value) || 7, target: rTarget.value });
              toast('Kampagne gestartet. Die Sudos melden sich beim nächsten Abruf.'); go('ops');
            }, 'primary')))),
        card('Selbsthilfe der letzten 30 Tage', o.selfhelp.length ? el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Werkzeug', 'Benutzt', 'Hat geklappt'].map(x => el('th', { text: x })))),
          el('tbody', {}, o.selfhelp.map(r => el('tr', {}, el('td', { text: TOOL[r.tool] || r.tool }), el('td', { class: 'num', text: r.n }), el('td', { class: 'num', text: r.n ? Math.round(r.ok / r.n * 100) + ' %' : '–' })))))
          : el('p', { class: 'empty', text: 'Noch nicht benutzt. Gezählt wird anonym, welches Werkzeug wie oft geholfen hat – nicht von wem.' })),
        card('Hilfe-Kontakt', el('p', { class: 'muted', text: 'Steht in der Selbsthilfe und bei den Hinweisen unter „Hat nicht geholfen?“.' }),
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Hinweis', hText), el('label', { class: 'f' }, 'Telefon', hPhone), el('label', { class: 'f' }, 'E-Mail', hMail), el('label', { class: 'f' }, 'Hilfe-Portal', hUrl)),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { help_text: hText.value.trim(), help_phone: hPhone.value.trim(), help_mail: hMail.value.trim(), help_url: hUrl.value.trim() });
            toast('Gespeichert.');
          }, 'primary'))),
        o.resolved.length ? card('Beendete Störungen', el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Störung', 'Dauer', 'Betroffen', 'Entwarnung'].map(x => el('th', { text: x })))),
          el('tbody', {}, o.resolved.map(i => el('tr', {}, el('td', {}, el('b', { text: i.title }), el('div', { class: 'muted', text: fmtDate(i.created) })),
            el('td', { class: 'num', text: Math.max(1, Math.round((i.resolved - i.created) / 60000)) + ' min' }), el('td', { class: 'num', text: i.affected }),
            el('td', { class: 'muted', text: i.resolveText || '–' })))))) : null);
    },

    // 1.10: Mitarbeiter-Erlebnis – Stimmungsbarometer, Rückmeldungen nach Störungen, Start-Checkliste, Tipps
    async dex() {
      const s = await api('GET', '/admin/api/settings');
      const x = await api('GET', '/admin/api/dex');
      const devs = await api('GET', '/admin/api/devices');
      const groups = [...new Set(devs.flatMap(d => String(d.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const targetSel = () => el('select', { 'aria-label': 'Für wen' }, el('option', { value: 'all', text: `Alle Sudos (${devs.length})` }), ...groups.map(g => el('option', { value: 'group:' + g, text: `Gruppe: ${g}` })));
      const tname = t => t === 'all' ? 'alle' : t.replace(/^group:/, 'Gruppe ').replace(/^user:/, '').replace(/^device:/, 'Gerät ');
      const yn = (v, a = 'an', b = 'aus') => el('select', {}, el('option', { value: 'true', text: a, selected: v === 'true' }), el('option', { value: 'false', text: b, selected: v !== 'true' }));
      const stars = v => v == null ? '–' : `${String(v).replace('.', ',')} von 5`;
      const H = { ok: 'Gerät in Ordnung', warn: 'Gerät „ansehen“', bad: 'Gerät mit Problem', unknown: 'ohne Gerätezustand' };
      // Stimmungsbarometer
      const pOn = yn(s.pulse_enabled), pMonth = yn(s.pulse_monthly, 'jeden Monat fragen', 'nicht automatisch'), pInc = yn(s.pulse_incident, 'nachfragen', 'nicht nachfragen');
      const pMin = el('input', { type: 'number', min: 3, max: 20, value: s.pulse_min || 5 });
      const qText = el('input', { type: 'text', maxlength: 200, placeholder: 'z. B. Wie zufrieden bist du mit dem neuen Drucker im 2. OG?' });
      const qDays = el('input', { type: 'number', min: 1, max: 60, value: 7 });
      const qTarget = targetSel();
      const pulseCard = p => el('div', { class: 'opsitem' + (p.active ? '' : ' ended') },
        el('div', { class: 'row' }, el('b', { text: p.question }), el('span', { class: 'muted', text: `${p.kind === 'monthly' ? 'Monatsfrage ' + (p.period || '') : tname(p.target)} · ${p.active ? 'läuft bis ' + fmtDate(p.ends) : 'beendet ' + fmtDate(p.ends)}` })),
        p.enough ? el('div', {},
          el('div', { class: 'row' }, el('b', { text: `Ø ${stars(p.avg)}` }), el('span', { class: 'muted', text: `${p.n} Antworten · ${p.skipped} übersprungen` })),
          el('div', { class: 'row' }, ...[5, 4, 3, 2, 1].map(k => el('span', { class: 'pill ' + (k >= 4 ? 'ok' : k <= 2 ? 'bad' : 'warn'), text: `${k}★ ${p.dist[k]}` }))),
          el('div', { class: 'row' }, ...Object.entries(p.byHealth).filter(([, v]) => v.n).map(([k, v]) => el('span', { class: 'pill', text: `${H[k]}: ${v.avg != null ? 'Ø ' + String(v.avg).replace('.', ',') : 'zu wenige'} (${v.n})` }))),
          p.comments.length ? el('details', {}, el('summary', { text: `${p.comments.length} Anmerkungen` }), el('ul', {}, p.comments.map(c => el('li', { text: `${c.score}★ ${c.text}` })))) : null)
          : el('p', { class: 'muted', text: `Noch zu wenige Antworten (${p.n} von mindestens ${x.min}) – die Auswertung erscheint erst ab ${x.min}, damit niemand erkennbar ist.` }),
        el('div', { class: 'row' }, p.active ? action('Beenden', async () => { await api('POST', `/admin/api/pulse/${p.id}/end`); go('dex'); }, 'small') : null,
          action('Löschen', async () => { if (!confirm('Umfrage mit allen Antworten löschen?')) return; await api('DELETE', `/admin/api/pulse/${p.id}`); go('dex'); }, 'small danger')));
      // Start-Checkliste
      const CHECK = { manual: 'Hakt der Mitarbeiter selbst ab', onedrive: 'Automatisch: OneDrive angemeldet', kfm: 'Automatisch: Desktop/Dokumente in OneDrive', signature: 'Automatisch: Outlook-Signatur vorhanden',
        printer: 'Automatisch: Drucker verbunden', teams: 'Automatisch: Teams eingerichtet', quiz: 'Automatisch: Quizfrage beantwortet', health: 'Automatisch: Gerätezustand in Ordnung' };
      const oOn = yn(s.onboard_enabled, 'an', 'aus'), oDays = el('input', { type: 'number', min: 1, max: 180, value: s.onboard_days || 30 });
      const iTitle = el('input', { type: 'text', maxlength: 120, placeholder: 'z. B. VPN einrichten' });
      const iText = el('input', { type: 'text', maxlength: 300, placeholder: 'Kurze Anleitung (optional)' });
      const iCheck = el('select', {}, ...x.onboard.checks.map(c => el('option', { value: c, text: CHECK[c] || c })));
      const iLink = el('input', { type: 'text', maxlength: 300, placeholder: 'https://… (optional)' });
      const iTarget = targetSel();
      const items = x.onboard.items;
      // Tipps
      const APPS = { all: 'jedes Programm', excel: 'Excel', word: 'Word', outlook: 'Outlook', teams: 'Teams', powerpoint: 'PowerPoint', onenote: 'OneNote', browser: 'Browser', sharepoint: 'SharePoint', onedrive: 'OneDrive' };
      const tOn = yn(s.tips_enabled, 'an', 'aus');
      let tips = x.tips.slice();
      const tipList = el('div');
      const drawTips = () => tipList.replaceChildren(tips.length ? el('table', { class: 'tbl' }, el('tbody', {}, tips.map((t, i) => el('tr', {},
        el('td', {}, el('span', { class: 'pill teal', text: APPS[t.app] || t.app })), el('td', { text: t.text }),
        el('td', {}, action('Entfernen', async () => { tips.splice(i, 1); drawTips(); }, 'small')))))) : el('p', { class: 'empty', text: 'Keine eigenen Tipps – Sudo nutzt die mitgelieferten.' }));
      drawTips();
      const tApp = el('select', {}, ...x.tipApps.map(a => el('option', { value: a, text: APPS[a] || a })));
      const tText = el('input', { type: 'text', maxlength: 200, placeholder: 'z. B. Rechnungen legst du im Ordner „Buchhaltung/Eingang“ ab.' });
      return el('div', {},
        el('h2', { text: 'Mitarbeiter-Erlebnis' }),
        el('p', { class: 'sub', text: 'Wie geht es den Kollegen mit ihrer IT? Kurze Stimmungsfragen, Nachfragen nach Störungen, eine Start-Checkliste für neue Kollegen und Tipps im passenden Moment.' }),
        card('Stimmungsbarometer',
          el('p', { class: 'muted', text: `Sudo fragt höflich (nie im Meeting) und man kann jede Frage überspringen. Antworten werden ohne Gerät gespeichert – nur die Sterne, die Ampel des Gerätezustands und der Tag. Ausgewertet wird erst ab ${x.min} Antworten.` }),
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Stimmungsbarometer', pOn), el('label', { class: 'f' }, 'Monatsfrage zur Zufriedenheit', pMonth),
            el('label', { class: 'f' }, 'Nach einer Störung „Läuft es wieder?“ fragen', pInc), el('label', { class: 'f' }, 'Auswertung ab … Antworten', pMin)),
          el('p', { class: 'muted', text: 'Die Nachfrage nach Störungen geht nur an Kollegen, die „Ich bin auch betroffen“ geklickt haben. Wer „Geht noch nicht“ antwortet, erscheint unten mit Namen – damit ihr helfen könnt. Das steht so auch im Sudo.' }),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { pulse_enabled: pOn.value, pulse_monthly: pMonth.value, pulse_incident: pInc.value, pulse_min: String(pMin.value) });
            toast('Gespeichert. Die Sudos übernehmen es beim nächsten Abruf.'); go('dex');
          }, 'primary')),
          el('div', { class: 'qform' }, el('h4', { text: 'Eigene Frage stellen' }),
            el('label', { class: 'f' }, 'Frage (beantwortet mit 1 bis 5 Sternen)', qText),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Läuft (Tage)', qDays), el('label', { class: 'f' }, 'Für wen', qTarget)),
            el('div', { class: 'row' }, action('Frage starten', async () => {
              await api('POST', '/admin/api/pulse', { question: qText.value, days: Number(qDays.value) || 7, target: qTarget.value });
              toast('Gestartet. Sudo fragt beim nächsten passenden Moment.'); go('dex');
            }, 'primary')))),
        card(`Umfragen (${x.pulse.length})`, x.pulse.length ? x.pulse.map(pulseCard) : el('p', { class: 'empty', text: 'Noch keine Umfrage. Tipp: Monatsfrage einschalten – dann seht ihr den Verlauf der Zufriedenheit.' })),
        card('Nach Störungen: Läuft es wieder?', x.feedback.length ? el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Störung', 'Beendet', 'Läuft wieder', 'Geht noch nicht'].map(h => el('th', { text: h })))),
          el('tbody', {}, x.feedback.map(f => el('tr', {}, el('td', {}, el('b', { text: f.title })), el('td', { class: 'muted', text: fmtDate(f.resolved) }),
            el('td', { class: 'num', text: f.ok }),
            el('td', {}, f.still.length ? f.still.map(p => el('div', {}, el('span', { class: 'pill bad', text: p.user || p.name }), el('span', { class: 'muted', text: ' ' + p.name + ' · ' + ago(p.at) }))) : el('span', { class: 'muted', text: '–' }))))))
          : el('p', { class: 'empty', text: 'Noch keine Rückmeldungen. Sie kommen nach dem Beenden einer Störung.' })),
        card('Start-Checkliste für neue Kollegen',
          el('p', { class: 'muted', text: 'Neue Sudos zeigen die Liste in den ersten Tagen nach der Registrierung. Viele Punkte prüft Sudo selbst, den Rest hakt der Mitarbeiter ab. Hier seht ihr den Stand je Gerät.' }),
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Start-Checkliste', oOn), el('label', { class: 'f' }, 'Zeigen in den ersten … Tagen', oDays)),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { onboard_enabled: oOn.value, onboard_days: String(oDays.value) }); toast('Gespeichert.'); go('dex');
          }, 'primary')),
          el('div', { class: 'scroll', style: 'margin-top:12px' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['', 'Punkt', 'Prüfung', 'Für wen', 'Aktiv', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, items.map((it, n) => el('tr', {},
              el('td', {}, el('div', { class: 'row' }, n ? action('↑', async () => { await api('PATCH', '/admin/api/onboard/' + it.id, { move: -1 }); go('dex'); }, 'small') : null,
                n < items.length - 1 ? action('↓', async () => { await api('PATCH', '/admin/api/onboard/' + it.id, { move: 1 }); go('dex'); }, 'small') : null)),
              el('td', {}, el('b', { text: it.title }), it.text ? el('div', { class: 'muted', text: it.text }) : null, it.link ? el('div', { class: 'muted', text: it.link }) : null),
              el('td', { class: 'muted', text: CHECK[it.check] || it.check }), el('td', { class: 'muted', text: tname(it.target) }),
              el('td', {}, action(it.active ? 'aktiv' : 'pausiert', async () => { await api('PATCH', '/admin/api/onboard/' + it.id, { active: !it.active }); go('dex'); }, 'small')),
              el('td', {}, action('Löschen', async () => { if (!confirm(`„${it.title}“ löschen?`)) return; await api('DELETE', '/admin/api/onboard/' + it.id); go('dex'); }, 'small danger'))))))),
          el('div', { class: 'qform' }, el('h4', { text: 'Punkt hinzufügen' }),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Titel', iTitle), el('label', { class: 'f' }, 'Prüfung', iCheck)),
            el('label', { class: 'f' }, 'Anleitung', iText),
            el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Link', iLink), el('label', { class: 'f' }, 'Für wen', iTarget)),
            el('div', { class: 'row' }, action('Hinzufügen', async () => {
              await api('POST', '/admin/api/onboard', { title: iTitle.value, text: iText.value, check: iCheck.value, link: iLink.value.trim(), target: iTarget.value });
              toast('Hinzugefügt.'); go('dex');
            }, 'primary'))),
          el('h4', { text: `Stand der neuen Kollegen (${x.onboard.devices.length})` }),
          x.onboard.devices.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['Gerät', 'Registriert', 'Fortschritt', 'Noch offen', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, x.onboard.devices.map(d => el('tr', {},
              el('td', {}, el('span', { class: 'dot' + (d.online ? ' on' : '') }), el('b', { text: d.name }), el('div', { class: 'muted', text: d.user || '' })),
              el('td', { class: 'muted', text: fmtDate(d.created) }),
              el('td', {}, el('div', { class: 'bar wide' }, el('i', { style: `width:${d.total ? Math.round(d.done / d.total * 100) : 0}%` })), el('div', { class: 'muted', text: `${d.done} von ${d.total}` + (d.until < Date.now() ? ' · Zeitraum vorbei' : '') })),
              el('td', { class: 'muted', text: d.open.join(', ') || 'alles erledigt' }),
              el('td', {}, action('Erneut zeigen', async () => { await api('POST', '/admin/api/onboard/device/' + d.id); toast('Sudo zeigt die Liste wieder.'); go('dex'); }, 'small')))))))
            : el('p', { class: 'empty', text: 'Keine Geräte im Zeitraum. Mit „Erneut zeigen“ in dieser Liste bekommt auch ein älteres Gerät die Liste wieder.' })),
        card('Tipps im passenden Moment',
          el('p', { class: 'muted', text: 'Hat jemand Excel, Outlook & Co. eine Weile im Vordergrund, zeigt Sudo ab und zu einen kurzen Tipp. Eure eigenen Tipps (z. B. Ablageorte, Kürzel) kommen zu den mitgelieferten dazu. Jeder kann Tipps im eigenen Sudo abschalten.' }),
          el('label', { class: 'f' }, 'Tipps', tOn),
          tipList,
          el('div', { class: 'grid2' }, el('label', { class: 'f' }, 'Programm', tApp), el('label', { class: 'f' }, 'Tipp', tText)),
          el('div', { class: 'row', style: 'margin-top:12px' },
            action('Tipp hinzufügen', async () => { const t = tText.value.trim(); if (t.length < 5) { toast('Bitte mindestens 5 Zeichen.', true); return; } if (tips.length >= 50) { toast('Höchstens 50 eigene Tipps.', true); return; } tips.push({ app: tApp.value, text: t }); tText.value = ''; drawTips(); }),
            action('Speichern', async () => { await api('PUT', '/admin/api/settings', { tips_enabled: tOn.value, tips_custom: JSON.stringify(tips) }); toast('Gespeichert.'); go('dex'); }, 'primary'))));
    },

    async security() {
      const s = await api('GET', '/admin/api/settings');
      const z = await api('GET', '/admin/api/quiz');
      const devs = await api('GET', '/admin/api/devices');
      const yn = (v, a = 'an', b = 'aus') => el('select', {}, el('option', { value: 'true', text: a, selected: v !== 'false' }), el('option', { value: 'false', text: b, selected: v === 'false' }));
      const hOn = yn(s.health_report, 'melden lassen', 'nicht melden'), qOn = yn(s.quiz_enabled);
      const qWeek = el('select', {}, ...[['1', '1× pro Woche'], ['2', '2× pro Woche'], ['3', '3× pro Woche'], ['5', 'täglich (werktags)']].map(([v, l]) => el('option', { value: v, text: l, selected: String(s.quiz_per_week || 2) === v })));
      const pct = (ok, n) => n ? Math.round(ok / n * 100) + ' %' : '–';
      // Ziele für „Jetzt anbieten“
      const groups = [...new Set(devs.flatMap(d => String(d.groups || '').split(',').map(g => g.trim()).filter(Boolean)))].sort();
      const targetSel = () => el('select', { 'aria-label': 'An wen' }, el('option', { value: 'all', text: 'alle' }), ...groups.map(g => el('option', { value: 'group:' + g, text: 'Gruppe ' + g })));
      // Neue Frage
      const fq = el('textarea', { rows: 2, maxlength: 400, placeholder: 'z. B. Woran erkennst du eine echte Mail unserer Buchhaltung?' });
      const fa = [0, 1, 2, 3].map(i => el('input', { type: 'text', maxlength: 200, placeholder: i < 2 ? `Antwort ${i + 1}` : `Antwort ${i + 1} (optional)` }));
      const fr = [0, 1, 2, 3].map(i => el('input', { type: 'radio', name: 'okq', value: String(i), checked: i === 0, 'aria-label': `Antwort ${i + 1} ist richtig` }));
      const fw = el('textarea', { rows: 2, maxlength: 600, placeholder: 'Erklärung, die nach der Antwort erscheint' });
      const fl = el('input', { type: 'url', maxlength: 300, placeholder: 'https://… (optional, z. B. eure Richtlinie)' });
      const healthy = devs.filter(d => d.health);
      return el('div', {},
        el('h2', { text: 'Sicherheit & Quiz' }),
        el('p', { class: 'sub', text: 'Gerätezustand der PCs und kurze Sicherheitsfragen für alle. Die Quiz-Auswertung ist anonym: Gezählt wird nur, wie oft eine Frage richtig beantwortet wurde – nicht von wem.' }),
        card('Einstellungen',
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Gerätezustand an die Zentrale', hOn), el('label', { class: 'f' }, 'Security-Quiz', qOn), el('label', { class: 'f' }, 'Wie oft fragt Sudo?', qWeek)),
          el('p', { class: 'muted', text: 'Gemeldet wird nur die Ampel: BitLocker, Virenschutz, Firewall, Windows-Update, Neustart und Speicherplatz – keine Dateien, Programme oder Inhalte.' }),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { health_report: hOn.value, quiz_enabled: qOn.value, quiz_per_week: qWeek.value });
            toast('Gespeichert. Die Sudos übernehmen es beim nächsten Abruf.');
          }, 'primary'))),
        card(`Gerätezustand · ${healthy.length} von ${devs.length} Geräten melden`, healthy.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Gerät', 'Zustand', ...Object.values(H_NAME), 'Stand'].map(h => el('th', { text: h })))),
          el('tbody', {}, healthy.sort((a, b) => ({ bad: 0, warn: 1, unknown: 2, ok: 3 }[a.health.s] - { bad: 0, warn: 1, unknown: 2, ok: 3 }[b.health.s])).map(d => el('tr', {},
            el('td', {}, el('b', { text: d.name }), el('div', { class: 'muted', text: d.user || '' })), el('td', {}, healthCell(d.health)),
            ...Object.keys(H_NAME).map(k => { const v = (d.health.i || {})[k] || 'unknown'; return el('td', {}, el('span', { class: 'pill ' + (v === 'ok' ? 'ok' : v === 'bad' ? 'bad' : v === 'warn' ? 'warn' : ''), text: H_WORD[v] })); }),
            el('td', { class: 'muted', text: ago(d.healthAt) }))))))
          : el('p', { class: 'empty', text: 'Noch keine Meldungen. Sudo prüft kurz nach dem Start und dann alle 6 Stunden (ab Sudo 1.5).' })),
        card(`Quiz der letzten 30 Tage · ${z.total.n} Antworten · ${pct(z.total.ok, z.total.n)} richtig`, z.perQuestion.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
          el('thead', {}, el('tr', {}, ...['Frage', 'Antworten', 'Richtig'].map(h => el('th', { text: h })))),
          el('tbody', {}, z.perQuestion.sort((a, b) => a.ok / a.n - b.ok / b.n).map(r => el('tr', {}, el('td', { text: r.label }), el('td', { class: 'num', text: r.n }),
            el('td', { class: 'num' }, el('span', { class: 'pill ' + (r.ok / r.n >= .8 ? 'ok' : r.ok / r.n < .5 ? 'bad' : 'warn'), text: pct(r.ok, r.n) }))))))) 
          : el('p', { class: 'empty', text: 'Noch keine Antworten. Die schwierigsten Fragen stehen später oben – gut als Thema für die nächste Schulung.' })),
        card('Eigene Fragen',
          el('p', { class: 'muted', text: 'Eigene Fragen kommen zuerst dran. Mit „Jetzt anbieten“ fragt Sudo sofort nach (im Meeting erst danach).' }),
          z.questions.length ? el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['Frage', 'Richtige Antwort', 'Aktiv', ''].map(h => el('th', { text: h })))),
            el('tbody', {}, z.questions.map(q => { const t = targetSel(); return el('tr', {},
              el('td', { text: q.q }), el('td', { class: 'muted', text: q.a[q.ok] || '' }),
              el('td', {}, action(q.active ? 'aktiv' : 'pausiert', async () => { await api('PATCH', '/admin/api/quiz/' + q.id.slice(1), { active: !q.active }); go('security'); }, 'small')),
              el('td', {}, el('div', { class: 'row' }, q.active ? t : null, q.active ? action('Jetzt anbieten', async () => { const r = await api('POST', '/admin/api/quiz/' + q.id.slice(1) + '/offer', { target: t.value }); toast(`Angeboten an ${r.targets} Gerät(e).`); }, 'small') : null,
                action('Löschen', async () => { if (!confirm('Frage löschen? Die Auswertung bleibt erhalten.')) return; await api('DELETE', '/admin/api/quiz/' + q.id.slice(1)); go('security'); }, 'small danger')))); })))) : null,
          el('div', { class: 'qform' },
            el('label', { class: 'f' }, 'Frage', fq),
            ...fa.map((inp, i) => el('label', { class: 'f qa' }, el('span', {}, fr[i], ` Antwort ${i + 1}${i === 0 ? ' (Punkt = richtige Antwort)' : ''}`), inp)),
            el('label', { class: 'f' }, 'Erklärung', fw), el('label', { class: 'f' }, 'Link (optional)', fl),
            el('div', { class: 'row' }, action('Frage anlegen', async () => {
              const answers = fa.map(x => x.value.trim());
              const okIdx = fr.findIndex(x => x.checked);
              if (!answers[okIdx]) { toast('Die markierte richtige Antwort ist leer.', true); return; }
              const filled = answers.map((t, i) => ({ t, i })).filter(x => x.t);
              await api('POST', '/admin/api/quiz', { q: fq.value, a: filled.map(x => x.t), ok: filled.findIndex(x => x.i === okIdx), why: fw.value, link: fl.value });
              toast('Frage angelegt.'); go('security');
            }, 'primary')))));
    },

    async ai() {
      const s = await api('GET', '/admin/api/settings');
      const u = await api('GET', '/admin/api/usage?days=30');
      const on = el('select', {}, el('option', { value: 'true', text: 'an', selected: s.ai_enabled === 'true' }), el('option', { value: 'false', text: 'aus', selected: s.ai_enabled !== 'true' }));
      const models = el('select', {}, ...[['haiku,sonnet', 'Schnell (Haiku) und Schlau (Sonnet)'], ['haiku', 'nur Schnell (Haiku)']].map(([v, l]) => el('option', { value: v, text: l, selected: s.ai_models === v })));
      const daily = el('input', { type: 'number', min: 0, value: s.ai_daily_cents });
      const monthly = el('input', { type: 'number', min: 0, value: s.ai_monthly_cents });
      const ctx = el('select', {}, el('option', { value: 'true', text: 'erlaubt', selected: s.ai_context === 'true' }), el('option', { value: 'false', text: 'nicht mitschicken', selected: s.ai_context !== 'true' }));
      const ttl = el('input', { type: 'number', min: 1, max: 10080, value: s.message_ttl_min });
      const vOn = el('select', {}, el('option', { value: 'true', text: 'an', selected: s.visits_enabled !== 'false' }), el('option', { value: 'false', text: 'aus', selected: s.visits_enabled === 'false' }));
      const vSend = el('input', { type: 'number', min: 0, max: 50, value: s.visits_send_per_day ?? 2 });
      const vRecv = el('input', { type: 'number', min: 0, max: 50, value: s.visits_recv_per_day ?? 3 });
      const visits = await api('GET', '/admin/api/visits').catch(() => []);
      const KIND = { note: 'Post-it', coffee: 'Kaffee', duck: 'Gummiente', pizza: 'Pizza', confetti: 'Konfetti', bug: 'Bug', duel: 'Duell' };
      const RES = { host_won: 'Gastgeber gewinnt', guest_won: 'Gast gewinnt', done: 'erledigt' };
      const max = Math.max(0.0001, ...u.perDay.map(d => d.usd));
      const days = [];
      for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
      const byDay = Object.fromEntries(u.perDay.map(d => [d.day, d]));
      const total = u.perDay.reduce((a, d) => a + d.usd, 0), totalQ = u.perDay.reduce((a, d) => a + d.q, 0);
      return el('div', {},
        el('h2', { text: 'KI & Besuche' }),
        el('p', { class: 'sub', text: 'Die Sudos fragen über die Zentrale bei Claude nach – der API-Schlüssel liegt nur hier auf dem Server. Gezählt werden Token und Kosten, Fragen und Antworten werden nicht gespeichert.' }),
        !s.aiKey ? el('p', { class: 'msg bad', text: 'ANTHROPIC_API_KEY fehlt in der .env – Frag Sudo über die Zentrale ist so nicht möglich.' }) : null,
        card('Einstellungen',
          el('div', { class: 'grid3' },
            el('label', { class: 'f' }, 'Frag Sudo über die Zentrale', on), el('label', { class: 'f' }, 'Erlaubte Modelle', models), el('label', { class: 'f' }, 'IT-Lage als Hintergrund', ctx),
            el('label', { class: 'f' }, 'Budget pro Gerät und Tag (US-Cent, 0 = ohne)', daily), el('label', { class: 'f' }, 'Budget gesamt pro Monat (US-Cent, 0 = ohne)', monthly),
            el('label', { class: 'f' }, 'Meldungen haltbar (Minuten, Standard)', ttl)),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { ai_enabled: on.value, ai_models: models.value, ai_daily_cents: daily.value, ai_monthly_cents: monthly.value, ai_context: ctx.value, message_ttl_min: ttl.value });
            toast('Gespeichert. Die Sudos bekommen es sofort mit.');
          }, 'primary'))),
        card('Besuche zwischen Sudos',
          el('p', { class: 'muted', text: 'Kollegen schicken ihren Sudo auf Besuch: Post-it (höchstens 60 Zeichen, mit Absender), Geschenk, Bug oder Duell. Wer keinen Besuch möchte, schaltet es im eigenen Sudo ab.' }),
          el('div', { class: 'grid3' }, el('label', { class: 'f' }, 'Besuche', vOn), el('label', { class: 'f' }, 'Senden pro Person und Tag', vSend), el('label', { class: 'f' }, 'Empfangen pro Person und Tag', vRecv)),
          el('div', { class: 'row', style: 'margin-top:12px' }, action('Speichern', async () => {
            await api('PUT', '/admin/api/settings', { visits_enabled: vOn.value, visits_send_per_day: vSend.value, visits_recv_per_day: vRecv.value });
            toast('Gespeichert.');
          }, 'primary')),
          visits.length ? el('div', { class: 'scroll', style: 'margin-top:12px' }, el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, ...['Zeit', 'Von', 'An', 'Was', 'Ergebnis'].map(h => el('th', { text: h })))),
            el('tbody', {}, visits.slice(0, 30).map(v => el('tr', {}, el('td', { text: fmtDate(v.created) }), el('td', { text: v.from }), el('td', { text: v.to }),
              el('td', {}, el('span', { class: 'pill teal', text: KIND[v.kind] || v.kind }), v.note ? ' „' + v.note + '“' : ''), el('td', { class: 'muted', text: RES[v.result] || 'unterwegs' }))))))
            : el('p', { class: 'empty', text: 'Noch keine Besuche.' })),
        card(`Verbrauch der letzten 30 Tage · ${totalQ} Fragen · ${usd(total)}`,
          el('div', { class: 'chart', role: 'img', 'aria-label': 'Kosten pro Tag' }, ...days.map(d => el('div', { title: `${d}: ${byDay[d] ? byDay[d].q + ' Fragen · ' + usd(byDay[d].usd) : '–'}`, style: `height:${byDay[d] ? Math.max(2, byDay[d].usd / max * 100) : 0}%` }))),
          el('div', { class: 'chartx' }, el('span', { text: days[0].slice(5).split('-').reverse().join('.') }), el('span', { text: 'heute' }))),
        el('div', { class: 'grid2' },
          card('Nach Gerät', u.perDevice.length ? el('table', { class: 'tbl' }, el('tbody', {}, u.perDevice.map(d => el('tr', {}, el('td', { text: d.name }), el('td', { class: 'num', text: `${d.q} Fragen` }), el('td', { class: 'num', text: usd(d.usd) }))))) : el('p', { class: 'empty', text: 'Noch keine Fragen.' })),
          card('Nach Modell', u.perModel.length ? el('table', { class: 'tbl' }, el('tbody', {}, u.perModel.map(d => el('tr', {}, el('td', { text: d.model === 'sonnet' ? 'Schlau (Sonnet)' : 'Schnell (Haiku)' }), el('td', { class: 'num', text: `${d.q} Fragen` }), el('td', { class: 'num', text: usd(d.usd) }))))) : el('p', { class: 'empty', text: 'Noch keine Fragen.' }))));
    },

    async audit() {
      const a = await api('GET', '/admin/api/audit');
      const NAMES = { login: 'Anmeldung', logout: 'Abmeldung', login_failed: 'Falsches Passwort', login_denied: 'Anmeldung abgelehnt', enroll: 'Sudo registriert', enroll_denied: 'Registrierung abgelehnt',
        device_edit: 'Gerät geändert', device_revoke: 'Gerät gesperrt', enroll_code_create: 'Code erzeugt', quiz_create: 'Quizfrage angelegt', quiz_delete: 'Quizfrage gelöscht', quiz_offer: 'Quizfrage angeboten', incident_open: 'Störung gemeldet', incident_resolve: 'Störung beendet', restart_start: 'Neustart-Kampagne gestartet', restart_end: 'Neustart-Kampagne beendet', rule_create: 'Regel angelegt', rule_edit: 'Regel geändert', rule_delete: 'Regel gelöscht', youtube_add: 'YouTube-Kanal hinzugefügt', kb_add: 'Wissensquelle hinzugefügt', kb_delete: 'Wissensquelle entfernt', youtube_delete: 'YouTube-Kanal entfernt', spotify_connect: 'Spotify verbunden', spotify_disconnect: 'Spotify getrennt', music_skip: 'Song übersprungen', music_veto: 'Song gesperrt', music_unblock: 'Song entsperrt', music_autoskip: 'Gesperrter Song übersprungen', enroll_code_revoke: 'Code widerrufen', api_key_create: 'API-Schlüssel erzeugt',
        api_key_revoke: 'API-Schlüssel widerrufen', pulse_start: 'Umfrage gestartet', pulse_end: 'Umfrage beendet', pulse_delete: 'Umfrage gelöscht', incident_still: 'Störung: geht noch nicht',
        onboard_add: 'Checklisten-Punkt angelegt', onboard_delete: 'Checklisten-Punkt gelöscht', onboard_show: 'Checkliste erneut gezeigt', message_send: 'Meldung gesendet', message_expire: 'Meldung zurückgezogen', settings: 'Einstellungen geändert', visit: 'Besuch geschickt', duel: 'Duell' };
      return el('div', {}, el('h2', { text: 'Protokoll' }), el('p', { class: 'sub', text: 'Die letzten 200 Aktionen (180 Tage aufbewahrt).' }),
        card(null, el('div', { class: 'scroll' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['Zeit', 'Wer', 'Was', 'Details'].map(h => el('th', { text: h })))),
          el('tbody', {}, a.map(x => el('tr', {}, el('td', { text: fmtDate(x.ts) }), el('td', { text: x.actor }), el('td', { text: NAMES[x.action] || x.action }), el('td', { class: 'muted', text: x.detail || '' }))))))));
    }
  };

  function codesTable(list) {
    return list.length ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ...['Bezeichnung', 'Gruppen', 'Gültig bis', 'Benutzt', 'Rest', ''].map(h => el('th', { text: h })))),
      el('tbody', {}, list.map(c => el('tr', {}, el('td', { text: c.label || '–' }), el('td', { text: c.groups || '–' }), el('td', { text: c.expires ? fmtDate(c.expires) : 'unbegrenzt' }),
        el('td', { class: 'num', text: c.used }), el('td', { class: 'num', text: c.usesLeft == null ? '∞' : c.usesLeft }),
        el('td', {}, action('Widerrufen', async () => { await api('DELETE', '/admin/api/enroll-codes/' + c.id); go('enroll'); }, 'small danger'))))))
      : el('p', { class: 'empty', text: 'Kein aktiver Code.' });
  }
  function messagesTable(list, canExpire) {
    if (!list.length) return el('p', { class: 'empty', text: 'Noch nichts gesendet.' });
    return el('div', { class: 'scroll' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, ...['Zeit', 'Art', 'Inhalt', 'An', 'Zugestellt', canExpire ? '' : null].filter(h => h !== null).map(h => el('th', { text: h })))),
      el('tbody', {}, list.map(m => el('tr', {},
        el('td', { text: fmtDate(m.created) }), el('td', {}, el('span', { class: 'pill teal', text: (TYPES[m.type] || {}).label || m.type })),
        el('td', {}, summary(m.event), el('div', { class: 'muted', text: m.author || '' })),
        el('td', { text: m.target === 'all' ? 'alle' : m.target.replace(/^group:/, 'Gruppe ').replace(/^device:/, 'Gerät ').replace(/^user:/, 'Person ') }),
        el('td', { class: 'num', text: `${m.delivered} / ${m.targets}` }),
        canExpire ? el('td', {}, m.expires > Date.now() ? action('Zurückziehen', async () => { await api('DELETE', '/admin/api/messages/' + m.id); go(view); }, 'small') : el('span', { class: 'muted', text: 'abgelaufen' })) : null)))));
  }

  /* ---------- Start ---------- */
  (async () => {
    try { me = await api('GET', '/admin/api/me'); }
    catch { return renderLogin(); }
    const h = location.hash.slice(1);
    go(VIEWS[h] ? h : 'home');
    setInterval(() => { if (view === 'home' && document.visibilityState === 'visible') go('home'); }, 20000);
  })();
})();
