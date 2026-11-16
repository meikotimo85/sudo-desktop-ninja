// preload-quick.js – Brücke für Erinnerungen & Notizen
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickHost', {
  parse: text => ipcRenderer.invoke('quick-parse', String(text)),
  add: text => ipcRenderer.invoke('quick-add', String(text)),
  remove: id => ipcRenderer.invoke('quick-remove', Number(id)),
  list: () => ipcRenderer.invoke('quick-list')
});
