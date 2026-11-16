// deck.js – Ninja-Leiste: Schnellstart per mittlerer Maustaste auf Sudo (1.4.2)
// Der Overlay schickt nur die ID eines Eintrags. Was gestartet wird, steht ausschließlich in den Einstellungen.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Mitgelieferte Einträge (Reihenfolge = Reihenfolge in der Leiste)
const BUILTIN = {
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
const DECK_DEFAULTS = { on: true, builtin: ['powershell', 'psadmin', 'cmd', 'terminal', 'explorer', 'taskmgr', 'winsettings', 'sudoTools'], custom: [] };
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
  return { on: d.on !== false, builtin: [...new Set(builtin)], custom };
}
function cleanCustom(c) {
  if (!c || typeof c !== 'object') return null;
  const target = String(c.target || '').trim().slice(0, 400);
  const name = String(c.name || '').trim().slice(0, 24) || path.basename(target).replace(/\.(exe|lnk|bat|cmd|ps1)$/i, '').slice(0, 24);
  if (!target || !name || kindOf(target) === 'blocked') return null;
  return { id: /^c[a-z0-9]{2,12}$/.test(c.id) ? c.id : 'c' + Math.random().toString(36).slice(2, 9), name, target,
    args: String(c.args || '').slice(0, 300), admin: !!c.admin, icon: kindOf(target) === 'url' ? 'globe' : 'star' };
}
// Was der Overlay anzeigen darf (ohne Ziele und Argumente)
function deckPublic(d) {
  const n = normalizeDeck(d);
  if (!n.on) return { on: false, items: [] };
  const items = [
    ...Object.keys(BUILTIN).filter(id => n.builtin.includes(id)).map(id => ({ id, name: BUILTIN[id].name, short: BUILTIN[id].short || BUILTIN[id].name, icon: BUILTIN[id].icon, admin: !!BUILTIN[id].admin })),
    ...n.custom.map(c => ({ id: c.id, name: c.name, short: c.name, icon: c.icon, admin: c.admin }))
  ].slice(0, MAX_ITEMS);
  return { on: true, items };
}

const psq = s => "'" + String(s).replace(/'/g, "''") + "'";     // PowerShell-String in einfachen Anführungszeichen
// Programm in eigenem Fenster starten, auf Wunsch mit UAC-Abfrage (Start-Process -Verb RunAs)
function startProcess(exe, args, admin) {
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
      if (b) { const r = await startProcess(b.exe, b.args || '', !!b.admin); return { ...r, name, admin: !!b.admin }; }
      // eigener Eintrag
      const kind = kindOf(c.target);
      if (kind === 'url') { await shell.openExternal(c.target); return { ok: true, name }; }
      if (kind !== 'path') return { ok: false, name, msg: 'Dieses Ziel ist nicht erlaubt.' };
      const target = c.target.replace(/^%([^%]+)%/, (_, v) => process.env[v] || _);
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

module.exports = { createDeck, deckPublic, normalizeDeck, cleanCustom, kindOf, BUILTIN, DECK_DEFAULTS, MAX_CUSTOM };
