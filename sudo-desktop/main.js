// main.js – Hauptprozess: Overlay-Fenster, Fenstererkennung, Tastatur, Webhook, Tray
'use strict';

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, powerMonitor, globalShortcut, Notification, clipboard, net, dialog, safeStorage, nativeTheme } = require('electron');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
// Fenster-Schnittstelle: Windows-API oder unter Linux libX11 (1.12) – beide mit gleicher Schnittstelle
const win32 = require(process.platform === 'linux' ? './x11' : './win32');
const { createWork, normalize: normalizeWork, DEFAULTS: WORK_DEFAULTS } = require('./work');
const { createWatch, WATCH_DEFAULTS } = require('./watch');
const { createReminders } = require('./reminders');
const { createIntel, INTEL_DEFAULTS, PRESET_FEEDS, maskMail } = require('./intel');
const { createAsk, AI_DEFAULTS } = require('./ask');
const { createZentrale, ZENTRALE_DEFAULTS } = require('./zentrale');
const { createHealth } = require('./health');
const { createQuiz, QUIZ_DEFAULTS } = require('./quiz');
const { createSelfHelp } = require('./selfhelp');
const { createOps } = require('./ops');
const { createYouTube } = require('./youtube');
const { createDiag } = require('./diag');
const { createHabits, HABITS_DEFAULTS } = require('./habits');       // 1.10: Sperr-Erinnerung, Tipps
const { createCheckin, CHECKIN_DEFAULTS } = require('./checkin');    // 1.10: Stimmung, Start-Checkliste
const { rebootPending } = require('./health');
const { createDeck, deckPublic, normalizeDeck, cleanCustom, BUILTIN: DECK_BUILTIN, DECK_DEFAULTS, MAX_CUSTOM } = require('./deck');
const I18N = require('./renderer/i18n.js');
for (const c of ['en', 'ja']) { const d = require(`./renderer/lang/${c}.js`); I18N.register(d.code, d.table); }
const T = s => I18N.t(s);

const PORT = 4711;
const POLL_MS = 80, POLL_ECO_MS = 220;
const TEST = process.env.SUDO_TEST === '1';

// Linux (1.12): Unter Wayland darf eine App ihr Fenster weder frei platzieren noch dauerhaft nach vorn holen.
// Deshalb läuft Sudo dort über XWayland. Mit SUDO_WAYLAND=1 lässt sich das zum Ausprobieren abschalten.
if (process.platform === 'linux' && process.env.SUDO_WAYLAND !== '1') app.commandLine.appendSwitch('ozone-platform', 'x11');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null, tray = null, display = null, ownId = '0';
let lastPlatforms = '', hiddenForFullscreen = false, pollTimer = null, server = null, hook = null;
let trayTip = 'Sudo – Desktop-Ninja';

/* ---------- Einstellungen ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { sound: false, bugs: true, autostart: false, size: 'normal', appComments: true, meetingQuiet: true, hideFromCapture: true, displayId: null, home: null, work: normalizeWork(WORK_DEFAULTS), watch: { ...WATCH_DEFAULTS }, notify: true, outfit: { hat: null, face: null, neck: null }, toy: false, roam: true, eco: 'auto', autoUpdate: true, tourDone: false, lang: 'auto', special: { birthday: '', jubilee: '', seasonal: true }, relay: { url: '', token: '', enabled: false, lastId: null }, intel: { ...INTEL_DEFAULTS }, ai: { ...AI_DEFAULTS }, zentrale: { ...ZENTRALE_DEFAULTS }, visits: { allow: true, name: '' }, contrast: { mode: 'auto', style: 'outline', color: 'white' }, bubble: { font: 'pixel', size: 'normal', time: 'normal' }, deck: { ...DECK_DEFAULTS }, quiz: { ...QUIZ_DEFAULTS }, ops: {}, media: { videos: true, channels: [], seen: [] }, habits: { ...HABITS_DEFAULTS }, checkin: { ...CHECKIN_DEFAULTS } };
// Gespeicherte Feed-Liste mit den mitgelieferten Feeds abgleichen (neue Vorgaben kommen dazu, An/Aus bleibt)
function mergeIntel(saved = {}) {
  const i = { ...INTEL_DEFAULTS, ...saved };
  const mine = Array.isArray(saved.feeds) ? saved.feeds : [];
  i.feeds = [...INTEL_DEFAULTS.feeds.map(d => ({ ...d, on: (mine.find(f => f.id === d.id) || d).on !== false })),
    ...mine.filter(f => f && f.id && !PRESET_FEEDS.includes(f.id)).slice(0, 8)];
  return i;
}
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...settings, ...s, relay: { ...settings.relay, ...(s.relay || {}) }, work: normalizeWork(s.work), watch: { ...WATCH_DEFAULTS, ...(s.watch || {}) }, special: { ...settings.special, ...(s.special || {}) }, outfit: { ...settings.outfit, ...(s.outfit || {}) }, intel: mergeIntel(s.intel), ai: { ...AI_DEFAULTS, ...(s.ai || {}) }, zentrale: { ...ZENTRALE_DEFAULTS, ...(s.zentrale || {}) }, visits: { allow: true, name: '', ...(s.visits || {}) }, contrast: { ...settings.contrast, ...(s.contrast || {}) }, bubble: { ...settings.bubble, ...(s.bubble || {}) }, deck: normalizeDeck(s.deck || DECK_DEFAULTS), quiz: { ...QUIZ_DEFAULTS, ...(s.quiz || {}) }, ops: s.ops && typeof s.ops === 'object' ? s.ops : {}, media: { videos: true, channels: [], seen: [], ...(s.media || {}) }, habits: { ...HABITS_DEFAULTS, ...(s.habits || {}) }, checkin: { ...CHECKIN_DEFAULTS, ...(s.checkin || {}) } };
  } catch { /* erste Ausführung */ }
}
// Sprache: 'auto' folgt der Windows-Sprache (Deutsch, Japanisch, sonst Englisch)
function effLang() {
  if (['de', 'en', 'ja'].includes(settings.lang)) return settings.lang;
  const l = String(app.getLocale() || 'de').toLowerCase();
  return l.startsWith('de') ? 'de' : l.startsWith('ja') ? 'ja' : 'en';
}
const I18N_COLLECT = TEST && process.env.SUDO_I18N_COLLECT ? new Set() : null;
function applyLang() {
  I18N.setLang(effLang());
  if (I18N_COLLECT) I18N.collector = x => I18N_COLLECT.add(x);
}
// Jede Seite bekommt die Sprache in der Adresse mit (?lang=en); i18n.js übersetzt dann von selbst
function loadPage(bw, file, extra = {}) {
  bw.__page = { file, extra };
  const query = { lang: effLang() };
  if (I18N_COLLECT) {
    query.i18ncollect = '1';
    if (!bw.__collect) { bw.__collect = true; bw.webContents.on('console-message', (...a) => { const m = typeof a[0] === 'object' && a[0] && 'message' in a[0] ? a[0].message : a[2]; if (String(m).startsWith('[i18n-missing] ')) I18N_COLLECT.add(JSON.parse(String(m).slice(15))); }); }
  }
  return bw.loadFile(path.join(__dirname, 'renderer', file), { ...extra, query });
}
function setLanguage(code) {
  if (!['auto', 'de', 'en', 'ja'].includes(code)) return;
  settings.lang = code; applyLang();
  for (const bw of BrowserWindow.getAllWindows()) if (bw.__page && !bw.isDestroyed()) loadPage(bw, bw.__page.file, bw.__page.extra);
  buildTrayMenu();
}
// Was das Overlay wissen darf (ohne Relay-Token)
const publicSettings = () => ({ deck: deckPublic(settings.deck), contrast: settings.contrast, bubble: settings.bubble, darkTheme: darkTheme(), sound: settings.sound, bugs: settings.bugs, size: settings.size, appComments: settings.appComments, home: settings.home, watch: settings.watch, outfit: settings.outfit, toy: settings.toy, special: settings.special });
// Dunkles Windows-Design? (Apps-Modus) – dann bekommt der schwarze Ninja automatisch einen Umriss
const darkTheme = () => { try { return !!nativeTheme.shouldUseDarkColors; } catch { return false; } };

/* ---------- Skin: eigenes Sprite-Sheet in %APPDATA%\Sudo\skin, sonst das mitgelieferte ---------- */
const skinDir = () => path.join(app.getPath('userData'), 'skin');
function readSheet(dir) {
  const png = path.join(dir, 'sudo-sheet.png'), json = path.join(dir, 'sudo-sheet.json');
  if (!fs.existsSync(png) || !fs.existsSync(json)) return null;
  const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
  if (!meta || !Array.isArray(meta.cell) || !meta.frames || !meta.frames.stand) throw new Error('sudo-sheet.json ist unvollständig');
  return { png: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64'), meta };
}
// 1.9: Skin-Auswahl – Farbvarianten der Standardgrafik, eigene Skins in %APPDATA%\Sudo\skins\<Name>, dazu der alte „skin“-Ordner
const SKIN_VARIANTS = {
  classic: { name: 'Klassik (Türkis)' },
  fire: { name: 'Feuerwehr (Rot)', recolor: { hue: 2, sat: 1.05, light: .95 } },
  matrix: { name: 'Matrix (Grün)', recolor: { hue: 128, sat: 1, light: .95 } },
  royal: { name: 'Royal (Lila)', recolor: { hue: 272, sat: .95, light: 1.05 } },
  gold: { name: 'Gold', recolor: { hue: 44, sat: 1.05, light: 1.05 } },
  snow: { name: 'Schnee (Hell)', recolor: { hue: 208, sat: 1, light: 1 }, hoodie: 'light' }
};
const skinsRoot = () => path.join(app.getPath('userData'), 'skins');
function userSkins() {
  try {
    return fs.readdirSync(skinsRoot(), { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'vorlage' && /^[\w äöüÄÖÜß.-]{1,40}$/.test(d.name)
      && fs.existsSync(path.join(skinsRoot(), d.name, 'sudo-sheet.png')) && fs.existsSync(path.join(skinsRoot(), d.name, 'sudo-sheet.json'))).map(d => d.name).slice(0, 20);
  } catch { return []; }
}
const legacySkin = () => fs.existsSync(path.join(skinDir(), 'sudo-sheet.png')) && fs.existsSync(path.join(skinDir(), 'sudo-sheet.json'));
// Gewählter Skin; ohne Wahl gilt ein vorhandener alter eigener Skin weiter
function currentSkin() {
  const c = settings.skinChoice;
  if (c && (SKIN_VARIANTS[c] || (c === 'custom' && legacySkin()) || (c.startsWith('user:') && userSkins().includes(c.slice(5))))) return c;
  return legacySkin() ? 'custom' : 'classic';
}
function skinList() {
  return [...Object.entries(SKIN_VARIANTS).map(([id, v]) => ({ id, name: v.name, kind: 'variant' })),
    ...(legacySkin() ? [{ id: 'custom', name: 'Eigener Skin', kind: 'custom' }] : []),
    ...userSkins().map(n => ({ id: 'user:' + n, name: n, kind: 'user' }))];
}
function setSkin(id) {
  if (!skinList().some(s => s.id === id)) return false;
  settings.skinChoice = id; saveSettings(); reloadSkin(); if (tray) buildTrayMenu();
  writeLog('Skin gewählt: ' + id);
  return true;
}
function withDefaultAcc(custom) {
  // Ältere Skins (vor 0.9) kennen noch kein Zubehör: Hüte & Brillen dann aus der Standardgrafik nehmen
  if (!custom.meta.acc || !Object.keys(custom.meta.acc).length) {
    const def = readSheet(path.join(__dirname, 'assets'));
    if (def && def.meta.acc) {
      custom.meta = { ...custom.meta, acc: def.meta.acc, accMargin: def.meta.accMargin, accFromDefault: true };
      custom.accPng = def.png;
      if (def.meta.cell[0] !== custom.meta.cell[0] || def.meta.cell[1] !== custom.meta.cell[1]) { delete custom.accPng; delete custom.meta.acc; }
    }
  }
  return custom;
}
function loadSheet() {
  const choice = currentSkin();
  if (choice.startsWith('user:')) {
    try { const u = readSheet(path.join(skinsRoot(), choice.slice(5))); if (u) return { ...withDefaultAcc(u), custom: true, skin: choice }; }
    catch (e) { writeLog('Skin „' + choice.slice(5) + '“ fehlerhaft, nutze Standard: ' + e.message); }
  }
  if (SKIN_VARIANTS[choice]) {
    try { const d = readSheet(path.join(__dirname, 'assets')); const v = SKIN_VARIANTS[choice]; if (v.recolor) d.meta = { ...d.meta, recolor: { ...v.recolor, hoodie: v.hoodie } }; return { ...d, custom: false, skin: choice }; }
    catch (e) { writeLog('Sprite-Sheet fehlt: ' + e.message); return null; }
  }
  try {
    const custom = readSheet(skinDir());
    if (custom) {
      return { ...withDefaultAcc(custom), custom: true, skin: 'custom' };
    }
  } catch (e) {
    writeLog('Eigener Skin fehlerhaft, nutze Standard: ' + e.message);
  }
  try { return { ...readSheet(path.join(__dirname, 'assets')), custom: false }; }
  catch (e) { writeLog('Sprite-Sheet fehlt: ' + e.message); return null; }
}
function openSkinFolder() {
  const dir = skinsRoot();
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Vorlage immer aktuell in "vorlage\" ablegen – aktiv wird ein Skin erst, wenn die Dateien direkt im Skin-Ordner liegen
    const tpl = path.join(dir, 'vorlage');
    fs.mkdirSync(tpl, { recursive: true });
    for (const f of ['sudo-sheet.png', 'sudo-sheet.json']) fs.copyFileSync(path.join(__dirname, 'assets', f), path.join(tpl, f));
    fs.copyFileSync(path.join(__dirname, 'assets', 'SKIN-ANLEITUNG.txt'), path.join(dir, 'SKIN-ANLEITUNG.txt'));
    if (tray) buildTrayMenu();
  } catch (e) { writeLog('Skin-Ordner: ' + e.message); }
  shell.openPath(dir);
}
function reloadSkin() {
  if (win && !win.isDestroyed()) win.webContents.reload();
  if (wardrobeWin && !wardrobeWin.isDestroyed()) wardrobeWin.webContents.reload();
}
function skinStatus() {
  const cur = currentSkin(), list = skinList(), item = list.find(s => s.id === cur);
  return { current: cur, list, text: item ? item.name : 'Standardgrafik', custom: cur === 'custom' || cur.startsWith('user:') };
}
// Eigenen Skin beiseitelegen (nicht löschen) und zur Standardgrafik zurück
function resetSkin() {
  const dir = skinDir();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const dest = path.join(dir, 'alt-' + stamp);
  let moved = 0;
  for (const f of ['sudo-sheet.png', 'sudo-sheet.json']) {
    const src = path.join(dir, f);
    if (fs.existsSync(src)) { fs.mkdirSync(dest, { recursive: true }); fs.renameSync(src, path.join(dest, f)); moved++; }
  }
  if (settings.skinChoice === 'custom' || !settings.skinChoice) settings.skinChoice = 'classic';
  saveSettings(); reloadSkin();
  writeLog(moved ? 'Eigener Skin beiseitegelegt: ' + dest : 'Kein eigener Skin aktiv');
  return { ok: true, msg: moved ? 'Standardgrafik aktiv. Dein Skin liegt im Ordner ' + path.basename(dest) + '.' : 'Es war bereits die Standardgrafik aktiv.' };
}
function writeSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); }
}
function saveSettings() {
  writeSettings();
  send('settings', publicSettings());
  buildTrayMenu();
}

/* ---------- Ereignisprotokoll ---------- */
const logFile = () => path.join(app.getPath('userData'), 'events.log');
function writeLog(msg) {
  const line = `${new Date().toLocaleString('de-DE')}  ${msg}\n`;
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 1024 * 1024) fs.writeFileSync(f, '');
    fs.appendFileSync(f, line);
  } catch { /* egal */ }
}

// Ereignisse, die vor dem Laden des Overlays eintreffen, werden gepuffert statt verworfen
let rendererReady = false, pendingEvents = [];
function send(ch, data) {
  if (!win || win.isDestroyed()) return;
  if (ch === 'event' && !rendererReady) { if (pendingEvents.length < 20) pendingEvents.push(data); return; }
  win.webContents.send(ch, data);
}

/* ---------- Layout ---------- */
function layoutInfo() {
  const b = display.bounds, wa = display.workArea;
  // Boden = Oberkante der Taskleiste (wenn sie unten liegt), sonst Bildschirmunterkante
  const floor = wa.y + wa.height < b.y + b.height ? wa.y + wa.height - b.y : b.height;
  return { width: b.width, height: b.height, floor };
}
let currentDisplayId = null;   // Bildschirm, auf dem Sudo gerade ist (kann beim Wandern wechseln)
function chosenDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => String(d.id) === String(currentDisplayId)) || all.find(d => String(d.id) === String(settings.displayId)) || screen.getPrimaryDisplay();
}
// Nachbar-Bildschirme links/rechts (überlappende Höhe), damit Sudo hinüberlaufen kann
function neighbors(d = chosenDisplay()) {
  const res = { left: null, right: null };
  for (const o of screen.getAllDisplays()) {
    if (o.id === d.id) continue;
    const overlap = Math.min(o.bounds.y + o.bounds.height, d.bounds.y + d.bounds.height) - Math.max(o.bounds.y, d.bounds.y);
    if (overlap < 100) continue;
    // etwas Spielraum: bei unterschiedlicher Skalierung (125 %/150 %) liegen die Kanten oft nicht exakt aneinander
    if (Math.abs(o.bounds.x + o.bounds.width - d.bounds.x) <= 48) res.left = o;
    if (Math.abs(d.bounds.x + d.bounds.width - o.bounds.x) <= 48) res.right = o;
  }
  return res;
}
function sendNeighbors() {
  const n = neighbors();
  send('neighbors', { left: !!n.left && settings.roam, right: !!n.right && settings.roam });
}
function moveToDisplay(d, from) {
  if (!win || win.isDestroyed() || !d) return;
  currentDisplayId = d.id;
  placeWindow(); lastPlatforms = '';
  send('arrive', { from });
  sendNeighbors();
  writeLog(`Sudo wandert auf Bildschirm ${screen.getAllDisplays().findIndex(x => x.id === d.id) + 1}`);
}
ipcMain.on('travel', (_e, dir) => {
  if (!settings.roam) return;
  const n = neighbors()[dir === 'left' ? 'left' : 'right'];
  if (n) moveToDisplay(n, dir === 'left' ? 'right' : 'left');
});
// Sudo wird über die Bildschirmkante gezogen → auf den Bildschirm unter dem Mauszeiger umziehen (1.4.2)
let lastDragOut = 0;
ipcMain.on('drag-out', (_e, m) => {
  if (!win || win.isDestroyed() || !display || Date.now() - lastDragOut < 250) return;
  // Position aus dem Zieh-Ereignis: Fensterecke + Mausposition im Fenster (zuverlässiger als die Systemabfrage)
  const wb = win.getBounds();
  const p = m && Number.isFinite(m.x) && Number.isFinite(m.y) && Math.abs(m.x) < 20000 && Math.abs(m.y) < 20000
    ? { x: Math.round(wb.x + m.x), y: Math.round(wb.y + m.y) } : screen.getCursorScreenPoint();
  const d = screen.getAllDisplays().find(x => p.x >= x.bounds.x && p.x < x.bounds.x + x.bounds.width && p.y >= x.bounds.y && p.y < x.bounds.y + x.bounds.height);
  if (!d || d.id === display.id) return;
  lastDragOut = Date.now();
  currentDisplayId = d.id;
  placeWindow(); lastPlatforms = '';
  send('arrive', { drop: { x: p.x - d.bounds.x, y: p.y - d.bounds.y } });
  writeLog(`Sudo auf Bildschirm ${screen.getAllDisplays().findIndex(x => x.id === d.id) + 1} gezogen`);
});
// Tray: Sudo direkt auf einen bestimmten Bildschirm schicken
function displayMenu() {
  const all = screen.getAllDisplays();
  if (all.length < 2) return [];
  const prim = screen.getPrimaryDisplay().id;
  return [{ label: T('Auf Bildschirm …'), submenu: all.map((d, i) => ({
    label: `${i + 1}: ${d.size.width}×${d.size.height}${d.id === prim ? ' ' + T('(Hauptbildschirm)') : ''}`, type: 'radio', checked: !!display && d.id === display.id,
    click: () => { if (display && d.id === display.id) return send('summon'); moveToDisplay(d, 'left'); }
  })) }];
}
// "Sudo rufen" holt ihn auf den Bildschirm mit dem Mauszeiger
function summon() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (display && d.id !== display.id) { currentDisplayId = d.id; placeWindow(); lastPlatforms = ''; sendNeighbors(); }
  send('summon');
}
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  display = chosenDisplay();
  const b = display.bounds;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height - 1 });
  send('layout', layoutInfo());
  sendNeighbors();
  if (tray) buildTrayMenu();
}

/* ---------- Plattformen aus echten Fenstern ---------- */
function subtract(segs, a, b) {
  const out = [];
  for (const [s, e] of segs) {
    if (b <= s || a >= e) { out.push([s, e]); continue; }
    if (a > s) out.push([s, a]);
    if (b < e) out.push([b, e]);
  }
  return out;
}
function toDip(r) {
  const rect = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  // screenToDipRect gibt es nur unter Windows; unter X11 sind die Koordinaten physisch → durch den Zoomfaktor teilen
  const f = display.scaleFactor || 1;
  const d = typeof screen.screenToDipRect === 'function' ? screen.screenToDipRect(null, rect)
    : { x: rect.x / f, y: rect.y / f, width: rect.width / f, height: rect.height / f };
  const b = display.bounds;
  return { l: d.x - b.x, t: d.y - b.y, r: d.x + d.width - b.x, btm: d.y + d.height - b.y };
}
function fakeWindows() {
  // Nur für Tests ohne Windows: zwei Beispiel-Fenster
  const { width: W, floor } = layoutInfo();
  return [
    { id: 'fake-a', exe: 'code.exe', rect: { left: W * 0.08, top: floor * 0.42, right: W * 0.5, bottom: floor * 0.85 } },
    { id: 'fake-b', exe: 'olk.exe', rect: { left: W * 0.4, top: floor * 0.2, right: W * 0.85, bottom: floor * 0.6 } }
  ];
}
function computePlatforms(list) {
  const { width: W, height: H, floor } = layoutInfo();
  const rects = list.map(w => ({ id: w.id, exe: w.exe || '', ...toDip(w.rect) }));
  const plats = [];
  rects.forEach((w, i) => {
    if (w.r < 0 || w.l > W || w.t <= 8 || w.t >= floor - 12 || w.btm > H + 400) return;
    let segs = [[Math.max(0, w.l), Math.min(W, w.r)]];
    for (let j = 0; j < i; j++) {
      const o = rects[j];
      if (o.t <= w.t + 1 && o.btm > w.t) segs = subtract(segs, o.l, o.r);
    }
    for (const [a, b] of segs) if (b - a >= 60) plats.push({ id: w.id, exe: w.exe, left: Math.round(a), right: Math.round(b), top: Math.round(w.t) });
  });
  return plats;
}
let pollTick = 0, platformsChangedAt = 0;
function poll() {
  if (!win || win.isDestroyed()) return;
  try {
    // Vollbild-Apps (Spiele, Präsentationen) nie verdecken
    const fg = win32.foreground();
    let full = false;
    if (fg && fg.id !== ownId) {
      const d = toDip(fg.rect), { width: W, height: H } = layoutInfo();
      full = d.l <= 0 && d.t <= 0 && d.r >= W && d.btm >= H;
    }
    if (full !== hiddenForFullscreen) {
      hiddenForFullscreen = full;
      if (full) win.hide(); else { win.showInactive(); setIgnore(true, true); }
    }
    if (hiddenForFullscreen || locked) return;
    checkMouse();
    // 1.9: Fensterliste nicht bei jedem Takt abfragen: nach einer Änderung 3 s lang jeden Takt,
    // danach nur jeden 3. Takt (Maus und Klicks bleiben trotzdem schnell, checkMouse läuft immer)
    pollTick++;
    if (Date.now() - platformsChangedAt > 3000 && pollTick % 3 !== 0) return;
    const list = win32.available() ? win32.listWindows(ownId) : (process.env.SUDO_FAKE === '1' ? fakeWindows() : []);
    const plats = computePlatforms(list);
    const key = JSON.stringify(plats);
    if (key !== lastPlatforms) { lastPlatforms = key; platformsChangedAt = Date.now(); send('platforms', plats); }
    // Ganz nach oben, falls z. B. die Taskleiste sich vorgedrängelt hat
    if (Math.random() < 0.02) win.setAlwaysOnTop(true, 'screen-saver');
  } catch (e) {
    console.error('[poll]', e.message);
  }
}

/* ---------- Globale Tastatur (nur Art der Taste, keine Inhalte) ---------- */
function startKeyboard() {
  try {
    const { uIOhook, UiohookKey: K } = require('uiohook-napi');
    const ignore = new Set([K.Ctrl, K.CtrlRight, K.Alt, K.AltRight, K.Shift, K.ShiftRight, K.Meta, K.MetaRight,
      K.CapsLock, K.Escape, K.ArrowLeft, K.ArrowRight, K.ArrowUp, K.ArrowDown, K.NumLock, K.ScrollLock].filter(v => v !== undefined));
    uIOhook.on('keydown', e => {
      if (hiddenForFullscreen) return;
      const mod = e.ctrlKey || e.metaKey;
      let k = null;
      if (mod) {
        if (e.keycode === K.S) k = 'save';
        else if (e.keycode === K.Z) k = 'undo';
        else if (e.keycode === K.C) k = 'copy';
        else if (e.keycode === K.V) k = 'paste';
      } else if (e.altKey) {
        k = null;
      } else if (e.keycode === K.Backspace) k = 'backspace';
      else if (!ignore.has(e.keycode)) k = 'char';
      if (k) send('key', { k });
    });
    uIOhook.start();
    hook = uIOhook;
  } catch (e) {
    console.error('[tastatur] uiohook nicht verfügbar:', e.message);
  }
}

/* ---------- Webhook: POST http://127.0.0.1:4711/event ---------- */
const EVENT_TYPES = new Set(['backup_failed', 'server_down', 'deploy_ok', 'ticket', 'bug', 'message', 'success', 'warning', 'video', 'music']);
function startServer() {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/status')) {
      return reply(200, { ok: true, name: 'Sudo', version: app.getVersion(), types: [...EVENT_TYPES] });
    }
    if (req.method === 'POST' && req.url.split('?')[0] === '/event') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 16384) req.destroy(); });
      req.on('end', () => {
        let data;
        try { data = JSON.parse(body || '{}'); } catch { return reply(400, { ok: false, error: 'Ungültiges JSON' }); }
        const clean = cleanEvent(data);
        if (!clean) return reply(400, { ok: false, error: 'Unbekannter type', erlaubt: [...EVENT_TYPES] });
        send('event', clean);
        writeLog(`webhook ${clean.type} ${JSON.stringify(clean)}`);
        reply(200, { ok: true });
      });
      return;
    }
    reply(404, { ok: false, error: 'Nicht gefunden' });
  });
  server.on('error', e => console.error('[webhook]', e.code === 'EADDRINUSE' ? `Port ${PORT} ist belegt` : e.message));
  server.listen(PORT, '127.0.0.1');
}

/* ---------- Relay: Ereignisse vom eigenen Webspace abholen ---------- */
const RELAY_MS = Number(process.env.SUDO_RELAY_MS) || 15000;
let relayTimer = null, relayWin = null, relayBusy = false;
let relayStatus = { state: 'off', text: 'aus' };

function cleanEvent(data) {
  if (!data || typeof data.type !== 'string' || !EVENT_TYPES.has(data.type)) return null;
  const clean = { type: data.type };
  for (const k of ['text', 'kunde', 'host', 'version', 'ticket', 'titel']) {
    if (data[k] != null && data[k] !== '') clean[k] = String(data[k]).slice(0, 120);
  }
  return clean;
}
function relayBase(url) { return String(url || '').trim().replace(/\/+(index\.php)?$/, '').replace(/\/+$/, ''); }
function setRelayStatus(state, text) {
  if (relayStatus.state === state && relayStatus.text === text) return;
  relayStatus = { state, text };
  if (TEST) console.log('[relay]', state, text);
  buildTrayMenu();
  if (relayWin && !relayWin.isDestroyed()) relayWin.webContents.send('relay-status', relayStatus);
}
async function relayFetch(url, token, since) {
  const res = await fetch(`${relayBase(url)}/poll.php?since=${since}`, {
    headers: { 'X-Sudo-Token': token, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (res.status === 401) throw new Error('Token ungültig');
  if (res.status === 404) throw new Error('poll.php nicht gefunden – Adresse prüfen');
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
async function relayPoll() {
  const r = settings.relay;
  if (!r.enabled || !r.url || !r.token) { setRelayStatus('off', 'aus'); return; }
  if (relayBusy || hiddenForFullscreen) return;
  relayBusy = true;
  try {
    const first = r.lastId == null;
    const data = await relayFetch(r.url, r.token, first ? -1 : r.lastId);
    if (first) {
      send('event', { type: 'message', text: 'Relay verbunden.\nIch höre mit.' });
      writeLog('relay verbunden');
    } else {
      const list = (data.events || []).map(cleanEvent).filter(Boolean);
      list.forEach(c => writeLog(`relay ${c.type} ${JSON.stringify(c)}`));
      if (list.length <= 3) {
        list.forEach((c, i) => setTimeout(() => send('event', c), i * 4500)); // nacheinander, damit jede Blase lesbar bleibt
      } else {
        // Nach längerer Pause nicht 50 Alarme hintereinander abspielen, sondern zusammenfassen
        const alarms = list.filter(c => c.type === 'backup_failed' || c.type === 'server_down').length;
        send('event', { type: alarms ? 'warning' : 'message',
          text: `${list.length} verpasste Meldungen${alarms ? `,\ndavon ${alarms} Alarm(e)` : ''}.\nDetails im Protokoll.` });
      }
    }
    if (Number.isInteger(data.lastId) && data.lastId !== r.lastId) { r.lastId = data.lastId; writeSettings(); }
    setRelayStatus('ok', 'verbunden');
  } catch (e) {
    setRelayStatus('error', e.name === 'TimeoutError' ? 'keine Antwort' : e.message.slice(0, 60));
  } finally {
    relayBusy = false;
  }
}
function startRelay() {
  clearInterval(relayTimer);
  relayTimer = setInterval(relayPoll, RELAY_MS);
  relayPoll();
}
function openRelayWindow() {
  if (relayWin && !relayWin.isDestroyed()) { relayWin.show(); relayWin.focus(); return; }
  relayWin = new BrowserWindow({
    width: 520, height: 560, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
    title: 'Sudo – Relay einrichten', backgroundColor: '#12161f', show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, nodeIntegration: false }
  });
  relayWin.setMenu(null);
  loadPage(relayWin, 'relay.html');
  relayWin.once('ready-to-show', () => relayWin.show());
  relayWin.on('closed', () => { relayWin = null; });
}
ipcMain.handle('relay-get', () => ({ url: settings.relay.url, token: settings.relay.token, enabled: settings.relay.enabled, status: relayStatus }));
ipcMain.handle('relay-test', async (_e, d) => {
  try {
    if (!/^https?:\/\//i.test(String(d && d.url))) return { ok: false, msg: 'Adresse muss mit https:// beginnen.' };
    const data = await relayFetch(d.url, String(d.token || ''), -1);
    return { ok: true, msg: `Verbindung steht. Bisher ${data.lastId} Ereignis(se) auf dem Relay.` };
  } catch (e) {
    return { ok: false, msg: e.name === 'TimeoutError' ? 'Keine Antwort vom Relay (Zeitüberschreitung).' : e.message };
  }
});
ipcMain.handle('relay-save', (_e, d) => {
  const url = relayBase(d && d.url), token = String((d && d.token) || '').trim(), enabled = !!(d && d.enabled);
  if (enabled && !/^https?:\/\//i.test(url)) return { ok: false, msg: 'Adresse muss mit https:// beginnen.' };
  if (enabled && token.length < 24) return { ok: false, msg: 'Der Lese-Token ist zu kurz.' };
  const changed = url !== settings.relay.url || token !== settings.relay.token;
  settings.relay = { url, token, enabled, lastId: changed ? null : settings.relay.lastId };
  saveSettings();
  startRelay();
  return { ok: true, msg: enabled ? 'Gespeichert. Sudo fragt das Relay alle 15 Sekunden ab.' : 'Gespeichert. Relay ist ausgeschaltet.' };
});

/* ---------- Programm im Vordergrund → Stichwort für Sudos Kommentare ----------
   Prozessname und Fenstertitel werden nur hier lokal mit der Liste verglichen.
   An das Overlay geht nur das Stichwort, gespeichert wird nichts. */
const APP_TAGS = [
  [/^(code|code - insiders|cursor|codium)\.exe$/, 'vscode'],
  [/^(phpstorm64|phpstorm|webstorm64|idea64)\.exe$/, 'jetbrains'],
  [/^(windowsterminal|powershell|pwsh|cmd|powershell_ise)\.exe$/, 'terminal'],
  [/^(outlook|olk)\.exe$/, 'outlook'],
  [/^(ms-teams|teams)\.exe$/, 'teams'],
  [/^excel\.exe$/, 'excel'],
  [/^winword\.exe$/, 'word'],
  [/^powerpnt\.exe$/, 'powerpoint'],
  [/^(onenote|onenoteim)\.exe$/, 'onenote'],
  [/^msaccess\.exe$/, 'access'],
  [/^visio\.exe$/, 'visio'],
  [/^winproj\.exe$/, 'project'],
  [/^pbidesktop\.exe$/, 'powerbi'],
  [/^(m365copilot|microsoft365copilot)\.exe$/, 'copilot'],
  [/^onedrive\.exe$/, 'onedrive'],
  [/^(mstsc|msrdc|msrdcw|windows365)\.exe$/, 'rdp'],
  [/^taskmgr\.exe$/, 'taskmgr'],
  [/^regedit\.exe$/, 'regedit'],
  [/^(filezilla|winscp)\.exe$/, 'ftp'],
  [/^(putty|kitty|mobaxterm)\.exe$/, 'ssh'],
  [/^(notepad|notepad\+\+)\.exe$/, 'notepad'],
  [/^steam(webhelper)?\.exe$/, 'steam'],
  [/^spotify\.exe$/, 'music'],
  [/^(mmc|servermanager)\.exe$/, 'mmc'],
  [/^(zoom|cpthost)\.exe$/, 'zoom'],
  [/^claude\.exe$/, 'claude']
];
// Für Browser und Store-Apps (ApplicationFrameHost): Erkennung über den Fenstertitel.
// Reihenfolge zählt: spezielle Admin-Center vor allgemeinen Treffern.
// Webseiten im Browser: nur der Fenstertitel wird lokal verglichen, nie gespeichert oder verschickt
const TITLE_TAGS = [
  [/youtube music/i, 'ytmusic'],
  [/(aws management console|amazon web services)/i, 'aws'],
  [/(netflix|prime video|disney\+|twitch|mediathek|joyn|vimeo|crunchyroll)/i, 'video'],
  [/(chatgpt|gemini|perplexity|mistral|le chat)/i, 'otherai'],
  [/(amazon\.|amazon\b|\bebay\b|kleinanzeigen|zalando|idealo|aliexpress|\btemu\b|mediamarkt|saturn\.de|alternate\.de|mindfactory|geizhals)/i, 'shop'],
  [/(spotify|deezer|soundcloud|apple music)/i, 'webmusic'],
  [/(heise|golem\.de|golem|tagesschau|spiegel|zeit online|faz\.net|t3n|borncity|bleepingcomputer|the verge|computerbase)/i, 'news'],
  [/(reddit|linkedin|instagram|facebook|mastodon|bluesky|threads)/i, 'social'],
  [/(google maps|openstreetmap|bing maps)/i, 'maps'],
  [/wikipedia/i, 'wiki'],
  [/exchange[ -]admin/i, 'exchangeadmin'],
  [/intune/i, 'intuneadmin'],
  [/entra/i, 'entraadmin'],
  [/defender/i, 'defender'],
  [/purview/i, 'purview'],
  [/teams admin/i, 'teamsadmin'],
  [/sharepoint admin/i, 'spadmin'],
  [/(microsoft 365 admin|admin center|admin-center|admin\.microsoft)/i, 'm365admin'],
  [/(microsoft azure|portal\.azure)/i, 'azure'],
  [/power automate/i, 'powerautomate'],
  [/power apps/i, 'powerapps'],
  [/power bi/i, 'powerbi'],
  [/microsoft to ?do/i, 'todo'],
  [/planner/i, 'planner'],
  [/microsoft loop/i, 'loop'],
  [/microsoft forms/i, 'forms'],
  [/bookings/i, 'bookings'],
  [/copilot/i, 'copilot'],
  [/sharepoint/i, 'sharepoint'],
  [/onedrive/i, 'onedrive'],
  [/microsoft teams/i, 'teams'],
  [/onenote/i, 'onenote'],
  [/outlook/i, 'outlook'],
  [/stack overflow/i, 'stackoverflow'],
  [/github/i, 'github'],
  [/youtube/i, 'youtube'],
  [/phpmyadmin/i, 'phpmyadmin'],
  [/claude/i, 'claude']
];
const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|applicationframehost|msedgewebview2)\.exe$/;
// Meeting-Fenster: Teams-Besprechung oder -Anruf, Zoom, Webex
const MEETING = [
  [/^(ms-teams|teams)\.exe$/, /(besprechung|meeting|anruf|call|live-?event|webinar)/i],
  [/^zoom\.exe$/, /(zoom[ -]meeting|zoom-besprechung)/i],
  [/^(webexhost|ciscocollabhost|atmgr)\.exe$/, /./]
];
let appTimer = null, lastAppTag = '';
function tagFor(fg) {
  if (!fg || !fg.exe) return '';
  for (const [re, tag] of APP_TAGS) if (re.test(fg.exe)) return tag;
  if (BROWSERS.test(fg.exe)) {
    for (const [re, tag] of TITLE_TAGS) if (re.test(fg.title || '')) return tag;
    return /^applicationframehost/.test(fg.exe) ? '' : 'browser';
  }
  return '';
}
const isMeeting = infos => infos.some(i => MEETING.some(([exe, title]) => exe.test(i.exe) && title.test(i.title || '')));
let inMeeting = false, meetingCheck = 0;
const APP_NAMES = {
  vscode: 'VS Code', jetbrains: 'PhpStorm', terminal: 'Terminal', outlook: 'Outlook', teams: 'Teams', excel: 'Excel',
  word: 'Word', powerpoint: 'PowerPoint', onenote: 'OneNote', access: 'Access', visio: 'Visio', project: 'Project',
  powerbi: 'Power BI', copilot: 'Copilot', onedrive: 'OneDrive', rdp: 'Remotedesktop', taskmgr: 'Task-Manager',
  regedit: 'Registry', ftp: 'FTP', ssh: 'SSH', notepad: 'Editor', steam: 'Steam', music: 'Spotify', mmc: 'MMC',
  zoom: 'Zoom', claude: 'Claude', exchangeadmin: 'Exchange-Admin', intuneadmin: 'Intune', entraadmin: 'Entra',
  defender: 'Defender', purview: 'Purview', teamsadmin: 'Teams-Admin', spadmin: 'SharePoint-Admin', m365admin: 'M365-Admin',
  azure: 'Azure', powerautomate: 'Power Automate', powerapps: 'Power Apps', todo: 'To Do', planner: 'Planner', loop: 'Loop',
  forms: 'Forms', bookings: 'Bookings', sharepoint: 'SharePoint', stackoverflow: 'Stack Overflow', github: 'GitHub',
  youtube: 'YouTube', phpmyadmin: 'phpMyAdmin', browser: 'Browser', ytmusic: 'YouTube Music', aws: 'AWS', video: 'Streaming',
  otherai: 'KI-Chat', shop: 'Online-Shop', webmusic: 'Musik', news: 'News', social: 'Social Media', maps: 'Karten', wiki: 'Wikipedia'
};
const prettyExe = exe => { const n = String(exe || '').replace(/\.exe$/i, ''); return n ? n[0].toUpperCase() + n.slice(1) : ''; };
const nameFor = (exe, tag) => APP_NAMES[tag] || prettyExe(exe);
let currentAppName = '', currentAppTag = '';
function appPoll() {
  if (!win32.available()) { currentAppName = TEST ? 'VS Code' : ''; return; }
  // Meeting-Erkennung alle 2 Sekunden
  if (settings.meetingQuiet && ++meetingCheck % 2 === 0) {
    try {
      const m = isMeeting(win32.windowInfos());
      if (m !== inMeeting) { inMeeting = m; send('meeting', m); writeLog(m ? 'Meeting erkannt' : 'Meeting beendet'); }
    } catch (e) { console.error('[meeting]', e.message); }
  }
  try {
    const fg = win32.foreground(true);
    if (!fg || fg.id === ownId) return;
    const tag = tagFor(fg);
    currentAppName = nameFor(fg.exe, tag); currentAppTag = tag;
    if (settings.appComments && !hiddenForFullscreen && tag !== lastAppTag) {
      lastAppTag = tag;
      // Fenster-Kennung und Mausposition (relativ zum Overlay), damit Sudo z. B. zum Video läuft und mitguckt
      let cursor = null;
      try { const c = screen.getCursorScreenPoint(), b = win.getBounds(); if (c.x >= b.x && c.x <= b.x + b.width) cursor = { x: c.x - b.x, y: c.y - b.y }; } catch { /* egal */ }
      send('app', { tag, win: fg.id, cursor, browser: BROWSERS.test(fg.exe) });
    }
  } catch (e) { console.error('[app]', e.message); }
}

/* ---------- Wohnort ---------- */
function homeLabel() {
  const h = settings.home;
  if (!h) return 'keiner';
  return h.type === 'floor' ? 'Taskleiste' : (h.name || prettyExe(h.exe));
}
ipcMain.on('home-set', (_e, h) => {
  if (h === null) settings.home = null;
  else if (h && h.type === 'floor') settings.home = { type: 'floor', x: Math.max(0, Math.min(1, Number(h.x) || 0.5)) };
  else if (h && h.type === 'window' && typeof h.exe === 'string' && h.exe) {
    const exe = h.exe.toLowerCase().slice(0, 80);
    settings.home = { type: 'window', exe, rel: Math.max(0, Math.min(1, Number(h.rel) || 0.5)), name: nameFor(exe, tagFor({ exe, title: '' })) };
  } else return;
  writeLog('Wohnort: ' + homeLabel());
  saveSettings();
});

/* ---------- Arbeitstag & Pausen ---------- */
let work = null, workTimer = null, workWin = null;
function openWorkWindow() {
  if (workWin && !workWin.isDestroyed()) { workWin.show(); workWin.focus(); return; }
  workWin = new BrowserWindow({
    width: 540, height: 790, minWidth: 480, minHeight: 500, resizable: true, minimizable: false, maximizable: false, autoHideMenuBar: true,
    title: 'Sudo – Arbeitstag & Pausen', backgroundColor: '#12161f', show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-work.js'), contextIsolation: true, nodeIntegration: false }
  });
  workWin.setMenu(null);
  loadPage(workWin, 'work.html');
  workWin.once('ready-to-show', () => workWin.show());
  workWin.on('closed', () => { workWin = null; });
}
ipcMain.handle('work-get', () => ({ work: settings.work, special: settings.special, summary: work ? work.summary() : null }));
ipcMain.handle('work-save', (_e, w) => {
  if (w && w.special) {
    const sp = w.special;
    settings.special = {
      birthday: /^\d{1,2}\.\d{1,2}\.?$/.test(String(sp.birthday || '').trim()) ? String(sp.birthday).trim().replace(/\.$/, '') : '',
      jubilee: /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(sp.jubilee || '').trim()) ? String(sp.jubilee).trim() : '',
      seasonal: sp.seasonal !== false
    };
  }
  settings.work = normalizeWork(w);
  saveSettings();
  return { ok: true, work: settings.work, msg: 'Gespeichert.' };
});
ipcMain.handle('work-summary', () => (work ? work.summary() : null));
ipcMain.handle('screentime-clear', () => { if (work) work.clearScreenTime(); return true; });

/* ---------- Statistik-Fenster ---------- */
let lastStats = null, statsWin = null;
function openStatsWindow() {
  if (statsWin && !statsWin.isDestroyed()) { statsWin.show(); statsWin.focus(); return; }
  statsWin = new BrowserWindow({
    width: 460, height: 700, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
    title: 'Sudo – Statistik', backgroundColor: '#12161f', show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-stats.js'), contextIsolation: true, nodeIntegration: false }
  });
  statsWin.setMenu(null);
  loadPage(statsWin, 'stats.html', TEST && process.env.SUDO_STATS_HASH ? { hash: process.env.SUDO_STATS_HASH } : {});
  statsWin.once('ready-to-show', () => statsWin.show());
  statsWin.on('closed', () => { statsWin = null; });
}
ipcMain.handle('stats-get', () => ({ stats: lastStats, icon: 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'icon.png')).toString('base64') }));

/* ---------- Werkzeugkasten (Strg+Alt+K) ---------- */
let toolsWin = null, quickWin = null, reminders = null, watch = null;
const SHORTCUTS = { tools: 'Control+Alt+K', quick: 'Control+Alt+N', ask: 'Control+Alt+S' };
const shortcutOk = {};
function smallWindow(file, preload, w, h, title) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bw = new BrowserWindow({
    width: w, height: h, x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + (d.height - h) / 3),
    minWidth: Math.min(w, 460), minHeight: 360, autoHideMenuBar: true, title, backgroundColor: '#12161f', show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, preload), contextIsolation: true, nodeIntegration: false }
  });
  bw.setMenu(null);
  loadPage(bw, file);
  bw.once('ready-to-show', () => { bw.show(); bw.focus(); });
  return bw;
}
function openTools(tool) {
  if (toolsWin && !toolsWin.isDestroyed()) { toolsWin.show(); toolsWin.focus(); if (tool) toolsWin.webContents.send('tools-show', tool); return; }
  toolsWin = smallWindow('tools.html', 'preload-tools.js', 720, 560, 'Sudo – Werkzeugkasten');
  if (tool) toolsWin.webContents.once('did-finish-load', () => toolsWin.webContents.send('tools-show', tool));
  toolsWin.on('closed', () => { toolsWin = null; });
}
ipcMain.on('tools-copy', (_e, text) => { clipboard.writeText(String(text).slice(0, 100000)); send('toolcopy'); });
ipcMain.handle('tools-md5', (_e, text) => crypto.createHash('md5').update(String(text), 'utf8').digest('hex'));

/* ---------- Erinnerungen & Notizen (Strg+Alt+N) ---------- */
function openQuick() {
  if (quickWin && !quickWin.isDestroyed()) { quickWin.show(); quickWin.focus(); return; }
  quickWin = smallWindow('quick.html', 'preload-quick.js', 560, 520, 'Sudo – Erinnerungen & Notizen');
  quickWin.on('closed', () => { quickWin = null; });
}
ipcMain.handle('quick-parse', (_e, text) => { const p = reminders.parse(text); return { when: p.when, text: p.text }; });
ipcMain.handle('quick-add', (_e, text) => { const r = reminders.add(text); if (r.ok) send('noted', { reminder: !!r.item.at, msg: r.msg }); return { ok: r.ok, msg: r.msg }; });
ipcMain.handle('quick-remove', (_e, id) => { reminders.remove(id); return true; });
ipcMain.handle('quick-list', () => reminders.list());
ipcMain.on('reminder-snooze', (_e, id) => reminders && reminders.snooze(Number(id), 10));
function deliverReminder(r) {
  send('reminder', r);
  writeLog('Erinnerung fällig');
  if (settings.notify && Notification.isSupported()) {
    try {
      const n = new Notification({ title: T(r.late ? 'Sudo: verpasste Erinnerung' : 'Sudo erinnert dich'), body: r.text, silent: inMeeting, icon: path.join(__dirname, 'assets', 'icon.png') });
      n.on('click', openQuick); n.show();
    } catch (e) { writeLog('Benachrichtigung: ' + e.message); }
  }
}
function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutOk.tools = globalShortcut.register(SHORTCUTS.tools, () => openTools());
  shortcutOk.quick = globalShortcut.register(SHORTCUTS.quick, openQuick);
  shortcutOk.ask = globalShortcut.register(SHORTCUTS.ask, () => openAsk());
  for (const [k, ok] of Object.entries(shortcutOk)) if (!ok) writeLog(`Tastenkürzel ${SHORTCUTS[k]} ist schon belegt`);
}

/* ---------- Garderobe ---------- */
const { ITEMS } = require('./renderer/progress.js');
let wardrobeWin = null;
function openWardrobe() {
  if (wardrobeWin && !wardrobeWin.isDestroyed()) { wardrobeWin.show(); wardrobeWin.focus(); return; }
  wardrobeWin = smallWindow('wardrobe.html', 'preload-wardrobe.js', 680, 800, 'Sudo – Garderobe');
  wardrobeWin.on('closed', () => { wardrobeWin = null; });
}
function setOutfit(o) {
  const ok = id => id === null || (typeof id === 'string' && ITEMS[id]);
  const next = { hat: ok(o && o.hat) ? o.hat : null, face: ok(o && o.face) ? o.face : null, neck: ok(o && o.neck) ? o.neck : null };
  settings.outfit = next; saveSettings();
  if (wardrobeWin && !wardrobeWin.isDestroyed()) wardrobeWin.webContents.send('wardrobe-update', { outfit: next, stats: lastStats });
}
ipcMain.on('outfit-set', (_e, o) => setOutfit(o));
ipcMain.handle('wardrobe-get', () => ({ sheet: loadSheet(), stats: lastStats, outfit: settings.outfit, special: settings.special }));
ipcMain.handle('wardrobe-set', (_e, o) => { setOutfit(o); return settings.outfit; });

/* ---------- Tray ---------- */
/* ---------- IT-Lage: Microsoft-/Azure-Status, Datenlecks ---------- */
let intel = null, lageWin = null;
function openLage(tab) {
  if (lageWin && !lageWin.isDestroyed()) { lageWin.show(); lageWin.focus(); if (tab) lageWin.webContents.send('lage-tab', tab); return; }
  lageWin = smallWindow('lage.html', 'preload-lage.js', 760, 660, 'Sudo – IT-Lage');
  if (tab) lageWin.webContents.once('did-finish-load', () => lageWin.webContents.send('lage-tab', tab));
  lageWin.on('closed', () => { lageWin = null; });
}
const safeLink = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
// Feste Windows-Seiten, die Sudo öffnen darf (Gerätezustand)
const WIN_LINKS = new Set(['ms-settings:windowsupdate', 'ms-settings:windowsupdate-action', 'windowsdefender://threat', 'windowsdefender://network', 'ms-settings:storagesense', 'control /name Microsoft.BitLockerDriveEncryption',
  // 1.10: Langsam-Analyse, Meeting-Check, Sperr-Erinnerung
  'ms-settings:startupapps', 'ms-settings:sound', 'ms-settings:privacy-microphone', 'ms-settings:privacy-webcam', 'ms-settings:signinoptions-dynamiclock']);
function openLink(u) {
  if (String(u) === 'sudo:ask') return openAsk();
  if (String(u) === 'sudo:quiz') return openQuiz();
  if (String(u) === 'sudo:hinweise') return openHinweise();
  if (String(u) === 'sudo:verlauf') return openHistory();
  if (String(u) === 'sudo:meet') return openMeet();
  if (String(u) === 'sudo:stimmung') return openPulse();
  if (String(u) === 'sudo:start') return openStart();
  if (String(u) === 'sudo:taskmgr') { execFile('taskmgr.exe', [], { windowsHide: false }, () => {}); return; }
  { const k = String(u).match(/^sudo:wissen(?:\?q=(.*))?$/); if (k) return openKb(k[1] ? decodeURIComponent(k[1]) : ''); }
  const sh = String(u).match(/^sudo:hilfe(?:\/(\w+))?$/);
  if (sh) return openSelfHelp(sh[1]);
  if (/^(mailto:[^\s@]+@[^\s@]+|tel:\+?[\d ()/-]{3,30})$/i.test(String(u))) { shell.openExternal(String(u)); return; }
  if (WIN_LINKS.has(String(u))) { if (String(u).startsWith('control ')) execFile('control.exe', ['/name', 'Microsoft.BitLockerDriveEncryption'], { windowsHide: false }, () => {}); else shell.openExternal(String(u)); return; }
  const m = String(u).match(/^sudo:lage(?:\/(\w+))?$/);
  if (m) return openLage(m[1]);
  const l = safeLink(u); if (l) shell.openExternal(l);
}
ipcMain.on('open-link', (_e, u) => openLink(u));
ipcMain.handle('lage-get', () => intel ? intel.snapshot() : null);
// Gerätezustand (1.5)
let health = null;
ipcMain.handle('health-get', () => health ? health.snapshot() : null);
ipcMain.handle('health-check', async () => (health ? health.check(true) : null));
ipcMain.handle('lage-refresh', async () => { if (intel) await intel.tick(true); return intel ? intel.snapshot() : null; });
ipcMain.handle('lage-mails', async () => (intel ? intel.checkMails(true) : { ok: false }));
ipcMain.handle('lage-password', async (_e, pw) => (intel ? intel.checkPassword(String(pw || '').slice(0, 256)) : { ok: false }));
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
ipcMain.handle('lage-config', (_e, c = {}) => {
  const i = { ...settings.intel };
  for (const k of ['m365', 'azure', 'breaches']) if (k in c) i[k] = !!c[k];
  if ('breachMin' in c) i.breachMin = Math.max(0, Math.min(1e9, Number(c.breachMin) || 0));
  if ('emails' in c) i.emails = [...new Set((Array.isArray(c.emails) ? c.emails : []).map(m => String(m).trim().toLowerCase()).filter(m => MAIL_RE.test(m)))].slice(0, 10);
  let feedsTouched = false;
  if ('feedMin' in c && ['kritisch', 'hoch', 'mittel', 'alle'].includes(c.feedMin)) i.feedMin = c.feedMin;
  if ('feedNewOnly' in c) i.feedNewOnly = !!c.feedNewOnly;
  if ('feedWords' in c) i.feedWords = String(c.feedWords || '').slice(0, 300);
  if ('feedSec' in c) i.feedSec = Math.max(5, Math.min(10, Number(c.feedSec) || 8));
  if (c.feedToggle) { i.feeds = i.feeds.map(f => f.id === c.feedToggle.id ? { ...f, on: !!c.feedToggle.on } : f); feedsTouched = true; }
  if (c.feedRemove && !PRESET_FEEDS.includes(c.feedRemove)) { i.feeds = i.feeds.filter(f => f.id !== c.feedRemove); feedsTouched = true; }
  if (c.feedAdd) {
    const url = safeLink(c.feedAdd.url);
    if (!url) return { ok: false, msg: 'Adresse muss mit https:// beginnen.' };
    if (i.feeds.some(f => f.url === url)) return { ok: false, msg: 'Diesen Feed gibt es schon.' };
    if (i.feeds.length >= PRESET_FEEDS.length + 8) return { ok: false, msg: 'Höchstens 8 eigene Feeds.' };
    const name = String(c.feedAdd.name || '').trim().slice(0, 60) || new URL(url).hostname;
    i.feeds = [...i.feeds, { id: 'f' + crypto.randomBytes(4).toString('hex'), name, url, on: true }];
    feedsTouched = true;
  }
  if ('hibpKey' in c) { const k = String(c.hibpKey || '').trim(); if (!k || /^[0-9a-f]{32}$/i.test(k)) i.hibpKey = k; else return { ok: false, msg: 'Der Schlüssel besteht aus 32 Zeichen (0–9, a–f).' }; }
  settings.intel = i; saveSettings();
  if (feedsTouched && intel) intel.feedsChanged().catch(e => writeLog('Feeds: ' + e.message));
  return { ok: true, snap: intel ? intel.snapshot() : null, emails: i.emails };
});
ipcMain.handle('lage-emails', () => settings.intel.emails || []);

/* ---------- Frag Sudo (Claude) ---------- */
let ask = null, askWin = null;
// Schlüssel verschlüsselt über Windows (DPAPI via safeStorage); ohne Verschlüsselung (z. B. Linux-Test) im Klartext markiert
function secretEnc(plain) {
  const k = String(plain || '');
  if (!k) return { data: '', plain: false };
  return safeStorage.isEncryptionAvailable() ? { data: safeStorage.encryptString(k).toString('base64'), plain: false } : { data: Buffer.from(k).toString('base64'), plain: true };
}
function secretDec(data, plain) {
  if (!data) return '';
  try { return plain ? Buffer.from(data, 'base64').toString() : safeStorage.decryptString(Buffer.from(data, 'base64')); }
  catch (e) { writeLog('Geheimnis nicht lesbar (anderer PC/Benutzer?): ' + e.message); return ''; }
}
function setAiKey(plain) { const e = secretEnc(String(plain || '').trim()); settings.ai = { ...settings.ai, keyEnc: e.data, keyPlain: e.plain }; }
const getAiKey = () => secretDec((settings.ai || {}).keyEnc, (settings.ai || {}).keyPlain);

/* ---------- Sudo-Zentrale ---------- */
let zentraleApi = null;
const ZENTRALE_NOTIFY = { message: 'Mitteilung', warning: 'Warnung', server_down: 'Server antwortet nicht', backup_failed: 'Backup fehlgeschlagen', video: 'Neues Video' };
function zentraleEvent(ev) {
  // Besuche gehen direkt ans Overlay (keine Windows-Benachrichtigung)
  if (ev.type === 'visit') { writeLog(`Besuch von ${ev.from}: ${ev.kind}`); return send('visit', ev); }
  if (ev.type === 'visit_result') { writeLog(`Besuch bei ${ev.to}: ${ev.result}`); return send('visit_result', ev); }
  // 1.8: neue YouTube-Videos – jeder kann sie für sich abschalten
  if (ev.type === 'video' && settings.media && settings.media.videos === false) { writeLog('YouTube-Video ausgeblendet: ' + String(ev.titel || '').slice(0, 60)); return; }
  // 1.8.1: Video schon über einen eigenen Kanal gezeigt? Dann nicht doppelt
  if (ev.type === 'video' && !ev.own && youtube) { if (youtube.seen(ev.video)) { writeLog('YouTube-Video schon gezeigt: ' + String(ev.titel || '').slice(0, 60)); return; } youtube.markSeen(ev.video); }
  if (ev.type === 'quiz') { writeLog('Zentrale bietet Quizfrage an: ' + ev.q); if (quiz) quiz.push(String(ev.q || '')); return; }
  writeLog(`${ev.own ? 'YouTube (eigener Kanal)' : 'Zentrale'}: ${ev.type}${ev.text ? ' – ' + String(ev.text).slice(0, 80) : ''}${ev.own ? ' – ' + String(ev.titel || '').slice(0, 60) : ''}`);
  send('event', { ...ev, via: ev.own ? 'youtube' : 'zentrale' });
  // Wichtige Firmen-Meldungen zusätzlich als Windows-Benachrichtigung (falls die Blase verpasst wird)
  if (settings.notify && ZENTRALE_NOTIFY[ev.type] && Notification.isSupported() && !TEST) {
    const body = ev.type === 'video' ? `${ev.kanal || ''}: ${ev.titel || ''}` : (ev.text || ev.host || ev.kunde || '');
    const n = new Notification({ title: (ev.own ? 'Sudo' : T('Sudo-Zentrale')) + ': ' + T(ZENTRALE_NOTIFY[ev.type]), body: String(body).slice(0, 200), silent: inMeeting, icon: path.join(__dirname, 'assets', 'icon.png') });
    if (ev.link) n.on('click', () => openLink(ev.link));
    n.show();
  }
}
// Hintergrund für Claude: Uhrzeit und IT-Lage – keine Tasten, keine Fenstertitel
function askContext() {
  const lines = [`Jetzt: ${new Date().toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`];
  if (intel) {
    const v = intel.view;
    const bad = (v.m365.items || []).filter(s => !s.ok).map(s => `${s.name} (${s.status})`);
    lines.push(bad.length ? `Microsoft-365-Störungen (öffentlich): ${bad.join(', ')}` : 'Microsoft 365 (öffentlich): keine bekannten Störungen');
    if ((v.azure.items || []).length) lines.push('Azure-Störungen: ' + v.azure.items.slice(0, 3).map(i => i.title).join(' | '));
    const crit = ((v.feeds && v.feeds.items) || []).filter(i => i.sev === 'kritisch' || i.sev === 'hoch').slice(0, 4);
    if (crit.length) lines.push('Neueste Sicherheitswarnungen: ' + crit.map(i => `[${i.sev}] ${i.title}`).join(' | '));
  }
  return lines.join('\n');
}
function openAsk() {
  if (askWin && !askWin.isDestroyed()) { askWin.show(); askWin.focus(); return; }
  askWin = smallWindow('ask.html', 'preload-ask.js', 560, 660, 'Sudo – Frag Sudo');
  askWin.on('closed', () => { askWin = null; });
}
function askEmit(kind, data) {
  if (askWin && !askWin.isDestroyed()) askWin.webContents.send('ask-event', { kind, ...data });
  if (kind === 'start' || kind === 'end') send('ask', { kind, ok: data.ok, text: data.text, msg: data.msg, windowOpen: !!(askWin && !askWin.isDestroyed() && askWin.isVisible()) });
}
ipcMain.handle('ask-status', () => (ask ? ask.status() : null));
ipcMain.handle('ask-send', (_e, q, model) => (ask ? ask.ask(q, { model }) : { ok: false }));
ipcMain.on('ask-cancel', () => ask && ask.cancel());
ipcMain.handle('ask-reset', () => { if (ask) ask.reset(); return true; });
ipcMain.handle('ask-history', () => (ask ? ask.history() : []));
ipcMain.handle('ai-config', (_e, c = {}) => aiConfig(c));
function aiConfig(c) {
  const a = { ...settings.ai };
  if ('mode' in c && ['off', 'key', 'zentrale'].includes(c.mode)) a.mode = c.mode;
  if ('model' in c && ['haiku', 'sonnet'].includes(c.model)) a.model = c.model;
  if ('dailyUsd' in c) a.dailyUsd = Math.max(0, Math.min(50, Number(c.dailyUsd) || 0));
  if ('context' in c) a.context = !!c.context;
  settings.ai = a;
  if ('key' in c) {
    const k = String(c.key || '').trim();
    if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) return { ok: false, msg: 'Das sieht nicht wie ein Claude-API-Schlüssel aus (beginnt mit sk-ant-).' };
    setAiKey(k);
  }
  saveSettings();
  return { ok: true, status: ask ? ask.status() : null };
}

/* ---------- Besuche: Sudo zu Kollegen schicken (1.4) ---------- */
let visitWin = null;
function openVisit() {
  if (visitWin && !visitWin.isDestroyed()) { visitWin.show(); visitWin.focus(); return; }
  visitWin = smallWindow('visit.html', 'preload-visit.js', 520, 640, 'Sudo – Auf Besuch schicken');
  visitWin.on('closed', () => { visitWin = null; });
}
ipcMain.handle('visit-peers', async () => {
  if (!zentraleApi || !zentraleApi.status().enrolled) return { ok: false, msg: 'Besuche gehen über die Sudo-Zentrale. Sudo ist noch nicht angemeldet (Einstellungen → Daten & Verbindungen).' };
  return zentraleApi.peers();
});
ipcMain.handle('visit-send', async (_e, v = {}) => {
  if (!zentraleApi) return { ok: false };
  const st = lastStats || {};
  const rank = Array.isArray(st.ranks) ? Math.max(0, st.ranks.findIndex(r => r.n === st.rank)) : 0;
  const r = await zentraleApi.visit({ to: String(v.to || ''), kind: String(v.kind || ''), note: String(v.note || '').slice(0, 60), color: st.rankColor || '#eef1f5', rank });
  if (r.ok) send('visit_sent', { to: r.to, kind: v.kind });
  return r;
});
ipcMain.on('visit-done', (_e, d = {}) => { if (zentraleApi && Number.isInteger(d.id)) zentraleApi.visitResult(d.id, String(d.result || 'done')); });

function simulate(type, extra = {}) { send('event', { type, ...extra }); }
// 1.8: Pixel-Icons vor den Menüpunkten (assets/menu, 16 px + @2x) und „&“ korrekt anzeigen
const menuIcons = {};
function mIcon(name) {
  if (!(name in menuIcons)) {
    try { const im = nativeImage.createFromPath(path.join(__dirname, 'assets', 'menu', name + '.png')); menuIcons[name] = im.isEmpty() ? null : im; }
    catch { menuIcons[name] = null; }
  }
  return menuIcons[name] || undefined;
}
// Unter Windows ist „&“ im Menü ein Kürzelzeichen und verschwindet – darum verdoppeln
const ML = (text) => T(text).replace(/&/g, '&&');
function buildTrayMenu() {
  if (!tray) return;
  const enrolled = !!(zentraleApi && zentraleApi.status().enrolled);
  const music = enrolled && zentraleApi.musicConfig && zentraleApi.musicConfig();
  const menu = Menu.buildFromTemplate([
    { label: ML('Sudo rufen'), icon: mIcon('summon'), click: summon },
    ...displayMenu().map(m => ({ ...m, label: ML(m.label), icon: mIcon('screen') })),
    { type: 'separator' },
    { label: ML('Erinnerung / Notiz …'), icon: mIcon('note'), accelerator: shortcutOk.quick ? 'Control+Alt+N' : undefined, registerAccelerator: false, click: openQuick },
    { label: ML('Frag Sudo …'), icon: mIcon('ask'), accelerator: shortcutOk.ask ? 'Control+Alt+S' : undefined, registerAccelerator: false, click: () => openAsk() },
    { label: ML('Werkzeugkasten …'), icon: mIcon('tools'), accelerator: shortcutOk.tools ? 'Control+Alt+K' : undefined, registerAccelerator: false, click: () => openTools() },
    { label: ML('Selbsthilfe …'), icon: mIcon('help'), click: () => openSelfHelp() },
    { label: ML('Meeting-Check: Ton & Bild …'), icon: mIcon('help'), click: openMeet },
    ...(zentraleApi && zentraleApi.kbOn() ? [{ label: ML('Anleitungen …'), icon: mIcon('book'), click: () => openKb() }] : []),
    { label: historyUnseen() ? ML('Was hat Sudo gesagt? ({n} im Meeting verpasst) …').replace('{n}', historyUnseen()) : ML('Was hat Sudo gesagt? …'), icon: mIcon('history'), click: openHistory },
    { type: 'separator' },
    { label: ML('IT-Lage …'), icon: mIcon('lage'), click: () => openLage() },
    ...(enrolled ? [{ label: ops && ops.openCount() ? ML('Hinweise deiner IT ({n}) …').replace('{n}', ops.openCount()) : ML('Hinweise deiner IT …'), icon: mIcon('bell'), click: openHinweise }] : []),
    ...(enrolled && checkin && checkin.questions().length ? [{ label: ML('Kurze Frage deiner IT …'), icon: mIcon('bell'), click: openPulse }] : []),
    ...(enrolled && checkin && checkin.view() ? (() => { const v = checkin.view(); return [{ label: ML('Start-Checkliste ({d}/{t}) …').replace('{d}', v.done).replace('{t}', v.total), icon: mIcon('note'), click: openStart }]; })() : []),
    { label: ML('Security-Quiz …'), icon: mIcon('quiz'), click: () => openQuiz() },
    { type: 'separator' },
    { label: ML('Auf Besuch schicken …'), icon: mIcon('visit'), enabled: enrolled, click: openVisit },
    ...(music && music.enabled ? [{ label: ML('Musikwunsch …'), icon: mIcon('music'), click: () => openMusic() }] : []),
    { label: ML('Garderobe …'), icon: mIcon('wardrobe'), click: openWardrobe },
    { label: ML('Skin'), icon: mIcon('skin'), submenu: [
      ...skinList().map(s => ({ label: ML(s.kind === 'user' ? s.name : T(s.name)), type: 'radio', checked: s.id === currentSkin(), click: () => setSkin(s.id) })),
      { type: 'separator' },
      { label: ML('Eigene Skins (Ordner öffnen) …'), click: openSkinFolder }] },
    { label: ML('Spielen'), icon: mIcon('play'), submenu: [
      { label: ML(settings.toy ? 'Ball wegnehmen' : 'Ball geben'), click: () => { settings.toy = !settings.toy; saveSettings(); send('toy', settings.toy); } },
      { label: ML('Pausenspiel: Bug-Jagd (30 Sek.)'), click: () => send('game') }
    ] },
    { type: 'separator' },
    { label: ML('Statistik …'), icon: mIcon('stats'), click: openStatsWindow },
    { label: ML('Arbeitstag & Pausen …'), icon: mIcon('work'), click: openWorkWindow },
    { label: ML(`Wohnort: ${homeLabel()}`), icon: mIcon('home'), submenu: [
      { label: ML('Hier wohnen (aktueller Platz)'), click: () => send('sethome') },
      { label: ML('Nach Hause schicken'), enabled: !!settings.home, click: () => send('gohome') },
      { label: ML('Wohnort löschen'), enabled: !!settings.home, click: () => { settings.home = null; writeLog('Wohnort gelöscht'); saveSettings(); } }
    ] },
    { type: 'separator' },
    { label: ML('Einstellungen …'), icon: mIcon('gear'), click: () => openSettings() },
    { label: ML('Was weiß Sudo über mich?'), icon: mIcon('privacy'), click: openPrivacy },
    { label: ML('Über Sudo …'), icon: mIcon('info'), click: () => openSettings('info') },
    ...(update.state === 'ready' ? [{ label: ML(`Update ${update.version} installieren & neu starten`), icon: mIcon('update'), click: installUpdate }] : []),
    { type: 'separator' },
    { label: ML('Sudo neu laden (falls er nicht reagiert)'), icon: mIcon('reload'), click: recreateOverlay },
    { label: ML('Beenden'), icon: mIcon('quit'), click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(T(trayTip));
}

/* ---------- Einstellungs-Zentrale ---------- */
let settingsWin = null;
function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.focus();
    if (tab) settingsWin.webContents.send('settings-tab', tab);
    return;
  }
  settingsWin = smallWindow('settings.html', 'preload-settings-center.js', 760, 640, 'Sudo – Einstellungen');
  if (tab) settingsWin.webContents.once('did-finish-load', () => settingsWin.webContents.send('settings-tab', tab));
  settingsWin.on('closed', () => { settingsWin = null; });
}
function setAutostart(on) {
  settings.autostart = !!on;
  if (process.platform === 'linux') return linuxAutostart(!!on);
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath }); } catch (e) { writeLog('Autostart: ' + e.message); }
}
// Linux (1.12): Electron kennt dort keinen Autostart → .desktop-Datei nach XDG unter ~/.config/autostart
function linuxAutostart(on) {
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
  const file = path.join(dir, 'sudo-desktop.desktop');
  try {
    if (!on) { fs.rmSync(file, { force: true }); return; }
    const exe = process.env.APPIMAGE || process.execPath;      // AppImage: Pfad der .AppImage-Datei, nicht des entpackten Ordners
    const q = s => '"' + String(s).replace(/(["`$\\])/g, '\\$1') + '"';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, ['[Desktop Entry]', 'Type=Application', 'Name=Sudo', 'Comment=Sudo – Desktop-Ninja',
      'Exec=' + q(exe) + (exe === process.execPath && !app.isPackaged ? ' ' + q(app.getAppPath()) : ''),
      'Icon=sudo-desktop', 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n'));
  } catch (e) { writeLog('Autostart: ' + e.message); }
}
const bool = v => !!v;
const SETTERS = {
  sound: v => { settings.sound = bool(v); },
  bugs: v => { settings.bugs = bool(v); },
  size: v => { if (['klein', 'normal', 'gross'].includes(v)) settings.size = v; },
  appComments: v => { settings.appComments = bool(v); lastAppTag = ''; },
  meetingQuiet: v => { settings.meetingQuiet = bool(v); if (!v && inMeeting) { inMeeting = false; send('meeting', false); } },
  hideFromCapture: v => { settings.hideFromCapture = bool(v); applyCapture(); },
  notify: v => { settings.notify = bool(v); },
  autostart: v => setAutostart(v),
  displayId: v => { if (screen.getAllDisplays().some(d => String(d.id) === String(v))) { settings.displayId = v; currentDisplayId = v; placeWindow(); lastPlatforms = ''; send('summon'); } },
  roam: v => { settings.roam = bool(v); sendNeighbors(); },
  eco: v => { if (['auto', 'on', 'off'].includes(v)) { settings.eco = v; applyEco(); } },
  autoUpdate: v => { settings.autoUpdate = bool(v); },
  seasonal: v => { settings.special = { ...settings.special, seasonal: bool(v) }; },
  toy: v => { settings.toy = bool(v); send('toy', settings.toy); },
  lang: v => setLanguage(v),
  mediaVideos: v => { settings.media = { ...settings.media, videos: bool(v) }; },
  visitsAllow: v => { settings.visits = { ...settings.visits, allow: bool(v) }; if (zentraleApi) zentraleApi.prefsChanged(); },
  contrastMode: v => { if (['auto', 'always', 'off'].includes(v)) settings.contrast = { ...settings.contrast, mode: v }; },
  contrastStyle: v => { if (['outline', 'glow'].includes(v)) settings.contrast = { ...settings.contrast, style: v }; },
  // 1.5: Sprechblase – Schrift, Größe, Anzeigedauer
  bubbleFont: v => { if (['pixel', 'clear'].includes(v)) settings.bubble = { ...settings.bubble, font: v }; },
  bubbleSize: v => { if (['normal', 'large'].includes(v)) settings.bubble = { ...settings.bubble, size: v }; },
  bubbleTime: v => { if (['normal', 'long', 'xlong', 'click'].includes(v)) settings.bubble = { ...settings.bubble, time: v }; },
  contrastColor: v => { if (['white', 'teal', 'gold', 'rank'].includes(v)) settings.contrast = { ...settings.contrast, color: v }; },
  deckOn: v => { settings.deck = normalizeDeck({ ...settings.deck, on: bool(v) }); },
  deckBuiltin: v => { if (v && DECK_BUILTIN[v.id]) { const l = settings.deck.builtin.filter(x => x !== v.id); if (v.on) l.push(v.id); settings.deck = normalizeDeck({ ...settings.deck, builtin: l }); } },
  deckAdd: v => { const c = cleanCustom(v); if (c && settings.deck.custom.length < MAX_CUSTOM) settings.deck = normalizeDeck({ ...settings.deck, custom: [...settings.deck.custom, c] }); },
  deckDel: v => { settings.deck = normalizeDeck({ ...settings.deck, custom: settings.deck.custom.filter(c => c.id !== v) }); },
  quizOn: v => { settings.quiz = { ...settings.quiz, on: bool(v) }; },
  quizPerWeek: v => { const n = Number(v); if ([1, 2, 3, 5].includes(n)) settings.quiz = { ...settings.quiz, perWeek: n }; },
  visitName: v => { settings.visits = { ...settings.visits, name: String(v || '').trim().slice(0, 30) }; if (zentraleApi) zentraleApi.prefsChanged(); },
  // 1.10: Sperr-Erinnerung und Tipps
  lockHint: v => { settings.habits = { ...settings.habits, lockHint: bool(v) }; },
  tipsFreq: v => { if (['off', 'rare', 'normal'].includes(v)) settings.habits = { ...settings.habits, tips: v }; },
  // 1.11: Aufbewahrungsdauer des Verlaufs
  historyDays: v => setHistoryDays(v)
};
for (const k of Object.keys(WATCH_DEFAULTS)) SETTERS['watch.' + k] = v => { settings.watch = { ...settings.watch, [k]: bool(v) }; };

function settingsSnapshot() {
  const prim = screen.getPrimaryDisplay().id;
  return {
    diag: diag.view(),
    settings: { ...publicSettings(), meetingQuiet: settings.meetingQuiet, hideFromCapture: settings.hideFromCapture, notify: settings.notify,
      autostart: settings.autostart, displayId: settings.displayId, roam: settings.roam, eco: settings.eco, autoUpdate: settings.autoUpdate, lang: settings.lang, visits: settings.visits, media: mediaView(), quiz: quiz ? { ...quiz.config(), ...quiz.stats() } : { on: true, perWeek: 2 }, contrast: settings.contrast, bubble: settings.bubble, deck: settings.deck, deckBuiltin: Object.entries(DECK_BUILTIN).map(([id, b]) => ({ id, name: b.name, admin: !!b.admin })), darkTheme: darkTheme(), visitNameDefault: os.userInfo().username,
      habits: { lockHint: settings.habits.lockHint !== false, tips: settings.habits.tips || 'normal', tipsManaged: tipsBlocked() }, history: { days: historyDays(), n: historyLoad().length } },
    langEff: effLang(),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Bildschirm ${i + 1}${d.id === prim ? ' (Haupt)' : ''} · ${d.size.width} × ${d.size.height}` })),
    relay: relayStatus, home: homeLabel(), shortcuts: { ...shortcutOk }, skin: skinStatus(), ai: ask ? ask.status() : null, zentrale: zentraleApi ? zentraleApi.status() : null,
    info: aboutInfo(), update: { ...update, canUpdate: canAutoUpdate() }, eco: ecoActive, battery: powerMonitor.isOnBatteryPower()
  };
}
function mediaView() { const m = settings.media || {}; return { videos: m.videos !== false, max: youtube ? youtube.max : 10, channels: (m.channels || []).map(c => ({ id: c.id, title: c.title, handle: c.handle, shorts: !!c.shorts, checked: c.checked || 0, error: c.error || '' })) }; }
ipcMain.handle('center-get', () => settingsSnapshot());
ipcMain.handle('center-set', (_e, key, value) => {
  const fn = SETTERS[key];
  if (!fn) return { ok: false };
  fn(value); saveSettings();
  return { ok: true, snap: settingsSnapshot() };
});
const SIM = {
  backup_failed: { kunde: 'Muster GmbH' }, server_down: { host: 'web01' }, deploy_ok: { version: 'v2.4.1' },
  ticket: { ticket: '4711', titel: 'Drucker druckt nicht' }, bug: {}
};
ipcMain.handle('center-action', async (_e, action, arg) => {
  switch (action) {
    case 'work': openWorkWindow(); break;
    case 'relay': openRelayWindow(); break;
    case 'lage': openLage(arg); break;
    case 'ask': openAsk(); break;
    case 'aiSettings': openSettings('ai'); break;
    case 'visit': openVisit(); break;
    case 'privacy': openPrivacy(); break;
    case 'quiz': openQuiz(); break;
    case 'meet': openMeet(); break;
    case 'openHistory': openHistory(); break;
    case 'tipTest': if (habits) habits.tipNow(currentAppTag || 'excel'); break;
    case 'deckPick': {
      const r = await dialog.showOpenDialog(settingsWin || undefined, { title: T('Programm oder Datei wählen'), properties: ['openFile'],
        filters: [{ name: T('Programme & Verknüpfungen'), extensions: ['exe', 'lnk', 'bat', 'cmd', 'ps1', 'msc'] }, { name: T('Alle Dateien'), extensions: ['*'] }] });
      return r.canceled || !r.filePaths[0] ? { ok: false } : { ok: true, path: r.filePaths[0] };
    }
    case 'aiConfig': return aiConfig(arg || {});
    case 'diagMeasure': { diag.measure(); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-diag'); return { ok: true, msg: T('Gemessen.') }; }
    // 1.8.1: eigene YouTube-Kanäle
    case 'ytAdd': { const r = youtube ? await youtube.add(String((arg || '')).slice(0, 200)) : { ok: false, msg: 'Nicht bereit.' }; return r.ok ? { ok: true, msg: r.latest ? T('Hinzugefügt. Neuestes Video: {x}').replace('{x}', r.latest) : T('Hinzugefügt.'), media: mediaView() } : { ok: false, msg: T(r.msg) }; }
    case 'ytRemove': if (youtube) youtube.remove(String(arg || '')); return { ok: true, media: mediaView() };
    case 'ytShorts': if (youtube && arg) youtube.setShorts(String(arg.id || ''), !!arg.on); return { ok: true, media: mediaView() };
    case 'ytCheck': { const r = youtube ? await youtube.check(true) : { fresh: 0 }; return { ok: true, msg: r.fresh ? T('{x} neue Videos.').replace('{x}', r.fresh) : T('Keine neuen Videos.'), media: mediaView() }; }
    case 'zentraleEnroll': return zentraleApi ? zentraleApi.enroll((arg || {}).url, (arg || {}).code) : { ok: false };
    case 'zentraleLeave': return zentraleApi ? zentraleApi.leave() : { ok: false };
    case 'zentraleReconnect': if (zentraleApi) zentraleApi.reconnect(); return { ok: true, msg: 'Verbinde neu …' };
    case 'skinFolder': openSkinFolder(); break;
    case 'skinReload': reloadSkin(); return { ok: true, msg: skinStatus().text + ' – neu geladen.' };
    case 'skinReset': return resetSkin();
    case 'skinSet': return setSkin(String(arg || '')) ? { ok: true } : { ok: false, msg: T('Diesen Skin gibt es nicht.') };
    case 'bubbleTest': send('bubbletest', arg === 'alert' ? 'alert' : ''); return { ok: true };
    case 'log': writeLog('Protokoll geöffnet'); shell.openPath(logFile()); break;
    case 'dataFolder': shell.openPath(app.getPath('userData')); break;
    case 'keytest': send('keytest'); break;
    case 'clearScreenTime': if (work) work.clearScreenTime(); break;
    case 'tour': openTour(); break;
    case 'simulate': if (SIM[arg]) send('event', { type: arg, ...SIM[arg] }); break;
    case 'export': return exportData();
    case 'import': return importData();
    case 'diag': { const t = await diagnostics(); clipboard.writeText(t); return { ok: true, msg: 'Diagnose-Bericht in die Zwischenablage kopiert.' }; }
    case 'checkUpdate': return checkUpdate(true);
    case 'installUpdate': installUpdate(); break;
    case 'reload': recreateOverlay(); break;
  }
  return { ok: true };
});

// 1.10: Die IT kann Tipps in der Zentrale abschalten
function tipsBlocked() { const d = zentraleApi && zentraleApi.status().enrolled && zentraleApi.dexConfig && zentraleApi.dexConfig(); return !!(d && d.tips && d.tips.enabled === false); }

/* ---------- Info & Diagnose ---------- */
function aboutInfo() {
  return {
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    os: `${os.type()} ${os.release()} (${os.arch()})`, installed: installKind(), dataDir: app.getPath('userData'),
    changelog: (() => { try { return fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch { return ''; } })()
  };
}
function installKind() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'Portable EXE';
  if (!app.isPackaged) return 'Entwicklerstart (START.bat)';
  if (process.env.APPIMAGE) return 'AppImage';                                  // Linux (1.12)
  if (process.platform === 'linux') return 'Linux-Paket (.deb)';
  if (/program files/i.test(process.execPath)) return 'Installiert (alle Benutzer / MSI)';
  return 'Installiert (Setup)';
}
async function diagnostics() {
  const lines = [];
  const add = (k, v) => lines.push(`${k.padEnd(26)} ${v}`);
  const i = aboutInfo();
  lines.push('=== Sudo Diagnose-Bericht ===', `Erstellt: ${new Date().toLocaleString('de-DE')}`, '');
  add('Version', i.version); add('Installationsart', i.installed); add('Electron / Chrome / Node', `${i.electron} / ${i.chrome} / ${i.node}`);
  { const v = diag.view(), n = v.now || {}, a = v.avg; add('Sudo-Ressourcen', `jetzt CPU ${n.cpu ?? '?'} % / RAM ${n.ram ?? '?'} MB` + (a ? ` · Ø 10 min CPU ${a.cpu} % / RAM ${a.ram} MB` : '')); add('Selbstheilung (24 h)', `${v.crashes}× · Fehler: ${v.errors.length ? v.errors[0].msg : 'keine'}`); }
  add('Betriebssystem', i.os); add('Arbeitsspeicher', `${Math.round(os.freemem() / 1e9 * 10) / 10} von ${Math.round(os.totalmem() / 1e9)} GB frei`);
  add(process.platform === 'linux' ? 'X11 (Fenster)' : 'Windows-API (Fenster)', win32.available() ? 'ok' : 'nicht verfügbar');
  add('Tastatur-Hook', hook ? 'läuft' : 'nicht gestartet');
  add('Tastenkürzel', `Werkzeugkasten ${shortcutOk.tools ? 'ok' : 'belegt'}, Erinnerung ${shortcutOk.quick ? 'ok' : 'belegt'}`);
  add('Webhook-Port', server && server.listening ? `${PORT} offen` : `${PORT} nicht offen`);
  add('Relay', `${settings.relay.enabled ? 'an' : 'aus'} · ${relayStatus.text}`);
  if (zentraleApi) { const z = zentraleApi.status(); add('Zentrale', z.enrolled ? `${z.url} · ${z.online ? 'online' : 'offline'}${z.error ? ' · ' + z.error : ''}` : 'nicht angemeldet'); }
  if (ask) { const a = ask.status(); add('Frag Sudo', `${a.mode} · ${a.model} · heute ${a.today.q} Fragen`); }
  add('Sparmodus', `${settings.eco} → ${ecoActive ? 'aktiv' : 'inaktiv'}${powerMonitor.isOnBatteryPower() ? ' (Akku)' : ''}`);
  add('Meeting erkannt', inMeeting ? 'ja' : 'nein'); add('Vollbild versteckt', hiddenForFullscreen ? 'ja' : 'nein');
  add('Updates', `${settings.autoUpdate ? 'automatisch' : 'aus'} · ${update.state}${update.error ? ' · ' + update.error : ''}`);
  lines.push('', 'Bildschirme:');
  screen.getAllDisplays().forEach((d, n) => lines.push(`  ${n + 1}: ${d.size.width}×${d.size.height} @ ${d.scaleFactor * 100} %, Position ${d.bounds.x},${d.bounds.y}${display && d.id === display.id ? '  ← Sudo' : ''}`));
  const pub = { ...settings, relay: { ...settings.relay, token: settings.relay.token ? '***' : '' }, special: { ...settings.special, birthday: settings.special.birthday ? '***' : '' }, intel: { ...settings.intel, hibpKey: settings.intel.hibpKey ? '***' : '', emails: (settings.intel.emails || []).map(maskMail) }, ai: { ...settings.ai, keyEnc: settings.ai.keyEnc ? '***' : '' }, zentrale: settings.zentrale ? { ...settings.zentrale, tokenEnc: settings.zentrale.tokenEnc ? '***' : '', enroll: settings.zentrale.enroll ? '***' : '' } : undefined };
  lines.push('', 'Einstellungen (ohne Geheimnisse):', JSON.stringify(pub, null, 1));
  try {
    const log = fs.readFileSync(logFile(), 'utf8').trim().split('\n').slice(-80);
    lines.push('', 'Letzte Protokollzeilen:', ...log);
  } catch { /* kein Protokoll */ }
  return lines.join('\n');
}

/* ---------- Ninja-Leiste (1.4.2) ---------- */
let deck = null;
ipcMain.handle('deck-run', async (_e, id) => {
  if (!deck || typeof id !== 'string') return { ok: false };
  return deck.run(id.slice(0, 20));
});

/* ---------- Security-Quiz (1.5) ---------- */
let quiz = null, quizWin = null;
function openQuiz() {
  if (!quiz) return;
  if (quizWin && !quizWin.isDestroyed()) { quizWin.show(); quizWin.focus(); return; }
  quiz.startSession();
  quizWin = smallWindow('quiz.html', 'preload-quiz.js', 600, 620, 'Sudo – Security-Quiz');
  quizWin.on('closed', () => { quizWin = null; });
}
ipcMain.handle('quiz-next', async () => { if (!quiz) return null; await quiz.ensureLoaded(); return { q: quiz.next(), stats: quiz.stats() }; });
ipcMain.handle('quiz-answer', async (_e, a) => {
  if (!quiz || !a) return { ok: false };
  const r = await quiz.answer(String(a.id || '').slice(0, 12), Number(a.choice));
  if (r.ok) send('quiz_result', { right: r.right, total: r.total });
  return r;
});

/* ---------- Selbsthilfe und Hinweise der IT (1.6) ---------- */
let youtube = null;
let selfhelp = null, ops = null, helpWin = null, hinweiseWin = null, helpFocus = null;
function openSelfHelp(focus) {
  helpFocus = focus || null;
  if (helpWin && !helpWin.isDestroyed()) { helpWin.close(); }
  helpWin = smallWindow('selfhelp.html', 'preload-selfhelp.js', 680, 760, 'Sudo – Selbsthilfe');
  helpWin.on('closed', () => { helpWin = null; });
}
function openHinweise() {
  if (hinweiseWin && !hinweiseWin.isDestroyed()) { hinweiseWin.show(); hinweiseWin.focus(); hinweiseWin.webContents.send('ops-changed'); return; }
  hinweiseWin = smallWindow('hinweise.html', 'preload-hinweise.js', 640, 640, 'Sudo – Hinweise deiner IT');
  hinweiseWin.on('closed', () => { hinweiseWin = null; });
}
ipcMain.handle('selfhelp-get', () => ({ tools: selfhelp ? selfhelp.tools() : [], help: ops ? ops.help() : null, focus: helpFocus }));
ipcMain.handle('selfhelp-run', async (_e, id) => (selfhelp ? selfhelp.run(String(id).slice(0, 20)) : { ok: false }));
ipcMain.handle('ops-get', () => (ops ? ops.view() : { incidents: [], resolved: [], restart: [] }));
ipcMain.handle('ops-affected', async (_e, a) => (ops && a ? ops.affected(Number(a.id), !!a.on) : { ok: false }));
ipcMain.handle('ops-snooze', (_e, a) => (ops && a ? ops.snooze(Number(a.id), String(a.opt)) : { ok: false }));
ipcMain.handle('ops-restart', async (_e, id) => (ops ? ops.restartNow(Number(id)) : { ok: false }));
ipcMain.handle('ops-cancel', async () => (ops ? ops.cancelRestart() : { ok: false }));

/* ---------- Mitarbeiter-Erlebnis (1.10): Meeting-Check, Kurze Frage, Start-Checkliste ---------- */
let meetWin = null, pulseWin = null, startWin = null, habits = null, checkin = null;
function openMeet() {
  if (meetWin && !meetWin.isDestroyed()) { meetWin.show(); meetWin.focus(); return; }
  meetWin = smallWindow('meet.html', 'preload-meet.js', 620, 820, 'Sudo – Meeting-Check');
  meetWin.on('closed', () => { meetWin = null; });
}
function openPulse() {
  if (pulseWin && !pulseWin.isDestroyed()) { pulseWin.show(); pulseWin.focus(); return; }
  pulseWin = smallWindow('stimmung.html', 'preload-stimmung.js', 560, 560, 'Sudo – Kurze Frage deiner IT');
  pulseWin.on('closed', () => { pulseWin = null; if (tray) buildTrayMenu(); });
}
function openStart() {
  if (startWin && !startWin.isDestroyed()) { startWin.show(); startWin.focus(); return; }
  startWin = smallWindow('start.html', 'preload-start.js', 620, 760, 'Sudo – Start-Checkliste');
  startWin.on('closed', () => { startWin = null; });
}
// Verbindung zu Teams: dreimal messen, der beste Wert zählt (der erste Aufruf enthält Namensauflösung und TLS)
ipcMain.handle('meet-net', async () => {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    // Weiterleitung = Server hat geantwortet (net.fetch wirft dann „Redirect was cancelled“)
    try { await net.fetch('https://teams.microsoft.com/', { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(6000), cache: 'no-store' }); times.push(Date.now() - t); }
    catch (e) { if (/redirect/i.test(String(e && e.message))) times.push(Date.now() - t); }
  }
  if (!times.length) return { state: 'bad', ms: 0, msg: 'Teams ist von hier nicht erreichbar. Ist das Internet da? Der Netzwerk-Check zeigt, wo es hakt.' };
  const ms = Math.min(...times);
  return ms < 250 ? { state: 'ok', ms, msg: 'Gute Verbindung zu Teams ({ms} ms).' }
    : ms < 700 ? { state: 'warn', ms, msg: 'Verbindung geht ({ms} ms), kann aber ruckeln. WLAN näher am Router oder Kabel hilft; große Downloads pausieren.' }
    : { state: 'bad', ms, msg: 'Langsame Verbindung zu Teams ({ms} ms). Rechne mit Rucklern – Kamera aus spart Bandbreite.' };
});
ipcMain.on('meet-done', (_e, ok) => { writeLog('Meeting-Check: ' + (ok ? 'alles gut' : 'Problem gefunden')); if (zentraleApi && zentraleApi.status().enrolled) zentraleApi.selfhelpUsed('meet', !!ok); });
ipcMain.handle('pulse-get', () => (checkin ? checkin.questions() : []));
ipcMain.handle('pulse-answer', async (_e, a) => { const r = checkin && a ? await checkin.answerSurvey(a.id, a.score, a.comment, a.skip) : { ok: false }; if (tray) buildTrayMenu(); if (r.ok && !a.skip) send('care', { kind: 'pulse_thanks' }); return r; });
ipcMain.handle('pulse-incident', async (_e, a) => { const r = checkin && a ? await checkin.answerIncident(a.id, a.ok) : { ok: false }; if (tray) buildTrayMenu(); return r; });
ipcMain.handle('start-get', () => (checkin ? checkin.view() : null));
ipcMain.handle('start-mark', async (_e, a) => (checkin && a ? checkin.mark(a.id, a.done, false) : { ok: false }));
ipcMain.handle('start-recheck', async () => { if (checkin) await checkin.runAuto(true); return checkin ? checkin.view() : null; });
// Werktag für Hinweise: Arbeitstage aus „Arbeitstag & Pausen“, 7–19 Uhr (core = 9–17 Uhr für Fragen der IT)
function workdayNow(core) {
  const d = new Date(), w = normalizeWork(settings.work), h = d.getHours();
  if (TEST) return true;
  return w.days.includes(d.getDay()) && (core ? h >= 9 && h < 17 : h >= 7 && h < 19);
}

/* ---------- Verlauf (1.9): „Was hat Sudo gesagt?“ ---------- */
// Wichtige Blasen (Zentrale, Alarme, Wächter, Erinnerungen, Videos, Frag Sudo) – nur auf diesem PC.
// 1.11: durchsuchbar (Zeitraum, Quelle, Ticket, Gerät); Aufbewahrung einstellbar (Aus, 7, 30, 90 Tage, 1 Jahr), höchstens 2000 Einträge.
const HISTORY_MAX = 2000, HISTORY_DAYS = [0, 7, 30, 90, 365], HISTORY_DEFAULT = 30, HISTORY_CATS = new Set(['zentrale', 'relay', 'event', 'youtube', 'sys', 'reminder', 'ask']);
let history = null, historyWin = null, historyTimer = null;
const historyFile = () => path.join(app.getPath('userData'), 'verlauf.json');
function historyDays() { const n = settings.history ? Number(settings.history.days) : NaN; return HISTORY_DAYS.includes(n) ? n : HISTORY_DEFAULT; }
function historyLoad() {
  const fresh = !history;
  if (fresh) try { const j = JSON.parse(fs.readFileSync(historyFile(), 'utf8').replace(/^\uFEFF/, '')); history = Array.isArray(j) ? j : []; } catch { history = []; }
  // Abgelaufenes fliegt bei jedem Zugriff raus – auch aus der Datei, nicht nur aus der Anzeige
  const days = historyDays(), min = Date.now() - days * 864e5, n = history.length;
  history = days ? history.filter(h => h && h.at > min).slice(0, HISTORY_MAX) : [];
  if (history.length !== n) historySave();
  return history;
}
function historySave() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => { try { fs.writeFileSync(historyFile(), JSON.stringify(history)); } catch (e) { writeLog('Verlauf: ' + e.message); } }, 1500);
}
ipcMain.on('bubble-keep', (_e, o) => {
  if (!o || typeof o.text !== 'string' || !HISTORY_CATS.has(o.cat) || !historyDays()) return;
  const h = historyLoad(), text = o.text.trim().slice(0, 600);
  if (!text) return;
  if (h.slice(0, 5).some(x => x.text === text && Date.now() - x.at < 120000)) return;   // gleiche Blase kurz hintereinander
  const link = typeof o.link === 'string' && (safeLink(o.link) || /^sudo:[\w/]+$/.test(o.link)) ? o.link.slice(0, 2000) : '';
  const item = { at: Date.now(), cat: o.cat, text, link, meeting: !!inMeeting };
  // 1.11: Ticket- und Gerätekennung getrennt merken, damit die Suche sie gezielt findet
  const tag = v => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\x00-\x1f]/g, '').trim().slice(0, 80) : '');
  const ticket = tag(o.ticket).replace(/^#/, ''), dev = tag(o.device);
  if (ticket && ticket !== '–') item.ticket = ticket;
  if (dev) item.device = dev;
  h.unshift(item);
  history = h.slice(0, HISTORY_MAX); historySave();
  if (historyWin && !historyWin.isDestroyed()) historyWin.webContents.send('history-changed');
  if (tray) buildTrayMenu();
});
function setHistoryDays(v) {
  const n = Number(v);
  if (!HISTORY_DAYS.includes(n)) return;
  settings.history = { ...settings.history, days: n };
  historyLoad();                                        // kürzere Dauer löscht sofort
  if (historyWin && !historyWin.isDestroyed()) historyWin.webContents.send('history-changed');
  if (tray) buildTrayMenu();
  writeLog('Verlauf: Aufbewahrung ' + (n ? n + ' Tage' : 'aus'));
}
ipcMain.handle('history-get', () => ({ items: historyLoad(), seen: settings.historySeen || 0, days: historyDays(), max: HISTORY_MAX }));
ipcMain.on('history-settings', () => openSettings());
ipcMain.handle('history-clear', () => { history = []; historySave(); if (tray) buildTrayMenu(); return true; });
function historyUnseen() { const s = settings.historySeen || 0; return historyLoad().filter(h => h.at > s && h.meeting).length; }
function openHistory() {
  if (historyWin && !historyWin.isDestroyed()) { historyWin.show(); historyWin.focus(); return; }
  historyWin = smallWindow('verlauf.html', 'preload-verlauf.js', 600, 640, 'Sudo – Was hat Sudo gesagt?');
  historyWin.on('closed', () => { historyWin = null; settings.historySeen = Date.now(); saveSettings(); if (tray) buildTrayMenu(); });
}

/* ---------- Wissen & Anleitungen (1.9): SharePoint-Anleitungen über die Zentrale durchsuchen ---------- */
let kbWin = null, kbQuery = '';
function openKb(q) {
  kbQuery = String(q || '').slice(0, 200);
  if (kbWin && !kbWin.isDestroyed()) { kbWin.show(); kbWin.focus(); kbWin.webContents.send('kb-query', kbQuery); return; }
  kbWin = smallWindow('wissen.html', 'preload-wissen.js', 640, 700, 'Sudo – Anleitungen');
  kbWin.on('closed', () => { kbWin = null; });
}
ipcMain.handle('kb-get', () => ({ on: !!(zentraleApi && zentraleApi.kbOn()), query: kbQuery }));
ipcMain.handle('kb-search', async (_e, q) => {
  if (!zentraleApi || !zentraleApi.status().enrolled) return { ok: false, msg: 'Anleitungen gibt es nur mit der Sudo-Zentrale.' };
  const r = await zentraleApi.kbSearch(q);
  return r.ok ? { ok: true, items: (r.items || []).slice(0, 10), recent: !!r.recent } : { ok: false, msg: T(r.msg || 'Fehler') };
});
// Passende Anleitungen zu einer Störung (Hinweise-Fenster): nur klare Treffer
ipcMain.handle('kb-suggest', async (_e, q) => {
  if (!zentraleApi || !zentraleApi.kbOn() || String(q || '').trim().length < 3) return [];
  const r = await zentraleApi.kbSearch(q);
  return r.ok ? (r.items || []).filter(i => i.score >= 8).slice(0, 2) : [];
});

/* ---------- Musikwünsche (1.8): Song wünschen, mit XP bezahlen ---------- */
let musicWin = null;
function openMusic() {
  if (musicWin && !musicWin.isDestroyed()) { musicWin.show(); musicWin.focus(); return; }
  musicWin = smallWindow('music.html', 'preload-music.js', 620, 700, 'Sudo – Musikwunsch');
  musicWin.on('closed', () => { musicWin = null; });
}
const xpNow = () => Math.max(0, Math.floor(Number((lastStats && lastStats.xp) || 0)));
ipcMain.handle('music-get', async () => {
  if (!zentraleApi || !zentraleApi.status().enrolled) return { ok: false, msg: 'Musikwünsche gehen nur mit der Sudo-Zentrale.' };
  const r = await zentraleApi.musicStatus();
  return { ...r, xp: xpNow(), rank: lastStats && lastStats.rank };
});
ipcMain.handle('music-search', async (_e, q) => (zentraleApi ? zentraleApi.musicSearch(String(q || '').slice(0, 100)) : { ok: false }));
ipcMain.handle('music-request', async (_e, id) => {
  if (!zentraleApi) return { ok: false };
  const r = await zentraleApi.musicRequest(String(id || '').slice(0, 40), xpNow());
  if (r.ok) {
    writeLog(`Musikwunsch: ${r.track.name} – ${r.track.artist} (−${r.cost} XP)`);
    send('xp_spend', { cost: Number(r.cost) || 0, title: r.track.name, artist: r.track.artist });
  }
  return { ...r, xp: Math.max(0, xpNow() - (r.ok ? Number(r.cost) || 0 : 0)) };
});

/* ---------- Transparenz: Was weiß Sudo über mich? (1.4.1) ---------- */
let privacyWin = null;
function openPrivacy() {
  if (privacyWin && !privacyWin.isDestroyed()) { privacyWin.show(); privacyWin.focus(); return; }
  privacyWin = smallWindow('privacy.html', 'preload-privacy.js', 720, 820, 'Sudo – Was weiß Sudo über mich?');
  privacyWin.on('closed', () => { privacyWin = null; });
  send('flag', 'privacy');                       // schaltet den Aluhut frei
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), f), 'utf8')); } catch { return null; } };
const fileInfo = f => { try { const st = fs.statSync(path.join(app.getPath('userData'), f)); return { kb: Math.max(1, Math.round(st.size / 1024)), changed: st.mtime.toISOString() }; } catch { return null; } };
const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
function privacySnapshot() {
  const st = readJson('screentime.json') || { days: {} };
  const days = Object.values(st.days || {});
  const appNames = new Set(); days.forEach(d => Object.keys(d.apps || {}).forEach(a => appNames.add(a)));
  let logLines = 0; try { logLines = fs.readFileSync(logFile(), 'utf8').split('\n').filter(Boolean).length; } catch { /* leer */ }
  const s = lastStats || {};
  const pick = ['keys', 'bugs', 'saves', 'best', 'xp', 'minutes', 'breaks', 'pets', 'meetings', 'noted', 'copies', 'throws', 'gameBest', 'alarms', 'visitsSent', 'duels', 'duelsWon'];
  const z = zentraleApi ? zentraleApi.status() : {};
  const i = settings.intel || {}, ai = settings.ai || {}, w = work ? work.normalize(settings.work) : {};
  return {
    version: app.getVersion(), dataDir: app.getPath('userData'),
    counters: Object.fromEntries(pick.map(k => [k, Math.round(s[k] || 0)])), since: s.since || '',
    unlocked: (s.unlocked || []).length, achievements: Object.keys(s.achievements || {}).length,
    screen: { on: w.screenTime !== false, days: days.length, apps: [...appNames].sort(), keepDays: 30, file: fileInfo('screentime.json') },
    reminders: (() => { const l = reminders ? reminders.list() : { reminders: [], notes: [] }; return { reminders: l.reminders.length, notes: l.notes.length, file: fileInfo('reminders.json') }; })(),
    log: { lines: logLines, file: fileInfo('events.log') },
    intel: { m365: !!i.m365, azure: !!i.azure, breaches: !!i.breaches, feeds: (i.feeds || []).filter(f => f.on).map(f => f.name), emails: (i.emails || []).length, hibpKey: !!i.hibpKey },
    ai: { mode: ai.mode || 'off', keySaved: !!ai.keyEnc, context: ai.context !== false, file: fileInfo('ai-usage.json') },
    zentrale: { enrolled: !!z.enrolled, host: hostOf(settings.zentrale && settings.zentrale.url), name: z.name || os.hostname(), user: os.userInfo().username, upn: (zentraleApi && zentraleApi.upn && zentraleApi.upn()) || '', health: !!(zentraleApi && zentraleApi.healthReporting && zentraleApi.healthReporting()) },
    health: health ? health.snapshot().overall : 'unknown', quiz: quiz ? { ...quiz.config(), ...quiz.stats() } : null,
    visits: { allow: settings.visits.allow !== false, name: settings.visits.name || os.userInfo().username },
    media: mediaView(), history: { n: historyLoad().length, days: historyDays() },
    relay: { on: !!(settings.relay && settings.relay.enabled), host: hostOf(settings.relay && settings.relay.url) },
    webhook: !!(server && server.listening), port: PORT,
    updates: { auto: settings.autoUpdate !== false, host: 'updates.meikosoft.net' },
    hideFromCapture: settings.hideFromCapture !== false, meetingQuiet: settings.meetingQuiet !== false
  };
}
// Datenauskunft: alles, was Sudo auf diesem PC gespeichert hat, in einer Datei – ohne Schlüssel und Passwörter
async function privacyExport() {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = TEST && process.env.SUDO_PRIVACY_OUT ? { filePath: process.env.SUDO_PRIVACY_OUT } : await dialog.showSaveDialog(privacyWin || undefined, {
    title: T('Datenauskunft speichern'), defaultPath: path.join(app.getPath('documents'), `Sudo-Datenauskunft-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, msg: 'Abgebrochen.' };
  const redact = '(verschlüsselt gespeichert, nicht exportiert)';
  const safeSettings = JSON.parse(JSON.stringify(settings));
  if (safeSettings.ai) { safeSettings.ai.keyEnc = safeSettings.ai.keyEnc ? redact : ''; }
  if (safeSettings.zentrale) { safeSettings.zentrale.tokenEnc = safeSettings.zentrale.tokenEnc ? redact : ''; safeSettings.zentrale.enroll = ''; }
  if (safeSettings.relay && safeSettings.relay.token) safeSettings.relay.token = redact;
  if (safeSettings.intel && safeSettings.intel.hibpKey) safeSettings.intel.hibpKey = redact;
  let log = ''; try { log = fs.readFileSync(logFile(), 'utf8'); } catch { /* leer */ }
  const out = {
    app: 'Sudo', art: 'Datenauskunft', version: app.getVersion(), erstellt: new Date().toISOString(), pc: os.hostname(), benutzer: os.userInfo().username,
    hinweis: 'Alles, was Sudo auf diesem PC gespeichert hat. Schlüssel und Passwörter sind ausgelassen.',
    uebersicht: privacySnapshot(), einstellungen: safeSettings, statistik: lastStats,
    bildschirmzeit: readJson('screentime.json'), erinnerungen: readJson('reminders.json'), itLage: readJson('intel.json'), kiVerbrauch: readJson('ai-usage.json'), verlauf: historyLoad(), diagnose: diag.view(),
    protokoll: log.split('\n').filter(Boolean)
  };
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 1));
  writeLog('Datenauskunft gespeichert');
  return { ok: true, msg: `Gespeichert: ${path.basename(r.filePath)}` };
}
ipcMain.handle('privacy-get', () => privacySnapshot());
ipcMain.handle('privacy-act', async (_e, a) => {
  switch (a) {
    case 'export': return privacyExport();
    case 'folder': shell.openPath(app.getPath('userData')); return { ok: true };
    case 'clearScreen': if (work) work.clearScreenTime(); writeLog('App-Liste der Bildschirmzeit gelöscht'); return { ok: true, msg: 'App-Liste gelöscht.' };
    case 'clearLog': try { fs.writeFileSync(logFile(), ''); } catch { /* egal */ } writeLog('Protokoll geleert'); return { ok: true, msg: 'Protokoll geleert.' };
    case 'work': openWorkWindow(); return { ok: true };
    case 'settings': openSettings(); return { ok: true };
    default: return { ok: false };
  }
});

/* ---------- Sichern & Wiederherstellen ---------- */
const DATA_FILES = ['screentime.json', 'reminders.json', 'intel.json'];
async function exportData() {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(settingsWin || undefined, {
    title: T('Sudo sichern'), defaultPath: path.join(app.getPath('documents'), `Sudo-Sicherung-${stamp}.sudo.json`),
    filters: [{ name: T('Sudo-Sicherung'), extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, msg: 'Abgebrochen.' };
  const files = {};
  for (const f of DATA_FILES) { try { files[f] = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), f), 'utf8')); } catch { /* fehlt */ } }
  const data = { app: 'Sudo', format: 1, version: app.getVersion(), created: new Date().toISOString(),
    settings: { ...settings, relay: { ...settings.relay, lastId: null }, ai: { ...settings.ai, keyEnc: '', keyPlain: false } }, stats: lastStats, files };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1));
  writeLog('Daten gesichert: ' + r.filePath);
  return { ok: true, msg: `Gesichert: ${path.basename(r.filePath)}` };
}
let pendingImportStats = null;
function takeImportedStats() { const s = pendingImportStats; pendingImportStats = null; return s; }
async function importData() {
  const r = await dialog.showOpenDialog(settingsWin || undefined, { title: T('Sudo wiederherstellen'), properties: ['openFile'], filters: [{ name: T('Sudo-Sicherung'), extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, msg: 'Abgebrochen.' };
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { ok: false, msg: 'Die Datei ist keine gültige Sudo-Sicherung.' }; }
  if (!data || data.app !== 'Sudo' || !data.settings) return { ok: false, msg: 'Die Datei ist keine Sudo-Sicherung.' };
  const keepDisplay = settings.displayId;
  settings = { ...settings, ...data.settings, displayId: keepDisplay, relay: { ...settings.relay, ...(data.settings.relay || {}) },
    work: normalizeWork(data.settings.work), watch: { ...WATCH_DEFAULTS, ...(data.settings.watch || {}) } };
  writeSettings();
  for (const f of DATA_FILES) if (data.files && data.files[f]) fs.writeFileSync(path.join(app.getPath('userData'), f), JSON.stringify(data.files[f]));
  if (data.stats) pendingImportStats = data.stats;
  writeLog('Daten wiederhergestellt aus ' + path.basename(r.filePaths[0]));
  // Neustart, damit alle Teile die Daten frisch laden
  setTimeout(() => { app.relaunch(); app.exit(0); }, 1200);
  return { ok: true, msg: 'Wiederhergestellt. Sudo startet gleich neu …' };
}

/* ---------- Willkommens-Tour ---------- */
let tourWin = null;
function openTour() {
  if (tourWin && !tourWin.isDestroyed()) { tourWin.show(); tourWin.focus(); return; }
  tourWin = smallWindow('tour.html', 'preload-tour.js', 560, 470, 'Willkommen bei Sudo');
  tourWin.on('closed', () => { tourWin = null; if (!settings.tourDone) { settings.tourDone = true; writeSettings(); } });
}
ipcMain.on('tour-step', (_e, step) => send('tour', step));
ipcMain.handle('tour-finish', (_e, opts) => {
  if (opts && typeof opts.autostart === 'boolean') setAutostart(opts.autostart);
  if (opts && ['klein', 'normal', 'gross'].includes(opts.size)) settings.size = opts.size;
  settings.tourDone = true; saveSettings();
  return true;
});
ipcMain.handle('tour-get', () => ({ autostart: settings.autostart, size: settings.size, shortcuts: { ...shortcutOk } }));

/* ---------- Auto-Update (nur bei installierter Version) ---------- */
const update = { state: 'idle', version: null, error: null, progress: 0 };
let updater = null;
// Linux (1.12): nur das AppImage aktualisiert sich selbst (latest-linux.yml auf dem Update-Server), das .deb macht die Paketverwaltung
function canAutoUpdate() { return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE && !/program files/i.test(process.execPath) && (process.platform !== 'linux' || !!process.env.APPIMAGE); }
function setUpdate(patch) {
  Object.assign(update, patch);
  buildTrayMenu();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-update', { ...update, canUpdate: canAutoUpdate() });
}
function initUpdater() {
  if (!canAutoUpdate()) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (e) { writeLog('Updater nicht verfügbar: ' + e.message); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpdate({ state: 'checking', error: null }));
  updater.on('update-not-available', () => setUpdate({ state: 'current' }));
  updater.on('update-available', i => { setUpdate({ state: 'downloading', version: i.version }); writeLog('Update gefunden: ' + i.version); });
  updater.on('download-progress', p => setUpdate({ progress: Math.round(p.percent) }));
  updater.on('update-downloaded', i => {
    setUpdate({ state: 'ready', version: i.version });
    writeLog('Update bereit: ' + i.version);
    send('event', { type: 'success', text: `Update ${i.version} ist da!\nKommt beim nächsten Start.` });
  });
  updater.on('error', e => { setUpdate({ state: 'error', error: String(e && e.message || e).slice(0, 160) }); writeLog('Update-Fehler: ' + update.error); });
  if (settings.autoUpdate) setTimeout(() => checkUpdate(false), 20000);
  setInterval(() => { if (settings.autoUpdate) checkUpdate(false); }, 6 * 3600 * 1000);
}
async function checkUpdate(manual) {
  if (!canAutoUpdate()) return { ok: false, msg: installKind() === 'Portable EXE' ? 'Die portable EXE aktualisiert sich nicht selbst. Lade einfach die neue EXE herunter.'
    : installKind() === 'Linux-Paket (.deb)' ? 'Das Linux-Paket wird über die Paketverwaltung aktualisiert.' : 'Diese Installation wird zentral verteilt (MSI/Intune) oder ist ein Entwicklerstart.' };
  if (!updater) return { ok: false, msg: 'Updater nicht verfügbar.' };
  try { await updater.checkForUpdates(); return { ok: true, msg: manual ? 'Suche nach Updates …' : '' }; }
  catch (e) { return { ok: false, msg: 'Update-Prüfung fehlgeschlagen: ' + e.message }; }
}
function installUpdate() { if (updater && update.state === 'ready') { app.isQuitting = true; updater.quitAndInstall(false, true); } }

/* Sudo aus Bildschirmfreigaben und Screenshots heraushalten (Windows 10 2004 oder neuer) */
function applyCapture() {
  if (win && !win.isDestroyed()) win.setContentProtection(!!settings.hideFromCapture && !TEST);
}

/* ---------- Start ---------- */
/* Overlay-Fenster komplett neu erzeugen. Rang, Statistik und Wohnort bleiben erhalten. */
let recreating = false;
/* ---------- Ressourcen & Stabilität (1.9) ---------- */
const diag = createDiag({ app, log: m => writeLog(m), onChange: () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-diag'); } });
// Fehler im Hauptprozess: protokollieren statt Fehlerdialog und Absturz
process.on('uncaughtException', e => { try { diag.error('Hauptprozess', e); } catch { /* nichts mehr zu retten */ } });
process.on('unhandledRejection', e => { try { diag.error('Hauptprozess (async)', e); } catch { /* egal */ } });
let rendererErrors = 0;
ipcMain.on('renderer-error', (_e, m) => { if (++rendererErrors <= 30) diag.error('Overlay', String(m || '').slice(0, 300)); });
// Overlay hängt oder ist abgestürzt: selbst neu erzeugen (höchstens 4× pro Stunde, damit es keine Endlosschleife wird)
let hangTimer = null;
function healOverlay(reason) {
  diag.crash(reason);
  if (diag.crashesLastHour() > 4) { writeLog('Overlay: zu viele Neustarts in einer Stunde – warte'); return; }
  setTimeout(recreateOverlay, 1500);
}
function watchOverlay(w) {
  w.webContents.on('render-process-gone', (_e, d) => { if (w === win && d && d.reason !== 'clean-exit') healOverlay('abgestürzt (' + d.reason + ')'); });
  w.on('unresponsive', () => { if (w !== win || hangTimer) return; hangTimer = setTimeout(() => { hangTimer = null; if (w === win) healOverlay('hängt'); }, 10000); });
  w.on('responsive', () => { clearTimeout(hangTimer); hangTimer = null; });
}
app.on('child-process-gone', (_e, d) => { if (d && d.type === 'GPU' && d.reason !== 'clean-exit') diag.crash('Grafikprozess ' + d.reason); });
// Alle 30 s messen; alle 10 min der Zentrale melden; Overlay mit über 700 MB wird im Leerlauf neu erzeugt
function startDiag() {
  let n = 0;
  const every = TEST && process.env.SUDO_METRICS ? 3000 : 30000;
  setInterval(() => {
    const s = diag.measure(); n++;
    if (TEST && process.env.SUDO_METRICS && s) console.log('[metrics]', JSON.stringify({ cpu: s.cpu, ram: s.ram, byType: s.byType }));
    const ov = s && s.byType && s.byType['Overlay/Fenster'];
    const others = [settingsWin, lageWin, askWin, musicWin, historyWin].filter(x => x && !x.isDestroyed()).length;
    if (ov && !others && ov.ram > 700 && !inMeeting) { writeLog(`Overlay braucht ${ov.ram} MB – frische es auf`); diag.crash('Speicher ' + ov.ram + ' MB'); recreateOverlay(); }
    if (n % (TEST && process.env.SUDO_METRICS ? 3 : 20) === 0 && zentraleApi && zentraleApi.diagReport && zentraleApi.status().enrolled) zentraleApi.diagReport(diag.summary());
  }, every);
}

function recreateOverlay() {
  if (recreating) return;
  recreating = true;
  const old = win;
  win = null; rendererReady = false; lastPlatforms = ''; hiddenForFullscreen = false;
  hit = { boxes: [], hold: false }; ignoring = true;
  if (old && !old.isDestroyed()) { old.webContents.send('save-now'); }
  setTimeout(() => {
    createWindow();   // erst das neue Fenster, dann das alte schließen (sonst beendet sich die App)
    try { if (old && !old.isDestroyed()) old.destroy(); } catch { /* egal */ }
    recreating = false;
    writeLog('Overlay neu erzeugt');
  }, 300);
}

function createWindow() {
  display = chosenDisplay();
  const b = display.bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height - 1, // 1 px kleiner, sonst hält Windows das Overlay für eine Vollbild-App
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
    backgroundColor: '#00000000', show: false, title: 'Sudo',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  watchOverlay(win);
  win.setIgnoreMouseEvents(true, { forward: true });
  applyCapture();
  win.webContents.on('did-finish-load', () => setIgnore(true, true));
  ownId = win32.handleToId(win.getNativeWindowHandle());
  loadPage(win, 'index.html');
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
  win.webContents.on('console-message', (...args) => {
    const msg = typeof args[0] === 'object' && args[0] && 'message' in args[0] ? args[0].message : args[2];
    if (TEST) console.log('[renderer]', msg, typeof args[0] === 'object' && args[0] && args[0].lineNumber ? 'Zeile ' + args[0].lineNumber : (args[3] ? 'Zeile ' + args[3] : ''));
  });
  if (TEST) {
    setTimeout(async () => {
      const target = meetWin && !meetWin.isDestroyed() ? meetWin : pulseWin && !pulseWin.isDestroyed() ? pulseWin : startWin && !startWin.isDestroyed() ? startWin : kbWin && !kbWin.isDestroyed() ? kbWin : historyWin && !historyWin.isDestroyed() ? historyWin : musicWin && !musicWin.isDestroyed() ? musicWin : helpWin && !helpWin.isDestroyed() ? helpWin : hinweiseWin && !hinweiseWin.isDestroyed() ? hinweiseWin : quizWin && !quizWin.isDestroyed() ? quizWin : privacyWin && !privacyWin.isDestroyed() ? privacyWin : visitWin && !visitWin.isDestroyed() ? visitWin : askWin && !askWin.isDestroyed() ? askWin : lageWin && !lageWin.isDestroyed() ? lageWin : settingsWin && !settingsWin.isDestroyed() ? settingsWin : tourWin && !tourWin.isDestroyed() ? tourWin : wardrobeWin && !wardrobeWin.isDestroyed() ? wardrobeWin : toolsWin && !toolsWin.isDestroyed() ? toolsWin : quickWin && !quickWin.isDestroyed() ? quickWin : workWin && !workWin.isDestroyed() ? workWin : statsWin && !statsWin.isDestroyed() ? statsWin : relayWin && !relayWin.isDestroyed() ? relayWin : win;
      if (process.env.SUDO_SCROLL) { await target.webContents.executeJavaScript(`{const m=document.querySelector('main');if(m)m.scrollTop=${Number(process.env.SUDO_SCROLL)};document.scrollingElement.scrollTop=${Number(process.env.SUDO_SCROLL)};}`); await new Promise(r => setTimeout(r, 300)); }
      const img = await target.webContents.capturePage();
      fs.writeFileSync(process.env.SUDO_SHOT || 'shot.png', img.toPNG());
      app.quit();
    }, Number(process.env.SUDO_TEST_MS || 6000));
  }
}

ipcMain.handle('init', () => {
  lastPlatforms = ''; // beim nächsten Poll erneut senden, falls der Renderer neu geladen wurde
  rendererReady = true;
  const queued = pendingEvents; pendingEvents = [];
  queued.forEach((ev, i) => setTimeout(() => send('event', ev), 1500 + i * 4500));
  setTimeout(() => { sendNeighbors(); send('eco', ecoActive); }, 500);
  if (!settings.tourDone && !TEST) setTimeout(openTour, 4000);
  return { ...layoutInfo(), settings: publicSettings(), sheet: loadSheet(), windowsApi: win32.available(), port: PORT, test: TEST, deckTest: TEST && !!process.env.SUDO_DECK,
    unlockAll: TEST && process.env.SUDO_UNLOCK_ALL === '1', testXp: TEST && process.env.SUDO_TEST_XP ? Number(process.env.SUDO_TEST_XP) : null, importedStats: takeImportedStats() };
});
/* ---------- Sparmodus ---------- */
let locked = false, ecoActive = false;
function isEco() { return settings.eco === 'on' || (settings.eco === 'auto' && powerMonitor.isOnBatteryPower()); }
function startPoll() { clearInterval(pollTimer); pollTimer = setInterval(poll, ecoActive ? POLL_ECO_MS : POLL_MS); }
function applyEco() {
  const e = isEco();
  if (e !== ecoActive) { ecoActive = e; startPoll(); writeLog(e ? 'Sparmodus an' : 'Sparmodus aus'); }
  send('eco', ecoActive);
}

/* ---------- Durchklicken: Hauptprozess prüft die Mausposition selbst ---------- */
let hit = { boxes: [], hold: false }, ignoring = true, lastIgnoreSet = 0;
ipcMain.on('hitboxes', (_e, h) => {
  if (!h || !Array.isArray(h.boxes)) return;
  hit = { boxes: h.boxes.slice(0, 20).filter(b => Array.isArray(b) && b.length === 4).map(b => b.map(Number)), hold: !!h.hold };
  checkMouse();
});
function setIgnore(v, force = false) {
  if (!win || win.isDestroyed()) return;
  if (!force && v === ignoring) return;
  ignoring = v; lastIgnoreSet = Date.now();
  win.setIgnoreMouseEvents(v, { forward: true });
}
function checkMouse() {
  if (!win || win.isDestroyed() || !display || hiddenForFullscreen) return;
  const p = screen.getCursorScreenPoint(), b = display.bounds;
  const x = p.x - b.x, y = p.y - b.y, pad = 6;
  const over = hit.hold || hit.boxes.some(([l, t, r, bt]) => x >= l - pad && x <= r + pad && y >= t - pad && y <= bt + pad);
  // alle 5 Sekunden den Zustand neu setzen, falls Windows ihn verloren hat
  setIgnore(!over, Date.now() - lastIgnoreSet > 5000);
}
ipcMain.on('log', (_e, msg) => writeLog(String(msg).slice(0, 300)));
ipcMain.on('stats', (_e, s) => {
  if (!s || typeof s !== 'object') return;
  lastStats = s;
  if (statsWin && !statsWin.isDestroyed()) statsWin.webContents.send('stats-update', s);
  if (wardrobeWin && !wardrobeWin.isDestroyed()) wardrobeWin.webContents.send('wardrobe-update', { stats: s });
  trayTip = `Sudo · Gürtel: ${String(s.rank).slice(0, 20)} · ${Number(s.bugs) || 0} Bugs gefixt`;
  if (tray) tray.setToolTip(T(trayTip));
});

app.on('second-instance', () => summon());
app.whenReady().then(() => {
  // Nur Test: breiten virtuellen Bildschirm in zwei Monitore aufteilen (zweiter versetzt), um das Ziehen zu prüfen
  if (TEST && process.env.SUDO_FAKE_DISPLAYS) {
    const mk = (id, x, y, w, h) => ({ id, bounds: { x, y, width: w, height: h }, workArea: { x, y, width: w, height: h - 40 }, size: { width: w, height: h }, scaleFactor: 1, rotation: 0, internal: false });
    const fake = [mk(1, 0, 0, 1600, 900), mk(2, 1600, 200, 1280, 700)];
    const inside = (d, p) => p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height;
    screen.getAllDisplays = () => fake;
    screen.getPrimaryDisplay = () => fake[0];
    screen.getDisplayNearestPoint = p => fake.find(d => inside(d, p)) || fake[0];
  }
  loadSettings(); applyLang();
  createWindow();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on('click', summon);
  buildTrayMenu();
  const onDisplays = () => { placeWindow(); lastPlatforms = ''; buildTrayMenu(); setIgnore(true, true); };
  // Nach Standby oder Sperrbildschirm Fenster und Durchklicken neu setzen
  // Nach Sperren/Entsperren oder Standby verliert Windows bei durchsichtigen Overlay-Fenstern gern die
  // Klick-Einstellungen. Am zuverlässigsten: das Overlay-Fenster einmal frisch erzeugen.
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => {
    locked = false;
    if (ev === 'unlock-screen' && habits) habits.onUnlock();
    writeLog(ev === 'resume' ? 'Standby beendet' : 'Entsperrt');
    setTimeout(recreateOverlay, 2000);
  });
  screen.on('display-metrics-changed', onDisplays);
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  startKeyboard();
  startServer();
  startRelay();
  startDiag();
  if (TEST && process.env.SUDO_OPEN_RELAY === '1') openRelayWindow();
  if (TEST && process.env.SUDO_OPEN_STATS === '1') setTimeout(openStatsWindow, 800);
  if (TEST && process.env.SUDO_OPEN_WORK === '1') setTimeout(openWorkWindow, 800);
  if (TEST && process.env.SUDO_RECREATE === '1') setTimeout(recreateOverlay, 2000);
  if (TEST && process.env.SUDO_OPEN_TOOLS) setTimeout(() => openTools(process.env.SUDO_OPEN_TOOLS), 800);
  if (TEST && process.env.SUDO_OPEN_WARDROBE === '1') setTimeout(openWardrobe, 1500);
  if (TEST && process.env.SUDO_OPEN_SETTINGS) setTimeout(() => openSettings(process.env.SUDO_OPEN_SETTINGS), 800);
  if (TEST && process.env.SUDO_CRASH) setTimeout(() => { writeLog('Test: Overlay-Absturz'); win.webContents.forcefullyCrashRenderer(); }, Number(process.env.SUDO_CRASH) || 5000);
  if (TEST && process.env.SUDO_RENDER_ERR) setTimeout(() => win.webContents.executeJavaScript('setTimeout(() => { throw new Error("Testfehler in C:\\\\Users\\\\meiko\\\\x.js") }, 10)'), 4000);
  if (TEST && process.env.SUDO_OPEN_KB) setTimeout(() => openKb(process.env.SUDO_OPEN_KB === '1' ? '' : process.env.SUDO_OPEN_KB), Number(process.env.SUDO_OPEN_KB_MS) || 6000);
  if (TEST && process.env.SUDO_OVERLAY_JS) setTimeout(() => win.webContents.executeJavaScript(process.env.SUDO_OVERLAY_JS).then(r => console.log('[overlay-js]', JSON.stringify(r))).catch(e => console.log('[overlay-js] Fehler', e.message)), Number(process.env.SUDO_OVERLAY_MS) || 4000);
  if (TEST && process.env.SUDO_OPEN_HISTORY) setTimeout(openHistory, Number(process.env.SUDO_OPEN_HISTORY) || 1500);
  if (TEST && process.env.SUDO_HISTORY_JS) setTimeout(() => { if (historyWin) historyWin.webContents.executeJavaScript(process.env.SUDO_HISTORY_JS).then(r => console.log('[history-js]', JSON.stringify(r))).catch(e => console.log('[history-js] Fehler', e.message)); }, 3500);
  if (TEST && process.env.SUDO_SETTINGS_JS) setTimeout(() => { if (settingsWin) settingsWin.webContents.executeJavaScript(process.env.SUDO_SETTINGS_JS).catch(e => writeLog('Test-JS: ' + e.message)); }, 3000);
  if (TEST && process.env.SUDO_OPEN_TOUR === '1') setTimeout(openTour, 800);
  if (TEST && process.env.SUDO_DIAG) setTimeout(async () => fs.writeFileSync(process.env.SUDO_DIAG, await diagnostics()), 2500);
  if (TEST && process.env.SUDO_TOY === '1') setTimeout(() => send('toy', true), 1500);
  if (TEST && process.env.SUDO_GAME === '1') setTimeout(() => send('game'), 1500);
  if (TEST && process.env.SUDO_OPEN_QUICK === '1') setTimeout(() => { reminders.add('20m Kunde zurückrufen'); reminders.add('morgen 9 Backup prüfen'); reminders.add('Ideen für Sudo v0.9 sammeln'); reminders.add('3s Test-Erinnerung'); openQuick(); }, 800);
  if (TEST && process.env.SUDO_SYS) setTimeout(() => send('sys', { kind: process.env.SUDO_SYS, drive: 'C:', gb: 7.4, pct: 96, days: 9, minutes: 3, name: 'NetBird' }), 3000);
  if (TEST && process.env.SUDO_HOME_TEST === '1') { setTimeout(() => send('sethome'), 3500); setTimeout(() => send('summon'), 4500); setTimeout(() => send('gohome'), 6500); }
  if (TEST && process.env.SUDO_CARE) setTimeout(() => send('care', { kind: process.env.SUDO_CARE, label: 'Mittagspause', min: 30, time: '12:00', hours: 8 }), 4000);
  if (TEST && process.env.SUDO_MEETING === '1') { setTimeout(() => send('meeting', true), 1500); setTimeout(() => send('event', { type: 'warning', text: 'Test im Meeting' }), 3500); }
  if (TEST && process.env.SUDO_KEYTEST === '1') setTimeout(() => { send('keytest'); setTimeout(() => ['char', 'char', 'backspace'].forEach(k => send('key', { k })), 2000); }, 1200);
  startPoll();
  for (const ev of ['on-ac', 'on-battery']) powerMonitor.on(ev, applyEco);
  powerMonitor.on('lock-screen', () => { locked = true; send('pause', true); if (habits) habits.onLock(); });
  applyEco();
  appTimer = setInterval(appPoll, 1000);
  work = createWork({
    userData: app.getPath('userData'),
    getSettings: () => settings,
    care: m => send('care', m.kind === 'workstart' && reminders ? { ...m, notes: reminders.noteCount() } : m),
    log: writeLog,
    blocked: () => inMeeting || hiddenForFullscreen,
    idleSeconds: () => (TEST ? Number(process.env.SUDO_IDLE || 0) : powerMonitor.getSystemIdleTime()),
    currentApp: () => currentAppName
  });
  nativeTheme.on('updated', () => send('settings', publicSettings()));   // Windows-Design gewechselt → Umriss an/aus
  deck = createDeck({ getSettings: () => settings, shell, log: writeLog,
    internal: k => { if (k === 'tools') openTools(); else if (k === 'ask') openAsk(); else if (k === 'quick') openQuick(); else if (k === 'lage') openLage(); else if (k === 'selfhelp') openSelfHelp(); } });
  reminders = createReminders({ userData: app.getPath('userData'), deliver: deliverReminder, log: writeLog });
  watch = createWatch({ getSettings: () => settings, notify: m => send('sys', m), log: writeLog, isOnline: () => net.isOnline(), test: TEST });
  // Gerätezustand (1.5). Im Test mit erfundenen Werten, damit man die Ampeln sieht
  const fakeHealth = TEST && process.env.SUDO_FAKE_HEALTH ? { bitlocker: 2, av: [{ name: 'Microsoft Defender Antivirus', state: 397568 }], winfw: [{ n: 'Domain', on: true }, { n: 'Private', on: true }, { n: 'Public', on: false }], def: { on: true, rt: true, age: 1 }, lastUpdate: new Date(Date.now() - 38 * 864e5).toISOString() } : null;
  health = createHealth({ getSettings: () => settings, notify: m => send('sys', m), log: writeLog, test: TEST, fake: fakeHealth,
    onChange: snap => { if (lageWin && !lageWin.isDestroyed()) lageWin.webContents.send('health-update', snap); if (zentraleApi && zentraleApi.healthChanged) zentraleApi.healthChanged(); } });
  intel = createIntel({ dir: app.getPath('userData'), getSettings: () => settings, notify: m => send('sys', m), log: writeLog, test: TEST,
    fetch: process.env.SUDO_INTEL_FAKE ? require('./tools/intel-fake').fetch : (u, o) => net.fetch(u, o),
    onChange: snap => { if (lageWin && !lageWin.isDestroyed()) lageWin.webContents.send('lage-update', snap); } });
  ops = createOps({ getState: () => settings.ops, setState: o => { settings.ops = o; writeSettings(); }, zentrale: () => zentraleApi, announce: zentraleEvent, log: writeLog,
    isBusy: () => inMeeting || hiddenForFullscreen, openNotice: () => openHinweise(), rebootPending, test: TEST,
    onChange: () => { if (hinweiseWin && !hinweiseWin.isDestroyed()) hinweiseWin.webContents.send('ops-changed'); if (tray) buildTrayMenu(); } });
  zentraleApi = createZentrale({ getSettings: () => settings, setSettings: z => { settings.zentrale = z; saveSettings(); }, onOps: o => ops.update(o), onMedia: () => { if (tray) buildTrayMenu(); }, onKb: () => { if (tray) buildTrayMenu(); },
    onDex: () => { if (checkin) checkin.configChanged(); if (tray) buildTrayMenu(); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-zentrale', zentraleApi.status()); },
    encrypt: secretEnc, decrypt: secretDec, fetch: (u, o) => net.fetch(u, o), log: writeLog, version: app.getVersion(), lang: () => effLang(), test: TEST,
    onEvent: zentraleEvent, visitPrefs: () => ({ allow: settings.visits.allow !== false, name: String(settings.visits.name || '').trim() || os.userInfo().username }),
    healthSummary: () => (health ? health.summary() : null), onQuiz: () => { if (quiz) quiz.serverChanged(); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-zentrale', zentraleApi.status()); },
    onChange: z => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('center-zentrale', z); if (tray) buildTrayMenu(); if (z && z.enrolled) send('flag', 'zentrale'); } });
  zentraleApi.start().catch(e => writeLog('Zentrale: ' + e.message));
  // 1.8.1: eigene YouTube-Kanäle – der PC fragt die öffentlichen Feeds selbst ab (auch ohne Zentrale)
  youtube = createYouTube({ fetch: (u, o) => net.fetch(u, o), log: writeLog, announce: zentraleEvent, base: process.env.SUDO_YT_BASE || 'https://www.youtube.com',
    getState: () => settings.media, setState: o => { settings.media = { ...settings.media, ...o }; writeSettings(); },
    everyMin: TEST && process.env.SUDO_YT_BASE ? 0.1 : 15, firstMin: TEST && process.env.SUDO_YT_BASE ? 0.05 : 2 });
  selfhelp = createSelfHelp({ fetch: (u, o) => net.fetch(u, o), log: writeLog, test: TEST, zentraleUrl: () => (zentraleApi && zentraleApi.status().enrolled ? zentraleApi.status().url : ''),
    slowCtx: () => ({ rebootPending, onBattery: powerMonitor.isOnBatteryPower(), sudoMb: ((diag.view() || {}).now || {}).ram, t: T }),
    onUse: (id, ok) => { if (zentraleApi && zentraleApi.status().enrolled) zentraleApi.selfhelpUsed(id, ok); } });
  if (TEST && process.env.SUDO_OPEN_HELP) setTimeout(() => openSelfHelp(process.env.SUDO_OPEN_HELP === '1' ? null : process.env.SUDO_OPEN_HELP), 1500);
  if (TEST && process.env.SUDO_HELP_CLICK) setTimeout(() => { if (helpWin) helpWin.webContents.executeJavaScript(process.env.SUDO_HELP_CLICK); }, 2800);
  if (TEST && process.env.SUDO_HINWEISE_CLICK) setTimeout(() => { if (hinweiseWin) hinweiseWin.webContents.executeJavaScript(process.env.SUDO_HINWEISE_CLICK); }, (Number(process.env.SUDO_OPEN_HINWEISE) || 2500) + 1500);
  if (TEST && process.env.SUDO_OPEN_MUSIC) setTimeout(openMusic, Number(process.env.SUDO_OPEN_MUSIC) || 4000);
  if (TEST && process.env.SUDO_MUSIC_JS) setTimeout(() => { if (musicWin) musicWin.webContents.executeJavaScript(process.env.SUDO_MUSIC_JS); }, (Number(process.env.SUDO_OPEN_MUSIC) || 4000) + 1500);
  if (TEST && process.env.SUDO_OPEN_HINWEISE) setTimeout(openHinweise, Number(process.env.SUDO_OPEN_HINWEISE) || 2500);
  quiz = createQuiz({ getSettings: () => settings, setQuiz: q => { settings.quiz = q; writeSettings(); }, zentrale: zentraleApi, log: writeLog, test: TEST,
    offer: o => send('quiz_offer', o), isBusy: () => inMeeting || hiddenForFullscreen });
  // 1.10: Gewohnheiten (Sperr-Erinnerung, Tipps) und Mitarbeiter-Erlebnis (Stimmung, Start-Checkliste)
  const busyNow = () => inMeeting || hiddenForFullscreen || locked;
  habits = createHabits({ getState: () => settings.habits, setState: h => { settings.habits = h; writeSettings(); },
    idleSeconds: () => (TEST && process.env.SUDO_IDLE ? Number(process.env.SUDO_IDLE) : powerMonitor.getSystemIdleTime()), isBusy: busyNow,
    currentTag: () => currentAppTag, appName: () => currentAppName, customTips: () => { const d = zentraleApi && zentraleApi.dexConfig && zentraleApi.dexConfig(); return d && d.tips ? d.tips.items : []; },
    tipsAllowed: () => !tipsBlocked(), workday: () => workdayNow(false), notify: m => send('care', m), log: writeLog, test: TEST });
  checkin = createCheckin({ zentrale: () => zentraleApi, getState: () => settings.checkin, setState: c => { settings.checkin = c; writeSettings(); },
    isBusy: busyNow, workday: core => workdayNow(core), notify: m => { send('care', m); if (tray) buildTrayMenu(); }, log: writeLog,
    resolvedAffected: () => (ops ? ops.resolvedAffected() : []), printers: () => (win && !win.isDestroyed() ? win.webContents.getPrintersAsync() : Promise.resolve([])),
    quizAnswered: () => (settings.quiz && settings.quiz.answered) || 0, healthOverall: () => (health ? health.snapshot().overall : 'unknown'),
    onChange: () => { if (startWin && !startWin.isDestroyed()) startWin.webContents.send('start-changed'); if (tray) buildTrayMenu(); }, test: TEST });
  if (TEST && process.env.SUDO_OPEN_MEET) setTimeout(openMeet, Number(process.env.SUDO_OPEN_MEET) || 1500);
  if (TEST && process.env.SUDO_OPEN_PULSE) setTimeout(openPulse, Number(process.env.SUDO_OPEN_PULSE) || 4000);
  if (TEST && process.env.SUDO_OPEN_START) setTimeout(openStart, Number(process.env.SUDO_OPEN_START) || 4000);
  if (TEST && process.env.SUDO_TIP) setTimeout(() => habits.tipNow(process.env.SUDO_TIP), 4000);
  ask = createAsk({ dir: app.getPath('userData'), getSettings: () => settings, getKey: getAiKey, fetch: (u, o) => net.fetch(u, o), log: writeLog,
    contextFn: askContext, zentrale: zentraleApi, lang: () => effLang(), emit: askEmit });
  if (TEST && process.env.SUDO_OPEN_ASK) setTimeout(openAsk, 1500);
  if (TEST && process.env.SUDO_OPEN_PRIVACY) setTimeout(openPrivacy, 1200);
  if (TEST && process.env.SUDO_BUBBLE_TEST) setTimeout(() => send('bubbletest', process.env.SUDO_BUBBLE_TEST === 'alert' ? 'alert' : ''), 2500);
  if (TEST && process.env.SUDO_OPEN_QUIZ) setTimeout(openQuiz, 1500);
  if (TEST && process.env.SUDO_QUIZ_CLICK) setTimeout(() => { if (quizWin) quizWin.webContents.executeJavaScript("document.querySelectorAll('.ans')[" + Number(process.env.SUDO_QUIZ_CLICK) + "].click()"); }, 3200);
  if (TEST && process.env.SUDO_DRAG_SIM) setTimeout(() => win.webContents.executeJavaScript('window.__sudoTest.carryOut()').then(r => writeLog('Test: ' + r), e => writeLog('Test-Fehler: ' + e.message)), 9000);
  if (TEST && process.env.SUDO_DRAG_SIM) setTimeout(() => win.webContents.executeJavaScript('JSON.stringify(window.__sudoTest.state())').then(r => writeLog('Test-Zustand ' + r + ' bounds ' + JSON.stringify(win.getBounds()))), 12000);
  if (TEST && process.env.SUDO_PRIVACY_OUT) setTimeout(() => privacyExport().then(r => writeLog('Test-Auskunft: ' + r.msg)), 4000);
  if (TEST && process.env.SUDO_OPEN_VISIT) setTimeout(openVisit, 3500);
  if (TEST && process.env.SUDO_FAKE_VISIT) setTimeout(() => send('visit', { type: 'visit', visit: 0, kind: process.env.SUDO_FAKE_VISIT, note: 'Kaffee um 3? Ich geb einen aus!', from: 'Kevin', color: '#3ccf7a', rank: 3 }), 4000);
  if (TEST && process.env.SUDO_SITE) setTimeout(() => send('app', { tag: process.env.SUDO_SITE, win: 'x', cursor: { x: 900, y: 400 }, browser: true, force: true }), 5000);
  if (TEST && process.env.SUDO_ASK_Q) setTimeout(() => ask.ask(process.env.SUDO_ASK_Q), 2500);
  const intelTick = () => { if (!locked && net.isOnline()) intel.tick().catch(e => writeLog('IT-Lage: ' + e.message)); };
  setTimeout(intelTick, TEST ? 1500 : 20000);
  setInterval(intelTick, 60000);
  if (TEST && process.env.SUDO_INTEL_RETICK) setTimeout(() => intel.tick(true), Number(process.env.SUDO_INTEL_RETICK));
  if (TEST && process.env.SUDO_OPEN_LAGE) setTimeout(() => openLage(process.env.SUDO_OPEN_LAGE), 2500);
  registerShortcuts();
  initUpdater();
  // Bei zentraler Installation (MSI/Intune) beim allerersten Start automatisch mitstarten
  if (!settings.tourDone && (/program files/i.test(process.execPath) || /^\/(opt|usr)\//.test(process.execPath)) && !settings.autostart) { setAutostart(true); writeSettings(); }
  buildTrayMenu();
  workTimer = setInterval(() => { try { work.tick(); } catch (e) { console.error('[work]', e.message); } }, 1000);
  setInterval(() => work.save(), 60000);
  writeLog('sudo gestartet');
});
app.on('before-quit', () => {
  if (I18N_COLLECT && process.env.SUDO_I18N_OUT) { let old = []; try { old = JSON.parse(fs.readFileSync(process.env.SUDO_I18N_OUT, 'utf8')); } catch { /* neu */ } fs.writeFileSync(process.env.SUDO_I18N_OUT, JSON.stringify([...new Set([...old, ...I18N_COLLECT])], null, 1)); }
  clearInterval(pollTimer);
  clearInterval(relayTimer);
  clearInterval(appTimer);
  clearInterval(workTimer);
  try { globalShortcut.unregisterAll(); watch && watch.stop(); reminders && reminders.stop(); } catch { /* egal */ }
  try { work && work.save(); } catch { /* egal */ }
  try { hook && hook.stop(); } catch { /* egal */ }
  try { server && server.close(); } catch { /* egal */ }
});
app.on('window-all-closed', () => { if (!recreating) app.quit(); });
