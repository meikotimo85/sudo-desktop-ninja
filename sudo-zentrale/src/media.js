// media.js – 1.8: YouTube-Kanäle (neue Videos) und Musikwünsche über Spotify (z. B. auf der Alexa im Büro).
// Gleiche Antworten wie app/media.php der PHP-Version.
'use strict';
const { now, dayKey } = require('./db');

class MediaError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new MediaError(code, msg); };
const SECRET_KEYS = ['spotify_client_secret', 'spotify_refresh', 'spotify_access', 'spotify_state'];
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

function createMedia(store, { cfg, matches, validTarget, publish, log }) {
  const ytBase = (cfg.youtubeBase || 'https://www.youtube.com').replace(/\/+$/, '');
  const spApi = (cfg.spotifyApi || 'https://api.spotify.com').replace(/\/+$/, '');
  const spAcc = (cfg.spotifyAccounts || 'https://accounts.spotify.com').replace(/\/+$/, '');
  const redirectUri = () => cfg.publicUrl + '/admin/spotify/callback';
  const get = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Sudo-Zentrale', ...(opt.headers || {}) } });
    return { status: r.status, text: await r.text() };
  };

  /* ---------- YouTube ---------- */
  async function feed(channelId) {
    let r;
    try { r = await get(`${ytBase}/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, { headers: { 'accept-language': 'de-DE,de;q=0.9' } }); }
    catch (e) { throw new Error('YouTube nicht erreichbar (' + e.message + ').'); }
    if (r.status !== 200) throw new Error(r.status === 404 ? 'Kanal nicht gefunden.' : `YouTube nicht erreichbar (${r.status}).`);
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
  async function resolve(input) {
    const s = String(input || '').trim();
    const uc = s.match(/(UC[\w-]{22})/); if (uc) return [uc[1], ''];
    const m = s.match(/(?:youtube\.com\/)?@([\w.-]{3,40})/u) || s.match(/^([\w.-]{3,40})$/u);
    if (m) {
      const handle = m[1];
      let r = { status: 0, text: '' };
      try { r = await get(`${ytBase}/@${encodeURIComponent(handle)}`, { headers: { 'accept-language': 'de-DE,de;q=0.9', cookie: 'SOCS=CAI; CONSENT=YES+cb' } }); } catch { /* unten */ }
      const c = r.status === 200 && (r.text.match(/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]{22})"/) || r.text.match(/"externalId":"(UC[\w-]{22})"/) || r.text.match(/"channelId":"(UC[\w-]{22})"/));
      if (c) return [c[1], '@' + handle];
      throw new Error(`Kanal „@${handle}“ nicht gefunden. Tipp: Auf der Kanalseite „Teilen → Kanal-ID kopieren“ und die ID (beginnt mit UC…) eintragen.`);
    }
    throw new Error('Bitte einen Kanal-Link, ein @Handle oder eine Kanal-ID (UC…) eintragen.');
  }
  async function ytAdd(b, who) {
    let cid, handle, f;
    try { [cid, handle] = await resolve(b.input); } catch (e) { fail(400, e.message); }
    if (store.get('SELECT 1 FROM yt_channels WHERE channel_id = ?', cid)) fail(409, 'Dieser Kanal ist schon eingetragen.');
    try { f = await feed(cid); } catch (e) { fail(400, e.message); }
    const target = b.target ? validTarget(b.target) : 'all';
    const newest = f.videos[0] || null;
    const r = store.run(`INSERT INTO yt_channels (channel_id, title, handle, target, shorts, active, last_check, last_error, last_video, last_published, sent, created)
      VALUES (?, ?, ?, ?, ?, 1, ?, '', ?, ?, 0, ?)`, cid, f.title || cid, handle, target, b.shorts ? 1 : 0, now(), newest ? newest.id : '', newest ? newest.published : 0, now());
    store.audit(who, 'youtube_add', `${f.title || cid} → ${target}`);
    return { id: Number(r.lastInsertRowid), title: f.title, latest: newest };
  }
  let ytRunning = false;
  async function ytCheck(force = false) {
    const s = store.settings();
    if ((s.youtube_enabled || 'true') !== 'true' && !force) return { checked: 0, new: 0 };
    if (ytRunning) return { checked: 0, new: 0 };
    ytRunning = true;
    const every = Math.max(5, Math.min(240, Number(s.youtube_interval) || 15)) * 60000;
    let checked = 0, fresh = 0;
    try {
      for (const c of store.all('SELECT * FROM yt_channels WHERE active = 1 ORDER BY last_check')) {
        if (!force && now() - c.last_check < every) continue;
        checked++;
        try {
          const f = await feed(c.channel_id);
          const list = f.videos.filter(v => v.published > c.last_published && v.id !== c.last_video && (c.shorts || !v.short)).slice(0, 3).reverse();
          const title = f.title || c.title;
          for (const v of list) {
            publish({ type: 'video', titel: v.title, kanal: title, video: v.id, link: 'https://www.youtube.com/watch?v=' + v.id }, { target: c.target, ttlMin: Number(s.youtube_ttl) || 480, author: 'youtube:' + title });
            store.run('INSERT OR IGNORE INTO yt_videos (video_id, channel_id, title, published, sent) VALUES (?, ?, ?, ?, ?)', v.id, c.channel_id, v.title, v.published, now());
            fresh++;
          }
          const top = f.videos[0];
          store.run('UPDATE yt_channels SET last_check = ?, last_error = ?, title = ?, last_video = ?, last_published = ?, sent = sent + ? WHERE id = ?',
            now(), '', title, top && top.published >= c.last_published ? top.id : c.last_video, Math.max(c.last_published, top ? top.published : 0), list.length, c.id);
        } catch (e) { store.run('UPDATE yt_channels SET last_check = ?, last_error = ? WHERE id = ?', now(), String(e.message).slice(0, 200), c.id); }
      }
    } finally { ytRunning = false; }
    return { checked, new: fresh };
  }
  // Node läuft dauerhaft: jede Minute nachsehen, welche Kanäle fällig sind
  const ytTimer = setInterval(() => ytCheck().catch(e => log.warn('YouTube: ' + e.message)), 60000);
  const ytPublic = c => ({ id: c.id, channelId: c.channel_id, title: c.title, handle: c.handle || '', target: c.target, shorts: !!c.shorts, active: !!c.active,
    lastCheck: c.last_check || null, lastError: c.last_error || '', sent: c.sent, lastPublished: c.last_published || null });

  /* ---------- Spotify ---------- */
  function musicSettings(s = store.settings()) {
    const int = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) && v !== '' && v != null ? Math.trunc(Number(v)) : d));
    return { enabled: s.music_enabled === 'true', target: s.music_target || 'all', cost: int(s.music_cost, 100, 0, 5000), perDay: int(s.music_per_day, 3, 1, 20),
      gapMin: int(s.music_gap_min, 5, 0, 120), from: s.music_from || '08:00', to: s.music_to || '18:00', explicit: s.music_explicit === 'true',
      announce: ['name', 'anon', 'off'].includes(s.music_announce) ? s.music_announce : 'name', deviceId: s.spotify_device_id || '', deviceName: s.spotify_device_name || '',
      account: s.spotify_account || '', clientId: s.spotify_client_id || '', secretSet: !!s.spotify_client_secret, connected: !!s.spotify_refresh };
  }
  const basic = s => 'Basic ' + Buffer.from(`${s.spotify_client_id || ''}:${s.spotify_client_secret || ''}`).toString('base64');
  async function token() {
    const s = store.settings();
    if (!s.spotify_refresh) throw new Error('Spotify ist nicht verbunden.');
    if (s.spotify_access && Number(s.spotify_access_exp) > now() + 60000) return s.spotify_access;
    const r = await get(spAcc + '/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(s) },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.spotify_refresh }).toString() });
    let j = {}; try { j = JSON.parse(r.text); } catch { /* leer */ }
    if (r.status !== 200 || !j.access_token) throw new Error('Spotify-Anmeldung abgelaufen – bitte in der Zentrale neu verbinden.');
    store.setSetting('spotify_access', j.access_token);
    store.setSetting('spotify_access_exp', String(now() + (Number(j.expires_in) || 3600) * 1000));
    if (j.refresh_token) store.setSetting('spotify_refresh', j.refresh_token);
    return j.access_token;
  }
  async function call(method, p, query) {
    const r = await get(spApi + p + (query ? '?' + new URLSearchParams(query).toString() : ''), { method, headers: { authorization: 'Bearer ' + await token() } });
    let j = null; try { j = r.text ? JSON.parse(r.text) : null; } catch { /* leer */ }
    return [r.status, j];
  }
  function trackPublic(t) {
    const img = [...((t.album && t.album.images) || [])].reverse().find(i => (i.width || 0) >= 64);
    return { id: String(t.id), name: String(t.name || '').slice(0, 120), artist: (t.artists || []).map(a => a.name).join(', ').slice(0, 120), album: String((t.album && t.album.name) || '').slice(0, 120),
      image: img && /^https:\/\/i\.scdn\.co\//.test(img.url) ? img.url : '', ms: Number(t.duration_ms) || 0, explicit: !!t.explicit };
  }
  const hhmm = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cfg.timezone || 'Europe/Berlin' });
  const inHours = m => { const n = hhmm(); return m.from <= m.to ? n >= m.from && n < m.to : n >= m.from || n < m.to; };
  function status(dev) {
    const m = musicSettings();
    const ok = m.enabled && m.connected && !!m.deviceId && matches(m.target, dev);
    const used = store.get("SELECT COUNT(*) n FROM music_requests WHERE day = ? AND device_id = ? AND status = 'queued'", dayKey(), dev.id).n;
    const last = store.get("SELECT MAX(at) t FROM music_requests WHERE status = 'queued'").t || 0;
    return { enabled: ok, cost: m.cost, perDay: m.perDay, left: Math.max(0, m.perDay - used), waitSec: Math.max(0, Math.ceil((last + m.gapMin * 60000 - now()) / 1000)),
      hours: `${m.from}–${m.to}`, open: inHours(m), device: m.deviceName, explicit: m.explicit };
  }
  const mediaPublic = (dev, s = store.settings()) => { const m = musicSettings(s); return { youtube: (s.youtube_enabled || 'true') === 'true', music: { enabled: m.enabled && m.connected && !!m.deviceId && matches(m.target, dev), cost: m.cost } }; };
  async function search(dev, q) {
    const st = status(dev);
    if (!st.enabled) fail(403, 'Musikwünsche sind gerade nicht freigeschaltet.');
    q = String(q || '').trim().slice(0, 100);
    if (q.length < 2) fail(400, 'Bitte mindestens zwei Zeichen eingeben.');
    let code, j;
    try { [code, j] = await call('GET', '/v1/search', { q, type: 'track', limit: '10', market: 'DE' }); } catch (e) { fail(502, e.message); }
    if (code !== 200) fail(502, `Spotify-Suche gerade nicht möglich (${code}).`);
    let tracks = ((j.tracks && j.tracks.items) || []).map(trackPublic);
    if (!st.explicit) tracks = tracks.filter(t => !t.explicit);
    const blocked = new Set(store.all('SELECT track_id FROM music_blocked').map(b => b.track_id));
    tracks = tracks.filter(t => !blocked.has(t.id));
    store.run('INSERT INTO music_cache (device_id, at, data) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET at = excluded.at, data = excluded.data', dev.id, now(), JSON.stringify(tracks));
    return tracks;
  }
  async function request(dev, b, nameOf) {
    const m = musicSettings(), st = status(dev);
    if (!st.enabled) fail(403, 'Musikwünsche sind gerade nicht freigeschaltet.');
    if (!st.open) fail(403, `Musikwünsche gehen nur von ${st.hours} Uhr.`);
    if (st.left <= 0) fail(429, 'Für heute sind deine Wünsche aufgebraucht.');
    if (st.waitSec > 0) fail(429, `Kurz warten – der nächste Wunsch geht in ${Math.max(1, Math.ceil(st.waitSec / 60))} min.`);
    if (b.xp != null && Number.isFinite(Number(b.xp)) && Number(b.xp) < m.cost) fail(402, 'Dafür fehlen dir noch XP.');
    const cache = store.get('SELECT * FROM music_cache WHERE device_id = ?', dev.id);
    const tracks = cache && cache.at > now() - 3600000 ? JSON.parse(cache.data) : [];
    const t = tracks.find(x => x.id === String(b.id || ''));
    if (!t) fail(400, 'Bitte den Titel neu suchen und dann wünschen.');
    if (t.explicit && !m.explicit) fail(403, 'Dieser Titel ist gesperrt (explicit).');
    if (store.get('SELECT 1 FROM music_blocked WHERE track_id = ?', t.id)) fail(403, 'Dieser Titel ist im Büro gesperrt.');
    let code, j;
    try { [code, j] = await call('POST', '/v1/me/player/queue', { uri: 'spotify:track:' + t.id, device_id: m.deviceId }); } catch (e) { fail(502, e.message); }
    const ok = code >= 200 && code < 300, reason = (j && j.error && j.error.reason) || '';
    const msg = ok ? '' : code === 404 || reason === 'NO_ACTIVE_DEVICE' ? `Auf „${m.deviceName || 'dem Lautsprecher'}“ läuft gerade kein Spotify. Erst Musik starten, dann wünschen.`
      : code === 403 ? 'Spotify lehnt ab (Premium nötig oder Gerät gesperrt).' : `Spotify-Fehler ${code}.`;
    store.run('INSERT INTO music_requests (at, day, device_id, track_id, title, artist, status, msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', now(), dayKey(), dev.id, t.id, t.name, t.artist, ok ? 'queued' : 'failed', msg);
    if (!ok) fail(502, msg);
    if (m.announce !== 'off') publish({ type: 'music', titel: t.name, artist: t.artist, von: m.announce === 'anon' ? 'Jemand' : nameOf(dev) }, { target: m.target, ttlMin: 20, author: 'musik' });
    return { ok: true, cost: m.cost, track: t };
  }
  // 1.8.1: Live-Warteschlange, Überspringen, Sperren mit automatischem Überspringen
  async function queueLive() {
    let c, j;
    try { [c, j] = await call('GET', '/v1/me/player/queue'); } catch { return null; }
    if (c !== 200 || !j) return null;
    const t = x => (x && x.id ? { id: String(x.id), name: String(x.name || ''), artist: (x.artists || []).map(a => a.name).join(', ') } : null);
    return { current: t(j.currently_playing), queue: (j.queue || []).slice(0, 20).map(t).filter(Boolean) };
  }
  function liveState(r, live, used) {
    if (r.status !== 'queued') return ['failed', null];
    if (r.veto) return [r.skipped ? 'skipped' : 'vetoed', null];
    if (!live) return ['requested', null];
    if (live.current && live.current.id === r.track_id && !used.cur) { used.cur = 1; return ['playing', null]; }
    for (let i = 0; i < live.queue.length; i++) if (live.queue[i].id === r.track_id && !used['q' + i]) { used['q' + i] = 1; return ['queued', i + 1]; }
    return ['played', null];
  }
  async function skip() {
    const m = musicSettings();
    const [c] = await call('POST', '/v1/me/player/next', m.deviceId ? { device_id: m.deviceId } : undefined);
    if (c < 200 || c >= 300) fail(502, c === 404 ? 'Gerade läuft nichts über Spotify.' : `Spotify hat das Überspringen abgelehnt (${c}).`);
  }
  let watching = false;
  async function watch() {
    if (watching) return 0;
    const pending = store.all('SELECT * FROM music_requests WHERE veto = 1 AND skipped = 0 AND at > ?', now() - 4 * 3600000);
    if (!pending.length) return 0;
    watching = true;
    try {
      let c, j;
      try { [c, j] = await call('GET', '/v1/me/player/currently-playing'); } catch { return 0; }
      const cur = j && j.item && j.item.id ? String(j.item.id) : '';
      if (c !== 200 || !cur) return 0;
      const hit = pending.find(p => p.track_id === cur);
      if (!hit) return 0;
      try { await skip(); } catch { return 0; }
      store.run('UPDATE music_requests SET skipped = 1 WHERE veto = 1 AND skipped = 0 AND track_id = ?', cur);
      store.audit('musik', 'music_autoskip', `${hit.title} – ${hit.artist}`);
      return 1;
    } finally { watching = false; }
  }
  const watchTimer = setInterval(() => watch().catch(() => {}), 10000);
  async function veto(id, who) {
    const r = store.get('SELECT * FROM music_requests WHERE id = ?', Number(id));
    if (!r) fail(404, 'Wunsch nicht gefunden.');
    store.run("UPDATE music_requests SET veto = 1 WHERE track_id = ? AND status = 'queued' AND at > ?", r.track_id, now() - 4 * 3600000);
    store.run('INSERT OR IGNORE INTO music_blocked (track_id, title, artist, at, by_) VALUES (?, ?, ?, ?, ?)', r.track_id, r.title, r.artist, now(), who);
    store.audit(who, 'music_veto', `${r.title} – ${r.artist}`);
    return { ok: true, skippedNow: (await watch()) > 0 };
  }
  function unblock(trackId, who) { store.run('DELETE FROM music_blocked WHERE track_id = ?', String(trackId)); store.audit(who, 'music_unblock', String(trackId)); }

  async function admin() {
    const m = musicSettings();
    const out = { settings: m, redirectUri: redirectUri(), devices: [], playing: null, error: '', queue: null,
      blocked: store.all('SELECT * FROM music_blocked ORDER BY at DESC').map(b => ({ trackId: b.track_id, title: b.title, artist: b.artist, at: b.at, by: b.by_ })),
      today: store.get("SELECT COUNT(*) n FROM music_requests WHERE day = ? AND status = 'queued'", dayKey()).n,
      recent: [] };
    const rows = store.all('SELECT r.*, COALESCE(d.visit_name, d.user, d.name) vname FROM music_requests r LEFT JOIN devices d ON d.id = r.device_id ORDER BY r.id DESC LIMIT 20');
    if (m.connected) {
      try {
        let [c, j] = await call('GET', '/v1/me/player/devices');
        if (c === 200) out.devices = ((j && j.devices) || []).map(d => ({ id: String(d.id), name: String(d.name), type: String(d.type || ''), active: !!d.is_active }));
        [c, j] = await call('GET', '/v1/me/player');
        if (c === 200 && j && j.item) out.playing = { name: j.item.name || '', artist: (j.item.artists || []).map(a => a.name).join(', '), device: (j.device && j.device.name) || '', isPlaying: !!j.is_playing };
      } catch (e) { out.error = e.message; }
      out.queue = await queueLive();
    }
    // Älteste Wünsche zuerst zuordnen: Wer zuerst gewünscht hat, steht in der Warteschlange weiter vorn
    const used = {};
    const mapped = rows.slice().reverse().map(r => { const [st, pos] = liveState(r, out.queue, used); return { id: r.id, at: r.at, title: r.title, artist: r.artist, status: st, pos, msg: r.msg, from: r.vname || '?', trackId: r.track_id }; });
    out.recent = mapped.reverse();
    return out;
  }
  // Verbinden: Weiterleitung zu Spotify und Rückweg mit Code
  function loginUrl() {
    const s = store.settings();
    if (!s.spotify_client_id || !s.spotify_client_secret) fail(400, 'Bitte zuerst Client-ID und Client-Secret speichern.');
    const state = require('crypto').randomBytes(16).toString('base64url');
    store.setSetting('spotify_state', `${state}|${now() + 600000}`);
    return spAcc + '/authorize?' + new URLSearchParams({ client_id: s.spotify_client_id, response_type: 'code', redirect_uri: redirectUri(),
      scope: 'user-read-playback-state user-modify-playback-state', state, show_dialog: 'true' }).toString();
  }
  async function callback(q, who) {
    const s = store.settings();
    const [want, exp] = String(s.spotify_state || '').split('|');
    if (!want || want !== String(q.state || '') || Number(exp) < now()) return 'Anmeldung abgelaufen – bitte noch einmal verbinden.';
    if (q.error) return 'Spotify: ' + q.error;
    const r = await get(spAcc + '/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(s) },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(q.code || ''), redirect_uri: redirectUri() }).toString() });
    let j = {}; try { j = JSON.parse(r.text); } catch { /* leer */ }
    if (r.status !== 200 || !j.refresh_token) return `Spotify hat die Anmeldung abgelehnt (${r.status}).`;
    store.setSetting('spotify_refresh', j.refresh_token);
    store.setSetting('spotify_access', j.access_token || '');
    store.setSetting('spotify_access_exp', String(now() + (Number(j.expires_in) || 3600) * 1000));
    store.setSetting('spotify_state', '');
    let name = 'Spotify';
    try { const [, me] = await call('GET', '/v1/me'); name = String((me && (me.display_name || me.id)) || 'Spotify').slice(0, 80); } catch { /* egal */ }
    store.setSetting('spotify_account', name);
    store.audit(who, 'spotify_connect', name);
    return 'verbunden';
  }
  function disconnect() { for (const k of ['spotify_refresh', 'spotify_access', 'spotify_access_exp', 'spotify_account', 'spotify_device_id', 'spotify_device_name']) store.setSetting(k, ''); }

  return { ytAdd, ytCheck, ytPublic, mediaPublic, status, search, request, admin, loginUrl, callback, disconnect, skip, veto, unblock, watch,
    stop: () => { clearInterval(ytTimer); clearInterval(watchTimer); } };
}

module.exports = { createMedia, MediaError, SECRET_KEYS };
