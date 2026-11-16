// ask-core.js – gemeinsamer Kern für „Frag Sudo“: Anfrage an die Claude-API bauen, Streaming lesen, Kosten rechnen.
// Wird vom Desktop-Client (eigener Schlüssel) UND von der Sudo-Zentrale (Server) benutzt – bitte beide Kopien gleich halten.
'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
// Preise in US-Dollar pro 1 Mio. Token (Stand November 2026, platform.claude.com/docs/en/about-claude/pricing)
const MODELS = {
  haiku: { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', inUsd: 0.10, outUsd: 0.50 },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', inUsd: 2, outUsd: 10 }
};
const LANG_NAME = { de: 'Deutsch', en: 'English', ja: '日本語 (Japanese)' };

function systemPrompt({ lang = 'de', context = '' } = {}) {
  return [
    'Du bist Sudo, ein kleiner Pixel-Ninja mit Hoodie, Headset und USB-Katana, der als Desktop-Begleiter auf dem Windows-Desktop eines IT-Profis lebt.',
    'Dein Mensch arbeitet mit Microsoft 365, Entra ID, Intune, Exchange Online, Netzwerken, PowerShell, PHP und Web-Entwicklung.',
    'Antworte hilfreich, korrekt und knapp: normalerweise höchstens 4 kurze Sätze, außer es wird ausdrücklich mehr verlangt.',
    'Code und Befehle immer in Markdown-Codeblöcken mit Sprachangabe. Keine Überschriften, kaum Aufzählungen.',
    'Ton: freundlich, trocken, ein Hauch IT-Humor – aber Hilfe geht vor Witz. Wenn du dir nicht sicher bist, sag das offen.',
    'Frag nie nach Passwörtern, Schlüsseln oder Kundendaten. Bei riskanten Befehlen (Löschen, Neustart, Massenänderungen) kurz warnen.',
    `Antworte auf ${LANG_NAME[lang] || LANG_NAME.de}.`,
    context ? `Aktuelle Lage auf dem PC (nur als Hintergrund, nicht ungefragt erwähnen):\n${context}` : ''
  ].filter(Boolean).join('\n');
}

function buildRequest({ model = 'haiku', system, messages, maxTokens = 700 }) {
  const m = MODELS[model] || MODELS.haiku;
  return { model: m.id, max_tokens: maxTokens, system, messages, stream: true };
}

function cost(model, usage) {
  const m = MODELS[model] || MODELS.haiku;
  return ((usage.in || 0) * m.inUsd + (usage.out || 0) * m.outUsd) / 1e6;
}

// Liest einen SSE-Strom der Messages-API. onText(teil) für jedes Textstück, onEvent(roh) optional (Zentrale reicht weiter).
async function readStream(body, { onText, onEvent, signal } = {}) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stop = null, error = null;
  const usage = { in: 0, out: 0 };
  const handle = block => {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
    if (!data) return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    if (onEvent) onEvent(block, ev);
    switch (ev.type) {
      case 'message_start': {
        const u = (ev.message && ev.message.usage) || {};
        usage.in = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        usage.out = u.output_tokens || 0;
        break;
      }
      case 'content_block_delta':
        if (ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; if (onText) onText(ev.delta.text); }
        break;
      case 'message_delta':
        if (ev.usage && ev.usage.output_tokens != null) usage.out = ev.usage.output_tokens;
        if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        break;
      case 'error':
        error = (ev.error && (ev.error.message || ev.error.type)) || 'Fehler im Datenstrom';
        break;
      default: break;            // ping, content_block_start/stop, message_stop, künftige Typen
    }
  };
  while (true) {
    if (signal && signal.aborted) { try { await reader.cancel(); } catch { /* egal */ } break; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  return { text, usage, stop, error };
}

// Verständliche Fehlermeldungen für typische HTTP-Antworten
async function httpError(r) {
  let msg = '';
  try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch { /* kein JSON */ }
  const known = { 400: 'Anfrage ungültig', 401: 'API-Schlüssel ungültig', 402: 'Budget aufgebraucht', 403: 'Kein Zugriff',
    404: 'Modell oder Adresse nicht gefunden', 413: 'Frage zu lang', 429: 'Zu viele Anfragen – kurz warten', 500: 'Fehler beim Anbieter', 529: 'Claude ist gerade überlastet' };
  return (known[r.status] || 'HTTP ' + r.status) + (msg ? ': ' + msg : '');
}

module.exports = { API_URL, API_VERSION, MODELS, systemPrompt, buildRequest, cost, readStream, httpError };
