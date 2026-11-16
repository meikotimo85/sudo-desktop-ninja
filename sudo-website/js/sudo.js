// sudo.js – Info-Seite: Firmenangaben einsetzen, Uhr in der Taskleiste, und der echte Sudo, der auf der Taskleiste lebt.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };

  /* ---------- Angaben aus einstellungen.js ---------- */
  const cfg = window.SUDO_INFO || {};
  const safeUrl = u => { try { const x = new URL(u, location.href); return /^(https?|mailto|tel):$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  if (cfg.version) $('foot-version').textContent = 'Sudo ' + cfg.version;
  if (cfg.itName) $('help-text').textContent = 'Wende dich an ' + cfg.itName + '. Hilfreich ist ein Diagnose-Bericht: Einstellungen, „Info & Diagnose“, „Diagnose-Bericht kopieren“ – und in die Mail einfügen.';
  const contact = $('contact');
  const addContact = (label, href, text) => { const li = make('li'); const a = make('a', text); a.href = href; li.append(label + ' ', a); contact.append(li); };
  if (cfg.mail && /^[^\s@]+@[^\s@]+$/.test(cfg.mail)) addContact('E-Mail:', 'mailto:' + cfg.mail, cfg.mail);
  if (cfg.telefon) addContact('Telefon:', 'tel:' + cfg.telefon.replace(/[^\d+]/g, ''), cfg.telefon);
  if (cfg.portal && safeUrl(cfg.portal)) addContact('Ticket:', safeUrl(cfg.portal), new URL(safeUrl(cfg.portal)).host);
  contact.hidden = !contact.children.length;
  const legal = $('legal');
  for (const [k, label] of [['impressum', 'Impressum'], ['datenschutz', 'Datenschutz']]) {
    const u = cfg[k] && safeUrl(cfg[k]); if (!u) continue;
    const a = make('a', label); a.href = u; legal.append(a);
  }
  legal.hidden = !legal.children.length;
  if (cfg.firma) document.title = 'Sudo – der Desktop-Ninja bei ' + cfg.firma;

  /* ---------- Uhr in der Taskleiste ---------- */
  const clock = $('clock');
  const tick = () => { const d = new Date(); clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); clock.dateTime = d.toISOString(); };
  tick(); setInterval(tick, 15000);

  /* ---------- Sudo auf der Taskleiste ---------- */
  const desk = $('desk'), cv = $('stage'), ctx = cv.getContext('2d'), poke = $('poke'), speech = $('speech');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TASKBAR = 52;
  const LINES = ['Hehe.', 'Root-Rechte\nerhalten!', 'Ping erhalten.\nPong!', 'Danke, Admin!', 'Strg+S nicht\nvergessen.', 'Hast du heute schon\nwas getrunken?', 'Ich hab nur\nkompiliert.', 'Keine Bugs in Sicht.'];
  const img = new Image();
  let F = null, W = 0, H = 0, S = 3, DPR = 1, visible = true, last = 0, lineIx = 0;
  const N = { x: 0, face: 1, mode: 'idle', t: 0, dur: 2, target: 0, frame: 0, hop: 0, sleepy: 0 };
  const hearts = [];

  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = desk.clientWidth; H = desk.clientHeight;
    S = W < 600 ? 2 : 3;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    if (!N.x) N.x = Math.round(W * (W < 600 ? .62 : .7));
    N.x = Math.min(Math.max(N.x, 40), W - 40);
  }
  const ground = () => H - TASKBAR;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function choose() {
    N.t = 0;
    if (still) { N.mode = 'idle'; N.dur = 9999; return; }
    const r = Math.random();
    if (r < .45) { N.mode = 'walk'; N.target = rand(60, W - 60); N.face = N.target > N.x ? 1 : -1; }
    else if (r < .62) { N.mode = 'type'; N.dur = rand(3, 5); }
    else if (r < .74) { N.mode = 'coffee'; N.dur = 3.2; }
    else if (r < .82) { N.mode = 'sus'; N.dur = 2; }
    else if (r < .88 && N.sleepy > 40) { N.mode = 'sleep'; N.dur = 7; }
    else { N.mode = 'idle'; N.dur = rand(2, 4.5); }
  }

  function frameIndex() {
    const fr = F.frames, t = N.t;
    switch (N.mode) {
      case 'walk': return fr.walk[Math.floor(t / .12) % fr.walk.length];
      case 'type': return fr.type[Math.floor(t / .16) % fr.type.length];
      case 'coffee': return fr.coffee[0];
      case 'sleep': return fr.sleep[0];
      case 'sus': return fr.sus[0];
      case 'happy': return N.hop > 0 ? fr.jump[0] : fr.victory[0];
      default: {
        // Stehen: Stirnband weht, ab und zu blinzeln
        if (!still && (t % 3.7) > 3.55) return fr.stand[2];
        return fr.stand[still ? 0 : Math.floor(t / .35) % 2];
      }
    }
  }

  function update(dt) {
    N.t += dt; N.sleepy += dt;
    if (N.hop > 0) N.hop = Math.max(0, N.hop - dt);
    if (N.mode === 'walk') {
      const step = 70 * (S / 3) * dt;
      if (Math.abs(N.target - N.x) <= step) { N.x = N.target; choose(); }
      else N.x += N.face * step;
    } else if (N.t > N.dur) choose();
    for (const h of hearts) { h.y -= 34 * dt; h.x += h.vx * dt; h.life -= dt; }
    while (hearts.length && hearts[0].life <= 0) hearts.shift();
  }

  function heart(x, y, s) {
    const p = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
    ctx.fillStyle = '#e5484d';
    p.forEach((r, j) => [...r].forEach((c, i) => { if (c === 'X') ctx.fillRect(x + i * s, y + j * s, s, s); }));
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    const fw = F.w, fh = F.h, i = frameIndex();
    const dw = fw * S, dh = fh * S;
    const lift = N.hop > 0 ? Math.sin((1 - N.hop / .45) * Math.PI) * 26 : 0;
    const x = Math.round(N.x - dw / 2), y = Math.round(ground() - dh - lift);
    ctx.save();
    if (N.face < 0) { ctx.translate(x + dw, y); ctx.scale(-1, 1); ctx.drawImage(img, i * fw, 0, fw, fh, 0, 0, dw, dh); }
    else ctx.drawImage(img, i * fw, 0, fw, fh, x, y, dw, dh);
    ctx.restore();
    for (const h of hearts) { ctx.globalAlpha = Math.max(0, Math.min(1, h.life)); heart(Math.round(h.x), Math.round(h.y), 2); }
    ctx.globalAlpha = 1;
    // Klickfläche und Sprechblase folgen Sudo
    const top = ground() - 50 * S;
    poke.style.transform = `translate(${Math.round(N.x - 13 * S)}px, ${Math.round(top)}px)`;
    poke.style.width = 26 * S + 'px'; poke.style.height = 50 * S + 'px';
    if (!speech.hidden) {
      const bw = speech.offsetWidth, bh = speech.offsetHeight;
      const bx = Math.min(Math.max(N.x - bw / 2, 8), W - bw - 8);
      speech.style.transform = `translate(${Math.round(bx)}px, ${Math.round(Math.max(6, top - bh - 14 - lift))}px)`;
      speech.style.setProperty('--tail', Math.min(Math.max(N.x - bx, 18), bw - 18) + 'px');
    }
  }

  let speechTimer = 0;
  function say(text, ms) {
    speech.textContent = text; speech.hidden = false;
    clearTimeout(speechTimer); speechTimer = setTimeout(() => { speech.hidden = true; }, ms || 2600);
    if (still) draw();
  }

  function onPoke() {
    N.sleepy = 0;
    say(LINES[lineIx++ % LINES.length]);
    if (still) return;
    N.mode = 'happy'; N.t = 0; N.dur = 1.3; N.hop = .45;
    for (let k = 0; k < 4; k++) hearts.push({ x: N.x + rand(-28, 18), y: ground() - 48 * S + rand(-6, 10), vx: rand(-12, 12), life: 1.2 + k * .08 });
    draw();
  }

  function loop(ts) {
    const dt = Math.min(.05, (ts - (last || ts)) / 1000); last = ts;
    if (visible) { update(dt); draw(); }
    requestAnimationFrame(loop);
  }

  img.onload = async () => {
    try { F = await (await fetch('img/sudo-strip.json')).json(); } catch { F = { w: 48, h: 64, frames: { stand: [0, 1, 2], walk: [3, 4, 5, 6], victory: [7], thumb: [8], type: [9, 10], coffee: [11], sleep: [12], sus: [13], jump: [14] } }; }
    size(); choose();
    poke.addEventListener('click', onPoke);
    window.addEventListener('resize', () => { size(); draw(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(e => { visible = e[0].isIntersecting; }).observe(desk);
    setTimeout(() => say('Hallo! Ich bin Sudo.', 3400), 900);
    if (still) draw(); else requestAnimationFrame(loop);
  };
  img.src = 'img/sudo-strip.png';
})();
