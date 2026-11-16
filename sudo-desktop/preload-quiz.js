// preload-quiz.js – Brücke für das Fenster „Security-Quiz“
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quizHost', {
  next: () => ipcRenderer.invoke('quiz-next'),
  answer: (id, choice) => ipcRenderer.invoke('quiz-answer', { id: String(id), choice: Number(choice) }),
  open: url => ipcRenderer.send('open-link', String(url))
});
