// preload-privacy.js – Brücke für das Fenster „Was weiß Sudo über mich?“
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('privacyHost', {
  get: () => ipcRenderer.invoke('privacy-get'),
  act: a => ipcRenderer.invoke('privacy-act', a)
});
