// health.js – Gerätezustand-Selbstcheck (1.5): BitLocker, Virenschutz, Firewall, Windows-Update, Neustart, Speicherplatz
// Alles ohne Adminrechte, ein versteckter PowerShell-Aufruf alle paar Stunden. Ergebnis bleibt lokal,
// nur eine Ampel-Zusammenfassung geht – wenn die Zentrale das verlangt – an die Zentrale.
'use strict';
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Eine Abfrage, JSON-Ausgabe. Jede Prüfung einzeln abgesichert: fehlt etwas, bleibt es „unbekannt“.
const PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$r = @{}
try { $r.bitlocker = (New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch {}
try { $r.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { @{ name = $_.displayName; state = [int]$_.productState } }) } catch {}
try { $r.fw = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct | ForEach-Object { @{ name = $_.displayName; state = [int]$_.productState } }) } catch {}
try { $r.winfw = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { @{ n = [string]$_.Name; on = [bool]$_.Enabled } }) } catch {}
try { $s = Get-MpComputerStatus -ErrorAction Stop; $r.def = @{ on = [bool]$s.AntivirusEnabled; rt = [bool]$s.RealTimeProtectionEnabled; age = [int]$s.AntivirusSignatureAge } } catch {}
try {
  $u = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
  $n = $u.GetTotalHistoryCount()
  if ($n -gt 0) {
    $h = $u.QueryHistory(0, [Math]::Min($n, 50)) | Where-Object { $_.ResultCode -eq 2 -and $_.Operation -eq 1 } | Sort-Object Date -Descending | Select-Object -First 1
    if ($h) { $r.lastUpdate = $h.Date.ToUniversalTime().ToString('o') }
  }
} catch {}
$r | ConvertTo-Json -Compress -Depth 4
`;

// productState aus dem Windows-Sicherheitscenter: mittleres Byte 0x10/0x11 = aktiv, letztes Byte 0x00 = aktuell
const decodeState = s => { const h = Number(s || 0).toString(16).padStart(6, '0'); return { on: ['10', '11'].includes(h.slice(2, 4)), current: h.slice(4, 6) === '00' }; };
// BitLocker-Werte der Shell-Eigenschaft
const BL = { 1: 'ok', 3: 'ok', 6: 'ok', 2: 'off', 4: 'off', 5: 'paused', 8: 'waiting' };

function runPs(timeout = 60000) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', PS],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (err, out) => {
        if (err && !out) return resolve(null);
        try { resolve(JSON.parse(String(out).trim() || '{}')); } catch { resolve(null); }
      });
  });
}

// Rohdaten → einzelne Punkte mit Ampel (ok / warn / bad / unknown) und Gesamtzustand
function evaluate(raw, extra) {
  const items = {};
  const set = (k, state, detail, data) => { items[k] = { state, detail: detail || '', ...(data || {}) }; };
  // BitLocker (Laufwerk C:)
  const bl = raw && raw.bitlocker != null ? BL[Number(raw.bitlocker)] : null;
  if (!bl) set('bitlocker', 'unknown');
  else if (bl === 'ok') set('bitlocker', 'ok', 'Laufwerk C: ist verschlüsselt.');
  else if (bl === 'paused') set('bitlocker', 'warn', 'BitLocker ist angehalten.');
  else if (bl === 'waiting') set('bitlocker', 'warn', 'Verschlüsselung wartet auf Aktivierung.');
  else set('bitlocker', 'bad', 'Laufwerk C: ist nicht verschlüsselt.');
  // Virenschutz: Sicherheitscenter (auch Fremdprodukte), sonst Defender-Status
  const av = (raw && Array.isArray(raw.av) ? raw.av : []).map(a => ({ name: String(a.name || ''), ...decodeState(a.state) }));
  const activeAv = av.filter(a => a.on);
  if (raw && raw.def && raw.def.on === false && !activeAv.length) set('av', 'bad', 'Kein Virenschutz aktiv.');
  else if (activeAv.length) {
    const outdated = activeAv.every(a => !a.current) || (raw.def && raw.def.age > 3 && /defender/i.test(activeAv[0].name));
    set('av', outdated ? 'warn' : 'ok', outdated ? `${activeAv[0].name}: Signaturen veraltet.` : `${activeAv[0].name} ist aktiv.`, { name: activeAv[0].name });
  } else if (raw && raw.def) set('av', raw.def.on && raw.def.rt ? (raw.def.age > 3 ? 'warn' : 'ok') : 'bad', raw.def.on && raw.def.rt ? 'Microsoft Defender ist aktiv.' : 'Echtzeitschutz ist aus.', { name: 'Microsoft Defender' });
  else if (av.length) set('av', 'bad', 'Kein Virenschutz aktiv.');
  else set('av', 'unknown');
  // Firewall: Windows-Firewall (alle Profile an) oder eine aktive Fremd-Firewall
  const fw3 = (raw && Array.isArray(raw.fw) ? raw.fw : []).map(f => ({ name: String(f.name || ''), ...decodeState(f.state) })).filter(f => f.on);
  const winfw = raw && Array.isArray(raw.winfw) ? raw.winfw : [];
  if (fw3.length) set('fw', 'ok', `${fw3[0].name} ist aktiv.`);
  else if (winfw.length) {
    const off = winfw.filter(p => !p.on).map(p => p.n);
    if (!off.length) set('fw', 'ok', 'Windows-Firewall ist in allen Profilen aktiv.');
    else if (off.length === winfw.length) set('fw', 'bad', 'Windows-Firewall ist aus.');
    else set('fw', 'warn', `Firewall aus im Profil: ${off.join(', ')}.`);
  } else set('fw', 'unknown');
  // Windows-Update: letzte erfolgreiche Installation
  if (raw && raw.lastUpdate) {
    const days = Math.floor((Date.now() - Date.parse(raw.lastUpdate)) / 864e5);
    set('updates', days > 45 ? 'bad' : days > 30 ? 'warn' : 'ok', days <= 0 ? 'Heute zuletzt aktualisiert.' : `Letztes Update vor ${days} Tagen.`, { days, last: raw.lastUpdate });
  } else set('updates', 'unknown');
  // Neustart: ausstehend nach Updates oder lange Laufzeit
  const uptimeDays = Math.floor(os.uptime() / 86400);
  if (extra.rebootPending) set('reboot', 'warn', 'Neustart nach Updates ausstehend.', { uptimeDays });
  else if (uptimeDays >= 14) set('reboot', 'warn', `PC läuft seit ${uptimeDays} Tagen ohne Neustart.`, { uptimeDays });
  else set('reboot', 'ok', uptimeDays ? `Letzter Neustart vor ${uptimeDays} Tagen.` : 'Heute neu gestartet.', { uptimeDays });
  // Speicherplatz C:
  if (extra.diskFreePct != null) set('disk', extra.diskFreePct < 5 ? 'bad' : extra.diskFreePct < 10 ? 'warn' : 'ok', `${extra.diskFreeGb} GB frei (${extra.diskFreePct} %).`, { pct: extra.diskFreePct, gb: extra.diskFreeGb });
  else set('disk', 'unknown');
  const states = Object.values(items).map(i => i.state);
  const core = ['bitlocker', 'av', 'fw', 'updates'].every(k => items[k].state === 'unknown');
  const overall = states.includes('bad') ? 'bad' : states.includes('warn') ? 'warn' : core ? 'unknown' : 'ok';
  return { overall, items };
}

const regExists = key => new Promise(res => execFile('reg.exe', ['query', key], { windowsHide: true, timeout: 5000 }, err => res(!err)));
async function rebootPending() {
  if (process.platform !== 'win32') return false;
  for (const k of ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending']) if (await regExists(k)) return true;
  return false;
}
function diskC() {
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { diskFreePct: Math.round(free / total * 100), diskFreeGb: Math.round(free / 1e9 * 10) / 10 };
  } catch { return {}; }
}

// Meldungen von Sudo: höchstens einmal pro Tag und Thema, Reihenfolge nach Wichtigkeit
const NOTIFY = [['bitlocker', 'bad', 'health_bitlocker'], ['av', 'bad', 'health_av'], ['fw', 'bad', 'health_fw'], ['updates', 'bad', 'health_updates'],
  ['av', 'warn', 'health_av_old'], ['updates', 'warn', 'health_updates'], ['bitlocker', 'warn', 'health_bitlocker_wait']];

function createHealth({ getSettings, notify, log, onChange, test, fake }) {
  let snap = { overall: 'unknown', items: {}, checked: null, running: false };
  const told = {};
  async function check(force) {
    if (snap.running) return snap;
    snap.running = true;
    try {
      const [raw, reboot] = fake ? [fake, false] : await Promise.all([runPs(), rebootPending()]);
      const r = evaluate(raw || {}, { rebootPending: reboot, ...diskC() });
      const before = snap.overall;
      snap = { ...r, checked: new Date().toISOString(), running: false, available: process.platform === 'win32' || !!fake };
      if (before !== snap.overall) log(`Gerätezustand: ${snap.overall}`);
      // Sudo weist auf Probleme hin (Neustart und Speicher meldet schon der System-Wächter)
      const c = getSettings().watch || {};
      if (c.health !== false && !force) {           // „Jetzt prüfen“ im Fenster zeigt das Ergebnis selbst
        for (const [k, state, kind] of NOTIFY) {
          const it = snap.items[k];
          if (!it || it.state !== state) continue;
          const key = kind + dayKey();
          if (told[key] && !force) continue;
          told[key] = 1;
          notify({ kind, days: it.days, name: it.name || '', link: 'sudo:lage/pc' });
          break;                                   // eine Meldung pro Prüfung reicht
        }
      }
      if (onChange) onChange(snap);
    } catch (e) { snap.running = false; log('Gerätezustand: ' + e.message); }
    return snap;
  }
  // Kurz nach dem Start, dann alle 6 Stunden
  const first = setTimeout(() => check(), test ? 4000 : 3 * 60000);
  const timer = setInterval(() => check(), 6 * 3600 * 1000);
  // Kurzfassung für die Zentrale: nur Ampeln und wenige Zahlen, keine Namen von Dateien oder Programmen außer dem Virenschutz
  const summary = () => !snap.checked ? null : {
    s: snap.overall, at: snap.checked,
    i: Object.fromEntries(Object.entries(snap.items).map(([k, v]) => [k, v.state])),
    updDays: snap.items.updates && snap.items.updates.days, upDays: snap.items.reboot && snap.items.reboot.uptimeDays,
    disk: snap.items.disk && snap.items.disk.pct, av: snap.items.av && snap.items.av.name || ''
  };
  return { check, snapshot: () => snap, summary, stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { createHealth, evaluate, decodeState, rebootPending };
