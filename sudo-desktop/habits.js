// habits.js – 1.10: kleine gute Gewohnheiten, alles nur lokal.
// 1. Sperr-Erinnerung: Warst du länger weg und der Bildschirm war offen, erinnert Sudo beim Zurückkommen an Win+L.
//    Hast du gesperrt, gibt es (einmal am Tag) ein Lob und ein paar XP.
// 2. Tipps im passenden Moment: Ist Excel, Outlook & Co. eine Weile im Vordergrund, kommt ab und zu ein kurzer Tipp.
//    Gezählt wird nur, welcher Tipp zuletzt kam – nicht, was du tust.
'use strict';

const AWAY_SEC = 10 * 60;          // so lange ohne Eingabe gilt als „weg“
const LOCK_PRAISE_MIN = 2;         // mindestens so lange gesperrt, damit es als „Pause mit Sperre“ zählt
const TIP_AFTER_SEC = 120;         // so lange muss ein Programm am Stück vorne sein
const TIP_GAP = { normal: 90 * 60e3, rare: 24 * 3600e3 };
const TIP_MAX_DAY = { normal: 3, rare: 1 };
const HABITS_DEFAULTS = { lockHint: true, tips: 'normal', tipSeen: {}, lockHintDay: '', lockPraiseDay: '', tipDay: '', tipsToday: 0, tipLast: 0 };

// Mitgelieferte Tipps (deutsch = Schlüssel für die Übersetzung)
const TIPS = {
  excel: [
    'Strg+T macht aus deinen Daten eine Tabelle – mit Filter und Formatierung.',
    'Strg+Pfeiltaste springt ans Ende eines Datenblocks.',
    'Alt+Umschalt+0 fügt die Summe der Zellen darüber ein (AutoSumme).',
    'Strg+Umschalt+L schaltet die Filter ein und aus.',
    'Strg+Punkt (Strg+.) trägt das heutige Datum ein.'
  ],
  word: [
    'Rechtsklick → Einfügeoptionen → „Nur den Text übernehmen“ fügt ohne fremde Formatierung ein.',
    'Mit den Formatvorlagen „Überschrift 1, 2 …“ baut Word dir das Inhaltsverzeichnis von selbst.',
    'F12 öffnet „Speichern unter“.',
    'Doppelklick auf den Pinsel „Format übertragen“ – dann kannst du mehrere Stellen hintereinander formatieren.'
  ],
  outlook: [
    'Fahr mit der Maus über den Absender – dann siehst du die echte Adresse. Passt sie nicht, ist es oft Phishing.',
    'Strg+R antwortet, Strg+Umschalt+R antwortet allen.',
    'Vor dem Urlaub an die automatischen Antworten denken (Einstellungen → Automatische Antworten).',
    'Große Dateien lieber als OneDrive-Link schicken statt als Anhang – alle sehen dann dieselbe Version.'
  ],
  teams: [
    'Strg+Umschalt+M schaltet im Meeting dein Mikrofon stumm und wieder an.',
    'Strg+Umschalt+O schaltet die Kamera an und aus.',
    'Strg+E springt in die Suche.',
    'Mit @Name im Chat bekommt die Person eine Benachrichtigung.',
    'Wichtiger Termin gleich? Selbsthilfe → Meeting-Check prüft Ton und Bild in einer Minute.'
  ],
  powerpoint: [
    'F5 startet die Präsentation von vorn, Umschalt+F5 ab der aktuellen Folie.',
    'Während der Präsentation macht die Taste B den Bildschirm schwarz – nochmal B, und es geht weiter.',
    'Strg+D verdoppelt die markierte Folie oder Form.'
  ],
  onenote: [
    'Strg+1 macht aus einer Zeile eine Aufgabe zum Abhaken.',
    'Strg+Punkt (Strg+.) macht eine Aufzählung.'
  ],
  browser: [
    'Strg+Umschalt+T öffnet den zuletzt geschlossenen Tab wieder.',
    'Strg+L springt in die Adresszeile.',
    'Unbekannter Link? Mit der Maus drüberfahren und unten links die echte Adresse prüfen.',
    'Viele Tabs offen? Nicht benötigte schließen macht den PC schneller.'
  ],
  sharepoint: ['Dateien teilen statt anhängen: Link schicken, alle arbeiten an derselben Version.'],
  onedrive: ['Dateien teilen statt anhängen: Link schicken, alle arbeiten an derselben Version.'],
  all: [
    'Win+V zeigt den Verlauf der Zwischenablage.',
    'Win+Umschalt+S schneidet einen Bildschirmausschnitt aus – einfügen mit Strg+V.',
    'Win+L sperrt den Bildschirm, wenn du kurz weggehst.',
    'Win+Pfeiltaste links/rechts teilt den Bildschirm zwischen zwei Fenstern auf.'
  ]
};
const TAG_NAMES = { excel: 'Excel', word: 'Word', outlook: 'Outlook', teams: 'Teams', powerpoint: 'PowerPoint', onenote: 'OneNote', browser: 'Browser', sharepoint: 'SharePoint', onedrive: 'OneDrive' };
const TIP_TAGS = new Set(['excel', 'word', 'outlook', 'teams', 'powerpoint', 'onenote', 'browser', 'sharepoint', 'onedrive']);
// Programme, bei denen langes Nichtstun normal ist (Video schauen, Präsentation) – dann keine Sperr-Erinnerung
const PASSIVE_TAGS = new Set(['video', 'youtube', 'ytmusic', 'webmusic', 'music', 'powerpoint', 'rdp']);

const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

function createHabits({ getState, setState, idleSeconds, isBusy, currentTag, appName, customTips, tipsAllowed, workday, notify, log, test }) {
  const st = () => ({ ...HABITS_DEFAULTS, ...(getState() || {}) });
  const save = patch => setState({ ...st(), ...patch });
  let away = null, locked = false, lockAt = 0, tagSince = 0, lastTag = '';

  /* ---------- Sperren ---------- */
  function lockTick() {
    if (locked) return;
    const idle = idleSeconds(), tag = currentTag();
    if (!away && idle >= AWAY_SEC) { away = { since: Date.now() - idle * 1000, skip: isBusy() || PASSIVE_TAGS.has(tag) }; return; }
    if (away && idle >= AWAY_SEC && (isBusy() || PASSIVE_TAGS.has(tag))) away.skip = true;
    if (away && idle < 5) {
      const min = Math.round((Date.now() - away.since) / 60000), skip = away.skip;
      away = null;
      const s = st();
      if (skip || !s.lockHint || !workday() || isBusy() || s.lockHintDay === dayKey()) return;
      save({ lockHintDay: dayKey() });
      log(`Sperr-Erinnerung (${min} min weg, Bildschirm offen)`);
      notify({ kind: 'lockhint', min });
    }
  }
  function onLock() { locked = true; lockAt = Date.now(); away = null; }
  function onUnlock() {
    const min = (Date.now() - lockAt) / 60000;
    locked = false; away = null;
    const s = st();
    if (!lockAt || min < LOCK_PRAISE_MIN || !s.lockHint || !workday() || s.lockPraiseDay === dayKey()) return;
    save({ lockPraiseDay: dayKey() });
    log('Bildschirm gesperrt gewesen – Lob');
    setTimeout(() => notify({ kind: 'locked', min: Math.round(min) }), 6000);   // erst nach dem Neuaufbau des Overlays
  }

  /* ---------- Tipps ---------- */
  function pickTip(tag) {
    const s = st(), seen = s.tipSeen || {};
    const own = (customTips() || []).filter(t => t.app === tag || t.app === 'all').map(t => ({ text: t.text, own: true }));
    const pool = [...own, ...(TIPS[tag] || []).map(text => ({ text })), ...TIPS.all.map(text => ({ text }))];
    if (!pool.length) return null;
    // Eigene Tipps der Firma zuerst, sonst der am längsten nicht gezeigte
    pool.sort((a, b) => (seen[hash(a.text)] || 0) - (seen[hash(b.text)] || 0) || (b.own ? 1 : 0) - (a.own ? 1 : 0));
    return pool[0];
  }
  function tipTick() {
    const tag = currentTag();
    if (tag !== lastTag) { lastTag = tag; tagSince = Date.now(); return; }
    const s = st(), mode = tipsAllowed() ? s.tips : 'off';
    if (mode === 'off' || !TIP_TAGS.has(tag) || Date.now() - tagSince < TIP_AFTER_SEC * 1000) return;
    if (!workday() || isBusy() || idleSeconds() > 30) return;
    const today = dayKey(), n = s.tipDay === today ? s.tipsToday : 0;
    if (n >= (TIP_MAX_DAY[mode] || 1) || Date.now() - (s.tipLast || 0) < (TIP_GAP[mode] || TIP_GAP.rare)) return;
    const tip = pickTip(tag);
    if (!tip) return;
    const seen = { ...(s.tipSeen || {}), [hash(tip.text)]: Date.now() };
    const keys = Object.keys(seen); if (keys.length > 120) for (const k of keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - 120)) delete seen[k];
    save({ tipSeen: seen, tipDay: today, tipsToday: n + 1, tipLast: Date.now() });
    tagSince = Date.now();
    log('Tipp gezeigt (' + tag + ')');
    notify({ kind: 'tip', app: TAG_NAMES[tag] || appName(), text: tip.text, own: !!tip.own });
  }

  const timer = setInterval(() => { try { lockTick(); tipTick(); } catch (e) { log('Gewohnheiten: ' + e.message); } }, test ? 1000 : 5000);
  return { onLock, onUnlock, stop: () => clearInterval(timer), tipNow: tag => { tag = TIP_TAGS.has(tag) ? tag : 'excel'; const t = pickTip(tag); if (t) notify({ kind: 'tip', app: TAG_NAMES[tag], text: t.text, own: !!t.own }); } };
}

module.exports = { createHabits, HABITS_DEFAULTS, TIPS };
