// stats.js – füllt das Statistik-Fenster und aktualisiert es live
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString(window.I18N ? I18N.locale : 'de-DE');

  function render(s) {
    if (!s) return;
    document.documentElement.style.setProperty('--belt', s.rankColor || '#eef1f5');
    $('rank').textContent = s.rank || '–';
    const xp = Number(s.xp) || 0, from = Number(s.rankXp) || 0, to = s.nextXp;
    $('xpbar').style.width = (to ? Math.min(100, ((xp - from) / (to - from)) * 100) : 100) + '%';
    $('xpnow').textContent = `${fmt(xp)} XP`;
    $('xpnext').textContent = to ? `noch ${fmt(to - xp)} XP bis ${s.nextRank}` : 'höchster Rang erreicht';
    if (Array.isArray(s.ranks)) {
      $('ranks').replaceChildren(...s.ranks.map(r => {
        const el = document.createElement('span');
        el.textContent = r.n; el.style.setProperty('--c', r.c);
        if (r.n === s.rank) el.className = 'on';
        return el;
      }));
    }
    for (const k of ['keysToday', 'keys', 'bugs', 'saves', 'best', 'alarms', 'pets']) $(k).textContent = fmt(s[k]);
    const min = Number(s.minutes) || 0;
    $('time').textContent = min < 60 ? `${fmt(min)} min` : `${(min / 60).toLocaleString(window.I18N ? I18N.locale : 'de-DE', { maximumFractionDigits: 1 })} h`;
    if (s.since) {
      const [y, m, d] = String(s.since).split('-');
      $('since').textContent = `Sudo ist seit dem ${d}.${m}.${y} bei dir.`;
    }
  }

  const data = await window.statsHost.get();
  if (data.icon) $('avatar').src = data.icon;
  if (data.stats) render(data.stats);
  else $('since').textContent = 'Noch keine Daten. Sudo meldet sich gleich.';
  window.statsHost.onUpdate(render);

  /* ---------- Reiter "Mein Tag" ---------- */
  const dur = sec => { const m = Math.round((Number(sec) || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  async function renderDay() {
    const d = await window.statsHost.summary();
    if (!d) return;
    $('dStart').textContent = d.start || 'noch nicht';
    $('dActive').textContent = dur(d.active);
    $('dEnd').textContent = d.end || '–';
    $('dBreak').textContent = d.nextBreak ? `${d.nextBreak.time} ${d.nextBreak.label}` : 'keine mehr';
    const max = Math.max(1, ...d.apps.map(a => a[1]));
    $('apps').replaceChildren(...(d.apps.length ? d.apps.map(([n, v]) => {
      const row = document.createElement('div'); row.className = 'app';
      row.innerHTML = '<span class="n"></span><span class="b"><i></i></span><span class="v"></span>';
      row.querySelector('.n').textContent = n; row.querySelector('i').style.width = (v / max * 100) + '%';
      row.querySelector('.v').textContent = dur(v); return row;
    }) : [Object.assign(document.createElement('p'), { className: 'empty', textContent: d.screenTime ? 'Heute noch nichts erfasst.' : 'Bildschirmzeit ist ausgeschaltet (Arbeitstag & Pausen).' })]));
    const wmax = Math.max(3600, ...d.week.map(x => x.active));
    $('week').replaceChildren(...d.week.map((x, i) => {
      const el = document.createElement('div'); if (i === 6) el.className = 'today';
      el.innerHTML = '<i></i><b></b><span></span>';
      el.querySelector('i').style.height = Math.max(2, x.active / wmax * 80) + 'px';
      el.querySelector('b').textContent = x.active ? (x.active / 3600).toLocaleString(window.I18N ? I18N.locale : 'de-DE', { maximumFractionDigits: 1 }) + ' h' : '–';
      el.querySelector('span').textContent = WD[x.wd]; return el;
    }));
  }
  let lastS = data.stats || null;
  window.statsHost.onUpdate(x => { lastS = x; if (!$('pageAch').hidden) renderAch(); });
  function renderAch() {
    const PG = window.SudoProgress; if (!PG) return;
    const got = (lastS && lastS.achievements) || {};
    const n = PG.ACHIEVEMENTS.filter(a => got[a.id]).length;
    $('achCount').textContent = `${n} von ${PG.ACHIEVEMENTS.length} Erfolgen · je +15 XP`;
    const sorted = [...PG.ACHIEVEMENTS].sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0));
    $('achs').replaceChildren(...sorted.map(a => {
      const el = document.createElement('div'); el.className = 'ach' + (got[a.id] ? ' on' : '');
      el.innerHTML = '<i></i><div><b></b><span></span></div><em></em>';
      el.querySelector('i').textContent = got[a.id] ? '★' : '·';
      el.querySelector('b').textContent = a.t; el.querySelector('span').textContent = a.d;
      if (got[a.id]) { const [y, m, d] = got[a.id].split('-'); el.querySelector('em').textContent = `${d}.${m}.${y}`; }
      return el;
    }));
  }
  function tab(which) {
    for (const [t, pg] of [['tabSudo', 'pageSudo'], ['tabDay', 'pageDay'], ['tabAch', 'pageAch']]) {
      $(t).setAttribute('aria-selected', t === which); $(pg).hidden = t !== which;
    }
    if (which === 'tabDay') renderDay();
    if (which === 'tabAch') renderAch();
  }
  $('tabSudo').addEventListener('click', () => tab('tabSudo'));
  $('tabDay').addEventListener('click', () => tab('tabDay'));
  $('tabAch').addEventListener('click', () => tab('tabAch'));
  setInterval(() => { if (!$('pageDay').hidden) renderDay(); }, 30000);
  $('clearBtn').addEventListener('click', () => {
    const box = $('clearBox');
    box.innerHTML = '<span>Wirklich alle Programmzeiten löschen?</span><button class="danger" id="yes">Löschen</button><button id="no">Abbrechen</button>';
    $('no').addEventListener('click', () => location.reload());
    $('yes').addEventListener('click', async () => { await window.statsHost.clearScreenTime(); location.reload(); });
  });
  if (location.hash === '#day') tab('tabDay');
  if (location.hash === '#ach') tab('tabAch');
})();
