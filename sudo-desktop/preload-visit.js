// preload-visit.js – Brücke für das Fenster „Auf Besuch schicken“
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visitHost', {
  peers: () => ipcRenderer.invoke('visit-peers'),
  send: v => ipcRenderer.invoke('visit-send', v)
});
