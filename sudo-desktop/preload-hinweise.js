// preload-hinweise.js – Brücke für das Fenster „Hinweise deiner IT“ (Störungen, Neustart) – 1.6
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opsHost', {
  get: () => ipcRenderer.invoke('ops-get'),
  affected: (id, on) => ipcRenderer.invoke('ops-affected', { id: Number(id), on: !!on }),
  snooze: (id, opt) => ipcRenderer.invoke('ops-snooze', { id: Number(id), opt: String(opt) }),
  restart: id => ipcRenderer.invoke('ops-restart', Number(id)),
  cancel: () => ipcRenderer.invoke('ops-cancel'),
  open: url => ipcRenderer.send('open-link', String(url)),
  kb: q => ipcRenderer.invoke('kb-suggest', String(q).slice(0, 200)),
  onChange: fn => ipcRenderer.on('ops-changed', () => fn())
});
