// build-plugin-icon.js – Dateisymbole für .sudoplugin und .sudoskin (assets/*-file.ico und *.png), Pixel-Art ohne Fremdpakete.
// Aufruf: node tools/build-plugin-icon.js
// Motiv: Blatt Papier mit Textzeilen, davor ein Symbol aus dem Tray-Menü (tools/build-menu-icons.py):
//   plugin-file – violettes Puzzleteil (1.13)      skin-file – türkiser Umhang aus der Garderobe (1.14)
// Das ICO enthält 16, 24, 32, 48, 64 und 256 px, jeweils als PNG und pixelgenau vergrößert; das PNG (256 px) ist für Linux.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const py = fs.readFileSync(path.join(__dirname, 'build-menu-icons.py'), 'utf8');
// Farben und Symbole aus dem Menü-Generator übernehmen, damit alles gleich aussieht
const PAL = {};
for (const m of py.match(/PAL = \{([\s\S]*?)\}\n/)[1].matchAll(/'(\w)': \((\d+), (\d+), (\d+)\)/g)) PAL[m[1]] = [+m[2], +m[3], +m[4]];
const pattern = name => [...py.match(new RegExp(`'${name}':\\s*\\[([\\s\\S]*?)\\]`))[1].matchAll(/'([^']*)'/g)].map(m => m[1]);

const PAGE = [
  '.KKKKKKKK.......',
  '.KWWWWWWKK......',
  '.KWWWWWWKSK.....',
  '.KWWWWWWKKKK....',
  '.KWWWWWWWWWK....',
  '.KWMMMMMMWWK....',
  '.KWWWWWWWWWK....',
  '.KWMMMMMWWWK....',
  '.KWWWWWWWWWK....',
  '.KWMMMMWWWWK....',
  '.KWWWWWWWWWK....',
  '.KWWWWWWWWWK....',
  '.KWWWWWWWWWK....',
  '.KWWWWWWWWWK....',
  '.KKKKKKKKKKK....',
  '................'
];
// 16 × 16 Raster: erst das Blatt, dann das Symbol (12 × 12) unten rechts darüber
function gridWith(symbol) {
  const g = PAGE.map(r => r.split(''));
  symbol.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') g[y + 4][x + 4] = ch; }));
  return g;
}

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(grid, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const col = PAL[grid[Math.floor(y * 16 / size)][Math.floor(x * 16 / size)]];
    if (!col) continue;
    const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function ico(grid) {
  const sizes = [16, 24, 32, 48, 64, 256];
  const images = sizes.map(s => png(grid, s));
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;     // 0 = 256
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images]);
}

for (const [out, sym] of [['plugin-file', 'plugin'], ['skin-file', 'wardrobe']]) {
  const g = gridWith(pattern(sym));
  fs.writeFileSync(path.join(root, 'assets', out + '.ico'), ico(g));
  fs.writeFileSync(path.join(root, 'assets', out + '.png'), png(g, 256));
  fs.writeFileSync(path.join(__dirname, out + '-preview.png'), png(g, 128));
  console.log(`assets/${out}.ico und .png geschrieben, Vorschau: tools/${out}-preview.png`);
}
