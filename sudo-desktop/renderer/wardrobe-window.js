// wardrobe-window.js – Garderobe: Zubehör ansehen, anziehen, Fortschritt zum Freischalten
(async () => {
  'use strict';
  const host = window.wardrobeHost, PG = window.SudoProgress;
  const $ = id => document.getElementById(id);
  let { sheet, stats, outfit, special } = await host.get();
  stats = stats || { unlocked: [] };
  outfit = outfit || {};
  if (!sheet) { document.body.textContent = 'Sprite-Sheet nicht gefunden.'; return; }
  const sh = await SudoSheet.load(sheet.png, sheet.meta, sheet.accPng);
  const off = document.createElement('canvas'); off.width = sh.W; off.height = sh.H;
  const spr = sh.create(off.getContext('2d'));
  const belt = () => stats.rankColor || '#eef1f5';
  const ev = PG.today(new Date(), special || {});

  // focus: Zeile im Bild, die in die Mitte soll (Brillen und Halsteile werden herangezoomt)
  function paint(canvas, o, scale, focus) {
    spr.draw('stand', 0, 0, belt(), 'open', o);
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
    const w = sh.W * scale, h = sh.H * scale;
    const y = focus == null ? canvas.height - h - 6 : canvas.height / 2 - focus * scale;
    c.drawImage(off, Math.round((canvas.width - w) / 2), Math.round(y), w, h);
  }
  const margin = sh.H - sheet.meta.cell[1];
  const ZOOM = { hat: [1.5, null], face: [2.6, margin + 13], neck: [2.4, margin + 31] };

  function render() {
    const owned = id => (stats.unlocked || []).includes(id);
    paint($('big'), outfit, 3);
    const n = Object.keys(PG.ITEMS).filter(owned).length;
    $('count').textContent = `${n} von ${Object.keys(PG.ITEMS).length} Teilen freigeschaltet`;
    const tr = x => (window.I18N ? I18N.t(x) : x);
    const auto = [ev.hat, ev.neck].filter(Boolean).map(id => tr(PG.ITEMS[id] ? PG.ITEMS[id].name : id));
    $('event').textContent = auto.length && special && special.seasonal !== false ? `Heute trägt Sudo automatisch: ${auto.join(' + ')}` : '';
    for (const slot of PG.SLOTS || ['hat', 'face']) {
      const cards = [];
      // "Nichts"-Karte
      const none = document.createElement('button'); none.className = 'item'; none.setAttribute('aria-pressed', !outfit[slot]);
      none.innerHTML = '<span class="none">∅</span><b>Ohne</b><small>Klassischer Ninja</small>';
      none.addEventListener('click', () => set(slot, null));
      cards.push(none);
      for (const [id, it] of Object.entries(PG.ITEMS)) {
        if (it.slot !== slot) continue;
        const has = owned(id);
        const b = document.createElement('button'); b.className = 'item' + (has ? '' : ' locked');
        b.setAttribute('aria-pressed', outfit[slot] === id);
        const cv = document.createElement('canvas'); cv.width = 72; cv.height = 88;
        paint(cv, { [slot]: id }, ...(ZOOM[slot] || [1.5, null]));
        const name = document.createElement('b'); name.textContent = has ? it.name : '???';
        const how = document.createElement('small'); how.textContent = has ? 'freigeschaltet' : it.how;
        b.append(cv, name, how);
        if (it.season) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Saison'; b.append(t); }
        if (!has && it.season) { b.disabled = true; }
        else if (!has) {
          const p = Math.max(0, Math.min(1, it.p(stats)));
          const bar = document.createElement('div'); bar.className = 'bar';
          bar.innerHTML = '<i></i>'; bar.firstChild.style.width = Math.round(p * 100) + '%';
          b.append(bar); b.disabled = true; b.title = `${Math.round(p * 100)} % geschafft`;
        } else b.addEventListener('click', () => set(slot, outfit[slot] === id ? null : id));
        cards.push(b);
      }
      $(slot).replaceChildren(...cards);
    }
  }
  async function set(slot, id) {
    outfit = await host.set({ ...outfit, [slot]: id });
    render();
  }
  host.onUpdate(d => { if (d.outfit) outfit = d.outfit; if (d.stats) stats = d.stats; render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
  render();
})();
