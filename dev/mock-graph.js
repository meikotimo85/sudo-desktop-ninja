// mock-graph.js – Nachbau von Microsoft Graph (SharePoint) für Tests der Wissens-Funktion (Port 4801).
// Start: node dev/mock-graph.js [Ordner mit f1.docx, f1b.docx, f2.pptx, f4.docx]
// Zentrale-Konfiguration: graph_login = http://127.0.0.1:4801, graph_api = http://127.0.0.1:4801/v1.0, Client Secret „geheim“.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2] || path.join(__dirname, 'graph-files');
const BASE = 'http://127.0.0.1:4801';
const SITE = { id: 'firma.sharepoint.com,s1,w1', displayName: 'IT', webUrl: 'https://firma.sharepoint.com/sites/IT' };
const SP = 'https://firma.sharepoint.com/sites/IT';
const T = d => new Date(Date.UTC(2026, 9, d, 9)).toISOString();
const files = {
  f1: { id: 'f1', name: 'VPN einrichten.docx', file: {}, size: 600, eTag: 'e1', lastModifiedDateTime: T(20), webUrl: SP + '/Freigegebene%20Dokumente/Anleitungen/VPN%20einrichten.docx', src: 'f1.docx' },
  f2: { id: 'f2', name: 'Drucker.pptx', file: {}, size: 620, eTag: 'e2', lastModifiedDateTime: T(12), webUrl: SP + '/Freigegebene%20Dokumente/Anleitungen/Drucker.pptx', src: 'f2.pptx' },
  f3: { id: 'f3', name: 'Preisliste.pdf', file: {}, size: 90000, eTag: 'e3', lastModifiedDateTime: T(2), webUrl: SP + '/Freigegebene%20Dokumente/Anleitungen/Preisliste.pdf' },
  tmp: { id: 'tmp', name: '~$VPN einrichten.docx', file: {}, size: 10, eTag: 'x', lastModifiedDateTime: T(20), webUrl: SP + '/x' },
  f4: { id: 'f4', name: 'MFA Handy wechseln.docx', file: {}, size: 600, eTag: 'e4', lastModifiedDateTime: T(25), webUrl: SP + '/Freigegebene%20Dokumente/Anleitungen/Microsoft%20365/MFA%20Handy%20wechseln.docx', src: 'f4.docx' }
};
const fold2 = { id: 'fold2', name: 'Microsoft 365', folder: { childCount: 1 } };
let downloads = 0, tokens = 0;
const pub = f => { const { src, ...rest } = f; return rest; };

http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  const p = decodeURIComponent(u.pathname);
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    const J = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (/^\/[^/]+\/oauth2\/v2\.0\/token$/.test(p)) {
      const b = new URLSearchParams(body);
      if (b.get('client_secret') !== 'geheim') return J(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' });
      tokens++; return J(200, { access_token: 'gtok' + tokens, expires_in: 3600, token_type: 'Bearer' });
    }
    if (p === '/_state') return J(200, { downloads, tokens });
    if (p === '/_mod') { files.f1.eTag = 'e1b'; files.f1.src = 'f1b.docx'; files.f1.lastModifiedDateTime = T(30); return J(200, { ok: true }); }
    if (p === '/_del') { delete files.f2; return J(200, { ok: true }); }
    if (p.startsWith('/dl/')) { const f = files[p.slice(4)]; downloads++; res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(fs.readFileSync(path.join(DIR, f.src))); }
    if (!/^Bearer gtok/.test(req.headers.authorization || '')) return J(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } });
    if (p === '/v1.0/sites/firma.sharepoint.com:/sites/IT') return J(200, SITE);
    if (p === '/v1.0/sites/firma.sharepoint.com:/sites/Geheim') return J(403, { error: { code: 'accessDenied', message: 'Access denied' } });
    if (p === `/v1.0/sites/${SITE.id}/drives`) return J(200, { value: [
      { id: 'drv1', name: 'Dokumente', webUrl: SP + '/Freigegebene%20Dokumente' }, { id: 'drv2', name: 'Archiv', webUrl: SP + '/Archiv' }] });
    if (p === '/v1.0/drives/drv1/root:/Anleitungen') return J(200, { id: 'fold1', name: 'Anleitungen', folder: { childCount: 4 } });
    if (p === '/v1.0/drives/drv1/root:/Anleitungen/VPN einrichten.docx') return J(200, { id: 'f1', name: 'VPN einrichten.docx', file: {} });
    if (p === '/v1.0/drives/drv1/items/fold1/children') {
      if (u.searchParams.get('page') === '2') return J(200, { value: [fold2, files.f3, files.tmp].filter(Boolean).map(pub) });
      return J(200, { value: [files.f1, files.f2].filter(Boolean).map(pub), '@odata.nextLink': BASE + '/v1.0/drives/drv1/items/fold1/children?page=2' });
    }
    if (p === '/v1.0/drives/drv1/items/fold2/children') return J(200, { value: [pub(files.f4)] });
    const c = p.match(/^\/v1\.0\/drives\/drv1\/items\/(\w+)\/content$/);
    if (c && files[c[1]]) { res.writeHead(302, { location: BASE + '/dl/' + c[1] }); return res.end(); }
    if (p === `/v1.0/sites/${SITE.id}/pages/microsoft.graph.sitePage`) return J(200, { value: [
      { id: 'p1', name: 'Erste-Schritte.aspx', title: 'Neue Mitarbeiter – Erste Schritte', description: 'Was am ersten Tag zu tun ist', webUrl: SP + '/SitePages/Erste-Schritte.aspx', lastModifiedDateTime: T(28), eTag: 'pe1' }] });
    if (p === `/v1.0/sites/${SITE.id}/pages/p1/microsoft.graph.sitePage/webParts`) return J(200, { value: [
      { innerHtml: '<h2>WLAN</h2><p>Das Gäste-WLAN heißt <b>Firma-Gast</b>. Für Mitarbeiter: Firma-Intern mit dem Firmenkonto.</p>' }, { id: 'img' }] });
    J(404, { error: { code: 'itemNotFound', message: 'Not found: ' + p } });
  });
}).listen(4801, () => console.log('graph mock 4801'));
