// tools/build-sheet.js – zeichnet Sudo als Sprite-Sheet (48 × 52 px pro Bild)
// Ausgabe: assets/sudo-sheet.png, assets/sudo-sheet.json, assets/icon.png, assets/tray.png
// Aufruf: npm run sheet
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CW = 48, CH = 52, COLS = 8;
const OL = '#0b0d12';
const BELT_KEY = { base: '#ff00ff', dark: '#a000a0' }; // wird zur Laufzeit in die Gürtelfarbe umgefärbt

/* ---------- Formen: (x, y) → bool, geprüft an Pixelmitten ---------- */
const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0, y0, w, h) => (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const rrect = (x0, y0, w, h, r) => (x, y) => {
  if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const cap = (x0, y0, x1, y1, r) => (x, y) => {
  const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l)) : 0;
  return (x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2 <= r * r;
};
const poly = pts => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const or = (...s) => (x, y) => s.some(f => f(x, y));
const and = (...s) => (x, y) => s.every(f => f(x, y));
const not = s => (x, y) => !s(x, y);
const line = (pts, r) => or(...pts.slice(1).map((p, i) => cap(pts[i][0], pts[i][1], p[0], p[1], r)));
const move = (s, dx, dy) => (x, y) => s(x - dx, y - dy);

/* ---------- Bild ---------- */
const rgb = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
class Img {
  constructor(w = CW, h = CH) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = (y * this.w + x) * 4, [r, g, b] = rgb(c);
    this.d[k] = r; this.d[k + 1] = g; this.d[k + 2] = b; this.d[k + 3] = 255;
  }
  opaque(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[(y * this.w + x) * 4 + 3] > 0; }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const k = (y * src.w + x) * 4;
      if (!src.d[k + 3]) continue;
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      const o = (ty * this.w + tx) * 4;
      for (let i = 0; i < 4; i++) this.d[o + i] = src.d[k + i];
    }
  }
}

/**
 * Fläche malen mit automatischer Schattierung (Licht von links oben).
 * pal.edge: Kontur am eigenen Rand · pal.rim: Kontur nur dort, wo dahinter noch nichts gemalt ist
 * Seit 1.11 fünf Stufen: Glanzpunkt (pal.hi, sonst aus pal.light abgeleitet; null = keiner), Licht, Zwischentöne, Schatten.
 * Zwischentöne und Glanz nur auf Flächen, die dick genug sind – kleine Teile bleiben klar. pal.mid: false schaltet sie ab
 * (nötig für den Gürtel: dort dürfen nur die beiden Schlüsselfarben vorkommen).
 */
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
function paint(img, shape, pal) {
  const soft = pal.mid !== false;
  const hi = !soft || pal.hi === null || !pal.light ? null : pal.hi || mix(pal.light, '#ffffff', 0.4);
  const midL = soft && pal.light ? mix(pal.base, pal.light, 0.5) : null;
  const midD = soft && pal.dark ? mix(pal.base, pal.dark, 0.5) : null;
  const m = new Uint8Array(CW * CH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (shape(x + 0.5, y + 0.5)) m[y * CW + x] = 1;
  const inM = (x, y) => x >= 0 && y >= 0 && x < CW && y < CH && m[y * CW + x] === 1;
  const before = new Img(); before.d.set(img.d);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (!inM(x, y)) continue;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    let c = pal.base;
    const edge = pal.edge && nb.some(([a, b]) => !inM(a, b));
    const rim = pal.rim && nb.some(([a, b]) => !inM(a, b) && !before.opaque(a, b));
    if (edge) c = pal.edge;
    else if (rim) c = pal.rim;
    else {
      const lit = pal.light && !inM(x - 2, y - 2);
      const sh = pal.dark && !inM(x + 2, y + 2);
      if (lit && !sh) c = hi && !inM(x - 2, y) && !inM(x, y - 2) && inM(x + 4, y + 4) ? hi : pal.light;
      else if (sh && !lit) c = pal.dark;
      else if (!lit && !sh) {
        const l2 = midL && !inM(x - 4, y - 4) && inM(x + 5, y + 5);
        const s2 = midD && !inM(x + 4, y + 4) && inM(x - 5, y - 5);
        if (l2 && !s2) c = midL; else if (s2 && !l2) c = midD;
      }
    }
    img.set(x, y, c);
  }
}

/* ---------- Farben ---------- */
const P = {
  // Glanzpunkte der Hoodie-Töne bleiben unter 45 % Helligkeit, sonst färbt die Skin-Variante „Schnee“ sie nicht mit um
  hood:     { base: '#2c313d', light: '#414a5e', dark: '#1d2129', hi: '#57617a', edge: OL },
  hoodBack: { base: '#232731', light: '#303543', dark: '#181b22', hi: null, edge: OL },
  pants:    { base: '#1c1f27', light: '#2c313e', dark: '#13151a', hi: null, edge: OL },
  shoe:     { base: '#323844', light: '#4c5466', dark: '#1e2128', hi: '#5f697f', edge: OL },
  glove:    { base: '#1a1c23', light: '#383d4a', dark: '#111318', hi: null, edge: OL },
  skin:     { base: '#f2c39b', light: '#fbd8b6', dark: '#dca27a' },
  mask:     { base: '#191b22', light: '#272b36', dark: '#111318', hi: null },
  teal:     { base: '#23cfcc', light: '#8ff4f1', dark: '#139a97' },
  tail:     { base: '#23cfcc', light: '#8ff4f1', dark: '#139a97', edge: '#0c5f5e' },
  headset:  { base: '#7c8597', light: '#aeb6c4', dark: '#4c5363', edge: OL },
  glow:     { base: '#25d3d0', light: '#c4fffd', dark: '#169e9c' },
  belt:     { base: BELT_KEY.base, dark: BELT_KEY.dark, rim: OL, mid: false },
  usb:      { base: '#6ff2fa', light: '#e2feff', dark: '#22b4c8', edge: '#0b6f7c' },
  metal:    { base: '#b8c2cf', light: '#eef2f6', dark: '#7d8898', edge: OL },
  laptop:   { base: '#3b414e', light: '#5a6478', dark: '#262b35', hi: null, edge: OL },
  screen:   { base: '#5ef0ff', light: '#d6fdff', dark: '#2bb8d0' },
  book:     { base: '#d6453d', light: '#f07a6d', dark: '#9e2f29', edge: OL },
  phone:    { base: '#3a4a42', light: '#56695e', dark: '#25302b', edge: OL },
  mug:      { base: '#eef0f3', light: '#ffffff', dark: '#b9bfc9', edge: OL }
};

/* ---------- Kopf ---------- */
function head(img, hx, hy) {
  const H = s => move(s, hx, hy);
  const hood = H(ell(24, 14, 14, 13));
  paint(img, hood, P.hood);
  paint(img, and(hood, H(or(line([[12.5, 21], [15, 24.5], [19, 26]], 0.5), cap(20, 2.5, 27, 2, 0.5)))), { base: P.hood.dark }); // Falten in der Kapuze
  paint(img, and(hood, H(rrect(18, 7, 19, 20, 6))), { base: '#465066' });          // Kapuzensaum
  paint(img, H(rrect(19, 8, 17, 18, 5)), { base: '#13151b' });                     // Kapuzen-Innenrand
  const skin = H(rrect(20, 9, 15, 8, 3));
  paint(img, skin, P.skin);                                                         // Augenpartie
  paint(img, and(skin, H(rect(0, 9, 48, 1))), { base: '#c98f69' });                 // Schatten der Kapuze
  paint(img, and(skin, H(rect(0, 10, 48, 1))), { base: P.skin.dark });
  const mask = H(and(rrect(20, 9, 15, 16, 5), rect(0, 16, 48, 20)));
  paint(img, mask, P.mask);                                                         // Maske
  paint(img, and(mask, H(rect(0, 16, 48, 1))), { base: '#353b4a' });                // Maskensaum
  paint(img, H(rect(26, 17, 2, 2)), { base: '#2b303c' });                           // Nase unter dem Stoff
  paint(img, H(cap(22, 20.5, 31, 20.5, 0.5)), { base: '#262a34' });                 // Maskenfalten
  paint(img, H(cap(24, 22.5, 29, 22.5, 0.5)), { base: '#20232c' });
  paint(img, and(hood, H(rect(0, 5, 48, 3))), { base: P.teal.base });               // Stirnband
  paint(img, and(hood, H(rect(13, 5, 18, 1))), { base: P.teal.light });
  paint(img, and(hood, H(rect(0, 7, 48, 1))), { base: P.teal.dark });
  paint(img, and(hood, H(rect(31, 5, 7, 2))), { base: P.teal.dark });               // Stirnband läuft rechts in den Schatten
  paint(img, H(ell(10, 6.5, 3, 2.6)), P.tail);                                      // Knoten
  const arc = [];
  for (let t = 190; t <= 300; t += 10) { const a = t * Math.PI / 180; arc.push([24 + 15.2 * Math.cos(a), 14 + 14.2 * Math.sin(a)]); }
  paint(img, H(line(arc, 1.3)), P.headset);                                         // Kopfbügel
  paint(img, H(ell(14, 16, 4, 5)), P.headset);                                      // Ohrmuschel
  paint(img, H(ell(14, 16, 2.2, 3.2)), P.glow);
  img.set(13 + hx, 14 + hy, '#e8ffff');                                             // Lichtpunkt im Kopfhörer
  paint(img, H(cap(17, 21, 22, 24, 0.7)), { base: '#4c5363' });                     // Mikrofon
  paint(img, H(ell(22.5, 24, 1.3, 1.3)), { base: '#2a2e39' });
}

/* ---------- Augen (eigene Ebene, damit Sudo blinzeln kann) ---------- */
function eyes(img, type, hx, hy) {
  const D = OL, W = '#ffffff', LID = '#c98f69';
  const ey = 11 + hy;
  for (const [i, ex0] of [[0, 21], [1, 28]]) {
    const ex = ex0 + hx;
    const s = (x, y, c) => img.set(ex + x, ey + y, c);
    switch (type) {
      case 'closed': s(0, 2, D); s(1, 3, D); s(2, 3, D); s(3, 3, D); s(4, 2, D); break;
      case 'happy': s(0, 3, D); s(1, 2, D); s(2, 1, D); s(3, 2, D); s(4, 3, D); break;
      case 'wide':
        for (let y = 0; y <= 5; y++) for (let x = 0; x <= 4; x++) {
          const border = x === 0 || x === 4 || y === 0 || y === 5;
          if ((x === 0 || x === 4) && (y === 0 || y === 5)) continue;
          s(x, y, border ? D : W);
        }
        s(2, 2, D); s(2, 3, D); break;
      case 'side':
        for (let x = 0; x < 5; x++) { s(x, 0, LID); s(x, 1, D); }
        for (let y = 2; y <= 3; y++) { s(0, y, D); s(1, y, D); s(2, y, W); s(3, y, W); s(4, y, W); }
        break;
      default: // open, determined
        for (let x = 0; x < 5; x++) s(x, 0, D);
        for (let y = 1; y <= 4; y++) { s(0, y, W); s(1, y, W); s(2, y, D); s(3, y, D); s(4, y, D); }
        for (let x = 2; x <= 4; x++) s(x, 4, '#3f6699');                           // Iris schimmert am unteren Rand
        s(3, 1, W);
        if (type === 'determined') {
          if (i === 0) { s(0, -2, D); s(1, -2, D); s(2, -1, D); s(3, -1, D); s(4, -1, D); }
          else { s(0, -1, D); s(1, -1, D); s(2, -1, D); s(3, -2, D); s(4, -2, D); }
        }
    }
  }
}

/* ---------- Stirnband-Enden (4 Bilder, wehen im Wind) ---------- */
function tails(f) {
  const img = new Img();
  const w = [[0, -1, 0, 1], [-1, 0, 1, 0], [0, 1, 0, -1], [1, 0, -1, 0]][f];
  paint(img, or(line([[9, 6], [5, 7 + w[0]], [1, 9 + w[1]]], 1.5), line([[9, 8], [5, 12 + w[2]], [2, 15.5 + w[3]]], 1.4)), P.tail);
  return img;
}

/* ---------- Körper ---------- */
function arm(img, s, h, pal) {
  const sleeve = cap(s[0], s[1], h[0], h[1], 2.4);
  paint(img, sleeve, pal);
  const dx = h[0] - s[0], dy = h[1] - s[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  if (l > 6) {                                                                 // Bündchen quer zum Ärmel
    const cx = h[0] - ux * 3.3, cy = h[1] - uy * 3.3;
    paint(img, and(sleeve, cap(cx + uy * 3, cy - ux * 3, cx - uy * 3, cy + ux * 3, 0.75)), { base: pal === P.hood ? '#465066' : '#343a49' });
  }
  paint(img, ell(h[0], h[1], 2.7, 2.7), P.glove);
}
function shoe(img, fx, fy) {
  const s = ell(fx + 1.5, fy + 2, 3.9, 2.4);
  paint(img, s, P.shoe);
  paint(img, and(s, rect(0, fy + 3, 48, 1), not(rect(fx - 2.5, 0, 1, 99))), { base: '#5a6272' });
  img.set(Math.round(fx + 1), Math.round(fy + 1), P.teal.base);              // Schnürsenkel in Akzentfarbe
}
function legs(img, cfg, b) {
  if (cfg.legs === 'sit') {
    paint(img, ell(17, 48.3, 7.5, 3.2), P.pants);                            // Knie links
    paint(img, ell(31, 48.3, 7.5, 3.2), P.pants);                            // Knie rechts
    paint(img, ell(24, 50, 5, 1.8), P.shoe);                                 // gekreuzte Füße
    return;
  }
  const paths = cfg.legsP || [[[20, 42 + b], [19, 48]], [[28, 42 + b], [29, 48]]];
  for (const pts of paths) {
    paint(img, line(pts, 2.3), P.pants);
    const [fx, fy] = pts[pts.length - 1];
    shoe(img, fx, fy);
  }
}
function body(cfg) {
  const img = new Img();
  const b = cfg.b || 0, hx = cfg.hx || 0, hy = cfg.hy ?? b;
  const sit = cfg.legs === 'sit';
  const blade = cap(6, 21 + b, 15, 33 + b, 1.7);
  paint(img, blade, P.usb);                                                  // USB-Katana
  paint(img, and(blade, cap(5.5, 24.5 + b, 9.5, 21.5 + b, 0.8)), { base: '#0b6f7c' }); // Zwinge
  paint(img, cap(4.5, 18.5 + b, 6.5, 21.5 + b, 1.5), P.metal);               // Stecker
  if (cfg.back) arm(img, [18, 30 + b], cfg.back, P.hoodBack);
  if (!sit) legs(img, cfg, b);
  const torso = poly([[16, 27 + b], [32, 27 + b], [34.5, 43 + b], [13.5, 43 + b]]);
  paint(img, torso, P.hood);
  paint(img, and(torso, rrect(19, 34 + b, 11, 5, 1.5)), { base: '#242833', edge: '#15171d' }); // Bauchtasche
  paint(img, and(torso, rect(18, 28 + b, 13, 1)), { base: P.hood.dark });     // Schatten unter dem Kinn
  paint(img, and(torso, rect(0, 39 + b, 48, 1), x => Math.floor(x) % 2 === 0), { base: P.hoodBack.base }); // Strickbund
  paint(img, and(torso, or(cap(17.5, 34 + b, 17, 37.5 + b, 0.5), cap(31, 33 + b, 31.8, 37 + b, 0.5))), { base: P.hood.dark }); // Stofffalten
  for (const sx of [22, 26]) {                                                // Kordeln
    paint(img, cap(sx, 27.5 + b, sx - 0.3, 32.5 + b, 0.55), { base: '#d9dee6' });
    img.set(Math.round(sx - 1), 33 + b, '#9aa3b2');
  }
  paint(img, and(torso, rect(0, 40 + b, 48, 3)), P.belt);                     // Gürtel
  paint(img, ell(30.5, 41.5 + b, 2, 1.6), P.belt);
  paint(img, or(cap(30, 42 + b, 28.8, 45.5 + b, 0.8), cap(31, 42 + b, 32.6, 45.2 + b, 0.8)), { ...P.belt, edge: OL, rim: null });
  if (sit) legs(img, cfg, b);
  if (cfg.under) cfg.under(img, b);
  head(img, hx, hy);
  if (cfg.bake) eyes(img, cfg.bake, hx, hy);
  if (cfg.front) arm(img, [30, 30 + b], cfg.front, P.hood);
  if (cfg.over) cfg.over(img, b);
  return img;
}
const hand = (img, x, y) => paint(img, ell(x, y, 2.7, 2.7), P.glove);

/* ---------- Posen ---------- */
const SIT = { legs: 'sit', b: 4 };
const laptop = img => {
  paint(img, rrect(28, 44, 15, 2.6, 1), P.laptop);
  paint(img, poly([[39.5, 45], [42.5, 45], [46.5, 30], [43.5, 30]]), P.laptop);
  paint(img, poly([[40.4, 43.5], [41.6, 43.5], [44.8, 31.5], [43.8, 31.5]]), P.screen);
};
const book = img => {
  paint(img, rrect(33, 28, 10, 13, 1.2), P.book);
  paint(img, rect(41, 29.5, 1.2, 10.5), { base: '#f5e6c8' });
  paint(img, rect(35, 31, 5, 1), { base: '#f5e6c8' });
  paint(img, rect(35, 33, 4, 1), { base: '#f2a59c' });
  hand(img, 34, 39); hand(img, 41.5, 37);
};
const phone = f => img => {
  paint(img, rrect(34, 31, 7, 12, 1.6), P.phone);
  paint(img, rect(35.5, 32.5, 4, 4), { base: '#9be15d' });
  img.set(36 + f, 34, '#2d4a1a'); img.set(35 + f, 34, '#2d4a1a'); img.set(38, 33, '#d64545');
  for (const [x, y] of [[36, 38], [38, 38], [36, 40], [38, 40]]) img.set(x, y, '#7f9488');
  hand(img, 34, 40); hand(img, 41, 40);
};
const mug = img => {
  paint(img, and(ell(31.6, 21, 2.2, 2.6), not(ell(31.6, 21, 1, 1.4))), P.mug);
  paint(img, rrect(32, 17, 7, 8, 1.2), P.mug);
  paint(img, ell(35.5, 18.2, 2.6, 0.9), { base: '#6b4226' });
};
const thumb = img => paint(img, cap(37.6, 20, 37.6, 16.5, 1.1), P.glove);

const POSES = {
  stand:    [{ back: [15, 39], front: [33, 39] }],
  walk: [
    { legsP: [[[21, 42], [24, 48]], [[27, 42], [24, 48]]], back: [13, 37], front: [36, 37] },
    { b: -1, legsP: [[[21, 41], [21, 48]], [[27, 41], [28, 46]]], back: [16, 38], front: [32, 38] },
    { legsP: [[[21, 42], [17, 48]], [[27, 42], [31, 48]]], back: [20, 38], front: [27, 39] },
    { b: -1, legsP: [[[21, 41], [20, 46]], [[27, 41], [27, 48]]], back: [16, 38], front: [32, 38] }
  ],
  jump:     [{ legsP: [[[20, 42], [17, 46]], [[28, 42], [31, 45]]], back: [14, 20], front: [35, 19] }],
  carried: [
    { legsP: [[[20, 42], [16, 48]], [[28, 42], [31, 48]]], back: [14, 17], front: [35, 16] },
    { legsP: [[[20, 42], [19, 48]], [[28, 42], [28, 48]]], back: [14, 18], front: [35, 17] }
  ],
  crouch:   [{ b: 5, legsP: [[[20, 46], [15, 45], [14, 48]], [[28, 46], [33, 45], [34, 48]]], back: [14, 44], front: [38, 41] }],
  throw:    [{ legsP: [[[20, 42], [15, 48]], [[28, 42], [33, 48]]], back: [9, 33], front: [43, 30] }],
  type: [
    { ...SIT, back: [31, 44], front: [37, 43], under: laptop },
    { ...SIT, back: [32, 43], front: [38, 41], under: laptop }
  ],
  book:     [{ ...SIT, back: [33, 40], front: [40, 38], over: book }],
  snake:    [0, 1, 2].map(f => ({ ...SIT, back: [33, 41], front: [39, 41], over: phone(f) })),
  meditate: [{ ...SIT, back: [12, 44], front: [36, 44] }],
  sleep:    [{ ...SIT, hy: 6, back: [22, 44], front: [28, 44] }],
  facepalm: [{ back: [15, 39], front: [31, 13], bake: 'closed', eyes: false }],
  thumb:    [{ back: [15, 39], front: [37, 22], over: thumb }],
  coffee:   [{ back: [15, 39], front: [33, 25], over: mug }],
  sus:      [{ back: [15, 39], front: [33, 26] }],
  victory:  [{ back: [12, 15], front: [37, 13] }],
  alarm:    [{ back: [12, 9], front: [36, 7] }]
};

/* ---------- Zubehör (eigene Ebenen über dem Kopf) ----------
   Zubehör-Kacheln beginnen 12 px OBERHALB des Kopfes (ACC_UP), damit Hüte Platz nach oben haben.
   Koordinaten unten sind Kopf-Koordinaten wie bei head(); A() verschiebt sie in die Kachel. */
const ACC_UP = 12;
const A = s => move(s, 0, ACC_UP);
const above = y => (x, yy) => yy < y;
const ring = (img, x0, y0, w, h, c) => {
  for (let x = x0; x < x0 + w; x++) { img.set(x, y0 + ACC_UP, c); img.set(x, y0 + h - 1 + ACC_UP, c); }
  for (let y = y0; y < y0 + h; y++) { img.set(x0, y + ACC_UP, c); img.set(x0 + w - 1, y + ACC_UP, c); }
};
const ACC = {
  beanie: { layer: 'hat', draw(img) {
    const dome = and(ell(24, 4, 15, 9.5), above(7));
    paint(img, A(dome), { base: '#c0392b', light: '#e3604f', dark: '#8e2a20', edge: OL });
    for (const x of [15, 19.5, 24, 28.5, 33]) paint(img, A(and(dome, cap(x, -6, x, 6, 0.5))), { base: '#a5301f' });
    paint(img, A(rrect(8.5, 4.5, 31, 4.5, 2)), { base: '#ece6d8', dark: '#bdb5a6', edge: OL });
    paint(img, A(ell(24, -6.5, 3.6, 3.2)), { base: '#f4f0e6', light: '#ffffff', dark: '#cfc7b8', edge: OL });
  } },
  cap: { layer: 'hat', draw(img) {
    paint(img, A(and(ell(23, 5, 14.5, 9), above(8))), { base: '#2f6fd6', light: '#5a92ef', dark: '#1f4c99', edge: OL });
    paint(img, A(rrect(30, 4.5, 16, 3.6, 1.6)), { base: '#245bb5', light: '#4d86e3', dark: '#183f80', edge: OL });
    paint(img, A(ell(23, -3.6, 2, 1.6)), { base: '#1f4c99', edge: OL });
    paint(img, A(rrect(15, 0, 9, 3, 1)), { base: '#f4f0e6', edge: '#1f4c99' });
  } },
  santa: { layer: 'hat', draw(img) {
    paint(img, A(or(and(ell(24, 4, 15, 9.5), above(7)), poly([[13, 3], [23, -5], [10, -3], [2, 5]]))), { base: '#d42f2f', light: '#f05a4f', dark: '#9b1f1f', edge: OL });
    paint(img, A(rrect(8.5, 4.5, 31, 4.6, 2)), { base: '#f6f6f6', dark: '#cfd3d8', edge: OL });
    paint(img, A(ell(3, 7, 3.2, 3.2)), { base: '#f6f6f6', dark: '#cfd3d8', edge: OL });
  } },
  party: { layer: 'hat', draw(img) {
    const cone = poly([[15, 7], [33, 7], [27, -11]]);
    paint(img, A(cone), { base: '#7f5af0', light: '#a18aff', dark: '#5a3cc4', edge: OL });
    for (const y of [-6, -1, 4]) paint(img, A(and(cone, rect(0, y, 48, 1.6))), { base: '#f4d03f' });
    paint(img, A(ell(27, -11, 2.6, 2.4)), { base: '#ff5d8f', light: '#ff9fbd', edge: OL });
  } },
  crown: { layer: 'hat', draw(img) {
    paint(img, A(or(rect(12, 1, 24, 6), poly([[12, 2], [12, -7], [18, 1]]), poly([[18.5, 2], [24, -9], [29.5, 2]]), poly([[30, 1], [36, -7], [36, 2]]))),
      { base: '#f4c430', light: '#ffe680', dark: '#b8860b', edge: OL });
    paint(img, A(ell(24, 3.8, 2, 1.8)), { base: '#e8473f', light: '#ff8a80' });
    paint(img, A(ell(16.5, 4, 1.5, 1.4)), { base: '#25d3d0' }); paint(img, A(ell(31.5, 4, 1.5, 1.4)), { base: '#25d3d0' });
    for (const x of [12, 24, 36]) paint(img, A(ell(x, x === 24 ? -9 : -7, 1.3, 1.3)), { base: '#ffe680', edge: OL });
  } },
  firehelmet: { layer: 'hat', draw(img) {
    const dome = and(ell(24, 6, 16.5, 11), above(8));
    paint(img, A(dome), { base: '#d6dbe2', light: '#f7f9fb', dark: '#9aa2ad', edge: OL });
    paint(img, A(and(dome, rect(0, 1.5, 48, 2))), { base: '#e8d21d' });
    paint(img, A(and(dome, rrect(21.5, -6, 5, 14, 2))), { base: '#bfc6cf', light: '#e6eaef', edge: '#7d8692' });
    paint(img, A(rrect(6.5, 6.5, 35, 3, 1.4)), { base: '#2a2f3b', light: '#3d4454', edge: OL });
  } },
  shades: { layer: 'face', draw(img) {
    paint(img, A(or(rrect(20, 10, 7.5, 6, 2), rrect(27.5, 10, 7.5, 6, 2), rect(19, 10.5, 16, 1.4))), { base: '#14161c', light: '#3a4152', edge: OL });
    for (const x of [22, 29]) { img.set(x, 11 + ACC_UP, '#9fb3c8'); img.set(x + 1, 12 + ACC_UP, '#6c8199'); }
  } },
  // ---- 1.4.1: IT-Gags ----
  hardhat: { layer: 'hat', draw(img) {
    const dome = and(ell(24, 5.5, 15, 10.5), above(7.5));
    paint(img, A(dome), { base: '#f2c419', light: '#ffe36b', dark: '#b8900a', edge: OL });
    paint(img, A(and(dome, rrect(21.5, -6, 5, 14, 2))), { base: '#e0b210', light: '#ffe36b', edge: '#9a7806' });
    paint(img, A(or(rrect(5.5, 6, 37, 3, 1.4), rrect(34, 5.5, 9, 3.4, 1.4))), { base: '#d9a90d', light: '#f6cd3a', dark: '#9a7806', edge: OL });
    paint(img, A(rrect(12, 0, 6, 3, 1)), { base: '#2a2f3b' });
    for (const [x, y] of [[13, 1], [15, 1], [16, 2]]) img.set(x, y + ACC_UP, '#f2c419');
  } },
  tinfoil: { layer: 'hat', draw(img) {
    const cone = or(poly([[11, 8], [37, 8], [27, -11]]), ell(24, 6, 13, 3));
    paint(img, A(cone), { base: '#c3cad4', light: '#f4f7fa', dark: '#8a93a1', edge: OL });
    // Knitterfalten
    for (const [x, y, c] of [[18, 4, '#8a93a1'], [19, 3, '#f4f7fa'], [23, 0, '#8a93a1'], [24, -1, '#f4f7fa'], [28, 2, '#8a93a1'], [29, 1, '#f4f7fa'],
      [26, -5, '#8a93a1'], [21, 6, '#f4f7fa'], [31, 5, '#8a93a1'], [25, 4, '#f4f7fa'], [15, 6, '#8a93a1'], [33, 7, '#f4f7fa']]) img.set(x, y + ACC_UP, c);
    paint(img, A(ell(27, -11, 1.4, 1.4)), { base: '#ffffff', edge: '#8a93a1' });
  } },
  propeller: { layer: 'hat', draw(img) {
    const dome = and(ell(24, 5, 14, 9), above(7.5));
    const cols = ['#e5484d', '#f4d03f', '#3b8bea', '#3ccf7a'];
    paint(img, A(dome), { base: '#e5484d', edge: OL });
    for (let i = 0; i < 4; i++) paint(img, A(and(dome, rect(10 + i * 7, -10, 7, 20))), { base: cols[i], edge: OL });
    paint(img, A(rrect(9.5, 4.5, 29, 3, 1.2)), { base: '#2c313d', light: '#414a5e', edge: OL });
    paint(img, A(cap(24, -4.5, 24, -1, 0.6)), { base: '#4c5363' });
    paint(img, A(or(ell(19.5, -6, 4.6, 1.3), ell(28.5, -6, 4.6, 1.3))), { base: '#25d3d0', light: '#c4fffd', dark: '#169e9c', edge: OL });
    paint(img, A(ell(24, -6, 1.3, 1.3)), { base: '#f4d03f', edge: OL });
  } },
  // ---- 1.4.1: Saison ----
  witch: { layer: 'hat', draw(img) {
    paint(img, A(or(poly([[15, 6], [33, 6], [29, -4], [36, -11], [25, -6]]))), { base: '#2a2238', light: '#463a5e', dark: '#17121f', edge: OL });
    paint(img, A(and(poly([[15, 6], [33, 6], [29, -4], [36, -11], [25, -6]]), rect(0, 2, 48, 2.2))), { base: '#f39c3c' });
    paint(img, A(rrect(4, 5.5, 40, 3.2, 1.5)), { base: '#2a2238', light: '#463a5e', dark: '#17121f', edge: OL });
    paint(img, A(rrect(22, 1.5, 4, 3, .5)), { base: '#f4d03f', edge: '#8a6a00' });
  } },
  bunny: { layer: 'hat', draw(img) {
    const l = poly([[16, 4], [20, 4], [21, -8], [18, -13], [15, -8]]), r = poly([[27, 4], [31, 4], [34, -7], [32, -12], [28, -8]]);
    paint(img, A(or(l, r)), { base: '#f6f3f0', light: '#ffffff', dark: '#cfc8c2', edge: OL });
    paint(img, A(or(poly([[17, 2], [19, 2], [19.5, -7], [18, -10], [16.5, -7]]), poly([[28.5, 2], [30, 2], [32.5, -6], [31.5, -9.5], [29, -7]]))), { base: '#f6a8c0', dark: '#e07fa0' });
    paint(img, A(and(ell(24, 14, 14.3, 13.3), not(ell(24, 14, 13, 12)), above(5))), { base: '#f6a8c0', edge: OL });
  } },
  strawhat: { layer: 'hat', draw(img) {
    paint(img, A(and(ell(24, 3.5, 11, 7), above(5.5))), { base: '#e8c872', light: '#fbe3a0', dark: '#b9953f', edge: OL });
    paint(img, A(and(ell(24, 3.5, 11, 7), rect(0, 2.5, 48, 2.5))), { base: '#d6453d', dark: '#9e2f29' });
    paint(img, A(ell(24, 6.2, 19.5, 2.6)), { base: '#e8c872', light: '#fbe3a0', dark: '#b9953f', edge: OL });
    for (let x = 8; x < 41; x += 3) img.set(x, 6 + ACC_UP, '#c9a24c');
  } },
  tophat: { layer: 'hat', draw(img) {
    paint(img, A(rrect(15.5, -10, 17, 15.5, 1.2)), { base: '#1c1f27', light: '#3a4152', dark: '#101217', edge: OL });
    paint(img, A(rect(16.5, 0, 15, 2.6)), { base: '#f4c430', light: '#ffe680', dark: '#b8860b' });
    paint(img, A(rrect(8, 4.5, 32, 3, 1.4)), { base: '#1c1f27', light: '#3a4152', edge: OL });
    for (const [x, y, c] of [[30, -12, '#f4d03f'], [33, -9, '#ff5d8f'], [13, -8, '#25d3d0'], [35, -13, '#ffffff']]) img.set(x, y + ACC_UP, c);
  } },
  // ---- Brillen ----
  pixel: { layer: 'face', draw(img) {
    const B = '#0b0d12', W = '#ffffff';
    for (let x = 17; x <= 35; x++) img.set(x, 10 + ACC_UP, B);
    for (const ox of [20, 28]) {
      for (let x = ox; x < ox + 7; x++) { img.set(x, 11 + ACC_UP, B); img.set(x, 12 + ACC_UP, B); }
      for (let x = ox + 1; x < ox + 6; x++) img.set(x, 13 + ACC_UP, B);
      for (let x = ox + 2; x < ox + 5; x++) img.set(x, 14 + ACC_UP, B);
      img.set(ox + 1, 11 + ACC_UP, W); img.set(ox + 2, 12 + ACC_UP, W);
    }
  } },
  monocle: { layer: 'face', draw(img) {
    paint(img, A(and(ell(30.5, 12.5, 3.6, 3.6), not(ell(30.5, 12.5, 2.4, 2.4)))), { base: '#f4c430', dark: '#b8860b' });
    img.set(29, 11 + ACC_UP, '#e8f6ff');
    paint(img, A(line([[33.5, 14.5], [35, 19], [34, 24], [35.5, 28]], 0.45)), { base: '#d9b13a' });
  } },
  goggles: { layer: 'face', draw(img) {
    paint(img, A(rect(9.5, 10, 11, 3.4)), { base: '#e5484d', dark: '#a8302f', edge: OL });
    paint(img, A(rrect(19, 8.5, 18, 7.5, 3)), { base: '#2c313d', edge: OL });
    paint(img, A(rrect(20.5, 9.5, 15, 5.5, 2.3)), { base: '#f39c3c', light: '#ffd27a', dark: '#b45ad6' });
    for (const [x, y] of [[22, 10], [23, 10], [22, 11]]) img.set(x, y + ACC_UP, '#fff6d6');
  } },
  // ---- 1.4.1: Hals & Brust (sitzt auf dem Oberkörper, unter der Maske) ----
  tie: { layer: 'neck', draw(img) {
    paint(img, A(or(poly([[19.5, 25.5], [23, 25.5], [22.5, 28.5]]), poly([[25, 25.5], [28.5, 25.5], [25.5, 28.5]]))), { base: '#f4f6f9', dark: '#c4cad3', edge: OL });
    const blade = poly([[22, 28], [26, 28], [27.8, 36], [24, 39.6], [20.2, 36]]);
    paint(img, A(blade), { base: '#d6453d', light: '#f07a6d', dark: '#9e2f29', edge: OL });
    for (const y of [31, 35]) paint(img, A(and(blade, not(rect(0, 0, 21, 99)), not(rect(27, 0, 99, 99)), cap(20, y + 2.5, 28, y - 1.5, 0.55))), { base: '#9e2f29' });
    paint(img, A(rrect(21.8, 25, 4.4, 3.6, 1.2)), { base: '#c0392b', light: '#e3604f', edge: OL });
  } },
  bowtie: { layer: 'neck', draw(img) {
    const bow = or(poly([[23, 29], [15.5, 24.6], [15.5, 33.4]]), poly([[25, 29], [32.5, 24.6], [32.5, 33.4]]));
    paint(img, A(bow), { base: '#3b8bea', dark: '#24599e', edge: OL });
    for (const [x, y] of [[17, 27], [19, 30], [30, 26], [28, 29], [17, 31], [30, 31]]) img.set(x, y + ACC_UP, '#ffffff');
    paint(img, A(rrect(22, 27, 4, 4, 1.2)), { base: '#24599e', light: '#7fb6ff', edge: OL });
  } },
  badge: { layer: 'neck', draw(img) {
    paint(img, A(or(line([[18.5, 25], [23.6, 33.5]], 0.6), line([[29.5, 25], [24.4, 33.5]], 0.6))), { base: '#25d3d0', dark: '#169e9c' });
    paint(img, A(rrect(20.5, 33, 7, 8.6, 1)), { base: '#f4f6f9', dark: '#c4cad3', edge: OL });
    paint(img, A(rect(21.5, 34, 5, 1.4)), { base: '#25d3d0' });
    paint(img, A(rect(21.8, 36, 2.4, 2.6)), { base: '#2c313d' });
    paint(img, A(rect(24.8, 36.4, 1.8, .9)), { base: '#9aa3b2' });
    paint(img, A(rect(24.8, 38, 1.8, .9)), { base: '#9aa3b2' });
    img.set(24, 33 + ACC_UP, '#7d8898');
  } },
  scarf: { layer: 'neck', draw(img) {
    const wrap = ell(24, 26.8, 10.5, 3);
    paint(img, A(wrap), { base: '#d6453d', light: '#f07a6d', dark: '#9e2f29', edge: OL });
    const end = poly([[27, 27], [31.5, 27], [33, 37], [28.5, 37.5]]);
    paint(img, A(end), { base: '#d6453d', light: '#f07a6d', dark: '#9e2f29', edge: OL });
    for (const y of [30.5, 33.5]) paint(img, A(and(end, rect(0, y, 48, 1.3))), { base: '#f4f0e6' });
    for (const x of [16, 21, 26, 31]) paint(img, A(and(wrap, rect(x, 0, 1.4, 48))), { base: '#f4f0e6' });
    for (const x of [29, 30.5, 32]) img.set(Math.round(x), 38 + ACC_UP, '#f4f0e6');
  } },
  lights: { layer: 'neck', draw(img) {
    const pts = [[14, 26], [17, 28.5], [20, 27], [23, 29.5], [26, 27.5], [29, 29.5], [32, 27.5], [34.5, 29]];
    paint(img, A(line(pts, 0.55)), { base: '#4f8a55' });
    const cols = ['#e5484d', '#f4d03f', '#3b8bea', '#3ccf7a', '#ff5d8f', '#f39c3c', '#25d3d0'];
    pts.slice(1).forEach(([x, y], i) => { paint(img, A(ell(x, y + 2, 1.6, 2)), { base: cols[i % cols.length], edge: OL }); img.set(Math.round(x - .6), Math.round(y + 1.4) + ACC_UP, '#ffffff'); });
  } },
  lei: { layer: 'neck', draw(img) {
    const cols = ['#ff5d8f', '#f4d03f', '#ffffff', '#f39c3c', '#b45ad6'];
    let i = 0;
    for (let t = 0; t <= 180; t += 22.5) {
      const a = t * Math.PI / 180, x = 24 - 9.5 * Math.cos(a), y = 25.5 + 8 * Math.sin(a);
      paint(img, A(ell(x, y, 2.3, 2.1)), { base: cols[i % cols.length], edge: OL });
      img.set(Math.round(x), Math.round(y) + ACC_UP, i % cols.length === 1 ? '#f39c3c' : '#f4d03f'); i++;
    }

  } },
  nerd: { layer: 'face', draw(img) {
    ring(img, 20, 10, 7, 7, '#3b2412'); ring(img, 27, 10, 7, 7, '#3b2412');
    img.set(26, 12 + ACC_UP, '#3b2412'); img.set(19, 11 + ACC_UP, '#3b2412'); img.set(18, 11 + ACC_UP, '#3b2412');
    for (const x of [21, 28]) img.set(x, 11 + ACC_UP, '#cfe8ff');
  } }
};

/* ---------- PNG ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(img) {
  const { w, h, d } = img, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(d.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function scaleCrop(src, sx, sy, size, factor) {
  const out = new Img(size * factor, size * factor);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const k = ((sy + Math.floor(y / factor)) * src.w + sx + Math.floor(x / factor)) * 4, o = (y * out.w + x) * 4;
    for (let i = 0; i < 4; i++) out.d[o + i] = src.d[k + i];
  }
  return out;
}

/* ---------- Zusammenbauen ---------- */
const cells = [];
const meta = { version: 1, cell: [CW, CH], feet: 51, beltKeys: BELT_KEY, frames: {}, eyes: {}, tails: [] };
for (const [name, list] of Object.entries(POSES)) {
  meta.frames[name] = list.map(cfg => {
    const i = cells.push(body(cfg)) - 1;
    const fr = { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH, hx: cfg.hx || 0, hy: cfg.hy ?? (cfg.b || 0) };
    if (cfg.eyes === false) fr.eyes = false;
    return fr;
  });
}
for (const e of ['open', 'closed', 'happy', 'wide', 'side', 'determined']) {
  const img = new Img(); eyes(img, e, 0, 0);
  const i = cells.push(img) - 1;
  meta.eyes[e] = { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH };
}
for (let f = 0; f < 4; f++) {
  const i = cells.push(tails(f)) - 1;
  meta.tails.push({ x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH });
}
meta.acc = {}; meta.accMargin = ACC_UP;
for (const [name, a] of Object.entries(ACC)) {
  const img = new Img(); a.draw(img);
  const i = cells.push(img) - 1;
  meta.acc[name] = { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH, layer: a.layer, dy: -ACC_UP };
}
const sheet = new Img(COLS * CW, Math.ceil(cells.length / COLS) * CH);
cells.forEach((c, i) => sheet.blit(c, (i % COLS) * CW, Math.floor(i / COLS) * CH));

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'sudo-sheet.png'), png(sheet));
fs.writeFileSync(path.join(dir, 'sudo-sheet.json'), JSON.stringify(meta, null, 1));

// Icons: Kopf aus der Standpose, Gürtel türkis
const icon = new Img();
icon.blit(tails(0), 0, 0);
icon.blit(cells[0], 0, 0);
eyes(icon, 'open', 0, 0);
fs.writeFileSync(path.join(dir, 'icon.png'), png(scaleCrop(icon, 8, 1, 32, 8)));
fs.writeFileSync(path.join(dir, 'tray.png'), png(scaleCrop(icon, 8, 1, 32, 1)));

console.log(`Sprite-Sheet erzeugt: ${cells.length} Bilder, ${sheet.w} × ${sheet.h} px`);

// Vorschau zum Begutachten (npm run sheet -- --vorschau): alle Posen mit Augen und Stirnband vierfach,
// darunter vier Posen zehnfach. Ausgabe: tools/sheet-preview.png
if (process.argv.includes('--vorschau')) {
  const list = [];
  for (const [name, fr] of Object.entries(POSES)) fr.forEach((cfg, n) => {
    const c = new Img(), hx = cfg.hx || 0, hy = cfg.hy ?? (cfg.b || 0);
    c.blit(tails(n % 4), hx, hy); c.blit(body(cfg), 0, 0);
    if (cfg.eyes !== false) eyes(c, name === 'sleep' ? 'closed' : name === 'victory' ? 'happy' : 'open', hx, hy);
    list.push(c);
  });
  const F = 4, B = 10, rows = Math.ceil(list.length / COLS), big = [0, 2, 10, list.length - 2];
  const pv = new Img(COLS * CW * F, rows * CH * F + CH * B);
  const bg = rgb('#3a4252');
  for (let k = 0; k < pv.d.length; k += 4) { pv.d[k] = bg[0]; pv.d[k + 1] = bg[1]; pv.d[k + 2] = bg[2]; pv.d[k + 3] = 255; }
  const put = (c, ox, oy, f) => { for (let y = 0; y < CH * f; y++) for (let x = 0; x < CW * f; x++) {
    const k = (Math.floor(y / f) * CW + Math.floor(x / f)) * 4; if (!c.d[k + 3]) continue;
    const o = ((oy + y) * pv.w + ox + x) * 4; if (o + 3 < pv.d.length && ox + x < pv.w) for (let i = 0; i < 4; i++) pv.d[o + i] = c.d[k + i]; } };
  list.forEach((c, i) => put(c, (i % COLS) * CW * F, Math.floor(i / COLS) * CH * F, F));
  big.forEach((n, i) => put(list[n], i * CW * (B - 2), rows * CH * F, B));
  fs.writeFileSync(path.join(__dirname, 'sheet-preview.png'), png(pv));
}
