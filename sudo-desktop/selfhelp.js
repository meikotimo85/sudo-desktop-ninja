// selfhelp.js – Selbsthilfe (1.6): kleine Reparaturen, die jeder ohne Adminrechte selbst ausführen darf.
// Jedes Werkzeug arbeitet nur im eigenen Benutzerkonto (eigene Prozesse, eigener Cache, eigener Temp-Ordner).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const { execFile, spawn } = require('child_process');

const WIN = process.platform === 'win32';
const LOCAL = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reihenfolge = Reihenfolge im Fenster. confirm: Hinweis vor dem Ausführen (schließt Programme)
const TOOLS = [
  // 1.10: Analyse in Klartext (slow.js) und Meeting-Check (eigenes Fenster)
  { id: 'slow', title: 'Warum ist mein PC langsam?', text: 'Schaut sich Prozessor, Arbeitsspeicher, die größten Programme, Neustart, Speicherplatz und Autostart an und sagt in normalen Worten, was bremst und was hilft. Ändert nichts.', button: 'Analysieren' },
  { id: 'meet', title: 'Meeting-Check: Ton & Bild', text: 'Vor dem nächsten Teams-Termin: Mikrofon, Kamera, Lautsprecher und Verbindung in einer Minute prüfen.', button: 'Öffnen', open: 'sudo:meet' },
  { id: 'net', title: 'Netzwerk-Check', text: 'Prüft Netzwerkkarte, DNS, Internet und Microsoft 365 und sagt, wo es hakt.', button: 'Prüfen' },
  { id: 'teams', title: 'Teams reparieren', text: 'Schließt Teams, leert den Teams-Zwischenspeicher und startet Teams neu. Hilft bei leeren Chats, fehlenden Bildern oder Anmeldeschleifen.', button: 'Reparieren', confirm: 'Teams wird geschlossen. Laufende Anrufe werden beendet.' },
  { id: 'outlook', title: 'Outlook neu starten', text: 'Beendet Outlook sauber und startet es neu. Hilft, wenn Outlook hängt oder keine Mails mehr abruft.', button: 'Neu starten', confirm: 'Outlook wird geschlossen. Entwürfe speichert Outlook automatisch.' },
  { id: 'onedrive', title: 'OneDrive neu starten', text: 'Startet die OneDrive-Synchronisierung neu. Hilft, wenn Dateien nicht mehr synchronisiert werden.', button: 'Neu starten' },
  { id: 'explorer', title: 'Taskleiste & Explorer neu starten', text: 'Startet den Windows-Explorer neu. Hilft, wenn Taskleiste, Startmenü oder Ordnerfenster nicht reagieren.', button: 'Neu starten', confirm: 'Offene Ordnerfenster werden geschlossen.' },
  { id: 'temp', title: 'Temporäre Dateien aufräumen', text: 'Löscht alte temporäre Dateien deines Benutzerkontos (älter als 2 Tage). Dateien in Benutzung bleiben liegen.', button: 'Aufräumen' },
  { id: 'dns', title: 'DNS-Zwischenspeicher leeren', text: 'Vergisst gespeicherte Adressauflösungen. Hilft, wenn eine Seite nach einer Umstellung nicht erreichbar ist.', button: 'Leeren' }
];

function run(cmd, args, timeout = 20000) {
  return new Promise(resolve => execFile(cmd, args, { windowsHide: true, timeout }, (err, out, errOut) =>
    resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(out || ''), err: String(errOut || '') })));
}
function startDetached(cmd, args = []) {
  try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }); p.on('error', () => {}); p.unref(); return true; } catch { return false; }
}
async function running(image) {
  const r = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV']);
  return r.out.toLowerCase().includes('"' + image.toLowerCase() + '"');
}
// Erst freundlich beenden (Programm darf speichern), nach Wartezeit hart
async function closeApp(image, waitMs = 15000) {
  if (!(await running(image))) return false;
  await run('taskkill.exe', ['/IM', image]);
  for (let t = 0; t < waitMs; t += 1000) { await sleep(1000); if (!(await running(image))) return true; }
  await run('taskkill.exe', ['/F', '/IM', image]);
  await sleep(1500);
  return true;
}
// Ordnerinhalt löschen, Belegtes überspringen
function emptyDir(dir, olderThanMs = 0) {
  let files = 0, bytes = 0, skipped = 0;
  const now = Date.now();
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { files, bytes, skipped, missing: true }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      const st = fs.lstatSync(p);
      if (olderThanMs && now - st.mtimeMs < olderThanMs) continue;
      let size = st.isDirectory() ? dirSize(p) : st.size;
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 1 });
      files++; bytes += size;
    } catch { skipped++; }
  }
  return { files, bytes, skipped };
}
function dirSize(dir, depth = 0) {
  if (depth > 12) return 0;
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); try { n += e.isDirectory() ? dirSize(p, depth + 1) : fs.lstatSync(p).size; } catch { /* egal */ } } } catch { /* egal */ }
  return n;
}
const mb = b => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function createSelfHelp({ fetch, log, zentraleUrl, onUse, test, slowCtx }) {
  const fake = !!process.env.SUDO_FAKE_SELFHELP;

  /* ---------- Netzwerk-Check ---------- */
  async function timed(fn) { const t = Date.now(); try { const v = await fn(); return { v, ms: Date.now() - t }; } catch (e) { return { e, ms: Date.now() - t }; } }
  // Electrons net.fetch wirft bei redirect: 'manual' auf jede Weiterleitung („Redirect was cancelled“) –
  // eine Weiterleitung heißt aber: Der Server hat geantwortet, er ist erreichbar (behoben in 1.10)
  async function reach(url, timeout = 8000) {
    return timed(async () => {
      try { const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout), cache: 'no-store' }); return r.status; }
      catch (e) { if (/redirect/i.test(String(e && e.message))) return 302; throw e; }
    });
  }
  async function netCheck() {
    const checks = [];
    const add = (id, state, title, detail) => checks.push({ id, state, title, detail });
    // 1. Netzwerkkarte
    const ifs = Object.entries(os.networkInterfaces()).flatMap(([name, a]) => (a || []).filter(x => !x.internal && x.family === 'IPv4').map(x => ({ name, ip: x.address })));
    const real = ifs.filter(x => !x.ip.startsWith('169.254.'));
    const vpn = ifs.filter(x => /vpn|wireguard|wg\d|forti|anyconnect|openvpn|tap|netbird|zerotier|tailscale|globalprotect|pangp/i.test(x.name));
    if (real.length) add('adapter', 'ok', 'Netzwerkverbindung', real.filter(x => !vpn.includes(x)).map(x => `${x.name}: ${x.ip}`).join(' · ') || real.map(x => `${x.name}: ${x.ip}`).join(' · '));
    else if (ifs.length) add('adapter', 'bad', 'Netzwerkverbindung', 'Keine Adresse vom Router bekommen (169.254.x.x). Kabel/WLAN prüfen, Router neu starten.');
    else add('adapter', 'bad', 'Netzwerkverbindung', 'Kein Netzwerk verbunden. WLAN einschalten oder Kabel prüfen.');
    if (vpn.length) add('vpn', 'info', 'VPN', vpn.map(x => `${x.name}: ${x.ip}`).join(' · '));
    // 2. DNS
    const d = await timed(() => dns.promises.lookup('www.microsoft.com'));
    if (d.e) add('dns', 'bad', 'Namensauflösung (DNS)', 'Adressen können nicht aufgelöst werden. Ohne DNS geht fast nichts – oft hilft „DNS-Zwischenspeicher leeren“ oder ein Neustart des Routers.');
    else add('dns', d.ms > 1500 ? 'warn' : 'ok', 'Namensauflösung (DNS)', `www.microsoft.com → ${d.v.address} (${d.ms} ms)`);
    // 3. Internet (Microsoft-Testseite, erkennt auch Hotel-/Gast-WLAN mit Anmeldeseite)
    const it = await timed(async () => { const r = await fetch('http://www.msftconnecttest.com/connecttest.txt', { signal: AbortSignal.timeout(8000), cache: 'no-store' }); return r.text(); });
    if (it.e) add('internet', 'bad', 'Internet', 'Keine Verbindung ins Internet.');
    else if (!String(it.v).includes('Microsoft Connect Test')) add('internet', 'warn', 'Internet', 'Es meldet sich eine Anmeldeseite (Gast-WLAN/Hotspot). Browser öffnen und dort anmelden.');
    else add('internet', it.ms > 2000 ? 'warn' : 'ok', 'Internet', `erreichbar (${it.ms} ms)`);
    // 4. Microsoft 365
    const m365 = [['login.microsoftonline.com', 'Anmeldung'], ['outlook.office365.com', 'Exchange/Outlook'], ['teams.microsoft.com', 'Teams'], ['www.office.com', 'Office']];
    const res = await Promise.all(m365.map(([h]) => reach('https://' + h + '/')));
    const bad = m365.filter((_, i) => res[i].e).map(x => x[1]);
    const slow = Math.max(...res.filter(r => !r.e).map(r => r.ms), 0);
    if (bad.length === m365.length) add('m365', 'bad', 'Microsoft 365', 'Nicht erreichbar. Wenn das Internet sonst geht: Störung bei Microsoft oder Firewall/Proxy – bitte an die IT.');
    else if (bad.length) add('m365', 'warn', 'Microsoft 365', 'Nicht erreichbar: ' + bad.join(', '));
    else add('m365', slow > 2500 ? 'warn' : 'ok', 'Microsoft 365', `Anmeldung, Outlook, Teams und Office erreichbar (langsamster ${slow} ms)`);
    // 5. Sudo-Zentrale (falls genutzt)
    const zu = zentraleUrl && zentraleUrl();
    if (zu) { const z = await reach(zu + '/auth/info'); add('zentrale', z.e ? 'warn' : 'ok', 'Sudo-Zentrale', z.e ? 'nicht erreichbar' : `erreichbar (${z.ms} ms)`); }
    const worst = checks.some(c => c.state === 'bad') ? 'bad' : checks.some(c => c.state === 'warn') ? 'warn' : 'ok';
    const msg = { ok: 'Alles in Ordnung – das Netzwerk ist nicht das Problem.', warn: 'Verbindung geht, aber nicht alles rund.', bad: 'Hier hakt es – Details unten.' }[worst];
    return { ok: worst !== 'bad', state: worst, msg, checks };
  }

  /* ---------- Teams ---------- */
  async function teams() {
    const newDir = path.join(LOCAL(), 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams');
    const oldDir = path.join(ROAMING(), 'Microsoft', 'Teams');
    const hasNew = fs.existsSync(newDir), hasOld = fs.existsSync(oldDir);
    if (!hasNew && !hasOld) return { ok: false, msg: 'Teams wurde auf diesem PC nicht gefunden.' };
    await closeApp('ms-teams.exe', 5000); await closeApp('Teams.exe', 5000);
    let r = { files: 0, bytes: 0, skipped: 0 };
    if (hasNew) r = emptyDir(newDir);
    if (hasOld) for (const sub of ['Cache', 'Code Cache', 'GPUCache', 'blob_storage', 'databases', 'IndexedDB', 'Local Storage', 'tmp', 'Service Worker']) {
      const x = emptyDir(path.join(oldDir, sub)); if (!x.missing) { r.files += x.files; r.bytes += x.bytes; r.skipped += x.skipped; }
    }
    if (hasNew) startDetached('explorer.exe', ['shell:AppsFolder\\MSTeams_8wekyb3d8bbwe!MSTeams']);
    else startDetached(path.join(LOCAL(), 'Microsoft', 'Teams', 'Update.exe'), ['--processStart', 'Teams.exe']);
    return { ok: true, msg: `Zwischenspeicher geleert (${mb(r.bytes)} MB). Teams startet neu – die erste Anmeldung kann etwas dauern.`, note: r.skipped ? `${r.skipped} Dateien waren noch in Benutzung.` : '' };
  }

  /* ---------- Outlook (klassisch und neu) ---------- */
  async function outlookPath() {
    const r = await run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE', '/ve']);
    const m = r.out.match(/REG_\w+\s+(.+\.exe)/i);
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  }
  async function outlook() {
    const classicRunning = await running('OUTLOOK.EXE'), newRunning = await running('olk.exe');
    const exe = await outlookPath();
    if (!classicRunning && !newRunning && !exe) return { ok: false, msg: 'Outlook wurde auf diesem PC nicht gefunden.' };
    if (classicRunning) await closeApp('OUTLOOK.EXE', 20000);
    if (newRunning) await closeApp('olk.exe', 8000);
    await sleep(1000);
    if (newRunning && !classicRunning) startDetached('explorer.exe', ['shell:AppsFolder\\Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows']);
    else if (exe) startDetached(exe);
    return { ok: true, msg: classicRunning || newRunning ? 'Outlook wurde beendet und startet neu.' : 'Outlook lief nicht und wird jetzt gestartet.' };
  }

  /* ---------- OneDrive ---------- */
  async function onedrive() {
    const cands = [path.join(LOCAL(), 'Microsoft', 'OneDrive', 'OneDrive.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft OneDrive', 'OneDrive.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft OneDrive', 'OneDrive.exe')];
    const exe = cands.find(p => fs.existsSync(p));
    if (!exe) return { ok: false, msg: 'OneDrive wurde auf diesem PC nicht gefunden.' };
    await run(exe, ['/shutdown'], 15000);
    for (let t = 0; t < 10 && await running('OneDrive.exe'); t++) await sleep(1000);
    if (await running('OneDrive.exe')) await run('taskkill.exe', ['/F', '/IM', 'OneDrive.exe']);
    await sleep(1000);
    startDetached(exe, ['/background']);
    return { ok: true, msg: 'OneDrive startet neu und prüft die Synchronisierung. Das Wolken-Symbol unten rechts zeigt den Fortschritt.' };
  }

  /* ---------- Explorer ---------- */
  async function explorer() {
    await run('taskkill.exe', ['/F', '/IM', 'explorer.exe']);
    await sleep(1500);
    if (!(await running('explorer.exe'))) startDetached(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'));
    return { ok: true, msg: 'Taskleiste und Explorer wurden neu gestartet.' };
  }

  /* ---------- Temp ---------- */
  async function temp() {
    const dirs = [...new Set([os.tmpdir(), process.env.TEMP, process.env.TMP].filter(Boolean).map(d => path.resolve(d)))];
    let r = { files: 0, bytes: 0, skipped: 0 };
    for (const d of dirs) {
      // Sicherheitsnetz: nur echte Temp-Ordner im Benutzerprofil oder unter Windows\Temp nie
      if (!/[\\/]temp$/i.test(d) || /^[a-z]:[\\/]windows[\\/]temp$/i.test(d)) continue;
      const x = emptyDir(d, 2 * 86400000); r.files += x.files; r.bytes += x.bytes; r.skipped += x.skipped;
    }
    return { ok: true, msg: r.files ? `${r.files} Einträge gelöscht, ${mb(r.bytes)} MB frei geworden.` : 'Nichts aufzuräumen – der Temp-Ordner ist schon sauber.', note: r.skipped ? `${r.skipped} Einträge waren in Benutzung und bleiben.` : '' };
  }

  /* ---------- DNS ---------- */
  async function flushDns() {
    const r = await run('ipconfig.exe', ['/flushdns']);
    if (r.ok) return { ok: true, msg: 'DNS-Zwischenspeicher geleert.' };
    if (/erh(ö|o)hung|elevation|administrat/i.test(r.out + r.err)) return { ok: false, msg: 'Auf diesem PC braucht das Adminrechte – bitte an die IT wenden.' };
    return { ok: false, msg: 'Hat nicht geklappt: ' + (r.out || r.err).trim().slice(0, 160) };
  }

  /* ---------- Langsam-Analyse (1.10) ---------- */
  const slow = () => require('./slow').analyse({ ...(slowCtx ? slowCtx() : {}), fake: fake ? { cpu: 92, ram: 91, run: 14, reboot: true, disk: { gb: 9, pct: 4 }, procs: [{ name: 'Edge', bg: false, n: 38, cpu: 41, mb: 4300 }, { name: 'Teams', bg: false, n: 6, cpu: 6, mb: 1300 }] } : null });

  const IMPL = { net: netCheck, teams, outlook, onedrive, explorer, temp, dns: flushDns, slow };
  let busy = null;
  async function runTool(id) {
    const t = TOOLS.find(x => x.id === id);
    if (!t) return { ok: false, msg: 'Unbekanntes Werkzeug.' };
    if (busy) return { ok: false, msg: 'Moment – „' + busy + '“ läuft noch.' };
    busy = t.title;
    try {
      let r;
      if (t.open) return { id, ok: true, msg: '' };
      if (fake && id !== 'net' && id !== 'slow') { await sleep(400); r = { ok: true, msg: 'Test: ' + t.title + ' erledigt.' }; }
      else if (!WIN && id !== 'net' && id !== 'slow') r = { ok: false, msg: 'Nur unter Windows.' };
      else r = await IMPL[id]();
      log(`Selbsthilfe: ${t.title} → ${r.ok ? 'OK' : 'nicht OK'}${r.msg ? ' (' + r.msg + ')' : ''}`);
      if (onUse) onUse(id, !!r.ok);
      return { id, ...r };
    } catch (e) {
      log(`Selbsthilfe: ${t.title} Fehler: ${e.message}`);
      return { id, ok: false, msg: 'Unerwarteter Fehler: ' + e.message };
    } finally { busy = null; }
  }
  return { tools: () => TOOLS.map(t => ({ ...t })), run: runTool };
}

module.exports = { createSelfHelp, SELFHELP_TOOLS: TOOLS };
