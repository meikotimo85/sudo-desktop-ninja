// preload-wissen.js – Brücke für das Fenster „Anleitungen“ (1.9)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kbHost', {
  get: () => ipcRenderer.invoke('kb-get'),
  search: q => ipcRenderer.invoke('kb-search', String(q || '').slice(0, 200)),
  open: url => ipcRenderer.send('open-link', String(url)),
  onQuery: fn => ipcRenderer.on('kb-query', (_e, q) => fn(String(q || '')))
});
