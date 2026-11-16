// tour-window.js – Willkommens-Tour in 6 Schritten; Sudo zeigt parallel auf dem Desktop, was gemeint ist
(async () => {
  'use strict';
  const host = window.tourHost;
  const cfg = await host.get();
  let opts = { autostart: true, size: cfg.size || 'normal' };   // Autostart ist in der Tour vorausgewählt
  let i = 0;
  const tr = s => (window.I18N ? I18N.t(s) : s);
  const K = (a, ok) => ok ? `<kbd>${a}</kbd>` : `<kbd>${a}</kbd> ${tr('(belegt – im Tray-Menü)')}`;
  // Seiten sind ganze HTML-Absätze; übersetzt wird jeweils der komplette Absatz (Wörterbuch-Schlüssel = deutsches HTML)
  const SHORTCUTS = '<p>{quick} – Erinnerung oder Notiz, z. B. <kbd>20m Kunde anrufen</kbd></p><p>{tools} – Werkzeugkasten: Passwort, GUID, Subnetz, Zeitstempel, JWT …</p><p>Alles andere findest du per Rechtsklick auf meinen Kopf unten rechts im Tray.</p>';
  const PAGES = [
    { t: 'Moin! Ich bin Sudo.', h: '<p>Ich bin dein Desktop-Ninja. Ich wohne auf deiner Taskleiste und deinen Fenstern, tippe mit, erinnere dich an Pausen und melde mich, wenn in der IT etwas brennt.</p><p>Schau mal auf deinen Bildschirm – ich winke dir gerade zu.</p>' },
    { t: 'Mein Zuhause', h: '<p><b>Zieh mich</b> mit der Maus, wohin du willst, und <b>doppelklick</b> mich. Dann wohne ich dort, zum Beispiel auf Outlook oder der Taskleiste.</p><p>Einfach anklicken heißt Streicheln. Kräftig werfen geht auch.</p>' },
    { t: 'Ich tippe mit', h: '<p>Wenn du tippst, tippe ich am Laptop mit. Ich erfahre dabei nur die <b>Art</b> der Taste, niemals den Inhalt. Nichts wird gespeichert oder verschickt.</p><p>Strg+S, Backspace-Spam oder Copy &amp; Paste quittiere ich trotzdem gern.</p>' },
    { t: 'Gesund durch den Tag', h: '<p>Ich merke, wann du anfängst, erinnere dich an <b>feste Pausen</b>, ans <b>Aufstehen</b> und an <b>Augenpausen</b>. In Meetings bin ich still, und bei Bildschirmfreigaben unsichtbar.</p><p>Einstellen unter <i>Arbeitstag &amp; Pausen</i> im Tray-Menü.</p>' },
    { t: 'Deine Abkürzungen', h: () => window.I18N ? I18N.tf(SHORTCUTS, { quick: K(tr('Strg+Alt+N'), cfg.shortcuts.quick), tools: K(tr('Strg+Alt+K'), cfg.shortcuts.tools) }) : SHORTCUTS.replace('{quick}', K(tr('Strg+Alt+N'), cfg.shortcuts.quick)).replace('{tools}', K(tr('Strg+Alt+K'), cfg.shortcuts.tools)) },
    { t: 'Fast fertig!', h: '<div class="opts"><label class="opt"><input type="checkbox" id="auto"> Mit Windows starten</label><div class="opt">Größe:&nbsp;<div class="seg" id="size"><button data-v="klein">Klein</button><button data-v="normal">Normal</button><button data-v="gross">Groß</button></div></div></div><p style="margin-top:14px">Für gemeinsame Erfolge bekomme ich Geschenke – Hüte, Brillen, sogar einen Feuerwehrhelm. Los geht\'s!</p>' }
  ];
  const $ = id => document.getElementById(id);
  function render() {
    const p = PAGES[i];
    $('content').innerHTML = `<div class="step"></div><h1></h1><div data-noi18n>${typeof p.h === 'function' ? p.h() : tr(p.h)}</div>`;
    $('content').querySelector('.step').textContent = `Schritt ${i + 1} von ${PAGES.length}`;
    $('content').querySelector('h1').textContent = p.t;
    $('dots').innerHTML = PAGES.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('');
    $('back').hidden = i === 0;
    $('next').textContent = i === PAGES.length - 1 ? 'Los geht\'s!' : 'Weiter';   // wird automatisch übersetzt
    if (i === PAGES.length - 1) {
      $('auto').checked = !!opts.autostart;
      $('auto').addEventListener('change', e => { opts.autostart = e.target.checked; });
      const seg = $('size');
      const mark = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === opts.size));
      seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { opts.size = b.dataset.v; mark(); }));
      mark();
    }
    host.step(i);
    $('next').focus();
  }
  $('next').addEventListener('click', async () => {
    if (i < PAGES.length - 1) { i++; render(); return; }
    await host.finish(opts); window.close();
  });
  $('back').addEventListener('click', () => { if (i > 0) { i--; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { host.finish({}); window.close(); } });
  render();
})();
