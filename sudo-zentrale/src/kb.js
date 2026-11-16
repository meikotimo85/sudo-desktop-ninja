// kb.js – 1.9: Wissen & Anleitungen aus SharePoint (Microsoft Graph, nur lesend).
// Gleiche Logik und Antworten wie app/kb.php der PHP-Version.
'use strict';
const zlib = require('zlib');
const { now } = require('./db');

const TEXT_MAX = 12000, ITEMS_MAX = 1500, FILE_MAX = 8 * 1024 * 1024;
const TEXT_EXT = ['docx', 'pptx', 'txt', 'md'];
const LIST_EXT = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'pdf', 'txt', 'md', 'url', 'aspx', 'one', 'vsdx', 'mp4'];
const STOP = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'ich', 'du', 'wir', 'ihr', 'sie', 'es', 'mein', 'meine',
  'meinen', 'wie', 'was', 'wo', 'wer', 'warum', 'kann', 'koennen', 'muss', 'mit', 'auf', 'fuer', 'von', 'zu', 'zum', 'zur', 'im', 'in', 'an', 'am', 'ist', 'sind', 'bei', 'nicht',
  'mehr', 'mir', 'mich', 'dir', 'auch', 'noch', 'schon', 'bitte', 'hilfe', 'geht', 'gibt', 'man', 'uns', 'unser', 'unsere', 'heisst', 'haben', 'habe', 'hat',
  'wird', 'werden', 'dass', 'kein', 'keine', 'wenn', 'dann', 'so', 'da', 'hier', 'jetzt', 'immer', 'gerade', 'the', 'and', 'how', 'can', 'to', 'of', 'for', 'is', 'my', 'a', 'an']);
const KB_SECRETS = ['kb_client_secret', 'kb_token'];

class KbError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new KbError(code, msg); };

/* ---------- Text ---------- */
// Kleiner ZIP-Leser für docx/pptx
function zipEntries(buf, pattern, maxFiles = 80) {
  const out = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || buf.length < eocd + 22) return out;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n && Object.keys(out).length < maxFiles; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (!pattern.test(name) || usize > 20 * 1024 * 1024) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    try { out[name] = method === 8 ? zlib.inflateRawSync(data).toString('utf8') : method === 0 ? data.toString('utf8') : null; } catch { /* kaputt */ }
    if (out[name] == null) delete out[name];
  }
  return out;
}
const decodeEnt = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const xmlText = (xml, para) => decodeEnt(xml.replace(new RegExp(`</${para}>`, 'g'), '\n').replace(/<w:tab\/>|<w:br\/>|<a:br\/>/g, ' ').replace(/<[^>]*>/g, ''));
const cleanText = t => String(t).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, TEXT_MAX);
const htmlText = h => cleanText(decodeEnt(String(h).replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')));
function extract(ext, buf) {
  let t = '';
  if (ext === 'docx') for (const x of Object.values(zipEntries(buf, /^word\/(document|header\d*|footer\d*)\.xml$/))) t += xmlText(x, 'w:p') + '\n';
  else if (ext === 'pptx') {
    const s = zipEntries(buf, /^ppt\/slides\/slide\d+\.xml$/, 200);
    for (const k of Object.keys(s).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))) t += xmlText(s[k], 'a:p') + '\n';
  } else if (ext === 'txt' || ext === 'md') t = buf.toString('utf8');
  return cleanText(t);
}
const fold = s => ' ' + String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[éè]/g, 'e').replace(/[áà]/g, 'a')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
const count = (h, n) => { let c = 0, i = 0; while ((i = h.indexOf(n, i)) >= 0) { c++; i += n.length; } return c; };

function createKb(store, { cfg, log }) {
  const api = (cfg.graphApi || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
  const login = (cfg.graphLogin || 'https://login.microsoftonline.com').replace(/\/+$/, '');
  const S = () => store.settings();

  function creds(s = S()) {
    const e = cfg.entra || {}, own = String(s.kb_client_id || '').trim() !== '';
    return { tenant: String(s.kb_tenant || '').trim() || e.tenant || '', id: own ? String(s.kb_client_id).trim() : e.clientId || '', secret: own ? String(s.kb_client_secret || '') : e.clientSecret || '', own };
  }
  async function token(fresh = false) {
    const s = S();
    if (!fresh && s.kb_token && Number(s.kb_token_exp || 0) > now() + 60000) return s.kb_token;
    const c = creds(s);
    if (!c.tenant || !c.id || !c.secret) throw new Error('Bitte Tenant, Client ID und Client Secret eintragen.');
    let r, j = {};
    try {
      r = await fetch(`${login}/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret, scope: 'https://graph.microsoft.com/.default' }) });
      j = await r.json().catch(() => ({}));
    } catch (e) { throw new Error('Anmeldung bei Microsoft fehlgeschlagen: ' + e.message); }
    if (r.status !== 200 || !j.access_token) throw new Error('Anmeldung bei Microsoft fehlgeschlagen: ' + String(j.error_description || j.error || 'HTTP ' + r.status).split(/\r?\n/)[0].slice(0, 200));
    store.setSetting('kb_token', j.access_token); store.setSetting('kb_token_exp', String(now() + (Number(j.expires_in) || 3600) * 1000));
    return j.access_token;
  }
  async function graph(pathOrUrl, raw = false, timeout = 20000) {
    const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : api + pathOrUrl;
    let r;
    for (let tr = 0; tr < 2; tr++) {
      try { r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { authorization: 'Bearer ' + await token(tr > 0), accept: 'application/json' } }); }
      catch (e) { if (e.message.startsWith('Anmeldung') || e.message.startsWith('Bitte')) throw e; throw new Error('Microsoft Graph nicht erreichbar (' + e.message + ').'); }
      if (r.status === 401 && tr === 0) continue;
      break;
    }
    if (r.status === 200) return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw new Error('Keine Berechtigung für diese SharePoint-Website. Die App braucht „Sites.Selected“ (mit Freigabe für die Website) oder „Sites.Read.All“.');
    if (r.status === 404) throw new Error('Nicht gefunden – stimmt der Link?');
    throw new Error(`Graph-Fehler ${r.status}` + (j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 160) : ''));
  }
  async function graphAll(p, max = 2000) {
    const out = []; let next = p;
    while (next && out.length < max) { const j = await graph(next); out.push(...(j.value || [])); next = j['@odata.nextLink'] || null; }
    return out;
  }
  const enc = s => encodeURIComponent(s);

  async function resolve(link) {
    let u;
    try { u = new URL(String(link).trim()); } catch { u = null; }
    if (!u || u.protocol !== 'https:' || !/\.sharepoint\.(com|de|us)$/i.test(u.hostname)) throw new Error('Bitte einen SharePoint-Link einfügen (https://…sharepoint.com/sites/…).');
    const host = u.hostname.toLowerCase();
    let p = decodeURIComponent(u.pathname);
    if (u.searchParams.get('id')) p = u.searchParams.get('id'); else if (u.searchParams.get('RootFolder')) p = u.searchParams.get('RootFolder');
    p = p.replace(/\/Forms\/[^/]+\.aspx$/i, '').replace(/\/+$/, '');
    let site, sitePath, rest;
    const m = p.match(/^\/(sites|teams)\/([^/]+)(\/.*)?$/i);
    if (m) { site = await graph(`/sites/${host}:/${m[1]}/${enc(m[2])}?$select=id,displayName,webUrl`); sitePath = `/${m[1]}/${m[2]}`; rest = m[3] || ''; }
    else { site = await graph(`/sites/${host}?$select=id,displayName,webUrl`); sitePath = ''; rest = p; }
    const siteId = String(site.id);
    if (rest === '' || /^\/SitePages(\/.*)?$/i.test(rest)) return { kind: 'pages', site_id: siteId, drive_id: '', folder_id: '', title: (site.displayName || 'Website') + ' · Seiten' };
    let best = null, bestLen = -1;
    for (const d of (await graph(`/sites/${enc(siteId)}/drives?$select=id,name,webUrl`)).value || []) {
      const dp = decodeURIComponent(new URL(d.webUrl).pathname).replace(/\/+$/, '');
      const rel = dp.slice(sitePath.length);
      if (rel && (rest.toLowerCase() === rel.toLowerCase() || rest.toLowerCase().startsWith(rel.toLowerCase() + '/')) && rel.length > bestLen) { best = d; bestLen = rel.length; }
    }
    if (!best) throw new Error('In dieser Website keine passende Dokumentbibliothek gefunden.');
    const folder = rest.slice(bestLen).replace(/^\/+|\/+$/g, '');
    let folderId = 'root', title = best.name;
    if (folder) {
      const it = await graph(`/drives/${enc(best.id)}/root:/${folder.split('/').map(enc).join('/')}?$select=id,name,folder`);
      if (!it.folder) throw new Error('Der Link zeigt auf eine Datei. Bitte den Ordner verlinken.');
      folderId = String(it.id); title += ' / ' + folder;
    }
    return { kind: 'library', site_id: siteId, drive_id: String(best.id), folder_id: folderId, title: `${site.displayName || ''} · ${title}` };
  }
  async function add(link, who) {
    link = String(link || '').trim();
    if (link.length > 800) fail(400, 'Der Link ist zu lang.');
    if (store.get('SELECT COUNT(*) n FROM kb_sources').n >= 20) fail(400, 'Höchstens 20 Quellen.');
    let r;
    try { r = await resolve(link); } catch (e) { fail(400, e.message); }
    if (store.get('SELECT 1 FROM kb_sources WHERE site_id = ? AND drive_id = ? AND folder_id = ? AND kind = ?', r.site_id, r.drive_id, r.folder_id, r.kind)) fail(409, 'Diese Quelle ist schon eingetragen.');
    const x = store.run(`INSERT INTO kb_sources (url, kind, site_id, drive_id, folder_id, title, active, last_sync, last_error, items, created) VALUES (?, ?, ?, ?, ?, ?, 1, 0, '', 0, ?)`,
      link, r.kind, r.site_id, r.drive_id, r.folder_id, r.title.slice(0, 200), now());
    const id = Number(x.lastInsertRowid);
    store.audit(who, 'kb_add', r.title);
    return { id, title: r.title, ...(await sync(id)) };
  }
  function storeItem(sourceId, it, at) {
    store.run(`INSERT INTO kb_items (source_id, item_id, kind, title, path, url, ext, modified, etag, text, norm, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_id, item_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, path = excluded.path, url = excluded.url, ext = excluded.ext, modified = excluded.modified,
      etag = excluded.etag, text = excluded.text, norm = excluded.norm, synced = excluded.synced`,
      sourceId, it.item_id, it.kind, it.title.slice(0, 250), it.path.slice(0, 400), it.url.slice(0, 1000), it.ext, it.modified, it.etag.slice(0, 200), it.text, fold(`${it.title} ${it.path} ${it.text}`), at);
  }
  const syncing = new Set();
  async function sync(id) {
    const src = store.get('SELECT * FROM kb_sources WHERE id = ?', Number(id));
    if (!src) fail(404, 'Quelle nicht gefunden.');
    if (syncing.has(src.id)) return { ok: false, items: 0, read: 0, error: 'Abgleich läuft schon.' };
    syncing.add(src.id);
    const t0 = now(); let n = 0, read = 0;
    const known = new Map(store.all('SELECT item_id, etag FROM kb_items WHERE source_id = ?', src.id).map(r => [r.item_id, r.etag]));
    const keep = itemId => store.run('UPDATE kb_items SET synced = ? WHERE source_id = ? AND item_id = ?', t0, src.id, itemId);
    const ms = d => (Date.parse(d || '') || 0);
    try {
      if (src.kind === 'pages') {
        for (const p of await graphAll(`/sites/${enc(src.site_id)}/pages/microsoft.graph.sitePage?$select=id,title,description,webUrl,lastModifiedDateTime,eTag,name&$top=100`, ITEMS_MAX)) {
          const etag = String(p.eTag || p.lastModifiedDateTime || '');
          if (etag && known.get(p.id) === etag) { keep(p.id); n++; continue; }
          let text = String(p.description || '');
          try { for (const w of (await graph(`/sites/${enc(src.site_id)}/pages/${enc(p.id)}/microsoft.graph.sitePage/webParts`)).value || []) if (w.innerHtml) text += '\n' + htmlText(w.innerHtml); read++; }
          catch { /* nur Titel und Beschreibung */ }
          storeItem(src.id, { item_id: String(p.id), kind: 'page', title: String(p.title || p.name || 'Seite'), path: 'Websiteseiten', url: String(p.webUrl || ''), ext: 'aspx', modified: ms(p.lastModifiedDateTime), etag, text: cleanText(text) }, t0);
          n++;
        }
      } else {
        const drive = enc(src.drive_id), queue = [[src.folder_id, '']];
        while (queue.length && n < ITEMS_MAX) {
          const [fid, fpath] = queue.shift();
          const base = fid === 'root' ? `/drives/${drive}/root/children` : `/drives/${drive}/items/${enc(fid)}/children`;
          for (const it of await graphAll(base + '?$select=id,name,webUrl,file,folder,lastModifiedDateTime,eTag,size&$top=200', ITEMS_MAX)) {
            if (it.folder) { if ((fpath.match(/\//g) || []).length < 5) queue.push([String(it.id), `${fpath}/${it.name}`]); continue; }
            const ext = (String(it.name).match(/\.([^.]+)$/) || [])[1]; const e = ext ? ext.toLowerCase() : '';
            if (!LIST_EXT.includes(e) || String(it.name).startsWith('~$')) continue;
            const etag = String(it.eTag || '');
            if (etag && known.get(it.id) === etag) { keep(it.id); n++; continue; }
            let text = '';
            if (TEXT_EXT.includes(e) && Number(it.size || 0) <= FILE_MAX) { try { text = extract(e, await graph(`/drives/${drive}/items/${enc(it.id)}/content`, true, 40000)); read++; } catch { /* nur Name */ } }
            storeItem(src.id, { item_id: String(it.id), kind: 'file', title: String(it.name).replace(/\.[^.]+$/, ''), path: fpath.replace(/^\//, ''), url: String(it.webUrl || ''), ext: e, modified: ms(it.lastModifiedDateTime), etag, text }, t0);
            if (++n >= ITEMS_MAX) break;
          }
        }
      }
      store.run('DELETE FROM kb_items WHERE source_id = ? AND synced < ?', src.id, t0);
      store.run("UPDATE kb_sources SET last_sync = ?, last_error = '', items = ? WHERE id = ?", now(), n, src.id);
      return { ok: true, items: n, read };
    } catch (e) {
      store.run('UPDATE kb_sources SET last_sync = ?, last_error = ? WHERE id = ?', now(), String(e.message).slice(0, 300), src.id);
      return { ok: false, items: n, read, error: e.message };
    } finally { syncing.delete(src.id); }
  }
  // Im Hintergrund: alle 2 Minuten schauen, ob eine Quelle fällig ist
  async function tick() {
    const s = S();
    if (s.kb_enabled !== 'true') return;
    const every = Math.max(15, Math.min(1440, Number(s.kb_interval) || 60)) * 60000;
    const src = store.get('SELECT id FROM kb_sources WHERE active = 1 AND last_sync < ? ORDER BY last_sync LIMIT 1', now() - every);
    if (src) { const r = await sync(src.id); if (!r.ok && log) log.warn('Wissen: ' + r.error); }
  }
  const timer = setInterval(() => tick().catch(() => {}), 120000);

  /* ---------- Suche ---------- */
  const terms = q => [...new Set(fold(q).trim().split(' ').filter(w => w.length >= 2 && !STOP.has(w)))].slice(0, 8);
  function snippet(text, ts) {
    if (!text) return '';
    const low = text.toLowerCase(); let pos = null;
    for (const t of ts) for (const x of [t, t.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü')]) { const p = low.indexOf(x); if (p >= 0 && (pos === null || p < pos)) pos = p; }
    const start = Math.max(0, (pos || 0) - 70);
    const s = [...text].slice(start, start + 220).join('').replace(/\s+/g, ' ').trim();
    return (start > 0 ? '… ' : '') + s + ([...text].length > start + 220 ? ' …' : '');
  }
  const pub = (r, ts = [], score = 0) => ({ id: r.id, title: r.title, path: r.path, url: r.url, ext: r.ext, kind: r.kind, source: r.source || '', modified: r.modified || null, snippet: snippet(r.text || '', ts), score, match: Math.round((r._match || 0) * 100) / 100 });
  function search(q, limit = 8) {
    const ts = terms(q);
    if (!ts.length) return [];
    const rows = store.all(`SELECT i.*, s.title AS source FROM kb_items i JOIN kb_sources s ON s.id = i.source_id WHERE s.active = 1 AND (${ts.map(() => 'i.norm LIKE ?').join(' OR ')}) LIMIT 400`, ...ts.map(t => `%${t}%`));
    let scored = [];
    for (const r of rows) {
      const title = fold(r.title), path = fold(r.path), norm = r.norm || '';
      let score = 0, hit = 0;
      for (const t of ts) {
        const inT = count(title, t), inP = count(path, t), inX = Math.min(6, count(norm, t) - inT - inP);
        if (inT + inP + Math.max(0, inX) > 0) hit++;
        score += inT * 8 + (title.includes(' ' + t + ' ') ? 6 : 0) + inP * 3 + Math.max(0, inX);
      }
      if (!hit) continue;
      score = score * (0.4 + 0.6 * hit / ts.length) + (hit === ts.length ? 10 : 0);
      scored.push([score, { ...r, _match: hit / ts.length }]);
    }
    scored.sort((a, b) => b[0] - a[0] || b[1].modified - a[1].modified);
    const top = scored.length ? scored[0][0] : 0;
    scored = scored.filter(x => x[0] >= Math.max(3, top * 0.15));
    return scored.slice(0, limit).map(([sc, r]) => pub(r, ts, Math.round(sc)));
  }
  const recent = (limit = 10) => store.all(`SELECT i.*, s.title AS source FROM kb_items i JOIN kb_sources s ON s.id = i.source_id WHERE s.active = 1 ORDER BY i.modified DESC LIMIT ${Math.max(1, Math.min(30, limit))}`).map(r => pub(r));
  function aiContext(question, s = S()) {
    if (s.kb_enabled !== 'true' || (s.kb_ai || 'true') !== 'true') return '';
    // Relevant genug: klarer Treffer oder mindestens die Hälfte der Suchwörter kommt vor
    const hits = search(question, 3).filter(h => h.score >= 8 || (h.score >= 3 && h.match >= 0.5));
    if (!hits.length) return '';
    return store.all(`SELECT id, title, url, text FROM kb_items WHERE id IN (${hits.map(h => Number(h.id)).join(',')})`)
      .map(r => `- ${r.title} (${r.url}):\n${String(r.text || '').replace(/\s+/g, ' ').slice(0, 900)}`).join('\n');
  }
  const isPublic = (s = S()) => ({ enabled: s.kb_enabled === 'true' && !!store.get('SELECT 1 FROM kb_items LIMIT 1') });
  const sourcePublic = r => ({ id: r.id, url: r.url, kind: r.kind, title: r.title, active: !!r.active, lastSync: r.last_sync || null, lastError: r.last_error || '', items: r.items });
  function overview() {
    const s = S(), c = creds(s);
    return { enabled: s.kb_enabled === 'true', ai: (s.kb_ai || 'true') === 'true', interval: Number(s.kb_interval || 60), tenant: s.kb_tenant || '', clientId: s.kb_client_id || '',
      secretSet: !!s.kb_client_secret, fallback: !c.own && !!c.id && !!c.secret, ready: !!(c.tenant && c.id && c.secret),
      items: store.get('SELECT COUNT(*) n FROM kb_items').n, withText: store.get("SELECT COUNT(*) n FROM kb_items WHERE text <> ''").n,
      sources: store.all('SELECT * FROM kb_sources ORDER BY id').map(sourcePublic) };
  }
  function setActive(id, on) { store.run('UPDATE kb_sources SET active = ? WHERE id = ?', on ? 1 : 0, Number(id)); }
  function remove(id, who) {
    const src = store.get('SELECT * FROM kb_sources WHERE id = ?', Number(id)); if (!src) fail(404, 'Quelle nicht gefunden.');
    store.run('DELETE FROM kb_items WHERE source_id = ?', src.id); store.run('DELETE FROM kb_sources WHERE id = ?', src.id); store.audit(who, 'kb_delete', src.title);
  }
  async function test() { try { await token(true); } catch (e) { fail(400, e.message); } }
  return { add, sync, search, recent, aiContext, isPublic, overview, setActive, remove, test, stop: () => clearInterval(timer) };
}

module.exports = { createKb, KbError, KB_SECRETS, _test: { zipEntries, extract, fold } };
