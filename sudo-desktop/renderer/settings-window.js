// settings-window.js – Einstellungs-Zentrale
(async () => {
  'use strict';
  const host = window.centerHost;
  const main = document.getElementById('main');
  let tab = 'general', pendingTab = null;
  host.onTab(t => { pendingTab = t; });     // kann schon vor der ersten Abfrage kommen
  let snap = await host.get();
  if (pendingTab) tab = pendingTab;

  /* ---------- kleine Bausteine ---------- */
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && c !== false && e.append(c));
    return e;
  };
  const S = () => snap.settings;
  async function set(key, value) {
    const r = await host.set(key, value);
    if (r && r.snap) snap = r.snap;
  }
  const text = (title, hint) => el('div', { class: 't' }, el('b', { text: title }), hint ? el('small', { text: hint }) : null);
  const toggle = (key, title, hint, value) => {
    const id = 'sw_' + key.replace(/\W/g, '_');
    const inp = el('input', { type: 'checkbox', id, 'aria-label': title, on: { change: e => set(key, e.target.checked) } });
    inp.checked = !!value;
    return el('div', { class: 'row' }, text(title, hint), el('label', { class: 'sw', for: id }, inp, el('i')));
  };
  const segmented = (key, title, hint, value, opts) => {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': title });
    for (const [v, l] of opts) {
      seg.append(el('button', { 'aria-pressed': String(v === value), text: l, on: { click: async () => { await set(key, v); render(); } } }));
    }
    return el('div', { class: 'row' }, text(title, hint), seg);
  };
  const button = (title, hint, label, action, arg, primary) => {
    const msg = el('div', { class: 'msg' });
    const b = el('button', { class: 'act' + (primary ? ' primary' : ''), text: label, on: { click: async () => {
      b.disabled = true;
      try {
        const r = await host.action(action, arg);
        if (r && r.msg) { msg.textContent = r.msg; msg.className = 'msg' + (r.ok === false ? ' bad' : ''); }
      } finally { b.disabled = false; }
    } } });
    return el('div', { class: 'row' }, el('div', { class: 't' }, el('b', { text: title }), hint ? el('small', { text: hint }) : null, msg), b);
  };
  const section = (title, ...rows) => el('section', {}, el('h3', { text: title }), ...rows);

  /* ---------- Sudo-Zentrale (Firmen-Server) ---------- */
  function zentraleSection() {
    const z = snap.zentrale || {};
    const msg = el('div', { class: 'msg' });
    const done = r => { msg.className = 'msg' + (r && r.ok === false ? ' bad' : ''); msg.textContent = (r && r.msg) || ''; };
    if (z.enrolled) {
      return section('Sudo-Zentrale',
        el('div', { class: 'row' }, text(z.name || 'Dieser PC', `${z.url}${z.groups && z.groups.length ? ' · Gruppen: ' + z.groups.join(', ') : ''}${z.error && !z.online ? ' · ' + z.error : ''}`),
          el('span', { class: 'pill' + (z.online ? ' ok' : ' bad'), text: z.online ? 'verbunden' : 'getrennt' })),
        el('div', { class: 'row' }, text('Meldungen der Firma', z.transport === 'poll' ? `Sudo fragt alle ${z.pollSec} Sekunden nach (Webspace-Zentrale). Auch Frag Sudo kann darüber laufen (Reiter KI).` : 'Kommen sofort per WebSocket, auch Frag Sudo kann darüber laufen (Reiter KI).'),
          el('button', { class: 'act', text: 'Neu verbinden', on: { click: async () => done(await host.action('zentraleReconnect')) } }),
          el('button', { class: 'act', text: 'Abmelden', on: { click: async () => { if (!confirm(tr('Diesen PC wirklich von der Zentrale abmelden? Für eine neue Anmeldung braucht es wieder einen Registrierungscode.'))) return; done(await host.action('zentraleLeave')); snap = await host.get(); render(); } } })),
        msg);
    }
    const url = el('input', { type: 'text', class: 'inp', 'aria-label': 'Adresse der Zentrale', placeholder: 'https://sudo.meikosoft.net', value: z.url || '' });
    const code = el('input', { type: 'text', class: 'inp', 'aria-label': 'Registrierungscode', placeholder: 'SZ-XXXX-XXXX-XXXX-XXXX', autocomplete: 'off' });
    return section('Sudo-Zentrale',
      el('div', { class: 'form' },
        el('p', { class: 'note', text: 'Verbindet Sudo mit dem Server deiner Firma: Meldungen an alle, Ereignisse aus Skripten und Frag Sudo ohne eigenen Schlüssel. Den Registrierungscode gibt es in der Verwaltung der Zentrale.' }),
        el('div', { class: 'line' }, url), el('div', { class: 'line' }, code,
          el('button', { class: 'act primary', text: 'Anmelden', on: { click: async e => { e.target.disabled = true; const r = await host.action('zentraleEnroll', { url: url.value, code: code.value }); e.target.disabled = false; done(r); if (r.ok) { snap = await host.get(); setTimeout(render, 800); } } } })),
        z.error ? el('div', { class: 'msg bad', text: z.error }) : null, msg));
  }
  const tr = x => (window.I18N ? I18N.t(x) : x);

  /* ---------- Reiter ---------- */
  const TABS = {
    general() {
      const disp = el('select', { 'aria-label': 'Startbildschirm', on: { change: e => set('displayId', Number(e.target.value)) } },
        ...snap.displays.map(d => { const o = el('option', { value: d.id, text: d.label }); if (String(d.id) === String(S().displayId)) o.selected = true; return o; }));
      return [
        el('h2', { text: 'Allgemein' }), el('p', { class: 'sub', text: 'Aussehen, Start und Bildschirme.' }),
        section('Sprache',
          (() => {
            const sel = el('select', { 'aria-label': 'Sprache', 'data-noi18n': true, on: { change: e => set('lang', e.target.value) } },
              ...[['auto', 'Automatisch (wie Windows) · Auto · 自動'], ['de', 'Deutsch'], ['en', 'English'], ['ja', '日本語 (Japanisch)']]
                .map(([v, l]) => { const o = el('option', { value: v, text: l }); if ((S().lang || 'auto') === v) o.selected = true; return o; }));
            return el('div', { class: 'row' }, text('Sprache · Language · 言語', 'Fenster, Menü und Sudos Sprüche. Wechselt sofort.'), sel);
          })()),
        section('Sudo',
          segmented('size', 'Größe', 'Klein 48 px, Normal 96 px, Groß 144 px', S().size, [['klein', 'Klein'], ['normal', 'Normal'], ['gross', 'Groß']]),
          segmented('contrastMode', 'Umriss für dunkle Hintergründe', 'Der schwarze Ninja bekommt einen hellen Rand. „Automatisch“ = wenn Windows auf dunkles Design gestellt ist' + (S().darkTheme ? ' (gerade: dunkel)' : ' (gerade: hell)') + '.', (S().contrast || {}).mode || 'auto', [['auto', 'Automatisch'], ['always', 'Immer'], ['off', 'Aus']]),
          ((S().contrast || {}).mode || 'auto') !== 'off' ? segmented('contrastStyle', 'Art des Umrisses', 'Pixel-Rand oder weiches Leuchten', (S().contrast || {}).style || 'outline', [['outline', 'Pixel-Rand'], ['glow', 'Leuchten']]) : null,
          ((S().contrast || {}).mode || 'auto') !== 'off' ? segmented('contrastColor', 'Farbe des Umrisses', 'Rangfarbe = Farbe des Gürtels', (S().contrast || {}).color || 'white', [['white', 'Weiß'], ['teal', 'Türkis'], ['gold', 'Gold'], ['rank', 'Rangfarbe']]) : null,
          toggle('sound', 'Töne', 'Kleine 8-Bit-Geräusche bei Reaktionen', S().sound),
          toggle('autostart', 'Mit Windows starten', 'Sudo startet nach der Anmeldung automatisch', S().autostart)),
        section('Sprechblase',
          segmented('bubbleFont', 'Schrift', 'Pixelschrift passt zum Ninja, die klare Schrift ist leichter zu lesen', (S().bubble || {}).font || 'pixel', [['pixel', 'Pixel'], ['clear', 'Klar lesbar']]),
          segmented('bubbleSize', 'Textgröße', 'Größere Schrift und breitere Blase', (S().bubble || {}).size || 'normal', [['normal', 'Normal'], ['large', 'Groß']]),
          segmented('bubbleTime', 'Anzeigedauer', 'Immer mindestens so lange, wie man zum Lesen braucht. „Bis Klick“: Meldungen und Erinnerungen bleiben, bis du sie anklickst.', (S().bubble || {}).time || 'normal', [['normal', 'Normal'], ['long', 'Länger'], ['xlong', 'Lang'], ['click', 'Bis Klick']]),
          button('Vorschau', 'Sudo zeigt eine Beispiel-Blase mit diesen Einstellungen', 'Zeigen', 'bubbleTest')),
        section('Bildschirme',
          el('div', { class: 'row' }, text('Startbildschirm', 'Hier taucht Sudo nach dem Start auf'), disp),
          toggle('roam', 'Zwischen Bildschirmen wandern', 'Sudo läuft ab und zu über die Bildschirmkante zum Nachbarmonitor. „Sudo rufen“ holt ihn immer zum Mauszeiger.', S().roam)),
        section('Leistung',
          segmented('eco', 'Sparmodus', `Weniger Bilder pro Sekunde und seltenere Prüfungen. „Bei Akku“ schaltet automatisch um.${snap.eco ? ' Gerade aktiv.' : ''}`, S().eco,
            [['auto', 'Bei Akku'], ['on', 'Immer'], ['off', 'Aus']]))
      ];
    },
    deck() {
      const d = S().deck || { on: true, builtin: [], custom: [] };
      const msg = el('div', { class: 'msg' });
      const name = el('input', { type: 'text', class: 'inp', maxlength: 24, placeholder: 'z. B. Kundenportal', 'aria-label': 'Name' });
      const target = el('input', { type: 'text', class: 'inp', maxlength: 400, placeholder: 'C:\\Tools\\putty.exe  ·  \\\\server\\share  ·  https://…', 'aria-label': 'Ziel' });
      const args = el('input', { type: 'text', class: 'inp', maxlength: 300, placeholder: 'optional, z. B. -load "Kunde A"', 'aria-label': 'Argumente' });
      const adm = el('input', { type: 'checkbox', id: 'deck_adm' });
      const pick = el('button', { class: 'act', type: 'button', text: 'Durchsuchen …', on: { click: async () => {
        const r = await host.action('deckPick');
        if (r && r.ok && r.path) { target.value = r.path; if (!name.value) name.value = r.path.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|ps1|msc)$/i, '').slice(0, 24); }
      } } });
      const add = el('button', { class: 'act primary', type: 'button', text: 'Hinzufügen', on: { click: async () => {
        if (!target.value.trim()) { msg.className = 'msg bad'; msg.textContent = tr('Bitte ein Ziel angeben.'); return; }
        const before = (S().deck.custom || []).length;
        await set('deckAdd', { name: name.value, target: target.value, args: args.value, admin: adm.checked });
        if ((S().deck.custom || []).length === before) { msg.className = 'msg bad'; msg.textContent = tr('Nicht hinzugefügt: Ziel nicht erlaubt oder schon 8 eigene Einträge.'); return; }
        render();
      } } });
      const full = (d.custom || []).length >= 8;
      return [
        el('h2', { text: 'Ninja-Leiste' }),
        el('p', { class: 'sub', text: 'Mit der mittleren Maustaste (Mausrad drücken) auf Sudo klappt die Leiste auf – Schnellstart für Konsole, Tools und eigene Programme. Höchstens 12 Einträge.' }),
        section('Leiste',
          toggle('deckOn', 'Ninja-Leiste aktiv', 'Mittlere Maustaste auf Sudo öffnet die Leiste', d.on !== false)),
        d.on === false ? null : section('Mitgeliefert',
          ...(S().deckBuiltin || []).map(b => {
            const id = 'deck_' + b.id, inp = el('input', { type: 'checkbox', id, 'aria-label': b.name, on: { change: e => set('deckBuiltin', { id: b.id, on: e.target.checked }) } });
            inp.checked = d.builtin.includes(b.id);
            return el('div', { class: 'row' }, text(b.name, b.admin ? 'Startet mit Administratorrechten (Windows fragt nach)' : null), el('label', { class: 'sw', for: id }, inp, el('i')));
          })),
        d.on === false ? null : section('Eigene Einträge',
          ...(d.custom || []).map(c => el('div', { class: 'row' },
            el('div', { class: 't', 'data-noi18n': '' }, el('b', { text: c.name + (c.admin ? ' (Admin)' : '') }), el('small', { text: c.target + (c.args ? '  ' + c.args : '') })),
            el('button', { class: 'act', type: 'button', text: 'Entfernen', on: { click: async () => { await set('deckDel', c.id); render(); } } }))),
          (d.custom || []).length ? null : el('p', { class: 'note', text: 'Noch keine eigenen Einträge.' }),
          full ? el('p', { class: 'note', text: 'Höchstens 8 eigene Einträge.' }) : el('div', { class: 'form' },
            el('div', { class: 'line' }, el('label', { text: 'Name' }), name),
            el('div', { class: 'line' }, el('label', { text: 'Programm, Ordner, Datei oder Link' }), target, pick),
            el('div', { class: 'line' }, el('label', { text: 'Argumente' }), args),
            el('div', { class: 'line' }, el('label', { class: 'chk', for: 'deck_adm' }, adm, ' ', tr('Als Administrator starten'))),
            el('div', { class: 'line' }, add, msg)),
          el('p', { class: 'note', text: 'Links öffnen im Browser (https, mailto, ms-settings: …). Ordner und Dokumente öffnen mit dem passenden Programm. Gestartet wird immer nur, was hier eingetragen ist.' }))
      ];
    },
    behavior() {
      return [
        el('h2', { text: 'Verhalten' }), el('p', { class: 'sub', text: 'Was Sudo von sich aus tut.' }),
        section('Arbeit & Meetings',
          toggle('meetingQuiet', 'Im Meeting still sein', 'Bei Teams-, Zoom- und Webex-Meetings keine Töne und keine Plauderei', S().meetingQuiet),
          toggle('hideFromCapture', 'Bei Bildschirmfreigabe unsichtbar', 'Sudo erscheint nicht in geteilten Bildschirmen, Aufnahmen und Screenshots', S().hideFromCapture),
          toggle('notify', 'Windows-Benachrichtigung bei Erinnerungen', 'Zusätzlich zu Sudos Schild', S().notify),
          el('div', { class: 'row' }, text('Arbeitstag, Pausen & besondere Tage', 'Arbeitsbeginn, feste Pausen, Aufsteh- und Augenpausen, Geburtstag, Jubiläum'),
            el('button', { class: 'act', text: 'Öffnen …', on: { click: () => host.action('work') } }))),
        section('Persönlichkeit',
          toggle('appComments', 'Programme kommentieren', 'Gelegentliche Sprüche zu Outlook, Teams, VS Code, Admin-Centern …', S().appComments),
          toggle('bugs', 'Bugs krabbeln lassen', 'Ab und zu krabbelt ein Bug über den Bildschirm, den Sudo erledigt', S().bugs),
          toggle('seasonal', 'Saisonale Hüte & Effekte', 'Schnee im Dezember, Feuerwerk an Silvester, Ostereier …', S().special ? S().special.seasonal !== false : true),
          toggle('toy', 'Ball zum Spielen', 'Ein Stressball, den Sudo herumkickt', S().toy)),
        // 1.10: Sperr-Erinnerung und Tipps im passenden Moment (alles nur lokal)
        (() => {
          const h = S().habits || { lockHint: true, tips: 'normal' };
          return section('Gute Gewohnheiten',
            toggle('lockHint', 'An Win+L erinnern', 'Warst du länger als 10 Minuten weg und der Bildschirm war offen, erinnert Sudo dich beim Zurückkommen – höchstens einmal am Tag. Hast du gesperrt, gibt es ein Lob.', h.lockHint !== false),
            h.tipsManaged ? el('p', { class: 'note', text: 'Deine IT hat die Tipps ausgeschaltet.' })
              : segmented('tipsFreq', 'Tipps im passenden Moment', 'Hast du Excel, Outlook, Teams & Co. eine Weile vorne, zeigt Sudo ab und zu ein Tastenkürzel oder einen Kniff. Nie im Meeting.', h.tips || 'normal', [['off', 'Aus'], ['rare', 'Selten'], ['normal', 'Normal']]),
            h.tipsManaged ? null : el('div', { class: 'row' }, text('Tipp jetzt zeigen', 'Zum Ausprobieren'), el('button', { class: 'act', text: 'Zeigen', on: { click: () => host.action('tipTest') } })));
        })(),
        // 1.11: Aufbewahrungsdauer des Verlaufs (bleibt lokal; kürzer stellen löscht sofort)
        section('Verlauf „Was hat Sudo gesagt?“',
          segmented('historyDays', 'Meldungen aufheben', 'Ältere Meldungen löscht Sudo von selbst; kürzer oder „Aus“ löscht sofort. Bleibt auf diesem PC, geht nie an die Zentrale.',
            (S().history || { days: 30 }).days, [[0, 'Aus'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '1 Jahr']]),
          el('div', { class: 'row' }, text('Verlauf öffnen', tr('{n} Einträge').replace('{n}', (S().history || {}).n || 0)), el('button', { class: 'act', text: 'Öffnen', on: { click: () => host.action('openHistory') } }))),
        (() => {
          const q = S().quiz || { on: true, perWeek: 2 };
          const start = el('div', { class: 'row' }, text('Jetzt eine Frage', q.answered ? tr('Bisher {r} von {n} richtig.').replace('{r}', q.right || 0).replace('{n}', q.answered) : 'Ein bis drei Fragen, dauert eine Minute'),
            el('button', { class: 'act', text: 'Quiz starten …', on: { click: () => host.action('quiz') } }));
          if (q.managed) return section('Security-Quiz', el('p', { class: 'note', text: q.on ? tr('Deine IT hat das Quiz eingeschaltet: {n}× pro Woche fragt Sudo kurz nach.').replace('{n}', q.perWeek) : 'Deine IT hat das Quiz ausgeschaltet.' }), start);
          return section('Security-Quiz',
            toggle('quizOn', 'Sicherheitsfragen von Sudo', 'Ab und zu eine kurze Frage zu Phishing, Passwörtern & Co. – zu Bürozeiten, nie im Meeting', q.on !== false),
            q.on !== false ? segmented('quizPerWeek', 'Wie oft?', 'Nicht angenommene Fragen bietet Sudo später noch einmal an', String(q.perWeek || 2), [['1', '1× pro Woche'], ['2', '2× pro Woche'], ['5', 'Täglich']]) : null,
            start);
        })(),
        section('YouTube-Videos',
          toggle('mediaVideos', 'Videos von Kanälen der IT', 'Deine IT kann YouTube-Kanäle für alle eintragen. Erscheint dort ein neues Video, zeigt Sudo es als Sprechblase – ein Klick öffnet es. Läuft über die Sudo-Zentrale.', (S().media || {}).videos !== false),
          ...(() => {
            // 1.8.1: eigene Kanäle – der PC fragt die öffentlichen Feeds selbst ab
            const m = S().media || {}, list = m.channels || [], max = m.max || 10;
            const msg = el('div', { class: 'msg' });
            const inp = el('input', { type: 'text', class: 'inp', maxlength: 200, placeholder: 'https://www.youtube.com/@kanal  ·  @kanal  ·  UC…', 'aria-label': 'YouTube-Kanal' });
            const upd = r => { if (r && r.media) snap.settings.media = r.media; };
            const add = el('button', { class: 'act primary', type: 'button', text: 'Hinzufügen', on: { click: async () => {
              if (!inp.value.trim()) { msg.className = 'msg bad'; msg.textContent = tr('Bitte einen Kanal-Link, ein @Handle oder eine Kanal-ID (UC…) eintragen.'); return; }
              add.disabled = true; msg.className = 'msg'; msg.textContent = tr('Suche Kanal …');
              const r = await host.action('ytAdd', inp.value.trim()); add.disabled = false; upd(r);
              if (!r.ok) { msg.className = 'msg bad'; msg.textContent = r.msg; return; }
              render(); setTimeout(() => { const n = document.getElementById('yt_msg'); if (n) n.textContent = r.msg; }, 0);
            } } });
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') add.click(); });
            msg.id = 'yt_msg';
            const ago = t => { if (!t) return tr('noch nicht geprüft'); const mn = Math.round((Date.now() - t) / 60000); return mn < 1 ? tr('gerade geprüft') : tr('vor {x} min geprüft').replace('{x}', mn); };
            return [
              el('div', { class: 'row' }, text('Eigene Kanäle', tr('Nur für dich: Sudo schaut alle 15 Minuten nach neuen Videos. Dein PC fragt dafür die öffentlichen Kanal-Feeds direkt bei YouTube ab – ohne Anmeldung. Höchstens {x} Kanäle.').replace('{x}', max))),
              ...list.map(c => {
                const id = 'yts_' + c.id, sw = el('input', { type: 'checkbox', id, 'aria-label': 'Shorts', on: { change: async e => upd(await host.action('ytShorts', { id: c.id, on: e.target.checked })) } });
                sw.checked = !!c.shorts;
                return el('div', { class: 'row' },
                  el('div', { class: 't', 'data-noi18n': '' }, el('b', { text: c.title }), el('small', { text: (c.handle ? c.handle + ' · ' : '') + (c.error ? tr(c.error) : ago(c.checked)) })),
                  el('label', { class: 'chk', for: id, style: 'margin-right:10px' }, sw, ' ', tr('Shorts')),
                  el('button', { class: 'act', type: 'button', text: 'Entfernen', on: { click: async () => { upd(await host.action('ytRemove', c.id)); render(); } } }));
              }),
              list.length >= max ? el('p', { class: 'note', text: tr('Höchstens {x} eigene Kanäle.').replace('{x}', max) })
                : el('div', { class: 'form' }, el('div', { class: 'line' }, el('label', { text: 'Kanal' }), inp, add), el('div', { class: 'line' }, msg)),
              list.length ? el('div', { class: 'row' }, text('Jetzt nachsehen', 'Alle eigenen Kanäle sofort prüfen'), (() => {
                const b = el('button', { class: 'act', type: 'button', text: 'Prüfen', on: { click: async () => { b.disabled = true; const r = await host.action('ytCheck'); b.disabled = false; upd(r); render(); setTimeout(() => { const n = document.getElementById('yt_msg'); if (n) n.textContent = r.msg; }, 0); } } });
                return b; })()) : null
            ];
          })()),
        section('Besuche von Kollegen',
          toggle('visitsAllow', 'Besuche erlauben', 'Sudos von Kollegen dürfen vorbeikommen: Post-it, Geschenk, Bug oder Duell. Höchstens ein paar Mal am Tag, nie im Meeting. Läuft über die Sudo-Zentrale.', (S().visits || {}).allow !== false),
          (() => {
            const inp = el('input', { type: 'text', class: 'inp', maxlength: 30, 'aria-label': 'Name auf dem Namensschild', placeholder: S().visitNameDefault || '', value: (S().visits || {}).name || '' });
            inp.addEventListener('change', () => set('visitName', inp.value));
            return el('div', { class: 'row' }, text('Name auf dem Namensschild', 'So heißt dein Sudo bei anderen („Sudo von …“). Leer = Windows-Benutzername.'), el('div', { style: 'width:200px' }, inp));
          })(),
          el('div', { class: 'row' }, text('Selbst jemanden besuchen', 'Tray → Auf Besuch schicken …'), el('button', { class: 'act', text: 'Öffnen …', on: { click: () => host.action('visit') } })))
      ];
    },
    watch() {
      const w = S().watch || {};
      const rows = [['internet', 'Internet weg / wieder da', 'Zweimal hintereinander geprüft, damit kurze Aussetzer nicht nerven'],
        ['vpn', 'VPN verbunden / getrennt', 'NetBird, WireGuard, OpenVPN, FortiClient, AnyConnect, GlobalProtect, Tailscale …'],
        ['battery', 'Akku niedrig', 'Hinweis bei 20 % und 7 %'], ['disk', 'Speicherplatz knapp', 'Unter 10 % oder 10 GB frei, einmal pro Tag'],
        ['load', 'CPU / Arbeitsspeicher am Limit', 'Eine Minute lang über 90 % bzw. 92 %'], ['reboot', 'Neustart nach Updates', 'Wenn Windows auf einen Neustart wartet'],
        ['uptime', 'PC läuft seit über 7 Tagen', 'Einmal am Tag'],
        ['health', 'Gerätezustand', 'BitLocker, Virenschutz, Firewall und Windows-Updates – Hinweis höchstens einmal am Tag']];
      return [el('h2', { text: 'System-Wächter' }), el('p', { class: 'sub', text: 'Sudo beobachtet deinen PC und meldet sich, wenn etwas nicht stimmt. Alles bleibt lokal – nur die Ampel des Gerätezustands geht an die Sudo-Zentrale, wenn eure IT das eingeschaltet hat.' }),
        section('Meldungen', ...rows.map(([k, t, h]) => toggle('watch.' + k, t, h, w[k] !== false))),
        section('Gerätezustand', el('div', { class: 'row' }, text('Mein PC', 'Alle Prüfungen mit Ampel und Tipps'), el('button', { class: 'act', text: 'Ansehen …', on: { click: () => host.action('lage', 'pc') } })))];
    },
    ai() {
      const a = snap.ai || { mode: 'off', today: { q: 0, usd: 0 } }, z = snap.zentrale || {};
      const ct = v => (v * 100).toLocaleString(window.I18N ? I18N.locale : 'de-DE', { maximumFractionDigits: 2 }) + ' ct';
      const key = el('input', { type: 'password', class: 'inp', 'aria-label': 'Claude-API-Schlüssel', placeholder: a.hasKey ? 'gespeichert – zum Ändern neu eingeben' : 'sk-ant-…', autocomplete: 'off' });
      const kmsg = el('div', { class: 'msg' });
      const saveKey = async v => { const r = await host.action('aiConfig', { key: v }); kmsg.className = 'msg' + (r.ok ? '' : ' bad'); kmsg.textContent = r.ok ? (v ? 'Schlüssel verschlüsselt gespeichert.' : 'Schlüssel entfernt.') : r.msg; if (r.ok) { snap = await host.get(); setTimeout(render, 900); } };
      const aiSet = async (k, v) => { await host.action('aiConfig', { [k]: v }); snap = await host.get(); render(); };
      const seg = (k, title, hint, value, opts) => {
        const g = el('div', { class: 'seg', role: 'group', 'aria-label': title });
        for (const [v, l] of opts) g.append(el('button', { 'aria-pressed': String(v === value), text: l, on: { click: () => aiSet(k, v) } }));
        return el('div', { class: 'row' }, text(title, hint), g);
      };
      const ctx = el('input', { type: 'checkbox', id: 'sw_ai_ctx', 'aria-label': 'IT-Lage mitschicken', on: { change: e => aiSet('context', e.target.checked) } });
      ctx.checked = a.context !== false;
      const limit = el('select', { 'aria-label': 'Tageslimit', on: { change: e => aiSet('dailyUsd', Number(e.target.value)) } },
        ...[[0.1, '10 ct'], [0.25, '25 ct'], [0.5, '50 ct'], [1, '1 $'], [5, '5 $'], [0, 'ohne Limit']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (Number(a.dailyUsd) === v) o.selected = true; return o; }));
      return [
        el('h2', { text: 'KI: Frag Sudo' }),
        el('p', { class: 'sub', text: 'Sudo beantwortet Fragen mit Claude (Anthropic). Strg+Alt+S öffnet das Fragefenster. Es wird nur der Verbrauch gezählt, Fragen und Antworten speichert Sudo nicht.' }),
        section('Verbindung',
          seg('mode', 'Antworten über', 'Eigener Schlüssel: Abrechnung über dein Anthropic-Konto. Zentrale: Schlüssel und Budget liegen auf dem Server deiner Firma.', a.mode,
            [['off', 'Aus'], ['key', 'Eigener Schlüssel'], ['zentrale', 'Sudo-Zentrale']]),
          a.mode === 'key' ? el('div', { class: 'form' },
            el('label', { class: 'note', text: 'Claude-API-Schlüssel (console.anthropic.com → API Keys). Wird mit Windows verschlüsselt gespeichert und nicht mitgesichert.' }),
            el('div', { class: 'line' }, key, el('button', { class: 'act primary', text: 'Speichern', on: { click: () => saveKey(key.value) } }),
              a.hasKey ? el('button', { class: 'act', text: 'Entfernen', on: { click: () => saveKey('') } }) : null), kmsg) : null,
          a.mode === 'zentrale' ? el('div', { class: 'row' }, text('Sudo-Zentrale', z.enrolled ? `${z.url} · ${z.online ? 'verbunden' : 'nicht verbunden'}` : 'Noch nicht angemeldet – siehe Daten & Verbindungen'),
            el('span', { class: 'pill' + (z.online ? ' ok' : ''), text: z.online ? 'online' : 'offline' })) : null),
        a.mode !== 'off' ? section('Antworten',
          seg('model', 'Modell', 'Schnell = Claude Haiku 5.5 (Bruchteile eines Cents pro Frage). Schlau = Claude Sonnet 5.5 (etwa 20-mal teurer). Im Fragefenster umschaltbar.', a.model, [['haiku', 'Schnell'], ['sonnet', 'Schlau']]),
          el('div', { class: 'row' }, text('IT-Lage mitschicken', 'Uhrzeit, Microsoft-/Azure-Störungen und neue Sicherheitswarnungen als Hintergrund. Nie Tasten oder Fenstertitel.'), el('label', { class: 'sw', for: 'sw_ai_ctx' }, ctx, el('i'))),
          a.mode === 'key' ? el('div', { class: 'row' }, text('Tageslimit', 'Danach macht Sudo bis morgen Pause'), limit) : null) : null,
        a.mode !== 'off' ? section('Verbrauch',
          el('div', { class: 'row' }, text('Heute', `${a.today.q} Fragen · ${a.today.in + a.today.out} Token`), el('b', { text: ct(a.today.usd) })),
          el('div', { class: 'row' }, text('Dieser Monat', 'Laut Sudos Zählung, maßgeblich ist die Abrechnung bei Anthropic'), el('b', { text: ct(a.monthUsd || 0) })),
          el('div', { class: 'row' }, text('Fragefenster', 'Strg+Alt+S oder Tray → Frag Sudo'), el('button', { class: 'act', text: 'Öffnen …', on: { click: () => host.action('ask') } }))) : null,
        el('p', { class: 'sub', text: 'Hinweis: Fragen gehen an die Claude-API von Anthropic. Bitte keine Passwörter, Zugangsdaten oder Kundendaten eingeben.' })
      ];
    },
    data() {
      const r = snap.relay || {};
      return [
        el('h2', { text: 'Daten & Verbindungen' }), el('p', { class: 'sub', text: `Alle Daten liegen auf diesem PC unter ${snap.info.dataDir}.` }),
        section('Transparenz',
          el('div', { class: 'row' }, text('Was weiß Sudo über mich?', 'Was Sudo bemerkt, speichert und was den PC verlässt – mit Datenauskunft zum Speichern'), el('button', { class: 'act primary', text: 'Ansehen …', on: { click: () => host.action('privacy') } }))),
        section('Sichern & Wiederherstellen',
          button('Sicherung erstellen', 'Rang, Erfolge, Garderobe, Einstellungen, Erinnerungen und Bildschirmzeit in eine Datei. Enthält auch den Relay-Lese-Token, also sicher aufbewahren.', 'Sichern …', 'export', null, true),
          button('Aus Sicherung wiederherstellen', 'Zum Beispiel auf einem neuen PC. Sudo startet danach neu.', 'Wiederherstellen …', 'import'),
          button('Bildschirmzeit löschen', 'Löscht die erfassten Programmzeiten aller Tage', 'Löschen', 'clearScreenTime')),
        zentraleSection(),
        section('Verbindungen',
          el('div', { class: 'row' }, text('IT-Lage', 'Öffentlicher Microsoft-/Azure-Status, Datenlecks, Passwort-Check'), el('button', { class: 'act', text: 'Öffnen …', on: { click: () => host.action('lage') } })),
          el('div', { class: 'row' }, text('Relay (Ereignisse vom Server)', `Status: ${r.text || 'aus'}`), el('button', { class: 'act', text: 'Einrichten …', on: { click: () => host.action('relay') } })),
          el('div', { class: 'row' }, text('Lokaler Webhook', 'POST http://127.0.0.1:4711/event · nur von diesem PC erreichbar'), el('span', { class: 'pill ok', text: 'aktiv' }))),
        section('Skin',
          (() => {
            // 1.9: Skin-Auswahl – Farbvarianten und eigene Skins
            const sk = snap.skin || {}, list = sk.list || [];
            const selEl = el('select', { 'aria-label': 'Skin wählen', on: { change: async e => { await host.action('skinSet', e.target.value); snap = await host.get(); render(); } } },
              ...list.map(s => el('option', { value: s.id, text: s.kind === 'user' ? s.name : tr(s.name), selected: s.id === sk.current })));
            return el('div', { class: 'row' }, text('Aussehen', 'Farbvarianten oder eigene Skins – auch im Tray unter „Skin“'), selEl);
          })(),
          el('div', { class: 'row' }, text('Eigene Skins', 'Je Skin ein Unterordner mit sudo-sheet.png und sudo-sheet.json. Vorlage und Anleitung liegen im Ordner.'), el('button', { class: 'act', text: 'Ordner öffnen', on: { click: () => host.action('skinFolder') } })),
          button('Skin neu laden', 'Nach dem Bearbeiten', 'Neu laden', 'skinReload'))
      ];
    },
    info() {
      const i = snap.info, u = snap.update || {};
      const upState = { idle: 'noch nicht geprüft', checking: 'prüft …', current: 'aktuell', downloading: `lädt ${u.version || ''} … ${u.progress || 0} %`, ready: `${u.version} bereit`, error: 'Fehler' }[u.state] || u.state;
      const upRow = u.canUpdate
        ? [toggle('autoUpdate', 'Automatisch aktualisieren', 'Prüft beim Start und alle 6 Stunden, lädt im Hintergrund, installiert beim Beenden', S().autoUpdate),
           el('div', { class: 'row' }, text('Update-Status', u.error ? `${upState}: ${u.error}` : upState),
             u.state === 'ready' ? el('button', { class: 'act primary', text: 'Jetzt installieren', on: { click: () => host.action('installUpdate') } }) : el('button', { class: 'act', text: 'Jetzt prüfen', on: { click: async () => { await host.action('checkUpdate'); } } }))]
        : [el('div', { class: 'row' }, text('Updates', i.installed === 'Portable EXE' ? 'Die portable EXE aktualisiert sich nicht selbst.' : i.installed.includes('MSI') ? 'Wird zentral verteilt (MSI/Intune). Neue Versionen kommen über Intune.' : 'Automatische Updates gibt es in der installierten Version.'), el('span', { class: 'pill', text: 'manuell' }))];
      const sim = el('select', { 'aria-label': 'Ereignis wählen' },
        ...[['backup_failed', 'Backup fehlgeschlagen'], ['server_down', 'Server offline'], ['deploy_ok', 'Deploy erfolgreich'], ['ticket', 'Neues Ticket'], ['bug', 'Bug aussetzen']].map(([v, l]) => el('option', { value: v, text: l })));
      return [
        el('div', { class: 'hero' }, el('img', { src: '../assets/icon.png', alt: '' }), el('div', {}, el('b', { text: 'Sudo ' + i.version }), el('span', { class: 'sub', text: 'Der Desktop-Ninja für IT-Leute · MeikoSoft' }))),
        section('Version',
          el('dl', { class: 'kv' },
            el('dt', { text: 'Installation' }), el('dd', { text: i.installed }),
            el('dt', { text: 'Electron / Chrome' }), el('dd', { text: `${i.electron} / ${i.chrome}` }),
            el('dt', { text: 'Betriebssystem' }), el('dd', { text: i.os }),
            el('dt', { text: 'Tastenkürzel' }), el('dd', { text: `Strg+Alt+K ${snap.shortcuts.tools ? '✓' : '(belegt)'} · Strg+Alt+N ${snap.shortcuts.quick ? '✓' : '(belegt)'}` }))),
        section('Updates', ...upRow),
        (() => {
          // 1.9: Ressourcen & Stabilität
          const d = snap.diag || {}, n = d.now || {}, a = d.avg, bt = n.byType || {};
          const parts = Object.entries(bt).map(([k, v]) => `${tr(k)} ${v.ram} MB`).join(' · ');
          return section('Ressourcen & Stabilität',
            el('dl', { class: 'kv' },
              el('dt', { text: 'Gerade' }), el('dd', { 'data-noi18n': '', text: n.ram != null ? `CPU ${n.cpu} % · RAM ${n.ram} MB` : '–' }),
              el('dt', { text: 'Ø 10 Minuten' }), el('dd', { 'data-noi18n': '', text: a ? `CPU ${a.cpu} % · RAM ${a.ram} MB` : tr('wird noch gemessen …') }),
              el('dt', { text: 'Aufgeteilt' }), el('dd', { 'data-noi18n': '', text: parts || '–' }),
              el('dt', { text: 'Läuft seit' }), el('dd', { 'data-noi18n': '', text: d.uptimeMin >= 60 ? tr('{x} Std.').replace('{x}', Math.floor(d.uptimeMin / 60)) : tr('{x} Min.').replace('{x}', d.uptimeMin || 0) }),
              el('dt', { text: 'Selbstheilung (24 h)' }), el('dd', { 'data-noi18n': '', text: d.crashes ? tr('{x}× neu gestartet').replace('{x}', d.crashes) : tr('nicht nötig') })),
            (d.errors || []).length ? el('details', {}, el('summary', { text: tr('Letzte Fehler ({x})').replace('{x}', d.errors.length) }),
              el('pre', { class: 'log', 'data-noi18n': '', text: d.errors.map(e => new Date(e.at).toLocaleTimeString() + '  ' + e.msg).join('\n') })) : null,
            el('p', { class: 'note', text: 'Sudo zeichnet nur neu, wenn sich etwas bewegt, und schaltet in ruhigen Phasen herunter. Hängt das Overlay oder stürzt es ab, startet es sich selbst neu. Ist der PC bei einer Zentrale angemeldet, sieht deine IT diese Zahlen und gekürzte Fehlertexte (ohne Pfade und Namen).' }),
            button('Neu messen', 'Aktuelle Werte holen', 'Messen', 'diagMeasure'));
        })(),
        section('Hilfe & Diagnose',
          button('Diagnose-Bericht kopieren', 'Version, Systeminfos, Einstellungen ohne Geheimnisse und die letzten Protokollzeilen – zum Mitschicken bei Problemen', 'Kopieren', 'diag', null, true),
          el('div', { class: 'row' }, text('Ereignisprotokoll', 'Alles, was Sudo erlebt hat'), el('button', { class: 'act', text: 'Öffnen', on: { click: () => host.action('log') } })),
          el('div', { class: 'row' }, text('Tastatur-Test', '10 Sekunden irgendwo tippen, Sudo zählt mit'), el('button', { class: 'act', text: 'Starten', on: { click: () => host.action('keytest') } })),
          el('div', { class: 'row' }, text('Ereignis simulieren', 'Testet Sudos Reaktionen'), sim, el('button', { class: 'act', text: 'Auslösen', on: { click: () => host.action('simulate', sim.value) } })),
          el('div', { class: 'row' }, text('Willkommens-Tour', 'Noch mal von vorn'), el('button', { class: 'act', text: 'Starten', on: { click: () => host.action('tour') } })),
          el('div', { class: 'row' }, text('Sudo neu laden', 'Falls er nicht reagiert'), el('button', { class: 'act', text: 'Neu laden', on: { click: () => host.action('reload') } }))),
        i.changelog ? section('Was ist neu', el('pre', { class: 'log', text: i.changelog })) : null
      ];
    }
  };

  function render() {
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    if (!TABS[tab]) tab = 'general';
    main.replaceChildren(...TABS[tab]().filter(Boolean));
    document.getElementById('ver').textContent = 'Version ' + snap.info.version;
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', async () => { tab = b.dataset.tab; snap = await host.get(); render(); }));
  host.onTab(t => { if (TABS[t]) { tab = t; render(); } });   // spätere Wünsche (Fenster schon offen)
  host.onUpdate(u => { snap.update = u; if (tab === 'info') render(); });
  if (host.onDiag) host.onDiag(async () => { if (tab === 'info') { snap = await host.get(); render(); } });
  host.onZentrale(z => { snap.zentrale = z; const a = document.activeElement; if ((tab === 'data' || tab === 'ai') && !(a && a.tagName === 'INPUT')) render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  render();
})();
