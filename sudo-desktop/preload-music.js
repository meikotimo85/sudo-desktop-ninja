// preload-music.js – Brücke für das Fenster „Musikwunsch“ (1.8)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicHost', {
  get: () => ipcRenderer.invoke('music-get'),
  search: q => ipcRenderer.invoke('music-search', String(q || '')),
  request: id => ipcRenderer.invoke('music-request', String(id || ''))
});
