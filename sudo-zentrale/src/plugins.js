// plugins.js – Plugins (1.12): kleine HTML-Werkzeuge, die sich die Sudos von der Zentrale holen.
// Gleiche Antworten und Fehlermeldungen wie app/plugins.php der PHP-Version.
// Die Zentrale speichert das HTML nur und liefert es aus – ausgeführt wird es abgeschottet im Client.
'use strict';
const crypto = require('crypto');
const { now } = require('./db');

const PLUGIN_MAX_BYTES = 2097152;                 // 2 MB HTML
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

class PluginError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new PluginError(code, msg); };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const clamp = (v, min, max, def) => { const n = parseInt(v, 10) || 0; return n ? Math.max(min, Math.min(max, n)) : def; };

function createPlugins(store, { matches, validTarget }) {
  const item = p => ({ id: p.id, name: p.name, version: String(p.version || ''), sha: p.sha, w: Number(p.w), h: Number(p.h) });
  const userOn = s => (s.plugins_user || 'true') !== 'false';

  /** Hochgeladenes Plugin prüfen; liefert die Spalten für die Tabelle */
  function clean(b) {
    const id = String(b.id || '');
    if (!ID_RE.test(id)) fail(400, 'Kennung: 2 bis 40 Zeichen, nur a–z, 0–9 und Bindestrich.');
    const name = str(b.name, 60);
    if (!name) fail(400, 'Name fehlt.');
    const html = b.html;
    if (typeof html !== 'string' || !html.trim()) fail(400, 'Die Datei ist leer.');
    const size = Buffer.byteLength(html, 'utf8');
    if (size > PLUGIN_MAX_BYTES) fail(400, 'Das Plugin ist größer als 2 MB.');
    if (!/<(!doctype\s+html|html|body)[\s>]/i.test(html)) fail(400, 'Das ist keine HTML-Datei.');
    return { id, name, version: str(b.version, 20), w: clamp(b.w, 360, 1600, 900), h: clamp(b.h, 300, 1200, 720),
      target: validTarget(String(b.target || 'all')), html, sha: crypto.createHash('sha256').update(html, 'utf8').digest('hex'), size };
  }

  /** Für die Sudos: welche Plugins dieses Gerät bekommt und ob eigene erlaubt sind */
  function publicFor(dev, s) {
    const items = store.all('SELECT id, name, version, sha, w, h, target FROM plugins WHERE active = 1 ORDER BY name')
      .filter(p => matches(String(p.target), dev)).map(item);
    return { user: userOn(s), items };
  }

  /** Ein Plugin samt HTML für ein Gerät (nur aktiv und passendes Ziel) */
  function getFor(dev, id) {
    const p = ID_RE.test(String(id)) ? store.get('SELECT * FROM plugins WHERE id = ? AND active = 1', String(id)) : null;
    if (!p || !matches(String(p.target), dev)) fail(404, 'Plugin nicht gefunden.');
    return { ...item(p), html: p.html };
  }

  function admin() {
    return { user: userOn(store.settings()),
      items: store.all('SELECT id, name, version, sha, w, h, size, target, active, author, created, updated FROM plugins ORDER BY name')
        .map(p => ({ ...item(p), size: Number(p.size), target: p.target, active: Number(p.active) === 1, author: p.author, created: Number(p.created), updated: Number(p.updated) })) };
  }

  /** Neu anlegen oder – bei gleicher Kennung – ersetzen */
  function save(b, who) {
    const c = clean(b || {});
    const old = store.get('SELECT id FROM plugins WHERE id = ?', c.id);
    if (old) {
      store.run('UPDATE plugins SET name = ?, version = ?, html = ?, sha = ?, size = ?, w = ?, h = ?, target = ?, author = ?, updated = ? WHERE id = ?',
        c.name, c.version, c.html, c.sha, c.size, c.w, c.h, c.target, who, now(), c.id);
    } else {
      store.run('INSERT INTO plugins (id, name, version, html, sha, size, w, h, target, active, author, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        c.id, c.name, c.version, c.html, c.sha, c.size, c.w, c.h, c.target, who, now(), now());
    }
    store.audit(who, old ? 'plugin_update' : 'plugin_add', `${c.name}${c.version ? ' ' + c.version : ''} → ${c.target}`);
    return { ok: true, id: c.id, updated: !!old };
  }

  function patch(id, b, who) {
    const p = store.get('SELECT id, name FROM plugins WHERE id = ?', String(id)) || fail(404, 'Plugin nicht gefunden.');
    if ('active' in b) store.run('UPDATE plugins SET active = ?, updated = ? WHERE id = ?', b.active ? 1 : 0, now(), p.id);
    if ('target' in b) store.run('UPDATE plugins SET target = ?, updated = ? WHERE id = ?', validTarget(String(b.target || 'all')), now(), p.id);
    store.audit(who, 'plugin_edit', p.name);
  }

  function remove(id, who) {
    const p = store.get('SELECT id, name FROM plugins WHERE id = ?', String(id)) || fail(404, 'Plugin nicht gefunden.');
    store.run('DELETE FROM plugins WHERE id = ?', p.id);
    store.audit(who, 'plugin_delete', p.name);
  }

  return { publicFor, getFor, admin, save, patch, remove };
}

module.exports = { createPlugins, PluginError, PLUGIN_MAX_BYTES };
