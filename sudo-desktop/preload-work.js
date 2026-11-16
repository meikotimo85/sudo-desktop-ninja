// preload-work.js – Brücke für das Fenster "Arbeitstag & Pausen"
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workHost', {
  get: () => ipcRenderer.invoke('work-get'),
  save: w => ipcRenderer.invoke('work-save', w)
});
