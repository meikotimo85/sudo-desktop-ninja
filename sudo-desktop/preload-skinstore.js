// preload-skinstore.js – Brücke für den Skin-Store (1.14)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storeHost', {
  get: () => ipcRenderer.invoke('skinstore-get'),
  preview: key => ipcRenderer.invoke('skinstore-preview', String(key)),
  buy: key => ipcRenderer.invoke('skinstore-buy', String(key)),
  wear: key => ipcRenderer.invoke('skinstore-wear', String(key)),
  importFile: () => ipcRenderer.invoke('skinstore-import'),
  folder: () => ipcRenderer.send('skinstore-folder'),
  onFocus: cb => ipcRenderer.on('skinstore-focus', (_e, key) => cb(String(key || ''))),
  onChanged: cb => ipcRenderer.on('skinstore-changed', () => cb())
});
