// slow.js – 1.10: „Warum ist mein PC langsam?“ – Analyse in Klartext, ohne Adminrechte.
// Schaut sich Prozessor, Arbeitsspeicher, die größten Programme, Laufzeit, Speicherplatz, Autostart und Akku an
// und sagt in normalen Worten, was bremst und was hilft. Alles bleibt auf dem PC (nur „benutzt/geholfen“ zählt die Zentrale anonym).
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const WIN = process.platform === 'win32';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const gb = mb => num(mb / 1024);
const run = (cmd, args, timeout = 25000) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (e, out) => res(e ? '' : String(out || ''))));

// Bekannte Prozesse in Alltagssprache. bg = arbeitet Windows im Hintergrund (geht von selbst vorbei)
const NAMES = {
  chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi',
  'ms-teams': 'Teams', teams: 'Teams', msedgewebview2: 'Edge WebView (Teams, Outlook, Widgets …)',
  outlook: 'Outlook', olk: 'Outlook (neu)', excel: 'Excel', winword: 'Word', powerpnt: 'PowerPoint', onenote: 'OneNote', onedrive: 'OneDrive',
  code: 'VS Code', explorer: 'Explorer', zoom: 'Zoom', spotify: 'Spotify', acrobat: 'Adobe Acrobat', acrord32: 'Adobe Reader',
  sudo: 'Sudo', electron: 'Sudo (Entwicklerstart)',
  msmpeng: { n: 'Virenschutz (Microsoft Defender) scannt', bg: true }, mpdefendercoreservice: { n: 'Virenschutz (Microsoft Defender)', bg: true },
  searchindexer: { n: 'Windows-Suche baut ihren Index auf', bg: true }, searchprotocolhost: { n: 'Windows-Suche', bg: true },
  tiworker: { n: 'Windows Update installiert', bg: true }, trustedinstaller: { n: 'Windows Update installiert', bg: true },
  musnotification: { n: 'Windows Update', bg: true }, wuauclt: { n: 'Windows Update', bg: true }, compattelrunner: { n: 'Windows-Telemetrie', bg: true },
  'antimalware service executable': { n: 'Virenschutz (Microsoft Defender) scannt', bg: true }
};
const nameOf = n => { const k = String(n).toLowerCase().replace(/#\d+$/, '').replace(/\.exe$/, ''); const v = NAMES[k]; return v ? (typeof v === 'string' ? { n: v, bg: false } : v) : { n: k.charAt(0).toUpperCase() + k.slice(1), bg: false }; };

// Prozessorlast des ganzen PCs über ein kurzes Messfenster
async function cpuNow(ms = 1500) {
  const a = os.cpus(); await sleep(ms); const b = os.cpus();
  let idle = 0, total = 0;
  b.forEach((c, i) => { const p = a[i] ? a[i].times : c.times; const t = c.times;
    const tt = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.idle - p.idle) + (t.irq - p.irq); total += tt; idle += t.idle - p.idle; });
  return total > 0 ? Math.round(100 - idle / total * 100) : 0;
}
// Größte Programme nach Arbeitsspeicher und Prozessor (Leistungsindikatoren, für alle lesbar); gruppiert nach Name
async function processes() {
  const cores = os.cpus().length || 1;
  const ps = "$ErrorActionPreference='SilentlyContinue';Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } | Select-Object Name,PercentProcessorTime,WorkingSetPrivate | ConvertTo-Json -Compress";
  let list = [];
  const out = WIN ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]) : '';
  try { const j = JSON.parse(out); list = (Array.isArray(j) ? j : [j]).map(p => ({ name: p.Name, cpu: (Number(p.PercentProcessorTime) || 0) / cores, mb: (Number(p.WorkingSetPrivate) || 0) / 1048576 })); }
  catch {
    // Ersatz: tasklist kennt nur den Speicher (z. B. „123.456 K“)
    const t = WIN ? await run('tasklist.exe', ['/FO', 'CSV', '/NH']) : '';
    list = t.split(/\r?\n/).map(l => l.match(/^"([^"]+)","\d+","[^"]*","\d+","([\d.,\s ]+)\s*K"/)).filter(Boolean)
      .map(m => ({ name: m[1], cpu: 0, mb: Number(m[2].replace(/[^\d]/g, '')) / 1024 }));
  }
  const groups = new Map();
  for (const p of list) {
    const info = nameOf(p.name), g = groups.get(info.n) || { name: info.n, bg: info.bg, n: 0, cpu: 0, mb: 0 };
    g.n++; g.cpu += p.cpu; g.mb += p.mb; groups.set(info.n, g);
  }
  return [...groups.values()];
}
const regCount = async key => { const out = WIN ? await run('reg.exe', ['query', key], 6000) : ''; return out.split(/\r?\n/).filter(l => /\sREG_\w+\s/.test(l)).length; };
function startupFolderCount() {
  const dirs = [path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp')];
  let n = 0; for (const d of dirs) { try { n += fs.readdirSync(d).filter(f => !/^desktop\.ini$/i.test(f)).length; } catch { /* fehlt */ } }
  return n;
}
function diskC() {
  try { const s = fs.statfsSync(WIN ? 'C:\\' : '/'); const total = s.blocks * s.bsize, free = s.bavail * s.bsize; return { gb: Math.round(free / 1e9 * 10) / 10, pct: Math.round(free / total * 100) }; } catch { return null; }
}

// Ergebnis im Format der Selbsthilfe: { ok, state, msg, checks: [{ state, title, detail }], actions: [{ label, link | tool }] }
// t = Übersetzer (I18N.t); Texte sind Vorlagen mit {platzhaltern}, damit sie sich als Ganzes übersetzen lassen
async function analyse({ rebootPending, onBattery, sudoMb, fake, t } = {}) {
  const L = (s, v = {}) => String(t ? t(s) : s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
  const checks = [], actions = [], add = (state, title, detail) => checks.push({ state, title: L(title), detail });
  const act = a => { a = { ...a, label: L(a.label) }; if (!actions.some(x => x.label === a.label)) actions.push(a); };
  const [cpu, procs, runCount, runCountLm, pending] = fake ? [fake.cpu, fake.procs, fake.run || 0, 0, !!fake.reboot] : await Promise.all([
    cpuNow(), processes(), regCount('HKCU\Software\Microsoft\Windows\CurrentVersion\Run'), regCount('HKLM\Software\Microsoft\Windows\CurrentVersion\Run'),
    rebootPending ? rebootPending().catch(() => false) : false]);
  for (const p of procs) p.name = L(p.name);
  const totalMb = os.totalmem() / 1048576, usedPct = fake ? fake.ram : Math.round((1 - os.freemem() / os.totalmem()) * 100);
  const byCpu = procs.filter(p => p.cpu >= 1).sort((a, b) => b.cpu - a.cpu), byMem = procs.slice().sort((a, b) => b.mb - a.mb);
  const total = gb(totalMb);

  // 1. Prozessor
  const topCpu = byCpu[0];
  if (cpu >= 85) {
    if (topCpu && topCpu.bg) add('warn', 'Prozessor', L('Ausgelastet ({cpu} %): {app}. Das macht Windows von selbst und geht vorbei – am besten kurz Pause machen oder nach Feierabend neu starten.', { cpu, app: topCpu.name }));
    else add('bad', 'Prozessor', L('Voll ausgelastet ({cpu} %).', { cpu }) + (topCpu ? ' ' + L('Am meisten rechnet {app} ({pct} %). Hängt es? Speichern, Programm schließen und neu öffnen.', { app: topCpu.name, pct: Math.round(topCpu.cpu) }) : ''));
    act({ label: 'Task-Manager öffnen', link: 'sudo:taskmgr' });
  } else if (cpu >= 60) add('warn', 'Prozessor', topCpu ? L('Gut beschäftigt ({cpu} %), vor allem {app}.', { cpu, app: topCpu.name }) : L('Gut beschäftigt ({cpu} %).', { cpu }));
  else add('ok', 'Prozessor', L('Entspannt ({cpu} %).', { cpu }));

  // 2. Arbeitsspeicher + größte Programme
  const top = byMem.filter(p => p.mb >= 300).slice(0, 3);
  const tops = top.map(p => (p.n > 3 ? L('{app} ({n} Teile): {gb} GB', { app: p.name, n: p.n, gb: gb(p.mb) }) : L('{app}: {gb} GB', { app: p.name, gb: gb(p.mb) }))).join(' · ');
  const big = tops ? ' ' + L('Größte Brocken: {list}.', { list: tops }) : '';
  const browser = top.find(p => /^(Chrome|Edge|Firefox|Brave|Opera|Vivaldi)$/.test(p.name) && p.n >= 25);
  if (usedPct >= 90) add('bad', 'Arbeitsspeicher', L('Fast voll ({pct} % von {total} GB). Windows lagert dann auf die Festplatte aus – das bremst alles.', { pct: usedPct, total }) + big);
  else if (usedPct >= 80) add('warn', 'Arbeitsspeicher', L('Ziemlich voll ({pct} % von {total} GB).', { pct: usedPct, total }) + big);
  else add('ok', 'Arbeitsspeicher', L('Genug frei ({pct} % von {total} GB belegt).', { pct: usedPct, total }) + big);
  if (browser && usedPct >= 75) add('warn', 'Viele Browser-Tabs', L('{app} läuft in {n} Teilen – meist steckt pro Tab einer dahinter. Nicht benötigte Tabs schließen macht den PC spürbar schneller.', { app: browser.name, n: browser.n }));

  // 3. Laufzeit und Neustart
  const days = Math.floor(os.uptime() / 86400);
  if (pending) { add('warn', 'Neustart', L('Windows wartet auf einen Neustart nach Updates. Bis dahin laufen manche Dinge langsamer.')); act({ label: 'Windows Update öffnen', link: 'ms-settings:windowsupdate' }); }
  else if (days >= 7) add('warn', 'Neustart', L('Der PC läuft seit {days} Tagen ohne Neustart. Ein Neustart räumt den Arbeitsspeicher auf – Arbeit vorher speichern.', { days }));
  else add('ok', 'Neustart', days ? L('Zuletzt vor {days} Tag(en) neu gestartet.', { days }) : L('Heute schon neu gestartet.'));

  // 4. Speicherplatz
  const d = fake ? fake.disk : diskC();
  if (d && (d.pct < 5 || d.gb < 5)) { add('bad', 'Speicherplatz C:', L('Fast voll (nur noch {gb} GB frei). Windows braucht freien Platz zum Arbeiten.', { gb: num(d.gb) })); act({ label: 'Temp aufräumen', tool: 'temp' }); act({ label: 'Speicheroptimierung öffnen', link: 'ms-settings:storagesense' }); }
  else if (d && (d.pct < 12 || d.gb < 15)) { add('warn', 'Speicherplatz C:', L('Wird knapp ({gb} GB frei, {pct} %).', { gb: num(d.gb), pct: d.pct })); act({ label: 'Temp aufräumen', tool: 'temp' }); act({ label: 'Speicheroptimierung öffnen', link: 'ms-settings:storagesense' }); }
  else if (d) add('ok', 'Speicherplatz C:', L('{gb} GB frei.', { gb: num(d.gb) }));

  // 5. Autostart
  const auto = runCount + runCountLm + (fake ? 0 : startupFolderCount());
  if (auto >= 12) { add('warn', 'Autostart', L('{n} Programme starten mit Windows. Was du nicht täglich brauchst, kannst du dort abschalten – der PC startet dann schneller.', { n: auto })); act({ label: 'Autostart-Apps öffnen', link: 'ms-settings:startupapps' }); }
  else add('ok', 'Autostart', L('{n} Programme starten mit Windows – im Rahmen.', { n: auto }));

  // 6. Akku, Sudo selbst
  if (onBattery) add('info', 'Akkubetrieb', L('Im Akkubetrieb drosselt Windows den Prozessor, um Strom zu sparen. Mit Netzteil ist der PC schneller.'));
  if (sudoMb) add('info', 'Sudo selbst', L('Sudo braucht gerade {mb} MB – zur Einordnung.', { mb: Math.round(sudoMb) }));

  const worst = checks.some(c => c.state === 'bad') ? 'bad' : checks.some(c => c.state === 'warn') ? 'warn' : 'ok';
  const msg = L({ ok: 'Gerade sieht alles gut aus. Hakt es nur manchmal? Dann die Analyse genau in dem Moment starten.', warn: 'Ein paar Dinge bremsen – Tipps unten.', bad: 'Hier bremst etwas deutlich – Details und Tipps unten.' }[worst]);
  if (worst !== 'ok') act({ label: 'Task-Manager öffnen', link: 'sudo:taskmgr' });
  return { ok: true, state: worst, msg, checks, actions };
}

module.exports = { analyse, nameOf };
