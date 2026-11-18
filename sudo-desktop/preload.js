// preload.js – schmale, sichere Brücke zwischen Overlay und Hauptprozess
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['platforms', 'layout', 'key', 'event', 'settings', 'summon', 'app', 'keytest', 'meeting', 'care', 'sethome', 'gohome', 'save-now', 'sys', 'reminder', 'toolcopy', 'noted', 'toy', 'game', 'neighbors', 'arrive', 'eco', 'pause', 'tour', 'ask', 'zentrale', 'visit', 'visit_result', 'visit_sent', 'flag', 'quiz_offer', 'quiz_result', 'bubbletest', 'xp_spend']);

contextBridge.exposeInMainWorld('sudoHost', {
  init: () => ipcRenderer.invoke('init'),
  on: (ch, cb) => { if (CHANNELS.has(ch)) ipcRenderer.on(ch, (_e, d) => cb(d)); },
  hitboxes: h => ipcRenderer.send('hitboxes', h),
  deckRun: id => ipcRenderer.invoke('deck-run', String(id)),
  log: m => ipcRenderer.send('log', String(m)),
  stats: s => ipcRenderer.send('stats', s),
  setHome: h => ipcRenderer.send('home-set', h),
  snooze: id => ipcRenderer.send('reminder-snooze', Number(id)),
  setOutfit: o => ipcRenderer.send('outfit-set', o),
  openLink: u => ipcRenderer.send('open-link', String(u).slice(0, 2000)),
  keep: o => ipcRenderer.send('bubble-keep', o),
  reportError: m => ipcRenderer.send('renderer-error', String(m).slice(0, 300)),
  visitDone: (id, result) => ipcRenderer.send('visit-done', { id: Number(id), result: String(result) }),
  travel: dir => ipcRenderer.send('travel', dir === 'left' ? 'left' : 'right'),
  dragOut: (x, y) => ipcRenderer.send('drag-out', { x: Number(x), y: Number(y) }),
  trayMenu: () => ipcRenderer.send('tray-popup')
});
