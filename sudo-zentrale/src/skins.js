// skins.js – Skins für den Skin-Store (1.14): Die IT lädt Skins hoch, legt einen XP-Preis fest und weist sie zu.
// Gleiche Antworten und Fehlermeldungen wie app/skins.php der PHP-Version.
// Gespeichert werden die Grafik (Base64) und optional die Raster-Beschreibung als JSON-Text – beides genau so, wie es kam,
// damit die Prüfsumme (sha256 von „<Base64>|<JSON>“) in Zentrale und Sudo gleich ist.
'use strict';
const crypto = require('crypto');
const { now } = require('./db');

const SKIN_MAX_PNG = 1048576;                 // 1 MB Grafik
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class SkinError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new SkinError(code, msg); };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const price = v => Math.max(0, Math.min(100000, parseInt(v, 10) || 0));

function createSkins(store, { matches, validTarget }) {
  function clean(b) {
    const id = String(b.id || '');
    if (!ID_RE.test(id)) fail(400, 'Kennung: 2 bis 40 Zeichen, nur a–z, 0–9 und Bindestrich.');
    const name = str(b.name, 40);
    if (!name) fail(400, 'Name fehlt.');
    const png = typeof b.png === 'string' ? b.png : '';
    const bin = /^[A-Za-z0-9+/]+={0,2}$/.test(png) ? Buffer.from(png, 'base64') : Buffer.alloc(0);
    if (!png || bin.length < 8 || !bin.subarray(0, 8).equals(PNG_SIG)) fail(400, 'Die Grafik ist kein PNG.');
    if (bin.length > SKIN_MAX_PNG) fail(400, 'Die Grafik ist größer als 1 MB.');
    let sheet = b.sheet == null || b.sheet === '' ? null : b.sheet;
    if (sheet !== null) {
      let m = null;
      try { m = typeof sheet === 'string' && sheet.length <= 65536 ? JSON.parse(sheet) : null; } catch { m = null; }
      if (!m || !Array.isArray(m.cell) || m.cell.length !== 2 || !m.frames || m.frames.stand == null) fail(400, 'Die Raster-Beschreibung des Skins ist unvollständig.');
    }
    return { id, name, price: price(b.price), png, sheet, sha: crypto.createHash('sha256').update(png + '|' + (sheet || ''), 'utf8').digest('hex'),
      size: bin.length, target: validTarget(String(b.target || 'all')) };
  }

  /** Für die Sudos: welche Skins dieses Gerät im Store sieht und ob alle kostenlos sind */
  function publicFor(dev, s) {
    const items = store.all('SELECT id, name, price, sha, target FROM skins WHERE active = 1 ORDER BY price, name')
      .filter(k => matches(String(k.target), dev)).map(k => ({ id: k.id, name: k.name, price: Number(k.price), sha: k.sha }));
    return { free: (s.skins_free || 'false') === 'true', items };
  }
  function getFor(dev, id) {
    const k = ID_RE.test(String(id)) ? store.get('SELECT * FROM skins WHERE id = ? AND active = 1', String(id)) : null;
    if (!k || !matches(String(k.target), dev)) fail(404, 'Skin nicht gefunden.');
    return { id: k.id, name: k.name, price: Number(k.price), sha: k.sha, png: k.png, sheet: k.sheet == null ? null : k.sheet };
  }
  function admin() {
    return { free: (store.settings().skins_free || 'false') === 'true',
      items: store.all('SELECT * FROM skins ORDER BY price, name').map(k => ({ id: k.id, name: k.name, price: Number(k.price), sha: k.sha, size: Number(k.size),
        target: k.target, active: Number(k.active) === 1, author: k.author, created: Number(k.created), updated: Number(k.updated), png: k.png, sheet: k.sheet == null ? null : k.sheet })) };
  }
  /** Neu anlegen oder – bei gleicher Kennung – ersetzen */
  function save(b, who) {
    const c = clean(b || {});
    const old = store.get('SELECT id FROM skins WHERE id = ?', c.id);
    if (old) {
      store.run('UPDATE skins SET name = ?, price = ?, png = ?, sheet = ?, sha = ?, size = ?, target = ?, author = ?, updated = ? WHERE id = ?',
        c.name, c.price, c.png, c.sheet, c.sha, c.size, c.target, who, now(), c.id);
    } else {
      store.run('INSERT INTO skins (id, name, price, png, sheet, sha, size, target, active, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        c.id, c.name, c.price, c.png, c.sheet, c.sha, c.size, c.target, who, now(), now());
    }
    store.audit(who, old ? 'skin_update' : 'skin_add', `${c.name} · ${c.price} XP → ${c.target}`);
    return { ok: true, id: c.id, updated: !!old };
  }
  function patch(id, b, who) {
    const k = store.get('SELECT id, name FROM skins WHERE id = ?', String(id)) || fail(404, 'Skin nicht gefunden.');
    if ('active' in b) store.run('UPDATE skins SET active = ?, updated = ? WHERE id = ?', b.active ? 1 : 0, now(), k.id);
    if ('target' in b) store.run('UPDATE skins SET target = ?, updated = ? WHERE id = ?', validTarget(String(b.target || 'all')), now(), k.id);
    if ('price' in b) store.run('UPDATE skins SET price = ?, updated = ? WHERE id = ?', price(b.price), now(), k.id);
    store.audit(who, 'skin_edit', k.name);
  }
  function remove(id, who) {
    const k = store.get('SELECT id, name FROM skins WHERE id = ?', String(id)) || fail(404, 'Skin nicht gefunden.');
    store.run('DELETE FROM skins WHERE id = ?', k.id);
    store.audit(who, 'skin_delete', k.name);
  }
  return { publicFor, getFor, admin, save, patch, remove };
}

module.exports = { createSkins, SkinError };
