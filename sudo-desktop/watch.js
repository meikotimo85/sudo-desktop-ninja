// watch.js – System-Wächter: Internet, VPN, Speicherplatz, CPU/RAM, ausstehender Neustart, Laufzeit
// Alles wird nur lokal geprüft. Meldungen gehen als { kind, ... } an das Overlay.
'use strict';
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const DEFAULTS = { internet: true, vpn: true, battery: true, disk: true, load: true, reboot: true, uptime: true, health: true };
const VPN_IF = /(wireguard|netbird|^wt\d|openvpn|tap-windows|^tun|^ppp|fortinet|forticlient|anyconnect|cisco|globalprotect|pangp|zscaler|nordlynx|tailscale|zerotier|sophos|checkpoint|watchguard|vpn)/i;
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function createWatch({ getSettings, notify, log, isOnline, test }) {
  const cfg = () => ({ ...DEFAULTS, ...(getSettings().watch || {}) });
  const once = {};                               // Tagesmeldungen: name → Datum
  const onceToday = name => { const k = dayKey(); if (once[name] === k) return false; once[name] = k; return true; };
  const cool = {};                               // Abklingzeiten: name → Zeitstempel
  const cooled = (name, ms) => { const t = Date.now(); if (t - (cool[name] || 0) < ms) return false; cool[name] = t; return true; };

  /* ---------- Internet ---------- */
  let online = true, offlineSince = 0, offlineChecks = 0;
  async function probe() {
    if (!isOnline()) return false;
    try {
      const r = await fetch('http://www.msftconnecttest.com/connecttest.txt', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      return r.ok && (await r.text()).includes('Microsoft Connect Test');
    } catch { return false; }
  }
  async function checkInternet() {
    const ok = await probe();
    if (!ok) offlineChecks++; else offlineChecks = 0;
    if (online && offlineChecks >= 2) {               // zweimal hintereinander, damit kurze Aussetzer nicht nerven
      online = false; offlineSince = Date.now();
      log('Internet weg'); notify({ kind: 'offline' });
    } else if (!online && ok) {
      online = true;
      const min = Math.round((Date.now() - offlineSince) / 60000);
      log('Internet wieder da'); notify({ kind: 'online', minutes: min });
    }
  }

  /* ---------- VPN ---------- */
  let vpnUp = null;
  const vpnNames = () => Object.entries(os.networkInterfaces())
    .filter(([name, addrs]) => VPN_IF.test(name) && (addrs || []).some(a => a.family === 'IPv4' && !a.internal))
    .map(([name]) => name);
  function checkVpn() {
    const names = vpnNames(), up = names.length > 0;
    if (vpnUp === null) { vpnUp = up; return; }
    if (up !== vpnUp) {
      vpnUp = up;
      log(up ? `VPN verbunden (${names.join(', ')})` : 'VPN getrennt');
      notify({ kind: up ? 'vpn_up' : 'vpn_down', name: names[0] || '' });
    }
  }

  /* ---------- Speicherplatz ---------- */
  function checkDisks() {
    if (typeof fs.statfsSync !== 'function') return;
    const letters = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => l + ':\\') : ['/'];
    for (const root of letters) {
      try {
        if (!fs.existsSync(root)) continue;
        const s = fs.statfsSync(root);
        const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
        if (total < 8e9) continue;                     // USB-Sticks und Mini-Laufwerke ignorieren
        const pct = free / total * 100, gb = free / 1e9;
        if ((pct < 10 || gb < 10) && onceToday('disk' + root)) {
          log(`Wenig Speicher auf ${root} (${gb.toFixed(1)} GB frei)`);
          notify({ kind: 'disk', drive: root.replace('\\', ''), gb: Math.round(gb * 10) / 10, pct: Math.round(pct) });
        }
      } catch { /* Laufwerk nicht lesbar */ }
    }
  }

  /* ---------- CPU / RAM ---------- */
  let lastCpu = os.cpus(), cpuHigh = 0, ramHigh = 0;
  function cpuPercent() {
    const now = os.cpus(); let idle = 0, total = 0;
    now.forEach((c, i) => {
      const p = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
      const t = c.times;
      const tt = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.idle - p.idle) + (t.irq - p.irq);
      total += tt; idle += t.idle - p.idle;
    });
    lastCpu = now;
    return total > 0 ? 100 - idle / total * 100 : 0;
  }
  function checkLoad() {
    const cpu = cpuPercent(), ram = 100 - os.freemem() / os.totalmem() * 100;
    cpuHigh = cpu > 90 ? cpuHigh + 1 : 0;
    ramHigh = ram > 92 ? ramHigh + 1 : 0;
    // 4 Prüfungen à 15 Sekunden = eine Minute am Stück
    if (cpuHigh >= 4 && cooled('cpu', 30 * 60000)) { log(`CPU dauerhaft hoch (${Math.round(cpu)} %)`); notify({ kind: 'cpu', pct: Math.round(cpu) }); }
    if (ramHigh >= 4 && cooled('ram', 30 * 60000)) { log(`Arbeitsspeicher fast voll (${Math.round(ram)} %)`); notify({ kind: 'ram', pct: Math.round(ram) }); }
  }

  /* ---------- Neustart ausstehend / Laufzeit ---------- */
  const REBOOT_KEYS = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
  ];
  const regExists = key => new Promise(res => execFile('reg.exe', ['query', key], { windowsHide: true, timeout: 5000 }, err => res(!err)));
  async function checkReboot() {
    if (process.platform !== 'win32') return;
    for (const k of REBOOT_KEYS) {
      if (await regExists(k)) {
        if (onceToday('reboot')) { log('Neustart nach Updates ausstehend'); notify({ kind: 'reboot' }); }
        return;
      }
    }
  }
  function checkUptime() {
    const days = Math.floor(os.uptime() / 86400);
    if (days >= 7 && onceToday('uptime')) { log(`PC läuft seit ${days} Tagen`); notify({ kind: 'uptime', days }); }
  }

  /* ---------- Takt ---------- */
  let n = 0;
  async function tick() {
    const c = cfg(); n++;
    try {
      if (c.internet) await checkInternet();
      if (c.vpn) checkVpn();
      if (c.load) checkLoad();
      if (c.disk && n % 20 === 1) checkDisks();          // alle 5 Minuten
      if (c.reboot && n % 120 === 2) await checkReboot(); // alle 30 Minuten
      if (c.uptime && n % 120 === 3) checkUptime();
    } catch (e) { log('Wächter: ' + e.message); }
  }
  const timer = setInterval(tick, test ? 3000 : 15000);
  setTimeout(tick, 5000);
  return { stop: () => clearInterval(timer), defaults: DEFAULTS, status: () => ({ online, vpn: vpnUp, vpnNames: vpnNames() }) };
}

module.exports = { createWatch, WATCH_DEFAULTS: DEFAULTS };
