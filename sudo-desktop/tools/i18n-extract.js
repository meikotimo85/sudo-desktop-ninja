// i18n-extract.js – sammelt alle deutschen Texte aus Code und HTML (Hilfe beim Pflegen der Wörterbücher)
// Aufruf: node tools/i18n-extract.js [en|ja]  → listet Texte, die im Wörterbuch noch fehlen
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['main.js', 'intel.js', 'reminders.js', 'work.js', 'watch.js', 'ask.js', 'zentrale.js', 'slow.js', 'habits.js', 'checkin.js', 'selfhelp.js',
  ...fs.readdirSync(path.join(ROOT, 'renderer')).filter(f => /\.(js|html)$/.test(f) && !['i18n.js', 'sprite.js', 'sheet.js'].includes(f)).map(f => 'renderer/' + f)];
const found = new Map();
const germanish = s => /[a-zäöüß]/.test(s) && (/[äöüÄÖÜß]/.test(s) || /\s/.test(s.trim()) || /^[A-ZÄÖÜ][a-zäöüß]+[ .!?…:]*$/.test(s.trim()));
const codeish = s => /^[\w.-]+$/.test(s) && !/^[A-ZÄÖÜ]/.test(s) || /=>|\bfunction\b|\$\(|^#|^\.|^\[|px|rgba?\(|^https?:|^[a-z-]+:[^ ]|\.(png|json|js|html|css|exe|txt|log)\b|^--|ipcRenderer|webContents|\\[dsw]/.test(s) || /^[a-z]+([A-Z][a-z]+)+$/.test(s);
function add(s, file) {
  s = s.trim();
  if (s.length < 2 || !germanish(s) || codeish(s)) return;
  if (!found.has(s)) found.set(s, new Set());
  found.get(s).add(file);
}
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f.endsWith('.html')) {
    const body = src.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    for (const m of body.matchAll(/>([^<>]+)</g)) add(m[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '), f);
    for (const m of body.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)) add(m[1].replace(/&amp;/g, '&'), f);
    continue;
  }
  let code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    // Protokoll-Zeilen, Testhaken und der Diagnose-Bericht bleiben deutsch
    .replace(/\b(writeLog|log|console\.\w+)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/^.*\bTEST\b.*$/gm, '')
    .replace(/async function diagnostics\(\)[\s\S]*?\n\}\n/, '');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    let s = m[1] ?? m[2] ?? m[3];
    if (m[3] != null) { if (/<\w/.test(s)) { for (const h of s.matchAll(/>([^<>$]+)</g)) add(h[1], f); } let i = 0; s = s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{v${++i}}`); }
    s = s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\u200C/g, '');
    if (/<\w[^>]*>/.test(s)) { for (const h of s.split(/<[^>]+>/)) add(h, f); continue; }
    add(s, f);
  }
}
const lang = process.argv.slice(2).find(a => !a.startsWith('--'));
let have = new Set();
if (lang) { const d = require(path.join(ROOT, 'renderer/lang', lang + '.js')); have = new Set(Object.keys(d.table)); }
const out = [...found.keys()].filter(k => !have.has(k)).sort((a, b) => a.localeCompare(b, 'de'));
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else { for (const k of out) console.log(JSON.stringify(k), '  //', [...found.get(k)].join(',')); console.error(out.length + ' Texte'); }
