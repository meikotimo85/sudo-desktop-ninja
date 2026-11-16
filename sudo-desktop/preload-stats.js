// preload-stats.js – Brücke für das Statistik-Fenster
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statsHost', {
  get: () => ipcRenderer.invoke('stats-get'),
  summary: () => ipcRenderer.invoke('work-summary'),
  clearScreenTime: () => ipcRenderer.invoke('screentime-clear'),
  onUpdate: cb => ipcRenderer.on('stats-update', (_e, s) => cb(s))
});
