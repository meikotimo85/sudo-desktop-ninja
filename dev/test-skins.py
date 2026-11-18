# test-skins.py – E2E-Test Skin-Store über die Zentrale (1.14): Hochladen, Preis, Ziele, Abruf mit Prüfsumme, „alle kostenlos“, Löschen
# Frische Datenbank nötig. Gegen PHP (8091, Standard) oder Node: $env:SUDO_BASE='http://127.0.0.1:8090'
# Gegen Node holt der Test die Konfiguration über WebSocket (braucht „node“ ab Version 22 im PATH).
import base64, hashlib, json, os, subprocess, urllib.request, http.cookiejar
B = os.environ.get('SUDO_BASE', 'http://127.0.0.1:8091')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
def J(m, u, b=None, h={}):
    r = urllib.request.Request(B + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={**({'content-type': 'application/json'} if b is not None else {}), **h})
    try: x = op.open(r); t = x.read().decode(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e: t = e.read().decode(); return e.code, (json.loads(t) if t else None)
fails = 0
def check(name, cond, info=''):
    global fails
    if not cond: fails += 1
    print(('OK     ' if cond else 'FEHLER ') + name + ('' if cond else '  ->  ' + str(info)[:300]))

poll = J('GET', '/api/info')[1].get('transport') == 'poll'
def cfg(tok):
    if poll: return J('POST', '/api/poll', {}, {'authorization': 'Bearer ' + tok})[1].get('skins')
    js = ("const w=new WebSocket(process.argv[1]);w.onopen=()=>w.send(JSON.stringify({t:'hello',token:process.argv[2],version:'1.14.0'}));"
          "w.onmessage=e=>{const d=JSON.parse(e.data);if(d.t==='welcome'){console.log(JSON.stringify(d.skins));process.exit(0)}};setTimeout(()=>process.exit(2),5000)")
    out = subprocess.run(['node', '-e', js, B.replace('http', 'ws', 1) + '/api/ws', tok], capture_output=True, text=True, timeout=10).stdout.strip()
    return json.loads(out) if out else None
sha = lambda png, sheet: hashlib.sha256((png + '|' + (sheet or '')).encode()).hexdigest()

J('POST', '/auth/password', {'password': 'test-passwort-16'}); A = {'x-csrf': J('GET', '/admin/api/me')[1]['csrf']}
tok = {}
for n in ('a', 'b'):
    tok[n] = J('POST', '/api/enroll', {'code': 'TEST-PHP-1234', 'name': 'PC-' + n.upper(), 'user': 'nutzer-' + n, 'upn': n + '@firma.de'})[1]['token']
H = lambda n: {'authorization': 'Bearer ' + tok[n]}

png = base64.b64encode(open(os.path.join(ROOT, 'sudo-desktop', 'assets', 'skins', 'ritter', 'sudo-sheet.png'), 'rb').read()).decode()
sheet = open(os.path.join(ROOT, 'sudo-desktop', 'assets', 'sudo-sheet.json'), encoding='utf-8').read()

c, r = J('POST', '/admin/api/skins', {'id': 'test-ritter', 'name': 'Test-Ritter', 'price': 250, 'target': 'all', 'png': png}, A)
check('Hochladen ohne Raster', c == 200 and r.get('updated') is False, (c, r))
c, r = J('POST', '/admin/api/skins', {'id': 'nur-b', 'name': 'Nur für B', 'price': 0, 'target': 'user:b@firma.de', 'png': png, 'sheet': sheet}, A)
check('Hochladen mit Raster, nur für B', c == 200, (c, r))
c, r = J('POST', '/admin/api/skins', {'id': 'kaputt', 'name': 'x', 'png': base64.b64encode(b'kein png').decode()}, A)
check('Kein PNG: 400 mit Meldung', c == 400 and r['message'] == 'Die Grafik ist kein PNG.', (c, r))
c, r = J('POST', '/admin/api/skins', {'id': 'kaputt', 'name': 'x', 'png': png, 'sheet': '{"cell":[48]}'}, A)
check('Raster unvollständig: 400 mit Meldung', c == 400 and r['message'] == 'Die Raster-Beschreibung des Skins ist unvollständig.', (c, r))
check('Ungültige Kennung: 400', J('POST', '/admin/api/skins', {'id': 'A B', 'name': 'x', 'png': png}, A)[0] == 400)

lst = J('GET', '/admin/api/skins', None, A)[1]
check('Verwaltung: zwei Skins, nach Preis', [k['id'] for k in lst['items']] == ['nur-b', 'test-ritter'], [k['id'] for k in lst['items']])
k0 = [k for k in lst['items'] if k['id'] == 'test-ritter'][0]
check('Verwaltung: Angaben', k0['price'] == 250 and k0['active'] is True and k0['sha'] == sha(png, None) and k0['png'] == png and k0['sheet'] is None, {k: v for k, v in k0.items() if k != 'png'})
check('Verwaltung: Standard „XP-Preise gelten“', lst['free'] is False, lst['free'])

ca, cb = cfg(tok['a']), cfg(tok['b'])
check('Gerät A sieht nur den Skin für alle', ca and [k['id'] for k in ca['items']] == ['test-ritter'] and ca['free'] is False, ca)
check('Gerät B sieht beide', cb and sorted(k['id'] for k in cb['items']) == ['nur-b', 'test-ritter'], cb)
check('Konfiguration ohne Grafik', ca and set(ca['items'][0].keys()) == {'id', 'name', 'price', 'sha'}, ca)
c, r = J('GET', '/api/skins/nur-b', None, H('b'))
check('Abruf: Grafik, Raster als Text, Prüfsumme passt', c == 200 and r['png'] == png and r['sheet'] == sheet and r['sha'] == sha(png, sheet) == [k for k in cb['items'] if k['id'] == 'nur-b'][0]['sha'], (c, r and {k: v for k, v in r.items() if k not in ('png', 'sheet')}))
check('Abruf fremdes Ziel: 404 mit Meldung', J('GET', '/api/skins/nur-b', None, H('a')) == (404, {'message': 'Skin nicht gefunden.'}))
check('Abruf ohne Anmeldung: 401', J('GET', '/api/skins/test-ritter')[0] == 401)

check('Preis ändern', J('PATCH', '/admin/api/skins/test-ritter', {'price': 120}, A)[0] == 200)
check('Gerät sieht neuen Preis', [k['price'] for k in cfg(tok['a'])['items'] if k['id'] == 'test-ritter'] == [120])
check('Pausieren', J('PATCH', '/admin/api/skins/test-ritter', {'active': False}, A)[0] == 200 and cfg(tok['a'])['items'] == [])
check('Pausiert: Abruf 404', J('GET', '/api/skins/test-ritter', None, H('a'))[0] == 404)
J('PATCH', '/admin/api/skins/test-ritter', {'active': True}, A)
check('Alle kostenlos', J('PUT', '/admin/api/settings', {'skins_free': 'true'}, A)[0] == 200 and cfg(tok['a'])['free'] is True)
check('Ungültiger Wert: 400', J('PUT', '/admin/api/settings', {'skins_free': 'ja'}, A)[0] == 400)
c, r = J('POST', '/admin/api/skins', {'id': 'test-ritter', 'name': 'Test-Ritter 2', 'price': 300, 'png': png, 'sheet': sheet}, A)
check('Gleiche Kennung ersetzt, neue Prüfsumme', c == 200 and r['updated'] is True and [k['sha'] for k in cfg(tok['a'])['items']] == [sha(png, sheet)], (c, r))
check('Löschen', J('DELETE', '/admin/api/skins/nur-b', None, A)[0] == 200)
check('Gelöscht: 404', J('DELETE', '/admin/api/skins/nur-b', None, A) == (404, {'message': 'Skin nicht gefunden.'}))
acts = [a['action'] for a in J('GET', '/admin/api/audit', None, A)[1][:12]]
check('Protokoll', all(x in acts for x in ('skin_add', 'skin_update', 'skin_edit', 'skin_delete')), acts)
print(f"\n{'Alles gut' if not fails else str(fails) + ' Fehler'} ({'PHP' if poll else 'Node'}, {B})")
