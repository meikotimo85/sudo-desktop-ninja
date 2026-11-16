// Nachbau von YouTube-Feeds und Spotify-API für Tests (Port 4800)
const http = require('http'); const url = require('url');
const chans = { UCaaaaaaaaaaaaaaaaaaaaaa: { title: 'c\'t 3003', videos: [] }, UCbbbbbbbbbbbbbbbbbbbbbb: { title: 'heise online', videos: [] } };
const now = Date.now();
chans.UCaaaaaaaaaaaaaaaaaaaaaa.videos.push({ id: 'old111aaaaa', title: 'Altes Video', t: now - 864e5 });
chans.UCbbbbbbbbbbbbbbbbbbbbbb.videos.push({ id: 'old222bbbbb', title: 'Älteres heise-Video', t: now - 2 * 864e5 });
const queue = []; let tokenCalls = 0; let current = { id: 'bo1', name: 'Bohemian Rhapsody', artists: [{ name: 'Queen' }] }; let nextCalls = 0;
const byUri = uri => { const id = String(uri).split(':').pop(); const t = TRACKS.find(x => x.id === id); return t ? { id: t.id, name: t.name, artists: t.artists } : { id, name: id, artists: [] }; };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const TR = (id, name, artist, explicit = false) => ({ id, name, artists: [{ name: artist }], album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/640', width: 640 }, { url: 'https://i.scdn.co/image/64', width: 64 }] }, duration_ms: 200000, explicit });
const TRACKS = [TR('t1', 'Never Gonna Give You Up', 'Rick Astley'), TR('t2', 'Africa', 'Toto'), TR('t3', 'Böser Song', 'Explicit Band', true)];
http.createServer((req, res) => {
  const u = url.parse(req.url, true); let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const J = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    if (u.pathname === '/feeds/videos.xml') {
      const c = chans[u.query.channel_id]; if (!c) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/atom+xml' });
      return res.end(`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>${esc(c.title)}</title>` +
        c.videos.slice().sort((a, b) => b.t - a.t).map(v => `<entry><id>yt:video:${v.id}</id><yt:videoId>${v.id}</yt:videoId><title>${esc(v.title)}</title><link rel="alternate" href="https://www.youtube.com/${v.short ? 'shorts/' : 'watch?v='}${v.id}"/><published>${new Date(v.t).toISOString()}</published></entry>`).join('') + '</feed>');
    }
    if (u.pathname === '/_add') { chans[u.query.ch].videos.push({ id: u.query.id, title: u.query.title, t: Date.now(), short: !!u.query.short }); return J(200, { ok: true }); }
    if (u.pathname === '/@ct3003') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><link rel="canonical" href="https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa"></html>'); }
    if (u.pathname.startsWith('/@')) { res.writeHead(404); return res.end('nope'); }
    // Spotify Accounts
    if (u.pathname === '/authorize') { res.writeHead(302, { location: `${u.query.redirect_uri}?code=testcode&state=${u.query.state}` }); return res.end(); }
    if (u.pathname === '/api/token') { tokenCalls++; const p = new URLSearchParams(body); if (!/^Basic /.test(req.headers.authorization || '')) return J(400, { error: 'invalid_client' });
      return J(200, { access_token: 'acc' + tokenCalls, token_type: 'Bearer', expires_in: 3600, ...(p.get('grant_type') === 'authorization_code' ? { refresh_token: 'ref1' } : {}) }); }
    if (!/^Bearer acc/.test(req.headers.authorization || '') && u.pathname.startsWith('/v1/')) return J(401, { error: { status: 401 } });
    if (u.pathname === '/v1/me') return J(200, { id: 'firma', display_name: 'Firma Büro' });
    if (u.pathname === '/v1/me/player/devices') return J(200, { devices: [{ id: 'echo1', name: 'Echo Büro', type: 'Speaker', is_active: true }, { id: 'pc1', name: 'PC-TEST-01', type: 'Computer', is_active: false }] });
    if (u.pathname === '/v1/me/player' && req.method === 'GET') return J(200, { is_playing: true, device: { name: 'Echo Büro' }, item: current });
    if (u.pathname === '/v1/me/player/currently-playing') return J(200, { is_playing: true, item: current });
    if (u.pathname === '/v1/me/player/queue' && req.method === 'GET') return J(200, { currently_playing: current, queue: queue.map(byUri) });
    if (u.pathname === '/v1/me/player/next' && req.method === 'POST') { nextCalls++; current = queue.length ? byUri(queue.shift()) : { id: 'fill' + nextCalls, name: 'Füller', artists: [{ name: 'Radio' }] }; return J(204); }
    if (u.pathname === '/_next') { current = queue.length ? byUri(queue.shift()) : { id: 'x', name: 'x', artists: [] }; return J(200, { current }); }
    if (u.pathname === '/_state') return J(200, { current, queue, nextCalls });
    if (u.pathname === '/v1/search') return J(200, { tracks: { items: TRACKS.filter(t => (t.name + ' ' + t.artists[0].name).toLowerCase().includes(String(u.query.q).toLowerCase()) || u.query.q === 'alle') } });
    if (u.pathname === '/v1/me/player/queue' && req.method === 'POST') { if (u.query.device_id !== 'echo1') return J(404, { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } }); queue.push(u.query.uri); return J(204); }
    if (u.pathname === '/_queue') return J(200, queue);
    J(404, { error: 'unknown ' + u.pathname });
  });
}).listen(4800, () => console.log('mock 4800'));
