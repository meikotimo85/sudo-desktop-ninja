// win32.js – liest die sichtbaren Fenster über die Windows-API (via koffi, ohne Compiler)
// Liefert Rechtecke in physischen Pixeln, in Z-Reihenfolge (oberstes zuerst).
'use strict';

const isWin = process.platform === 'win32';
let api = null;

if (isWin) {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwm = koffi.load('dwmapi.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const HWND = koffi.pointer('HWND', koffi.opaque());
    const HANDLE = koffi.pointer('HANDLE', koffi.opaque());

    api = {
      koffi,
      GetTopWindow: user32.func('HWND __stdcall GetTopWindow(HWND hWnd)'),
      GetWindow: user32.func('HWND __stdcall GetWindow(HWND hWnd, uint32_t uCmd)'),
      GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hWnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(HWND hWnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(HWND hWnd)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hWnd, void *buf, int max)'),
      GetWindowLongW: user32.func('long __stdcall GetWindowLongW(HWND hWnd, int index)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(HWND hWnd, void *rect)'),
      DwmGetWindowAttribute: dwm.func('long __stdcall DwmGetWindowAttribute(HWND hWnd, uint32_t attr, void *pv, uint32_t cb)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hWnd, void *buf, int max)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *pid)'),
      OpenProcess: kernel32.func('HANDLE __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE h, uint32_t flags, void *buf, _Inout_ uint32_t *size)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(HANDLE h)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      // Gleiche Funktion, aber mit dem Fenster als Zahl (eigenes Overlay, Adresse aus handleToId)
      GetWindowLongById: user32.func('long __stdcall GetWindowLongW(intptr_t hWnd, int index)')
    };
  } catch (err) {
    console.error('[win32] koffi konnte nicht geladen werden:', err.message);
    api = null;
  }
}

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow', 'Xaml_WindowedPopupClass']);

const rectBuf = Buffer.alloc(16);
const cloakBuf = Buffer.alloc(4);
const classBuf = Buffer.alloc(512);

function addr(h) { return h ? api.koffi.address(h).toString() : '0'; }

function className(h) {
  const n = api.GetClassNameW(h, classBuf, 256);
  return n > 0 ? classBuf.toString('utf16le', 0, n * 2) : '';
}

function rectOf(h) {
  // DWM-Rahmen ohne die unsichtbaren Schatten-Ränder; Fallback auf GetWindowRect
  if (api.DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, rectBuf, 16) !== 0) {
    if (!api.GetWindowRect(h, rectBuf)) return null;
  }
  const r = { left: rectBuf.readInt32LE(0), top: rectBuf.readInt32LE(4), right: rectBuf.readInt32LE(8), bottom: rectBuf.readInt32LE(12) };
  if (r.right - r.left < 1 || r.bottom - r.top < 1) return null;
  return r;
}

function isCloaked(h) {
  cloakBuf.writeUInt32LE(0, 0);
  if (api.DwmGetWindowAttribute(h, DWMWA_CLOAKED, cloakBuf, 4) !== 0) return false;
  return cloakBuf.readUInt32LE(0) !== 0;
}

/**
 * Alle sichtbaren App-Fenster, oberstes zuerst.
 * @param {string} ownId  Adresse des eigenen Overlay-Fensters (wird übersprungen)
 * @returns {{id:string, cls:string, rect:{left,top,right,bottom}}[]}
 */
function listWindows(ownId) {
  if (!api) return [];
  const out = [];
  let h = api.GetTopWindow(null);
  let guard = 0;
  while (h && guard++ < 2000) {
    const id = addr(h);
    if (id !== ownId && api.IsWindowVisible(h) && !api.IsIconic(h)) {
      const ex = api.GetWindowLongW(h, GWL_EXSTYLE) >>> 0;
      if (!(ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_NOACTIVATE) && api.GetWindowTextLengthW(h) > 0) {
        const cls = className(h);
        if (!SKIP_CLASSES.has(cls) && !isCloaked(h)) {
          const rect = rectOf(h);
          if (rect) out.push({ id, cls, rect, exe: exeOf(h) });
        }
      }
    }
    h = api.GetWindow(h, GW_HWNDNEXT);
  }
  return out;
}

const titleBuf = Buffer.alloc(1024);
const exeBuf = Buffer.alloc(1040);
const exeCache = new Map();
function exeOf(h) {
  try {
    const pid = [0];
    api.GetWindowThreadProcessId(h, pid);
    if (!pid[0]) return '';
    if (exeCache.has(pid[0])) return exeCache.get(pid[0]);
    const ph = api.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid[0]);
    if (!ph) return '';
    const size = [520];
    let name = '';
    if (api.QueryFullProcessImageNameW(ph, 0, exeBuf, size)) {
      name = exeBuf.toString('utf16le', 0, size[0] * 2).split('\\').pop().toLowerCase();
    }
    api.CloseHandle(ph);
    if (exeCache.size > 300) exeCache.clear();
    exeCache.set(pid[0], name);
    return name;
  } catch { return ''; }
}
function titleOf(h) {
  const n = api.GetWindowTextW(h, titleBuf, 512);
  return n > 0 ? titleBuf.toString('utf16le', 0, n * 2) : '';
}

/** Fenster im Vordergrund (Vollbild-Erkennung und Programm-Reaktionen) */
function foreground(withInfo = false) {
  if (!api) return null;
  const h = api.GetForegroundWindow();
  if (!h) return null;
  const cls = className(h);
  if (SKIP_CLASSES.has(cls)) return null;
  const rect = rectOf(h);
  if (!rect) return null;
  const out = { id: addr(h), cls, rect };
  if (withInfo) { out.exe = exeOf(h); out.title = titleOf(h); }
  return out;
}

function handleToId(buf) {
  // getNativeWindowHandle() liefert einen Buffer mit dem HWND
  try { return (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString(); }
  catch { return '0'; }
}

/** Alle sichtbaren Fenster mit Programmname und Titel (auch minimierte), für die Meeting-Erkennung */
function windowInfos() {
  if (!api) return [];
  const out = [];
  let h = api.GetTopWindow(null), guard = 0;
  while (h && guard++ < 2000) {
    if (api.IsWindowVisible(h) && api.GetWindowTextLengthW(h) > 0) {
      const exe = exeOf(h);
      if (exe) out.push({ exe, title: titleOf(h) });
    }
    h = api.GetWindow(h, GW_HWNDNEXT);
  }
  return out;
}

/** Läuft die Sitzung gerade über Remotedesktop (RDP)? (SM_REMOTESESSION) */
function remoteSession() {
  if (!api) return false;
  try { return api.GetSystemMetrics(0x1000) !== 0; } catch { return false; }
}

/** Erweiterter Fensterstil eines Fensters (für den Diagnose-Bericht) */
function exStyle(id) {
  if (!api || !id || id === '0') return null;
  try { return api.GetWindowLongById(BigInt(id), GWL_EXSTYLE) >>> 0; } catch { return null; }
}

module.exports = { available: () => !!api, listWindows, foreground, windowInfos, handleToId, remoteSession, exStyle };
