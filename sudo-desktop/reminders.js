// reminders.js – Schnell-Erinnerungen und Notizen
// Eingabe in Alltagssprache: "20m Kunde anrufen", "1h30 Pause", "14:30 Teams-Call", "morgen 9 Backup prüfen"
// Englisch und Japanisch gehen auch: "tomorrow 9am standup", "明日 9時 バックアップ"
'use strict';
const fs = require('fs');
const path = require('path');

const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Text zerlegen in Zeitpunkt und Inhalt. Ohne erkennbare Zeit wird es eine Notiz.
 * @returns {{ at: Date|null, text: string, when: string }}
 */
function parse(input, now = new Date()) {
  let s = String(input || '').trim().replace(/\s+/g, ' ');
  if (!s) return { at: null, text: '', when: '' };
  s = s.replace(/^(in|um|ab|at)\s+/i, '');
  let at = null, m;
  // Auch Englisch ("20 min", "tomorrow 9am", "2:30pm") und Japanisch ("20分", "明日 9時", "14時30分")
  const END = '(?:(?=\\s|$)|(?<=[分秒間時]))';
  const H = '(?:h|std\\.?|stunden?|hrs?|hours?|時間)', MI = '(?:m|min\\.?|minuten?|mins?|minutes?|分)', SE = '(?:s|sek\\.?|sekunden?|secs?|seconds?|秒)';
  const rx = src => new RegExp(src, 'i');
  const h24 = (h, ap) => { h = Number(h); if (ap) { ap = ap.toLowerCase(); if (h > 12) return NaN; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return h; };
  const DAYS = { heute: 0, today: 0, '今日': 0, morgen: 1, tomorrow: 1, '明日': 1, 'übermorgen': 2, 'day after tomorrow': 2, '明後日': 2 };
  const CLOCK = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr|o\'?clock|時(?:\\s*(\\d{1,2})\\s*分)?)?\\s*(am|pm)?';

  // Dauer: 20m, 20 min, 2h, 1h30, 1 std 15 min, 90 sek, 20分, 1時間30分
  if ((m = s.match(rx(`^(\\d{1,3})\\s*${H}\\s*(?:(\\d{1,2})\\s*(?:${MI})?)?${END}`)))) {
    at = new Date(now.getTime() + (Number(m[1]) * 60 + Number(m[2] || 0)) * 60000);
  } else if ((m = s.match(rx(`^(\\d{1,4})\\s*${MI}${END}`)))) {
    at = new Date(now.getTime() + Number(m[1]) * 60000);
  } else if ((m = s.match(rx(`^(\\d{1,4})\\s*${SE}${END}`)))) {
    at = new Date(now.getTime() + Number(m[1]) * 1000);
  } else if ((m = s.match(rx(`^(heute|morgen|übermorgen|today|tomorrow|day after tomorrow|今日|明日|明後日)\\s*(?:um|at|の)?\\s*${CLOCK}${END}`)))) {
    const hr = h24(m[2], m[5]), mi = Number(m[3] || m[4] || 0);
    if (hr < 24 && mi < 60) { at = new Date(now); at.setDate(at.getDate() + DAYS[m[1].toLowerCase()]); at.setHours(hr, mi, 0, 0); }
  } else if ((m = s.match(rx(`^(\\d{1,2})(?:[:.](\\d{2}))\\s*(?:uhr)?\\s*(am|pm)?${END}`))) || (m = s.match(rx(`^(\\d{1,2})\\s*(?:uhr|o'?clock)${END}`)))
      || (m = s.match(rx(`^(\\d{1,2})()\\s*(am|pm)${END}`))) || (m = s.match(rx(`^(\\d{1,2})時(?:\\s*(\\d{1,2})\\s*分)?${END}`)))) {
    const hr = h24(m[1], m[3]), mi = Number(m[2] || 0);
    if (hr < 24 && mi < 60) {
      at = new Date(now); at.setHours(hr, mi, 0, 0);
      if (at <= now) at.setDate(at.getDate() + 1);       // Uhrzeit schon vorbei → morgen
    }
  }
  if (at && isNaN(at)) at = null;
  if (!at) m = null;
  const text = (at && m ? s.slice(m[0].length).replace(/^\s*[にで、]/, '') : s).replace(/^[\s:,–-]+/, '').trim() || (at ? 'Erinnerung' : '');

  let when = '';
  if (at) {
    const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
    const diff = Math.round((at - now) / 60000);
    when = days === 0 ? (diff < 60 ? `in ${Math.max(1, diff)} Min. (${hhmm(at)})` : `heute ${hhmm(at)}`)
      : days === 1 ? `morgen ${hhmm(at)}` : `${pad(at.getDate())}.${pad(at.getMonth() + 1)}. ${hhmm(at)}`;
  }
  return { at, text: text.slice(0, 140), when };
}

function createReminders({ userData, deliver, log }) {
  const file = path.join(userData, 'reminders.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(items)) items = []; } catch { /* neu */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(items, null, 1)); } catch (e) { log('Erinnerungen speichern: ' + e.message); } };
  let seq = items.reduce((m, i) => Math.max(m, i.id || 0), 0);

  function add(input) {
    const p = parse(input);
    if (!p.text) return { ok: false, msg: 'Bitte etwas eingeben.' };
    const item = { id: ++seq, text: p.text, at: p.at ? p.at.toISOString() : null, created: new Date().toISOString() };
    items.push(item); save();
    log(item.at ? `Erinnerung angelegt (${p.when})` : 'Notiz angelegt');
    return { ok: true, item, msg: item.at ? `Erinnerung ${p.when}` : 'Als Notiz gespeichert' };
  }
  function remove(id) { items = items.filter(i => i.id !== id); save(); }
  function snooze(id, min = 10) {
    const i = items.find(x => x.id === id);
    if (!i) return;
    i.at = new Date(Date.now() + min * 60000).toISOString(); delete i.fired; save();
    log(`Erinnerung geschlummert (${min} Min.)`);
  }
  function list() {
    const rem = items.filter(i => i.at && !i.fired).sort((a, b) => a.at.localeCompare(b.at));
    const notes = items.filter(i => !i.at).sort((a, b) => b.created.localeCompare(a.created));
    return { reminders: rem, notes };
  }
  function tick() {
    const now = Date.now();
    let changed = false;
    for (const i of items) {
      if (!i.at || i.fired) continue;
      const t = Date.parse(i.at);
      if (t <= now) {
        i.fired = true; changed = true;
        deliver({ id: i.id, text: i.text, late: now - t > 5 * 60000 ? Math.round((now - t) / 60000) : 0 });
      }
    }
    // Erledigte Erinnerungen nach einem Tag aufräumen
    const before = items.length;
    items = items.filter(i => !(i.fired && Date.parse(i.at) < now - 864e5));
    if (changed || items.length !== before) save();
  }
  const timer = setInterval(tick, 5000);
  setTimeout(tick, 3000);
  return { add, remove, snooze, list, parse, stop: () => clearInterval(timer), noteCount: () => items.filter(i => !i.at).length };
}

module.exports = { createReminders, parse };
