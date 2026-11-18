// skinstore.js – Skin-Store (1.14): Skins mit XP „kaufen“ und anziehen.
//
// Quellen:   bundled  – mitgeliefert (assets/skins/katalog.json + assets/skins/<id>/sudo-sheet.png)
//            zentrale – von der Sudo-Zentrale (%APPDATA%\Sudo\skins-store\zentrale\<id>\), wird abgeglichen
//            datei    – per .sudoskin-Datei hinzugefügt (%APPDATA%\Sudo\skins-store\datei\<id>\), gehört dir sofort
// Schlüssel eines Skins: „<quelle>/<id>“; als Skin-Wahl „store:<quelle>/<id>“.
// Gekauft wird lokal: Die XP zieht das Overlay ab (wie beim Musikwunsch), gemerkt wird der Kauf in settings.skinsOwned.
// Eine .sudoskin-Datei ist JSON: { format: "sudoskin", version: 1, id, name, png: <Base64>, sheet: <sudo-sheet.json> | null }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const KEY_RE = /^(bundled|zentrale|datei)\/[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_PNG = 1024 * 1024;
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const slug = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const price = v => Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));

/** Prüfsumme wie in den Zentralen: Base64 der Grafik, „|“, JSON der Raster-Beschreibung (oder leer) */
const skinSha = (pngB64, sheetJson) => sha256(pngB64 + '|' + (sheetJson || ''));

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.slice(12, 16).toString() !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function sheetOk(meta) { return !!(meta && Array.isArray(meta.cell) && meta.cell.length === 2 && meta.frames && meta.frames.stand); }

function createSkinStore({ assetsDir, dataDir, log = () => {}, getSettings, saveSettings }) {
  const root = path.join(dataDir, 'skins-store');
  const defaultJson = path.join(assetsDir, 'sudo-sheet.json');
  const defaultSize = (() => { try { return pngSize(fs.readFileSync(path.join(assetsDir, 'sudo-sheet.png'))); } catch { return null; } })();
  let zentraleFree = false;

  function bundled() {
    try {
      const k = JSON.parse(fs.readFileSync(path.join(assetsDir, 'skins', 'katalog.json'), 'utf8'));
      return (k.skins || []).filter(s => ID_RE.test(s.id) && fs.existsSync(path.join(assetsDir, 'skins', s.id, 'sudo-sheet.png')))
        .map(s => ({ source: 'bundled', id: s.id, name: String(s.name || s.id).slice(0, 40), price: price(s.price), dir: path.join(assetsDir, 'skins', s.id) }));
    } catch { return []; }
  }
  function stored(source) {
    const base = path.join(root, source);
    let names = [];
    try { names = fs.readdirSync(base).filter(n => ID_RE.test(n)); } catch { return []; }
    return names.map(id => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(base, id, 'skin.json'), 'utf8'));
        if (!fs.existsSync(path.join(base, id, 'sudo-sheet.png'))) return null;
        return { source, id, name: String(m.name || id).slice(0, 40), price: source === 'datei' ? 0 : price(m.price), sha: String(m.sha || ''), dir: path.join(base, id) };
      } catch { return null; }
    }).filter(Boolean);
  }
  const owned = () => new Set((getSettings().skinsOwned || []).filter(k => KEY_RE.test(k)));
  const effPrice = s => (s.source === 'datei' || zentraleFree ? 0 : s.price);

  /** Alles, was der Store zeigt (Reihenfolge: Zentrale, mitgeliefert, eigene Dateien) */
  function catalog() {
    const have = owned();
    return [...stored('zentrale'), ...bundled(), ...stored('datei')].map(s => {
      const key = s.source + '/' + s.id, p = effPrice(s);
      return { key, source: s.source, id: s.id, name: s.name, price: p, owned: p === 0 || have.has(key), dir: s.dir };
    });
  }
  const find = key => catalog().find(s => s.key === key) || null;

  /** Grafik + Raster für das Overlay (gleiches Format wie readSheet in main.js) */
  function sheet(key) {
    const s = find(key);
    if (!s || !s.owned) return null;
    const own = path.join(s.dir, 'sudo-sheet.json');
    const meta = JSON.parse(fs.readFileSync(fs.existsSync(own) ? own : defaultJson, 'utf8'));
    if (!sheetOk(meta)) throw new Error('Raster-Beschreibung unvollständig');
    return { png: 'data:image/png;base64,' + fs.readFileSync(path.join(s.dir, 'sudo-sheet.png')).toString('base64'), meta };
  }
  /** Vorschau für den Store: Grafik als Data-URL und Raster – auch für noch nicht gekaufte Skins */
  function preview(key) {
    const s = find(key);
    if (!s) return null;
    const own = path.join(s.dir, 'sudo-sheet.json');
    try {
      const meta = JSON.parse(fs.readFileSync(fs.existsSync(own) ? own : defaultJson, 'utf8'));
      return sheetOk(meta) ? { png: 'data:image/png;base64,' + fs.readFileSync(path.join(s.dir, 'sudo-sheet.png')).toString('base64'), meta } : null;
    } catch { return null; }
  }

  /** Kaufen: prüft nur Preis und XP; das Abziehen übernimmt das Overlay (main.js schickt xp_spend) */
  function buy(key, xp) {
    const s = find(key);
    if (!s) return { ok: false, msg: 'Diesen Skin gibt es nicht.' };
    if (s.owned) return { ok: true, cost: 0, name: s.name };
    if ((Number(xp) || 0) < s.price) return { ok: false, msg: 'Dafür reichen deine XP noch nicht.' };
    const st = getSettings();
    st.skinsOwned = [...owned(), key];
    saveSettings();
    log(`Skin gekauft: ${s.name} (${s.price} XP)`);
    return { ok: true, cost: s.price, name: s.name };
  }

  /* ---------- .sudoskin-Dateien ---------- */
  function parse(text) {
    let j;
    try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return { ok: false, msg: 'Das ist keine Skin-Datei.' }; }
    if (!j || j.format !== 'sudoskin' || typeof j.png !== 'string') return { ok: false, msg: 'Das ist keine Skin-Datei.' };
    const name = String(j.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return { ok: false, msg: 'Der Skin hat keinen Namen.' };
    let id = slug(j.id || name);
    if (!ID_RE.test(id)) id = 'skin-' + sha256(name).slice(0, 8);
    const png = Buffer.from(j.png, 'base64');
    if (png.length > MAX_PNG) return { ok: false, msg: 'Die Grafik ist größer als 1 MB.' };
    const size = pngSize(png);
    if (!size) return { ok: false, msg: 'Die Grafik ist kein PNG.' };
    let sheetJson = null;
    if (j.sheet != null) {
      if (!sheetOk(j.sheet)) return { ok: false, msg: 'Die Raster-Beschreibung des Skins ist unvollständig.' };
      sheetJson = JSON.stringify(j.sheet);
    } else if (defaultSize && (size.w !== defaultSize.w || size.h !== defaultSize.h)) {
      return { ok: false, msg: 'Die Grafik passt nicht zum Standard-Raster.' };
    }
    return { ok: true, id, name, png, pngB64: j.png, sheetJson };
  }
  function inspectFile(file) {
    try {
      if (fs.statSync(file).size > MAX_PNG * 2) return { ok: false, msg: 'Die Datei ist zu groß.' };
      const r = parse(fs.readFileSync(file, 'utf8'));
      if (!r.ok) return r;
      return { ...r, had: fs.existsSync(path.join(root, 'datei', r.id)) };
    } catch (e) { return { ok: false, msg: 'Datei nicht lesbar: ' + e.message }; }
  }
  function write(source, id, meta, png, sheetJson) {
    const dir = path.join(root, source, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sudo-sheet.png'), png);
    const j = path.join(dir, 'sudo-sheet.json');
    if (sheetJson) fs.writeFileSync(j, sheetJson); else fs.rmSync(j, { force: true });
    fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(meta, null, 1));
  }
  function importFile(file) {
    const r = inspectFile(file);
    if (!r.ok) return r;
    write('datei', r.id, { name: r.name, added: Date.now() }, r.png, r.sheetJson);
    log(`Skin ${r.had ? 'aktualisiert' : 'hinzugefügt'}: ${r.name}`);
    return { ok: true, key: 'datei/' + r.id, name: r.name, msg: r.had ? `„${r.name}“ aktualisiert.` : `„${r.name}“ hinzugefügt.` };
  }
  /** Eine eigene .sudoskin-Datei bauen (z. B. für die Infoseite oder zum Weitergeben) */
  function packFile(key) {
    const s = find(key);
    if (!s) return null;
    const own = path.join(s.dir, 'sudo-sheet.json');
    return JSON.stringify({ format: 'sudoskin', version: 1, id: s.id, name: s.name,
      png: fs.readFileSync(path.join(s.dir, 'sudo-sheet.png')).toString('base64'), sheet: fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, 'utf8')) : null });
  }

  /* ---------- Skins der Zentrale ---------- */
  let syncing = Promise.resolve(false);
  function syncZentrale(cfg, fetchOne) {
    syncing = syncing.then(() => doSync(cfg || {}, fetchOne)).catch(e => { log('Skins der Zentrale: ' + e.message); return false; });
    return syncing;
  }
  async function doSync(cfg, fetchOne) {
    let changed = zentraleFree !== !!cfg.free;
    zentraleFree = !!cfg.free;
    const want = new Map((Array.isArray(cfg.items) ? cfg.items : []).filter(i => i && ID_RE.test(String(i.id))).map(i => [String(i.id), i]));
    for (const s of stored('zentrale')) {
      if (want.has(s.id)) continue;
      fs.rmSync(s.dir, { recursive: true, force: true }); changed = true;
      log('Skin der Zentrale entfernt: ' + s.name);
    }
    const have = new Map(stored('zentrale').map(s => [s.id, s]));
    for (const [id, it] of want) {
      const old = have.get(id);
      if (old && old.sha === it.sha) {
        // nur Name oder Preis geändert: ohne neuen Download übernehmen
        if (old.name !== it.name || old.price !== price(it.price)) {
          fs.writeFileSync(path.join(old.dir, 'skin.json'), JSON.stringify({ name: String(it.name || id).slice(0, 40), price: price(it.price), sha: it.sha }, null, 1)); changed = true;
        }
        continue;
      }
      const r = await fetchOne(id);
      if (!r || !r.ok || typeof r.png !== 'string') { log(`Skin ${id} nicht geladen: ${(r && r.msg) || 'keine Antwort'}`); continue; }
      // Die Zentrale liefert die Raster-Beschreibung als JSON-Text – genau über diesen Text läuft die Prüfsumme
      const sheetRaw = typeof r.sheet === 'string' ? r.sheet : '';
      if (skinSha(r.png, sheetRaw) !== it.sha) { log(`Skin ${id} verworfen: Prüfsumme passt nicht`); continue; }
      let sheetObj = null;
      try { sheetObj = sheetRaw ? JSON.parse(sheetRaw) : null; } catch { log(`Skin ${id} verworfen: Raster-Beschreibung unlesbar`); continue; }
      const p = parse(JSON.stringify({ format: 'sudoskin', name: it.name || id, png: r.png, sheet: sheetObj }));
      if (!p.ok) { log(`Skin ${id} verworfen: ${p.msg}`); continue; }
      write('zentrale', id, { name: p.name, price: price(it.price), sha: it.sha }, p.png, p.sheetJson);
      log(`Skin der Zentrale ${old ? 'aktualisiert' : 'geladen'}: ${p.name}`);
      changed = true;
    }
    return changed;
  }

  return { catalog, sheet, preview, buy, inspectFile, importFile, packFile, syncZentrale, owned: key => { const s = find(key); return !!(s && s.owned); },
    exists: key => !!find(key), free: () => zentraleFree };
}

module.exports = { createSkinStore, skinSha, KEY_RE };
