// preload-lage.js – Brücke für das Fenster „IT-Lage“
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lageHost', {
  get: () => ipcRenderer.invoke('lage-get'),
  refresh: () => ipcRenderer.invoke('lage-refresh'),
  config: c => ipcRenderer.invoke('lage-config', c),
  emails: () => ipcRenderer.invoke('lage-emails'),
  checkMails: () => ipcRenderer.invoke('lage-mails'),
  checkPassword: pw => ipcRenderer.invoke('lage-password', String(pw || '')),
  open: url => ipcRenderer.send('open-link', String(url)),
  onUpdate: cb => ipcRenderer.on('lage-update', (_e, s) => cb(s)),
  onTab: cb => ipcRenderer.on('lage-tab', (_e, t) => cb(t)),
  health: () => ipcRenderer.invoke('health-get'),
  healthCheck: () => ipcRenderer.invoke('health-check'),
  onHealth: cb => ipcRenderer.on('health-update', (_e, s) => cb(s))
});
