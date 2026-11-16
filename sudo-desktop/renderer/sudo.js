// sudo.js – Verhalten, Physik und Effekte von Sudo im Overlay
(async () => {
'use strict';
const host = window.sudoHost;
// 1.9: Fehler melden statt still stehenbleiben (jede Meldung nur einmal)
const errSeen = new Set();
const reportErr = m => { const k = String(m).slice(0, 160); if (errSeen.has(k) || errSeen.size > 40) return; errSeen.add(k); try { host.reportError(k); } catch (e) { /* alte Brücke */ } };
window.addEventListener('error', e => reportErr(`${e.message} (Zeile ${e.lineno})`));
window.addEventListener('unhandledrejection', e => reportErr('async: ' + ((e.reason && e.reason.message) || e.reason)));
const T = s => (window.I18N ? I18N.t(s) : s);
const $ = s => document.querySelector(s);
const fx = $('#fx'), fctx = fx.getContext('2d');
const nin = $('#sudo'), nctx = nin.getContext('2d');
const bub = $('#bubble'), comboEl = $('#combo');
const off = document.createElement('canvas');
let sprite = null;
const goff = document.createElement('canvas');   // Gast-Ninja (Besuch von Kollegen)
let gsprite = null;
// Maße in "Einheiten": Sudo ist immer 24 Einheiten breit, S = Bildschirmpixel pro Einheit
let FH = 26, TOP = 24;
const SIZES = { klein: 2, normal: 4, gross: 6 };
const DEF_EYES = SudoSprite.DEF_EYES;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => a[Math.floor(Math.random() * a.length)];
let now = performance.now();

const init = await host.init();
let W = init.width, H = init.height, FLOOR = init.floor, S = 3, DPR = 1;
let settings = Object.assign({ sound: false, bugs: true }, init.settings);
let home = settings.home || null; // { type: 'floor', x } oder { type: 'window', exe, rel }
let platforms = [];

/* ---------- Grafik: Sprite-Sheet, sonst Ersatzgrafik ---------- */
try {
  if (init.sheet) {
    const sh = await SudoSheet.load(init.sheet.png, init.sheet.meta, init.sheet.accPng);
    off.width = sh.W; off.height = sh.H;
    sprite = sh.create(off.getContext('2d'));
    goff.width = sh.W; goff.height = sh.H; gsprite = sh.create(goff.getContext('2d'));   // zweiter Ninja für Besuche
    FH = sh.H * 24 / sh.W; TOP = (sh.feet + 1) * 24 / sh.W;
    if (init.sheet.custom) host.log('Eigener Skin geladen');
  }
} catch (e) {
  host.log('Sprite-Sheet fehlerhaft, nutze Ersatzgrafik: ' + e.message);
}
if (!sprite) { off.width = 24; off.height = 26; sprite = SudoSprite.create(off.getContext('2d')); FH = 26; TOP = 24; }
if (!gsprite) { goff.width = off.width; goff.height = off.height; gsprite = SudoSprite.create(goff.getContext('2d')); }

/* ---------- Ränge & Statistik ---------- */
const RANKS = [
  {n:'Praktikant', xp:0, c:'#eef1f5'}, {n:'Azubi', xp:60, c:'#f4d03f'}, {n:'Helpdesk', xp:180, c:'#f39c3c'},
  {n:'Admin', xp:400, c:'#3ccf7a'}, {n:'Senior', xp:800, c:'#3b8bea'}, {n:'root', xp:1500, c:'#e8473f'}];
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let stats = { keys: 0, bugs: 0, saves: 0, best: 0, xp: 0, keysToday: 0, day: localDay(), alarms: 0, pets: 0, minutes: 0, since: localDay(),
  breaks: 0, noted: 0, copies: 0, throws: 0, meetings: 0, gameBest: 0, flags: {}, unlocked: [], achievements: {} };
try { const s = JSON.parse(localStorage.getItem('sudo-stats-v1') || 'null'); if (s) stats = Object.assign(stats, s); } catch (e) {}
if (init.importedStats && typeof init.importedStats === 'object') {
  // aus einer Sicherung: nur die eigentlichen Zählerstände übernehmen
  const keep = ['keys', 'bugs', 'saves', 'best', 'xp', 'alarms', 'pets', 'minutes', 'since', 'breaks', 'noted', 'copies', 'throws', 'meetings', 'gameBest', 'flags', 'unlocked', 'achievements', 'visitsSent', 'duels', 'duelsWon', 'quizRight', 'quizAnswered', 'locks'];
  for (const k of keep) if (init.importedStats[k] !== undefined) stats[k] = init.importedStats[k];
  try { localStorage.setItem('sudo-stats-v1', JSON.stringify(stats)); } catch (e) {}
}
if (stats.day !== localDay()) { stats.day = localDay(); stats.keysToday = 0; }
const rankIdx = xp => { let i = 0; RANKS.forEach((r, k) => { if (xp >= r.xp) i = k; }); return i; };
let curRank = rankIdx(stats.xp);
const belt = () => RANKS[curRank].c;
function saveStats() {
  if (typeof checkProgress === 'function') checkProgress();
  try { localStorage.setItem('sudo-stats-v1', JSON.stringify(stats)); } catch (e) {}
  const r = RANKS[curRank], nx = RANKS[curRank + 1];
  host.stats({ ...stats, rank: r.n, rankColor: r.c, rankXp: r.xp, nextRank: nx ? nx.n : null, nextXp: nx ? nx.xp : null,
    ranks: RANKS.map(x => ({ n: x.n, c: x.c, xp: x.xp })) });
}
function addXp(v) {
  stats.xp += v;
  const r = rankIdx(stats.xp);
  if (r > curRank) {
    curRank = r;
    react('victory', 'Neuer Gürtel:\n' + RANKS[r].n + '!', 3);
    burst('confetti', N.x, N.y - 20 * S, 40);
    log('Rang aufgestiegen: ' + RANKS[r].n);
    chime([523, 659, 784, 1047]);
    saveStats();
  }
}
// 1.8: XP ausgeben (Musikwunsch) – der Rang kann sinken, Garderobe und Erfolge bleiben
function spendXp(cost, what) {
  cost = Math.max(0, Math.floor(Number(cost) || 0));
  if (!cost) return;
  stats.xp = Math.max(0, stats.xp - cost);
  stats.xpSpent = (stats.xpSpent || 0) + cost;
  const r = rankIdx(stats.xp);
  if (r < curRank) {
    curRank = r;
    react('facepalm', `Gürtel abgegeben:\n${RANKS[r].n}. Für Musik!`, 3.2, { prio: 1 });
    host.log('Rang gesunken: ' + RANKS[r].n);
  } else react('thumb', `−${cost} XP\n${what || 'Viel Spaß mit dem Song!'}`, 3, { prio: 1 });
  saveStats();
}
const log = m => host.log(m);

/* ---------- Ton ---------- */
let AC = null;
function audio() {
  if (!settings.sound) return null;
  if (!AC) { try { AC = new AudioContext(); } catch (e) { return null; } }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
let inMeeting = false; // im Meeting: keine Töne, keine Plauderei
function beep(f, d = .08, type = 'square', v = .035, delay = 0) {
  if (inMeeting) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), gn = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + d + .02);
}
const chime = fs => fs.forEach((f, i) => beep(f, .09, 'square', .03, i * .08));

/* ---------- Plattformen ---------- */
function surfaces() { return [{ id: 'floor', top: FLOOR, left: 0, right: W }, ...platforms]; }
function segsOf(id) { return surfaces().filter(s => s.id === id); }

/* ---------- Partikel, Bugs, Shuriken ---------- */
const parts = [], bugs = [], shurikens = [];
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const FLOPPY = ['BBBBBBB.', 'BWWWWWBB', 'BWWWWWBB', 'BBBBBBBB', 'BBGGGGBB', 'BBGBGGBB', 'BBGGGGBB', 'BBBBBBBB'];
const BUG = [[' L L L ', 'RRDRRHH', 'RRRRRHE', 'RDRRDHH', ' L L L '], ['L L L  ', 'RRDRRHH', 'RRRRRHE', 'RDRRDHH', '  L L L']];
const PAL = {O:'#e8892e', N:'#d9a520', Y:'#fff3c4', K:'#1a1420', X:'#ff5d8f', B:'#3b6fe0', W:'#e9eef5', G:'#1b2a4a', R:'#e5484d', D:'#2a1215', H:'#1b1d24', E:'#ffffff', L:'#1b1d24'};
function bitmap(rows, x, y, s, flip) {
  const w = rows[0].length;
  rows.forEach((r, j) => { for (let i = 0; i < w; i++) { const ch = r[i]; if (ch === '.' || ch === ' ') continue;
    fctx.fillStyle = PAL[ch]; const ii = flip ? w - 1 - i : i;
    fctx.fillRect(Math.round(x + ii * s), Math.round(y + j * s), s, s); } });
}
function add(p) { if (parts.length < 400) parts.push(Object.assign({ t: 0, vx: 0, vy: 0, g: 0, rot: 0, vr: 0 }, p)); }
function burst(type, x, y, n) {
  for (let i = 0; i < n; i++) {
    if (type === 'smoke' || type === 'redsmoke') add({type:'smoke', x:x + rand(-14,14), y:y + rand(-14,14), vx:rand(-60,60), vy:rand(-70,10), life:rand(.6,1.1), size:rand(6,12), c: type === 'redsmoke' ? pick(['#ff5a5f','#ff7b4a','#c4373b']) : pick(['#c9d0dc','#9aa3b3','#e6e9ef'])});
    else if (type === 'dust') add({type:'smoke', x:x + rand(-18,18), y:y - 3, vx:rand(-80,80), vy:rand(-40,-5), life:rand(.3,.55), size:rand(3,6), c:'#8d95a6'});
    else if (type === 'confetti') add({type:'conf', x, y, vx:rand(-260,260), vy:rand(-520,-180), g:900, life:rand(1.2,2), size:rand(4,7), rot:rand(0,6), vr:rand(-10,10), c:pick(['#25d3d0','#ff9f43','#3ccf7a','#f4d03f','#ff5d8f','#7f8cff'])});
    else if (type === 'squash') add({type:'conf', x, y, vx:rand(-160,160), vy:rand(-260,-60), g:800, life:rand(.4,.7), size:rand(3,5), rot:0, vr:rand(-8,8), c:pick(['#e5484d','#2a1215','#ffb4b6'])});
  }
}
const poofAt = (x, y, red) => burst(red ? 'redsmoke' : 'smoke', x, y, 22);
const floatText = (text, x, y, c) => add({type:'text', text: T(text).replace(/f(?=[il])/g, 'f\u200C'), x, y, vy:-40, life:1.3, c: c || '#ffffff'});

function spawnBug() {
  if (bugs.length >= 5) return;
  const left = Math.random() < .5;
  bugs.push({x: left ? -12 : W + 12, y: rand(H * .15, FLOOR - 24), a: left ? rand(-.4,.4) : Math.PI + rand(-.4,.4),
    sp: rand(26, 44) * S / 3, t: 0, enter: 1.2});
  log('Bug entdeckt');
}
function throwAt(bug) {
  shurikens.push({x: N.x + N.face * 9 * S, y: N.y - 9 * S, bug, rot: 0, sp: 820, life: 2});
  beep(1200, .04, 'triangle', .03);
}
function squash(b, byUser) {
  const i = bugs.indexOf(b); if (i < 0) return;
  bugs.splice(i, 1);
  burst('squash', b.x, b.y, 14);
  if (b.game) {
    if (byUser && game) game.score++;
    floatText(byUser ? '+1' : 'Sudo!', b.x, b.y - 10, byUser ? '#f4d03f' : '#9ef3b4');
    beep(260 + (game ? game.score * 12 : 0), .05, 'square', .035);
    return;
  }
  stats.bugs++; addXp(8); saveStats();
  floatText('+1 Bug gefixt', b.x, b.y - 10, '#9ef3b4');
  log(`Bug gefixt (#${stats.bugs})`);
  beep(220, .06, 'square', .04); beep(140, .08, 'square', .03, .05);
}

/* ---------- Ninja ---------- */
const N = {x: 100, y: 100, vx: 0, vy: 0, mode: 'ground', surf: 'floor', seg: null, face: 1,
  act: null, react: null, frame: 0, tf: 0, tt: 0, ft: 0, lift: 0, jump: null, carry: null, rot: 0, spin: 0, poofT: 0, blinkAt: 0};
const TYPE_HOLD = 4000; // so lange bleibt Sudo nach dem letzten Tastendruck am Laptop
let lastKey = -1e9, combo = 0, streakStart = -1e9, coffeeDue = false, lastCoffee = -1e9, lastNight = -1e9, sessionKeys = 0;
const keyLog = { bs: [], z: [], clip: [] };
let guestOn = false;                // 1.4: Besuch ist gerade da
let deckOpen = false;               // 1.4.2: Ninja-Leiste offen

function perch(s, x) {
  N.surf = s.id; N.seg = { left: s.left, right: s.right, top: s.top };
  N.x = clamp(x, s.left + 12, s.right - 12); N.y = s.top;
}
// prio: 0 = Plauderei, 1 = Reaktion auf dich, 2 = echtes Ereignis. Wichtigere Blasen werden nicht überschrieben.
// 1.5: Anzeigedauer – mindestens so lange, wie man zum Lesen braucht, dazu der eingestellte Faktor.
// „Bis zum Klick“: echte Meldungen (prio 2) bleiben stehen, bis man sie wegklickt.
const BUB_FACTOR = { normal: 1, long: 1.8, xlong: 2.8, click: 1.8 };
function bubbleDur(text, dur, prio) {
  const t = (settings.bubble && settings.bubble.time) || 'normal';
  if (t === 'click' && prio >= 2) return Infinity;
  const read = 1.4 + String(text || '').length / 15;          // ca. 15 Zeichen pro Sekunde
  return Math.max(dur, read) * (BUB_FACTOR[t] || 1);
}
function applyBubbleStyle() {
  const b = settings.bubble || {};
  document.body.classList.toggle('bub-clear', b.font === 'clear');
  document.body.classList.toggle('bub-large', b.size === 'large');
}
function say(text, dur = 2.2, kind, prio = 0, link) {
  if (inMeeting && prio < 2) return;
  if (guestOn && prio < 1) return;                  // Besuch da: keine Plauderei dazwischen
  if (deckOpen && prio < 2) return;                 // Ninja-Leiste offen: keine Blase darüber
  if (!bub.hidden && now < +bub.dataset.until && (+bub.dataset.prio || 0) > prio) return;
  const shown = T(text);
  dur = bubbleDur(shown, dur, prio);
  if (dur === Infinity && !link) link = 'sudo:close';    // stehenbleibende Blase muss man wegklicken können
  bub.textContent = shown; bub.className = (kind || '') + (link ? ' link' : ''); bub.hidden = false;
  // Klickbare Blase: kleiner Hinweis darunter, Klick öffnet den Link (Artikel, IT-Lage …)
  if (link) { const m = document.createElement('small'); m.className = 'more'; m.textContent = T(link === 'sudo:close' ? '▸ Klick zum Schließen' : '▸ Klick für Details'); bub.append(m); }
  bub.dataset.link = link || ''; bub.dataset.pinned = '';
  bub.dataset.until = now + dur * 1000; bub.dataset.prio = prio;
}
let bubRect = null;
bub.addEventListener('pointerenter', () => { if (bub.dataset.link) bub.dataset.until = Math.max(+bub.dataset.until, performance.now() + 4000); });
bub.addEventListener('click', () => {
  const l = bub.dataset.link;
  if (!l) return;
  if (bub.dataset.pinned) pinned = null;            // angepinnte Firmen-Meldung weggeklickt
  if (l !== 'sudo:close') host.openLink(l);
  bub.hidden = true; bub.dataset.link = '';
  log('Link geöffnet: ' + l);
});
// Plauderei: nur wenn Sudo gerade frei ist, und mit niedriger Priorität
const L = window.SudoLines || {};
let lastChatter = -1e9, lastWisdom = -1e9;
function chatter(text, pose, dur = 3) {
  if (inMeeting || guestOn) return false;
  if (N.mode !== 'ground' || (N.react && now < N.react.until) || (!bub.hidden && now < +bub.dataset.until)) return false;
  lastChatter = now;
  if (pose) react(pose, text, dur, { prio: 0 }); else say(text, dur, undefined, 0);
  return true;
}
function react(pose, text, dur = 1.8, o = {}) {
  if (N.mode === 'poof') return;
  if (N.react && N.react.prio > (o.prio ?? 1) && now < N.react.until) return;
  N.react = { pose, until: now + dur * 1000, eyes: o.eyes, prio: o.prio ?? 1 };
  if (text) say(text, Math.max(dur, 1.8), o.kind, o.prio ?? 1, o.link);
}
function poof(after) {
  poofAt(N.x, N.y - 12 * S);
  N.mode = 'poof'; N.poofT = .55; N.act = null; N.react = null; N.after = after || null;
  nin.style.visibility = 'hidden';
  beep(180, .12, 'sawtooth', .025);
}
function curPose() {
  if (N.mode === 'away') return 'stand';
  if (N.mode === 'carried') return 'carried';
  if (N.mode === 'air' || N.mode === 'jump') return 'jump';
  if (N.react) return N.react.pose;
  return N.act ? N.act.pose : 'stand';
}

/* ---------- Aktivitäten ---------- */
function startAct(name, o = {}) {
  N.lift = 0;
  const a = Object.assign({ name, t: 0 }, o);
  N.act = a;
  switch (name) {
    case 'idle': a.pose = 'stand'; a.dur = o.dur ?? rand(1.4, 3); break;
    case 'wander': {
      const s = N.seg; const w = s.right - s.left;
      // Ab und zu auf den Nachbar-Bildschirm wechseln (nur von der Taskleiste aus)
      if (N.surf === 'floor' && !home && (nb.left || nb.right) && Math.random() < .22) {
        const dir = nb.left && nb.right ? pick(['left', 'right']) : nb.left ? 'left' : 'right';
        a.target = dir === 'left' ? -40 : W + 40; a.travel = dir; a.pose = 'walk'; break;
      }
      if (w < 70) return startAct('idle');
      a.target = s.left + rand(24, w - 24);
      if (Math.abs(a.target - N.x) < 40) a.target = N.x < s.left + w / 2 ? s.right - 30 : s.left + 30;
      a.pose = 'walk'; break; }
    case 'jump': {
      const c = surfaces().filter(s => (s.id !== N.surf || Math.abs(s.left - N.seg.left) > 2) && s.top > 26 * S + 12 && s.right - s.left > 90);
      if (!c.length) return startAct('wander');
      const s = pick(c); a.pose = 'jump';
      jumpTo(s, s.left + rand(30, s.right - s.left - 30)); break; }
    case 'meditate': a.pose = 'meditate'; a.dur = o.dur ?? rand(5, 8); say(pick(['Ommm …\nPing: 1 ms.', 'Inner Peace.\n0 offene Tickets.', 'Ommm …\nuptime 99,99 %']), 2.4); break;
    case 'coffee': a.pose = 'coffee'; a.dur = rand(4, 6); break;
    case 'book': a.pose = 'book'; a.dur = rand(6, 8); if (Math.random() < .4) say('„Clean Code“.\nSpannend.', 2); break;
    case 'snake': a.pose = 'snake'; a.dur = rand(5, 7); if (Math.random() < .4) say('Highscore: 4711', 1.8); break;
    case 'sleep': a.pose = 'sleep'; a.dur = 1e9; break;
    case 'hunt': {
      const b = nearestBug(); if (!b) return startAct('idle');
      a.bug = b; a.pose = 'stand'; a.thrown = false;
      if (Math.random() < .35) say(pick(['Bug gesichtet!', 'Ich seh dich, Bug.', 'Zeit für einen Hotfix.']), 1.4);
      break; }
    case 'type': a.pose = 'type'; break;
    case 'site': {
      // Erst zur Maus laufen (wenn sie über dem gleichen Untergrund ist), dann loslegen
      const S0 = N.seg, L0 = (L.site || {})[o.site] || [];
      a.stage = 'go'; a.pose = 'walk';
      a.tx = o.cx != null && S0 ? clamp(o.cx, S0.left + 20, S0.right - 20) : N.x;
      if (Math.abs(a.tx - N.x) < 30) a.stage = 'do';
      a.lines = L0; a.dur = { video: rand(25, 40), music: rand(10, 14), shop: 6, ai: 7, news: rand(8, 11), social: rand(7, 9), maps: 4, wiki: rand(7, 9) }[o.site] || 6;
      break; }
    case 'play': {
      if (!ball || ball.held) return startAct('idle');
      const s = surfaceUnder(ball.x, ball.y);
      if (!s) return startAct('idle', { dur: 1 });
      if (s.id !== N.surf) { a.pose = 'jump'; jumpTo(s, clamp(ball.x - 30, s.left + 14, s.right - 14)); break; }
      a.pose = 'walk'; a.dur = 6;
      break; }
    case 'gohome': {
      const t = homeTarget();
      if (!t) return startAct('idle');
      if (t.s.id === N.surf && t.x >= N.seg.left && t.x <= N.seg.right) {
        N.act = { name: 'wander', t: 0, target: t.x, pose: 'walk' };
        return;
      }
      a.pose = 'jump';
      jumpTo(t.s, t.x);
      break; }
    case 'ping': a.pose = 'stand'; a.dur = 3.2; chatter(pick(L.ping || ['ping …']), null, 3); break;
    case 'stretch': a.pose = 'victory'; a.dur = 1.8; if (Math.random() < .5) chatter(pick(L.stretch || ['Streeetch …']), null, 1.8); break;
    case 'juggle': a.pose = 'stand'; a.dur = rand(5, 8); if (Math.random() < .5) chatter(pick(L.juggle || ['Multitasking.', 'Drei Tickets\ngleichzeitig.', 'Load Balancing.']), null, 2.2); break;
    case 'lookout': a.pose = 'sus'; a.eyes = 'side'; a.dur = 2.6; if (Math.random() < .5) chatter(pick(L.lookout || ['Alles ruhig.']), null, 2.4); break;
    case 'wisdom':
      a.pose = 'stand'; a.dur = 4;
      if (!L.wisdom || !L.wisdom.length || now - lastWisdom < 4 * 60000) { a.dur = 1.5; break; }
      lastWisdom = now; chatter(pick(L.wisdom), null, 4); break;
  }
}
function nearestBug() {
  let best = null, d = 1e9;
  for (const b of bugs) { if (b.enter > 0) continue; const dd = Math.hypot(b.x - N.x, b.y - N.y); if (dd < d) { d = dd; best = b; } }
  return best;
}
function nightDue() {
  const h = new Date().getHours();
  if ((h >= 23 || h < 5) && sessionKeys > 40 && now - lastNight > 30 * 60000 && now - lastKey < 25000) { lastNight = now; return true; }
  return false;
}
function nextAct() {
  const idleS = (now - lastKey) / 1000;
  if (nightDue()) { startAct('idle', { dur: 3 }); react('stand', 'Commit & ab ins Bett!', 3, { eyes: 'closed' }); return; }
  if (coffeeDue) { coffeeDue = false; startAct('coffee'); say('Kaffeepause.\nHast du dir verdient.', 3); return; }
  if (inMeeting) return startAct(pick(['idle', 'idle', 'book', 'meditate', 'snake']));
  if (game) return startAct('idle', { dur: 1 });
  if (sulkUntil > now) return startAct(pick(['idle', 'lookout']), { dur: 3 });
  if (nearestBug() && Math.random() < .85) return startAct('hunt');
  if (idleS > 90 && Math.random() < .5) return startAct('sleep');
  const atH = atHome();
  if (home && !atH && Math.random() < (idleS < 15 ? .25 : .45)) return startAct('gohome');
  // Während du arbeitest: ruhig bleiben, damit Sudo beim nächsten Tastendruck sofort mittippt
  if (idleS < 15) return startAct(Math.random() < .15 ? 'wisdom' : 'idle', { dur: rand(2, 4) });
  // Zu Hause bleibt er lieber sitzen, statt herumzuspringen
  const opts = [['wander', atH ? 1 : 4], ['idle', 3], ['jump', atH ? .5 : 2.5], ['meditate', 1], ['coffee', 1], ['book', 1], ['snake', 1],
    ['ping', .8], ['stretch', .8], ['lookout', .8], ['wisdom', 1.2], ['juggle', .9], ['play', ball && !ball.held ? 3.5 : 0]];
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const [n, w] of opts) { if ((r -= w) <= 0) return startAct(n); }
  startAct('idle');
}
/* ---------- Wohnort ---------- */
function homeTarget() {
  if (!home) return null;
  if (home.type === 'floor') { const fl = surfaces()[0]; return { s: fl, x: clamp(home.x * W, 40, W - 40) }; }
  const segs = platforms.filter(p => p.exe === home.exe && p.right - p.left >= 80);
  if (!segs.length) return null;
  const s = segs.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
  return { s, x: clamp(s.left + home.rel * (s.right - s.left), s.left + 20, s.right - 20) };
}
function atHome() {
  const t = homeTarget();
  return !!t && N.mode === 'ground' && N.surf === t.s.id && Math.abs(N.x - t.x) < 70;
}
function setHomeHere() {
  if (N.mode !== 'ground') { say('Erst landen,\ndann einziehen.', 2, undefined, 1); return; }
  let h;
  if (N.surf === 'floor') h = { type: 'floor', x: N.x / W };
  else {
    const p = platforms.find(q => q.id === N.surf && N.x >= q.left - 2 && N.x <= q.right + 2);
    if (!p || !p.exe) { say('Dieses Fenster\nkenne ich nicht.', 2.5, undefined, 1); return; }
    h = { type: 'window', exe: p.exe, rel: (N.x - p.left) / Math.max(1, p.right - p.left) };
  }
  home = h; host.setHome(h); stats.flags.home = 1;
  react('thumb', pick(['Hier wohne ich\njetzt!', 'Neues Zuhause.\nGemütlich!']), 2.2);
  for (let i = 0; i < 5; i++) add({type:'heart', x:N.x + rand(-16, 12), y:N.y - 26 * S + rand(-6, 6), vx:rand(-15, 15), vy:rand(-60, -35), life:1.2});
}

function jumpTo(s, tx) {
  const x0 = N.x, y0 = N.y, d = Math.hypot(tx - x0, s.top - y0);
  N.mode = 'jump';
  N.jump = { x0, y0, x1: tx, y1: s.top, id: s.id, segLeft: s.left, segW: s.right - s.left, rx: tx - s.left,
    t: 0, T: .5 + d / 1500, arc: 70 + Math.max(0, y0 - s.top) * .7 + d * .08 };
  N.face = tx >= x0 ? 1 : -1;
  beep(520, .05, 'square', .025); beep(780, .05, 'square', .02, .05);
}
function land(s, v) {
  perch(s, N.x); N.mode = 'ground'; N.rot = 0;
  burst('dust', N.x, N.y, 8);
  if (v > 1300) { react('crouch', pick(['Stealth-Landung.', 'Sauber gelandet.', 'Fallschaden: 0']), .9); beep(110, .1, 'square', .04); }
  startAct('idle', { dur: .8 });
}
function fall() { N.mode = 'air'; N.vx = 0; N.vy = 0; N.act = null; }

/* Segment wiederfinden, auf dem Sudo steht (Fenster kann verschoben oder teilweise verdeckt sein) */
function trackSeg() {
  const segs = segsOf(N.surf);
  if (!segs.length) return null;
  const p = N.seg, pw = p.right - p.left;
  // Gleiche Breite → Fenster wurde bewegt: mitwandern
  const moved = segs.find(s => Math.abs((s.right - s.left) - pw) <= 2);
  if (moved && segs.length === 1) { N.x += moved.left - p.left; return moved; }
  let best = null, bd = 1e9;
  for (const s of segs) { const d = N.x < s.left ? s.left - N.x : N.x > s.right ? N.x - s.right : 0; if (d < bd) { bd = d; best = s; } }
  return bd <= 30 ? best : null;
}

/* ---------- Update ---------- */
function update(dt) {
  N.tt += dt; if (N.tt > .15) { N.tt = 0; N.tf++; }
  if (N.react && now > N.react.until) N.react = null;
  if (N.spin > 0) N.spin = Math.max(0, N.spin - dt * 1.6);
  switch (N.mode) {
    case 'away':   // unterwegs zum Nachbar-Bildschirm; kommt nach 3 s zurück, falls der Wechsel nicht klappt
      N.awayT = (N.awayT || 0) + dt;
      if (N.awayT > 3) { N.awayT = 0; N.mode = 'ground'; perch(surfaces()[0], W / 2); N.act = null; poofAt(N.x, N.y - 12 * S); }
      break;
    case 'carried': break;
    case 'poof':
      N.poofT -= dt;
      if (N.poofT <= 0) {
        const fl = surfaces()[0], ht = N.after === 'home' ? homeTarget() : null;
        if (ht) perch(ht.s, ht.x);
        else perch(fl, N.after === 'center' ? W / 2 + rand(-120, 120) : rand(80, W - 80));
        N.mode = 'ground'; nin.style.visibility = 'visible'; poofAt(N.x, N.y - 12 * S);
        startAct('idle', { dur: 1.2 });
        say(ht ? pick(['Wieder zu Hause.', 'Home sweet home.']) : N.after === 'center' ? pick(['Zu Diensten!', 'sudo bin da']) : pick(['Rauchbombe!', 'Ninja-Teleport.', 'War eh Zeit für\nTapetenwechsel.']), 1.8);
      }
      break;
    case 'jump': {
      const j = N.jump;
      const segs = segsOf(j.id);
      const s = segs.find(x => Math.abs((x.right - x.left) - j.segW) <= 2) || segs.find(x => j.x1 >= x.left && j.x1 <= x.right);
      if (s) { j.x1 = s.left + Math.min(j.rx, s.right - s.left - 14); j.y1 = s.top; }
      j.t += dt / j.T; const t = Math.min(1, j.t);
      N.x = lerp(j.x0, j.x1, t); N.y = lerp(j.y0, j.y1, t) - j.arc * 4 * t * (1 - t);
      if (j.t >= 1) { if (s) land(s, 0); else fall(); }
      break; }
    case 'air': {
      const py = N.y;
      N.vy += 2600 * dt; N.x += N.vx * dt; N.y += N.vy * dt;
      const m = 12 * S;
      if (N.x < m) { N.x = m; N.vx = Math.abs(N.vx) * .45; }
      if (N.x > W - m) { N.x = W - m; N.vx = -Math.abs(N.vx) * .45; }
      if (N.y < 26 * S) { N.y = 26 * S; N.vy = Math.abs(N.vy) * .3; }
      if (Math.abs(N.vx) > 30) N.face = N.vx > 0 ? 1 : -1;
      N.rot = RM ? 0 : clamp(N.vx * .02, -25, 25);
      if (N.vy > 0) {
        for (const s of surfaces().sort((a, b) => a.top - b.top)) {
          if (py <= s.top + 2 && N.y >= s.top && N.x >= s.left + 6 && N.x <= s.right - 6) { land(s, N.vy); break; }
        }
        if (N.mode === 'air' && N.y > FLOOR) { const v = N.vy; N.y = FLOOR; land(surfaces()[0], v); }
      }
      break; }
    case 'ground': ground(dt); break;
  }
  updateWorld(dt);
}
function ground(dt) {
  const s = trackSeg();
  if (!s) {
    // Fenster geschlossen oder minimiert → Rauchbombe; nur verdeckt → herunterfallen
    if (!segsOf(N.surf).length) poof(); else fall();
    return;
  }
  N.seg = { left: s.left, right: s.right, top: s.top };
  N.y = s.top;
  if (!(N.act && N.act.travel)) N.x = clamp(N.x, s.left + 12, s.right - 12);
  const typing = now - lastKey < TYPE_HOLD;
  if (!N.react) {
    if (typing && (!N.act || N.act.name !== 'type')) {
      if (N.act && N.act.name === 'sleep') say(pick(['Bin wach!\nBin wach!', 'Ich hab nur\nkompiliert.']), 1.6);
      startAct('type');
    } else if (!typing && N.act && N.act.name === 'type') startAct('idle', { dur: .7 });
  }
  if (N.react) return;
  const a = N.act;
  if (!a) { nextAct(); return; }
  a.t += dt;
  switch (a.name) {
    case 'idle': case 'ping': case 'stretch': case 'lookout': case 'wisdom': if (a.t > a.dur) nextAct(); break;
    case 'play': {
      if (!ball || ball.held || a.t > a.dur) { nextAct(); break; }
      const dx = ball.x - N.x;
      if (Math.abs(dx) > 10 * S) {
        N.face = Math.sign(dx); N.x += N.face * 95 * (S / 3) * dt; a.pose = 'walk';
        N.ft += dt; if (N.ft > .1) { N.ft = 0; N.frame++; }
      } else if (Math.abs(ball.y - N.y) < 14 * S) {
        a.pose = 'throw';
        ball.vx = N.face * rand(350, 750); ball.vy = -rand(500, 950); ball.rest = false;
        beep(300, .05, 'triangle', .03);
        if (Math.random() < .3) chatter(pick(['Tor!', 'Fang!', 'Ninja-Kick!']), null, 1.4);
        a.dur = Math.min(a.dur, a.t + .5);
      }
      break; }
    case 'wander': {
      const dir = Math.sign(a.target - N.x) || 1;
      N.face = dir; N.x += dir * 62 * (S / 3) * dt;
      N.ft += dt; if (N.ft > .12) { N.ft = 0; N.frame++; }
      if (a.travel) {
        if ((a.travel === 'left' && N.x < -14 * S) || (a.travel === 'right' && N.x > W + 14 * S)) { N.mode = 'away'; N.act = null; host.travel(a.travel); }
        break;
      }
      if ((dir > 0 && N.x >= a.target) || (dir < 0 && N.x <= a.target)) startAct('idle');
      break; }
    case 'meditate': N.lift = (5 + Math.sin(a.t * 2.4) * 3) * S / 3; if (a.t > a.dur) nextAct(); break;
    case 'juggle': a.pose = Math.floor(a.t * 5) % 2 ? 'throw' : 'stand'; if (a.t > a.dur) nextAct(); break;
    case 'site': siteTick(a, dt); break;
    case 'coffee':
      if (Math.random() < dt * 5) add({type:'smoke', x:N.x + N.face * 6 * S, y:N.y - 14 * S, vx:rand(-6,6), vy:rand(-40,-25), life:1, size:3, c:'#dfe6ef'});
      if (a.t > a.dur) nextAct(); break;
    case 'book': case 'snake':
      N.ft += dt; if (N.ft > .3) { N.ft = 0; N.frame++; }
      if (a.t > a.dur) nextAct(); break;
    case 'sleep':
      if (Math.random() < dt * .9) add({type:'z', x:N.x + N.face * 4 * S, y:N.y - 20 * S, vx:rand(8,20) * N.face, vy:-22, life:2.2});
      break;
    case 'hunt': {
      const b = a.bug;
      if (!bugs.includes(b)) { startAct('idle', { dur: .6 }); break; }
      N.face = b.x >= N.x ? 1 : -1;
      if (a.t > .25) a.pose = 'throw';
      if (a.t > .32 && !a.thrown) { a.thrown = true; throwAt(b); }
      if (a.t > .8) nextAct();
      break; }
  }
}
function siteTick(a, dt) {
  if (a.stage === 'go') {
    const dir = Math.sign(a.tx - N.x) || 1;
    N.face = dir; N.x += dir * 70 * (S / 3) * dt;
    N.ft += dt; if (N.ft > .12) { N.ft = 0; N.frame++; }
    if ((dir > 0 && N.x >= a.tx) || (dir < 0 && N.x <= a.tx) || a.t > 6) { a.stage = 'do'; a.t0 = a.t; }
    return;
  }
  if (a.t0 == null) a.t0 = a.t;
  const t = a.t - a.t0;
  if (!a.said && a.lines.length) { a.said = true; chatter(pick(a.lines), null, 3.2); }
  switch (a.site) {
    case 'video':   // Fernsehabend: sitzen, Popcorn futtern, Bildschirm-Flackern
      a.pose = 'crouch'; N.face = a.cx != null ? (a.cx >= N.x ? 1 : -1) : N.face;
      if (Math.random() < dt * 1.6) add({ type: 'pop', x: N.x + N.face * 7 * S, y: N.y - 9 * S, vx: rand(-25, 25) - N.face * 20, vy: rand(-140, -90), g: 420, life: .9, c: pick(['#fff6d8', '#ffe7a3', '#ffffff']) });
      if (Math.random() < dt * .25) floatText(pick(['Haha!', 'Ohh!', 'Spannend …', 'Nur noch eine Folge!']), N.x, N.y - 30 * S, '#f4d03f');
      break;
    case 'music':   // Tanzen: kleine Hüpfer und Noten
      a.pose = Math.floor(t * 2.6) % 2 ? 'victory' : 'stand';
      N.lift = Math.abs(Math.sin(t * 8.2)) * 4 * S;
      if (Math.random() < dt * 2.4) add({ type: 'note', x: N.x + rand(-14, 14) * S / 3, y: N.y - 24 * S, vx: rand(-20, 20), vy: rand(-55, -35), life: 1.6, c: pick(['#25d3d0', '#f4d03f', '#ff5d8f']) });
      break;
    case 'shop':    // Paket fällt vom Himmel, Sudo fängt es
      a.pose = t < 1.4 ? 'sus' : 'thumb';
      if (!a.parcel) { a.parcel = true; add({ type: 'parcel', x: N.x + N.face * 4 * S, y: -20, vy: 120, g: 900, life: 3, catchY: N.y - 18 * S }); }
      break;
    case 'ai': a.pose = 'type'; if (Math.random() < dt * 3) N.frame++; break;
    case 'news': case 'wiki': a.pose = 'book'; N.ft += dt; if (N.ft > .4) { N.ft = 0; N.frame++; } break;
    case 'social': a.pose = 'snake'; N.ft += dt; if (N.ft > .3) { N.ft = 0; N.frame++; } break;
    case 'maps': a.pose = 'sus'; a.eyes = 'side'; break;
  }
  if (t > a.dur || (a.site !== 'shop' && a.site !== 'maps' && SITE_GROUP[siteTag] !== a.site)) { N.lift = 0; nextAct(); }
}
let bugTimer = rand(90, 150);
function updateWorld(dt) {
  ballPhysics(dt); eventFx(dt); gameTick(dt);
  if (settings.bugs) { bugTimer -= dt; if (bugTimer <= 0) { bugTimer = rand(120, 240); spawnBug(); } }
  for (const b of bugs) {
    b.t += dt; if (b.enter > 0) b.enter -= dt;
    b.a += rand(-1.6, 1.6) * dt;
    b.x += Math.cos(b.a) * b.sp * dt; b.y += Math.sin(b.a) * b.sp * dt;
    if (b.enter <= 0) {
      if (b.x < 10 && Math.cos(b.a) < 0) b.a = Math.PI - b.a;
      if (b.x > W - 10 && Math.cos(b.a) > 0) b.a = Math.PI - b.a;
      if (b.y < 20 && Math.sin(b.a) < 0) b.a = -b.a;
      if (b.y > FLOOR - 10 && Math.sin(b.a) > 0) b.a = -b.a;
    }
  }
  for (let i = shurikens.length - 1; i >= 0; i--) {
    const k = shurikens[i]; k.life -= dt; k.rot += dt * 22;
    const alive = bugs.includes(k.bug);
    if (alive) {
      const dx = k.bug.x - k.x, dy = k.bug.y - k.y, d = Math.hypot(dx, dy) || 1;
      k.dx = dx / d; k.dy = dy / d;
      if (d < 14) { squash(k.bug); shurikens.splice(i, 1); continue; }
    }
    k.x += (k.dx || 0) * k.sp * dt; k.y += (k.dy || 0) * k.sp * dt;
    if (k.life <= 0 || k.x < -40 || k.x > W + 40 || k.y < -40 || k.y > H + 40) shurikens.splice(i, 1);
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }
    if (p.type === 'gift') {
      p.y += p.vy * dt; p.vy += 600 * dt; p.x = lerp(p.x, N.x, dt * 3);
      if (p.y >= N.y - 14 * S) { parts.splice(i, 1); openGift(p.item); continue; }
      continue;
    }
    if (p.type === 'parcel') {
      p.y += p.vy * dt; p.vy += p.g * dt; p.x = lerp(p.x, N.x + N.face * 4 * S, dt * 4);
      if (p.y >= p.catchY) { p.y = p.catchY; p.vy = 0; p.g = 0; if (!p.caught) { p.caught = true; beep(440, .06, 'square', .03); } }
      continue;
    }
    if (p.type === 'scroll') {
      p.y += p.vy * dt; p.vy += 900 * dt; p.x = lerp(p.x, N.x, dt * 4); p.rot += dt * 3;
      if (p.y >= N.y - 16 * S) { parts.splice(i, 1); if (!p.silent) onTicketArrived(p.data); continue; }
    } else {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.sway) p.x += Math.sin(p.t * p.sway + (p.ph || 0)) * 26 * dt;     // 1.9: Laub und Blüten schaukeln beim Fallen
    }
  }
}

/* ---------- Zeichnen ---------- */
// 1.9: Die Effekt-Ebene ist bildschirmgroß. Ist nichts darauf zu sehen, wird sie nicht jedes Bild neu geleert
// (spart den Grafikprozess das Neuzeichnen des ganzen Bildschirms).
let fxWasEmpty = false;
function fxEmpty() {
  return !bugs.length && !ball && !shurikens.length && !parts.length && !(N.act && N.act.name === 'juggle') &&
    !(N.act && N.act.name === 'site' && N.act.site === 'video' && N.act.stage === 'do' && N.mode === 'ground');
}
// Nur den Bereich löschen, in dem im letzten oder in diesem Bild etwas war (statt des ganzen Bildschirms)
let fxBox = null;
function fxBounds() {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const addP = (x, y, m) => { if (x - m < l) l = x - m; if (y - m < t) t = y - m; if (x + m > r) r = x + m; if (y + m > b) b = y + m; };
  for (const g of bugs) addP(g.x, g.y, 12 * S);
  if (ball) addP(ball.x, ball.y, ballR() + 6);
  for (const k of shurikens) addP(k.x, k.y, 14);
  for (const p of parts) addP(p.x, p.y, p.type === 'text' ? 140 : p.type === 'smoke' ? 30 + (p.size || 0) * 3 : 40 + (p.size || 0) * 2);
  if (N.act && N.act.name === 'site' && N.act.site === 'video') addP(N.x, N.y, 30 * S);
  if (N.act && N.act.name === 'juggle') { addP(N.x, N.y - 20 * S, 22 * S); addP(N.x, N.y, 12 * S); }
  return l === Infinity ? null : { l: Math.max(0, Math.floor(l)), t: Math.max(0, Math.floor(t)), r: Math.min(W, Math.ceil(r)), b: Math.min(H, Math.ceil(b)) };
}
function drawFx() {
  const empty = fxEmpty();
  if (empty && fxWasEmpty) return;
  fxWasEmpty = empty;
  fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const nb = empty ? null : fxBounds(), ob = fxBox;
  if (ob || nb) {
    const u = ob && nb ? { l: Math.min(ob.l, nb.l), t: Math.min(ob.t, nb.t), r: Math.max(ob.r, nb.r), b: Math.max(ob.b, nb.b) } : (ob || nb);
    fctx.clearRect(u.l, u.t, u.r - u.l, u.b - u.t);
  } else fctx.clearRect(0, 0, W, H);
  fxBox = nb;
  fctx.imageSmoothingEnabled = false;
  for (const b of bugs) bitmap(BUG[Math.floor(b.t * 8) % 2], b.x - 3.5 * S, b.y - 2.5 * S, S, Math.cos(b.a) < 0);
  // Fernsehabend: Popcorn-Eimer neben Sudo
  if (N.act && N.act.name === 'site' && N.act.site === 'video' && N.act.stage === 'do' && N.mode === 'ground') {
    const u = Math.max(1, S / 2), bx = N.x + N.face * 9 * S - 3.5 * u * 2, by = N.y - 8 * u * 2;
    bitmap(['KWRWRWK', 'KYYYYYK', '.WRWRW.', '.WRWRW.', '.WRWRW.', '.WRWRW.', '.KKKKK.'], bx, by, u * 2, false);
  }
  if (ball) {
    const r = ballR();
    fctx.save(); fctx.translate(ball.x, ball.y); fctx.rotate(ball.rot || 0);
    fctx.fillStyle = '#0b0d12'; fctx.beginPath(); fctx.arc(0, 0, r + 1.5, 0, 7); fctx.fill();
    fctx.fillStyle = '#ff9f43'; fctx.beginPath(); fctx.arc(0, 0, r, 0, 7); fctx.fill();
    fctx.fillStyle = '#25d3d0'; fctx.fillRect(-r, -r * .2, r * 2, r * .4); fctx.fillRect(-r * .2, -r, r * .4, r * 2);
    fctx.fillStyle = 'rgba(255,255,255,.55)'; fctx.fillRect(-r * .55, -r * .65, r * .35, r * .3);
    fctx.restore();
  }
  for (const k of shurikens) {
    fctx.save(); fctx.translate(k.x, k.y); fctx.rotate(k.rot);
    fctx.fillStyle = '#dfe7f1'; fctx.fillRect(-7, -1.5, 14, 3); fctx.fillRect(-1.5, -7, 3, 14);
    fctx.rotate(Math.PI / 4); fctx.fillStyle = '#9aa7b8'; fctx.fillRect(-4, -1.5, 8, 3); fctx.fillRect(-1.5, -4, 3, 8);
    fctx.fillStyle = '#12161f'; fctx.fillRect(-1, -1, 2, 2); fctx.restore();
  }
  if (N.act && N.act.name === 'juggle' && N.mode === 'ground') {
    for (let i = 0; i < 3; i++) {
      const ph = (N.act.t * 1.25 + i / 3) % 1, side = ph < .5 ? -1 : 1, u = ph < .5 ? ph * 2 : (ph - .5) * 2;
      const x = N.x + (side < 0 ? -5 + 10 * u : 5 - 10 * u) * S, y = N.y - 15 * S - Math.sin(u * Math.PI) * (side < 0 ? 15 : 9) * S;
      fctx.fillStyle = '#0b0d12'; fctx.fillRect(Math.round(x - 1.6 * S), Math.round(y - 1.6 * S), Math.round(3.2 * S), Math.round(3.2 * S));
      fctx.fillStyle = ['#ff5d8f', '#f4d03f', '#25d3d0'][i]; fctx.fillRect(Math.round(x - 1.1 * S), Math.round(y - 1.1 * S), Math.round(2.2 * S), Math.round(2.2 * S));
    }
  }
  for (const p of parts) {
    const k = 1 - p.t / p.life;
    fctx.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
    switch (p.type) {
      case 'smoke': { const s = p.size * (1 + p.t * 1.6); fctx.fillStyle = p.c; fctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.round(s), Math.round(s)); break; }
      case 'conf': fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillStyle = p.c; fctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); fctx.restore(); break;
      case 'heart': bitmap(HEART, p.x, p.y, 2); break;
      case 'snow': fctx.fillStyle = '#eef4ff'; fctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size); break;
      case 'leaf': bitmap(Math.floor(p.t * 3 + (p.ph || 0)) % 2 ? ['.KK.', 'KCCK', 'KCCK', '.KC.'].map(r => r.replace(/C/g, p.cc)) : ['..KK', '.KCK', 'KCK.', 'KK..'].map(r => r.replace(/C/g, p.cc)), p.x, p.y, Math.max(2, S * .7), false); break;
      case 'petal': fctx.fillStyle = p.c; fctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(2, S * .6), Math.max(2, S * .45)); break;
      case 'egg': fctx.fillStyle = p.c; fctx.beginPath(); fctx.ellipse(p.x, p.y, 4 * S / 2, 5.5 * S / 2, 0, 0, 7); fctx.fill();
        fctx.fillStyle = '#ffffff'; fctx.fillRect(p.x - 3 * S / 2, p.y - S / 2, 6 * S / 2, S / 2); break;
      case 'bat': bitmap(Math.floor(p.t * 8) % 2 ? ['K.....K', 'KK.K.KK', '.KKKKK.', '..K.K..'] : ['.......', 'K..K..K', 'KKKKKKK', '..K.K..'], p.x, p.y, S / 2 + 1, false); break;
      case 'gift': fctx.globalAlpha = 1; { const g = 7 * S / 2; fctx.fillStyle = '#0b0d12'; fctx.fillRect(p.x - g - 1, p.y - g - 1, g * 2 + 2, g * 2 + 2);
        fctx.fillStyle = '#e8473f'; fctx.fillRect(p.x - g, p.y - g, g * 2, g * 2); fctx.fillStyle = '#f4d03f';
        fctx.fillRect(p.x - g * .2, p.y - g, g * .4, g * 2); fctx.fillRect(p.x - g, p.y - g * .2, g * 2, g * .4);
        fctx.fillRect(p.x - g * .6, p.y - g - g * .5, g * .5, g * .5); fctx.fillRect(p.x + g * .1, p.y - g - g * .5, g * .5, g * .5); } break;
      case 'floppy': bitmap(FLOPPY, p.x, p.y, 3); break;
      case 'pop': fctx.fillStyle = p.c; fctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(2, S * .7), Math.max(2, S * .7)); break;
      case 'note': fctx.font = `700 ${Math.round(12 + S * 1.5)}px "Pixelify Sans", monospace`; fctx.fillStyle = '#000'; fctx.fillText('♪', p.x + 1, p.y + 1); fctx.fillStyle = p.c; fctx.fillText('♪', p.x, p.y); break;
      case 'parcel': { fctx.globalAlpha = 1; const g = 6 * S / 2; fctx.fillStyle = '#0b0d12'; fctx.fillRect(p.x - g - 1, p.y - g - 1, g * 2 + 2, g * 1.6 + 2);
        fctx.fillStyle = '#c8955a'; fctx.fillRect(p.x - g, p.y - g, g * 2, g * 1.6); fctx.fillStyle = '#e8d3a8'; fctx.fillRect(p.x - g * .15, p.y - g, g * .3, g * 1.6);
        fctx.fillStyle = '#25d3d0'; fctx.fillRect(p.x - g * .8, p.y - g * .2, g * .5, g * .3); break; }
      case 'z': fctx.fillStyle = '#a8c7ff'; fctx.font = `700 ${Math.round(12 + p.t * 8)}px "Pixelify Sans", monospace`;
        fctx.strokeStyle = '#000'; fctx.lineWidth = 3; fctx.strokeText('Z', p.x, p.y); fctx.fillText('Z', p.x, p.y); break;
      case 'text': fctx.font = '700 14px "Pixelify Sans", monospace'; fctx.textAlign = 'center';
        fctx.fillStyle = '#000'; fctx.fillText(p.text, p.x + 2, p.y + 2); fctx.fillStyle = p.c; fctx.fillText(p.text, p.x, p.y); fctx.textAlign = 'start'; break;
      case 'scroll': fctx.globalAlpha = 1; fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(Math.sin(p.rot) * .3);
        fctx.fillStyle = '#f2e3bf'; fctx.fillRect(-10, -7, 20, 14); fctx.fillStyle = '#c9a86a'; fctx.fillRect(-12, -8, 4, 16); fctx.fillRect(8, -8, 4, 16);
        fctx.fillStyle = '#7a5b2e'; fctx.fillRect(-6, -3, 12, 2); fctx.fillRect(-6, 1, 9, 2); fctx.restore(); break;
    }
  }
  fctx.globalAlpha = 1;
}
/* ---------- Security-Quiz (1.5) ---------- */
const QZ = L.quiz || {};
host.on('quiz_offer', o => {
  if (inMeeting || game) return;
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
  react('book', pick((o && o.pushed ? QZ.pushed : QZ.offer) || ['Security-Quiz?']), 14, { prio: 1, link: 'sudo:quiz' });
  chime([660, 880, 990]);
});
host.on('quiz_result', r => {
  if (!r) return;
  stats.quizAnswered = (stats.quizAnswered || 0) + 1;
  if (r.right) { stats.quizRight = (stats.quizRight || 0) + 1; addXp(10); floatText('+10 XP', N.x, N.y - 30 * S, '#f4d03f'); }
  if (N.mode === 'ground') react(r.right ? 'victory' : 'facepalm', pick((r.right ? QZ.right : QZ.wrong) || ['OK']), 2.2, { prio: 1 });
  saveStats(); checkProgress();
});

/* ---------- Ninja-Leiste (1.4.2): Schnellstart per mittlerer Maustaste ---------- */
const deckEl = $('#deck');
let deckIdleAt = 0, deckHover = false, deckRect = null;
const DL = L.deck || {};
const DPAL = { K: '#0b0d12', B: '#2f6fd6', W: '#eef1f5', D: '#1d222c', G: '#3ccf7a', T: '#25d3d0', Y: '#f4d03f', O: '#e8a93a', S: '#b8c2cf', R: '#e5484d' };
const DICON = {
  ps:     ['KKKKKKKKK', 'KBBBBBBBK', 'KBWBBBBBK', 'KBBWBBBBK', 'KBWBBBBBK', 'KBBBBWWWK', 'KBBBBBBBK', 'KKKKKKKKK'],
  cmd:    ['KKKKKKKKK', 'KDDDDDDDK', 'KDWDDDDDK', 'KDDWDDDDK', 'KDWDDDDDK', 'KDDDDWWWK', 'KDDDDDDDK', 'KKKKKKKKK'],
  term:   ['KKKKKKKKK', 'KTTTTTRYK', 'KDDDDDDDK', 'KDGDDDDDK', 'KDDGDDDDK', 'KDGDDWWDK', 'KDDDDDDDK', 'KKKKKKKKK'],
  folder: ['KKKK.....', 'KYYYKKKKK', 'KYYYYYYYK', 'KOOOOOOOK', 'KOOOOOOOK', 'KOOOOOOOK', 'KOOOOOOOK', 'KKKKKKKKK'],
  chart:  ['KKKKKKKKK', 'KDDDDDDDK', 'KDDDDDGDK', 'KDDDGDGDK', 'KDGDGDGDK', 'KDGDGDGDK', 'KDDDDDDDK', 'KKKKKKKKK'],
  gear:   ['...KKK...', '.K.KSK.K.', '.KSSSSSK.', 'KKSKKKSKK', 'KSSK.KSSK', 'KKSKKKSKK', '.KSSSSSK.', '.K.KSK.K.', '...KKK...'],
  calc:   ['KKKKKKK', 'KGGGGGK', 'KKKKKKK', 'KWKWKWK', 'KKKKKKK', 'KWKWKOK', 'KKKKKKK', 'KWKWKOK', 'KKKKKKK'],
  snip:   ['S.....S', '.S...S.', '..S.S..', '...S...', '..RSR..', '.R...R.', 'R.R.R.R', '.R...R.'],
  reg:    ['.BBB.....', '.BBB.....', '.BBB.....', '.........', 'RRR..GGG.', 'RRR..GGG.', 'RRR..GGG.'],
  tools:  ['......SS.', '.....S..S', '.....S.S.', '....SSS..', '...SSS...', '..SSS....', '.SSS.....', 'SSS......', 'SS.......'],
  ask:    ['.TTTTTTT.', 'TTTWWWTTT', 'TTWTTTWTT', 'TTTTTWTTT', 'TTTTWTTTT', 'TTTTTTTTT', '.TTTWTTT.', '..TT.....', '.T.......'],
  note:   ['YYYYYYYY', 'YKKKKKYY', 'YYYYYYYY', 'YKKKKYYY', 'YYYYYYYY', 'YKKKYYYY', 'YYYYYYYY', 'YYYYYYY.'],
  shield: ['.TTTTTTT.', 'TTTTWTTTT', 'TTTTWTTTT', 'TTWWWWWTT', 'TTTTWTTTT', '.TTTWTTT.', '..TTTTT..', '...TTT...', '....T....'],
  star:   ['....Y....', '...YYY...', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..', '.YYY.YYY.', 'YY.....YY'],
  heal:   ['.KKKKKKK.', 'KWWWRWWWK', 'KWWWRWWWK', 'KWRRRRRWK', 'KWWWRWWWK', 'KWWWRWWWK', '.KKKKKKK.'],
  globe:  ['..TTTTT..', '.TBTTTBT.', 'TBBBTBBBT', 'TTTTTTTTT', 'TBBTTTBBT', 'TTTTTTTTT', '.TBTTTBT.', '..TTTTT..']
};
function deckIcon(name) {
  const rows = DICON[name] || DICON.star, c = document.createElement('canvas');
  c.width = 9; c.height = 9;
  const x = c.getContext('2d'), ox = Math.floor((9 - Math.max(...rows.map(r => r.length))) / 2), oy = Math.floor((9 - rows.length) / 2);
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (DPAL[ch]) { x.fillStyle = DPAL[ch]; x.fillRect(i + ox, j + oy, 1, 1); } }));
  return c;
}
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function openDeck() {
  const d = settings.deck || {};
  if (d.on === false || inMeeting || game) return;
  const head = mk('div', 'dh'); head.append(mk('b', null, T('Ninja-Leiste')));
  const x = mk('button', 'dx', '✕'); x.title = T('Schließen'); x.addEventListener('click', closeDeck); head.append(x);
  const row = mk('div', 'row');
  for (const it of d.items || []) {
    const b = mk('button', 'it'); b.title = T(it.name) + (it.admin ? ' · ' + T('als Administrator') : '');
    b.append(deckIcon(it.icon), mk('span', null, T(it.short || it.name)));
    if (it.admin) b.append(mk('i', null, 'A'));
    b.addEventListener('click', () => runDeck(it));
    row.append(b);
  }
  deckEl.replaceChildren(head, (d.items || []).length ? row : mk('div', 'empty', T('Noch keine Einträge. Einstellungen → Ninja-Leiste.')));
  deckOpen = true; deckIdleAt = now; deckEl.hidden = false;
  deckEl.classList.add('pop'); requestAnimationFrame(() => requestAnimationFrame(() => deckEl.classList.remove('pop')));
  if (N.mode === 'ground') { startAct('idle', { dur: 20 }); react('victory', null, .6); }
  bub.hidden = true;
  beep(660, .05, 'square', .03); beep(990, .06, 'square', .03, .06);
  placeDeck(); setTimeout(syncIgnore, 20);
}
function closeDeck() {
  if (!deckOpen) return;
  deckOpen = false; deckEl.hidden = true; deckRect = null; deckHover = false;
  setTimeout(syncIgnore, 30);
}
function placeDeck() {
  if (!deckOpen) return;
  const w = deckEl.offsetWidth, h = deckEl.offsetHeight;
  const x = clamp(N.x - w / 2, 8, W - w - 8);
  let y = N.y - TOP * S - N.lift - h - 12;
  if (y < 8) y = Math.min(H - h - 8, N.y + 10);
  deckEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  deckRect = [x - 4, y - 4, x + w + 4, y + h + 4];
}
async function runDeck(it) {
  closeDeck();
  const r = await host.deckRun(it.id) || {};
  const name = T(r.name || it.name);
  if (r.internal) return;
  if (r.ok) { react('thumb', fillV(pick(r.admin ? (DL.admin || ['Admin!']) : (DL.go || ['Los!'])), { name }), 1.8, { prio: 1 }); chime([784, 1047]); }
  else if (r.msg !== 'Abgebrochen.') react('facepalm', fillV(pick(DL.fail || ['{name} startet nicht.']), { name }), 2.6, { prio: 1 });
}
deckEl.addEventListener('pointerenter', () => { deckHover = true; });
deckEl.addEventListener('pointerleave', () => { deckHover = false; deckIdleAt = now; });
deckEl.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); closeDeck(); } });
// Einmaliger Tipp nach ein paar Minuten, damit man die Leiste entdeckt
let deckHintDone = false;
try { deckHintDone = localStorage.getItem('sudo-deck-hint') === '1'; } catch { /* egal */ }
setInterval(() => {
  if (deckHintDone || !settings.deck || settings.deck.on === false || performance.now() < 4 * 60000) return;
  if (chatter(pick(DL.hint || ['Mausrad auf mich drücken!']), 'thumb', 4)) { deckHintDone = true; try { localStorage.setItem('sudo-deck-hint', '1'); } catch { /* egal */ } }
}, 60000);
if (init.deckTest) setTimeout(openDeck, 2500);
function deckTick() {
  if (!deckOpen) return;
  if (N.mode === 'carried' || N.mode === 'poof' || inMeeting || game || (!deckHover && now - deckIdleAt > (init.deckTest ? 60000 : 9000))) { closeDeck(); return; }
  placeDeck();
}

/* ---------- Umriss für dunkle Hintergründe (1.4.2) ---------- */
const CONTRAST_COLORS = { white: '#eef1f5', teal: '#25d3d0', gold: '#f4d03f' };
const silCv = document.createElement('canvas'), silCtx = silCv.getContext('2d');
function contrast() {
  const c = settings.contrast || {};
  const on = c.mode === 'always' || ((c.mode || 'auto') === 'auto' && settings.darkTheme);
  return on ? c : null;
}
// Zeichnet die Figur; bei Bedarf mit Pixel-Umriss oder weichem Leuchten darunter
function drawSprite(ctx, src, w, h, rankColor) {
  const c = contrast();
  if (!c) { ctx.drawImage(src, 0, 0, w, h); return; }
  const color = c.color === 'rank' ? rankColor : (CONTRAST_COLORS[c.color] || CONTRAST_COLORS.white);
  if (c.style === 'glow') {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 7 * DPR * (S / 3);
    ctx.drawImage(src, 0, 0, w, h); ctx.drawImage(src, 0, 0, w, h); ctx.restore();
    ctx.drawImage(src, 0, 0, w, h);
    return;
  }
  // Silhouette in der Umrissfarbe, um eine Bildschirm-Pixelbreite versetzt in 8 Richtungen
  if (silCv.width !== src.width || silCv.height !== src.height) { silCv.width = src.width; silCv.height = src.height; }
  silCtx.globalCompositeOperation = 'source-over'; silCtx.clearRect(0, 0, src.width, src.height);
  silCtx.drawImage(src, 0, 0);
  silCtx.globalCompositeOperation = 'source-in'; silCtx.fillStyle = color; silCtx.fillRect(0, 0, src.width, src.height);
  const px = Math.max(1, Math.round(w / src.width));
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.drawImage(silCv, dx * px, dy * px, w, h);
  ctx.drawImage(src, 0, 0, w, h);
}
function render() {
  const p = curPose();
  const f = p === 'type' ? sessionKeys : N.frame;
  let e = (N.react && N.react.eyes) || (!N.react && N.act && N.act.eyes);
  if (!e && p === 'type' && combo >= 15) e = 'determined';
  if (!e && (DEF_EYES[p] || 'open') === 'open') {
    if (now > N.blinkAt) N.blinkAt = now + rand(2200, 4800);
    if (N.blinkAt - now < 130) e = 'closed';
  }
  if (p === 'coffee' && N.act && (N.act.t % 2.4) < .9) e = 'closed';
  const jx = p === 'alarm' && !RM ? (Math.random() - .5) * 2 * S : 0;
  const rot = N.rot + (N.spin > 0 ? -N.spin * 720 : 0);
  const tf = `translate(${Math.round(N.x - 12 * S + jx)}px,${Math.round(N.y - TOP * S - N.lift)}px) rotate(${rot.toFixed(1)}deg)`;
  // 1.9: Nur neu malen, wenn sich Pose, Bild, Augen, Ausstattung oder Lage geändert haben
  const o = outfit(), bl = belt();
  const key = `${p}|${f}|${Math.floor(N.tf)}|${bl}|${e}|${o && JSON.stringify(o)}|${N.face}|${nin.width}`;
  if (key !== lastSpriteKey) {
    lastSpriteKey = key;
    sprite.draw(p, f, N.tf, bl, e, o);
    nctx.setTransform(1, 0, 0, 1, 0, 0);
    nctx.clearRect(0, 0, nin.width, nin.height);
    nctx.imageSmoothingEnabled = false;
    if (N.face < 0) { nctx.translate(nin.width, 0); nctx.scale(-1, 1); }
    drawSprite(nctx, off, 24 * S * DPR, FH * S * DPR, bl);
  }
  if (tf !== lastSpriteTf) { lastSpriteTf = tf; nin.style.transform = tf; }
}
let lastSpriteKey = '', lastSpriteTf = '';
function placeBubble() {
  bub.style.visibility = deckOpen ? 'hidden' : '';
  // Lange Firmen-Meldung wurde von etwas Dringendem verdrängt → danach wieder anzeigen
  if (pinned && (bub.hidden || now > +bub.dataset.until) && now < pinned.until) showPinned();
  if (!bub.hidden) {
    if (now > +bub.dataset.until) { bub.hidden = true; if (bub.dataset.pinned) pinned = null; }
    else {
      const bw = bub.offsetWidth, bh = bub.offsetHeight;
      const x = clamp(N.x - bw / 2, 8, W - bw - 8);
      const y = Math.max(6, N.y - N.lift - (TOP - 1) * S - bh - 14);
      bub.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      bubRect = [x, y, x + bw, y + bh].map(Math.round);
      bub.style.setProperty('--tail', clamp(N.x - x, 16, bw - 16) + 'px');
    }
  }
  if (combo >= 15 && now - lastKey < 900 && N.mode === 'ground') {
    comboEl.hidden = false; comboEl.textContent = `COMBO ×${combo}`;
    comboEl.style.transform = `translate(${Math.round(N.x + 10 * S)}px,${Math.round(N.y - 6 * S)}px)`;
  } else comboEl.hidden = true;
}

/* ---------- Größe ---------- */
function resize(info) {
  if (info) { W = info.width; H = info.height; FLOOR = info.floor; }
  DPR = window.devicePixelRatio || 1;
  S = SIZES[settings.size] || SIZES.normal;
  fx.width = Math.round(W * DPR); fx.height = Math.round(H * DPR);
  nin.width = Math.round(24 * S * DPR); nin.height = Math.round(FH * S * DPR);
  nin.style.width = 24 * S + 'px'; nin.style.height = FH * S + 'px';
}
host.on('layout', info => { resize(info); lastSpriteKey = ''; fxWasEmpty = false; fxBox = null; if (N.mode === 'ground' && N.surf === 'floor') perch(surfaces()[0], clamp(N.x, 40, W - 40)); });
window.addEventListener('resize', () => resize());

/* ---------- Klick-Durchlässigkeit ---------- */
// Klickbare Bereiche (Sudo + Bugs) gehen regelmäßig an den Hauptprozess. Der prüft selbst die
// Mausposition und schaltet das Durchklicken um. So hängt nichts mehr an weitergeleiteten Mausereignissen,
// die Windows nach Sperrbildschirm, Standby oder Vollbild gelegentlich nicht mehr schickt.
let lastBoxes = '';
function sendHitboxes() {
  const boxes = [];
  if (N.mode !== 'poof') boxes.push([N.x - 9 * S, N.y - (TOP - 1) * S - N.lift, N.x + 9 * S, N.y].map(Math.round));
  for (const bg of bugs) { const r = 6 * S + 4; boxes.push([bg.x - r, bg.y - r, bg.x + r, bg.y + r].map(Math.round)); }
  if (!bub.hidden && bub.dataset.link && bubRect) boxes.push(bubRect);
  for (const k of document.querySelectorAll('.keep')) { const r = k.getBoundingClientRect(); boxes.push([r.left, r.top, r.right, r.bottom].map(Math.round)); }
  if (ball) { const r = ballR() + 6; boxes.push([ball.x - r, ball.y - r, ball.x + r, ball.y + r].map(Math.round)); }
  if (deckOpen && deckRect) boxes.push(deckRect.map(Math.round));
  const msg = { boxes, hold: N.mode === 'carried' || !!(ball && ball.held) };
  const key = JSON.stringify(msg);
  if (key !== lastBoxes) { lastBoxes = key; host.hitboxes(msg); }
}
setInterval(sendHitboxes, 60);
function syncIgnore() { sendHitboxes(); }

/* ---------- Greifen, Werfen, Streicheln ---------- */
nin.addEventListener('pointerdown', e => {
  if (N.mode === 'poof') return;
  e.preventDefault();
  if (e.button === 1) { deckOpen ? closeDeck() : openDeck(); return; }   // mittlere Maustaste: Ninja-Leiste
  if (e.button !== 0) return;
  if (deckOpen) closeDeck();
  N.carry = { ox: N.x - e.clientX, oy: N.y - e.clientY, sx: e.clientX, sy: e.clientY, hist: [{ t: now, x: e.clientX, y: e.clientY }],
    prev: { mode: N.mode, surf: N.surf, seg: N.seg, x: N.x, y: N.y, jump: N.jump } };
  nin.setPointerCapture(e.pointerId); nin.classList.add('grab');
  N.mode = 'carried'; N.lift = 0;
});
nin.addEventListener('pointermove', e => {
  if (N.mode !== 'carried' || !N.carry) return;
  const c = N.carry;
  if (Math.hypot(e.clientX - c.sx, e.clientY - c.sy) > 6) c.moved = true;
  if (!c.moved) return;
  // über die Bildschirmkante gezogen → Hauptprozess prüft, ob dort ein anderer Monitor ist
  if ((e.clientX <= 1 || e.clientX >= W - 2 || e.clientY <= 1 || e.clientY >= H - 2) && now - (c.outAt || 0) > 200) { c.outAt = now; host.dragOut(e.clientX, e.clientY); }
  N.x = clamp(e.clientX + c.ox, 12 * S, W - 12 * S); N.y = clamp(e.clientY + c.oy, 26 * S, FLOOR);
  c.hist.push({ t: now, x: e.clientX, y: e.clientY }); c.hist = c.hist.filter(h => now - h.t < 90);
  if (c.hist.length > 1) { const dx = c.hist[c.hist.length - 1].x - c.hist[0].x; if (Math.abs(dx) > 2) N.face = dx > 0 ? 1 : -1; }
  N.frame = Math.floor(now / 120);
});
function release() {
  if (N.mode !== 'carried' || !N.carry) return;
  nin.classList.remove('grab');
  const c = N.carry; N.carry = null;
  if (!c.moved) { Object.assign(N, c.prev); pet(); return; }
  const h = c.hist, a = h[0], b = h[h.length - 1], dt = Math.max(.016, (b.t - a.t) / 1000);
  N.vx = h.length > 1 ? clamp((b.x - a.x) / dt, -2600, 2600) : 0;
  N.vy = h.length > 1 ? clamp((b.y - a.y) / dt, -2600, 2600) : 0;
  N.mode = 'air'; N.act = null;
  if (Math.hypot(N.vx, N.vy) > 1400) { stats.throws++; say(pick(['Wuuuusch!', 'Ich kann fliegen!', 'Hey!']), 1.2); }
  setTimeout(syncIgnore, 50);
}
nin.addEventListener('pointerup', release);
nin.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // kein Auto-Scroll-Symbol
nin.addEventListener('auxclick', e => e.preventDefault());
nin.addEventListener('dblclick', e => { e.preventDefault(); setHomeHere(); });
nin.addEventListener('pointercancel', release);
function pet() {
  // Klick während einer Erinnerung = 10 Minuten schlummern
  if (activeReminder && now < activeReminder.until) {
    host.snooze(activeReminder.id); activeReminder = null;
    react('thumb', 'Okay, in 10 Minuten\nnochmal.', 2.2, { prio: 2 });
    return;
  }
  stats.pets++;
  for (let i = 0; i < 4; i++) add({type:'heart', x:N.x + rand(-14, 10), y:N.y - 26 * S + rand(-6, 6), vx:rand(-15, 15), vy:rand(-60, -35), life:1.1});
  if (N.act && N.act.name === 'sleep') { startAct('idle', { dur: 1.2 }); react('stand', 'Hm? Ich hab nur\nkompiliert.', 1.8); return; }
  if (N.mode === 'ground') react('stand', pick(['Hehe.', 'Root-Rechte\nerhalten!', 'Danke, Admin!', 'Ping erhalten.\nPong!']), 1.4, { eyes: 'happy' });
  chime([880, 1175]);
}
document.addEventListener('pointerdown', e => {
  if (e.target === nin) return;
  for (const b of bugs) if (Math.hypot(b.x - e.clientX, b.y - e.clientY) < 6 * S + 6) { squash(b, true); setTimeout(syncIgnore, 30); return; }
  if (ball && Math.hypot(ball.x - e.clientX, ball.y - e.clientY) < ballR() + 8) {
    ball.held = true; ball.hist = [{ t: now, x: e.clientX, y: e.clientY }]; ball.vx = ball.vy = 0;
  }
});
window.addEventListener('pointermove', e => {
  if (!ball || !ball.held) return;
  ball.x = clamp(e.clientX, ballR(), W - ballR()); ball.y = clamp(e.clientY, ballR(), FLOOR - ballR());
  ball.hist.push({ t: now, x: e.clientX, y: e.clientY }); ball.hist = ball.hist.filter(q => now - q.t < 90);
});
window.addEventListener('pointerup', () => {
  if (!ball || !ball.held) return;
  const h = ball.hist, a = h[0], b = h[h.length - 1], dt = Math.max(.016, (b.t - a.t) / 1000);
  ball.vx = h.length > 1 ? clamp((b.x - a.x) / dt, -2400, 2400) : 0;
  ball.vy = h.length > 1 ? clamp((b.y - a.y) / dt, -2400, 2400) : 0;
  ball.held = false; ball.rest = false;
  if (Math.hypot(ball.vx, ball.vy) > 900 && N.mode === 'ground') chatter(pick(['Ich hol ihn!', 'Fang ich!', 'Wuff! … ähm.']), null, 1.6);
});

/* ---------- Tastatur (vom Hauptprozess, nur Tastenart) ---------- */
let keyTest = null;
function handleKey(k) {
  const t = performance.now();
  if (keyTest) keyTest.count++;
  if (k === 'save') {
    stats.saves++; addXp(3); saveStats();
    if (N.mode === 'ground') react('thumb', pick(['Gespeichert!', 'Sauber.\nStrg+S ist Liebe.', 'Gesichert!']), 1.6);
    add({type:'floppy', x:N.x + N.face * 8 * S, y:N.y - 22 * S, vy:-50, life:1.2});
    chime([660, 990]); return;
  }
  if (k === 'undo') {
    keyLog.z = keyLog.z.filter(x => t - x < 2000); keyLog.z.push(t);
    if (keyLog.z.length >= 3) { keyLog.z = []; if (!RM) N.spin = 1; react('stand', 'Strg+Z, Strg+Z …\nZeitreise!', 1.8); }
    return;
  }
  if (k === 'copy' || k === 'paste') {
    keyLog.clip = keyLog.clip.filter(x => t - x.t < 8000); keyLog.clip.push({ k, t });
    const c = keyLog.clip; let alt = 0;
    for (let i = 1; i < c.length; i++) if (c[i].k !== c[i - 1].k) alt++;
    if (alt >= 3) { keyLog.clip = []; if (N.mode === 'ground') react('sus', 'Stack Overflow?', 2.2); beep(300, .12, 'triangle', .04); }
    return;
  }
  // 'char' oder 'backspace'
  if (t - lastKey > 15000) streakStart = t;
  combo = t - lastKey < 320 ? combo + 1 : 1;
  if (combo > stats.best) stats.best = combo;
  lastKey = t; now = t;
  stats.keys++; stats.keysToday++; sessionKeys++; addXp(.2);
  if (sessionKeys % 50 === 0) saveStats();
  if (combo > 0 && combo % 50 === 0) { say(`Combo ×${combo}!\nHacker-Modus aktiv.`, 1.8); chime([784, 988, 1175]); }
  if (k === 'backspace') {
    keyLog.bs = keyLog.bs.filter(x => t - x < 2000); keyLog.bs.push(t);
    if (keyLog.bs.length >= 5) { keyLog.bs = []; react('facepalm', pick(['Schon wieder\nBackspace?', 'Backspace …\nimmer Backspace.', 'Erst denken,\ndann tippen.']), 1.9); beep(330, .1, 'triangle', .04); beep(220, .14, 'triangle', .04, .1); }
  }
  if (t - streakStart > 20 * 60000 && t - lastCoffee > 45 * 60000) { coffeeDue = true; lastCoffee = t; }
}
host.on('key', d => handleKey(d && d.k));
host.on('meeting', on => {
  inMeeting = !!on;
  if (inMeeting) {
    say('Meeting erkannt.\nIch bin ganz still.', 2.5, undefined, 2);
    if (N.mode === 'ground' && N.act && !['type', 'sleep'].includes(N.act.name)) startAct('meditate');
  } else {
    say(pick(L.meetingEnd || ['Meeting vorbei!']), 3, undefined, 2);
    if (N.mode === 'ground' && !N.react) startAct('coffee');
  }
});
host.on('keytest', () => {
  if (keyTest) return;
  keyTest = { count: 0 };
  say('Tastatur-Test:\nTipp 10 Sekunden\nirgendwo los!', 3, undefined, 2);
  setTimeout(() => {
    const n = keyTest.count; keyTest = null;
    const msg = n > 0 ? `${n} Tasten gehört.\nAlles bestens!` : 'Ich hab nichts gehört.\nAdmin-Fenster?\nSiehe LIESMICH.';
    if (N.mode === 'ground') react(n > 0 ? 'thumb' : 'sus', msg, 4.5, { prio: 2 }); else say(msg, 4.5, undefined, 2);
    log(`Tastatur-Test: ${n} Tasten in 10 Sekunden`);
  }, 10000);
});

/* ---------- Persönlichkeit: Programme, Uhrzeit, Sprüche ---------- */
let daily = {};
try { daily = JSON.parse(localStorage.getItem('sudo-daily') || '{}') || {}; } catch (e) {}
function dailyOnce(name) {
  const k = localDay();
  if (daily[name] === k) return false;
  daily[name] = k;
  try { localStorage.setItem('sudo-daily', JSON.stringify(daily)); } catch (e) {}
  return true;
}
const appSaid = {};
const APP_CHANCE = { browser: .25 };
/* ---------- Webseiten & Programme: passende Aktivitäten (sparsam: je Art höchstens alle 25 Min.) ---------- */
const SITE_GROUP = { youtube: 'video', video: 'video', ytmusic: 'music', webmusic: 'music', music: 'music', shop: 'shop',
  claude: 'ai', otherai: 'ai', copilot: 'ai', news: 'news', social: 'social', maps: 'maps', wiki: 'wiki' };
const siteDone = {};
let lastSiteAct = -1e12, siteTag = '';
function siteActivity(d) {
  const g = SITE_GROUP[d.tag];
  siteTag = d.tag;
  if (N.act && N.act.site && N.act.site !== g) nextAct();                       // Seite verlassen → Aktivität beenden
  if (!g || !settings.appComments || inMeeting || game || asking) return false;
  if (d.force && N.mode !== 'ground' && (d.retry || 0) < 6) { setTimeout(() => siteActivity({ ...d, retry: (d.retry || 0) + 1 }), 1500); return true; }
  if (N.mode !== 'ground' || (!d.force && N.react && now < N.react.until) || (N.act && ['sleep', 'hunt', 'play'].includes(N.act.name))) return false;
  if (!d.force && (now - lastSiteAct < 8 * 60000 || now - (siteDone[g] ?? -1e12) < 25 * 60000)) return false;
  if (!d.force && Math.random() > (g === 'video' || g === 'music' ? .75 : .5)) return false;
  siteDone[g] = now; lastSiteAct = now;
  const cx = d.cursor ? clamp(d.cursor.x, 60, W - 60) : null;
  log('Webseiten-Aktivität: ' + g);
  setTimeout(() => startAct('site', { site: g, cx }), 900);
  return true;
}
host.on('app', d => {
  if (d && siteActivity(d)) { appSaid[d.tag] = now; return; }
  const tag = d && d.tag, list = L.apps && L.apps[tag];
  if (!settings.appComments || !list || !list.length) return;
  if (now - lastChatter < 60000 || now - (appSaid[tag] ?? -1e12) < 20 * 60000) return;
  if (Math.random() > (APP_CHANCE[tag] ?? .7)) return;
  appSaid[tag] = now;
  setTimeout(() => chatter(pick(list), null, 3.2), 1200);
});
function clockTick() {
  const d = new Date(), h = d.getHours(), day = d.getDay(), date = d.getDate();
  if (stats.day !== localDay(d)) { stats.day = localDay(d); stats.keysToday = 0; }
  stats.minutes += 0.5;
  const c = L.clock || {};
  if (N.mode !== 'ground' || N.react || (N.act && N.act.name === 'sleep')) return;
  if (h === 12 && c.lunch && dailyOnce('lunch')) return void chatter(pick(c.lunch), 'thumb', 3);
  if (day === 5 && h >= 15 && h < 19 && c.friday && dailyOnce('friday')) return void chatter(pick(c.friday), 'victory', 3.5);
  if (day === 2 && date >= 8 && date <= 14 && h >= 9 && h < 18 && c.patchday && dailyOnce('patchday')) return void chatter(pick(c.patchday), 'thumb', 3.5);
}
setInterval(clockTick, 30000);
function greeting() {
  const d = new Date(), h = d.getHours(), day = d.getDay(), g = L.greet || {};
  const list = (day === 1 && h < 12 && g.monday) || (day === 5 && h < 15 && g.friday) ||
    (h < 5 ? g.night : h < 11 ? g.morning : h < 14 ? g.noon : h < 18 ? g.afternoon : g.evening);
  return list && list.length ? pick(list) : 'Moin! Ich bin Sudo.';
}

/* ---------- Ereignisse (Tray-Menü oder Webhook) ---------- */
function onTicketArrived(d = {}) {
  const txt = `Ticket #${d.ticket || '4711'}:\n${d.titel || d.text || 'Drucker druckt nicht.'}`;
  if (N.mode === 'ground') react('facepalm', txt, 3, { prio: 2 }); else say(txt, 3, undefined, 2);
  beep(500, .06); beep(400, .08, 'square', .03, .07);
}
// Firmen-Meldung aus der Zentrale: Dauer kommt vom Absender (Standard 15 s, „klick“ = bleibt bis zum Wegklicken).
// Sudo zeigt kurz die passende Pose und macht dann weiter, die Blase bleibt so lange stehen.
let pinned = null;
function showPinned() {
  say(pinned.text, (pinned.until - now) / 1000, pinned.kind, 1, pinned.link);
  bub.dataset.pinned = '1';
}
// 1.9: Wichtige Blasen für den Verlauf („Was hat Sudo gesagt?“) merken – auch die, die im Meeting verschluckt wurden
// 1.11: ev (optional) liefert Ticket- und Gerätekennung für die Suche im Verlauf
function keep(cat, text, link, ev) {
  if (!text) return;
  const o = { cat, text: T(String(text)).slice(0, 600), link: link && link !== 'sudo:close' ? String(link) : '' };
  if (ev && ev.ticket) o.ticket = String(ev.ticket);
  if (ev && (ev.host || ev.device || ev.geraet)) o.device = String(ev.host || ev.device || ev.geraet);
  try { host.keep(o); } catch (e) { /* alte Brücke */ }
}
function companyMessage(ev, pose, kind) {
  const sticky = ev.dur === 'klick';
  const dur = sticky ? 3600 : clamp(Number(ev.dur) || 15, 5, 120);
  const link = ev.link || (sticky || dur >= 30 ? 'sudo:close' : null);
  if (N.mode === 'ground' && !(N.react && N.react.prio > 2 && now < N.react.until)) N.react = { pose, until: now + 2500, prio: 2 };
  say(ev.text || '…', dur, kind, 2, link);
  // Lange Meldungen „anpinnen“: Sie blockieren keine Warnungen und kommen danach zurück
  if (dur >= 30) { pinned = { text: ev.text || '…', kind, link, until: now + dur * 1000 }; bub.dataset.pinned = '1'; bub.dataset.prio = 1; }
}
function handleEvent(ev) {
  if (!ev || !ev.type) return;
  keepEvent(ev);
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
  switch (ev.type) {
    case 'backup_failed':
      stats.alarms++;
      // 1.7: mit Ticket-Nummer und klickbar (Link zum Ticket), wenn die Zentrale eine Regel angewendet hat
      react('alarm', `Backup fehlgeschlagen!\n${ev.kunde || ev.text || 'Unbekannter Job'}` + (ev.ticket ? `\nTicket #${ev.ticket}` : ''), ev.link ? 9 : 4.5, { kind: 'alert', prio: 2, link: ev.link });
      poofAt(N.x, N.y - 12 * S, true);
      for (let i = 0; i < 6; i++) beep(i % 2 ? 660 : 880, .14, 'sawtooth', .03, i * .15);
      break;
    case 'server_down':
      stats.alarms++;
      react('alarm', `${ev.host || 'Server'} antwortet nicht!\n${ev.text || 'Ping: Zeitüberschreitung'}`, ev.link ? 9 : 4, { kind: 'alert', prio: 2, link: ev.link });
      poofAt(N.x, N.y - 12 * S, true);
      for (let i = 0; i < 4; i++) beep(i % 2 ? 520 : 780, .16, 'sawtooth', .03, i * .18);
      break;
    case 'warning':
      if (ev.via === 'zentrale') { companyMessage(ev, 'sus', 'alert'); break; }
      react('sus', ev.text || 'Hm, das sieht\nkomisch aus.', ev.link ? 9 : 3, { kind: 'alert', prio: 2, link: ev.link });
      break;
    case 'deploy_ok': case 'success':
      react('victory', ev.type === 'deploy_ok' ? `Deploy erfolgreich!\n${ev.version || ''} ist live.` : (ev.text || 'Erledigt!'), 3, { prio: 2 });
      burst('confetti', N.x, N.y - 20 * S, 48); chime([523, 659, 784, 1047]); addXp(5);
      break;
    case 'ticket':
      add({type:'scroll', x: clamp(N.x + rand(-80, 80), 20, W - 20), y: -20, vy: 60, life: 8, rot: 0, data: ev});
      break;
    case 'bug': spawnBug(); break;
    case 'video':
      // 1.8: neues YouTube-Video eines Kanals, den die IT eingetragen hat – Klick öffnet es
      react('book', `Neues Video von ${ev.kanal || 'YouTube'}:\n${ev.titel || ''}`, ev.link ? 12 : 5, { prio: 2, link: ev.link, eyes: 'wide' });
      break;
    case 'music':
      // 1.8: Musikwunsch im Büro – kurze Ansage mit Konfetti
      react('victory', `Musikwunsch von ${ev.von || 'Jemand'}:\n${ev.titel || ''}${ev.artist ? ' – ' + ev.artist : ''}`, 5, { prio: 1 });
      burst('confetti', N.x, N.y - 20 * S, 18); chime([659, 784, 988]);
      break;
    case 'message':
      // Firmen-Mitteilungen aus der Zentrale bleiben länger stehen, mit Link klickbar
      if (ev.via === 'zentrale') { companyMessage(ev, 'thumb'); break; }
      say(ev.text || '…', ev.link ? 10 : ev.via ? 7 : 4, undefined, 2, ev.link);
      break;
  }
}
function keepEvent(ev) {
  const cat = ev.own ? 'youtube' : ev.via === 'zentrale' ? 'zentrale' : ev.via ? 'relay' : 'event';
  const tk = ev.ticket && ev.ticket !== '–' ? `\nTicket #${ev.ticket}` : '';
  switch (ev.type) {
    case 'backup_failed': return keep(cat, `Backup fehlgeschlagen!\n${ev.kunde || ev.text || 'Unbekannter Job'}` + tk, ev.link, ev);
    case 'server_down': return keep(cat, `${ev.host || 'Server'} antwortet nicht!\n${ev.text || ''}`.trim(), ev.link, ev);
    case 'deploy_ok': return keep(cat, `Deploy erfolgreich!\n${ev.version || ''} ist live.`, null, ev);
    case 'ticket': return keep(cat, `Neues Ticket #${ev.ticket || '–'}\n${ev.titel || ev.text || ''}`.trim(), ev.link, ev);
    case 'video': return keep(ev.own ? 'youtube' : cat, `Neues Video von ${ev.kanal || 'YouTube'}:\n${ev.titel || ''}`, ev.link, ev);
    case 'music': return keep(cat, `Musikwunsch von ${ev.von || 'Jemand'}:\n${ev.titel || ''}${ev.artist ? ' – ' + ev.artist : ''}`, null, ev);
    case 'bug': return;
    default: return keep(cat, ev.text || ev.titel || '…', ev.link, ev);
  }
}
host.on('event', handleEvent);
host.on('xp_spend', p => spendXp(p && p.cost, p && p.title ? `„${p.title}“ kommt gleich.` : ''));
host.on('platforms', p => { platforms = Array.isArray(p) ? p : []; });
host.on('settings', s => { lastSpriteKey = ''; fxWasEmpty = false; fxBox = null;
  const oldSize = settings.size;
  settings = Object.assign(settings, s);
  home = settings.home || null;
  dayEv = PG.today(new Date(), settings.special || {});
  if (!settings.bugs) bugs.length = 0;
  if (settings.size !== oldSize) resize();
  applyBubbleStyle();
});
host.on('bubbletest', kind => react('thumb', kind === 'alert' ? 'Achtung: So sieht eine Warnung aus.' : 'So sehen meine Sprechblasen aus.\nGut lesbar?', 2.5, { prio: 2, kind: kind || undefined }));
applyBubbleStyle();
host.on('summon', () => { if (N.mode !== 'carried') poof('center'); });
host.on('sethome', setHomeHere);
host.on('gohome', () => { if (N.mode !== 'carried' && homeTarget()) poof('home'); else say('Mein Zuhause ist\ngerade nicht offen.', 2.5, undefined, 1); });

/* ---------- System-Wächter ---------- */
const fill = (t, c) => String(t).replace(/\{(\w+)\}/g, (_, k) => (c[k] ?? ''));
const SYS_POSE = { offline: ['alarm', 'alert'], online: ['victory'], vpn_down: ['alarm', 'alert'], vpn_up: ['thumb'],
  disk: ['alarm', 'alert'], cpu: ['sus', 'alert'], ram: ['sus', 'alert'], reboot: ['sus'], uptime: ['sus'],
  battery_low: ['sus', 'alert'], battery_crit: ['alarm', 'alert'], charging: ['thumb'],
  cloud_down: ['alarm', 'alert'], cloud_ok: ['victory'], azure: ['sus', 'alert'], azure_many: ['alarm', 'alert'],
  breach_new: ['sus'], leak: ['alarm', 'alert'], advisory: ['sus', 'alert'], advisory_crit: ['alarm', 'alert'], advisory_many: ['sus', 'alert'],
  health_bitlocker: ['alarm', 'alert'], health_bitlocker_wait: ['sus'], health_av: ['alarm', 'alert'], health_av_old: ['sus', 'alert'], health_fw: ['alarm', 'alert'], health_updates: ['sus', 'alert'] };
// Ohne eigenen Link öffnet ein Klick auf die Blase die passende Seite der IT-Lage
const SYS_LINK = { health_bitlocker: 'sudo:lage/pc', health_bitlocker_wait: 'sudo:lage/pc', health_av: 'sudo:lage/pc', health_av_old: 'sudo:lage/pc', health_fw: 'sudo:lage/pc', health_updates: 'sudo:lage/pc', cloud_down: 'sudo:lage/status', cloud_ok: 'sudo:lage/status', azure_many: 'sudo:lage/status', leak: 'sudo:lage/leaks', advisory_many: 'sudo:lage/feeds' };
// Mehrere wichtige Meldungen kurz hintereinander: nacheinander zeigen statt überschreiben
// Nicht dringende Hinweise (News, Entwarnungen) warten, bis das Meeting vorbei ist
const sysQueue = [], QUIET_KINDS = new Set(['breach_new', 'advisory', 'advisory_many', 'cloud_ok', 'health_bitlocker', 'health_bitlocker_wait', 'health_av', 'health_av_old', 'health_fw', 'health_updates']);
setInterval(() => {
  if (!sysQueue.length || !(bub.hidden || now > +bub.dataset.until || (+bub.dataset.prio || 0) < 2 || bub.dataset.pinned)) return;
  const i = sysQueue.findIndex(c => !(inMeeting && QUIET_KINDS.has(c.kind)));
  if (i >= 0) sysReact(sysQueue.splice(i, 1)[0], true);
}, 400);
function sysReact(c, fromQueue) {
  const list = (L.sys || {})[c.kind];
  if (!list) return;
  if (!fromQueue && ((inMeeting && QUIET_KINDS.has(c.kind)) || (!bub.hidden && now < +bub.dataset.until && (+bub.dataset.prio || 0) >= 2 && !bub.dataset.pinned))) { if (sysQueue.length < 8) sysQueue.push(c); else keep('sys', fill(pick(list), c), c.link || SYS_LINK[c.kind] || null); return; }
  const [pose, kind] = SYS_POSE[c.kind] || ['stand'];
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
  const link = c.link || SYS_LINK[c.kind] || null;
  const line = fill(pick(list), c);
  react(pose, line, c.dur || (link ? 8 : kind ? 4.5 : 3.5), { kind, prio: 2, link });
  keep('sys', line, link);
  if (kind) { poofAt(N.x, N.y - 12 * S, pose === 'alarm'); beep(520, .12, 'sawtooth', .03); beep(390, .16, 'sawtooth', .03, .14); }
  else chime([660, 880]);
  log('Wächter: ' + c.kind);
}
host.on('sys', sysReact);
// Akku direkt im Overlay beobachten (Chromium kennt den Ladestand)
(async () => {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    let warned = 100, wasCharging = b.charging;
    const check = () => {
      if (!settings.watch || settings.watch.battery === false) return;
      const pct = Math.round(b.level * 100);
      if (b.charging) {
        if (!wasCharging && warned <= 20) sysReact({ kind: 'charging' });
        warned = 100;
      } else if (pct <= 7 && warned > 7) { warned = 7; sysReact({ kind: 'battery_crit', pct }); }
      else if (pct <= 20 && warned > 20) { warned = 20; sysReact({ kind: 'battery_low', pct }); }
      wasCharging = b.charging;
    };
    b.addEventListener('levelchange', check); b.addEventListener('chargingchange', check);
    check();
  } catch (e) { /* kein Akku */ }
})();

/* ---------- Frag Sudo ---------- */
// Während Claude antwortet, tippt Sudo am Laptop; danach kommt die Antwort (oder ein Hinweis) in die Blase
let asking = false;
host.on('ask', d => {
  if (!d) return;
  if (d.kind === 'start') {
    asking = true;
    if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
    if (N.mode === 'ground') react('type', pick(L.askThink || ['Hmm …']), 30, { prio: 1 });
    return;
  }
  asking = false;
  if (N.react && N.react.pose === 'type') N.react = null;
  if (!d.ok) { react('sus', d.msg || '…', 3.5, { prio: 1 }); return; }
  if (d.windowOpen) { react('thumb', pick(L.askDone || ['Erledigt!']), 1.8, { prio: 1 }); return; }
  // Fenster zu (z. B. nur Kürzel benutzt): Anfang der Antwort in der Blase, Klick öffnet alles
  const plain = String(d.text || '').replace(/```[\s\S]*?```/g, '[Code]').replace(/[`*#>]/g, '').replace(/\s+/g, ' ').trim();
  const short = plain.length > 120 ? plain.slice(0, 118).replace(/\s\S*$/, '') + ' …' : plain;
  keep('ask', short, 'sudo:ask');
  if (N.mode === 'ground') react('thumb', short, 10, { prio: 1, link: 'sudo:ask' });
  else say(short, 10, undefined, 1, 'sudo:ask');
});

/* ---------- Erinnerungen, Notizen, Werkzeugkasten ---------- */
let activeReminder = null;
host.on('reminder', r => {
  if (!r) return;
  const dur = 14;
  activeReminder = { id: r.id, until: now + dur * 1000 };
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
  const head = r.late ? `Verpasst (vor ${r.late} Min.):` : 'Erinnerung!';
  keep('reminder', `${head}\n${r.text}`);
  if (N.mode === 'ground') react('victory', `${head}\n${r.text}\n(Klick = 10 Min. später)`, dur, { prio: 2 });
  else say(`${head}\n${r.text}`, dur, undefined, 2);
  add({ type: 'scroll', x: clamp(N.x + 40, 20, W - 20), y: -20, vy: 80, life: 2.5, rot: 0, data: null, silent: true });
  chime([784, 988, 784, 988]);
});
host.on('noted', d => {
  if (!d || N.mode !== 'ground') return;
  react('thumb', d.reminder ? `Notiert!\n${d.msg}` : 'Notiz gespeichert!', 2.4, { prio: 1 });
  add({ type: 'floppy', x: N.x + N.face * 8 * S, y: N.y - 22 * S, vy: -50, life: 1.2 });
});
host.on('toolcopy', () => { if (N.mode === 'ground') react('thumb', pick(['Kopiert!', 'Ab in die\nZwischenablage!', 'Strg+V bereit.']), 1.5, { prio: 1 }); });

/* ---------- Arbeitstag: Pausen und Erinnerungen ---------- */
host.on('care', c => {
  if (!c) return;
  const C = L.care || {};
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
  switch (c.kind) {
    case 'workstart':
      say(`${pick(C.workstart || ['Moin!'])}\nArbeitsbeginn ${c.time}.` + (c.end ? `\nFeierabend ca. ${c.end}.` : '') +
        (c.notes ? `\n${c.notes} offene Notiz${c.notes > 1 ? 'en' : ''}.` : ''), 6, undefined, 2);
      break;
    case 'soon':
      say(`In 5 Minuten:\n${c.label} (${c.time})`, 4.5, undefined, 2); chime([660, 880]);
      break;
    case 'fixed':
      react('victory', `${c.label}!\n${c.min} Minuten – ab!`, 5, { prio: 2 });
      burst('confetti', N.x, N.y - 20 * S, 24); chime([523, 659, 784]);
      break;
    case 'stand':
      react('victory', pick(C.stand || ['Zeit zum Aufstehen!']), 5, { prio: 2 }); chime([523, 784]);
      break;
    case 'eyes':
      say(pick(C.eyesStart || ['Augenpause!']), 5, undefined, 2); chime([440, 660]);
      if (N.mode === 'ground' && !N.react) startAct('meditate', { dur: 20 });
      setTimeout(() => say(pick(C.eyesEnd || ['Augen wieder frisch.']), 3, undefined, 2), 20000);
      break;
    case 'water':
      react('coffee', pick(C.water || ['Schluck Wasser?']), 4.5, { prio: 2 });
      break;
    case 'end':
      react('victory', pick(C.end || ['Feierabend?']).replace('{h}', c.hours), 5, { prio: 2 });
      burst('confetti', N.x, N.y - 20 * S, 40); chime([523, 659, 784, 1047]);
      break;
    // 1.10: Sperr-Erinnerung – Klick öffnet „Dynamische Sperre“ (sperrt automatisch, wenn das Handy weg ist)
    case 'lockhint':
      react('sus', pick(C.lockhint || ['Bildschirm war offen.\nWin+L sperrt ihn.']).replace('{min}', c.min), 9, { prio: 1, link: 'ms-settings:signinoptions-dynamiclock' });
      break;
    case 'locked':
      stats.locks = (stats.locks || 0) + 1; addXp(3); saveStats();
      react('thumb', pick(C.locked || ['Gesperrt. Vorbildlich!']), 3, { prio: 1 });
      floatText('+3 XP', N.x, N.y - 30 * S, '#f4d03f');
      break;
    // 1.10: Tipp im passenden Moment (Programmname bleibt, wie er ist)
    case 'tip':
      if (N.mode === 'ground') react('book', `${T('Tipp für {app}:').replace('{app}', c.app || 'Windows')}\n${c.text}`, 10, { prio: 1 });
      break;
    // 1.10: Kurze Frage der IT, Start-Checkliste
    case 'pulse':
      react('book', pick(C.pulse || ['Kurze Frage deiner IT?']), 14, { prio: 1, link: 'sudo:stimmung' }); chime([660, 880]);
      keep('sys', pick(C.pulse || ['Kurze Frage deiner IT?']), 'sudo:stimmung');
      break;
    case 'pulse_incident':
      react('book', `${T('Kurze Rückfrage deiner IT:')}\n${c.title || ''}\n${T('Läuft es bei dir wieder?')}`, 14, { prio: 1, link: 'sudo:stimmung' }); chime([660, 880]);
      break;
    case 'pulse_thanks':
      react('thumb', pick(C.pulseThanks || ['Danke!']), 2.5, { prio: 1 });
      break;
    case 'onboard':
      react('book', `${T('Deine Start-Checkliste:')}\n${T('noch {n} von {t} Punkten.').replace('{n}', c.open).replace('{t}', c.total)}`, 12, { prio: 1, link: 'sudo:start' });
      break;
    case 'onboard_done':
      stats.flags.onboard = 1; addXp(25); saveStats();
      react('victory', pick(C.onboardDone || ['Startklar!']), 4, { prio: 2 });
      floatText('+25 XP', N.x, N.y - 30 * S, '#f4d03f');
      burst('confetti', N.x, N.y - 20 * S, 48); chime([523, 659, 784, 1047, 1319]);
      break;
  }
  log('Erinnerung: ' + c.kind);
});

/* ---------- Garderobe, Geschenke, Erfolge ---------- */
const PG = window.SudoProgress || { ITEMS: {}, ACHIEVEMENTS: [], today: () => ({}) };
let dayEv = PG.today(new Date(), settings.special || {});
function outfit() {
  const o = settings.outfit || {};
  const own = id => id && (stats.unlocked.includes(id) || dayEv.hat === id || dayEv.neck === id);
  let hat = own(o.hat) ? o.hat : null, face = own(o.face) ? o.face : null, neck = own(o.neck) ? o.neck : null;
  if (settings.special && settings.special.seasonal !== false) {     // Feiertags-Sachen haben Vorrang
    if (dayEv.hat) hat = dayEv.hat;
    if (dayEv.neck) neck = dayEv.neck;
  }
  return { hat, face, neck };
}
const giftQueue = [], achQueue = [];
function checkProgress() {
  for (const f of (PG.seasonFlags ? PG.seasonFlags() : [])) stats.flags[f] = 1;
  for (const [id, it] of Object.entries(PG.ITEMS)) {
    if (!stats.unlocked.includes(id) && it.p(stats) >= 1) { stats.unlocked.push(id); giftQueue.push(id); log('Geschenk: ' + it.name); }
  }
  for (const a of PG.ACHIEVEMENTS) {
    if (!stats.achievements[a.id] && a.ok(stats)) { stats.achievements[a.id] = localDay(); achQueue.push(a); log('Erfolg: ' + a.t); }
  }
}
function openGift(id) {
  const it = PG.ITEMS[id]; if (!it) return;
  react('victory', `Ein Geschenk!\n${it.name}!`, 3.5, { prio: 2 });
  burst('confetti', N.x, N.y - 20 * S, 46); chime([523, 659, 784, 1047, 1319]);
  // gleich anprobieren, wenn der Platz noch frei ist
  const o = { ...(settings.outfit || {}) };
  if (!o[it.slot]) { o[it.slot] = id; settings.outfit = o; host.setOutfit(o); }
  setTimeout(() => chatter('Garderobe im\nTray-Menü!', null, 2.5), 4200);
}
let lastProgressShow = 0;
function progressTick() {
  if (N.mode !== 'ground' || inMeeting || now - lastProgressShow < 6000) return;
  if (N.react && now < N.react.until && N.react.prio >= 2) return;
  if (giftQueue.length) {
    lastProgressShow = now;
    add({ type: 'gift', x: clamp(N.x + rand(-60, 60), 30, W - 30), y: -30, vy: 80, life: 20, item: giftQueue.shift() });
    return;
  }
  if (achQueue.length) {
    lastProgressShow = now;
    const a = achQueue.shift();
    react('thumb', `Erfolg freigeschaltet:\n${a.t}`, 3.2, { prio: 2 });
    floatText('+15 XP', N.x, N.y - 30 * S, '#f4d03f'); addXp(15);
    burst('confetti', N.x, N.y - 20 * S, 18); chime([784, 1047]);
  }
}
setInterval(progressTick, 1000);
setInterval(() => { checkProgress(); }, 10000);
if (init.unlockAll) { stats.unlocked = Object.keys(PG.ITEMS); }
if (init.testXp != null) { stats.xp = init.testXp; curRank = rankIdx(stats.xp); }
// Merker aus dem Hauptprozess (z. B. Zentrale angemeldet, Transparenz-Seite geöffnet) → schaltet Teile frei
host.on('flag', f => { if (typeof f === 'string' && /^[a-z]{2,20}$/.test(f) && !stats.flags[f]) { stats.flags[f] = 1; checkProgress(); } });

/* ---------- Besondere Tage ---------- */
let lastGreetDay = '';
try { lastGreetDay = localStorage.getItem('sudo-event-greet') || ''; } catch (e) {}
function eventTick() {
  dayEv = PG.today(new Date(), settings.special || {});
  const k = localDay() + (dayEv.greet || '');
  if (dayEv.greet && lastGreetDay !== k && N.mode === 'ground' && !N.react && !inMeeting) {
    lastGreetDay = k; try { localStorage.setItem('sudo-event-greet', k); } catch (e) {}
    react(dayEv.hat ? 'victory' : 'thumb', dayEv.greet, 4.5, { prio: 2 });
    if (dayEv.fx === 'confetti' || dayEv.fx === 'fireworks') burst('confetti', N.x, N.y - 20 * S, 50);
  }
}
setInterval(eventTick, 60000);
// 1.9: Tagesmomente – je einmal am Tag, nur wenn Sudo gerade frei ist
let moments = {};
try { moments = JSON.parse(localStorage.getItem('sudo-moments') || '{}'); } catch (e) { moments = {}; }
function momentTick() {
  if (!settings.special || settings.special.seasonal === false || inMeeting || game || N.mode !== 'ground') return;
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60, wd = d.getDay(), day = localDay();
  const active = now - lastKey < 10 * 60000;
  if (moments.day !== day) moments = { day };
  const once = (k, fn) => { if (moments[k]) return false; if (fn()) { moments[k] = 1; try { localStorage.setItem('sudo-moments', JSON.stringify(moments)); } catch (e) {} return true; } return false; };
  const holiday = dayEv && dayEv.holiday;
  if (wd === 1 && h >= 6.5 && h < 10.5 && active && !holiday && once('monday', () => { const ok = chatter(pick(L.monday || ['Montag.\nErst mal Kaffee.']), 'coffee', 3.5); if (ok) startAct('coffee'); return ok; })) return;
  if (wd >= 1 && wd <= 5 && h >= 11.75 && h < 13.25 && active && once('lunch', () => chatter(pick(L.lunch || ['Mahlzeit!']), 'thumb', 3))) return;
  if (wd === 5 && h >= 14 && h < 19 && active && once('friday', () => {
    const ok = chatter(pick(L.friday || ['Fast Wochenende!']), 'victory', 3.5);
    if (ok) { for (let i = 0; i < 6; i++) add({ type: 'note', x: N.x + rand(-14, 14) * S / 3, y: N.y - 24 * S, vx: rand(-30, 30), vy: rand(-60, -35), life: 1.6, c: pick(['#25d3d0', '#f4d03f', '#ff5d8f']) }); chime([523, 659, 784]); }
    return ok;
  })) return;
  if ((wd === 0 || wd === 6) && active && sessionKeys > 60 && once('weekend', () => chatter(pick(L.weekend || ['Wochenende –\nund trotzdem hier?']), 'sus', 3.5))) return;
  if (wd >= 1 && wd <= 5 && h >= 20 && h < 23 && active && sessionKeys > 60 && once('late', () => chatter(pick(L.late || ['Noch am Rechner?\nDenk an den Feierabend.']), 'stand', 3.5))) return;
}
setInterval(momentTick, 60000);
setTimeout(momentTick, 20000);
setTimeout(eventTick, 6000);
let fxT = 0, eggSaid = 0, gustAt = now + rand(40, 90) * 1000, gustUntil = 0;
// 1.9: Jahreszeiten – ab und zu eine kleine Böe statt Dauerberieselung (schont auch die Grafikkarte)
const SEASON_P = {
  leaves: () => ({ type: 'leaf', cc: pick(['O', 'R', 'N']), sway: rand(1.5, 2.6), ph: rand(0, 6), vx: rand(-25, 25), vy: rand(30, 55), life: H / 32 }),
  petals: () => ({ type: 'petal', c: pick(['#ffc2d6', '#ff9fbd', '#ffffff', '#ffe08a']), sway: rand(2, 3.4), ph: rand(0, 6), vx: rand(-20, 30), vy: rand(22, 40), life: H / 24 }),
  flakes: () => ({ type: 'snow', size: Math.random() < .3 ? 3 : 2, sway: rand(1, 2), ph: rand(0, 6), vx: rand(-8, 8), vy: rand(22, 40), life: H / 24 })
};
function eventFx(dt) {
  if (!settings.special || settings.special.seasonal === false || inMeeting) return;
  fxT += dt;
  if (SEASON_P[dayEv.fx] && !game) {
    if (now > gustAt) { gustUntil = now + rand(6, 10) * 1000; gustAt = now + rand(180, 420) * 1000; }
    if (now < gustUntil && Math.random() < dt * 0.9) add({ x: rand(0, W), y: -6, ...SEASON_P[dayEv.fx]() });
    return;
  }
  if (dayEv.fx === 'heat' && N.mode === 'ground' && !N.react && now - eggSaid > 90 * 60000 && Math.random() < dt / 300) {
    eggSaid = now; chatter(pick(L.heat || ['Puh, warm heute.\nDenk ans Trinken!', 'Ventilator-Modus:\nan.', '30 Grad.\nDer Serverraum lacht.']), 'coffee', 3);
  }
  switch (dayEv.fx) {
    case 'snow':
      if (Math.random() < dt * 5) add({ type: 'snow', x: rand(0, W), y: -4, vx: rand(-12, 12), vy: rand(25, 55), life: H / 25, size: Math.random() < .3 ? 3 : 2 });
      break;
    case 'fireworks':
      if (fxT > 2.5) { fxT = 0; const x = rand(W * .15, W * .85), y = rand(H * .1, H * .35);
        for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, sp = rand(120, 260);
          add({ type: 'conf', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 160, life: rand(1, 1.6), size: 3, rot: 0, vr: 0, c: pick(['#ff5d8f', '#f4d03f', '#25d3d0', '#7f8cff', '#3ccf7a']) }); }
        beep(rand(180, 260), .2, 'triangle', .02); }
      break;
    case 'bats':
      if (fxT > 9) { fxT = 0; const l = Math.random() < .5; add({ type: 'bat', x: l ? -20 : W + 20, y: rand(H * .1, H * .5), vx: (l ? 1 : -1) * rand(160, 260), vy: rand(-20, 20), life: (W + 60) / 160 }); }
      break;
    case 'eggs':
      if (N.mode === 'ground' && !N.react && now - eggSaid > 30 * 60000 && Math.random() < dt / 40) {
        eggSaid = now;
        add({ type: 'egg', x: N.x + N.face * 14 * S, y: N.y - 3 * S, life: 8, c: pick(['#ff9fbd', '#9be15d', '#7fd3ff', '#f4d03f']) });
        chatter(pick(['Ein Osterei!', 'Ich hab eins\ngefunden!']), 'thumb', 2.5);
      }
      break;
  }
}

/* ---------- Spielzeug: Stressball ---------- */
let ball = null, sulkUntil = 0;
const ballR = () => 4.5 * S;
function surfaceUnder(x, y) {
  let best = null;
  for (const s of surfaces()) if (x >= s.left && x <= s.right && s.top >= y - 2 && (!best || s.top < best.top)) best = s;
  return best;
}
function giveBall(silent) {
  ball = { x: clamp(N.x + N.face * 30, 40, W - 40), y: Math.max(40, N.y - 160), vx: rand(-60, 60), vy: 0, rot: 0 };
  if (!silent) { react('victory', pick(['Ein Ball!\nFür mich?', 'Stressball!\nDanke!']), 2.5, { prio: 1 }); chime([660, 880, 1100]); }
}
function takeBall() {
  if (!ball) return;
  poofAt(ball.x, ball.y); ball = null;
  sulkUntil = now + 45000;
  react('sus', pick(['Hey! Das war meins.', 'Mein Ball …', 'Na toll.\nJetzt ist mir\nlangweilig.']), 3, { prio: 2 });
}
function ballPhysics(dt) {
  if (!ball || ball.held) return;
  const r = ballR(), py = ball.y;
  ball.vy += 1900 * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.rot = (ball.rot || 0) + ball.vx * dt / r;
  if (ball.x < r) { ball.x = r; ball.vx = Math.abs(ball.vx) * .7; }
  if (ball.x > W - r) { ball.x = W - r; ball.vx = -Math.abs(ball.vx) * .7; }
  if (ball.y < r) { ball.y = r; ball.vy = Math.abs(ball.vy) * .5; }
  if (ball.vy >= 0) {
    for (const s of surfaces()) {
      if (py + r <= s.top + 2 && ball.y + r >= s.top && ball.x >= s.left && ball.x <= s.right) {
        ball.y = s.top - r;
        if (ball.vy > 160) { ball.vy = -ball.vy * .55; beep(140 + Math.random() * 40, .03, 'triangle', .02); } else ball.vy = 0;
        ball.vx *= .985;
        break;
      }
    }
    if (ball.y + r > FLOOR) { ball.y = FLOOR - r; ball.vy = ball.vy > 160 ? -ball.vy * .55 : 0; ball.vx *= .985; }
  }
  if (Math.abs(ball.vx) < 4) ball.vx = 0;
}
host.on('toy', on => { if (on) giveBall(false); else takeBall(); });

/* ---------- Pausenspiel: Bug-Jagd ---------- */
let game = null;
const hud = document.getElementById('hud');
function startGame() {
  if (game || N.mode === 'carried') return;
  game = { until: now + 30000, score: 0, spawn: 0 };
  bugs.length = 0;
  react('victory', 'Bug-Jagd!\n30 Sekunden.\nKlick die Bugs!', 2.5, { prio: 2 });
  chime([523, 659, 784]);
}
function gameTick(dt) {
  if (!game) { if (hud) hud.hidden = true; return; }
  const left = Math.max(0, Math.ceil((game.until - now) / 1000));
  if (hud) { hud.hidden = false; hud.textContent = I18N.tf('BUG-JAGD  {s} s  ·  {p} Punkte  ·  Rekord {r}', { s: left, p: game.score, r: stats.gameBest }); }
  game.spawn -= dt;
  if (game.spawn <= 0 && now < game.until) {
    game.spawn = rand(.35, .8);
    if (bugs.length < 14) {
      const l = Math.random() < .5;
      bugs.push({ x: l ? -12 : W + 12, y: rand(H * .12, FLOOR - 30), a: l ? rand(-.5, .5) : Math.PI + rand(-.5, .5), sp: rand(70, 150) * S / 3, t: 0, enter: .6, game: true });
    }
  }
  if (now >= game.until) {
    const sc = game.score, rec = sc > stats.gameBest;
    if (rec) stats.gameBest = sc;
    bugs.splice(0, bugs.length, ...bugs.filter(b => !b.game));
    game = null; saveStats();
    react('victory', `${sc} Punkte!` + (rec ? '\nNeuer Rekord!' : `\nRekord: ${stats.gameBest}`), 4, { prio: 2 });
    burst('confetti', N.x, N.y - 20 * S, rec ? 60 : 25); chime(rec ? [523, 659, 784, 1047, 1319] : [523, 784]);
    log(`Bug-Jagd: ${sc} Punkte`);
  }
}
host.on('game', startGame);

/* ---------- Zähler für Erfolge ---------- */
host.on('toolcopy', () => { stats.copies++; });
host.on('noted', () => { stats.noted++; });
host.on('care', c => {
  if (!c) return;
  if (c.kind === 'breaktaken') {
    stats.breaks++; saveStats();
    if (N.mode === 'ground') react('thumb', pick(['Gute Pause!\nSo gehört sich das.', 'Pause gemacht.\nIch bin stolz.']), 2.8, { prio: 1 });
  }
  if (c.kind === 'workstart' && c.time && c.time < '06:30') stats.flags.early = 1;
});
host.on('meeting', on => { if (!on) stats.meetings++; });
host.on('key', () => {
  const d = new Date();
  if (d.getHours() < 4) stats.flags.night = 1;
  if (d.getDay() === 0 || d.getDay() === 6) stats.flags.weekend = 1;
});

/* ---------- Mehrere Bildschirme ---------- */
let nb = { left: false, right: false };
host.on('neighbors', n => { nb = n || { left: false, right: false }; });
host.on('arrive', d => {
  N.awayT = 0;
  if (d && d.drop) {                                 // per Ziehen auf diesen Bildschirm gebracht: an der Maus fallen lassen
    if (N.carry) { N.carry = null; nin.classList.remove('grab'); }
    N.x = clamp(d.drop.x, 12 * S, W - 12 * S); N.y = clamp(d.drop.y + TOP * S * .5, 26 * S, FLOOR);
    N.vx = 0; N.vy = 0; N.mode = 'air'; N.act = null; N.react = null; N.lift = 0;
    nin.style.visibility = 'visible';
    setTimeout(syncIgnore, 50);
    return;
  }
  const fl = surfaces()[0];
  const fromLeft = d && d.from === 'left';
  perch(fl, fromLeft ? -10 * S : W + 10 * S);
  N.mode = 'ground'; N.face = fromLeft ? 1 : -1; N.react = null;
  N.act = { name: 'wander', t: 0, target: fromLeft ? rand(W * .15, W * .4) : rand(W * .6, W * .85), pose: 'walk' };
  nin.style.visibility = 'visible';
  if (Math.random() < .5) setTimeout(() => chatter(pick(['Neuer Bildschirm,\nneues Glück!', 'Huhu! Ich bin\nmal rübergekommen.', 'Hier ist ja auch\nwas los.']), null, 2.4), 1500);
});

/* ---------- Sparmodus & Pause ---------- */
let eco = false, paused = false;
host.on('eco', on => { eco = !!on; });
host.on('pause', on => { paused = !!on; });

/* ---------- Willkommens-Tour ---------- */
const TOUR = [
  ['victory', 'Moin! Ich bin Sudo,\ndein Desktop-Ninja.'],
  ['thumb', 'Zieh mich irgendwohin\nund doppelklick –\ndann wohne ich da.'],
  ['type', 'Ich tippe mit,\nwenn du tippst.\nNur die Art der Taste!'],
  ['stretch', 'Ich erinnere dich\nan Pausen. Versprochen.'],
  ['throw', 'Strg+Alt+K: Werkzeuge\nStrg+Alt+N: Erinnerung'],
  ['victory', 'Viel Spaß!\nAlles Weitere im\nTray-Menü.']
];
host.on('tour', n => {
  const t = TOUR[n]; if (!t || N.mode !== 'ground') return;
  if (t[0] === 'type') startAct('type'); else if (t[0] === 'stretch') startAct('stretch');
  react(t[0] === 'type' || t[0] === 'stretch' ? 'stand' : t[0], t[1], 6, { prio: 2 });
  if (t[0] === 'type') N.react = null;
  if (n === TOUR.length - 1) { burst('confetti', N.x, N.y - 20 * S, 40); chime([523, 659, 784, 1047]); }
});

/* ---------- Start ---------- */
/* =====================================================================
   Besuche (1.4): Ein Sudo von Kollegen kommt vorbei, hinterlässt etwas oder fordert zum Duell
   ===================================================================== */
const gcv = $('#guest'), gctx = gcv.getContext('2d'), gtag = $('#gtag'), gbub = $('#gbubble');
let G = null;                       // aktueller Gast
const visitQueue = [];
const VL = L.visit || {};
const KEEP_KEY = 'sudo-keep-v1';
const fillV = (t, c) => String(T(t)).replace(/\{(\w+)\}/g, (_, k) => (c[k] ?? ''));
function gsay(text, dur = 2.6) {
  if (!G) return;
  gbub.textContent = text; gbub.hidden = false; G.bubUntil = now + dur * 1000;
}
// Besuch kommt an – aber nicht mitten im Meeting, Spiel oder während Sudo getragen wird
const seenVisits = new Set();
host.on('visit', v => {
  if (!v || !v.kind) return;
  if (v.visit && seenVisits.has(v.visit)) return;     // gleicher Besuch doppelt zugestellt
  if (v.visit) seenVisits.add(v.visit);
  visitQueue.push(v);
});
setInterval(() => {
  if (G || !visitQueue.length || inMeeting || game || asking || N.mode !== 'ground' || paused) return;
  startGuest(visitQueue.shift());
}, 1500);
function startGuest(v) {
  const side = N.x > W / 2 ? -1 : 1;
  const fl = surfaces()[0];
  // Gast landet auf der Taskleiste, möglichst neben Sudo
  const gx = clamp(N.surf === 'floor' ? N.x + side * 150 * (S / 3) : W * (side > 0 ? .3 : .7), 60, W - 60);
  guestOn = true;
  G = { v, x: gx, y: fl.top, face: -side, pose: 'stand', frame: 0, tf: 0, t: 0, stage: 'arrive', color: v.color || '#eef1f5', bubUntil: 0, lift: 0, hp: 3 };
  poofAt(G.x, G.y - 12 * S);
  beep(300, .1, 'sawtooth', .025);
  gtag.textContent = fillV(VL.tag || 'Sudo von {from}', v);
  gtag.hidden = false; gcv.hidden = false;
  if (N.act && N.act.name === 'sleep') startAct('idle', { dur: 1 });
}
function endGuest(result) {
  if (!G) return;
  poofAt(G.x, G.y - 12 * S);
  if (G.v.visit) host.visitDone(G.v.visit, result || 'done');
  G = null; guestOn = false; gtag.hidden = true; gbub.hidden = true; gcv.hidden = true;
}
// Mitbringsel: bleiben liegen, bis man sie anklickt (überleben auch einen Neustart)
function loadKeep() { try { return JSON.parse(localStorage.getItem(KEEP_KEY) || '[]'); } catch { return []; } }
function saveKeep(list) { try { localStorage.setItem(KEEP_KEY, JSON.stringify(list.slice(-6))); } catch { /* egal */ } }
const ICONS = {
  coffee: ['..WWW..', '.W.W.W.', '.......', 'KKKKKKK.', 'KWWWWWKKK', 'KWWWWWK.K', 'KWWWWWKKK', '.KWWWK...', '..KKK....'],
  duck:   ['...YYY...', '..YYYYY..', '..YKYYYOO', '..YYYYY..', 'YYYYYYYY.', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..'],
  pizza:  ['OOOOOOOOO', 'OYYRYYRYO', '.YYYYYYY.', '.YRYYYRY.', '..YYYYY..', '..YYRYY..', '...YYY...', '....Y....']
};
const IPAL = { W: '#eef1f5', K: '#1a1420', Y: '#f4d03f', O: '#e08a2e', R: '#e5484d' };
function iconCanvas(kind) {
  const rows = ICONS[kind], c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const x = c.getContext('2d');
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (IPAL[ch]) { x.fillStyle = IPAL[ch]; x.fillRect(i, j, 1, 1); } }));
  return c;
}
function renderKeep() {
  document.querySelectorAll('.keep').forEach(e => e.remove());
  const list = loadKeep();
  let notes = 0;
  list.forEach((k, i) => {
    const d = document.createElement('div');
    d.className = 'keep ' + (k.kind === 'note' ? 'postit' : 'gift');
    if (k.kind === 'note') {
      d.style.right = (24 + (notes % 3) * 18) + 'px'; d.style.top = (70 + notes * 74) + 'px'; d.style.transform = `rotate(${(notes % 2 ? 2 : -2)}deg)`; notes++;
      const t = document.createElement('div'); t.textContent = k.note;
      const f = document.createElement('small'); f.textContent = '– ' + k.from;
      d.append(t, f);
    } else {
      const c = iconCanvas(k.kind); c.style.width = c.width * S * .9 + 'px'; c.style.height = c.height * S * .9 + 'px';
      d.append(c);
      d.style.left = Math.round(clamp(k.x * W, 30, W - 60)) + 'px'; d.style.top = Math.round(FLOOR - c.height * S * .9) + 'px';
    }
    d.title = fillV(VL.keepTip || 'Von {from} – Klick zum Wegräumen', k);
    d.addEventListener('click', () => {
      if (k.kind === 'duck') { beep(880, .07, 'square', .04); beep(660, .09, 'square', .04, .08); }
      const l = loadKeep(); l.splice(i, 1); saveKeep(l); renderKeep();
      if (k.kind !== 'note' && N.mode === 'ground') react('thumb', pick(VL.keepThanks || ['Danke!']), 1.6, { prio: 1 });
    });
    document.body.append(d);
  });
}
function leaveKeep(kind, note) {
  const l = loadKeep();
  l.push({ kind, note, from: G.v.from, x: G.x / W, t: Date.now() });
  saveKeep(l); renderKeep();
}
// Duell: Ablauf ist vorab festgelegt (Zufall + etwas Rang-Bonus), damit beide Seiten eine schöne Show sehen
function duelPlan() {
  const myRank = curRank, gRank = Number(G.v.rank) || 0;
  const pHost = clamp(.5 + (myRank - gRank) * .05, .3, .7);
  const hostWins = Math.random() < pHost;
  // 5 Würfe abwechselnd, der Gewinner trifft zuletzt; Verlierer verliert 3 „Leben“
  const seq = [];
  let hostFirst = Math.random() < .5;
  for (let i = 0; i < 5; i++) {
    const thrower = (i % 2 === 0) === hostFirst ? 'host' : 'guest';
    seq.push({ thrower, hit: false });
  }
  const winnerThrows = seq.filter(x => x.thrower === (hostWins ? 'host' : 'guest'));
  while (winnerThrows.length < 3) { const t = { thrower: hostWins ? 'host' : 'guest', hit: false }; seq.push(t); winnerThrows.push(t); }
  winnerThrows.slice(-3).forEach(x => { x.hit = true; });
  return { hostWins, seq, i: 0, wait: 1.2, star: null, hostHp: 3, guestHp: 3 };
}
function guestTick(dt) {
  if (!G) return;
  G.t += dt; G.tf += dt * 6;
  if (gbub && !gbub.hidden && now > G.bubUntil) gbub.hidden = true;
  const v = G.v, t = G.t;
  switch (G.stage) {
    case 'arrive':
      G.pose = 'victory';
      if (t > .3 && !G.greeted) { G.greeted = true; gsay(fillV(pick(VL.hello || ['Moin! Grüße von {from}!']), v), 2.6); }
      if (t > 1.6 && N.mode === 'ground' && !(N.react && N.react.prio >= 2 && now < N.react.until)) { react('victory', pick(VL.welcome || ['Oh, Besuch!']), 1.8, { prio: 1 }); }
      if (t > 2.6) { G.stage = v.kind; G.t = 0; }
      break;
    case 'note':
      G.pose = 'type';
      if (t > .4 && !G.done) { G.done = true; leaveKeep('note', v.note); gsay(T(pick(VL.note || ['Hab dir was hingeklebt!'])), 2.4); beep(520, .05, 'square', .03); }
      if (t > 3) { G.stage = 'leave'; G.t = 0; }
      break;
    case 'coffee': case 'duck': case 'pizza':
      G.pose = t < 1.2 ? 'crouch' : 'thumb';
      if (t > 1 && !G.done) { G.done = true; leaveKeep(v.kind); gsay(T(pick((VL.gift || {})[v.kind] || ['Für dich!'])), 2.4); chime([660, 880]); }
      if (t > 3.2) { G.stage = 'leave'; G.t = 0; }
      break;
    case 'confetti':
      G.pose = Math.floor(t * 3) % 2 ? 'victory' : 'stand';
      if (!G.done) { G.done = true; burst('confetti', G.x, G.y - 20 * S, 60); burst('confetti', N.x, N.y - 20 * S, 40); chime([523, 659, 784, 1047]); gsay(T(pick(VL.party || ['Party!'])), 2.2); if (N.mode === 'ground') react('victory', pick(VL.partyHost || ['Juhu!']), 2, { prio: 1 }); }
      if (t > 3) { G.stage = 'leave'; G.t = 0; }
      break;
    case 'bug':
      G.pose = t < 1 ? 'throw' : 'thumb';
      if (!G.done && t > .6) { G.done = true; for (let i = 0; i < 3; i++) spawnBug(); gsay(T(pick(VL.bug || ['Viel Spaß beim Jagen! Hehe.'])), 2.4); }
      if (t > 2.6) { G.stage = 'leave'; G.t = 0; }
      break;
    case 'duel': duelTick(dt); break;
    case 'leave':
      G.pose = 'victory';
      if (!G.bye) { G.bye = true; gsay(T(pick(VL.bye || ['Tschüss!'])), 1.4); }
      if (t > 1.4) endGuest(G.result);
      break;
  }
}
function duelTick(dt) {
  const v = G.v;
  if (!G.duel) {
    // Sudo kommt auf die Taskleiste und stellt sich dem Gast gegenüber
    G.duel = duelPlan();
    const fl = surfaces()[0];
    if (N.surf !== 'floor' || N.mode !== 'ground') { poofAt(N.x, N.y - 12 * S); perch(fl, G.x + (G.x > W / 2 ? -1 : 1) * 160 * (S / 3)); poofAt(N.x, N.y - 12 * S); }
    else N.x = clamp(G.x + (N.x >= G.x ? 1 : -1) * 160 * (S / 3), 40, W - 40);
    N.face = G.x > N.x ? 1 : -1; G.face = -N.face;
    N.act = { name: 'duel', t: 0, pose: 'stand' };
    gsay(fillV(pick(VL.duelStart || ['Duell! Zieh dein Katana, {host}!']), { host: 'Sudo' }), 2);
    beep(220, .2, 'sawtooth', .03);
  }
  const D = G.duel;
  N.act = { name: 'duel', t: 0, pose: N.act && N.act.pose || 'stand' };
  N.face = G.x > N.x ? 1 : -1; G.face = -N.face;
  if (D.star) {
    const st = D.star;
    st.x += st.vx * dt; st.rot += dt * 24;
    const tx = st.thrower === 'host' ? G.x : N.x;
    if ((st.vx > 0 && st.x >= tx) || (st.vx < 0 && st.x <= tx)) {
      if (st.hit) {
        if (st.thrower === 'host') { D.guestHp--; G.pose = 'facepalm'; poofAt(G.x, G.y - 12 * S, true); }
        else { D.hostHp--; N.act.pose = 'facepalm'; poofAt(N.x, N.y - 12 * S, true); }
        beep(160, .12, 'square', .04);
      } else {
        // Ausweichen: kleiner Sprung
        if (st.thrower === 'host') G.lift = 14 * S; else N.lift = 14 * S;
        beep(900, .05, 'triangle', .03);
      }
      D.star = null; D.wait = .9;
    }
  } else if ((D.wait -= dt) <= 0) {
    if (D.i < D.seq.length) {
      N.act.pose = 'stand'; G.pose = 'stand';
      const step = D.seq[D.i++];
      const fromX = step.thrower === 'host' ? N.x : G.x, dir = step.thrower === 'host' ? N.face : G.face;
      D.star = { ...step, x: fromX + dir * 9 * S, y: (step.thrower === 'host' ? N.y : G.y) - 9 * S, vx: dir * 520, rot: 0 };
      if (step.thrower === 'host') N.act.pose = 'throw'; else G.pose = 'throw';
      beep(1200, .04, 'triangle', .03);
    } else if (!G.over) {
      G.over = true;
      G.result = D.hostWins ? 'host_won' : 'guest_won';
      if (D.hostWins) {
        G.pose = 'facepalm'; N.act.pose = 'victory';
        stats.duelsWon = (stats.duelsWon || 0) + 1; addXp(10); burst('confetti', N.x, N.y - 20 * S, 40); chime([523, 659, 784, 1047]);
        react('victory', fillV(pick(VL.duelWon || ['Gewonnen! +10 XP']), v), 3, { prio: 1 });
        gsay(T(pick(VL.duelGuestLost || ['Argh! Revanche!'])), 2.4);
      } else {
        G.pose = 'victory'; N.act.pose = 'facepalm';
        react('facepalm', fillV(pick(VL.duelLost || ['Verloren … Nächstes Mal!']), v), 3, { prio: 1 });
        gsay(T(pick(VL.duelGuestWon || ['Ninja-Sieg!'])), 2.4);
      }
      stats.duels = (stats.duels || 0) + 1; saveStats();
      log('Duell gegen ' + v.from + ': ' + G.result);
      D.wait = 3;
    } else { N.act = null; nextAct(); G.stage = 'leave'; G.t = 0; }
  }
  G.lift = Math.max(0, G.lift - dt * 60 * S); N.lift = Math.max(0, N.lift - dt * 60 * S);
  if (D.star) { const st = D.star; shurikensDuel = st; } else shurikensDuel = null;
}
let shurikensDuel = null;
function renderGuest() {
  if (!G) return;
  gsprite.draw(G.pose, Math.floor(G.tf / 1.5), Math.floor(G.tf / 1.5), G.color, G.pose === 'facepalm' ? 'closed' : 'open', {});
  const w = Math.round(24 * S * DPR), h = Math.round(FH * S * DPR);
  if (gcv.width !== w || gcv.height !== h) { gcv.width = w; gcv.height = h; gcv.style.width = 24 * S + 'px'; gcv.style.height = FH * S + 'px'; }
  gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, w, h); gctx.imageSmoothingEnabled = false;
  if (G.face < 0) { gctx.translate(w, 0); gctx.scale(-1, 1); }
  drawSprite(gctx, goff, w, h, G.color);
  const top = G.y - TOP * S - G.lift;
  gcv.style.transform = `translate(${Math.round(G.x - 12 * S)}px,${Math.round(top)}px)`;
  gtag.style.transform = `translate(${Math.round(G.x - gtag.offsetWidth / 2)}px,${Math.round(top - 18)}px)`;
  if (!gbub.hidden) {
    const bw = gbub.offsetWidth, bh = gbub.offsetHeight;
    gbub.style.transform = `translate(${Math.round(clamp(G.x - bw / 2, 8, W - bw - 8))}px,${Math.round(Math.max(6, top - bh - 26))}px)`;
  }
  if (shurikensDuel) {
    const k = shurikensDuel;
    fctx.save(); fctx.translate(k.x, k.y); fctx.rotate(k.rot);
    fctx.fillStyle = '#dfe7f1'; fctx.fillRect(-7, -1.5, 14, 3); fctx.fillRect(-1.5, -7, 3, 14);
    fctx.rotate(Math.PI / 4); fctx.fillStyle = '#9aa7b8'; fctx.fillRect(-4, -1.5, 8, 3); fctx.fillRect(-1.5, -4, 3, 8); fctx.restore();
  }
}
// Eigener Sudo geht auf Besuch: Rauchbombe, kurz weg, kommt zurück
host.on('visit_sent', d => {
  if (!d) return;
  stats.visitsSent = (stats.visitsSent || 0) + 1; saveStats();
  say(fillV(pick(VL.away || ['Bin mal kurz bei {to}!']), d), 2.2, undefined, 1);
  setTimeout(() => { if (N.mode === 'ground') { poof('center'); N.poofT = 7; } }, 1600);   // ein paar Sekunden „unterwegs“
});
host.on('visit_result', d => {
  if (!d) return;
  const won = d.result === 'guest_won';
  if (d.kind === 'duel') {
    if (won) { stats.duelsWon = (stats.duelsWon || 0) + 1; addXp(10); }
    stats.duels = (stats.duels || 0) + 1; saveStats();
    react(won ? 'victory' : 'facepalm', fillV(pick(won ? (VL.resultWon || ['Duell bei {to} gewonnen! +10 XP']) : (VL.resultLost || ['Duell bei {to} verloren. Revanche!'])), d), 4, { prio: 1 });
    if (won) burst('confetti', N.x, N.y - 20 * S, 30);
  } else react('thumb', fillV(pick(VL.resultDone || ['{to} hat sich gefreut!']), d), 3, { prio: 1 });
});
renderKeep();
window.addEventListener('resize', () => renderKeep());

resize();
perch(surfaces()[0], W * .62); N.face = -1;
startAct('idle', { dur: 2 });
saveStats();
setTimeout(() => say(greeting(), 3.5), 900);
if (settings.toy) setTimeout(() => giveBall(true), 1500);
setTimeout(() => { if (home && !atHome() && homeTarget() && N.mode === 'ground') poof('home'); }, 2500);
if (init.test) {
  // Test-Haken: Sudo hängt an der Maus und wird über die Kante gezogen (prüft den Monitorwechsel)
  window.__sudoTest = { carryOut: () => { N.carry = { ox: 0, oy: 0, sx: 0, sy: 0, hist: [], prev: {}, moved: true }; N.mode = 'carried'; host.dragOut(2200, 550); return N.mode; }, state: () => ({ x: Math.round(N.x), y: Math.round(N.y), mode: N.mode, W, H }),
    act: n => { startAct(n); return N.act && N.act.name; }, gust: () => { gustAt = 0; return dayEv.fx; } };
  setTimeout(() => { spawnBug(); bugs.forEach(b => { b.x = W * .3; b.y = FLOOR - 200; b.enter = 0; b.sp = 0; }); }, 300);
  setTimeout(() => { console.log('test: plattformen=' + platforms.length); const s = platforms[0]; if (s) jumpTo(s, s.left + 140); }, 1000);
}
setInterval(saveStats, 30000);
window.addEventListener('beforeunload', saveStats);
host.on('save-now', saveStats);
let last = performance.now();
function loop(t) {
  if (paused) { last = t; setTimeout(() => requestAnimationFrame(loop), 500); return; }
  // Im Sparmodus nur ca. 24 Bilder pro Sekunde
  if (eco && t - last < 40) { requestAnimationFrame(loop); return; }
  // 1.9: Ruhige Phasen (nichts fliegt, Sudo steht/sitzt) mit ca. 30 statt 60 Bildern pro Sekunde
  // Schlafen: 15 Bilder pro Sekunde genügen (die Z schweben langsam)
  if (t - last < 66 && N.act && N.act.name === 'sleep' && N.mode === 'ground' && !bugs.length && !ball && !game && !G) { requestAnimationFrame(loop); return; }
  if (!eco && t - last < 30 && fxWasEmpty && N.mode === 'ground' && !game && !G && (!N.act || N.act.name !== 'wander')) { requestAnimationFrame(loop); return; }
  const dt = Math.min(.08, (t - last) / 1000); last = t; now = t;
  // Ein Fehler in einem Bild darf die Schleife nicht beenden (sonst friert Sudo ein)
  try { update(dt); guestTick(dt); drawFx(); render(); renderGuest(); placeBubble(); deckTick(); }
  catch (e) { reportErr(`Bild: ${e.message}`); if (N.act && N.act.name !== 'idle') { try { startAct('idle', { dur: 1 }); } catch (e2) { /* weiter */ } } }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
