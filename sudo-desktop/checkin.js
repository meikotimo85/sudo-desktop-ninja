// checkin.js – 1.10: Mitarbeiter-Erlebnis auf dem PC
// • Stimmungsbarometer: kurze Fragen der IT (1–5 Sterne), höflich angeboten, nie im Meeting, jederzeit überspringbar.
//   Die Zentrale speichert die Sterne ohne Gerät.
// • „Läuft es wieder?“ nach einer Störung – nur, wenn dieser PC „Ich bin auch betroffen“ gemeldet hatte.
//   Diese Antwort geht MIT Gerät an die IT, damit sie bei „Geht noch nicht“ helfen kann (steht so im Fenster).
// • Start-Checkliste für neue Kollegen: viele Punkte prüft Sudo selbst (nur „ja/nein“, keine Inhalte).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const OFFER_GAP = 3 * 3600e3, OFFER_MAX = 3;
const CHECKIN_DEFAULTS = { offers: {}, incDone: {}, lastOffer: 0, onbRemindDay: '', onbComplete: false };
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const reg = (key, value) => new Promise(r => execFile('reg.exe', ['query', key, ...(value ? ['/v', value] : [])], { windowsHide: true, timeout: 6000 }, (e, out) => r(e ? '' : String(out || ''))));
const LOCAL = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

// Automatische Prüfungen der Start-Checkliste – jeweils nur „erledigt ja/nein“
async function autoChecks({ printers, quizAnswered, healthOverall, fake }) {
  if (fake) return { onedrive: true, kfm: false, signature: false, printer: true, teams: true, quiz: quizAnswered() > 0, health: healthOverall() === 'ok' };
  const win = process.platform === 'win32';
  const [od, shell] = win ? await Promise.all([reg('HKCU\\Software\\Microsoft\\OneDrive\\Accounts\\Business1', 'UserEmail'),
    reg('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', 'Desktop')]) : ['', ''];
  let signature = false;
  try { signature = fs.readdirSync(path.join(ROAMING(), 'Microsoft', 'Signatures')).some(f => /\.htm$/i.test(f)); } catch { /* keine */ }
  const teams = fs.existsSync(path.join(LOCAL(), 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams')) || fs.existsSync(path.join(ROAMING(), 'Microsoft', 'Teams'));
  let printer = false;
  try { printer = (await printers()).some(p => !/(pdf|xps|onenote|fax|send to|an onenote|senden an)/i.test(p.name || p.displayName || '')); } catch { /* egal */ }
  return { onedrive: /REG_SZ\s+\S+@\S+/.test(od), kfm: /onedrive/i.test(shell), signature, printer, teams, quiz: quizAnswered() > 0, health: healthOverall() === 'ok' };
}

function createCheckin({ zentrale, getState, setState, isBusy, workday, notify, log, resolvedAffected, printers, quizAnswered, healthOverall, onChange, test }) {
  const st = () => ({ ...CHECKIN_DEFAULTS, ...(getState() || {}) });
  const save = patch => setState({ ...st(), ...patch });
  const z = () => zentrale();
  const cfg = () => (z() && z().status().enrolled && z().dexConfig ? z().dexConfig() : null) || null;
  const changed = () => { try { onChange && onChange(); } catch { /* egal */ } };
  let autos = {}, autoAt = 0, answered = new Set(), started = Date.now();

  /* ---------- Fragen ---------- */
  function questions() {
    const c = cfg(), s = st(), out = [];
    if (!c || !c.pulse || !c.pulse.enabled) return out;
    if (c.pulse.incident) for (const i of resolvedAffected()) if (!s.incDone[i.id]) out.push({ type: 'incident', key: 'i' + i.id, id: i.id, title: i.title });
    for (const q of c.pulse.surveys || []) if (!answered.has(q.id)) out.push({ type: 'survey', key: 's' + q.id, id: q.id, q: q.q, kind: q.kind });
    return out;
  }
  function offerTick() {
    const list = questions(), s = st();
    if (!list.length || !workday(true) || isBusy() || Date.now() - s.lastOffer < (test ? 20000 : OFFER_GAP)) return;
    const fresh = list.filter(q => ((s.offers[q.key] || {}).n || 0) < OFFER_MAX);
    if (!fresh.length) return;
    const offers = { ...s.offers };
    for (const q of fresh) offers[q.key] = { n: ((offers[q.key] || {}).n || 0) + 1, at: Date.now() };
    for (const k of Object.keys(offers)) if (Date.now() - offers[k].at > 60 * 864e5) delete offers[k];
    save({ offers, lastOffer: Date.now() });
    const inc = fresh.find(q => q.type === 'incident');
    log(`Kurze Frage angeboten (${fresh.length})`);
    notify(inc ? { kind: 'pulse_incident', title: inc.title } : { kind: 'pulse', n: fresh.length });
  }
  async function answerSurvey(id, score, comment, skip) {
    const api = z(); if (!api) return { ok: false, msg: 'Nicht mit der Zentrale verbunden.' };
    const r = await api.pulseAnswer({ id: Number(id), score: Number(score) || 0, comment: String(comment || '').slice(0, 300), skip: !!skip });
    if (r.ok || /beendet|gilt nicht/.test(r.msg || '')) { answered.add(Number(id)); changed(); }
    if (r.ok) log(skip ? 'Kurze Frage übersprungen' : 'Kurze Frage beantwortet');
    return r;
  }
  async function answerIncident(id, ok) {
    const api = z(); if (!api) return { ok: false, msg: 'Nicht mit der Zentrale verbunden.' };
    const r = await api.pulseIncident(Number(id), !!ok);
    if (r.ok || /nicht beendet|betrifft/.test(r.msg || '')) { const s = st(); save({ incDone: { ...s.incDone, [id]: ok ? 1 : 2 } }); changed(); }
    if (r.ok) log(`Störung ${id}: ${ok ? 'läuft wieder' : 'geht noch nicht'}`);
    return r;
  }

  /* ---------- Start-Checkliste ---------- */
  const onboard = () => { const c = cfg(); return c && c.onboard && Array.isArray(c.onboard.items) && c.onboard.items.length ? c.onboard : null; };
  let localDone = new Map();                                     // Punkt → erledigt (bis die Zentrale es bestätigt)
  function view() {
    const o = onboard();
    if (!o) return null;
    const done = new Set(o.done || []);
    const items = o.items.map(i => ({ ...i, done: localDone.has(i.id) ? localDone.get(i.id) : done.has(i.id), auto: i.check !== 'manual' && !!autos[i.check] }));
    return { items, done: items.filter(i => i.done).length, total: items.length, until: o.until };
  }
  async function mark(id, done, auto = false) {
    const api = z(); if (!api) return { ok: false };
    localDone.set(Number(id), !!done);
    const r = await api.onboardMark(Number(id), !!done, auto);
    if (!r.ok) localDone.delete(Number(id));
    changed(); completeCheck();
    return r;
  }
  async function runAuto(force) {
    const o = onboard();
    if (!o || (!force && Date.now() - autoAt < (test ? 5000 : 30 * 60e3))) return;
    autoAt = Date.now();
    try { autos = await autoChecks({ printers, quizAnswered, healthOverall, fake: test && process.env.SUDO_FAKE_ONBOARD }); } catch (e) { log('Checkliste: ' + e.message); return; }
    const v = view();
    for (const i of v ? v.items : []) if (i.check !== 'manual' && autos[i.check] && !i.done) await mark(i.id, true, true);
    changed();
  }
  function completeCheck() {
    const v = view(), s = st();
    if (!v || v.done < v.total || s.onbComplete) return;
    save({ onbComplete: true });
    log('Start-Checkliste komplett');
    notify({ kind: 'onboard_done', total: v.total });
  }
  function remindTick() {
    const v = view(), s = st();
    if (!v || v.done >= v.total || !workday(true) || isBusy() || s.onbRemindDay === dayKey()) return;
    if (!test && (new Date().getHours() < 10 && Date.now() - started < 20 * 60e3)) return;
    save({ onbRemindDay: dayKey() });
    notify({ kind: 'onboard', open: v.total - v.done, total: v.total });
  }

  const timer = setInterval(() => { try { offerTick(); runAuto(false); remindTick(); } catch (e) { log('Erlebnis: ' + e.message); } }, test ? 4000 : 60000);
  return {
    questions, answerSurvey, answerIncident, view, mark, runAuto, completeCheck,
    // Zentrale hat neue Vorgaben geschickt: bestätigte Punkte übernehmen
    configChanged: () => { const o = onboard(); if (o) { for (const id of o.done || []) if (localDone.get(id) === true) localDone.delete(id); runAuto(true); } changed(); },
    stop: () => clearInterval(timer)
  };
}

module.exports = { createCheckin, CHECKIN_DEFAULTS, autoChecks };
