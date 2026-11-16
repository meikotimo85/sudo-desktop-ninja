// lage-window.js – IT-Lage: öffentlicher Microsoft-/Azure-Status und Datenlecks
(async () => {
  'use strict';
  const host = window.lageHost;
  const main = document.getElementById('main');
  const LOC = () => (window.I18N && I18N.locale) || 'de-DE';
  const tr = x => (window.I18N ? I18N.t(x) : x);
  // Reiterwunsch kann schon beim Laden kommen – vor den ersten Abfragen annehmen
  let tab = 'status', ready = false;
  host.onTab(t => { tab = t; if (ready) render(); });
  let snap = await host.get();
  let emails = await host.emails();
  const leakMsg = { text: '', bad: false };

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
  const section = (title, ...rows) => el('section', {}, el('h3', { text: title }), ...rows);
  const text = (title, hint) => el('div', { class: 't' }, el('b', { text: title }), hint ? el('small', { text: hint }) : null);
  const link = (label, url) => el('a', { class: 'lnk', tabindex: 0, text: label, on: { click: () => host.open(url), keydown: e => { if (e.key === 'Enter') host.open(url); } } });
  const time = iso => iso ? new Date(iso).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' }) : '–';
  const date = iso => iso ? new Date(iso).toLocaleDateString(LOC(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
  const num = n => Number(n || 0).toLocaleString(LOC());
  const toggle = (key, title, hint) => {
    const id = 'sw_' + key;
    const inp = el('input', { type: 'checkbox', id, 'aria-label': title, on: { change: async e => { const r = await host.config({ [key]: e.target.checked }); if (r.snap) snap = r.snap; render(); } } });
    inp.checked = !!snap.cfg[key];
    return el('div', { class: 'row' }, text(title, hint), el('label', { class: 'sw', for: id }, inp, el('i')));
  };
  const btn = (label, fn, primary) => {
    const b = el('button', { class: 'act' + (primary ? ' primary' : ''), text: label });
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
    return b;
  };
  const refreshBtn = () => btn('Aktualisieren', async () => { snap = await host.refresh(); render(); });
  // Häufige Datenarten von Have I Been Pwned verständlich benennen
  const CLASSES = { 'Email addresses': 'E-Mail-Adressen', 'Passwords': 'Passwörter', 'Usernames': 'Benutzernamen', 'Names': 'Namen',
    'Phone numbers': 'Telefonnummern', 'Physical addresses': 'Postadressen', 'Dates of birth': 'Geburtsdaten', 'IP addresses': 'IP-Adressen',
    'Password hints': 'Passwort-Hinweise', 'Genders': 'Geschlecht', 'Geographic locations': 'Standorte', 'Credit cards': 'Kreditkarten',
    'Partial credit card data': 'Teile von Kreditkartendaten', 'Bank account numbers': 'Kontonummern', 'Security questions and answers': 'Sicherheitsfragen',
    'Job titles': 'Berufsbezeichnungen', 'Employers': 'Arbeitgeber', 'Social media profiles': 'Social-Media-Profile', 'Purchases': 'Einkäufe',
    'Device information': 'Geräte-Infos', 'Auth tokens': 'Anmelde-Tokens', 'Government issued IDs': 'Ausweisnummern' };
  const HOT = /password|credit|bank|security q|auth|government/i;
  const tags = list => el('div', { class: 'tags' }, (list || []).slice(0, 12).map(c => el('span', { class: HOT.test(c) ? 'hot' : '', text: (window.I18N && I18N.lang !== 'de') ? c : (CLASSES[c] || c) })));

  /* ---------- Reiter: Microsoft & Azure ---------- */
  function status() {
    const m = snap.m365, a = snap.azure;
    const bad = m.items.filter(s => !s.ok);
    const head = el('div', { class: 'head' },
      el('div', {}, el('h2', { text: 'Microsoft & Azure' }),
        el('p', { class: 'sub', text: 'Öffentlicher Status – unabhängig von deinem Tenant. Störungen, die nur einzelne Tenants betreffen, stehen ausschließlich im Microsoft 365 Admin Center.' })),
      refreshBtn());
    const m365 = !snap.cfg.m365 ? section('Microsoft 365 (öffentlich)', el('div', { class: 'empty', text: 'Ausgeschaltet.' }))
      : section('Microsoft 365 (öffentlich)',
        el('div', { class: 'row' }, text(m.error ? 'Nicht erreichbar' : bad.length ? `${bad.length} von ${m.items.length} Diensten gestört` : 'Alle Dienste laufen',
          m.error ? m.error : `Stand ${time(m.at)}`), el('span', { class: 'pill ' + (m.error ? '' : bad.length ? 'bad' : 'ok'), text: m.error ? '?' : bad.length ? 'Störung' : 'OK' })),
        ...[...bad, ...m.items.filter(s => s.ok)].map(s => el('div', { class: 'svc' }, el('i', { class: 'dot' + (s.ok ? '' : ' bad') }),
          el('div', { class: 't' }, el('b', { text: s.name }), s.ok ? null : el('p', { text: [s.status, s.title, s.message].filter(Boolean).join('\n') })),
          el('small', { class: 'stamp', text: s.ok ? '' : time(s.updated) }))));
    const azure = !snap.cfg.azure ? section('Azure', el('div', { class: 'empty', text: 'Ausgeschaltet.' }))
      : section('Azure',
        el('div', { class: 'row' }, text(a.error ? 'Nicht erreichbar' : a.items.length ? `${a.items.length} aktuelle Meldung(en)` : 'Keine aktuellen Störungen',
          a.error ? a.error : `Stand ${time(a.at)}`), el('span', { class: 'pill ' + (a.error ? '' : a.items.length ? 'bad' : 'ok'), text: a.error ? '?' : a.items.length ? 'Störung' : 'OK' })),
        ...a.items.map(i => el('div', { class: 'svc' }, el('i', { class: 'dot warn' }),
          el('div', { class: 't' }, el('b', { text: i.title }), el('p', { text: i.text.slice(0, 400) }), i.link ? link('Details', i.link) : null),
          el('small', { class: 'stamp', text: time(i.date) }))));
    return [head, m365, azure,
      section('Einstellungen',
        toggle('m365', 'Microsoft 365 beobachten', 'Outlook.com, OneDrive, Teams, Copilot … alle 5 Minuten'),
        toggle('azure', 'Azure beobachten', 'Offizieller Azure-Status-Feed, alle 5 Minuten'),
        el('div', { class: 'row' }, text('Weitere Quellen', 'Für deinen eigenen Tenant (Anmeldung nötig)'),
          link('Statusseite', 'https://status.cloud.microsoft/'), link('Admin Center', 'https://admin.microsoft.com/#/servicehealth'), link('Azure', 'https://azure.status.microsoft/')))];
  }

  /* ---------- Reiter: Datenlecks ---------- */
  function leaks() {
    const b = snap.breach.latest, L = snap.leaks;
    const head = el('div', { class: 'head' },
      el('div', {}, el('h2', { text: 'Datenlecks' }),
        el('p', { class: 'sub', text: 'Neue öffentliche Datenlecks, deine eigenen Adressen und ein sicherer Passwort-Check.' })),
      refreshBtn());

    const latest = section('Neuestes bekanntes Datenleck',
      b ? el('div', { class: 'svc' }, el('i', { class: 'dot warn' }),
        el('div', { class: 't' }, el('b', { text: `${b.title}${b.domain ? ' · ' + b.domain : ''}` }),
          el('p', { text: `${num(b.count)} Konten · Leak vom ${date(b.date)} · bekannt seit ${date(b.added)}` }),
          tags(b.classes), el('p', { text: b.text }), link('Bei Have I Been Pwned ansehen', b.link)))
        : el('div', { class: 'empty', text: snap.breach.error ? 'Nicht erreichbar: ' + snap.breach.error : snap.cfg.breaches ? 'Wird geladen …' : 'Ausgeschaltet.' }),
      toggle('breaches', 'Neue Datenlecks melden', 'Sudo sagt Bescheid, wenn Have I Been Pwned ein neues Leck aufnimmt (Prüfung alle 6 Stunden)'),
      (() => {
        const sel = el('select', { 'aria-label': 'Ab Größe', on: { change: async e => { const r = await host.config({ breachMin: Number(e.target.value) }); if (r.snap) snap = r.snap; } } });
        for (const [v, l] of [[0, 'alle'], [100000, 'ab 100.000 Konten'], [1000000, 'ab 1 Mio. Konten'], [10000000, 'ab 10 Mio. Konten']]) {
          const o = el('option', { value: v, text: l }); if (Number(snap.cfg.breachMin) === v) o.selected = true; sel.append(o);
        }
        return el('div', { class: 'row' }, text('Nur größere Lecks', 'Kleine Lecks werden nur hier angezeigt'), sel);
      })());

    // Eigene Adressen
    const area = el('textarea', { 'aria-label': 'E-Mail-Adressen', placeholder: 'name@firma.de\nprivat@beispiel.de', spellcheck: 'false' });
    area.value = emails.join('\n');
    const key = el('input', { type: 'password', 'aria-label': 'API-Schlüssel', placeholder: snap.hasKey ? `gespeichert (${snap.cfg.hibpKey})` : '32 Zeichen', autocomplete: 'off' });
    const msg = el('div', { class: 'msg' + (leakMsg.bad ? ' bad' : ''), text: leakMsg.text });
    const say = (t, bad) => { leakMsg.text = t; leakMsg.bad = !!bad; msg.textContent = t; msg.className = 'msg' + (bad ? ' bad' : ''); };
    const save = async () => {
      const c = { emails: area.value.split(/[\s,;]+/).filter(Boolean) };
      if (key.value.trim()) c.hibpKey = key.value.trim();
      const r = await host.config(c);
      if (!r.ok) { say(r.msg, true); return false; }
      emails = r.emails; if (r.snap) snap = r.snap;
      const dropped = c.emails.length - emails.length;
      say(dropped > 0 ? `Gespeichert. ${dropped} Eintrag/Einträge waren keine gültige Adresse.` : 'Gespeichert.', dropped > 0);
      return true;
    };
    const results = (L.results || []).map(r => el('div', { class: 'svc' }, el('i', { class: 'dot' + (r.breaches.length ? ' bad' : '') }),
      el('div', { class: 't' }, el('b', { text: r.mail }),
        el('p', { text: r.breaches.length ? `In ${r.breaches.length} Datenleck(s) gefunden:` : 'In keinem bekannten Datenleck gefunden.' }),
        ...r.breaches.slice(0, 8).map(x => el('div', { class: 'svc' }, el('div', { class: 't' },
          el('b', { text: `${x.title} · ${date(x.date)}` }, r.fresh.includes(x.name) ? el('span', { class: 'new', text: 'NEU' }) : null), tags(x.classes)))))));
    const own = section('Deine Adressen',
      el('div', { class: 'form' },
        el('p', { class: 'note' }, 'Die Abfrage einzelner Adressen kostet bei Have I Been Pwned einen API-Schlüssel (kleinster Tarif ca. 4,39 $ im Monat). ', link('Schlüssel holen', 'https://haveibeenpwned.com/API/Key'),
          '. Sudo prüft dann alle 12 Stunden und meldet neue Funde. Adressen und Schlüssel bleiben auf diesem PC.'),
        el('label', { class: 'note', text: 'E-Mail-Adressen (eine pro Zeile, höchstens 10)' }), area,
        el('label', { class: 'note', text: 'HIBP-API-Schlüssel' }), key,
        el('div', { class: 'line' }, btn('Speichern', save), btn('Jetzt prüfen', async () => {
          if (!(await save())) return;
          say('Prüfe … (etwa 7 Sekunden pro Adresse)');
          const r = await host.checkMails(); say(r.msg || '', !r.ok);
          snap = await host.get(); render();
        }, true), snap.hasKey ? btn('Schlüssel entfernen', async () => { const r = await host.config({ hibpKey: '' }); if (r.snap) snap = r.snap; say('Schlüssel entfernt.'); render(); }) : null),
        msg),
      L.at ? el('div', { class: 'row' }, text('Letzte Prüfung', `${date(L.at)} ${time(L.at)}`)) : null,
      ...results,
      el('div', { class: 'row' }, text('Ohne Schlüssel', 'Kostenlos im Browser prüfen. Beim HPI kommt das Ergebnis per E-Mail an die geprüfte Adresse.'),
        link('Have I Been Pwned', 'https://haveibeenpwned.com/'), link('HPI Identity Leak Checker', 'https://ilc.hpi.de/')));

    // Passwort-Check
    const pw = el('input', { type: 'password', 'aria-label': 'Passwort', placeholder: 'Passwort eingeben', autocomplete: 'off' });
    const out = el('div', { class: 'msg' });
    const check = async () => {
      if (!pw.value) return;
      out.className = 'msg'; out.textContent = 'Prüfe …';
      const r = await host.checkPassword(pw.value);
      pw.value = '';
      if (!r.ok) { out.className = 'msg bad'; out.textContent = r.msg; return; }
      if (r.count) { out.className = 'msg bad'; out.textContent = `Dieses Passwort taucht ${num(r.count)}× in Datenlecks auf. Bitte nicht verwenden!`; }
      else { out.className = 'msg'; out.textContent = 'In keinem bekannten Datenleck gefunden. Gut – aber einzigartig und lang bleibt Pflicht.'; }
    };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
    const pwd = section('Passwort prüfen',
      el('div', { class: 'form' },
        el('p', { class: 'note', text: 'Kostenlos und anonym: Nur die ersten 5 Zeichen des SHA-1-Hashes verlassen den PC (k-Anonymität). Das Passwort selbst wird weder gesendet noch gespeichert.' }),
        el('div', { class: 'line' }, pw, btn('Prüfen', check, true)), out));

    return [head, latest, own, pwd,
      el('p', { class: 'src' }, 'Daten: ', link('Have I Been Pwned', 'https://haveibeenpwned.com/'), ' (CC BY 4.0)')];
  }

  /* ---------- Reiter: Sicherheitswarnungen (RSS) ---------- */
  const SEV_ORDER = { kritisch: 4, hoch: 3, mittel: 2, niedrig: 1 };
  let feedFilter = 'alle';
  function feeds() {
    const F = snap.feeds || { items: [], status: {} }, c = snap.cfg;
    const names = Object.fromEntries((c.feeds || []).map(f => [f.id, f.name]));
    const minN = SEV_ORDER[feedFilter] || 0;
    const items = F.items.filter(i => !minN || (SEV_ORDER[i.sev] || 0) >= minN);
    const head = el('div', { class: 'head' },
      el('div', {}, el('h2', { text: 'Sicherheitswarnungen' }),
        el('p', { class: 'sub', text: 'Neue Schwachstellen und Warnungen aus RSS-Feeds, z. B. vom CERT-Bund des BSI. Sudo meldet sich mit einer klickbaren Blase.' })),
      refreshBtn());
    const filter = el('div', { class: 'seg', role: 'group', 'aria-label': 'Anzeigen ab' },
      ...[['alle', 'Alle'], ['mittel', 'ab mittel'], ['hoch', 'ab hoch'], ['kritisch', 'kritisch']].map(([v, l]) =>
        el('button', { 'aria-pressed': String(feedFilter === v), text: l, on: { click: () => { feedFilter = v; render(); } } })));
    const list = section('Neueste Meldungen',
      el('div', { class: 'row' }, text(F.at ? `Stand ${time(F.at)}` : 'Noch nicht abgefragt', `${items.length} von ${F.items.length} Meldungen`), filter),
      ...(items.length ? items.slice(0, 50).map(i => el('div', { class: 'svc' },
        el('span', { class: 'sev ' + (i.sev || 'info'), text: i.sev || 'info' }),
        el('div', { class: 't' }, el('b', { text: i.title }, i.state === 'UPDATE' ? el('span', { class: 'new', text: 'UPDATE' }) : null),
          el('p', { text: `${tr(names[i.feed] || '')}${i.date ? ' · ' + date(i.date) + ' ' + time(i.date) : ''}` }),
          i.link ? link('Artikel öffnen', i.link) : null)))
        : [el('div', { class: 'empty', text: (c.feeds || []).some(f => f.on) ? 'Noch keine Meldungen geladen.' : 'Kein Feed eingeschaltet.' })]));

    // Einstellungen
    const sel = (key, label, hint, opts) => {
      const s = el('select', { 'aria-label': label, on: { change: async e => { const r = await host.config({ [key]: isNaN(+e.target.value) ? e.target.value : +e.target.value }); if (r.snap) snap = r.snap; } } });
      for (const [v, l] of opts) { const o = el('option', { value: v, text: l }); if (String(c[key]) === String(v)) o.selected = true; s.append(o); }
      return el('div', { class: 'row' }, text(label, hint), s);
    };
    const feedRows = (c.feeds || []).map(f => {
      const st = (F.status || {})[f.id];
      const id = 'feed_' + f.id;
      const inp = el('input', { type: 'checkbox', id, 'aria-label': f.name, on: { change: async e => { const r = await host.config({ feedToggle: { id: f.id, on: e.target.checked } }); if (r.snap) snap = r.snap; render(); } } });
      inp.checked = !!f.on;
      const hint = !f.on ? f.url : st ? (st.ok ? `${st.count} Einträge · ${time(st.at)}` : `Fehler: ${st.error}`) : f.url;
      return el('div', { class: 'row' }, text(f.name, hint),
        /^f[0-9a-f]{8}$/.test(f.id) ? btn('Entfernen', async () => { const r = await host.config({ feedRemove: f.id }); if (r.snap) snap = r.snap; render(); }) : null,
        el('label', { class: 'sw', for: id }, inp, el('i')));
    });
    const fname = el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Name, z. B. Hersteller-Blog' });
    const furl = el('input', { type: 'text', 'aria-label': 'Feed-Adresse', placeholder: 'https://…/feed.xml', spellcheck: 'false' });
    const fmsg = el('div', { class: 'msg' });
    const words = el('input', { type: 'text', 'aria-label': 'Stichwörter', placeholder: 'z. B. Microsoft, Exchange, Fortinet, Sophos, Veeam', value: c.feedWords || '' });
    words.addEventListener('change', async () => { const r = await host.config({ feedWords: words.value }); if (r.snap) snap = r.snap; });
    const nid = 'sw_feedNewOnly', nOnly = el('input', { type: 'checkbox', id: nid, 'aria-label': 'Nur neue Warnungen', on: { change: async e => { const r = await host.config({ feedNewOnly: e.target.checked }); if (r.snap) snap = r.snap; } } });
    nOnly.checked = !!c.feedNewOnly;
    const settingsSec = section('Einstellungen',
      ...feedRows,
      el('div', { class: 'form' },
        el('label', { class: 'note', text: 'Eigenen Feed hinzufügen (RSS oder Atom)' }),
        el('div', { class: 'line' }, fname, furl, btn('Hinzufügen', async () => {
          const r = await host.config({ feedAdd: { name: fname.value, url: furl.value } });
          if (!r.ok) { fmsg.className = 'msg bad'; fmsg.textContent = r.msg; return; }
          if (r.snap) snap = r.snap; render();
        })), fmsg),
      sel('feedMin', 'Blase zeigen ab', 'Schweregrad laut CERT-Bund. Alles andere steht nur in der Liste.', [['kritisch', 'kritisch'], ['hoch', 'hoch'], ['mittel', 'mittel'], ['alle', 'alle Meldungen']]),
      el('div', { class: 'row' }, text('Nur neue Warnungen', 'Aktualisierungen ([UPDATE]) nicht extra melden'), el('label', { class: 'sw', for: nid }, nOnly, el('i'))),
      el('div', { class: 'form' }, el('label', { class: 'note', text: 'Nur bei diesen Stichwörtern melden (leer = alle). Bei Feeds ohne Schweregrad, z. B. BSI-News, meldet Sudo nur mit Stichwörtern oder bei „alle Meldungen“.' }), words),
      sel('feedSec', 'Blase stehen lassen', 'Mit der Maus darauf verlängert sie sich', [[5, '5 Sekunden'], [8, '8 Sekunden'], [10, '10 Sekunden']]));
    return [head, list, settingsSec, el('p', { class: 'src' }, 'Quelle der Vorgaben: ', link('BSI RSS-Feeds', 'https://www.bsi.bund.de/DE/Service-Navi/Abonnements/RSS/rss_node.html'))];
  }

  /* ---------- Reiter: Mein PC (Gerätezustand, 1.5) ---------- */
  let hsnap = await host.health();
  host.onHealth(s => { hsnap = s; if (tab === 'pc') render(); });
  const H_NAMES = { bitlocker: 'Verschlüsselung (BitLocker)', av: 'Virenschutz', fw: 'Firewall', updates: 'Windows-Update', reboot: 'Neustart', disk: 'Speicherplatz C:' };
  const H_HINT = {
    bitlocker: { bad: 'Geht der PC verloren, kann jeder die Festplatte lesen. Bitte der IT melden – die Verschlüsselung schaltet sie ein.', warn: 'Die Verschlüsselung ist nicht vollständig aktiv. Bitte der IT melden.' },
    av: { bad: 'Ohne Virenschutz ist der PC ungeschützt. Bitte sofort der IT melden.', warn: 'In der Windows-Sicherheit nach Updates suchen lassen.' },
    fw: { bad: 'Ohne Firewall ist der PC aus dem Netzwerk angreifbar. Bitte der IT melden.', warn: 'In einem Netzwerkprofil ist die Firewall aus. Bitte der IT melden.' },
    updates: { bad: 'Sicherheitsupdates fehlen. Windows Update öffnen und nach Updates suchen – oder die IT fragen.', warn: 'Windows Update öffnen und nach Updates suchen.' },
    reboot: { warn: 'Ein Neustart schließt Updates ab. Am besten vor der Pause neu starten.' },
    disk: { bad: 'Fast kein Platz mehr – Downloads und Papierkorb leeren oder die IT fragen.', warn: 'Downloads und Papierkorb aufräumen, Speicheroptimierung nutzen.' }
  };
  const H_FIX = { av: [['Windows-Sicherheit öffnen', 'windowsdefender://threat']], fw: [['Windows-Sicherheit öffnen', 'windowsdefender://network']],
    updates: [['Windows Update öffnen', 'ms-settings:windowsupdate']], reboot: [['Windows Update öffnen', 'ms-settings:windowsupdate']], disk: [['Speicher öffnen', 'ms-settings:storagesense']] };
  const H_SUM = { ok: 'Alles im grünen Bereich.', warn: 'Ein paar Dinge solltest du dir ansehen.', bad: 'Hier stimmt etwas nicht – bitte kümmern oder der IT melden.', unknown: 'Noch nicht geprüft.' };
  function pc() {
    const h = hsnap || { overall: 'unknown', items: {} };
    const head = el('div', { class: 'head' },
      el('div', {}, el('h2', { text: 'Mein PC' }),
        el('p', { class: 'sub', text: 'Sudo prüft alle paar Stunden, ob dein PC gut geschützt ist – ohne Administratorrechte. Was hier steht, bleibt auf dem PC; die Zentrale deiner IT sieht höchstens die Ampel.' })),
      el('div', { style: 'display:flex;gap:8px;flex:none' }, btn('Selbsthilfe …', () => host.open('sudo:hilfe')),
        btn('Jetzt prüfen', async () => { const r = await host.healthCheck(); if (r) hsnap = r; render(); })));
    const sum = el('div', { class: 'ampel' }, el('span', { class: 'big-dot ' + h.overall }),
      el('div', {}, el('div', { class: 'big', text: tr(H_SUM[h.overall] || H_SUM.unknown) }),
        el('div', { class: 'stamp', text: h.checked ? tr('Geprüft um {t} Uhr').replace('{t}', time(h.checked)) : (h.running ? tr('Prüfung läuft …') : tr('Die erste Prüfung startet kurz nach dem Start von Sudo.')) })));
    const rows = Object.keys(H_NAMES).map(k => {
      const it = h.items[k] || { state: 'unknown' };
      const hint = (H_HINT[k] || {})[it.state];
      const fixes = it.state === 'ok' || it.state === 'unknown' ? [] : (H_FIX[k] || []);
      return el('div', { class: 'svc' }, el('span', { class: 'dot ' + (it.state === 'ok' ? '' : it.state) }),
        el('div', { class: 't' }, el('b', { text: H_NAMES[k] }),
          el('p', { text: it.state === 'unknown' ? tr('Konnte nicht geprüft werden.') : tr(it.detail || '') + (hint ? '\n' + tr(hint) : '') }),
          fixes.length ? el('div', { class: 'fix' }, fixes.map(([l, u]) => el('button', { class: 'act', text: l, on: { click: () => host.open(u) } }))) : null));
    });
    return [head, el('section', {}, sum), section('Prüfungen', ...rows)];
  }

  const TABS = { pc, status, feeds, leaks };
  function render() {
    if (!snap) { main.textContent = 'IT-Lage startet noch …'; return; }
    if (!TABS[tab]) tab = 'status';
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const y = main.scrollTop;
    main.replaceChildren(...TABS[tab]().filter(Boolean));
    main.scrollTop = y;
    const bad = snap.m365.items.filter(s => !s.ok).length + snap.azure.items.length;
    document.getElementById('ver').textContent = bad ? `${bad} Störung(en)` : 'Alles ruhig';
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; main.scrollTop = 0; render(); }));
  // Live-Aktualisierung nicht während der Eingabe (sonst geht Getipptes verloren)
  host.onUpdate(s => { snap = s; const a = document.activeElement; if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  ready = true;
  render();
})();
