// preload-tour.js – Brücke für die Willkommens-Tour
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tourHost', {
  get: () => ipcRenderer.invoke('tour-get'),
  step: n => ipcRenderer.send('tour-step', Number(n)),
  finish: opts => ipcRenderer.invoke('tour-finish', opts)
});
