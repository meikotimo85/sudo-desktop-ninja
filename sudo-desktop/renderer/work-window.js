// work-window.js – Einstellungen für Arbeitstag und Pausen
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];
  const { work, special } = await window.workHost.get();
  const sp = special || {};
  document.getElementById('bday').value = sp.birthday || '';
  document.getElementById('jub').value = sp.jubilee || '';
  document.getElementById('seasonal').checked = sp.seasonal !== false;

  $('enabled').checked = work.enabled;
  $('days').replaceChildren(...DAYS.map(([d, l]) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = d; cb.checked = work.days.includes(d);
    lab.append(cb, l); return lab;
  }));
  $('targetOn').checked = work.target.on; $('targetH').value = work.target.hours;
  for (const k of ['stand', 'eyes', 'water']) { $(k + 'On').checked = work[k].on; $(k + 'M').value = work[k].every; }
  $('screenTime').checked = work.screenTime;

  function breakRow(b = { time: '12:00', min: 30, label: 'Pause' }) {
    const row = document.createElement('div'); row.className = 'brk';
    row.innerHTML = '<input type="time" class="t" required><input type="number" class="min" min="5" max="120"><span class="hint" style="color:var(--muted)">Min.</span><input type="text" class="l" maxlength="30"><button class="x" title="Entfernen">✕</button>';
    row.querySelector('.t').value = b.time; row.querySelector('.min').value = b.min; row.querySelector('.l').value = b.label;
    row.querySelector('.x').addEventListener('click', () => row.remove());
    $('breaks').appendChild(row);
  }
  work.breaks.forEach(breakRow);
  $('addBreak').addEventListener('click', () => breakRow({ time: '09:30', min: 15, label: 'Frühstückspause' }));

  $('save').addEventListener('click', async () => {
    const w = {
      enabled: $('enabled').checked,
      days: [...$('days').querySelectorAll('input:checked')].map(i => Number(i.value)),
      target: { on: $('targetOn').checked, hours: Number($('targetH').value) },
      stand: { on: $('standOn').checked, every: Number($('standM').value) },
      eyes: { on: $('eyesOn').checked, every: Number($('eyesM').value) },
      water: { on: $('waterOn').checked, every: Number($('waterM').value) },
      screenTime: $('screenTime').checked,
      special: { birthday: $('bday').value.trim(), jubilee: $('jub').value.trim(), seasonal: $('seasonal').checked },
      breaks: [...$('breaks').children].map(r => ({ time: r.querySelector('.t').value, min: Number(r.querySelector('.min').value), label: r.querySelector('.l').value.trim() || 'Pause' }))
    };
    const r = await window.workHost.save(w);
    $('msg').textContent = r.msg;
    setTimeout(() => { $('msg').textContent = ''; }, 3000);
  });
})();
