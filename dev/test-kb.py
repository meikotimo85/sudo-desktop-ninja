# test-kb.py – End-to-End-Test „Wissen & Anleitungen“ gegen den Graph-Nachbau (frische Datenbank nötig)
import json, os, urllib.request, http.cookiejar, time
B = os.environ.get('SUDO_BASE', 'http://127.0.0.1:8091')
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
def R(m, u, b=None, h={}):
    r = urllib.request.Request(B + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={**({'content-type': 'application/json'} if b is not None else {}), **h})
    try: x = op.open(r); t = x.read().decode(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e: t = e.read().decode(); return e.code, (json.loads(t) if t.startswith('{') else t)
M = lambda p: json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4801' + p).read())
R('POST', '/auth/password', {'password': 'test-passwort-16'}); A = {'x-csrf': R('GET', '/admin/api/me')[1]['csrf']}
tok = R('POST', '/api/enroll', {'code': 'TEST-PHP-1234', 'name': 'PC-TEST-01', 'user': 'meiko', 'upn': 'admin@firma.de'})[1]['token']; D = {'authorization': 'Bearer ' + tok}
print('kb vorher:', R('GET', '/admin/api/kb', None, A)[1]['ready'])
R('PUT', '/admin/api/settings', {'kb_tenant': 'firma.onmicrosoft.com', 'kb_client_id': '11111111-2222-3333-4444-555555555555', 'kb_client_secret': 'falsch'}, A)
print('test falsch:', R('POST', '/admin/api/kb/test', {}, A))
R('PUT', '/admin/api/settings', {'kb_client_secret': 'geheim', 'kb_enabled': 'true'}, A)
print('test richtig:', R('POST', '/admin/api/kb/test', {}, A))
print('secret sichtbar?', any(k in R('GET', '/admin/api/settings', None, A)[1] for k in ['kb_client_secret', 'kb_token']))
print('kein SharePoint:', R('POST', '/admin/api/kb/sources', {'url': 'https://example.com/x'}, A))
print('verboten:', R('POST', '/admin/api/kb/sources', {'url': 'https://firma.sharepoint.com/sites/Geheim/Dokumente'}, A))
print('datei statt ordner:', R('POST', '/admin/api/kb/sources', {'url': 'https://firma.sharepoint.com/sites/IT/Freigegebene%20Dokumente/Anleitungen/VPN%20einrichten.docx'}, A))
c, r = R('POST', '/admin/api/kb/sources', {'url': 'https://firma.sharepoint.com/sites/IT/Freigegebene%20Dokumente/Forms/AllItems.aspx?id=%2Fsites%2FIT%2FFreigegebene%20Dokumente%2FAnleitungen&viewid=x'}, A); print('ordner (AllItems-Link):', c, r)
print('doppelt:', R('POST', '/admin/api/kb/sources', {'url': 'https://firma.sharepoint.com/sites/IT/Freigegebene Dokumente/Anleitungen'}, A)[0])
print('seiten:', R('POST', '/admin/api/kb/sources', {'url': 'https://firma.sharepoint.com/sites/IT/SitePages/Home.aspx'}, A))
k = R('GET', '/admin/api/kb', None, A)[1]; print('übersicht:', k['items'], 'mit Text:', k['withText'], [(s['title'], s['items'], s['lastError']) for s in k['sources']])
p = R('POST', '/api/poll', {}, D)[1]; print('poll kb:', p.get('kb'))
for q in ['vpn', 'Wie richte ich das VPN ein?', 'drucker warteschlange', 'Handy gewechselt Authenticator', 'gäste wlan', 'preisliste', 'xyzunbekannt']:
    it = R('POST', '/api/kb/search', {'q': q}, D)[1]['items']; print(f'suche {q!r}:', [(i['title'], i['score'], i['snippet'][:50]) for i in it[:3]])
print('zuletzt:', [i['title'] for i in R('POST', '/api/kb/search', {'q': ''}, D)[1]['items']])
d0 = M('/_state')['downloads']
sid = k['sources'][0]['id']
print('abgleich ohne änderung:', R('POST', f'/admin/api/kb/sources/{sid}/sync', {}, A)[1], 'downloads +', M('/_state')['downloads'] - d0)
M('/_mod'); M('/_del')
print('abgleich mit änderung:', R('POST', f'/admin/api/kb/sources/{sid}/sync', {}, A)[1])
print('suche wireguard:', [i['title'] for i in R('POST', '/api/kb/search', {'q': 'wireguard'}, D)[1]['items']], 'drucker weg:', R('POST', '/api/kb/search', {'q': 'kyocera'}, D)[1]['items'] == [])
print('admin ki-kontext für "VPN geht nicht":', R('POST', '/admin/api/kb/search', {'q': 'VPN geht nicht'}, A)[1]['ai'])
R('PATCH', f'/admin/api/kb/sources/{sid}', {'active': False}, A)
print('inaktiv → suche mfa:', R('POST', '/api/kb/search', {'q': 'mfa'}, D)[1]['items'])
print('löschen:', R('DELETE', f'/admin/api/kb/sources/{sid}', None, A)[1], R('GET', '/admin/api/kb', None, A)[1]['items'])
