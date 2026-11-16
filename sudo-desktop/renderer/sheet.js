// sheet.js – lädt Sudos Sprite-Sheet (PNG + JSON) und zeichnet daraus einzelne Bilder.
// Aufbau: Körper-Bilder je Pose, darüber Augen (zum Blinzeln), dahinter die Stirnband-Enden.
// Magenta im Sheet (#ff00ff, #a000a0) ist der Gürtel und wird in die Rangfarbe umgefärbt.
(function (root) {
  'use strict';

  const hexRgb = h => { h = String(h).replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const shade = (rgb, f) => rgb.map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));

  // 1.9: Skin-Varianten – die Standardgrafik umfärben (Akzent-Türkis → andere Farbe, Hoodie optional hell)
  function rgbHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) return [l, l, l].map(v => Math.round(v * 255));
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
  }
  function recolor(ctx, w, h, rc) {
    const data = ctx.getImageData(0, 0, w, h), d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const [hu, s, l] = rgbHsl(d[i], d[i + 1], d[i + 2]);
      let out = null;
      if (rc.hue != null && hu >= 160 && hu <= 200 && s > .3) out = hslRgb(rc.hue, Math.min(1, s * (rc.sat || 1)), Math.min(.95, l * (rc.light || 1)));
      else if (rc.hoodie && s < .3 && l > .1 && l < .45 && hu >= 200 && hu <= 260) {
        out = rc.hoodie === 'light' ? hslRgb(hu, s * .6, .58 + (l - .1) * .9) : hslRgb(rc.hoodie, Math.min(.55, s + .25), l);
      }
      if (out) { d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; }
    }
    ctx.putImageData(data, 0, 0);
  }

  async function load(src, meta, accSrc) {
    if (!meta || !Array.isArray(meta.cell) || !meta.frames || !meta.frames.stand) throw new Error('Sheet-Beschreibung unvollständig');
    const img = new Image();
    img.src = src;
    await img.decode();
    const [cw, ch] = meta.cell;
    // Zubehör kann aus einem eigenen Bild kommen (ältere Skins ohne Hüte nutzen die Standardgrafik)
    let accImg = img;
    if (accSrc) { accImg = new Image(); accImg.src = accSrc; await accImg.decode(); }
    const base = document.createElement('canvas');
    base.width = img.width; base.height = img.height;
    const bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(img, 0, 0);
    if (meta.recolor) recolor(bctx, base.width, base.height, meta.recolor);

    const keys = meta.beltKeys ? { base: hexRgb(meta.beltKeys.base), dark: hexRgb(meta.beltKeys.dark || meta.beltKeys.base) } : null;
    const cache = new Map();
    function tinted(color) {
      if (!keys) return base;
      if (cache.has(color)) return cache.get(color);
      const c = document.createElement('canvas');
      c.width = base.width; c.height = base.height;
      const ctx = c.getContext('2d');
      const data = bctx.getImageData(0, 0, base.width, base.height);
      const d = data.data, main = hexRgb(color), dark = shade(main, -0.38);
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let to = null;
        if (r === keys.base[0] && g === keys.base[1] && b === keys.base[2]) to = main;
        else if (r === keys.dark[0] && g === keys.dark[1] && b === keys.dark[2]) to = dark;
        if (to) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; }
      }
      ctx.putImageData(data, 0, 0);
      cache.set(color, c);
      return c;
    }

    // Zubehör braucht oben Platz: das Zeichenfeld ist um "margin" höher als eine Kachel
    const margin = meta.accMargin || 0;
    function create(g) {
      return {
        draw(pose, f, tf, belt, eye, acc) {
          g.clearRect(0, 0, cw, ch + margin);
          g.save(); g.translate(0, margin);
          const list = meta.frames[pose] || meta.frames.stand;
          const fr = list[((f % list.length) + list.length) % list.length];
          const hx = fr.hx || 0, hy = fr.hy || 0;
          if (meta.tails && meta.tails.length) {
            const t = meta.tails[((tf % meta.tails.length) + meta.tails.length) % meta.tails.length];
            g.drawImage(base, t.x, t.y, cw, ch, hx, hy, cw, ch);
          }
          g.drawImage(tinted(belt), fr.x, fr.y, cw, ch, 0, 0, cw, ch);
          if (fr.eyes !== false && meta.eyes) {
            const e = meta.eyes[eye] || meta.eyes.open;
            if (e) g.drawImage(base, e.x, e.y, cw, ch, hx, hy, cw, ch);
          }
          // Zubehör: Brille nur, wenn das Gesicht sichtbar ist; Hut immer
          if (acc && meta.acc) {
            for (const name of [acc.neck, acc.face, acc.hat]) {
              const a = name && meta.acc[name];
              if (!a || (a.layer === 'face' && fr.eyes === false)) continue;
              g.drawImage(accImg === img ? base : accImg, a.x, a.y, cw, ch, hx, hy + (a.dy || 0), cw, ch);
            }
          }
          g.restore();
        }
      };
    }
    return { create, W: cw, H: ch + margin, feet: (meta.feet ?? ch - 1) + margin, acc: Object.keys(meta.acc || {}) };
  }

  root.SudoSheet = { load };
})(window);
