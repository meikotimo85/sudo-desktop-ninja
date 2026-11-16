// preload-meet.js – Brücke für das Fenster „Meeting-Check: Ton & Bild“ (1.10)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetHost', {
  net: () => ipcRenderer.invoke('meet-net'),
  done: ok => ipcRenderer.send('meet-done', !!ok),
  open: url => ipcRenderer.send('open-link', String(url))
});
