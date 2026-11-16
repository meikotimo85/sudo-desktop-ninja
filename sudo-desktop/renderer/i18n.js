// i18n.js – Sudo spricht Deutsch, Englisch und (als Gimmick) Japanisch.
// Prinzip: Der deutsche Text ist der Schlüssel. Wörterbücher in renderer/lang/*.js ordnen ihm die Übersetzung zu.
// Platzhalter wie {name} machen aus einem Eintrag ein Muster: "Akku bei {pct} %!" passt auch auf "Akku bei 12 %!".
// In Fenstern übersetzt ein Beobachter automatisch alle sichtbaren Texte; Code ruft I18N.t('…') auf.
// Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const LANGS = { de: { name: 'Deutsch', locale: 'de-DE' }, en: { name: 'English', locale: 'en-GB' }, ja: { name: '日本語', locale: 'ja-JP' } };
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const dicts = {};            // Sprache → { exact: Map, loose: Map, patterns: [] }
  let lang = 'de', cur = null, collect = null;

  function compile(table) {
    const d = { exact: new Map(), loose: new Map(), patterns: [], raw: new Map(Object.entries(table)), outs: new Set(Object.values(table).map(norm)) };
    for (const [k, v] of Object.entries(table)) {
      if (/\{\w+\}/.test(k)) {
        const names = [], multi = k.includes('\n');
        const src = k.split(/(\{\w+\})/).map(part => {
          const m = part.match(/^\{(\w+)\}$/);
          if (m) { names.push(m[1]); return '([^\\n]*?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        }).join('');
        const outRe = new RegExp('^' + norm(v).split(/(\{\w+\})/).map(x => /^\{\w+\}$/.test(x) ? '.+?' : x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
        d.patterns.push({ re: new RegExp('^' + src + '$'), names, out: v, len: k.length, outRe });
      } else { d.exact.set(k, v); d.loose.set(norm(k), v); }
    }
    d.patterns.sort((a, b) => b.len - a.len);   // spezifischere (längere) Muster zuerst
    return d;
  }
  function register(code, table) { dicts[code] = compile(table); if (code === lang) cur = dicts[code]; }

  // Übersetzt einen Text. Gibt null zurück, wenn es keine Übersetzung gibt (intern), t() liefert dann das Original.
  function lookup(s, depth = 0) {
    if (!cur || s == null) return null;
    s = String(s);
    if (cur.exact.has(s)) return cur.exact.get(s);
    const n = norm(s);
    if (!n) return null;
    if (cur.loose.has(n)) return cur.loose.get(n);
    if (depth > 3) return null;
    for (const p of cur.patterns) {
      const st = s.trim();
      const m = st.match(p.re) || (st.includes('\n') ? null : n.match(p.re));
      if (!m) continue;
      const vals = {};
      p.names.forEach((name, i) => { const v = m[i + 1], r = lookup(v, depth + 1); vals[name] = r == null ? v : v.match(/^\s*/)[0] + r + v.match(/\s*$/)[0]; });
      return p.out.replace(/\{(\w+)\}/g, (_, k) => (k in vals ? vals[k] : `{${k}}`));
    }
    return null;
  }
  function t(s) {
    if (lang === 'de' || s == null || s === '') return s;
    let r = lookup(s);
    // Zusammengesetzte Blasen ("Moin!\nArbeitsbeginn 08:00.\n2 offene Notizen.") Zeile für Zeile übersetzen
    if (r == null && String(s).includes('\n')) {
      const lines = String(s).split('\n').map(l => ({ l, r: lookup(l) }));
      if (lines.some(x => x.r != null)) r = lines.map(x => x.r ?? x.l).join('\n');
    }
    // Sammeln fehlender Texte (nur im Test); bereits übersetzte Ausgaben überspringen
    if (r == null && collect && /[A-Za-zÄÖÜäöüß]{2}/.test(s) && !cur.outs.has(norm(s)) && !cur.patterns.some(p => p.outRe && p.outRe.test(norm(s)))) collect(String(s));
    return r ?? s;
  }
  // Für Zeichenketten mit Werten: tf('Akku bei {pct} %', { pct: 12 }) – übersetzt das Muster, dann füllen
  function tf(s, vals = {}) {
    const fill = x => String(x).replace(/\{(\w+)\}/g, (_, k) => (vals[k] ?? ''));
    if (lang === 'de') return fill(s);
    const d = cur && (cur.raw.get(s) ?? null);
    if (d != null) return fill(d);
    return t(fill(s));
  }

  function setLang(code) {
    lang = LANGS[code] ? code : 'de';
    cur = dicts[lang] || null;
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }

  /* ---------- Fenster: sichtbare Texte automatisch übersetzen ---------- */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE', 'KBD']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function skip(node) {
    for (let e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
      if (SKIP.has(e.tagName) || (e.hasAttribute && e.hasAttribute('data-noi18n'))) return true;
    }
    return false;
  }
  function translateText(node) {
    const v = node.nodeValue;
    if (!v || !/[A-Za-zÄÖÜäöüß]/.test(v) || skip(node)) return;
    const r = t(v);
    if (r !== v) {
      // Leerzeichen am Rand erhalten (Text steht oft zwischen <b> und <kbd>)
      const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
      const out = lead + String(r).trim() + trail;
      if (out !== v) node.nodeValue = out;
    }
  }
  function translateEl(e) {
    for (const a of ATTRS) {
      const v = e.getAttribute && e.getAttribute(a);
      if (v) { const r = t(v); if (r !== v) e.setAttribute(a, r); }
    }
  }
  function translateTree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) return translateText(rootNode);
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
    if (rootNode.nodeType === 1) { if (skip(rootNode)) return; translateEl(rootNode); }
    const w = document.createTreeWalker(rootNode, 5 /* Elemente + Text */);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) translateText(n); else if (!SKIP.has(n.tagName) || n.tagName === 'TEXTAREA') translateEl(n);   // Eingabefelder: nur Platzhalter/Titel
    }
  }
  function watchDom() {
    if (lang === 'de' || typeof document === 'undefined') return;
    if (watchDom.done) return; watchDom.done = true;
    const run = () => {
      document.title = t(document.title);
      translateTree(document.body);
      new MutationObserver(list => {
        for (const m of list) {
          if (m.type === 'characterData') translateText(m.target);
          else if (m.type === 'attributes') translateEl(m.target);
          else m.addedNodes.forEach(translateTree);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);
  }

  // Sprache aus der Fensteradresse (?lang=en) – der Hauptprozess hängt sie an jedes Fenster
  if (typeof location !== 'undefined' && location.search) {
    const q = new URLSearchParams(location.search);
    setLang(q.get('lang') || 'de');
    if (q.get('i18ncollect')) { const seen = new Set(); collect = s => { if (!seen.has(s)) { seen.add(s); console.log('[i18n-missing] ' + JSON.stringify(s)); } }; }
  }
  // Nach dem Laden der Seite (Wörterbücher sind dann registriert) alle Texte übersetzen und weiter beobachten
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', watchDom);

  return {
    LANGS, register, t, tf, setLang, watchDom, translateTree,
    get lang() { return lang; },
    get locale() { return LANGS[lang].locale; },
    set collector(fn) { collect = fn; }
  };
});
