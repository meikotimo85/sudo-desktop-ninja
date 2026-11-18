// build-website-skins.js – Skin-Galerie der Infoseite (1.14) aus den mitgelieferten Skins erzeugen.
// Aufruf: node tools/build-website-skins.js
// Schreibt sudo-website/skins/<id>.png und sudo-website/skins/katalog.js (als Skript, damit die Seite auch per Doppelklick
// ohne Webserver funktioniert). Eigene, frei herunterladbare Skins: als <id>.sudoskin in sudo-website/skins/ ablegen und
// in EXTRA unten eintragen – sie erscheinen dann mit „Herunterladen“ statt „Im Sudo ansehen“.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '..', 'sudo-website', 'skins');
const kat = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'skins', 'katalog.json'), 'utf8')).skins;
const EXTRA = [];        // z. B. { id: 'sommer-ninja', name: 'Sommer-Ninja', price: 0, download: 'sommer-ninja.sudoskin' } (Grafik als sommer-ninja.png daneben)

fs.mkdirSync(out, { recursive: true });
for (const s of kat) fs.copyFileSync(path.join(root, 'assets', 'skins', s.id, 'sudo-sheet.png'), path.join(out, s.id + '.png'));
const list = [...kat.map(s => ({ id: s.id, name: s.name, price: s.price })), ...EXTRA];
fs.writeFileSync(path.join(out, 'katalog.js'),
  '// katalog.js – erzeugt von sudo-desktop/tools/build-website-skins.js, nicht von Hand bearbeiten\n' +
  'window.SUDO_SKINS = ' + JSON.stringify(list, null, 1) + ';\n');
console.log(`${list.length} Skins nach sudo-website/skins geschrieben`);
