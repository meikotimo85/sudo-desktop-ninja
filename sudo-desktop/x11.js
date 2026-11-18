// x11.js – Gegenstück zu win32.js für Linux (1.12): liest die sichtbaren Fenster über libX11 (via koffi, ohne Compiler)
// Gleiche Schnittstelle wie win32.js: Rechtecke in physischen Pixeln, oberstes Fenster zuerst.
// Läuft unter X11 und unter Wayland über XWayland (main.js startet Electron dort mit --ozone-platform=x11).
// Programmnamen werden auf die Windows-Schreibweise gebracht (z. B. „code“ → „code.exe“),
// damit die Erkennung in main.js (APP_TAGS, BROWSERS, MEETING) unverändert für beide Systeme gilt.
'use strict';

const fs = require('fs');

const isLinux = process.platform === 'linux';
let api = null, dpy = null, root = 0, keepHandler = null;
let queryPointer = null;              // bleibt auch ohne Fenstermanager nutzbar (Maus für das Durchklicken)
const atoms = {};
const ANY = 0;                        // AnyPropertyType

if (isLinux && process.env.DISPLAY) {
  try {
    const koffi = require('koffi');
    const x = koffi.load('libX11.so.6');
    const XErrorHandler = koffi.proto('int XErrorHandler(void *dpy, void *ev)');
    api = {
      koffi,
      XOpenDisplay: x.func('void *XOpenDisplay(const char *name)'),
      XDefaultRootWindow: x.func('unsigned long XDefaultRootWindow(void *dpy)'),
      XInternAtom: x.func('unsigned long XInternAtom(void *dpy, const char *name, int onlyIfExists)'),
      XGetWindowProperty: x.func('int XGetWindowProperty(void *dpy, unsigned long w, unsigned long prop, long off, long len, int del, unsigned long reqType, _Out_ unsigned long *actualType, _Out_ int *actualFormat, _Out_ unsigned long *nitems, _Out_ unsigned long *bytesAfter, _Out_ void **data)'),
      XGetGeometry: x.func('int XGetGeometry(void *dpy, unsigned long d, _Out_ unsigned long *root, _Out_ int *x, _Out_ int *y, _Out_ unsigned int *w, _Out_ unsigned int *h, _Out_ unsigned int *border, _Out_ unsigned int *depth)'),
      XTranslateCoordinates: x.func('int XTranslateCoordinates(void *dpy, unsigned long src, unsigned long dest, int sx, int sy, _Out_ int *dx, _Out_ int *dy, _Out_ unsigned long *child)'),
      XFree: x.func('int XFree(void *data)'),
      XQueryPointer: x.func('int XQueryPointer(void *dpy, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)'),
      XSetErrorHandler: x.func('void *XSetErrorHandler(XErrorHandler *handler)')
    };
    // Ohne eigenen Fehler-Handler beendet Xlib den ganzen Prozess, wenn ein Fenster zwischen Liste und Abfrage verschwindet
    queryPointer = api.XQueryPointer;
    keepHandler = koffi.register(() => 0, koffi.pointer(XErrorHandler));
    api.XSetErrorHandler(keepHandler);
    dpy = api.XOpenDisplay(null);
    if (!dpy) throw new Error('Kein X-Display');
    root = api.XDefaultRootWindow(dpy);
    for (const n of ['_NET_CLIENT_LIST_STACKING', '_NET_CLIENT_LIST', '_NET_ACTIVE_WINDOW', '_NET_WM_STATE', '_NET_WM_STATE_HIDDEN',
      '_NET_WM_WINDOW_TYPE', '_NET_WM_WINDOW_TYPE_NORMAL', '_NET_WM_WINDOW_TYPE_DIALOG', '_NET_WM_DESKTOP', '_NET_CURRENT_DESKTOP',
      '_NET_FRAME_EXTENTS', '_GTK_FRAME_EXTENTS', '_NET_WM_NAME', 'WM_NAME', 'UTF8_STRING', '_NET_WM_PID', 'WM_CLASS',
      '_NET_WM_WINDOW_TYPE_DOCK', '_NET_SUPPORTED']) {
      atoms[n] = api.XInternAtom(dpy, n, 0);
    }
    // Nicht abschalten, wenn die Fensterliste (noch) leer ist: Beim Autostart nach der Anmeldung ist oft kein Fenster offen
    // und der Fenstermanager startet evtl. erst danach. Ohne EWMH-Fenstermanager liefern die Abfragen einfach leere Listen.
    if (!prop(root, '_NET_SUPPORTED', 'long', 1)) console.error('[x11] noch kein EWMH-Fenstermanager – Fensterkanten erscheinen, sobald er läuft');
  } catch (err) {
    console.error('[x11] libX11 konnte nicht geladen werden:', err.message);
    api = null;
  }
}

/**
 * Fenster-Eigenschaft lesen.
 * @param {number} w  Fenster
 * @param {string} name  Atom-Name
 * @param {'long'|'string'} kind  32-Bit-Liste (Xlib liefert C-long) oder Text
 * @param {number} max  höchstens so viele Einträge (long) bzw. Bytes/4 (string)
 * @returns {number[]|string|null}
 */
function prop(w, name, kind, max = 64) {
  const type = [0], format = [0], n = [0], after = [0], data = [null];
  if (api.XGetWindowProperty(dpy, w, atoms[name], 0, max, 0, ANY, type, format, n, after, data) !== 0) return null;
  const p = data[0];
  if (!p) return null;
  try {
    if (!type[0] || !n[0]) return null;
    if (kind === 'string') {
      if (format[0] !== 8) return null;
      return Buffer.from(api.koffi.decode(p, api.koffi.array('uint8_t', n[0]))).toString('utf8');
    }
    if (format[0] !== 32) return null;
    return Array.from(api.koffi.decode(p, api.koffi.array('unsigned long', n[0])), Number);
  } finally { api.XFree(p); }
}

function geometry(w) {
  const r = [0], x = [0], y = [0], ww = [0], hh = [0], b = [0], d = [0];
  if (!api.XGetGeometry(dpy, w, r, x, y, ww, hh, b, d)) return null;
  const ax = [0], ay = [0], child = [0];
  if (!api.XTranslateCoordinates(dpy, w, root, 0, 0, ax, ay, child)) return null;
  return { x: ax[0], y: ay[0], w: ww[0], h: hh[0] };
}

/** Sichtbarer Rahmen: bei Server-Dekoration plus Titelleiste, bei GTK-Client-Dekoration ohne Schatten */
function rectOf(w) {
  const g = geometry(w);
  if (!g || g.w < 2 || g.h < 2) return null;
  let l = g.x, t = g.y, r = g.x + g.w, b = g.y + g.h;
  const gtk = prop(w, '_GTK_FRAME_EXTENTS', 'long', 4);       // links, rechts, oben, unten (Schatten im Fenster)
  if (gtk && gtk.length === 4) { l += gtk[0]; r -= gtk[1]; t += gtk[2]; b -= gtk[3]; }
  else {
    const fr = prop(w, '_NET_FRAME_EXTENTS', 'long', 4);      // Rahmen des Fenstermanagers außen herum
    if (fr && fr.length === 4) { l -= fr[0]; r += fr[1]; t -= fr[2]; b += fr[3]; }
  }
  if (r - l < 1 || b - t < 1) return null;
  return { left: l, top: t, right: r, bottom: b };
}

function isNormal(w) {
  const types = prop(w, '_NET_WM_WINDOW_TYPE', 'long', 8);
  if (types && types.length && !types.some(a => a === atoms._NET_WM_WINDOW_TYPE_NORMAL || a === atoms._NET_WM_WINDOW_TYPE_DIALOG)) return false;
  const state = prop(w, '_NET_WM_STATE', 'long', 16);
  if (state && state.includes(atoms._NET_WM_STATE_HIDDEN)) return false;     // minimiert
  return true;
}
function onCurrentDesktop(w, cur) {
  if (cur == null) return true;
  const d = prop(w, '_NET_WM_DESKTOP', 'long', 1);
  return !d || d[0] === cur || d[0] === 0xFFFFFFFF || d[0] === -1;
}

// Linux-Programme auf die Namen bringen, die main.js von Windows kennt
const EXE_MAP = {
  'gnome-terminal-server': 'windowsterminal', konsole: 'windowsterminal', xterm: 'windowsterminal', alacritty: 'windowsterminal',
  tilix: 'windowsterminal', 'xfce4-terminal': 'windowsterminal', terminator: 'windowsterminal', 'wezterm-gui': 'windowsterminal',
  ptyxis: 'windowsterminal', kgx: 'windowsterminal', foot: 'windowsterminal',
  kitty: 'windowsterminal',   // unter Windows heißt „kitty“ der SSH-Client, unter Linux ist es ein Terminal
  'teams-for-linux': 'teams', codium: 'codium', 'code-insiders': 'code - insiders',
  'gnome-text-editor': 'notepad', gedit: 'notepad', kate: 'notepad', kwrite: 'notepad', mousepad: 'notepad', pluma: 'notepad', xed: 'notepad',
  remmina: 'msrdc', xfreerdp: 'msrdc', 'xfreerdp3': 'msrdc', 'gnome-connections': 'msrdc',
  'gnome-system-monitor': 'taskmgr', 'plasma-systemmonitor': 'taskmgr', ksysguard: 'taskmgr', 'xfce4-taskmanager': 'taskmgr',
  'google-chrome': 'chrome', chromium: 'chrome', 'chromium-browser': 'chrome', 'microsoft-edge': 'msedge',
  'brave-browser': 'brave', 'firefox-esr': 'firefox', 'firefox-bin': 'firefox',
  phpstorm: 'phpstorm64', webstorm: 'webstorm64', idea: 'idea64', 'jetbrains-phpstorm': 'phpstorm64', 'jetbrains-idea': 'idea64'
};
const exeCache = new Map();
function exeOf(w) {
  const pid = prop(w, '_NET_WM_PID', 'long', 1);
  if (!pid || !pid[0]) return '';
  const p = pid[0];
  if (exeCache.has(p)) return exeCache.get(p);
  let name = '';
  try { name = fs.readlinkSync(`/proc/${p}/exe`).split('/').pop(); } catch { /* fremder Benutzer oder Flatpak */ }
  if (!name || /^(java|python3?|node|electron|bwrap)$/.test(name)) {
    // Java-IDEs, Flatpaks und Electron-Apps: der Fensterklassen-Name ist aussagekräftiger
    const cls = (prop(w, 'WM_CLASS', 'string', 64) || '').split('\0').filter(Boolean).pop() || '';
    if (cls) name = cls;
    else if (!name) { try { name = fs.readFileSync(`/proc/${p}/comm`, 'utf8').trim(); } catch { /* egal */ } }
  }
  name = name.toLowerCase().replace(/\s+\(deleted\)$/, '').replace(/\.(bin|real|sh|appimage)$/, '');
  name = name ? (EXE_MAP[name] || name) + '.exe' : '';
  if (exeCache.size > 300) exeCache.clear();
  exeCache.set(p, name);
  return name;
}
function titleOf(w) {
  return prop(w, '_NET_WM_NAME', 'string', 256) || prop(w, 'WM_NAME', 'string', 256) || '';
}

function stacking() {
  const list = prop(root, '_NET_CLIENT_LIST_STACKING', 'long', 4096) || prop(root, '_NET_CLIENT_LIST', 'long', 4096) || [];
  return list.reverse();     // EWMH: unten → oben, wir wollen oben zuerst
}
function currentDesktop() {
  const c = prop(root, '_NET_CURRENT_DESKTOP', 'long', 1);
  return c ? c[0] : null;
}

/**
 * Alle sichtbaren App-Fenster, oberstes zuerst.
 * @param {string} ownId  Kennung des eigenen Overlay-Fensters (wird übersprungen)
 */
function listWindows(ownId) {
  if (!api) return [];
  const out = [], cur = currentDesktop();
  for (const w of stacking()) {
    const id = String(w);
    if (id === ownId || !isNormal(w) || !onCurrentDesktop(w, cur) || !titleOf(w)) continue;
    const rect = rectOf(w);
    if (rect) out.push({ id, cls: '', rect, exe: exeOf(w) });
  }
  return out;
}

/** Fenster im Vordergrund (Vollbild-Erkennung und Programm-Reaktionen) */
function foreground(withInfo = false) {
  if (!api) return null;
  const a = prop(root, '_NET_ACTIVE_WINDOW', 'long', 1);
  if (!a || !a[0]) return null;
  const w = a[0];
  const rect = rectOf(w);
  if (!rect) return null;
  const out = { id: String(w), cls: '', rect };
  if (withInfo) { out.exe = exeOf(w); out.title = titleOf(w); }
  return out;
}

function handleToId(buf) {
  // getNativeWindowHandle() liefert unter X11 die Fensternummer (XID)
  try { return (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString(); }
  catch { return '0'; }
}

/** Alle Fenster mit Programmname und Titel (auch minimierte), für die Meeting-Erkennung */
function windowInfos() {
  if (!api) return [];
  const out = [];
  for (const w of stacking()) {
    const exe = exeOf(w);
    if (exe) out.push({ exe, title: titleOf(w) });
  }
  return out;
}

/**
 * Mausposition in physischen Pixeln direkt vom X-Server.
 * Electrons screen.getCursorScreenPoint() liefert unter Linux nur die letzte Position, die eines seiner
 * Fenster gesehen hat – über einem durchklickbaren Overlay bleibt sie stehen und Sudo wäre nie anklickbar.
 */
function cursor() {
  if (!dpy || !queryPointer) return null;
  const r = [0], c = [0], x = [0], y = [0], wx = [0], wy = [0], m = [0];
  try { return queryPointer(dpy, root, r, c, x, y, wx, wy, m) ? { x: x[0], y: y[0] } : null; } catch { return null; }
}

/**
 * Freie Fläche je Monitor (ohne Leisten), physische Pixel: [{x, y, w, h}] oder null.
 * Electron kennt unter X11 nur die Arbeitsfläche des Hauptmonitors – auf weiteren Monitoren stünde Sudo sonst vor der Leiste.
 * 1. GNOME, Cinnamon, MATE, Budgie: _GTK_WORKAREAS_D<Arbeitsfläche> am Wurzelfenster (eine Fläche je Monitor)
 * 2. KDE, Xfce & Co.: Leisten-Fenster (Typ DOCK) mit ihrer Reservierung am Bildschirmrand
 */
function workAreas() {
  if (!api) return null;
  const cur = currentDesktop() || 0;
  const name = '_GTK_WORKAREAS_D' + cur;
  if (!atoms[name]) atoms[name] = api.XInternAtom(dpy, name, 0);
  const gtk = prop(root, name, 'long', 64);
  if (gtk && gtk.length >= 4 && gtk.length % 4 === 0) {
    const out = [];
    for (let i = 0; i < gtk.length; i += 4) out.push({ x: gtk[i], y: gtk[i + 1], w: gtk[i + 2], h: gtk[i + 3] });
    return { kind: 'areas', list: out };
  }
  const docks = [];
  for (const w of prop(root, '_NET_CLIENT_LIST', 'long', 4096) || []) {
    const types = prop(w, '_NET_WM_WINDOW_TYPE', 'long', 8);
    if (!types || !types.includes(atoms._NET_WM_WINDOW_TYPE_DOCK)) continue;
    const g = geometry(w);
    if (g && g.w > 0 && g.h > 0) docks.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  }
  return docks.length ? { kind: 'docks', list: docks } : null;
}

/** Läuft die Sitzung über Remotedesktop? Unter Linux: xrdp (auch die „erweiterte Sitzung“ von Hyper-V) */
function remoteSession() {
  return !!(process.env.XRDP_SESSION || process.env.XRDP_SOCKET_PATH);
}

/** Fensterstil gibt es nur unter Windows – der Diagnose-Bericht lässt die Angabe dann weg */
function exStyle() { return null; }

/** Dateizuordnungen meldet Linux über die Desktop-Datenbank selbst – hier nichts zu tun */
function notifyAssocChanged() { /* nichts */ }

module.exports = { available: () => !!api, listWindows, foreground, windowInfos, handleToId, remoteSession, exStyle, notifyAssocChanged, cursor, workAreas };
