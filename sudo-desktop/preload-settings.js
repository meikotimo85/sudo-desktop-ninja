// preload-settings.js – Brücke für das Fenster "Relay einrichten"
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relayHost', {
  get: () => ipcRenderer.invoke('relay-get'),
  test: d => ipcRenderer.invoke('relay-test', d),
  save: d => ipcRenderer.invoke('relay-save', d),
  onStatus: cb => ipcRenderer.on('relay-status', (_e, s) => cb(s))
});
