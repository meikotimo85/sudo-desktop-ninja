// preload-stimmung.js – Brücke für das Fenster „Kurze Frage deiner IT“ (1.10)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseHost', {
  get: () => ipcRenderer.invoke('pulse-get'),
  answer: a => ipcRenderer.invoke('pulse-answer', { id: Number(a.id), score: Number(a.score) || 0, comment: String(a.comment || '').slice(0, 300), skip: !!a.skip }),
  incident: (id, ok) => ipcRenderer.invoke('pulse-incident', { id: Number(id), ok: !!ok }),
  open: url => ipcRenderer.send('open-link', String(url))
});
