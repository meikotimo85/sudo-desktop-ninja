// progress.js – Garderobe, Erfolge und besondere Tage (gemeinsam für Overlay, Fenster und Hauptprozess)
(function (root) {
  'use strict';
  const has = (s, k) => !!(s.flags && s.flags[k]);

  // Gegenstände für die Garderobe. p(s) liefert den Fortschritt 0…1.
  const ITEMS = {
    beanie:     { name: 'Strickmütze',     slot: 'hat',  how: '10 Stunden gemeinsame Zeit', p: s => (s.minutes || 0) / 600 },
    cap:        { name: 'Basecap',         slot: 'hat',  how: '50 Bugs gefixt',              p: s => (s.bugs || 0) / 50 },
    firehelmet: { name: 'Feuerwehrhelm',   slot: 'hat',  how: '10 Pausen wirklich gemacht',  p: s => (s.breaks || 0) / 10 },
    party:      { name: 'Partyhut',        slot: 'hat',  how: 'Rang „Admin“ erreicht',       p: s => (s.xp || 0) / 400 },
    crown:      { name: 'Krone',           slot: 'hat',  how: 'Rang „root“ erreicht',        p: s => (s.xp || 0) / 1500 },
    santa:      { name: 'Weihnachtsmütze', slot: 'hat',  how: 'Gibt es im Dezember',         p: s => (has(s, 'december') ? 1 : 0) },
    shades:     { name: 'Sonnenbrille',    slot: 'face', how: 'Tipp-Combo ×100',             p: s => (s.best || 0) / 100 },
    nerd:       { name: 'Hornbrille',      slot: 'face', how: '10.000 Tasten getippt',       p: s => (s.keys || 0) / 10000 },
    // 1.4.1: IT-Gags
    hardhat:    { name: 'Bauhelm',          slot: 'hat',  how: '250-mal gespeichert',          p: s => (s.saves || 0) / 250 },
    tinfoil:    { name: 'Aluhut',           slot: 'hat',  how: 'Nachgeschaut, was Sudo über dich weiß', p: s => (has(s, 'privacy') ? 1 : 0) },
    propeller:  { name: 'Propellermütze',   slot: 'hat',  how: '25-mal aus dem Werkzeugkasten kopiert', p: s => (s.copies || 0) / 25 },
    pixel:      { name: 'Pixel-Sonnenbrille', slot: 'face', how: 'Tipp-Combo ×150',           p: s => (s.best || 0) / 150 },
    monocle:    { name: 'Monokel',          slot: 'face', how: '30 Punkte in der Bug-Jagd',    p: s => (s.gameBest || 0) / 30 },
    tie:        { name: 'Admin-Krawatte',   slot: 'neck', how: '25 Meetings überstanden',      p: s => (s.meetings || 0) / 25 },
    bowtie:     { name: 'Fliege',           slot: 'neck', how: '50 Stunden gemeinsame Zeit',   p: s => (s.minutes || 0) / 3000 },
    badge:      { name: 'Firmenausweis',    slot: 'neck', how: 'Bei der Sudo-Zentrale angemeldet', p: s => (has(s, 'zentrale') ? 1 : 0) },
    // 1.4.1: Saison – einmal im Zeitraum vorbeischauen, dann für immer im Schrank
    witch:      { name: 'Hexenhut',         slot: 'hat',  how: 'Gibt es im Oktober',           p: s => (has(s, 'october') ? 1 : 0), season: true },
    bunny:      { name: 'Hasenohren',       slot: 'hat',  how: 'Gibt es rund um Ostern',       p: s => (has(s, 'easter') ? 1 : 0), season: true },
    strawhat:   { name: 'Strohhut',         slot: 'hat',  how: 'Gibt es im Sommer (Juni–August)', p: s => (has(s, 'summer') ? 1 : 0), season: true },
    tophat:     { name: 'Zylinder',         slot: 'hat',  how: 'Gibt es zu Silvester',         p: s => (has(s, 'newyear') ? 1 : 0), season: true },
    goggles:    { name: 'Skibrille',        slot: 'face', how: 'Gibt es im Januar und Februar', p: s => (has(s, 'winter') ? 1 : 0), season: true },
    scarf:      { name: 'Schal',            slot: 'neck', how: 'Gibt es von November bis Februar', p: s => (has(s, 'cold') ? 1 : 0), season: true },
    lights:     { name: 'Lichterkette',     slot: 'neck', how: 'Gibt es im Dezember',          p: s => (has(s, 'december') ? 1 : 0), season: true },
    lei:        { name: 'Blumenkette',      slot: 'neck', how: 'Gibt es im Sommer (Juni–August)', p: s => (has(s, 'summer') ? 1 : 0), season: true }
  };
  ITEMS.santa.season = true;
  const SLOTS = ['hat', 'face', 'neck'];

  // Welche Saison-Merker gelten heute? (setzt das Overlay in stats.flags)
  function seasonFlags(d = new Date()) {
    const m = d.getMonth() + 1, day = d.getDate(), f = [];
    if (m === 12) f.push('december');
    if (m === 10) f.push('october');
    if (m >= 6 && m <= 8) f.push('summer');
    if (m === 1 || m === 2) f.push('winter');
    if (m >= 11 || m <= 2) f.push('cold');
    if ((m === 12 && day === 31) || (m === 1 && day === 1)) f.push('newyear');
    const diffE = Math.round((new Date(d.getFullYear(), m - 1, day) - easter(d.getFullYear())) / 864e5);
    if (diffE >= -7 && diffE <= 7) f.push('easter');
    return f;
  }

  // Erfolge. ok(s) entscheidet, ob freigeschaltet.
  const ACHIEVEMENTS = [
    { id: 'firstbug',   t: 'Erster Bug',          d: 'Den ersten Bug erledigt',                ok: s => s.bugs >= 1 },
    { id: 'bughunter',  t: 'Bug-Jäger',           d: '50 Bugs gefixt',                         ok: s => s.bugs >= 50 },
    { id: 'bugslayer',  t: 'Kammerjäger',         d: '250 Bugs gefixt',                        ok: s => s.bugs >= 250 },
    { id: 'keys1k',     t: 'Warmgetippt',         d: '1.000 Tasten',                           ok: s => s.keys >= 1000 },
    { id: 'keys10k',    t: 'Vieltipper',          d: '10.000 Tasten',                          ok: s => s.keys >= 10000 },
    { id: 'keys100k',   t: 'Tastatur-Ninja',      d: '100.000 Tasten',                         ok: s => s.keys >= 100000 },
    { id: 'combo50',    t: 'Combo-Starter',       d: 'Tipp-Combo ×50',                         ok: s => s.best >= 50 },
    { id: 'combo150',   t: 'Hacker-Modus',        d: 'Tipp-Combo ×150',                        ok: s => s.best >= 150 },
    { id: 'saves100',   t: 'Strg+S-Profi',        d: '100-mal gespeichert',                    ok: s => s.saves >= 100 },
    { id: 'pets25',     t: 'Streichelzoo',        d: '25-mal gestreichelt',                    ok: s => s.pets >= 25 },
    { id: 'alarm1',     t: 'Feuertaufe',          d: 'Den ersten Alarm gemeldet',              ok: s => s.alarms >= 1 },
    { id: 'break1',     t: 'Pause!',              d: 'Nach einer Erinnerung wirklich Pause gemacht', ok: s => s.breaks >= 1 },
    { id: 'break25',    t: 'Gesund durchs Büro',  d: '25 Pausen wirklich gemacht',             ok: s => s.breaks >= 25 },
    { id: 'notes10',    t: 'Ninja-Gedächtnis',    d: '10 Erinnerungen oder Notizen angelegt',  ok: s => s.noted >= 10 },
    { id: 'tools10',    t: 'Werkzeugmeister',     d: '10-mal aus dem Werkzeugkasten kopiert',  ok: s => s.copies >= 10 },
    { id: 'throw10',    t: 'Flugkapitän',         d: 'Sudo 10-mal kräftig geworfen',           ok: s => s.throws >= 10 },
    { id: 'meetings10', t: 'Meeting-Marathon',    d: '10 Meetings überstanden',                ok: s => s.meetings >= 10 },
    { id: 'game30',     t: 'Bug-Blaster',         d: '30 Punkte in der Bug-Jagd',              ok: s => s.gameBest >= 30 },
    { id: 'home',       t: 'Eigenheim',           d: 'Sudo einen Wohnort gegeben',             ok: s => has(s, 'home') },
    { id: 'night',      t: 'Nachteule',           d: 'Zwischen 0 und 4 Uhr getippt',           ok: s => has(s, 'night') },
    { id: 'early',      t: 'Frühaufsteher',       d: 'Arbeitsbeginn vor 6:30 Uhr',             ok: s => has(s, 'early') },
    { id: 'weekend',    t: 'Wochenend-Admin',     d: 'Am Wochenende gearbeitet',               ok: s => has(s, 'weekend') },
    { id: 'together',   t: 'Unzertrennlich',      d: '100 Stunden gemeinsame Zeit',            ok: s => s.minutes >= 6000 },
    { id: 'root',       t: 'root-Rechte',         d: 'Höchster Rang erreicht',                 ok: s => s.xp >= 1500 },
    { id: 'visit1',     t: 'Hausbesuch',          d: 'Sudo zum ersten Mal auf Besuch geschickt', ok: s => (s.visitsSent || 0) >= 1 },
    { id: 'duel1',      t: 'Erster Sieg',         d: 'Ein Duell gewonnen',                     ok: s => (s.duelsWon || 0) >= 1 },
    { id: 'duel10',     t: 'Shuriken-Meister',    d: '10 Duelle gewonnen',                     ok: s => (s.duelsWon || 0) >= 10 },
    { id: 'closet12',   t: 'Kleiderschrank',      d: '12 Teile in der Garderobe',              ok: s => (s.unlocked || []).length >= 12 },
    { id: 'closetAll',  t: 'Modeikone',           d: 'Alle Teile der Garderobe gesammelt',     ok: s => Object.keys(ITEMS).every(id => (s.unlocked || []).includes(id)) },
    { id: 'privacy',    t: 'Datenschützer',       d: 'Nachgeschaut, was Sudo über dich weiß',  ok: s => has(s, 'privacy') },
    { id: 'quiz1',      t: 'Wachsam',             d: 'Die erste Quizfrage richtig beantwortet', ok: s => (s.quizRight || 0) >= 1 },
    { id: 'quiz10',     t: 'Phishing-Profi',      d: '10 Quizfragen richtig beantwortet',       ok: s => (s.quizRight || 0) >= 10 },
    { id: 'quiz25',     t: 'Security-Ninja',      d: '25 Quizfragen richtig beantwortet',       ok: s => (s.quizRight || 0) >= 25 },
    // 1.10
    { id: 'locks5',     t: 'Bildschirm-Wächter',  d: '5-mal beim Weggehen den Bildschirm gesperrt', ok: s => (s.locks || 0) >= 5 },
    { id: 'onboard',    t: 'Startklar',           d: 'Die Start-Checkliste komplett erledigt',  ok: s => has(s, 'onboard') }
  ];

  /* ---------- Besondere Tage ---------- */
  function easter(y) {                                    // Gaußsche Osterformel (gregorianisch)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  // Gesetzliche Feiertage in Niedersachsen
  function holiday(d) {
    const y = d.getFullYear(), md = `${d.getDate()}.${d.getMonth() + 1}`;
    const fixed = { '1.1': 'Neujahr', '1.5': 'Tag der Arbeit', '3.10': 'Tag der Deutschen Einheit', '31.10': 'Reformationstag', '25.12': '1. Weihnachtstag', '26.12': '2. Weihnachtstag' };
    if (fixed[md]) return fixed[md];
    const diff = Math.round((new Date(y, d.getMonth(), d.getDate()) - easter(y)) / 864e5);
    return { '-2': 'Karfreitag', '1': 'Ostermontag', '39': 'Christi Himmelfahrt', '50': 'Pfingstmontag' }[diff] || null;
  }
  // Was ist heute los? special = { birthday: 'TT.MM', jubilee: 'TT.MM.JJJJ' }
  function today(d = new Date(), special = {}) {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate(), h = d.getHours();
    const ev = { hat: null, neck: null, fx: null, greet: null, holiday: holiday(d) };
    const diffE = Math.round((new Date(y, m - 1, day) - easter(y)) / 864e5);
    const lastFriJuly = (() => { const x = new Date(y, 6, 31); while (x.getDay() !== 5) x.setDate(x.getDate() - 1); return x.getDate(); })();
    const dayOfYear = Math.round((new Date(y, m - 1, day) - new Date(y, 0, 0)) / 864e5);
    const bd = String(special.birthday || '').match(/^(\d{1,2})\.(\d{1,2})/);
    const jb = String(special.jubilee || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

    if (bd && Number(bd[1]) === day && Number(bd[2]) === m) Object.assign(ev, { hat: 'party', fx: 'confetti', greet: 'Alles Gute zum\nGeburtstag!' });
    else if (jb && Number(jb[1]) === day && Number(jb[2]) === m && y > Number(jb[3])) Object.assign(ev, { hat: 'party', fx: 'confetti', greet: `${y - Number(jb[3])} Jahre Firma!\nGlückwunsch!` });
    else if (m === 12 && day >= 24 && day <= 26) Object.assign(ev, { hat: 'santa', neck: 'lights', fx: 'snow', greet: 'Frohe Weihnachten!' });
    else if (m === 12 && day <= 23) Object.assign(ev, { hat: 'santa', fx: 'snow', greet: day === 6 ? 'Nikolaus!\nStiefel geputzt?' : null });
    else if ((m === 12 && day === 31 && h >= 16) || (m === 1 && day === 1)) Object.assign(ev, { hat: 'tophat', fx: 'fireworks', greet: m === 1 ? 'Frohes neues Jahr!' : 'Guten Rutsch!' });
    else if (diffE >= -2 && diffE <= 1) Object.assign(ev, { hat: 'bunny', fx: 'eggs', greet: diffE === 0 ? 'Frohe Ostern!' : null });
    else if (m === 10 && day === 31) Object.assign(ev, { hat: 'witch', fx: h >= 16 ? 'bats' : null, greet: 'Happy Halloween!\nBoo!' });
    else if (m === 7 && day === lastFriJuly) Object.assign(ev, { hat: 'crown', fx: 'confetti', greet: 'Happy SysAdmin Day!\nHeute bist du König.' });
    else if (dayOfYear === 256) Object.assign(ev, { greet: 'Tag 256: Tag der\nProgrammierer!' });
    else if (day === 13 && d.getDay() === 5) Object.assign(ev, { greet: 'Freitag, der 13.\nHeute nichts deployen!' });
    else if (m === 3 && day === 14) Object.assign(ev, { greet: 'Pi-Tag! 3,14159…' });
    if (ev.holiday && !ev.greet) ev.greet = `Feiertag (${ev.holiday})!\nWas machst du hier?`;
    // 1.9: Jahreszeiten-Stimmung, wenn kein besonderer Tag ist
    if (!ev.fx) ev.fx = m === 10 || m === 11 ? 'leaves' : m === 4 || m === 5 ? 'petals' : m === 1 || m === 2 ? 'flakes' : m === 7 || m === 8 ? 'heat' : null;
    return ev;
  }

  const api = { ITEMS, SLOTS, ACHIEVEMENTS, holiday, today, easter, seasonFlags };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SudoProgress = api;
})(typeof window !== 'undefined' ? window : globalThis);
