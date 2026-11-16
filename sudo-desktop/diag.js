// diag.js – 1.9: Ressourcen und Stabilität.
// Misst CPU und Arbeitsspeicher aller Sudo-Prozesse, zählt Fehler und Neustarts des Overlays
// und liefert eine kleine, datensparsame Zusammenfassung (für Einstellungen → Info und die Zentrale).
'use strict';

const DAY = 864e5;

function createDiag({ app, log, onChange }) {
  const started = Date.now();
  const samples = [];                 // { at, cpu, ram } – höchstens 1 h
  const crashes = [];                 // Zeitpunkte von Overlay-Abstürzen / -Neustarts
  const errors = [];                  // { at, msg }
  let lastSummary = '';

  // Pfade und Benutzernamen aus Fehlermeldungen entfernen (gehen evtl. an die Zentrale)
  const scrub = m => String(m || '').replace(/[A-Z]:\\[^\s'"]*/gi, '<Pfad>').replace(/\/(home|Users)\/[^\s'"]*/g, '<Pfad>').replace(/\s+/g, ' ').trim().slice(0, 200);
  const prune = () => {
    const min = Date.now() - DAY;
    while (crashes.length && crashes[0] < min) crashes.shift();
    while (errors.length && errors[0].at < min) errors.shift();
    while (samples.length && samples[0].at < Date.now() - 3600e3) samples.shift();
  };

  function measure() {
    let cpu = 0, ram = 0;
    const byType = {};
    try {
      for (const p of app.getAppMetrics()) {
        const c = (p.cpu && p.cpu.percentCPUUsage) || 0;
        const m = ((p.memory && p.memory.workingSetSize) || 0) / 1024;      // KB → MB
        cpu += c; ram += m;
        const t = p.type === 'Tab' ? 'Overlay/Fenster' : p.type === 'Browser' ? 'Hauptprozess' : p.type === 'GPU' ? 'Grafik' : 'Hilfsprozesse';
        byType[t] = byType[t] || { cpu: 0, ram: 0, n: 0 };
        byType[t].cpu += c; byType[t].ram += m; byType[t].n++;
      }
    } catch (e) { return null; }
    const s = { at: Date.now(), cpu: Math.round(cpu * 10) / 10, ram: Math.round(ram) };
    samples.push(s); prune();
    for (const t of Object.values(byType)) { t.cpu = Math.round(t.cpu * 10) / 10; t.ram = Math.round(t.ram); }
    s.byType = byType;
    return s;
  }
  // Durchschnitt der letzten 10 Minuten
  function avg(min = 10) {
    const from = Date.now() - min * 60000, list = samples.filter(s => s.at >= from);
    if (!list.length) return null;
    return { cpu: Math.round(list.reduce((a, s) => a + s.cpu, 0) / list.length * 10) / 10, ram: Math.round(list.reduce((a, s) => a + s.ram, 0) / list.length), n: list.length };
  }
  function error(where, e) {
    const msg = scrub(e && (e.stack || e.message) ? (e.message || String(e)) : e);
    errors.push({ at: Date.now(), msg: `${where}: ${msg}`.slice(0, 220) }); prune();
    log(`Fehler (${where}): ${msg}`);
    if (onChange) onChange();
  }
  function crash(reason) { crashes.push(Date.now()); prune(); log('Overlay-Problem: ' + reason); if (onChange) onChange(); }
  const crashesLastHour = () => crashes.filter(t => t > Date.now() - 3600e3).length;

  // Für Einstellungen → Info
  function view() {
    prune();
    const now = samples[samples.length - 1] || measure();
    return { now, avg: avg(10), uptimeMin: Math.round((Date.now() - started) / 60000), crashes: crashes.length, errors: errors.slice(-5).reverse() };
  }
  // Für die Zentrale: nur Zahlen und gekürzte Fehlertexte; null, wenn sich nichts Wesentliches geändert hat
  function summary(force = false) {
    prune();
    const a = avg(10) || (samples.length ? samples[samples.length - 1] : null);
    const s = { cpu: a ? a.cpu : null, ram: a ? a.ram : null, crashes: crashes.length, errors: errors.length, last: errors.length ? errors[errors.length - 1].msg : '', up: Math.round((Date.now() - started) / 3600e3 * 10) / 10 };
    // Nicht bei jeder kleinen Schwankung neu senden: auf 5 % CPU / 25 MB runden
    const key = JSON.stringify([s.cpu == null ? null : Math.round(s.cpu / 5), s.ram == null ? null : Math.round(s.ram / 25), s.crashes, s.errors, s.last]);
    if (!force && key === lastSummary) return null;
    lastSummary = key;
    return s;
  }
  return { measure, avg, error, crash, crashesLastHour, view, summary };
}

module.exports = { createDiag };
