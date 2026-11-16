// preload-verlauf.js – Brücke für das Fenster „Was hat Sudo gesagt?“ (1.9)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historyHost', {
  get: () => ipcRenderer.invoke('history-get'),
  clear: () => ipcRenderer.invoke('history-clear'),
  settings: () => ipcRenderer.send('history-settings'),
  open: url => ipcRenderer.send('open-link', String(url)),
  onChange: fn => ipcRenderer.on('history-changed', () => fn())
});
