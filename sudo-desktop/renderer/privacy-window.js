// privacy-window.js – „Was weiß Sudo über mich?“: was Sudo bemerkt, speichert und was den PC verlässt
(async () => {
  'use strict';
  const host = window.privacyHost;
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
  const nf = n => Number(n || 0).toLocaleString(document.documentElement.lang || 'de');
  const li = (title, small) => el('li', {}, el('div', {}, title, small ? el('small', { text: small }) : null));
  const row = (title, small, right) => el('div', { class: 'row' }, el('div', { class: 't' }, el('b', { text: title }), small ? el('small', { text: small }) : null), right);
  const pill = (on, onText = 'an', offText = 'aus') => el('span', { class: 'pill ' + (on ? 'ok' : 'off'), text: on ? onText : offText });
  const msg = el('div', { class: 'msg', role: 'status' });
  async function act(a) {
    const r = await host.act(a);
    if (r && r.msg) { msg.className = 'msg' + (r.ok ? '' : ' bad'); msg.textContent = tr(r.msg); }
    if (['clearScreen', 'clearLog'].includes(a)) render();
  }
  const btn = (text, a, primary) => el('button', { class: 'act' + (primary ? ' primary' : ''), type: 'button', text, on: { click: () => act(a) } });

  async function render() {
    const d = await host.get();
    const c = d.counters || {};
    const COUNT = [
      ['keys', 'Tasten (nur gezählt)'], ['minutes', 'Minuten zusammen'], ['bugs', 'Bugs gefixt'], ['saves', 'Mal gespeichert'],
      ['breaks', 'Pausen gemacht'], ['meetings', 'Meetings'], ['pets', 'Mal gestreichelt'], ['xp', 'XP']
    ];
    const ai = { off: 'aus', own: 'eigener Schlüssel', zentrale: 'über die Sudo-Zentrale' }[d.ai.mode] || d.ai.mode;

    main.replaceChildren(
      el('div', { class: 'top' },
        el('img', { src: '../assets/icon.png', alt: '' }),
        el('h1', { text: 'Was weiß Sudo über mich?' })),
      el('p', { class: 'lead', text: 'Sudo läuft nur auf deinem PC. Hier steht, was er mitbekommt, was er speichert und was den PC verlässt – mit den echten Werten von diesem Gerät, nicht mit Werbetext.' }),

      el('div', { class: 'two' },
        el('section', {}, el('h3', { text: 'Das bemerkt Sudo (nur im Moment)' }),
          el('ul', { class: 'check' },
            li('Dass du tippst – nicht was', 'Nur „Zeichen“, Rücktaste und Strg+S/Z/C/V. Kein Text, keine Passwörter, keine einzelnen Buchstaben.'),
            li('Wo Fenster sind und wie sie heißen', 'Damit er darauf stehen und Programme oder Webseiten wie YouTube erkennen kann. Fenstertitel werden nicht gespeichert.'),
            li('Ob ein Meeting läuft', 'Dann ist Sudo still und unsichtbar für die Bildschirmfreigabe.'),
            li('Wo die Maus ist', 'Damit du ihn anklicken und herumtragen kannst.'))),
        el('section', {}, el('h3', { text: 'Das macht Sudo nie' }),
          el('ul', { class: 'check no' },
            li('Bildschirmfotos oder Aufnahmen'),
            li('Heimlich Mikrofon oder Kamera nutzen', 'Nur im Meeting-Check, wenn du dort auf „testen“ klickst – Pegel und Bild bleiben im Fenster, nichts wird aufgenommen oder verschickt.'),
            li('Die Zwischenablage lesen', 'Der Werkzeugkasten schreibt nur hinein, wenn du auf „Kopieren“ klickst.'),
            li('Tasteninhalte speichern oder senden'),
            li('Dateien, Mails oder den Browserverlauf lesen'),
            li('Daten an Werbe- oder Analysedienste schicken')))),

      el('section', {}, el('h3', { text: 'Gespeichert auf diesem PC' }),
        el('div', { class: 'grid-c' }, COUNT.map(([k, t]) => el('div', {}, el('b', { text: nf(c[k]) }), el('small', { text: t })))),
        row('Statistik, Erfolge, Garderobe', 'Nur Zähler wie oben. Daraus berechnet Sudo Rang, Erfolge und Geschenke.',
          el('span', { class: 'v', text: tr('{a} Teile · {b} Erfolge').replace('{a}', nf(d.unlocked)).replace('{b}', nf(d.achievements)) })),
        row('Bildschirmzeit', d.screen.on
          ? 'Aktive Minuten pro Tag und welche Programme im Vordergrund waren (nur Programmname, kein Fenstertitel). Höchstens 30 Tage.'
          : 'Ausgeschaltet. Sudo merkt sich nur die aktive Zeit pro Tag, keine Programme.',
          el('div', { class: 'acts' }, pill(d.screen.on), el('button', { class: 'act', type: 'button', text: 'Ändern …', on: { click: () => act('work') } }), d.screen.apps.length ? btn('App-Liste löschen', 'clearScreen') : null)),
        d.screen.apps.length ? el('div', { class: 'chips', 'data-noi18n': '' }, d.screen.apps.slice(0, 24).map(a => el('span', { text: a }))) : null,
        row('Erinnerungen & Notizen', 'Was du selbst eingetragen hast.', el('span', { class: 'v', text: `${nf(d.reminders.reminders)} + ${nf(d.reminders.notes)}` })),
        row('Verlauf „Was hat Sudo gesagt?“', 'Wichtige Sprechblasen zum Nachlesen und Durchsuchen, bei Meldungen mit Ticket- und Gerätekennung. Wie lange Sudo sie aufhebt, bestimmst du unter Einstellungen (Aus bis 1 Jahr, höchstens 2000 Einträge). Bleibt auf dem PC, nur in deinem Windows-Konto.',
          el('span', { class: 'v', text: tr(d.history && d.history.days ? '{n} Einträge · {d} Tage' : 'Aus').replace('{n}', nf((d.history && d.history.n) || 0)).replace('{d}', (d.history && d.history.days) || 0) })),
        row('Plugins', 'Zusatzwerkzeuge deiner IT oder eigene, jedes mit eigenem Speicher. Plugins haben keinen Internetzugang – was du darin eingibst, bleibt auf diesem PC.',
          el('span', { class: 'v', text: tr('{n} Plugins').replace('{n}', nf(d.plugins || 0)) })),
        row('Ereignisprotokoll', 'Technische Meldungen für die Fehlersuche (z. B. „Zentrale verbunden“). Bleibt auf dem PC.',
          el('div', { class: 'acts' }, el('span', { class: 'v', text: tr('{n} Zeilen').replace('{n}', nf(d.log.lines)) }), d.log.lines ? btn('Leeren', 'clearLog') : null)),
        row('IT-Lage', d.intel.emails ? 'Eigene E-Mail-Adressen für den Leak-Check stehen in den Einstellungen; gespeichert werden nur Fundstellen.' : 'Letzte Meldungen, damit Sudo nichts doppelt meldet.',
          el('span', { class: 'v', text: d.intel.emails ? tr('{n} Adressen').replace('{n}', nf(d.intel.emails)) : '–' })),
        row('Schlüssel', 'API-Schlüssel und Geräte-Schlüssel liegen mit Windows verschlüsselt (DPAPI) – nur dein Benutzerkonto kann sie lesen.',
          pill(d.ai.keySaved || d.zentrale.enrolled, 'verschlüsselt', 'keine'))),

      el('section', {}, el('h3', { text: 'Das verlässt den PC' }),
        row('Sudo-Zentrale' + (d.zentrale.host ? ' (' + d.zentrale.host + ')' : ''), d.zentrale.enrolled
          ? tr('Gerätename „{pc}“, Windows-Benutzer „{user}“, Version, Sprache und „ist online“. Bei Besuchen dein Name „{name}“ und ggf. der Post-it-Text, bei Frag Sudo über die Zentrale die Anzahl der Fragen und die Kosten (nicht die Fragen). Keine Tasten, Fenster oder Bildschirmzeit.').replace('{pc}', d.zentrale.name).replace('{user}', d.zentrale.user).replace('{name}', d.visits.name)
            + (d.zentrale.upn ? ' ' + tr('Dazu dein Anmeldename „{upn}“, damit Meldungen an dich persönlich gehen können (z. B. zugewiesene Tickets).').replace('{upn}', d.zentrale.upn) : '')
          : 'Nicht angemeldet – es wird nichts gesendet.', pill(d.zentrale.enrolled, 'verbunden', 'aus')),
        row('Gerätezustand (Ampel)', d.zentrale.health
          ? 'Nur die Ampel: BitLocker, Virenschutz, Firewall, Windows-Update, Neustart und Speicherplatz mit wenigen Zahlen (z. B. „Update vor 12 Tagen“). Keine Dateien, Programme oder Inhalte.'
          : 'Wird nicht gemeldet. Die Prüfung läuft nur auf diesem PC (IT-Lage → Mein PC).', pill(d.zentrale.health, 'an die Zentrale', 'nur lokal')),
        row('Security-Quiz', d.zentrale.enrolled
          ? 'Gezählt wird anonym, welche Frage richtig oder falsch beantwortet wurde – ohne Gerät und ohne Namen. Dein eigener Verlauf bleibt auf diesem PC.'
          : 'Läuft nur auf diesem PC.', pill(!!(d.quiz && d.quiz.on), 'an', 'aus')),
        row('Hinweise deiner IT', d.zentrale.enrolled
          ? 'Bei Störungen nur, ob du dich als betroffen meldest. Bei Neustart-Aufforderungen der Stand (offen, verschoben, erledigt) und wie viele Tage der PC läuft.'
          : 'Ohne Zentrale gibt es keine Hinweise.', pill(d.zentrale.enrolled, 'an', 'aus')),
        row('Selbsthilfe', d.zentrale.enrolled
          ? 'Gezählt wird anonym, welches Werkzeug benutzt wurde und ob es geklappt hat – ohne Gerät und ohne Namen.'
          : 'Läuft nur auf diesem PC.', pill(true, 'an', 'aus')),
        row('Ressourcen & Fehler', d.zentrale.enrolled
          ? 'Alle 10 Minuten bei Änderungen: CPU- und Arbeitsspeicherverbrauch von Sudo, Zahl der Selbst-Neustarts und Fehler der letzten 24 Stunden und der letzte Fehlertext (ohne Pfade und Namen). Hilft deiner IT, Probleme mit Sudo zu erkennen.'
          : 'Nur auf diesem PC (Einstellungen → Info & Diagnose).', pill(!!d.zentrale.enrolled, 'an die Zentrale', 'nur lokal')),
        row('Anleitungen', d.zentrale.enrolled
          ? 'Wenn du im Fenster „Anleitungen“ suchst, geht der Suchbegriff an die Zentrale (wird dort nicht gespeichert). Bei Störungen fragt Sudo passende Anleitungen zum Titel der Störung ab. Geöffnet wird das Original in SharePoint – mit deiner eigenen Anmeldung.'
          : 'Ohne Zentrale gibt es keine Anleitungen.', pill(!!d.zentrale.enrolled, 'an', 'aus')),
        row('Kurze Fragen der IT', d.zentrale.enrolled
          ? 'Nur wenn du antwortest: Sterne (1–5) und optional eine Anmerkung, dazu die Ampel deines Gerätezustands und der Tag – ohne Gerät und Namen. Die Zentrale merkt sich nur, dass dieses Gerät geantwortet hat. „Läuft es wieder?“ nach einer Störung geht dagegen mit Gerät an die IT, damit sie helfen kann.'
          : 'Ohne Zentrale gibt es keine Fragen der IT.', pill(!!d.zentrale.enrolled, 'freiwillig', 'aus')),
        row('Start-Checkliste', d.zentrale.enrolled
          ? 'Nur in den ersten Wochen, wenn deine IT sie eingeschaltet hat: je Punkt „erledigt ja/nein“ mit Gerät (z. B. OneDrive angemeldet, Drucker verbunden). Keine Inhalte.'
          : 'Ohne Zentrale gibt es keine Start-Checkliste.', pill(!!d.zentrale.enrolled, 'an die Zentrale', 'aus')),
        row('Musikwünsche', d.zentrale.enrolled
          ? 'Nur wenn du dir einen Song wünschst: Titel, Gerät und Uhrzeit (90 Tage in der Zentrale), zur Prüfung dein XP-Stand. Je nach Einstellung der IT sagt Sudo bei allen an, wer sich was gewünscht hat.'
          : 'Ohne Zentrale gibt es keine Musikwünsche.', pill(!!d.zentrale.enrolled, 'an', 'aus')),
        row('YouTube-Videos', 'Neue Videos der IT-Kanäle holt die Zentrale aus öffentlichen Kanal-Feeds. Für deine eigenen Kanäle fragt dein PC die öffentlichen Feeds direkt bei YouTube ab (alle 15 Minuten, ohne Anmeldung) – dabei sieht YouTube nur die IP-Adresse eurer Firma. Welche Kanäle du eingetragen hast, bleibt auf deinem PC. Erst ein Klick auf ein Video öffnet YouTube im Browser.',
          pill(!d.media || d.media.videos !== false || ((d.media.channels || []).length > 0), 'an', 'aus')),
        row('Frag Sudo (Claude)', d.ai.mode === 'off' ? 'Ausgeschaltet.' : (d.ai.context
          ? 'Nur was du fragst, plus eine kurze IT-Lage als Hintergrund. Der Verlauf liegt nur im Arbeitsspeicher und ist nach dem Schließen weg.'
          : 'Nur was du fragst. Der Verlauf liegt nur im Arbeitsspeicher und ist nach dem Schließen weg.'), el('span', { class: 'pill ' + (d.ai.mode === 'off' ? 'off' : 'ok'), text: ai })),
        row('IT-Lage: Microsoft-Status & Warnungen', 'Sudo lädt öffentliche Seiten (Microsoft, Azure, CERT-Bund …) – ohne Anmeldung, ohne deine Daten.',
          pill(d.intel.m365 || d.intel.azure || d.intel.feeds.length)),
        row('Have I Been Pwned', d.intel.hibpKey && d.intel.emails
          ? 'Deine eingetragenen Adressen gehen zur Prüfung an haveibeenpwned.com. Beim Passwort-Check verlassen nur 5 Zeichen eines Hashes den PC, nie das Passwort.'
          : 'Nur öffentliche Liste neuer Lecks. Beim Passwort-Check verlassen nur 5 Zeichen eines Hashes den PC, nie das Passwort.', pill(d.intel.breaches || d.intel.hibpKey)),
        row('Updates', `Sudo fragt beim Update-Server (${d.updates.host}) nach einer neuen Version. Persönliche Daten werden dabei nicht übertragen.`, pill(d.updates.auto)),
        row('Relay', d.relay.on ? `Holt Ereignisse von deinem Server ab: ${d.relay.host}` : 'Ausgeschaltet.', pill(d.relay.on)),
        row('Webhook', tr('Nimmt Ereignisse nur vom eigenen PC an (127.0.0.1, Port {port}) – von außen nicht erreichbar.').replace('{port}', d.port), pill(d.webhook, 'nur lokal', 'aus')),
        el('p', { class: 'info', text: 'Wie bei jedem Abruf im Internet sehen die angefragten Server die IP-Adresse deines Anschlusses.' })),

      el('section', {}, el('h3', { text: 'Für IT, Datenschutz und Betriebsrat' }),
        el('div', { class: 'info' },
          el('p', {}, el('b', { text: 'Keine Leistungskontrolle: ' }), tr('Zähler und Bildschirmzeit bleiben auf diesem PC. Die Zentrale sieht nur, ob und wann ein Gerät online war und – falls eingeschaltet – die Ampel des Gerätezustands. Nicht, wie viel jemand tippt oder womit er arbeitet.')),
          el('p', {}, el('b', { text: 'Selbst bestimmen: ' }), tr('Bildschirmzeit, Besuche, Frag Sudo und IT-Lage lassen sich einzeln abschalten. Die Datenauskunft enthält alles, was hier gespeichert ist (ohne Schlüssel).')),
          el('div', { class: 'foot' }, btn('Datenauskunft speichern …', 'export', true), btn('Datenordner öffnen', 'folder'), btn('Einstellungen …', 'settings'), msg))),
      el('p', { class: 'sub', 'data-noi18n': '' }, `Sudo ${d.version} · ${d.dataDir}`)
    );
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  render();
})();
