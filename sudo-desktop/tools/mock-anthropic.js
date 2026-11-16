// mock-anthropic.js – nachgebaute Claude-API für Tests (SSE wie das Original). Start: node tools/mock-anthropic.js [port]
'use strict';
const http = require('http');
const port = Number(process.argv[2]) || 4799;
const ANSWER = 'Klar! Gesperrte Konten findest du so:\n\n```powershell\nSearch-ADAccount -LockedOut | Select-Object Name, SamAccountName\n```\n\nEntsperren geht mit `Unlock-ADAccount`. Und denk dran: **erst prüfen**, dann klicken.';
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    if (req.headers['x-api-key'] === 'sk-ant-bad-key-000000000000000000') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    let j = {}; try { j = JSON.parse(body); } catch { /* egal */ }
    if (process.env.MOCK_LOG) require('fs').writeFileSync(process.env.MOCK_LOG, JSON.stringify({ system: j.system, model: j.model }));   // für Tests: letzte Anfrage
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    ev('message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: j.model, usage: { input_tokens: 812, output_tokens: 1 } } });
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    ev('ping', { type: 'ping' });
    for (const part of ANSWER.match(/.{1,12}/gs)) { ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } }); await new Promise(r => setTimeout(r, 40)); }
    ev('content_block_stop', { type: 'content_block_stop', index: 0 });
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 96 } });
    ev('message_stop', { type: 'message_stop' });
    res.end();
  });
}).listen(port, '127.0.0.1', () => console.log('Mock-Claude auf http://127.0.0.1:' + port));
