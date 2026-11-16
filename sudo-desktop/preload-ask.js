// preload-ask.js – Brücke für das Fenster „Frag Sudo“
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('askHost', {
  status: () => ipcRenderer.invoke('ask-status'),
  send: (q, model) => ipcRenderer.invoke('ask-send', String(q || ''), model),
  cancel: () => ipcRenderer.send('ask-cancel'),
  reset: () => ipcRenderer.invoke('ask-reset'),
  history: () => ipcRenderer.invoke('ask-history'),
  copy: text => ipcRenderer.send('tools-copy', String(text || '')),
  open: url => ipcRenderer.send('open-link', String(url).slice(0, 2000)),
  settings: () => ipcRenderer.invoke('center-action', 'aiSettings'),
  onEvent: cb => ipcRenderer.on('ask-event', (_e, d) => cb(d))
});
