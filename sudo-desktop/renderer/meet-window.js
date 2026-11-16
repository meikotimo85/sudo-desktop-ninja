// meet-window.js – 1.10: Meeting-Check. Mikrofon, Kamera, Lautsprecher und Verbindung in einer Minute prüfen.
// Bild und Ton bleiben in diesem Fenster: nichts wird aufgenommen, gespeichert oder verschickt.
(async () => {
  'use strict';
  const host = window.meetHost;
  const main = document.getElementById('main');
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
  const result = { mic: null, cam: null, spk: null, net: null };
  let stream = null, camStream = null, ctx = null, raf = 0;

  // Fehler von Windows/Chromium in Alltagssprache
  function why(e, what) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return { text: tr(what === 'cam' ? 'Windows lässt Desktop-Apps gerade nicht an die Kamera. In den Datenschutz-Einstellungen „Desktop-Apps den Zugriff erlauben“ einschalten.' : 'Windows lässt Desktop-Apps gerade nicht ans Mikrofon. In den Datenschutz-Einstellungen „Desktop-Apps den Zugriff erlauben“ einschalten.'), link: what === 'cam' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone' };
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return { text: tr(what === 'cam' ? 'Die Kamera wird gerade von einem anderen Programm benutzt (z. B. Teams im Anruf) – oder sie ist per Taste oder Schieber abgedeckt.' : 'Das Mikrofon wird gerade von einem anderen Programm blockiert – oder es ist per Taste am Headset abgeschaltet.') };
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return { text: tr(what === 'cam' ? 'Keine Kamera gefunden. Ist sie angeschlossen und der Schieber vor der Linse offen?' : 'Kein Mikrofon gefunden. Headset eingesteckt? Bei Bluetooth: verbunden?') };
    return { text: tr('Unerwarteter Fehler: {x}').replace('{x}', (e && (e.message || e.name)) || '?') };
  }
  const resBox = (cls, text, link, linkText) => el('div', { class: 'res ' + cls, role: 'status' }, el('div', { text }),
    link ? el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: tr(linkText || 'Einstellungen öffnen'), on: { click: () => host.open(link) } })) : null);
  const devSelect = (kind, label) => el('select', { class: 'inp', 'aria-label': tr(label) });
  async function fillDevices(sel, kind) {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind);
    const cur = sel.value;
    sel.replaceChildren(...list.map((d, i) => el('option', { value: d.deviceId, text: d.label || `${tr('Gerät')} ${i + 1}` })));
    if (cur && list.some(d => d.deviceId === cur)) sel.value = cur;
    sel.disabled = !list.length;
    return list.length;
  }
  const stopMic = () => { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  const stopCam = () => { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; };
  window.addEventListener('beforeunload', () => {
    stopMic(); stopCam();
    const vals = Object.values(result).filter(v => v !== null);
    if (vals.length) host.done(vals.every(Boolean));
  });

  /* ---------- Mikrofon ---------- */
  const micSel = devSelect('audioinput', 'Mikrofon'), meter = el('i'), micOut = el('div'), micState = el('span', { class: 'state' });
  async function testMic() {
    stopMic();
    micState.className = 'state busy';
    micOut.replaceChildren(el('div', { class: 'res info', text: tr('Sag etwas – zum Beispiel „Hallo, hört ihr mich?“') }));
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micSel.value ? { deviceId: { exact: micSel.value } } : true });
      await fillDevices(micSel, 'audioinput');
      const track = stream.getAudioTracks()[0];
      if (track && track.label && !micSel.value) { const o = [...micSel.options].find(x => x.text === track.label); if (o) micSel.value = o.value; }
      ctx = ctx || new AudioContext();
      const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const t0 = performance.now(); let peak = 0, heard = false;
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length), lvl = Math.min(1, rms * 9);
        peak = Math.max(peak, lvl); meter.style.width = Math.round(lvl * 100) + '%';
        if (!heard && peak > 0.18) {
          heard = true; result.mic = true; micState.className = 'state ok';
          micOut.replaceChildren(resBox('', tr('Du bist zu hören. Das Mikrofon „{x}“ funktioniert.').replace('{x}', (track && track.label) || tr('Standard'))));
        }
        if (!heard && performance.now() - t0 > 10000) {
          result.mic = false; micState.className = 'state warn';
          micOut.replaceChildren(resBox('warn', tr(peak > 0.04 ? 'Sehr leise. Ist das Mikrofon weit weg oder auf „leise“ gestellt? Bei Headsets: Mikrofonarm näher an den Mund.' : 'Nichts zu hören. Ist das Mikrofon stumm (Taste am Headset oder an der Tastatur)? Ist oben das richtige Gerät gewählt?'), 'ms-settings:sound', 'Toneinstellungen öffnen'));
          stopMic(); return;
        }
        if (heard && performance.now() - t0 > 4000) { setTimeout(stopMic, 1500); return; }
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      result.mic = false; micState.className = 'state bad';
      const w = why(e, 'mic'); micOut.replaceChildren(resBox('bad', w.text, w.link || 'ms-settings:sound', w.link ? 'Datenschutz-Einstellungen öffnen' : 'Toneinstellungen öffnen'));
    }
  }

  /* ---------- Kamera ---------- */
  const camSel = devSelect('videoinput', 'Kamera'), video = el('video', { autoplay: true, muted: true, playsinline: true, hidden: true }), camOut = el('div'), camState = el('span', { class: 'state' });
  async function testCam() {
    stopCam(); video.hidden = true;
    camState.className = 'state busy'; camOut.replaceChildren();
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: camSel.value ? { deviceId: { exact: camSel.value } } : true });
      await fillDevices(camSel, 'videoinput');
      video.srcObject = camStream; video.hidden = false;
      await new Promise(r => { video.onloadeddata = r; setTimeout(r, 3000); });
      // Schwarzes Bild? Dann ist meist der Schieber zu oder die Linse abgedeckt
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const g = c.getContext('2d'); g.drawImage(video, 0, 0, 64, 36);
      const px = g.getImageData(0, 0, 64, 36).data; let light = 0; for (let i = 0; i < px.length; i += 4) light += px[i] + px[i + 1] + px[i + 2];
      const avg = light / (px.length / 4) / 3;
      if (avg < 12) { result.cam = false; camState.className = 'state warn'; camOut.replaceChildren(resBox('warn', tr('Das Bild ist schwarz. Ist der Schieber vor der Kamera zu oder die Linse abgeklebt?'))); }
      else { result.cam = true; camState.className = 'state ok'; camOut.replaceChildren(resBox('', tr('Die Kamera funktioniert. Siehst du dich gut? Licht von vorn wirkt besser als ein Fenster im Rücken.'))); }
      setTimeout(() => { stopCam(); video.hidden = true; }, 12000);
    } catch (e) {
      result.cam = false; camState.className = 'state bad';
      const w = why(e, 'cam'); camOut.replaceChildren(resBox('bad', w.text, w.link, 'Datenschutz-Einstellungen öffnen'));
    }
  }

  /* ---------- Lautsprecher ---------- */
  const spkSel = devSelect('audiooutput', 'Lautsprecher'), spkOut = el('div'), spkState = el('span', { class: 'state' });
  const audio = new Audio();
  async function testSpeaker() {
    spkState.className = 'state busy';
    try {
      ctx = ctx || new AudioContext();
      const dest = ctx.createMediaStreamDestination(), t = ctx.currentTime;
      // Kleiner Pixel-Dreiklang
      [523, 659, 784].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * .18); g.gain.exponentialRampToValueAtTime(0.12, t + i * .18 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * .18 + .3);
        o.connect(g).connect(dest); o.start(t + i * .18); o.stop(t + i * .18 + .32); });
      audio.srcObject = dest.stream;
      if (spkSel.value && audio.setSinkId) await audio.setSinkId(spkSel.value);
      await audio.play();
      spkOut.replaceChildren(el('div', { class: 'res info' }, el('div', { text: tr('Hast du den Dreiklang gehört?') }),
        el('div', { class: 'acts' },
          el('button', { class: 'act primary', type: 'button', text: tr('Ja, gehört'), on: { click: () => { result.spk = true; spkState.className = 'state ok'; spkOut.replaceChildren(resBox('', tr('Lautsprecher passen.'))); } } }),
          el('button', { class: 'act', type: 'button', text: tr('Nein'), on: { click: () => { result.spk = false; spkState.className = 'state warn';
            spkOut.replaceChildren(resBox('warn', tr('Ist der Ton am PC oder am Headset leise oder stumm? Ist oben das richtige Gerät gewählt? Teams nutzt eigene Einstellungen: Einstellungen → Geräte.'), 'ms-settings:sound', 'Toneinstellungen öffnen')); } } }))));
    } catch (e) { result.spk = false; spkState.className = 'state bad'; spkOut.replaceChildren(resBox('bad', why(e, 'spk').text, 'ms-settings:sound', 'Toneinstellungen öffnen')); }
  }

  /* ---------- Verbindung ---------- */
  const netOut = el('div'), netState = el('span', { class: 'state' });
  async function testNet() {
    netState.className = 'state busy'; netOut.replaceChildren(el('div', { class: 'res info', text: tr('Messe die Verbindung zu Teams …') }));
    const r = await host.net();
    result.net = r.state !== 'bad'; netState.className = 'state ' + r.state;
    netOut.replaceChildren(resBox(r.state === 'ok' ? '' : r.state, tr(r.msg).replace('{ms}', r.ms), r.state === 'bad' ? 'sudo:hilfe/net' : null, 'Netzwerk-Check öffnen'));
  }

  const box = (title, sub, state, ...kids) => el('div', { class: 'box' }, el('div', { class: 'head' }, state, el('div', { class: 't' }, el('b', { text: title }), el('small', { text: sub }))), ...kids);
  main.replaceChildren(
    el('div', { class: 'top' }, el('img', { src: '../assets/icon.png', alt: '' }), el('h1', { 'data-noi18n': '' }, el('span', { text: 'sudo' }), ' ' + tr('Meeting-Check'))),
    el('p', { class: 'lead', text: 'Vor dem nächsten Termin kurz prüfen, ob man dich hört und sieht. Bild und Ton bleiben in diesem Fenster – nichts wird aufgenommen oder verschickt.' }),
    box('Mikrofon', 'Sprich ein paar Worte – der Balken zeigt, ob etwas ankommt.', micState, micSel, el('div', { class: 'meter' }, meter),
      el('div', { class: 'acts' }, el('button', { class: 'act primary', type: 'button', text: 'Mikrofon testen', on: { click: testMic } })), micOut),
    box('Kamera', 'Zeigt dich für ein paar Sekunden – nur hier im Fenster.', camState, camSel, video,
      el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: 'Kamera testen', on: { click: testCam } })), camOut),
    box('Lautsprecher', 'Spielt einen kurzen Ton auf dem gewählten Gerät.', spkState, spkSel,
      el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: 'Testton abspielen', on: { click: testSpeaker } })), spkOut),
    box('Verbindung', 'Wie schnell antwortet Teams?', netState,
      el('div', { class: 'acts' }, el('button', { class: 'act', type: 'button', text: 'Verbindung messen', on: { click: testNet } })), netOut),
    el('p', { class: 'note', text: 'Tipp: In Teams selbst gibt es unter Einstellungen → Geräte einen Testanruf. Im Meeting schaltet Strg+Umschalt+M das Mikrofon stumm und wieder an.' }));
  // Geräte vorab auflisten (Namen erst nach der ersten Freigabe sichtbar)
  try { await fillDevices(micSel, 'audioinput'); await fillDevices(camSel, 'videoinput'); const n = await fillDevices(spkSel, 'audiooutput'); if (!n) spkSel.replaceChildren(el('option', { value: '', text: tr('Standard') })); } catch { /* egal */ }
  navigator.mediaDevices.addEventListener('devicechange', () => { fillDevices(micSel, 'audioinput'); fillDevices(camSel, 'videoinput'); fillDevices(spkSel, 'audiooutput'); });
  testNet();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
