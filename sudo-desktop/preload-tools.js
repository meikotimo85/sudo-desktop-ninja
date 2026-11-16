// preload-tools.js – Brücke für den Werkzeugkasten
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolsHost', {
  copy: text => ipcRenderer.send('tools-copy', String(text)),
  md5: text => ipcRenderer.invoke('tools-md5', String(text)),
  onTool: cb => ipcRenderer.on('tools-show', (_e, t) => cb(t))
});
