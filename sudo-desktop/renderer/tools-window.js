// tools-window.js – Admin-Werkzeugkasten (läuft komplett offline)
(() => {
  'use strict';
  const host = window.toolsHost;
  const main = document.getElementById('main');
  const enc = new TextEncoder(), dec = new TextDecoder();
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'text') el.textContent = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && el.append(c));
    return el;
  };
  const res = (k, v, big) => h('div', { class: 'res' + (big ? ' big' : '') },
    h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }),
    h('button', { text: 'Kopieren', on: { click: () => host.copy(String(v)) } }));
  const pad = n => String(n).padStart(2, '0');

  /* ---------- Hilfsfunktionen ---------- */
  const b64enc = s => { let b = ''; enc.encode(s).forEach(x => { b += String.fromCharCode(x); }); return btoa(b); };
  const b64dec = s => {
    s = s.trim().replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    return dec.decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  };
  const rnd = n => { const a = new Uint32Array(1); const lim = Math.floor(0x100000000 / n) * n; let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim); return x % n; };
  const WORDS = ('Anker Apfel Ast Bach Ballon Berg Birne Blitz Boot Brett Brief Brot Bruecke Burg Dach Dampf Delfin Draht Eiche Eimer Ente Erbse Falke Feder Feld Fels Fenster Feuer Fisch Flamme Floete Fluss Forelle Frosch Funke Gabel Garten Geige Gipfel Glas Glocke Gras Hafen Hammer Hase Haus Hecht Heft Hirsch Holz Honig Hund Igel Insel Jacke Kabel Kaffee Kamm Kanu Karte Katze Kerze Kiesel Kiwi Koffer Komet Korb Kran Krone Kuchen Lampe Laterne Leiter Linde Loewe Luchs Mantel Marder Meer Mond Moewe Muschel Nadel Nebel Nest Nudel Ofen Orgel Otter Palme Pinsel Pirat Planet Pudel Quelle Rabe Rakete Regen Ring Ritter Rose Sattel Schal Schiff Schlitten Segel Sonne Spiegel Stern Stiefel Storch Strand Tanne Taube Teich Tiger Tinte Turm Ufer Uhr Vogel Wal Wald Wolke Wurzel Zelt Zebra Ziege Zitrone Zug').split(' ');

  /* ---------- Werkzeuge ---------- */
  const TOOLS = {
    pw() {
      const len = h('input', { type: 'range', min: 8, max: 64, value: 20, id: 'len' });
      const lenOut = h('b', { text: '20' });
      const opt = (id, label, on) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', id, checked: on }), label);
      const out = h('div', { class: 'out' });
      function gen() {
        const L = Number(len.value); lenOut.textContent = L;
        const amb = document.getElementById('amb').checked;
        let sets = ['abcdefghijkmnopqrstuvwxyz' + (amb ? '' : 'l')];
        if (document.getElementById('up').checked) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ' + (amb ? '' : 'IO'));
        if (document.getElementById('dig').checked) sets.push('23456789' + (amb ? '' : '01'));
        if (document.getElementById('sym').checked) sets.push('!#$%&*+-=?@_.:');
        const all = sets.join('');
        let pw;
        do { pw = Array.from({ length: L }, () => all[rnd(all.length)]).join(''); }
        while (!sets.every(s => [...pw].some(c => s.includes(c))));   // aus jeder Gruppe mindestens ein Zeichen
        const bits = Math.round(L * Math.log2(all.length));
        const SYM = '!#$%&*+?@';
        const words = Array.from({ length: 5 }, () => WORDS[rnd(WORDS.length)]);
        const phrase = words.join('-') + '-' + (100 + rnd(900)) + SYM[rnd(SYM.length)];
        const pbits = Math.round(5 * Math.log2(WORDS.length) + Math.log2(900) + Math.log2(SYM.length));
        const meter = b => h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, b / 128 * 100)}%;background:${b < 60 ? '#ff6b70' : b < 90 ? '#f4b740' : '#3ccf7a'}` }));
        out.replaceChildren(res('Passwort', pw, true), h('div', { class: 'sub', text: `ca. ${bits} Bit Entropie` }), meter(bits),
          res('Merkbar', phrase, true), h('div', { class: 'sub', text: `ca. ${pbits} Bit · leicht am Telefon durchzugeben, aber nur als Startpasswort, das beim ersten Login geändert werden muss` }), meter(pbits));
      }
      len.addEventListener('input', gen);
      setTimeout(gen);
      return [h('h2', { text: 'Passwort-Generator' }), h('p', { class: 'sub', text: 'Kryptografisch sichere Zufallszahlen, nichts wird gespeichert.' }),
        h('div', { class: 'row' }, h('span', { text: 'Länge' }), len, lenOut),
        h('div', { class: 'row', style: 'margin-top:8px' }, opt('up', 'Großbuchstaben', true), opt('dig', 'Ziffern', true), opt('sym', 'Sonderzeichen', true), opt('amb', 'Ohne 0/O, 1/l/I', true)),
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'act primary', text: 'Neu erzeugen', on: { click: gen } })),
        out, h('script')].map(x => { if (x.tagName === 'DIV' && x.querySelector('input[type=checkbox]')) x.addEventListener('change', gen); return x; });
    },

    guid() {
      const out = h('div', { class: 'out' });
      const gen = () => {
        const g = crypto.randomUUID();
        out.replaceChildren(res('GUID', g, true), res('Großbuchstaben', g.toUpperCase()), res('Mit Klammern', `{${g.toUpperCase()}}`), res('Ohne Bindestriche', g.replace(/-/g, '')));
      };
      gen();
      return [h('h2', { text: 'GUID / UUID' }), h('p', { class: 'sub', text: 'Version 4, zufällig. Z. B. für App-Registrierungen, Intune-Skripte oder Datenbank-Schlüssel.' }),
        h('button', { class: 'act primary', text: 'Neue GUID', on: { click: gen } }), out];
    },

    subnet() {
      const inp = h('input', { type: 'text', value: '192.168.10.25/24', placeholder: '10.0.4.17/22 oder 10.0.4.17 255.255.252.0' });
      const out = h('div', { class: 'out' });
      const toInt = s => { const p = s.split('.').map(Number); if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('Ungültige IP-Adresse'); return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0; };
      const toIp = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      function calc() {
        try {
          const m = inp.value.trim().match(/^([\d.]+)\s*(?:\/\s*(\d{1,2})|\s+([\d.]+))?$/);
          if (!m) throw new Error('Format: IP/Präfix, z. B. 10.0.4.17/22');
          const ip = toInt(m[1]);
          let prefix;
          if (m[3]) {
            const mk = toInt(m[3]); prefix = 32 - Math.log2((~mk >>> 0) + 1);
            if (!Number.isInteger(prefix)) throw new Error('Ungültige Subnetzmaske');
          } else prefix = m[2] != null ? Number(m[2]) : 24;
          if (prefix < 0 || prefix > 32) throw new Error('Präfix muss zwischen 0 und 32 liegen');
          const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
          const net = (ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
          const hosts = prefix >= 31 ? (prefix === 32 ? 1 : 2) : 2 ** (32 - prefix) - 2;
          const first = prefix >= 31 ? net : net + 1, last = prefix >= 31 ? bc : bc - 1;
          const inR = (a, p) => { const b = toInt(a), mk = (0xFFFFFFFF << (32 - p)) >>> 0; return ((ip & mk) >>> 0) === ((b & mk) >>> 0); };
          const kind = inR('10.0.0.0', 8) || inR('172.16.0.0', 12) || inR('192.168.0.0', 16) ? 'Privat (RFC 1918)'
            : inR('100.64.0.0', 10) ? 'Carrier-Grade-NAT' : inR('169.254.0.0', 16) ? 'Link-Local (APIPA – kein DHCP?)'
            : inR('127.0.0.0', 8) ? 'Loopback' : 'Öffentlich';
          out.replaceChildren(res('Netz', `${toIp(net)}/${prefix}`, true), res('Subnetzmaske', toIp(mask)), res('Wildcard', toIp(~mask >>> 0)),
            res('Erster Host', toIp(first)), res('Letzter Host', toIp(last)), res('Broadcast', toIp(bc)),
            res('Nutzbare Hosts', hosts.toLocaleString(window.I18N ? I18N.locale : 'de-DE')), res('Art', kind));
        } catch (e) { out.replaceChildren(h('div', { class: 'err', text: e.message })); }
      }
      inp.addEventListener('input', calc); setTimeout(calc);
      return [h('h2', { text: 'Subnetz-Rechner' }), h('p', { class: 'sub', text: 'IPv4 mit Präfix (/22) oder Maske (255.255.252.0).' }), h('label', { text: 'Adresse' }), inp, out];
    },

    time() {
      const inp = h('input', { type: 'text', placeholder: 'leer = jetzt · Unix-Sekunden · Millisekunden · Windows-FILETIME · 2026-11-02 14:30' });
      const out = h('div', { class: 'out' });
      function calc() {
        const v = inp.value.trim();
        let d, src = 'Jetzt';
        if (!v) d = new Date();
        else if (/^\d{17,19}$/.test(v)) { d = new Date(Number(BigInt(v) / 10000n - 11644473600000n)); src = 'Windows-FILETIME (z. B. AD lastLogonTimestamp)'; }
        else if (/^\d{12,14}$/.test(v)) { d = new Date(Number(v)); src = 'Unix-Millisekunden'; }
        else if (/^\d{1,11}$/.test(v)) { d = new Date(Number(v) * 1000); src = 'Unix-Sekunden'; }
        else { const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/); d = m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : new Date(v.replace(' ', 'T')); src = 'Datum'; }
        if (isNaN(d)) { out.replaceChildren(h('div', { class: 'err', text: 'Unbekanntes Format.' })); return; }
        const ft = (BigInt(d.getTime()) + 11644473600000n) * 10000n;
        const local = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        out.replaceChildren(h('p', { class: 'sub', text: 'Erkannt als: ' + src }), res('Lokal', local, true), res('ISO 8601 (UTC)', d.toISOString()),
          res('Unix-Sekunden', Math.floor(d.getTime() / 1000)), res('Unix-Millisekunden', d.getTime()), res('Windows-FILETIME', ft.toString()),
          res('Kalenderwoche', 'KW ' + isoWeek(d)));
      }
      function isoWeek(dt) { const t = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); }
      inp.addEventListener('input', calc); setTimeout(calc);
      return [h('h2', { text: 'Zeitstempel umrechnen' }), h('p', { class: 'sub', text: 'Praktisch für Logs, Graph-API und AD-Attribute wie lastLogonTimestamp oder pwdLastSet.' }), h('label', { text: 'Eingabe' }), inp, out];
    },

    b64() {
      const inp = h('textarea', { placeholder: 'Text oder Base64 hier einfügen …' });
      const out = h('div', { class: 'out' });
      function calc() {
        const v = inp.value; if (!v) { out.replaceChildren(); return; }
        const rows = [res('Base64', b64enc(v)), res('Base64URL', b64enc(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), res('URL-kodiert', encodeURIComponent(v))];
        try { const d = b64dec(v); if (d && !/�/.test(d)) rows.unshift(res('Base64 → Text', d, true)); } catch { /* kein Base64 */ }
        try { const d = decodeURIComponent(v); if (d !== v) rows.push(res('URL → Text', d)); } catch { /* egal */ }
        out.replaceChildren(...rows);
      }
      inp.addEventListener('input', calc);
      return [h('h2', { text: 'Base64 & URL' }), h('p', { class: 'sub', text: 'Kodiert und dekodiert automatisch in beide Richtungen (UTF-8).' }), inp, out];
    },

    hash() {
      const inp = h('textarea', { placeholder: 'Text eingeben …' });
      const out = h('div', { class: 'out' });
      const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      async function calc() {
        const v = inp.value; if (!v) { out.replaceChildren(); return; }
        const data = enc.encode(v);
        const [s1, s256, s512, md5] = await Promise.all([crypto.subtle.digest('SHA-1', data), crypto.subtle.digest('SHA-256', data), crypto.subtle.digest('SHA-512', data), host.md5(v)]);
        out.replaceChildren(res('SHA-256', hex(s256), true), res('SHA-1', hex(s1)), res('SHA-512', hex(s512)), res('MD5', md5));
      }
      inp.addEventListener('input', calc);
      return [h('h2', { text: 'Hash-Werte' }), h('p', { class: 'sub', text: 'Zum Vergleichen von Prüfsummen. Dateien: PowerShell Get-FileHash.' }), inp, out];
    },

    json() {
      const inp = h('textarea', { placeholder: '{"json":"hier einfügen"}', style: 'min-height:140px' });
      const out = h('div', { class: 'out' });
      function calc() {
        const v = inp.value.trim(); if (!v) { out.replaceChildren(); return; }
        try {
          const o = JSON.parse(v), pretty = JSON.stringify(o, null, 2), mini = JSON.stringify(o);
          out.replaceChildren(h('div', { class: 'row' }, h('span', { style: 'color:var(--ok)', text: '✓ Gültiges JSON' }),
            h('button', { class: 'act', text: 'Formatiert kopieren', on: { click: () => host.copy(pretty) } }),
            h('button', { class: 'act', text: 'Minifiziert kopieren', on: { click: () => host.copy(mini) } })), h('pre', { class: 'code', text: pretty }));
        } catch (e) { out.replaceChildren(h('div', { class: 'err', text: 'Ungültig: ' + e.message })); }
      }
      inp.addEventListener('input', calc);
      return [h('h2', { text: 'JSON prüfen & formatieren' }), h('p', { class: 'sub', text: 'Zeigt Fehler mit Position und formatiert lesbar.' }), inp, out];
    },

    jwt() {
      const inp = h('textarea', { placeholder: 'eyJ0eXAiOiJKV1Qi…  (Bearer-Token, z. B. aus Graph-Explorer)' });
      const out = h('div', { class: 'out' });
      const fmt = s => { const d = new Date(s * 1000); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
      function calc() {
        const v = inp.value.trim().replace(/^Bearer\s+/i, ''); if (!v) { out.replaceChildren(); return; }
        try {
          const [hd, pl] = v.split('.'); if (!pl) throw new Error('Kein JWT (erwartet drei Teile mit Punkten)');
          const head = JSON.parse(b64dec(hd)), pay = JSON.parse(b64dec(pl));
          const rows = [];
          if (pay.exp) { const left = pay.exp * 1000 - Date.now(); rows.push(res('Läuft ab', fmt(pay.exp) + (left < 0 ? '  (abgelaufen)' : `  (noch ${Math.round(left / 60000)} Min.)`), true)); }
          if (pay.iat) rows.push(res('Ausgestellt', fmt(pay.iat)));
          for (const [k, l] of [['upn', 'Benutzer'], ['unique_name', 'Benutzer'], ['app_displayname', 'App'], ['aud', 'Zielgruppe'], ['tid', 'Tenant-ID'], ['scp', 'Berechtigungen'], ['roles', 'Rollen']]) {
            if (pay[k]) rows.push(res(l, Array.isArray(pay[k]) ? pay[k].join(', ') : pay[k]));
          }
          out.replaceChildren(...rows, h('label', { text: 'Header' }), h('pre', { class: 'code', text: JSON.stringify(head, null, 2) }),
            h('label', { text: 'Payload' }), h('pre', { class: 'code', text: JSON.stringify(pay, null, 2) }),
            h('p', { class: 'sub', text: 'Nur dekodiert, die Signatur wird nicht geprüft. Tokens sind Zugangsdaten: nicht weitergeben.' }));
        } catch (e) { out.replaceChildren(h('div', { class: 'err', text: e.message })); }
      }
      inp.addEventListener('input', calc);
      return [h('h2', { text: 'JWT dekodieren' }), h('p', { class: 'sub', text: 'Zeigt Ablaufzeit, Benutzer, Tenant und Berechtigungen eines Tokens.' }), inp, out];
    }
  };

  /* ---------- Navigation ---------- */
  const nav = document.getElementById('nav');
  function show(t) {
    nav.querySelectorAll('button[data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
    main.replaceChildren(...TOOLS[t]().filter(x => x && x.tagName !== 'SCRIPT'));
    const f = main.querySelector('input[type=text], textarea'); if (f) f.focus();
    try { localStorage.setItem('sudo-tool', t); } catch { /* egal */ }
  }
  nav.querySelectorAll('button[data-t]').forEach(b => b.addEventListener('click', () => show(b.dataset.t)));
  let start = 'pw'; try { start = localStorage.getItem('sudo-tool') || 'pw'; } catch { /* egal */ }
  show(TOOLS[start] ? start : 'pw');
  if (host.onTool) host.onTool(t => { if (TOOLS[t]) show(t); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
})();
