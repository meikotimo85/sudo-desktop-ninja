// preload-wardrobe.js – Brücke für die Garderobe
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wardrobeHost', {
  get: () => ipcRenderer.invoke('wardrobe-get'),
  set: o => ipcRenderer.invoke('wardrobe-set', o),
  onUpdate: cb => ipcRenderer.on('wardrobe-update', (_e, d) => cb(d))
});
