// work.js – Arbeitstag, Pausen-Erinnerungen und Bildschirmzeit (alles nur lokal)
'use strict';
const fs = require('fs');
const path = require('path');
const { holiday } = require('./renderer/progress.js');

const DEFAULTS = {
  enabled: true,
  days: [1, 2, 3, 4, 5],                                  // Mo–Fr (0 = Sonntag)
  breaks: [{ time: '12:00', min: 30, label: 'Mittagspause' }],
  stand: { on: true, every: 50 },                          // Minuten aktiver Arbeit
  eyes: { on: true, every: 60 },
  water: { on: false, every: 90 },
  target: { on: true, hours: 8 },                          // Sollarbeitszeit ohne Pausen
  screenTime: true
};
const ACTIVE_IDLE = 60;     // Sekunden ohne Eingabe, bis du als "nicht aktiv" giltst
const AWAY_RESET = 300;     // 5 Minuten weg = Pause gemacht, Zähler zurücksetzen
const KEEP_DAYS = 30;

const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

function normalize(w) {
  const o = { ...DEFAULTS, ...(w || {}) };
  for (const k of ['stand', 'eyes', 'water', 'target']) o[k] = { ...DEFAULTS[k], ...((w || {})[k] || {}) };
  o.days = Array.isArray(o.days) ? o.days.filter(d => d >= 0 && d <= 6) : DEFAULTS.days;
  o.breaks = (Array.isArray(o.breaks) ? o.breaks : [])
    .filter(b => /^\d{1,2}:\d{2}$/.test(b.time))
    .map(b => ({ time: b.time.padStart(5, '0'), min: Math.max(5, Math.min(120, Number(b.min) || 15)), label: String(b.label || 'Pause').slice(0, 30) }))
    .sort((a, b) => toMin(a.time) - toMin(b.time))
    .slice(0, 8);
  for (const k of ['stand', 'eyes', 'water']) o[k].every = Math.max(10, Math.min(240, Number(o[k].every) || DEFAULTS[k].every));
  o.target.hours = Math.max(1, Math.min(12, Number(o.target.hours) || 8));
  return o;
}

function createWork({ userData, getSettings, care, log, blocked, idleSeconds, currentApp }) {
  const file = path.join(userData, 'screentime.json');
  let data = { days: {} };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!data.days) data = { days: {} }; } catch { /* neu */ }
  let dirty = false, sinceStand = 0, sinceEyes = 0, sinceWater = 0, pending = [];
  let lastBreakHint = 0, breakCounted = true;   // für "Pause wirklich gemacht"

  const cfg = () => normalize(getSettings().work);
  function today() {
    const k = dayKey();
    if (!data.days[k]) {
      data.days[k] = { start: null, last: null, active: 0, apps: {}, fired: {} };
      const keys = Object.keys(data.days).sort();
      while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
    }
    return data.days[k];
  }
  function save() {
    if (!dirty) return;
    try { fs.writeFileSync(file, JSON.stringify(data)); dirty = false; } catch (e) { log('Bildschirmzeit speichern: ' + e.message); }
  }
  function endEstimate(d, c) {
    if (!d.start || !c.target.on) return null;
    const pauseMin = c.breaks.reduce((s, b) => s + b.min, 0);
    return new Date(new Date(d.start).getTime() + (c.target.hours * 60 + pauseMin) * 60000);
  }
  // Erinnerungen während Meeting/Vollbild zurückhalten und danach zustellen
  function deliver(msg) {
    if (['stand', 'eyes', 'fixed'].includes(msg.kind)) { lastBreakHint = Date.now(); breakCounted = false; }
    if (blocked()) { if (!pending.some(p => p.kind === msg.kind)) pending.push(msg); return; }
    care(msg);
  }

  function tick() {
    const c = cfg();
    if (!c.enabled) return;
    const now = new Date(), d = today(), idle = idleSeconds();
    const active = idle < ACTIVE_IDLE;
    const workday = c.days.includes(now.getDay()) && !holiday(now);

    if (idle >= AWAY_RESET) {
      sinceStand = 0; sinceEyes = 0; sinceWater = 0;
      // Nach einer Pausen-Erinnerung mindestens 5 Minuten weg gewesen? Das zählt als echte Pause.
      if (!breakCounted && Date.now() - lastBreakHint < 20 * 60000) { breakCounted = true; care({ kind: 'breaktaken' }); log('Pause eingehalten'); }
    }
    if (!active) return;

    d.last = now.toISOString(); d.active++; dirty = true;
    sinceStand++; sinceEyes++; sinceWater++;
    if (c.screenTime) { const app = currentApp(); if (app) d.apps[app] = (d.apps[app] || 0) + 1; }

    if (!d.start && now.getHours() >= 4) {
      d.start = now.toISOString();
      const end = endEstimate(d, c);
      log(`Arbeitsbeginn ${hhmm(now)}`);
      if (workday) deliver({ kind: 'workstart', time: hhmm(now), end: end ? hhmm(end) : null });
    }
    if (!workday) return;

    if (pending.length && !blocked()) { pending.forEach(care); pending = []; }

    // feste Pausen: 5 Minuten vorher ankündigen, dann zur Uhrzeit
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const b of c.breaks) {
      const t = toMin(b.time);
      if (nowMin >= t - 5 && nowMin < t && !d.fired['soon' + b.time]) { d.fired['soon' + b.time] = 1; deliver({ kind: 'soon', label: b.label, time: b.time }); }
      if (nowMin >= t && nowMin < t + b.min && !d.fired['break' + b.time]) {
        d.fired['break' + b.time] = 1; sinceStand = 0; sinceEyes = 0;
        deliver({ kind: 'fixed', label: b.label, min: b.min });
      }
    }
    if (c.stand.on && sinceStand >= c.stand.every * 60) { sinceStand = 0; deliver({ kind: 'stand', every: c.stand.every }); }
    if (c.eyes.on && sinceEyes >= c.eyes.every * 60) { sinceEyes = 0; deliver({ kind: 'eyes' }); }
    if (c.water.on && sinceWater >= c.water.every * 60) { sinceWater = 0; deliver({ kind: 'water' }); }
    const end = endEstimate(d, c);
    if (end && now >= end && !d.fired.end) { d.fired.end = 1; deliver({ kind: 'end', hours: c.target.hours }); }
  }

  function summary() {
    const c = cfg(), d = today(), end = endEstimate(d, c);
    const apps = Object.entries(d.apps).sort((a, b) => b[1] - a[1]);
    const top = apps.slice(0, 8), rest = apps.slice(8).reduce((s, a) => s + a[1], 0);
    if (rest) top.push(['Sonstige', rest]);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const x = data.days[dayKey(dt)];
      week.push({ day: dayKey(dt), wd: dt.getDay(), active: x ? x.active : 0 });
    }
    return {
      start: d.start ? hhmm(new Date(d.start)) : null,
      active: d.active, end: end ? hhmm(end) : null,
      apps: top, week, screenTime: c.screenTime,
      nextBreak: c.breaks.find(b => toMin(b.time) > new Date().getHours() * 60 + new Date().getMinutes()) || null
    };
  }
  function clearScreenTime() { for (const k of Object.keys(data.days)) data.days[k].apps = {}; dirty = true; save(); }

  return { tick, save, summary, clearScreenTime, normalize, defaults: DEFAULTS };
}

module.exports = { createWork, normalize, DEFAULTS };
