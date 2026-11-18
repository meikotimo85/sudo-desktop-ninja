// plugins.js – kleine Zusatzwerkzeuge als einzelne HTML-Datei (1.12)
//
// Ablage:  %APPDATA%\Sudo\plugins\eigene\<id>\index.html + plugin.json   (selbst hinzugefügt)
//          %APPDATA%\Sudo\plugins\zentrale\<id>\…                        (von der Sudo-Zentrale, wird abgeglichen)
//
// Ein Plugin läuft in einem eigenen, abgeschotteten Fenster:
//  - kein Node, kein Preload, also kein Zugriff auf Sudo, Einstellungen, Schlüssel oder Dateien
//  - kein Netzwerk: alles außer den eigenen Dateien des Plugins wird gesperrt (auch WebRTC)
//  - eigener Speicher je Plugin (localStorage usw. getrennt von anderen Plugins)
//  - erlaubt: in die Zwischenablage schreiben, Rückfragen (confirm/alert), Datei speichern (Speichern-Dialog)
//
// Angaben stehen im HTML selbst: <title> ist der Name, optional
//   <meta name="sudo-plugin-id" content="naming-tool">
//   <meta name="sudo-plugin-version" content="1.0">
//   <meta name="sudo-plugin-size" content="900x760">
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { execFile } = require('child_process');

const MAX_BYTES = 2 * 1024 * 1024;
const SOURCES = ['eigene', 'zentrale'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const clampW = w => Math.max(360, Math.min(1600, Number(w) || 900));
const clampH = h => Math.max(300, Math.min(1200, Number(h) || 720));
function slug(s) {
  return String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
function meta(html, name) {
  const m = html.match(new RegExp(`<meta\\s+name=["']sudo-plugin-${name}["']\\s+content=["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}
/** Name, Kennung, Version und Fenstergröße aus dem HTML lesen */
function describe(html, fileName) {
  const title = (html.match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || '';
  const name = (meta(html, 'name') || title.trim() || path.basename(String(fileName || 'Plugin'), path.extname(String(fileName || '')))).replace(/\s+/g, ' ').slice(0, 60) || 'Plugin';
  let id = slug(meta(html, 'id') || name);
  if (!ID_RE.test(id)) id = 'plugin-' + sha256(name).slice(0, 8);
  const size = (meta(html, 'size').match(/^(\d{3,4})\s*x\s*(\d{3,4})$/i) || []);
  return { id, name, version: meta(html, 'version').slice(0, 20), w: clampW(size[1]), h: clampH(size[2]) };
}
/** null = in Ordnung, sonst die Fehlermeldung */
function checkHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return 'Die Datei ist leer.';
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return 'Das Plugin ist größer als 2 MB.';
  if (!/<(!doctype\s+html|html|body)[\s>]/i.test(html)) return 'Das ist keine HTML-Datei.';
  return null;
}

function createPlugins({ dir, log = () => {}, electron, icon, devTools = false }) {
  const { BrowserWindow, session, screen } = electron;
  let userAllowed = true;
  const wins = new Map();
  const hardened = new WeakSet();
  let lastWin = null;

  const folder = (source, id) => path.join(dir, source, id);
  function read(source, id) {
    if (!SOURCES.includes(source) || !ID_RE.test(String(id))) return null;
    const f = folder(source, id);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(f, 'plugin.json'), 'utf8'));
      const file = path.join(f, 'index.html');
      if (!fs.existsSync(file)) return null;
      return { id, source, name: String(m.name || id), version: String(m.version || ''), w: clampW(m.w), h: clampH(m.h), sha: String(m.sha || ''), added: Number(m.added) || 0, file };
    } catch { return null; }
  }
  function write(source, info, html) {
    const f = folder(source, info.id);
    fs.mkdirSync(f, { recursive: true });
    fs.writeFileSync(path.join(f, 'index.html'), html, 'utf8');
    const m = { id: info.id, name: info.name, version: info.version || '', w: info.w, h: info.h, sha: sha256(html), added: Date.now() };
    fs.writeFileSync(path.join(f, 'plugin.json'), JSON.stringify(m, null, 1), 'utf8');
    return m;
  }
  function ids(source) {
    try { return fs.readdirSync(path.join(dir, source)).filter(n => ID_RE.test(n)); } catch { return []; }
  }

  /** Alle nutzbaren Plugins; eigene nur, wenn die IT das erlaubt */
  function list() {
    const out = [];
    for (const source of SOURCES) {
      if (source === 'eigene' && !userAllowed) continue;
      for (const id of ids(source)) { const p = read(source, id); if (p) out.push(p); }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /** Datei prüfen, ohne sie zu übernehmen (für die Rückfrage beim Doppelklick auf .sudoplugin) */
  function inspect(filePath) {
    if (!userAllowed) return { ok: false, msg: 'Deine IT erlaubt keine eigenen Plugins.' };
    let html;
    try {
      if (fs.statSync(filePath).size > MAX_BYTES) return { ok: false, msg: 'Das Plugin ist größer als 2 MB.' };
      html = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    } catch (e) { return { ok: false, msg: 'Datei nicht lesbar: ' + e.message }; }
    const bad = checkHtml(html);
    if (bad) return { ok: false, msg: bad };
    const info = describe(html, path.basename(filePath));
    const old = read('eigene', info.id);
    return { ok: true, info, html, had: !!old, oldVersion: old ? old.version : '' };
  }

  /** Eigenes Plugin aus einer HTML- oder .sudoplugin-Datei hinzufügen (gleiche Kennung ersetzt die alte Fassung) */
  function addFile(filePath) {
    const c = inspect(filePath);
    if (!c.ok) return c;
    const { info, html, had } = c;
    write('eigene', info, html);
    log(`Plugin ${had ? 'aktualisiert' : 'hinzugefügt'}: ${info.name}`);
    return { ok: true, msg: had ? `„${info.name}“ aktualisiert.` : `„${info.name}“ hinzugefügt.`, id: info.id };
  }

  function remove(id) {
    const p = read('eigene', String(id));
    if (!p) return { ok: false, msg: 'Plugin nicht gefunden.' };
    closeWin('eigene', p.id);
    fs.rmSync(folder('eigene', p.id), { recursive: true, force: true });
    log('Plugin entfernt: ' + p.name);
    return { ok: true, msg: `„${p.name}“ entfernt.` };
  }

  /**
   * Plugins der Zentrale abgleichen.
   * @param {{id,name,version,sha,w,h}[]} items  Liste aus der Zentrale
   * @param {(id:string) => Promise<{ok:boolean, html?:string, msg?:string}>} fetchOne
   * @returns {Promise<boolean>} true, wenn sich etwas geändert hat
   */
  let syncing = Promise.resolve(false);
  function syncZentrale(items, fetchOne) {
    syncing = syncing.then(() => doSync(items, fetchOne)).catch(e => { log('Plugins der Zentrale: ' + e.message); return false; });
    return syncing;
  }
  async function doSync(items, fetchOne) {
    let changed = false;
    const want = new Map((Array.isArray(items) ? items : []).filter(i => i && ID_RE.test(String(i.id))).map(i => [String(i.id), i]));
    for (const id of ids('zentrale')) {
      if (want.has(id)) continue;
      closeWin('zentrale', id);
      fs.rmSync(folder('zentrale', id), { recursive: true, force: true });
      log('Plugin der Zentrale entfernt: ' + id);
      changed = true;
    }
    for (const [id, it] of want) {
      const have = read('zentrale', id);
      if (have && have.sha === it.sha) continue;
      const r = await fetchOne(id);
      if (!r || !r.ok || typeof r.html !== 'string') { log(`Plugin ${id} nicht geladen: ${(r && r.msg) || 'keine Antwort'}`); continue; }
      if (sha256(r.html) !== it.sha || checkHtml(r.html)) { log(`Plugin ${id} verworfen: Prüfsumme oder Inhalt passt nicht`); continue; }
      write('zentrale', { id, name: String(it.name || id).slice(0, 60), version: String(it.version || '').slice(0, 20), w: clampW(it.w), h: clampH(it.h) }, r.html);
      closeWin('zentrale', id);
      log(`Plugin der Zentrale ${have ? 'aktualisiert' : 'geladen'}: ${it.name || id}`);
      changed = true;
    }
    return changed;
  }

  /* ---------- Abgeschottetes Fenster ---------- */
  function harden(ses, root) {
    if (hardened.has(ses)) return;
    hardened.add(ses);
    const rootLow = root.toLowerCase() + path.sep;
    let warned = 0;
    // Nur die eigenen Dateien des Plugins; alles andere (http, https, ws, fremde Dateien) wird gesperrt
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
      let ok = false;
      try {
        if (d.url.startsWith('file:')) ok = (path.resolve(fileURLToPath(d.url)).toLowerCase() + path.sep).startsWith(rootLow);
        else ok = /^(data|blob|devtools):/i.test(d.url);
      } catch { ok = false; }
      if (!ok && warned++ < 5) log(`Plugin: Zugriff gesperrt (${d.url.slice(0, 60)})`);
      cb({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
    ses.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-sanitized-write');
  }
  function closeWin(source, id) {
    const w = wins.get(source + '/' + id);
    if (w && !w.isDestroyed()) w.destroy();
  }
  function open(source, id) {
    if (source === 'eigene' && !userAllowed) return false;
    const p = read(source, String(id));
    if (!p) return false;
    const key = source + '/' + p.id;
    const old = wins.get(key);
    if (old && !old.isDestroyed()) { old.show(); old.focus(); return true; }
    const part = `persist:sudo-plugin-${source}-${p.id}`;
    harden(session.fromPartition(part), path.dirname(p.file));
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = Math.min(p.w, wa.width - 40), h = Math.min(p.h, wa.height - 40);
    const bw = new BrowserWindow({
      width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 3),
      title: p.name, autoHideMenuBar: true, show: false, backgroundColor: '#ffffff', icon,
      webPreferences: { partition: part, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
        spellcheck: false, navigateOnDragDrop: false, devTools }
    });
    bw.setMenu(null);
    const url = pathToFileURL(p.file).href;
    const wc = bw.webContents;
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');   // kein WebRTC an der Sperre vorbei
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, u) => { if (String(u).split('#')[0] !== url) e.preventDefault(); });
    wc.on('will-attach-webview', e => e.preventDefault());
    bw.on('page-title-updated', e => e.preventDefault());
    bw.loadURL(url);
    bw.once('ready-to-show', () => { bw.show(); bw.focus(); });
    wins.set(key, bw); lastWin = bw;
    bw.on('closed', () => { wins.delete(key); if (lastWin === bw) lastWin = null; });
    log('Plugin geöffnet: ' + p.name);
    return true;
  }

  /* ---------- Dateiendung .sudoplugin (1.13) ----------
     Trägt die Endung nur für den angemeldeten Benutzer ein (HKCU\Software\Classes) – ohne Adminrechte,
     gleich für Setup, MSI und portable EXE. Schreibt nur, was sich geändert hat (z. B. neuer Programmpfad).
     Das Symbol wird nach %APPDATA%\Sudo kopiert, weil Windows nicht in app.asar hineinsehen kann. */
  const reg = args => new Promise(res => execFile('reg.exe', args, { windowsHide: true, timeout: 8000 }, (e, out) => res(e ? null : String(out || ''))));
  async function regDefault(key) {
    const out = await reg(['query', key, '/ve']);
    const m = out && out.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/m);
    return m ? m[1].trim() : null;
  }
  async function registerFileType({ ext = '.sudoplugin', progId = 'Sudo.Plugin', typeName = 'Sudo-Plugin', command, iconSrc, iconDir, notify = () => {} }) {
    if (process.platform !== 'win32') return { ok: false, changed: false };
    let iconPath = '';
    try {
      iconPath = path.join(iconDir, 'plugin-file.ico');
      const src = fs.readFileSync(iconSrc);
      if (!fs.existsSync(iconPath) || !fs.readFileSync(iconPath).equals(src)) fs.writeFileSync(iconPath, src);
    } catch (e) { log('Plugin-Symbol: ' + e.message); iconPath = ''; }
    const base = 'HKCU\\Software\\Classes\\';
    const want = [[base + ext, progId], [base + progId, typeName], [base + progId + '\\shell\\open\\command', command]];
    if (iconPath) want.push([base + progId + '\\DefaultIcon', `"${iconPath}",0`]);
    let changed = false;
    for (const [key, value] of want) {
      if ((await regDefault(key)) === value) continue;
      if ((await reg(['add', key, '/ve', '/d', value, '/f'])) === null) { log('Dateiendung ' + ext + ': Eintrag fehlgeschlagen (' + key + ')'); return { ok: false, changed }; }
      changed = true;
    }
    if (changed) { notify(); log(`Dateiendung ${ext} eingetragen`); }
    return { ok: true, changed };
  }

  return {
    list, inspect, addFile, remove, open, syncZentrale, registerFileType,
    setUserAllowed: v => { userAllowed = v !== false; if (!userAllowed) for (const id of ids('eigene')) closeWin('eigene', id); },
    userAllowed: () => userAllowed,
    lastWin: () => (lastWin && !lastWin.isDestroyed() ? lastWin : null)
  };
}

module.exports = { createPlugins, describe, checkHtml, MAX_BYTES };
