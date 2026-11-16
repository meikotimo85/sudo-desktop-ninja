// intel.js – IT-Lage: öffentlicher Microsoft-/Azure-Status und Datenlecks (Have I Been Pwned)
// Alles ohne Tenant und ohne Anmeldung. Meldungen gehen als { kind, ... } an das Overlay (wie beim System-Wächter).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const M365_URL = 'https://status.cloud.microsoft/api/posts/m365Consumer';
const AZURE_URL = 'https://azure.status.microsoft/en-us/status/feed/';
const HIBP = 'https://haveibeenpwned.com/api/v3';
const PWNED_PW = 'https://api.pwnedpasswords.com/range/';
const UA = 'Sudo-Desktop-Ninja (MeikoSoft)';

const DEFAULTS = {
  m365: true,            // öffentlicher Microsoft-365-Status
  azure: true,           // Azure-Status (RSS)
  breaches: true,        // neue öffentliche Datenlecks bei HIBP melden
  breachMin: 1000000,    // … erst ab so vielen betroffenen Konten
  emails: [],            // eigene Adressen für den Leak-Check (nur mit HIBP-API-Schlüssel)
  hibpKey: '',
  // Sicherheitswarnungen per RSS (ab 1.1.1)
  feeds: [
    { id: 'certbund', name: 'CERT-Bund Sicherheitswarnungen', url: 'https://wid.cert-bund.de/content/public/securityAdvisory/rss', on: true },
    { id: 'buergercert', name: 'Bürger-CERT (Verbraucher)', url: 'https://wid.cert-bund.de/content/public/buergercert/rss', on: false },
    { id: 'bsi', name: 'BSI Presse & Kurzmitteilungen', url: 'https://www.bsi.bund.de/SiteGlobals/Functions/RSSFeed/RSSNewsfeed/RSSNewsfeed_Presse_Veranstaltungen.xml', on: false }
  ],
  feedMin: 'hoch',       // ab welchem Schweregrad Sudo eine Blase zeigt: kritisch | hoch | mittel | alle
  feedNewOnly: true,     // nur neue Warnungen, keine [UPDATE]-Meldungen
  feedWords: '',         // optional: nur melden, wenn eines dieser Stichwörter im Titel steht (Komma-getrennt)
  feedSec: 8             // so lange bleibt die Blase stehen (5–10 Sekunden)
};
const PRESET_FEEDS = DEFAULTS.feeds.map(f => f.id);
const SEV = { kritisch: 4, hoch: 3, mittel: 2, niedrig: 1 };
const STATUS_OK = /^(operational|service restored|resolved|post-incident|false positive|restored)/i;
const MIN = 60000;

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const untag = s => s.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '');
// Feeds liefern HTML oft doppelt verpackt (&lt;p&gt;) – darum zweimal entpacken
const stripHtml = s => untag(decode(untag(String(s || '')))).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const maskMail = m => { const [u, d] = String(m).split('@'); return d ? `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}` : m; };
const mailKey = m => crypto.createHash('sha256').update(String(m).trim().toLowerCase()).digest('hex').slice(0, 16);

// Kleiner RSS-/Atom-Leser ohne Abhängigkeiten
function parseFeed(xml) {
  const items = [];
  const cdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? stripHtml(cdata(m[1])) : ''; };
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const title = tag(b, 'title');
    const date = tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date');
    items.push({ id: tag(b, 'guid') || tag(b, 'id') || link || title, title, link: link.replace(/&amp;/g, '&'),
      text: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'), category: tag(b, 'category'),
      date: date ? new Date(date).toISOString() : null });
  }
  return { title: tag(xml.replace(/<(item|entry)[\s>][\s\S]*$/i, ''), 'title'), items };
}

// CERT-Bund-Titel: "[NEU] [hoch] QT: Mehrere Schwachstellen …" → Status, Schweregrad, sauberer Titel
function advisoryInfo(item) {
  let t = item.title || '', state = '', sev = '';
  const m = t.match(/^\s*\[(NEU|UPDATE)\]\s*(?:\[(kritisch|hoch|mittel|niedrig)\])?\s*/i);
  if (m) { state = m[1].toUpperCase(); sev = (m[2] || '').toLowerCase(); t = t.slice(m[0].length); }
  if (!sev && SEV[String(item.category).toLowerCase()]) sev = String(item.category).toLowerCase();
  return { ...item, title: t.trim(), state, sev };
}

function createIntel({ dir, getSettings, notify, log, fetch, onChange, test }) {
  const file = path.join(dir, 'intel.json');
  let state = { m365: {}, azure: {}, latestBreach: null, mails: {}, checked: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* erster Start */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(state, null, 1)); } catch (e) { log('IT-Lage speichern: ' + e.message); } };
  const cfg = () => ({ ...DEFAULTS, ...(getSettings().intel || {}) });
  const view = { m365: { at: null, error: null, items: [] }, azure: { at: null, error: null, items: [] }, breach: { at: null, error: null, latest: null }, leaks: { at: null, error: null, results: [] } };
  const changed = () => { try { onChange && onChange(snapshot()); } catch { /* Fenster zu */ } };

  async function get(url, o = {}) {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...(o.headers || {}) }, signal: AbortSignal.timeout(o.timeout || 15000), cache: 'no-store' });
    return r;
  }

  /* ---------- Microsoft 365 (öffentliche Statusseite, Verbraucher-Dienste) ---------- */
  async function checkM365() {
    if (!cfg().m365) return;
    try {
      const r = await get(M365_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error('Unerwartete Antwort');
      const first = !Object.keys(state.m365).length;
      view.m365.items = list.map(s => ({ name: s.ServiceDisplayName || s.ServiceWorkloadName, status: s.Status || '?', ok: STATUS_OK.test(s.Status || ''),
        title: stripHtml(s.Title), message: stripHtml(s.Message).slice(0, 600), updated: s.LastUpdatedTime }));
      const notes = [];
      for (const s of view.m365.items) {
        const was = state.m365[s.name];
        if (was === undefined && first) { if (!s.ok) notes.push({ kind: 'cloud_down', name: s.name, status: s.status }); }
        else if (was !== undefined && was !== s.ok) notes.push({ kind: s.ok ? 'cloud_ok' : 'cloud_down', name: s.name, status: s.status });
        if (was !== s.ok) log(`Microsoft-Status: ${s.name} → ${s.status}`);
        state.m365[s.name] = s.ok;
      }
      // Viele Wechsel auf einmal: eine Sammelmeldung statt Blasen-Gewitter
      const down = notes.filter(n => n.kind === 'cloud_down');
      if (notes.length > 2) notify(down.length ? { kind: 'cloud_down', name: `${down.length} Dienste`, status: down[0].status } : { kind: 'cloud_ok', name: `${notes.length} Dienste` });
      else notes.forEach(n => notify(n));
      view.m365.at = new Date().toISOString(); view.m365.error = null;
    } catch (e) { view.m365.error = e.message; }
  }

  /* ---------- Azure (offizieller RSS-Feed, enthält nur aktuelle Störungen) ---------- */
  async function checkAzure() {
    if (!cfg().azure) return;
    try {
      const r = await get(AZURE_URL);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const feed = parseFeed(await r.text());
      view.azure.items = feed.items.slice(0, 20);
      const seen = state.azure || {};
      const fresh = view.azure.items.filter(i => !seen[i.id]);
      const now = Date.now();
      if (fresh.length) {
        if (fresh.length > 2) notify({ kind: 'azure_many', count: fresh.length });
        else for (const i of fresh) notify({ kind: 'azure', title: i.title, link: i.link });
        log('Azure-Status: ' + fresh.map(i => i.title).join(' | '));
      }
      for (const i of view.azure.items) seen[i.id] = seen[i.id] || now;
      for (const k of Object.keys(seen)) if (now - seen[k] > 30 * 24 * 60 * MIN) delete seen[k];
      state.azure = seen;
      view.azure.at = new Date().toISOString(); view.azure.error = null;
    } catch (e) { view.azure.error = e.message; }
  }

  /* ---------- Neue öffentliche Datenlecks (kostenlos, ohne Schlüssel) ---------- */
  const breachInfo = b => b && ({ name: b.Name, title: b.Title, domain: b.Domain, date: b.BreachDate, added: b.AddedDate,
    count: b.PwnCount, classes: b.DataClasses || [], verified: b.IsVerified, text: stripHtml(b.Description).slice(0, 700),
    link: 'https://haveibeenpwned.com/Breach/' + encodeURIComponent(b.Name) });
  async function checkLatestBreach() {
    if (!cfg().breaches) return;
    try {
      const r = await get(HIBP + '/latestbreach');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = breachInfo(await r.json());
      view.breach.latest = b;
      if (state.latestBreach && b.name !== state.latestBreach && b.count >= (Number(cfg().breachMin) || 0)) {
        notify({ kind: 'breach_new', title: b.title, count: b.count, link: b.link });
        log(`Neues Datenleck bei HIBP: ${b.title} (${b.count})`);
      }
      state.latestBreach = b.name;
      view.breach.at = new Date().toISOString(); view.breach.error = null;
    } catch (e) { view.breach.error = e.message; }
  }

  /* ---------- Eigene Adressen (HIBP-API-Schlüssel nötig, max. 10 Abfragen/Minute) ---------- */
  let leakBusy = false;
  async function checkMails(manual = false) {
    const c = cfg();
    const mails = (c.emails || []).filter(Boolean);
    if (!c.hibpKey || !mails.length || leakBusy) return { ok: false, msg: !c.hibpKey ? 'Kein API-Schlüssel hinterlegt.' : 'Keine Adresse eingetragen.' };
    leakBusy = true;
    const results = [];
    try {
      for (let i = 0; i < mails.length; i++) {
        if (i) await new Promise(r => setTimeout(r, 6500));
        const mail = mails[i], key = mailKey(mail);
        const r = await get(`${HIBP}/breachedaccount/${encodeURIComponent(mail)}?truncateResponse=false`, { headers: { 'hibp-api-key': c.hibpKey } });
        if (r.status === 401) throw new Error('API-Schlüssel ungültig');
        if (r.status === 429) throw new Error('Zu viele Abfragen – später noch mal');
        if (r.status !== 404 && !r.ok) throw new Error('HTTP ' + r.status);
        const list = r.status === 404 ? [] : (await r.json()).map(breachInfo);
        const known = state.mails[key];
        const fresh = known ? list.filter(b => !known.includes(b.name)) : [];
        state.mails[key] = list.map(b => b.name);
        results.push({ mail: maskMail(mail), breaches: list.sort((a, b) => String(b.date).localeCompare(String(a.date))), fresh: fresh.map(b => b.name) });
        if (fresh.length) {
          notify({ kind: 'leak', mail: maskMail(mail), title: fresh[0].title, count: fresh.length });
          log(`Leak-Check: ${maskMail(mail)} neu in ${fresh.map(b => b.name).join(', ')}`);
        }
      }
      view.leaks = { at: new Date().toISOString(), error: null, results };
      state.leakView = view.leaks;            // letzte Ergebnisse (Adressen nur maskiert) überleben einen Neustart
      state.checked.mails = Date.now();
      save();
      return { ok: true, msg: 'Geprüft.' };
    } catch (e) {
      view.leaks.error = e.message; view.leaks.results = results.length ? results : view.leaks.results;
      return { ok: false, msg: e.message };
    } finally { leakBusy = false; changed(); }
  }

  /* ---------- Passwort prüfen (k-Anonymität: nur 5 Zeichen des SHA-1-Hashes verlassen den PC) ---------- */
  async function checkPassword(pw) {
    if (!pw) return { ok: false, msg: 'Bitte ein Passwort eingeben.' };
    const h = crypto.createHash('sha1').update(String(pw), 'utf8').digest('hex').toUpperCase();
    try {
      const r = await get(PWNED_PW + h.slice(0, 5), { headers: { 'Add-Padding': 'true' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const line = (await r.text()).split(/\r?\n/).find(l => l.startsWith(h.slice(5) + ':'));
      const count = line ? Number(line.split(':')[1]) : 0;
      return { ok: true, count };
    } catch (e) { return { ok: false, msg: 'Keine Verbindung: ' + e.message }; }
  }

  /* ---------- Sicherheitswarnungen (RSS/Atom) ---------- */
  state.feeds = state.feeds || {};
  view.feeds = { at: null, items: [], status: {} };
  // Zuletzt gesehene Meldungen nach einem Neustart sofort zeigen
  for (const [id, f] of Object.entries(state.feeds)) for (const i of f.items || []) view.feeds.items.push({ ...i, feed: id });
  const feedList = () => (cfg().feeds || []).filter(f => f && f.url && f.on);
  const wordsRe = () => { const w = String(cfg().feedWords || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean); return w.length ? new RegExp(w.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null; };
  function announceable(i) {
    const c = cfg();
    if (c.feedNewOnly && i.state === 'UPDATE') return false;
    const min = SEV[c.feedMin] || 0;
    if (min && i.sev && (SEV[i.sev] || 0) < min) return false;
    if (min && !i.sev && min > 1) { /* Feeds ohne Schweregrad (BSI-News): nur mit Stichwort-Filter oder bei "alle" */ if (!wordsRe()) return false; }
    const re = wordsRe();
    return !re || re.test(i.title) || re.test(i.text || '');
  }
  async function checkFeeds() {
    const fresh = [];
    for (const f of feedList()) {
      const st = state.feeds[f.id] = state.feeds[f.id] || { seen: {}, items: [] };
      try {
        const headers = {};
        if (st.etag) headers['if-none-match'] = st.etag;
        if (st.lastMod) headers['if-modified-since'] = st.lastMod;
        const r = await get(f.url, { headers, timeout: 20000 });
        if (r.status === 304) { view.feeds.status[f.id] = { ok: true, at: new Date().toISOString(), count: st.items.length }; continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        st.etag = r.headers && r.headers.get ? r.headers.get('etag') : null;
        st.lastMod = r.headers && r.headers.get ? r.headers.get('last-modified') : null;
        const feed = parseFeed(await r.text());
        if (!feed.items.length && !/<(rss|feed|rdf)/i.test(feed.title + '')) { /* leerer Feed ist ok */ }
        const items = feed.items.map(advisoryInfo).filter(i => i.title);
        const first = !Object.keys(st.seen).length;
        const now = Date.now();
        for (const i of items) {
          if (!st.seen[i.id]) { if (!first) fresh.push({ ...i, feed: f.id, feedName: f.name }); st.seen[i.id] = now; }
        }
        for (const k of Object.keys(st.seen)) if (now - st.seen[k] > 60 * 24 * 60 * MIN) delete st.seen[k];
        st.items = items.slice(0, 40).map(i => ({ id: i.id, title: i.title, link: i.link, text: String(i.text || '').slice(0, 300), date: i.date, sev: i.sev, state: i.state }));
        view.feeds.status[f.id] = { ok: true, at: new Date().toISOString(), count: items.length, title: feed.title };
      } catch (e) { view.feeds.status[f.id] = { ok: false, error: e.message, at: new Date().toISOString() }; }
    }
    // Übersicht: alle aktiven Feeds, neueste zuerst
    const on = new Set(feedList().map(f => f.id));
    view.feeds.items = Object.entries(state.feeds).filter(([id]) => on.has(id))
      .flatMap(([id, st]) => (st.items || []).map(i => ({ ...i, feed: id })))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 80);
    view.feeds.at = new Date().toISOString();
    const say = fresh.filter(announceable);
    if (say.length) log(`Sicherheitswarnungen: ${say.length} neu (${say.slice(0, 3).map(i => i.title).join(' | ')})`);
    if (say.length > 3) notify({ kind: 'advisory_many', count: say.length, dur: Number(cfg().feedSec) || 8 });
    else for (const i of say) notify({ kind: i.sev === 'kritisch' ? 'advisory_crit' : 'advisory', title: i.title.length > 90 ? i.title.slice(0, 88) + '…' : i.title,
      sev: i.sev || 'info', feed: i.feedName, link: i.link || 'sudo:lage/feeds', dur: Math.max(5, Math.min(10, Number(cfg().feedSec) || 8)) });
  }

  /* ---------- Takt ---------- */
  const due = (name, ms) => Date.now() - (state.checked[name] || 0) >= ms;
  async function tick(force = false) {
    const jobs = [];
    if (force || due('status', 5 * MIN)) { state.checked.status = Date.now(); jobs.push(checkM365(), checkAzure()); }
    if (force || due('breach', 6 * 60 * MIN)) { state.checked.breach = Date.now(); jobs.push(checkLatestBreach()); }
    if (force || due('feeds', 15 * MIN)) { state.checked.feeds = Date.now(); jobs.push(checkFeeds()); }
    await Promise.all(jobs);
    if (jobs.length) { save(); changed(); }
    if (!force && due('mails', 12 * 60 * MIN) && cfg().hibpKey && (cfg().emails || []).length) await checkMails();
  }
  if (state.leakView) view.leaks = { ...state.leakView, error: null };
  // Nach jedem Start einmal frisch abfragen (Statusdaten liegen nur im Speicher)
  delete state.checked.status;
  delete state.checked.breach;
  delete state.checked.feeds;

  function snapshot() {
    const c = cfg();
    return { ...JSON.parse(JSON.stringify(view)), cfg: { ...c, hibpKey: c.hibpKey ? '••••' + c.hibpKey.slice(-4) : '' }, hasKey: !!c.hibpKey };
  }
  // Feed-Liste geändert (neuer Feed, an/aus): gleich abfragen
  async function feedsChanged() { state.checked.feeds = Date.now(); await checkFeeds(); save(); changed(); }
  return { tick, checkMails, checkPassword, snapshot, view, parseFeed, feedsChanged };
}

module.exports = { createIntel, parseFeed, advisoryInfo, INTEL_DEFAULTS: DEFAULTS, PRESET_FEEDS, maskMail };
