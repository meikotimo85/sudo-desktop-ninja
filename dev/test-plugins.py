# test-plugins.py – E2E-Test Plugins (1.12): Hochladen, Ziele, Abruf durch die Sudos, Ersetzen, Pausieren, Löschen
# Frische Datenbank nötig. Gegen PHP (8091, Standard) oder Node: $env:SUDO_BASE='http://127.0.0.1:8090'
# Gegen Node holt der Test die Konfiguration über WebSocket (braucht „node“ ab Version 22 im PATH).
# Ohne Fremdpakete; „OK“/„FEHLER“ je Prüfung, am Ende die Summe.
import hashlib, json, os, subprocess, urllib.request, http.cookiejar
B = os.environ.get('SUDO_BASE', 'http://127.0.0.1:8091')
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
def plugins_cfg(tok):
    """Was das Gerät unter „plugins“ bekommt – PHP über /api/poll, Node über die Begrüßung per WebSocket"""
    if poll: return J('POST', '/api/poll', {}, {'authorization': 'Bearer ' + tok})[1].get('plugins')
    js = ("const w=new WebSocket(process.argv[1]);w.onopen=()=>w.send(JSON.stringify({t:'hello',token:process.argv[2],version:'1.12.0'}));"
          "w.onmessage=e=>{const d=JSON.parse(e.data);if(d.t==='welcome'){console.log(JSON.stringify(d.plugins));process.exit(0)}};setTimeout(()=>process.exit(2),5000)")
    out = subprocess.run(['node', '-e', js, B.replace('http', 'ws', 1) + '/api/ws', tok], capture_output=True, text=True, timeout=10).stdout.strip()
    return json.loads(out) if out else None

J('POST', '/auth/password', {'password': 'test-passwort-16'}); A = {'x-csrf': J('GET', '/admin/api/me')[1]['csrf']}
tok = {}
for n in ('a', 'b'):
    c, d = J('POST', '/api/enroll', {'code': 'TEST-PHP-1234', 'name': 'PC-' + n.upper(), 'user': 'nutzer-' + n, 'upn': n + '@firma.de'})
    tok[n] = d['token']
H = lambda n: {'authorization': 'Bearer ' + tok[n]}

page = lambda t: f'<!DOCTYPE html><html><head><title>{t}</title></head><body><h1>{t}</h1></body></html>'
html1 = page('Namens-Generator')
# --- Hochladen und prüfen
c, r = J('POST', '/admin/api/plugins', {'id': 'naming', 'name': 'Namens-Generator', 'version': '1.0', 'w': 900, 'h': 760, 'target': 'all', 'html': html1}, A)
check('Hochladen', c == 200 and r.get('ok') and r.get('updated') is False, (c, r))
check('Kennung ungültig: 400', J('POST', '/admin/api/plugins', {'id': 'X y', 'name': 'x', 'html': html1}, A)[0] == 400)
c, r = J('POST', '/admin/api/plugins', {'id': 'kein-html', 'name': 'x', 'html': 'nur Text'}, A)
check('Kein HTML: 400 mit Meldung', c == 400 and r['message'] == 'Das ist keine HTML-Datei.', (c, r))
c, r = J('POST', '/admin/api/plugins', {'id': 'zu-gross', 'name': 'x', 'html': '<html><body>' + 'x' * 2097200 + '</body></html>'}, A)
check('Größer als 2 MB: 400 mit Meldung', c == 400 and r['message'] == 'Das Plugin ist größer als 2 MB.', (c, r))
check('Ohne Name: 400', J('POST', '/admin/api/plugins', {'id': 'ohne-name', 'name': ' ', 'html': html1}, A)[0] == 400)
c, r = J('POST', '/admin/api/plugins', {'id': 'nur-a', 'name': 'Nur für A', 'target': 'user:a@firma.de', 'html': page('Nur A')}, A)
check('Zweites Plugin nur für A', c == 200, (c, r))

lst = J('GET', '/admin/api/plugins', None, A)[1]
check('Verwaltung: Liste mit 2 Plugins', [p['id'] for p in lst['items']] == ['naming', 'nur-a'], lst)
p0 = lst['items'][0]
check('Verwaltung: Angaben vollständig', p0['name'] == 'Namens-Generator' and p0['version'] == '1.0' and p0['w'] == 900 and p0['h'] == 760
      and p0['size'] == len(html1) and p0['active'] is True and p0['target'] == 'all' and p0['sha'] == hashlib.sha256(html1.encode()).hexdigest(), p0)
check('Verwaltung: eigene Plugins erlaubt (Standard)', lst['user'] is True, lst)
check('Verwaltung: kein HTML in der Liste', 'html' not in p0, p0.keys())

# --- Was die Geräte bekommen
ca, cb = plugins_cfg(tok['a']), plugins_cfg(tok['b'])
check('Gerät A: beide Plugins', ca and [p['id'] for p in ca['items']] == ['naming', 'nur-a'], ca)
check('Gerät B: nur das für alle', cb and [p['id'] for p in cb['items']] == ['naming'], cb)
check('Konfiguration ohne HTML, mit Prüfsumme', ca and set(ca['items'][0].keys()) == {'id', 'name', 'version', 'sha', 'w', 'h'}, ca)
c, r = J('GET', '/api/plugins/naming', None, H('b'))
check('Abruf: HTML und Prüfsumme passen', c == 200 and r['html'] == html1 and hashlib.sha256(r['html'].encode()).hexdigest() == r['sha'], (c, r and {k: v for k, v in r.items() if k != 'html'}))
check('Abruf fremdes Ziel: 404', J('GET', '/api/plugins/nur-a', None, H('b'))[0] == 404)
check('Abruf unbekannt: 404 mit Meldung', J('GET', '/api/plugins/gibts-nicht', None, H('a')) == (404, {'message': 'Plugin nicht gefunden.'}))
check('Abruf ohne Anmeldung: 401', J('GET', '/api/plugins/naming')[0] == 401)

# --- Ersetzen, Ziel ändern, pausieren
html2 = page('Namens-Generator 2')
c, r = J('POST', '/admin/api/plugins', {'id': 'naming', 'name': 'Namens-Generator', 'version': '1.1', 'target': 'all', 'html': html2}, A)
check('Gleiche Kennung ersetzt', c == 200 and r.get('updated') is True, (c, r))
ca = plugins_cfg(tok['a'])
check('Gerät sieht neue Prüfsumme und Version', ca and ca['items'][0]['sha'] == hashlib.sha256(html2.encode()).hexdigest() and ca['items'][0]['version'] == '1.1', ca)
check('Ziel ändern', J('PATCH', '/admin/api/plugins/nur-a', {'target': 'user:b@firma.de'}, A)[0] == 200)
check('Ziel gewechselt: B bekommt es', J('GET', '/api/plugins/nur-a', None, H('b'))[0] == 200 and J('GET', '/api/plugins/nur-a', None, H('a'))[0] == 404)
check('Pausieren', J('PATCH', '/admin/api/plugins/naming', {'active': False}, A)[0] == 200)
ca = plugins_cfg(tok['a'])
check('Pausiert: nicht mehr in der Konfiguration', ca and 'naming' not in [p['id'] for p in ca['items']], ca)
check('Pausiert: Abruf 404', J('GET', '/api/plugins/naming', None, H('a'))[0] == 404)
check('Wieder aktiv', J('PATCH', '/admin/api/plugins/naming', {'active': True}, A)[0] == 200 and J('GET', '/api/plugins/naming', None, H('a'))[0] == 200)

# --- Eigene Plugins verbieten
check('Eigene Plugins verbieten', J('PUT', '/admin/api/settings', {'plugins_user': 'false'}, A)[0] == 200)
check('Gerät erfährt es', (plugins_cfg(tok['a']) or {}).get('user') is False)
check('Ungültiger Wert: 400', J('PUT', '/admin/api/settings', {'plugins_user': 'vielleicht'}, A)[0] == 400)

# --- Löschen und Protokoll
check('Löschen', J('DELETE', '/admin/api/plugins/nur-a', None, A)[0] == 200)
check('Gelöscht: 404', J('DELETE', '/admin/api/plugins/nur-a', None, A) == (404, {'message': 'Plugin nicht gefunden.'}))
try: urllib.request.build_opener(urllib.request.ProxyHandler({})).open(B + '/admin/api/plugins'); anon = 200
except urllib.error.HTTPError as e: anon = e.code
check('Verwaltung ohne Anmeldung: 401', anon == 401, anon)
acts = [a['action'] for a in J('GET', '/admin/api/audit', None, A)[1]]
check('Protokoll', all(x in acts for x in ('plugin_add', 'plugin_update', 'plugin_edit', 'plugin_delete')), acts[:10])
print(f"\n{'Alles gut' if not fails else str(fails) + ' Fehler'} ({'PHP' if poll else 'Node'}, {B})")
