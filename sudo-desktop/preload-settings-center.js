// preload-settings-center.js – Brücke für die Einstellungs-Zentrale
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('centerHost', {
  get: () => ipcRenderer.invoke('center-get'),
  set: (key, value) => ipcRenderer.invoke('center-set', String(key), value),
  action: (name, arg) => ipcRenderer.invoke('center-action', String(name), arg),
  onTab: cb => ipcRenderer.on('settings-tab', (_e, t) => cb(t)),
  onUpdate: cb => ipcRenderer.on('center-update', (_e, u) => cb(u)),
  onZentrale: cb => ipcRenderer.on('center-zentrale', (_e, z) => cb(z)),
  onDiag: cb => ipcRenderer.on('center-diag', () => cb())
});
