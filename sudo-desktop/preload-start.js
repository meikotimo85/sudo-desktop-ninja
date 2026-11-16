// preload-start.js – Brücke für das Fenster „Start-Checkliste“ (1.10)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('startHost', {
  get: () => ipcRenderer.invoke('start-get'),
  mark: (id, done) => ipcRenderer.invoke('start-mark', { id: Number(id), done: !!done }),
  recheck: () => ipcRenderer.invoke('start-recheck'),
  open: url => ipcRenderer.send('open-link', String(url)),
  onChange: fn => ipcRenderer.on('start-changed', () => fn())
});
