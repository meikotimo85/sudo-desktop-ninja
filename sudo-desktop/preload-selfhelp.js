// preload-selfhelp.js – Brücke für das Fenster „Selbsthilfe“ (1.6)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helpHost', {
  get: () => ipcRenderer.invoke('selfhelp-get'),
  run: id => ipcRenderer.invoke('selfhelp-run', String(id)),
  open: url => ipcRenderer.send('open-link', String(url))
});
