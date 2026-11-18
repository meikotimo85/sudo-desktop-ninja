// skinstore-window.js – Skin-Store (1.14): Vorschau, mit XP kaufen, anziehen, .sudoskin-Dateien hinzufügen
(async () => {
  'use strict';
  const host = window.storeHost;
  const $ = id => document.getElementById(id);
  const tr = x => (window.I18N ? I18N.t(x) : x);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'text') e.textContent = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && c !== false && e.append(c));
    return e;
  };
  const say = (t, bad) => { $('msg').textContent = t || ''; $('msg').className = bad ? 'bad' : ''; };
  const sheets = new Map();          // Vorschau je Skin nur einmal laden
  let data = null, focus = null;

  async function paint(canvas, key, belt) {
    let sh = sheets.get(key);
    if (!sh) {
      const p = await host.preview(key);
      if (!p) return;
      sh = await SudoSheet.load(p.png, p.meta);
      sheets.set(key, sh);
    }
    const off = document.createElement('canvas'); off.width = sh.W; off.height = sh.H;
    sh.create(off.getContext('2d')).draw('stand', 0, 0, belt, 'open', {});
    const c = canvas.getContext('2d'), scale = 2;
    c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(off, Math.round((canvas.width - sh.W * scale) / 2), canvas.height - sh.H * scale - 4, sh.W * scale, sh.H * scale);
  }

  function card(s) {
    const cv = el('canvas', { width: 96, height: 104 });
    const isOn = data.current === 'store:' + s.key;
    const btn = el('button', { type: 'button' });
    if (isOn) { btn.textContent = tr('Angezogen'); btn.disabled = true; }
    else if (s.owned) { btn.className = 'wear'; btn.textContent = tr('Anziehen'); btn.addEventListener('click', () => wear(s)); }
    else if (data.xp >= s.price) {
      btn.className = 'buy'; btn.textContent = tr('Kaufen');
      // Zweimal klicken: erst nachfragen, dann kaufen
      let armed = 0;
      btn.addEventListener('click', async () => {
        if (!armed) { armed = setTimeout(() => { armed = 0; btn.className = 'buy'; btn.textContent = tr('Kaufen'); }, 3500); btn.className = 'sure'; btn.textContent = tr('Wirklich? −{x} XP').replace('{x}', s.price); return; }
        clearTimeout(armed); btn.disabled = true;
        const r = await host.buy(s.key);
        if (!r.ok) { say(tr(r.msg), true); btn.disabled = false; return; }
        say(tr('„{x}“ gehört jetzt dir.').replace('{x}', s.name));
        await reload();
      });
    } else { btn.textContent = tr('Noch {x} XP').replace('{x}', s.price - data.xp); btn.disabled = true; }
    const tag = s.source === 'zentrale' ? el('span', { class: 'tag it', text: 'Von deiner IT' }) : s.source === 'datei' ? el('span', { class: 'tag', text: 'Eigene Datei' }) : null;
    const price = s.price === 0 ? el('span', { class: 'price free', text: tr(data.free && s.source !== 'datei' ? 'Freigeschaltet' : 'Kostenlos') })
      : el('span', { class: 'price', text: s.owned ? tr('Gekauft') : `${s.price} XP` });
    const c = el('div', { class: 'card' + (isOn ? ' wearing' : ''), 'data-key': s.key }, tag, cv, el('b', { 'data-noi18n': '', text: s.name }), price, btn);
    paint(cv, s.key, data.belt || '#eef1f5');
    return c;
  }
  async function wear(s) {
    const r = await host.wear(s.key);
    if (!r.ok) return say(tr(r.msg || 'Das hat nicht geklappt.'), true);
    say(tr('Sudo trägt jetzt „{x}“.').replace('{x}', s.name));
    await reload();
  }

  function render() {
    $('xp').textContent = `${data.xp} XP`;
    $('free').hidden = !data.free;
    const groups = [['zentrale', 'Von deiner IT'], ['bundled', 'Mitgeliefert'], ['datei', 'Eigene Skin-Dateien']];
    const main = $('main');
    main.replaceChildren(...groups.map(([src, title]) => {
      const list = data.catalog.filter(s => s.source === src);
      return list.length ? [el('h2', { text: title }), el('div', { class: 'grid' }, list.map(card))] : [];
    }).flat());
    if (!data.catalog.length) main.append(el('p', { class: 'lead', text: 'Noch keine Skins im Store.' }));
    if (focus) {
      const c = document.querySelector(`.card[data-key="${CSS.escape(focus)}"]`);
      if (c) { c.scrollIntoView({ block: 'center' }); c.classList.add('focus'); }
      focus = null;
    }
  }
  async function reload() { data = await host.get(); render(); }

  $('import').addEventListener('click', async () => { const r = await host.importFile(); if (r && r.msg) say(tr(r.msg), r.ok === false); if (r && r.ok) await reload(); });
  $('folder').addEventListener('click', () => host.folder());
  host.onFocus(async key => { focus = key; await reload(); });
  host.onChanged(reload);
  data = await host.get();
  focus = data.focus || null;
  render();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
