// deck.js – Ninja-Leiste: Schnellstart per mittlerer Maustaste auf Sudo (1.4.2)
// Der Overlay schickt nur die ID eines Eintrags. Was gestartet wird, steht ausschließlich in den Einstellungen.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const LINUX = process.platform === 'linux';

// Mitgelieferte Einträge (Reihenfolge = Reihenfolge in der Leiste)
const BUILTIN_WIN = {
  powershell: { name: 'PowerShell', icon: 'ps', exe: 'powershell.exe', args: '-NoLogo' },
  psadmin:    { name: 'PowerShell (Admin)', short: 'PS Admin', icon: 'ps', exe: 'powershell.exe', args: '-NoLogo', admin: true },
  cmd:        { name: 'CMD', icon: 'cmd', exe: 'cmd.exe' },
  terminal:   { name: 'Terminal', icon: 'term', exe: 'wt.exe' },
  explorer:   { name: 'Explorer', icon: 'folder', exe: 'explorer.exe' },
  taskmgr:    { name: 'Task-Manager', icon: 'chart', exe: 'taskmgr.exe' },
  winsettings:{ name: 'Windows-Einstellungen', short: 'Einstellungen', icon: 'gear', url: 'ms-settings:' },
  calc:       { name: 'Rechner', icon: 'calc', exe: 'calc.exe' },
  snip:       { name: 'Ausschnitt', icon: 'snip', url: 'ms-screenclip:' },
  regedit:    { name: 'Registry', icon: 'reg', exe: 'regedit.exe', admin: true },
  services:   { name: 'Dienste', icon: 'gear', exe: 'mmc.exe', args: 'services.msc' },
  sudoTools:  { name: 'Werkzeugkasten', short: 'Werkzeuge', icon: 'tools', internal: 'tools' },
  sudoAsk:    { name: 'Frag Sudo', icon: 'ask', internal: 'ask' },
  sudoNote:   { name: 'Notiz', icon: 'note', internal: 'quick' },
  sudoLage:   { name: 'IT-Lage', icon: 'shield', internal: 'lage' },
  sudoHelp:   { name: 'Selbsthilfe', icon: 'heal', internal: 'selfhelp' }
};
// Linux (1.12): je Eintrag mehrere Programme, das erste vorhandene wird gestartet (GNOME, KDE, Xfce, Cinnamon …)
const BUILTIN_LINUX = {
  terminal:   { name: 'Terminal', icon: 'term', exe: ['x-terminal-emulator', 'gnome-terminal', 'ptyxis', 'kgx', 'konsole', 'xfce4-terminal', 'mate-terminal', 'tilix', 'alacritty', 'kitty', 'xterm'] },
  rootterm:   { name: 'Terminal (Root)', short: 'Root', icon: 'term', exe: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'], admin: true },
  files:      { name: 'Dateien', icon: 'folder', home: true },
  sysmon:     { name: 'Systemmonitor', icon: 'chart', exe: ['gnome-system-monitor', 'plasma-systemmonitor', 'ksysguard', 'xfce4-taskmanager', 'mate-system-monitor'] },
  linsettings:{ name: 'Systemeinstellungen', short: 'Einstellungen', icon: 'gear', exe: ['gnome-control-center', 'systemsettings', 'xfce4-settings-manager', 'cinnamon-settings', 'mate-control-center'] },
  calc:       { name: 'Rechner', icon: 'calc', exe: ['gnome-calculator', 'kcalc', 'galculator', 'mate-calc'] },
  snip:       { name: 'Ausschnitt', icon: 'snip', exe: ['gnome-screenshot', 'spectacle', 'xfce4-screenshooter', 'flameshot'], args: { 'gnome-screenshot': '-i', flameshot: 'gui' } },
  sudoTools:  { name: 'Werkzeugkasten', short: 'Werkzeuge', icon: 'tools', internal: 'tools' },
  sudoAsk:    { name: 'Frag Sudo', icon: 'ask', internal: 'ask' },
  sudoNote:   { name: 'Notiz', icon: 'note', internal: 'quick' },
  sudoLage:   { name: 'IT-Lage', icon: 'shield', internal: 'lage' },
  sudoHelp:   { name: 'Selbsthilfe', icon: 'heal', internal: 'selfhelp' }
};
const BUILTIN = LINUX ? BUILTIN_LINUX : BUILTIN_WIN;
const DECK_DEFAULTS = { on: true, builtin: LINUX ? ['terminal', 'rootterm', 'files', 'sysmon', 'linsettings', 'sudoTools']
  : ['powershell', 'psadmin', 'cmd', 'terminal', 'explorer', 'taskmgr', 'winsettings', 'sudoTools'], custom: [] };
const MAX_ITEMS = 12, MAX_CUSTOM = 8;

// Ziel einordnen: Link/Protokoll, Ordner oder Programm/Datei
function kindOf(target) {
  const t = String(target || '').trim();
  if (/^(https?|mailto|ms-[a-z-]+|steam|teams|msteams|outlook|onenote|tel|callto|sip|rdp):/i.test(t)) return 'url';
  if (/^[a-z][a-z0-9+.-]{1,20}:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return 'blocked';   // andere Protokolle (file:, javascript: …) nicht
  return 'path';
}
function normalizeDeck(d = {}) {
  const builtin = (Array.isArray(d.builtin) ? d.builtin : DECK_DEFAULTS.builtin).filter(id => BUILTIN[id]);
  const custom = (Array.isArray(d.custom) ? d.custom : []).slice(0, MAX_CUSTOM).map(c => cleanCustom(c)).filter(Boolean);
  // 1.14: Darstellung als Rad (Standard) oder Leiste; Plugins erscheinen von selbst, ausgeblendete stehen in hidePlugins
  const hidePlugins = (Array.isArray(d.hidePlugins) ? d.hidePlugins : []).filter(k => typeof k === 'string' && PLUGIN_KEY.test(k)).slice(0, 50);
  return { on: d.on !== false, style: d.style === 'leiste' ? 'leiste' : 'rad', builtin: [...new Set(builtin)], custom, hidePlugins: [...new Set(hidePlugins)] };
}
const PLUGIN_KEY = /^(eigene|zentrale)\/[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_PLUGINS = 8;
function cleanCustom(c) {
  if (!c || typeof c !== 'object') return null;
  const target = String(c.target || '').trim().slice(0, 400);
  const name = String(c.name || '').trim().slice(0, 24) || path.basename(target).replace(/\.(exe|lnk|bat|cmd|ps1)$/i, '').slice(0, 24);
  if (!target || !name || kindOf(target) === 'blocked') return null;
  return { id: /^c[a-z0-9]{2,12}$/.test(c.id) ? c.id : 'c' + Math.random().toString(36).slice(2, 9), name, target,
    args: String(c.args || '').slice(0, 300), admin: !!c.admin, icon: kindOf(target) === 'url' ? 'globe' : 'star' };
}
// Was der Overlay anzeigen darf (ohne Ziele und Argumente)
/**
 * Was das Overlay anzeigt.
 * @param {object} d  settings.deck
 * @param {{id,source,name}[]} plugins  vorhandene Plugins (1.14) – erscheinen hinter den festen Einträgen
 */
function deckPublic(d, plugins = []) {
  const n = normalizeDeck(d);
  if (!n.on) return { on: false, style: n.style, items: [] };
  const items = [
    ...Object.keys(BUILTIN).filter(id => n.builtin.includes(id)).map(id => ({ id, name: BUILTIN[id].name, short: BUILTIN[id].short || BUILTIN[id].name, icon: BUILTIN[id].icon, admin: !!BUILTIN[id].admin })),
    ...n.custom.map(c => ({ id: c.id, name: c.name, short: c.name, icon: c.icon, admin: c.admin }))
  ].slice(0, MAX_ITEMS);
  const pl = plugins.filter(p => !n.hidePlugins.includes(p.source + '/' + p.id)).slice(0, MAX_PLUGINS)
    .map(p => ({ id: 'plugin:' + p.source + '/' + p.id, name: p.name, short: p.name, icon: 'plugin', plugin: true, own: p.source === 'eigene' }));
  return { on: true, style: n.style, items: [...items, ...pl] };
}

const psq = s => "'" + String(s).replace(/'/g, "''") + "'";     // PowerShell-String in einfachen Anführungszeichen
// Programm in eigenem Fenster starten, auf Wunsch mit UAC-Abfrage (Start-Process -Verb RunAs)
function startProcess(exe, args, admin) {
  if (LINUX) return startLinux(exe, args, admin);
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ ok: false, msg: 'Nur unter Windows.' });
    const cmd = `Start-Process -FilePath ${psq(exe)}${args ? ' -ArgumentList ' + psq(args) : ''} -WorkingDirectory ${psq(os.homedir())}${admin ? ' -Verb RunAs' : ''}`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', b => { err += b; });
    ps.on('error', e => resolve({ ok: false, msg: e.message }));
    ps.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, msg: /abgebrochen|canceled|cancelled/i.test(err) ? 'Abgebrochen.' : 'Konnte nicht gestartet werden.' }));
  });
}

// Linux (1.12): Programm im PATH suchen (ohne Shell, damit Argumente nie als Befehl ausgeführt werden)
function which(name) {
  if (name.includes('/')) { try { fs.accessSync(name, fs.constants.X_OK); return name; } catch { return ''; } }
  for (const dir of String(process.env.PATH || '/usr/bin:/bin').split(':')) {
    const f = path.join(dir || '.', name);
    try { if (fs.statSync(f).isFile()) { fs.accessSync(f, fs.constants.X_OK); return f; } } catch { /* weiter */ }
  }
  return '';
}
// Argumente wie in einer Shell trennen: Leerzeichen, "…" und '…' – aber ohne Variablen, Umleitungen oder Befehlsketten
function splitArgs(s) {
  const out = []; let cur = '', q = '', has = false;
  for (const ch of String(s || '')) {
    if (q) { if (ch === q) q = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (has || cur) out.push(cur);
  return out;
}
// Erstes vorhandene Programm starten, losgelöst von Sudo. „Admin“ = pkexec (grafische Passwortabfrage über polkit).
function startLinux(exe, args, admin) {
  return new Promise(resolve => {
    const list = Array.isArray(exe) ? exe : [exe];
    const found = list.map(e => [e, which(e)]).find(([, f]) => f);
    if (!found) return resolve({ ok: false, msg: 'Programm nicht gefunden.' });
    const [name, file] = found;
    const a = splitArgs(typeof args === 'object' && args ? (args[name] || '') : args);
    let cmd = file, argv = a;
    if (admin) {
      const pk = which('pkexec');
      if (!pk) return resolve({ ok: false, msg: 'pkexec fehlt – Start als Root nicht möglich.' });
      // Ein Terminal als Root braucht DISPLAY/XAUTHORITY, sonst öffnet es kein Fenster
      cmd = pk; argv = ['env', 'DISPLAY=' + (process.env.DISPLAY || ':0'), 'XAUTHORITY=' + (process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority')), file, ...a];
    }
    try {
      const p = spawn(cmd, argv, { cwd: os.homedir(), detached: true, stdio: 'ignore' });
      p.on('error', e => resolve({ ok: false, msg: e.message }));
      // pkexec meldet „abgebrochen“ mit Code 126 – das sieht man nur, wenn er sich schnell beendet
      if (admin) p.on('exit', code => resolve(code === 126 ? { ok: false, msg: 'Abgebrochen.' } : { ok: true }));
      p.unref();
      if (admin) setTimeout(() => resolve({ ok: true }), 1500); else setTimeout(() => resolve({ ok: true }), 150);
    } catch (e) { resolve({ ok: false, msg: e.message }); }
  });
}

function createDeck({ getSettings, shell, internal, log }) {
  async function run(id) {
    const d = normalizeDeck(getSettings().deck);
    if (!d.on) return { ok: false };
    const b = BUILTIN[id] && d.builtin.includes(id) ? BUILTIN[id] : null;
    const c = b ? null : d.custom.find(x => x.id === id);
    if (!b && !c) return { ok: false, msg: 'Unbekannter Eintrag.' };
    const name = (b || c).name;
    log('Ninja-Leiste: ' + name);
    try {
      if (b && b.internal) { internal(b.internal); return { ok: true, name, internal: true }; }
      if (b && b.url) { await shell.openExternal(b.url); return { ok: true, name }; }
      if (b && b.home) { const e = await shell.openPath(os.homedir()); return e ? { ok: false, name, msg: e } : { ok: true, name }; }
      if (b) { const r = await startProcess(b.exe, b.args || '', !!b.admin); return { ...r, name, admin: !!b.admin }; }
      // eigener Eintrag
      const kind = kindOf(c.target);
      if (kind === 'url') { await shell.openExternal(c.target); return { ok: true, name }; }
      if (kind !== 'path') return { ok: false, name, msg: 'Dieses Ziel ist nicht erlaubt.' };
      const target = c.target.replace(/^%([^%]+)%/, (_, v) => process.env[v] || _).replace(/^~(?=\/|$)/, os.homedir());
      let isDir = false; try { isDir = fs.statSync(target).isDirectory(); } catch { /* evtl. Programm im PATH, z. B. notepad.exe */ }
      if (isDir || (!c.args && !c.admin && /\.(lnk|url|txt|pdf|docx?|xlsx?|pptx?|msc)$/i.test(target))) {
        const e = await shell.openPath(target); return e ? { ok: false, name, msg: e } : { ok: true, name };
      }
      const r = await startProcess(target, c.args, c.admin); return { ...r, name, admin: c.admin };
    } catch (e) {
      log('Ninja-Leiste Fehler: ' + e.message);
      return { ok: false, name, msg: 'Konnte nicht gestartet werden.' };
    }
  }
  return { run };
}

module.exports = { createDeck, deckPublic, normalizeDeck, cleanCustom, kindOf, BUILTIN, DECK_DEFAULTS, MAX_CUSTOM, PLUGIN_KEY };
