// zentrale.js – Verbindung zur Sudo-Zentrale: einmalig registrieren, dann per WebSocket Meldungen empfangen,
// außerdem „Frag Sudo“ über den Server (dort liegen API-Schlüssel und Budget).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ZENTRALE_DEFAULTS = { url: '', deviceId: '', name: '', tokenEnc: '', tokenPlain: false, enroll: '' };
const normUrl = u => { try { const x = new URL(String(u).trim()); if (!/^https?:$/.test(x.protocol)) return ''; return x.origin + x.pathname.replace(/\/+$/, ''); } catch { return ''; } };

// Vorgaben für zentrale Verteilung: Datei C:\ProgramData\Sudo\zentrale.json oder Richtlinie HKLM\SOFTWARE\Policies\MeikoSoft\Sudo
// Linux (1.12): /etc/sudo-desktop/zentrale.json (gleicher Aufbau, z. B. über NinjaOne, Ansible oder das .deb verteilt)
function readPreset(log) {
  return new Promise(resolve => {
    const file = process.platform === 'linux' ? '/etc/sudo-desktop/zentrale.json'
      : path.join(process.env.ProgramData || 'C:\\ProgramData', 'Sudo', 'zentrale.json');
    // BOM entfernen: Windows PowerShell 5.1 schreibt mit „Set-Content -Encoding UTF8“ eine voran, daran scheitert JSON.parse
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (j.url) return resolve({ url: String(j.url).trim(), code: String(j.code || j.enrollCode || '').trim(), from: 'Datei' });
    } catch (e) { if (e.code !== 'ENOENT') log(`Zentrale-Vorgabe ${file} unlesbar: ${e.message}`); }
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg.exe', ['query', 'HKLM\\SOFTWARE\\Policies\\MeikoSoft\\Sudo'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      const val = name => { const m = String(out).match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi')); return m ? m[1].trim() : ''; };
      const url = val('ZentraleUrl');
      resolve(url ? { url, code: val('EnrollCode'), from: 'Richtlinie' } : null);
    });
  }).catch(e => { log('Zentrale-Vorgabe: ' + e.message); return null; });
}

// 1.5: Anmeldename des Benutzers (UPN, meist die E-Mail-Adresse) – damit die Zentrale Meldungen an eine Person richten kann
// („user:vorname.nachname@firma.de“), ohne dass jemand Gerätenamen pflegen muss. Erst whoami /upn (AD/Entra),
// dann die Entra-Konten in HKCU\Software\Microsoft\IdentityCRL. Gibt '' zurück, wenn nichts zu finden ist (lokales Konto).
let upnCache = null;
const UPN_RE = /^[^\s@\\/]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$/i;
function readUpn() {
  if (upnCache !== null) return Promise.resolve(upnCache);
  if (process.env.SUDO_FAKE_UPN != null) return Promise.resolve(upnCache = process.env.SUDO_FAKE_UPN);
  if (process.platform !== 'win32') return Promise.resolve(upnCache = '');
  const run = (cmd, args) => new Promise(r => execFile(cmd, args, { windowsHide: true, timeout: 6000 }, (e, out) => r(e ? '' : String(out))));
  return (async () => {
    const w = (await run('whoami.exe', ['/upn'])).trim();
    if (UPN_RE.test(w)) return w.toLowerCase();
    const reg = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\IdentityCRL\\UserExtendedProperties']);
    const m = reg.split(/\r?\n/).map(l => l.trim().split('\\').pop()).find(x => UPN_RE.test(x));
    return m ? m.toLowerCase() : '';
  })().then(u => (upnCache = u)).catch(() => (upnCache = ''));
}

function createZentrale({ getSettings, setSettings, encrypt, decrypt, fetch, log, version, lang, onEvent, onConfig, onChange, test, visitPrefs, healthSummary, onQuiz, onOps, onMedia, onKb, onDex, onPlugins }) {
  const prefs = () => (visitPrefs ? visitPrefs() : { allow: true, name: '' });
  const cfg = () => ({ ...ZENTRALE_DEFAULTS, ...(getSettings().zentrale || {}) });
  let ws = null, online = false, retry = 0, timer = null, lastError = '', serverAi = null, device = null, stopped = false, lastPing = 0;
  let transport = null, pollSec = 15, acks = [];
  let healthWanted = false, healthSent = '', serverQuiz = null;
  let diagLast = null, diagPending = false;                        // 1.9: Ressourcen/Fehler des Clients (nur Zahlen + gekürzte Fehlertexte)
  let serverOps = null, opsJson = '';
  let serverKb = null;                                             // 1.9: Anleitungen aus SharePoint verfügbar
  let serverDex = null;                                            // 1.10: Stimmungsbarometer, Start-Checkliste, Tipps
  let serverPlugins = null;                                        // 1.12: Plugins der IT + ob eigene erlaubt sind
  let serverMedia = null;                                          // 1.8: YouTube an/aus, Musikwünsche freigeschaltet + Kosten                              // 1.6: Hilfe-Kontakt, Störungen, Neustart-Kampagnen   // 1.5: Gerätezustand nur auf Anforderung, Quiz-Vorgaben der Zentrale
  const healthNow = () => { if (!healthWanted || !healthSummary) return null; const h = healthSummary(); return h && JSON.stringify(h) !== healthSent ? h : null; };
  const takeConfig = j => {
    healthWanted = !!(j.health && j.health.report);
    if (j.quiz && JSON.stringify(j.quiz) !== JSON.stringify(serverQuiz)) { serverQuiz = j.quiz; if (onQuiz) onQuiz(serverQuiz); }
    { const k = j.kb || { enabled: false }; if (JSON.stringify(k) !== JSON.stringify(serverKb)) { serverKb = k; if (onKb) { try { onKb(serverKb); } catch { /* egal */ } } } }
    // 1.12: ältere Zentralen schicken kein „plugins“ – dann bleibt alles, wie es ist
    if (j.plugins && JSON.stringify(j.plugins) !== JSON.stringify(serverPlugins)) { serverPlugins = j.plugins; if (onPlugins) { try { onPlugins(serverPlugins); } catch (e) { log('Zentrale-Plugins: ' + e.message); } } }
    if (j.dex && JSON.stringify(j.dex) !== JSON.stringify(serverDex)) { serverDex = j.dex; if (onDex) { try { onDex(serverDex); } catch (e) { log('Zentrale-Erlebnis: ' + e.message); } } }
    if (j.media && JSON.stringify(j.media) !== JSON.stringify(serverMedia)) { serverMedia = j.media; if (onMedia) { try { onMedia(serverMedia); } catch { /* egal */ } } }
    if (j.ops && JSON.stringify(j.ops) !== opsJson) { opsJson = JSON.stringify(j.ops); serverOps = j.ops; if (onOps) { try { onOps(serverOps); } catch (e) { log('Zentrale-Hinweise: ' + e.message); } } }
  };        // 'ws' (Node-Zentrale) oder 'poll' (PHP-Zentrale auf Webspace)
  const token = () => { const c = cfg(); return c.tokenEnc ? decrypt(c.tokenEnc, c.tokenPlain) : ''; };
  const changed = () => { try { onChange && onChange(status()); } catch { /* egal */ } };

  function status() {
    const c = cfg();
    return { url: c.url, enrolled: !!(c.url && c.tokenEnc), online, transport, pollSec, name: (device && device.name) || c.name, groups: device ? device.groups : [],
      error: lastError, ai: serverAi, wsUrl: c.url ? c.url.replace(/^http/, 'ws') + '/api/ws' : '' };
  }

  async function enroll(url, code) {
    url = normUrl(url);
    if (!url) return { ok: false, msg: 'Bitte eine gültige Adresse eingeben, z. B. https://sudo.example.com' };
    if (!/^https:/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return { ok: false, msg: 'Adresse muss mit https:// beginnen.' };
    if (!String(code || '').trim()) return { ok: false, msg: 'Registrierungscode fehlt.' };
    try {
      const r = await fetch(url + '/api/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ code: String(code).trim(), name: os.hostname(), host: os.hostname(), user: os.userInfo().username, upn: await readUpn(), version, lang: lang() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, msg: j.message || 'HTTP ' + r.status };
      const enc = encrypt(j.token);
      setSettings({ ...cfg(), url, deviceId: j.id, name: j.name, tokenEnc: enc.data, tokenPlain: enc.plain, enroll: '' });
      log(`Bei der Sudo-Zentrale angemeldet: ${url} als ${j.name}`);
      lastError = ''; retry = 0;
      connect();
      return { ok: true, msg: `Angemeldet als „${j.name}“.` };
    } catch (e) { return { ok: false, msg: 'Zentrale nicht erreichbar: ' + e.message }; }
  }
  function leave() {
    stop();
    setSettings({ ...ZENTRALE_DEFAULTS });
    device = null; serverAi = null; lastError = '';
    log('Von der Sudo-Zentrale abgemeldet');
    changed();
    return { ok: true, msg: 'Abgemeldet.' };
  }

  function stop() { stopped = true; clearTimeout(timer); clearTimeout(pollTimer); if (ws) { try { ws.close(1000); } catch { /* egal */ } } ws = null; online = false; }
  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    const wait = Math.min(60000, 2000 * Math.pow(1.7, retry++)) * (0.8 + Math.random() * 0.4);
    timer = setTimeout(connect, wait);
  }
  // Welche Zentrale ist es? Die PHP-Version kann kein WebSocket und sagt „poll“
  async function detect(url) {
    try {
      const r = await fetch(url + '/api/info', { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const j = await r.json(); pollSec = Math.max(5, Math.min(120, Number(j.pollSec) || 15)); return j.transport === 'poll' ? 'poll' : 'ws'; }
      if (r.status === 404) return 'ws';                    // ältere Node-Zentrale ohne /api/info
      throw new Error('HTTP ' + r.status);
    } catch (e) { lastError = 'Zentrale nicht erreichbar: ' + e.message; return null; }
  }

  /* ---------- Abruf-Modus (PHP-Zentrale) ---------- */
  let pollTimer = null, polling = false;
  async function pollOnce() {
    const c = cfg(), t = token();
    if (stopped || !c.url || !t || polling) return;
    polling = true;
    let again = pollSec * 1000;
    try {
      const sending = acks.slice(0, 50);
      const r = await fetch(c.url + '/api/poll', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ ack: sending, version, lang: lang(), upn: upnCache || undefined, visits: prefs(), health: healthNow() || undefined, diag: diagPending && diagLast ? diagLast : undefined }) });
      if (r.status === 401) { online = false; lastError = 'Dieses Gerät wurde in der Zentrale gesperrt. Bitte neu registrieren.'; log('Zentrale: Gerät gesperrt'); changed(); polling = false; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      acks = acks.filter(id => !sending.includes(id));
      { const h = healthNow(); if (h && healthWanted) healthSent = JSON.stringify(h); }
      if (diagPending && diagLast) diagPending = false;
      takeConfig(j);
      const wasOnline = online;
      online = true; retry = 0; lastError = ''; device = j.device;
      if (JSON.stringify(j.ai) !== JSON.stringify(serverAi)) { serverAi = j.ai; if (onConfig) onConfig(j.ai); }
      if (j.pollSec) pollSec = Math.max(5, Math.min(120, Number(j.pollSec)));
      if (!wasOnline) { log(`Sudo-Zentrale verbunden (${device.name}, Abruf alle ${pollSec} s)`); changed(); }
      for (const m of j.events || []) { try { onEvent(m.event, m); } catch (e) { log('Zentrale-Meldung: ' + e.message); } acks.push(m.id); }
      if ((j.events || []).length) again = 1500;             // Quittung gleich hinterherschicken
    } catch (e) {
      const was = online;
      online = false;
      lastError = was ? 'Verbindung verloren – verbinde neu …' : 'Zentrale nicht erreichbar';
      if (was) { changed(); log('Zentrale: Abruf fehlgeschlagen – ' + e.message); }
      again = Math.min(120000, pollSec * 1000 * Math.pow(1.6, retry++));
    }
    polling = false;
    if (!stopped) { clearTimeout(pollTimer); pollTimer = setTimeout(pollOnce, again); }
  }

  async function connect() {
    const c = cfg(), t = token();
    stopped = false;
    clearTimeout(timer); clearTimeout(pollTimer);
    if (!c.url || !t) return;
    transport = await detect(c.url);
    if (!transport) { changed(); return schedule(); }
    if (transport === 'poll') { if (ws) { try { ws.close(1000); } catch { /* egal */ } ws = null; } return pollOnce(); }
    if (ws) { try { ws.close(1000); } catch { /* egal */ } }
    let sock;
    try { sock = new WebSocket(c.url.replace(/^http/, 'ws') + '/api/ws'); } catch (e) { lastError = e.message; return schedule(); }
    ws = sock;
    sock.onopen = () => { sock.send(JSON.stringify({ t: 'hello', token: t, version, lang: lang(), upn: upnCache || undefined, visits: prefs() })); };
    sock.onmessage = m => {
      let d; try { d = JSON.parse(String(m.data)); } catch { return; }
      lastPing = Date.now();
      if (d.t === 'welcome') {
        online = true; retry = 0; lastError = ''; device = d.device; serverAi = d.ai;
        takeConfig(d); healthSent = ''; sendHealth(); if (diagLast) { diagPending = true; sendDiag(); }
        log(`Sudo-Zentrale verbunden (${device.name})`);
        if (onConfig) onConfig(d.ai);
        changed();
      } else if (d.t === 'config') { serverAi = d.ai; takeConfig(d); if (onConfig) onConfig(d.ai); changed(); }
      else if (d.t === 'event' && d.event) {
        try { onEvent(d.event, d); } finally { try { sock.send(JSON.stringify({ t: 'ack', id: d.id })); } catch { /* weg */ } }
      } else if (d.t === 'ping') { try { sock.send(JSON.stringify({ t: 'pong' })); } catch { /* weg */ } }
    };
    sock.onclose = ev => {
      if (ws !== sock) return;
      const was = online;
      online = false; ws = null;
      if (ev.code === 4003) { lastError = 'Dieses Gerät wurde in der Zentrale gesperrt. Bitte neu registrieren.'; log('Zentrale: Gerät gesperrt'); changed(); return; }
      lastError = was ? 'Verbindung verloren – verbinde neu …' : (lastError || 'Zentrale nicht erreichbar');
      changed();
      schedule();
    };
    sock.onerror = () => { lastError = 'Zentrale nicht erreichbar'; };
  }
  // Toter Socket ohne close (Standby, WLAN-Wechsel): nach 75 s ohne Lebenszeichen neu verbinden
  setInterval(() => { if (transport === 'ws' && online && ws && Date.now() - lastPing > 75000) { log('Zentrale: keine Antwort, verbinde neu'); try { ws.close(4000); } catch { /* egal */ } } }, 20000).unref?.();

  // Frag Sudo über die Zentrale – Antwort kommt als derselbe Datenstrom wie direkt von Claude
  async function ask(payload, signal) {
    const c = cfg(), t = token();
    if (!c.url || !t) throw new Error('Sudo ist nicht bei einer Zentrale angemeldet.');
    return fetch(c.url + '/api/ask', { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(payload) });
  }

  // Gerätezustand geändert: per WebSocket gleich melden, im Abruf-Modus mit dem nächsten Abruf
  function sendHealth() {
    const h = healthNow();
    if (!h || !ws || !online) return;
    try { ws.send(JSON.stringify({ t: 'health', health: h })); healthSent = JSON.stringify(h); } catch { /* egal */ }
  }

  // 1.9: Diagnose (CPU, RAM, Abstürze, letzter Fehler) – per WebSocket sofort, sonst mit dem nächsten Abruf
  function sendDiag() {
    if (!diagPending || !diagLast || !ws || !online) return;
    try { ws.send(JSON.stringify({ t: 'diag', diag: diagLast })); diagPending = false; } catch { /* egal */ }
  }
  function diagReport(d) { if (!d) return; diagLast = d; diagPending = true; sendDiag(); }

  /* ---------- Besuche (1.4) ---------- */
  async function call(method, pathName, body) {
    const c = cfg(), t = token();
    if (!c.url || !t) return { ok: false, msg: 'Sudo ist nicht bei einer Zentrale angemeldet.' };
    try {
      const r = await fetch(c.url + pathName, { method, signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && !j.message) return { ok: false, msg: 'Die Zentrale kennt noch keine Besuche – bitte auf 1.4 aktualisieren.' };
      return r.ok ? { ok: true, ...j } : { ok: false, msg: j.message || 'HTTP ' + r.status };
    } catch (e) { return { ok: false, msg: 'Zentrale nicht erreichbar: ' + e.message }; }
  }
  const peers = () => call('GET', '/api/peers');
  const visit = v => call('POST', '/api/visit', v);
  const visitResult = (id, result) => call('POST', '/api/visit/result', { id, result });
  // Einstellungen geändert: per WebSocket sofort melden, im Abruf-Modus kommt es mit dem nächsten Abruf
  function prefsChanged() { if (ws && online) { try { ws.send(JSON.stringify({ t: 'prefs', visits: prefs() })); } catch { /* egal */ } } }

  // Vorgabe (zentrale.json oder Richtlinie) anwenden. Läuft beim Start und – solange Sudo nicht angemeldet ist –
  // alle 5 Minuten erneut: Eine per NinjaOne/Intune/GPO nachträglich verteilte Vorgabe greift so ohne Neustart.
  let presetTimer = null, presetBusy = false, lastPresetErr = '';
  async function tryPreset() {
    const c = cfg();
    if (presetBusy || stopped || (c.url && c.tokenEnc)) return;
    presetBusy = true;
    try {
      const p = await readPreset(log);
      if (!p || !p.url || !p.code) return;
      const r = await enroll(p.url, p.code);
      if (r.ok) { log(`Zentrale-Vorgabe angewendet (${p.from}): ${p.url}`); clearInterval(presetTimer); presetTimer = null; }
      else { lastError = r.msg; if (r.msg !== lastPresetErr) log(`Automatische Anmeldung (${p.from}) fehlgeschlagen: ${r.msg}`); lastPresetErr = r.msg; changed(); }
    } finally { presetBusy = false; }
  }
  async function start() {
    await readUpn();
    const c = cfg();
    if (c.url && c.tokenEnc) return connect();
    await tryPreset();
    if (!presetTimer && !(cfg().url && cfg().tokenEnc)) presetTimer = setInterval(tryPreset, Number(process.env.SUDO_PRESET_MS) || 5 * 60e3);
  }
  // 1.6: Selbsthilfe-Zähler (anonym), „Ich bin auch betroffen“, Stand der Neustart-Kampagnen
  const ops = {
    opsConfig: () => serverOps,
    musicConfig: () => (serverMedia && serverMedia.music) || null,
    kbOn: () => !!(serverKb && serverKb.enabled && online),
    kbSearch: q => call('POST', '/api/kb/search', { q: String(q || '').slice(0, 200) }),
    youtubeOn: () => !serverMedia || serverMedia.youtube !== false,
    musicStatus: () => call('GET', '/api/music'),
    musicSearch: q => call('POST', '/api/music/search', { q }),
    musicRequest: (id, xp) => call('POST', '/api/music/request', { id, xp }),
    selfhelpUsed: (tool, ok) => call('POST', '/api/selfhelp', { tool, ok: !!ok }),
    // 1.10: Mitarbeiter-Erlebnis
    dexConfig: () => serverDex,
    // 1.12: Plugin der Zentrale laden (HTML + Prüfsumme)
    pluginGet: id => call('GET', '/api/plugins/' + encodeURIComponent(String(id))),
    pulseAnswer: a => call('POST', '/api/pulse', a),
    pulseIncident: (id, ok) => call('POST', '/api/pulse/incident', { id, ok: !!ok }),
    onboardMark: (id, done, auto) => call('POST', '/api/onboard', { id, done: !!done, auto: !!auto }),
    incidentAffected: (id, on) => call('POST', '/api/incident/affected', { id, on: !!on }),
    restartStatus: s => call('POST', '/api/restart/status', s),
    refreshOps: () => { if (transport === 'poll') pollOnce(); else if (ws && online) { try { ws.send(JSON.stringify({ t: 'ops' })); } catch { /* egal */ } } }
  };
  return { ...ops, upn: () => upnCache || '', healthChanged: sendHealth, diagReport, healthReporting: () => healthWanted, quizConfig: () => serverQuiz, quizQuestions: () => call('GET', '/api/quiz'), quizAnswer: a => call('POST', '/api/quiz/answer', a),
    start, enroll, leave, status, ask, reconnect: () => { retry = 0; connect(); }, pause: stop, resume: () => { if (!online) connect(); }, pollNow: () => { if (transport === 'poll') pollOnce(); }, peers, visit, visitResult, prefsChanged };
}

module.exports = { createZentrale, ZENTRALE_DEFAULTS, readPreset };
