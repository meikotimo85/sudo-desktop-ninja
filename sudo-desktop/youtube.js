// youtube.js – 1.8.1: Eigene YouTube-Kanäle pro Sudo.
// Der PC fragt die öffentlichen RSS-Feeds der Kanäle direkt bei YouTube ab (ohne Anmeldung, ohne Google-Konto).
// Funktioniert auch ohne Sudo-Zentrale. Gleiche Feed-Logik wie media.php / media.js der Zentrale.
'use strict';

const MAX_CHANNELS = 10;
const MAX_SEEN = 300;
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

function createYouTube({ fetch, getState, setState, announce, log, base = 'https://www.youtube.com', everyMin = 15, firstMin = 2 }) {
  base = String(base).replace(/\/+$/, '');
  const state = () => { const s = getState() || {}; return { channels: Array.isArray(s.channels) ? s.channels : [], seen: Array.isArray(s.seen) ? s.seen : [] }; };
  const uniq = a => [...new Set(a)].slice(0, MAX_SEEN);
  const save = patch => setState({ ...state(), ...patch, ...(patch.seen ? { seen: uniq(patch.seen) } : {}) });

  async function get(url, headers = {}) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { 'accept-language': 'de-DE,de;q=0.9', ...headers } });
      return { status: r.status, text: await r.text() };
    } finally { clearTimeout(t); }
  }
  async function feed(channelId) {
    let r;
    try { r = await get(`${base}/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`); }
    catch (e) { throw new Error('YouTube ist gerade nicht erreichbar.'); }
    if (r.status !== 200) throw new Error(r.status === 404 ? 'Kanal nicht gefunden.' : `YouTube ist gerade nicht erreichbar ({x}).`.replace('{x}', r.status));
    const title = unxml((r.text.split('<entry')[0].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]).trim().slice(0, 100);
    const videos = [];
    for (const e of r.text.split('<entry').slice(1)) {
      const id = (e.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/) || [])[1];
      if (!id) continue;
      const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] || '';
      videos.push({ id, title: unxml((e.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]).trim().slice(0, 200),
        published: Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1]) || 0, short: link.includes('/shorts/') });
    }
    videos.sort((a, b) => b.published - a.published);
    return { title, videos };
  }
  // Link, @Handle oder Kanal-ID (UC…) → Kanal-ID
  async function resolve(input) {
    const s = String(input || '').trim();
    const uc = s.match(/(UC[\w-]{22})/); if (uc) return [uc[1], ''];
    const m = s.match(/(?:youtube\.com\/)?@([\w.-]{3,40})/u) || s.match(/^([\w.-]{3,40})$/u);
    if (!m) throw new Error('Bitte einen Kanal-Link, ein @Handle oder eine Kanal-ID (UC…) eintragen.');
    const handle = m[1];
    let r = { status: 0, text: '' };
    try { r = await get(`${base}/@${encodeURIComponent(handle)}`, { cookie: 'SOCS=CAI; CONSENT=YES+cb' }); } catch { /* unten */ }
    const c = r.status === 200 && (r.text.match(/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]{22})"/) || r.text.match(/"externalId":"(UC[\w-]{22})"/) || r.text.match(/"channelId":"(UC[\w-]{22})"/));
    if (c) return [c[1], '@' + handle];
    throw new Error('Kanal „@{x}“ nicht gefunden. Tipp: Auf der Kanalseite „Teilen → Kanal-ID kopieren“ und die ID (beginnt mit UC…) eintragen.'.replace('{x}', handle));
  }

  async function add(input) {
    const st = state();
    if (st.channels.length >= MAX_CHANNELS) return { ok: false, msg: 'Höchstens {x} eigene Kanäle.'.replace('{x}', MAX_CHANNELS) };
    try {
      const [id, handle] = await resolve(input);
      if (st.channels.some(c => c.id === id)) return { ok: false, msg: 'Diesen Kanal hast du schon.' };
      const f = await feed(id);
      const now = state();                                                 // nach dem Abruf neu lesen (parallel laufende Prüfung)
      if (now.channels.some(c => c.id === id)) return { ok: false, msg: 'Diesen Kanal hast du schon.' };
      if (now.channels.length >= MAX_CHANNELS) return { ok: false, msg: 'Höchstens {x} eigene Kanäle.'.replace('{x}', MAX_CHANNELS) };
      const top = f.videos[0];
      const ch = { id, title: f.title || handle || id, handle, shorts: false, last: top ? top.id : '', lastPub: top ? top.published : 0, checked: Date.now(), error: '' };
      // Bisherige Videos gelten als gesehen – es kommen nur neue
      save({ channels: [...now.channels, ch], seen: [...f.videos.map(v => v.id), ...now.seen] });
      log(`YouTube: eigener Kanal ${ch.title} hinzugefügt`);
      return { ok: true, channel: ch, latest: top ? top.title : '' };
    } catch (e) { return { ok: false, msg: e.message }; }
  }
  function remove(id) { const st = state(); save({ channels: st.channels.filter(c => c.id !== id) }); return { ok: true }; }
  function setShorts(id, on) { const st = state(); save({ channels: st.channels.map(c => (c.id === id ? { ...c, shorts: !!on } : c)) }); return { ok: true }; }
  // Videos, die schon über die Zentrale kamen, nicht doppelt zeigen
  function markSeen(videoId) { if (!videoId) return; const st = state(); if (!st.seen.includes(videoId)) save({ seen: [videoId, ...st.seen].slice(0, MAX_SEEN) }); }

  let running = false;
  async function check(force = false) {
    if (running) return { checked: 0, fresh: 0 };
    running = true;
    let checked = 0, fresh = 0;
    try {
      for (const c of state().channels) {
        if (!force && Date.now() - (c.checked || 0) < everyMin * 60000 - 5000) continue;
        checked++;
        let f, err = '';
        try { f = await feed(c.id); } catch (e) { err = e.message; }
        const st = state();
        const cur = st.channels.find(x => x.id === c.id);
        if (!cur) continue;                                              // inzwischen entfernt
        if (!f) { save({ channels: st.channels.map(x => (x.id === c.id ? { ...x, checked: Date.now(), error: err } : x)) }); continue; }
        const list = f.videos.filter(v => v.published > (cur.lastPub || 0) && !st.seen.includes(v.id) && (cur.shorts || !v.short)).slice(0, 3).reverse();
        const top = f.videos[0];
        const upd = { ...cur, title: f.title || cur.title, checked: Date.now(), error: '',
          last: top && top.published >= (cur.lastPub || 0) ? top.id : cur.last, lastPub: Math.max(cur.lastPub || 0, top ? top.published : 0) };
        save({ channels: st.channels.map(x => (x.id === c.id ? upd : x)), seen: [...list.map(v => v.id), ...st.seen] });
        for (const v of list) {
          fresh++;
          announce({ type: 'video', titel: v.title, kanal: upd.title, video: v.id, link: 'https://www.youtube.com/watch?v=' + v.id, own: true });
        }
      }
    } finally { running = false; }
    if (checked) log(`YouTube: ${checked} eigene Kanäle geprüft, ${fresh} neue Videos`);
    return { checked, fresh };
  }
  const first = setTimeout(() => check().catch(() => {}), firstMin * 60000);
  const timer = setInterval(() => check().catch(() => {}), Math.max(0.05, Math.min(everyMin, 5)) * 60000);
  return { add, remove, setShorts, markSeen, seen: id => !!id && state().seen.includes(id), check, list: () => state().channels, max: MAX_CHANNELS,
    stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { createYouTube };
