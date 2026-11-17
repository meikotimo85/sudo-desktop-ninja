// ops.js – Hinweise der IT (1.6): Störungen mit „Ich bin auch betroffen“ und Neustart-Kampagnen.
// Die Zentrale liefert bei jedem Abruf/Verbinden { help, incidents, resolved, restart }; hier wird daraus,
// was Sudo zeigt und meldet. Gemeldet wird nur: betroffen ja/nein und der Stand der Neustart-Aufforderung.
'use strict';
const os = require('os');
const { execFile } = require('child_process');

const HOUR = 3600e3;
const SEV_TYPE = { info: 'message', stoerung: 'warning', ausfall: 'warning' };

function createOps({ getState, setState, zentrale, announce, log, isBusy, openNotice, onChange, rebootPending, test }) {
  let cfg = { help: null, incidents: [], resolved: [], restart: [] };
  let pending = false, pendingAt = 0, restartingUntil = 0;
  const st = () => { const s = getState() || {}; return { seen: s.seen || {}, aff: s.aff || {}, rs: s.rs || {} }; };
  const save = s => setState({ seen: s.seen, aff: s.aff, rs: s.rs });
  const z = () => zentrale();
  const changed = () => { try { onChange && onChange(); } catch { /* egal */ } };
  const bootAt = () => Date.now() - os.uptime() * 1000;
  const upDays = () => Math.floor(os.uptime() / 86400);

  /* ---------- Störungen ---------- */
  function incidents(s) {
    const now = Date.now();
    for (const i of cfg.incidents) {
      if (s.seen[i.id]) continue;
      s.seen[i.id] = { at: now };
      log(`Störung gemeldet: ${i.title}`);
      announce({ type: SEV_TYPE[i.sev] || 'warning', text: (i.sev === 'info' ? 'ℹ ' : '⚠ ') + i.title + (i.text ? ' – ' + i.text : ''), link: 'sudo:hinweise', dur: i.sev === 'ausfall' ? 'klick' : 45 });
    }
    for (const r of cfg.resolved) {
      const seen = s.seen[r.id];
      if (!seen || seen.done) continue;
      seen.done = now;
      log(`Störung beendet: ${r.title}`);
      announce({ type: 'success', text: '✅ ' + r.title + (r.text ? ' – ' + r.text : '') });
    }
    // Aufräumen: Unbekanntes älter als 14 Tage vergessen
    const known = new Set([...cfg.incidents, ...cfg.resolved].map(x => String(x.id)));
    for (const id of Object.keys(s.seen)) if (!known.has(id) && now - (s.seen[id].done || s.seen[id].at) > 14 * 86400e3) { delete s.seen[id]; delete s.aff[id]; }
  }
  async function affected(id, on) {
    const api = z();
    if (!api) return { ok: false, msg: 'Nicht mit der Zentrale verbunden.' };
    const r = await api.incidentAffected(Number(id), on);
    if (r.ok) {
      const s = st(); if (on) s.aff[id] = true; else delete s.aff[id]; save(s);
      const i = cfg.incidents.find(x => String(x.id) === String(id));
      if (i && Number.isFinite(r.affected)) i.affected = r.affected;
      log(`Störung ${id}: ${on ? 'betroffen' : 'nicht mehr betroffen'}`);
      api.refreshOps(); changed();
    }
    return r;
  }

  /* ---------- Neustart-Kampagnen ---------- */
  function stateOf(c, s) {
    if (bootAt() > c.created) return 'done';
    if (c.mode === 'pending' && !pending && upDays() < (c.days || 7)) return 'notneeded';
    if (restartingUntil > Date.now()) return 'restarting';
    const r = s.rs[c.id] || {};
    return r.snoozeUntil > Date.now() ? 'snoozed' : 'open';
  }
  function report(c, s, force) {
    const r = s.rs[c.id] = s.rs[c.id] || { snoozes: 0 };
    const state = stateOf(c, s);
    const key = `${state}|${r.snoozes || 0}`;
    if (!force && r.sent === key) return;
    const api = z(); if (!api) return;
    r.sent = key;
    api.restartStatus({ id: c.id, state, bootAt: bootAt(), snoozeUntil: r.snoozeUntil || 0, snoozes: r.snoozes || 0, upDays: upDays() })
      .then(x => { if (!x.ok) { const s2 = st(); if (s2.rs[c.id]) { s2.rs[c.id].sent = ''; save(s2); } } });
  }
  function snoozeOptions(c) {
    const now = Date.now(), overdue = c.deadline && now > c.deadline;
    if (overdue) return [{ id: 'h1', label: 'In 1 Stunde erinnern' }];
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    const opts = [{ id: 'h1', label: 'In 1 Stunde' }, { id: 'h3', label: 'In 3 Stunden' }];
    if (!c.deadline || tomorrow.getTime() < c.deadline) opts.push({ id: 'tomorrow', label: 'Morgen früh' });
    return opts;
  }
  function snooze(id, opt) {
    const c = cfg.restart.find(x => String(x.id) === String(id));
    if (!c) return { ok: false };
    const ok = snoozeOptions(c).some(o => o.id === opt);
    if (!ok) return { ok: false, msg: 'Diese Option gibt es nicht mehr – die Frist ist abgelaufen.' };
    const s = st(); const r = s.rs[c.id] = s.rs[c.id] || { snoozes: 0 };
    let until = Date.now() + HOUR;
    if (opt === 'h3') until = Date.now() + 3 * HOUR;
    if (opt === 'tomorrow') { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); until = t.getTime(); }
    if (c.deadline && Date.now() < c.deadline) until = Math.min(until, c.deadline);   // nie über die Frist hinaus
    r.snoozeUntil = until; r.snoozes = (r.snoozes || 0) + 1;
    log(`Neustart „${c.title}“ verschoben bis ${new Date(until).toLocaleString('de-DE')}`);
    report(c, s); save(s); changed();
    return { ok: true, until };
  }
  function restartNow(id) {
    const c = cfg.restart.find(x => String(x.id) === String(id));
    const s = st();
    const linux = process.platform === 'linux';
    if (process.platform !== 'win32' && !linux && !test) return Promise.resolve({ ok: false, msg: 'Nur unter Windows.' });
    return new Promise(resolve => {
      const done = err => {
        if (err) return resolve({ ok: false, msg: 'Neustart konnte nicht gestartet werden.' });
        restartingUntil = Date.now() + 5 * 60e3;
        log('Neustart in 2 Minuten (Neustart-Kampagne)');
        if (c) report(c, s, true);
        save(s); changed();
        resolve({ ok: true });
      };
      if (test) return done(null);
      // Linux (1.12): systemd plant den Neustart über logind – für die angemeldete Sitzung ohne Root-Rechte erlaubt
      if (linux) return execFile('shutdown', ['-r', '+2', 'Sudo: Neustart in 2 Minuten. Bitte jetzt alles speichern.'], { timeout: 10000 }, done);
      execFile('shutdown.exe', ['/r', '/t', '120', '/c', 'Sudo: Neustart in 2 Minuten. Bitte jetzt alles speichern.'], { windowsHide: true }, done);
    });
  }
  function cancelRestart() {
    restartingUntil = 0;
    return new Promise(resolve => {
      const after = () => { const s = st(); for (const c of cfg.restart) report(c, s, true); save(s); changed(); log('Neustart abgebrochen'); resolve({ ok: true }); };
      if (test) return after();
      if (process.platform === 'linux') return execFile('shutdown', ['-c'], { timeout: 10000 }, after);
      if (process.platform !== 'win32') return after();
      execFile('shutdown.exe', ['/a'], { windowsHide: true }, after);
    });
  }
  // Fällige Aufforderung zeigen – nie im Meeting oder Vollbild, dann beim nächsten Durchlauf
  function tickRestart() {
    const s = st(); let dirty = false;
    for (const c of cfg.restart) {
      report(c, s);
      const state = stateOf(c, s);
      const r = s.rs[c.id];
      if (state !== 'open' || Date.now() < (r.nextPrompt || 0) || isBusy()) continue;
      // Ohne Antwort in 2 Stunden erneut (nach Fristende jede Stunde)
      r.nextPrompt = Date.now() + (c.deadline && Date.now() > c.deadline ? HOUR : 2 * HOUR);
      dirty = true;
      log(`Neustart-Aufforderung: ${c.title}`);
      announce({ type: 'warning', text: '🔄 ' + c.title, link: 'sudo:hinweise', dur: 'klick' });
      openNotice('restart');
    }
    if (dirty) save(s);
  }
  async function refreshPending() {
    if (Date.now() - pendingAt < 30 * 60e3) return;
    pendingAt = Date.now();
    try { pending = !!(await rebootPending()); } catch { pending = false; }
  }

  /* ---------- Zentrale-Vorgaben übernehmen ---------- */
  async function update(o) {
    cfg = {
      help: o && o.help && typeof o.help === 'object' ? o.help : null,
      incidents: Array.isArray(o && o.incidents) ? o.incidents : [],
      resolved: Array.isArray(o && o.resolved) ? o.resolved : [],
      restart: Array.isArray(o && o.restart) ? o.restart : []
    };
    const s = st();
    incidents(s);
    // Vergessene Kampagnen aufräumen
    const ids = new Set(cfg.restart.map(c => String(c.id)));
    for (const id of Object.keys(s.rs)) if (!ids.has(id)) delete s.rs[id];
    save(s);
    if (cfg.restart.length) { await refreshPending(); tickRestart(); }
    changed();
  }
  const timer = setInterval(async () => { if (cfg.restart.length) { await refreshPending(); tickRestart(); } }, test ? 5000 : 60e3);

  function view() {
    const s = st();
    return {
      help: cfg.help,
      incidents: cfg.incidents.map(i => ({ ...i, mine: !!s.aff[i.id] })),
      resolved: cfg.resolved.filter(r => s.seen[r.id]),
      restart: cfg.restart.map(c => ({ ...c, state: stateOf(c, s), snoozeUntil: (s.rs[c.id] || {}).snoozeUntil || 0, snoozes: (s.rs[c.id] || {}).snoozes || 0, options: snoozeOptions(c), upDays: upDays(), pending })),
      restarting: restartingUntil > Date.now()
    };
  }
  const openCount = () => cfg.incidents.length + cfg.restart.filter(c => ['open', 'snoozed'].includes(stateOf(c, st()))).length;
  // 1.10: beendete Störungen, bei denen dieser PC „Ich bin auch betroffen“ gemeldet hat (für „Läuft es wieder?“)
  const resolvedAffected = () => { const s = st(); return cfg.resolved.filter(r => s.aff[r.id]).map(r => ({ id: r.id, title: r.title })); };
  return { update, view, affected, snooze, restartNow, cancelRestart, help: () => cfg.help, openCount, resolvedAffected, stop: () => clearInterval(timer) };
}

module.exports = { createOps };
