# test-auth.py – E2E-Test Notfall-Zugang (1.14): zweiter Faktor, Einmal-Codes, Sperre, kurze Sitzung, gesperrte Sicherungsdateien
# Frische Datenbank nötig und der Server muss mit dem Beispielschlüssel gestartet sein:
#   PHP:  $env:SUDO_TEST_TOTP='JBSWY3DPEHPK3PXP'  vor  php -S 127.0.0.1:8091 index.php
#   Node: $env:ADMIN_TOTP='JBSWY3DPEHPK3PXP'      vor  npm start   (und $env:SUDO_BASE='http://127.0.0.1:8090')
# Der Schlüssel ist der bekannte Beispielschlüssel aus der Dokumentation von Authenticator-Apps – kein Geheimnis.
import base64, hashlib, hmac, json, os, struct, time, urllib.request, http.cookiejar
B = os.environ.get('SUDO_BASE', 'http://127.0.0.1:8091')
SECRET = 'JBSWY3DPEHPK3PXP'
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
def J(m, u, b=None, h={}):
    r = urllib.request.Request(B + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={**({'content-type': 'application/json'} if b is not None else {}), **h})
    try: x = op.open(r); t = x.read().decode(); return x.status, (json.loads(t) if t else None), x.headers
    except urllib.error.HTTPError as e: t = e.read().decode(); return e.code, (json.loads(t) if t and t.strip().startswith('{') else None), e.headers
fails = 0
def check(name, cond, info=''):
    global fails
    if not cond: fails += 1
    print(('OK     ' if cond else 'FEHLER ') + name + ('' if cond else '  ->  ' + str(info)[:300]))
def totp(secret, offset=0):
    key = base64.b32decode(secret)
    step = int(time.time() // 30) + offset
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o = h[19] & 15
    return '%06d' % ((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000)

poll = J('GET', '/api/info')[1].get('transport') == 'poll'
# Kurz vor einem 30-Sekunden-Wechsel warten, damit der Code im Test nicht mittendrin ungültig wird
if time.time() % 30 > 24: time.sleep(31 - time.time() % 30)

info = J('GET', '/auth/info')[1]
check('Anmeldeseite weiß vom zweiten Faktor', info.get('password') is True and info.get('totp') is True, info)
c, r, _ = J('POST', '/auth/password', {'password': 'test-passwort-16', 'code': '000000' if totp(SECRET) != '000000' else '111111'})
check('Richtiges Passwort, falscher Code: 401', c == 401 and r['message'] == 'Passwort oder Code falsch.', (c, r))
c, r, _ = J('POST', '/auth/password', {'password': 'falsch', 'code': totp(SECRET)})
check('Falsches Passwort, richtiger Code: 401 (gleiche Meldung)', c == 401 and r['message'] == 'Passwort oder Code falsch.', (c, r))
code = totp(SECRET)
c, r, h = J('POST', '/auth/password', {'password': 'test-passwort-16', 'code': code})
check('Passwort und Code: angemeldet', c == 200 and r == {'ok': True}, (c, r))
cookie = h.get('Set-Cookie') or ''
check('Notfall-Sitzung läuft nach 2 Stunden ab', 'max-age=7200' in cookie.lower(), cookie)
me = J('GET', '/admin/api/me')[1]
check('Verwaltung meldet den Stand', me.get('security', {}).get('local') is True and me['security'].get('totp') is True, me.get('security'))
A = {'x-csrf': me['csrf']}
check('Schlüssel prüfen: passender Code', J('POST', '/admin/api/totp-check', {'secret': SECRET, 'code': totp(SECRET)}, A)[1] == {'ok': True})
check('Schlüssel prüfen: falscher Code', J('POST', '/admin/api/totp-check', {'secret': SECRET, 'code': '12345x'}, A)[1] == {'ok': False})
check('Schlüssel prüfen: ungültiger Schlüssel', J('POST', '/admin/api/totp-check', {'secret': 'ä!', 'code': '123456'}, A)[1] == {'ok': False})
acts = [a['action'] for a in J('GET', '/admin/api/audit', None, A)[1][:10]]
check('Fehlversuche im Protokoll', acts.count('login_failed') >= 2 and 'login' in acts, acts)
J('POST', '/auth/logout', {}, A)
cj.clear()
c, r, _ = J('POST', '/auth/password', {'password': 'test-passwort-16', 'code': code})
check('Derselbe Code ein zweites Mal: abgelehnt', c == 401, (c, r))
c, r, _ = J('POST', '/auth/password', {'password': 'x', 'code': '000000'})
check('Fünfter Versuch dieser Adresse: noch geprüft', c == 401, (c, r))
c, r, _ = J('POST', '/auth/password', {'password': 'test-passwort-16', 'code': totp(SECRET)})
check('Sechster Versuch: gesperrt (auch mit richtigen Daten)', c == 429 and r['message'] == 'Zu viele Versuche. In 15 Minuten noch mal.', (c, r))
if poll:
    for p in ('/config.php', '/config.php.bak', '/config.php~', '/app/auth.php', '/data/zentrale.sqlite', '/index.php.bak'):
        check('Gesperrt: ' + p, J('GET', p)[0] == 403, J('GET', p)[0])
print(f"\n{'Alles gut' if not fails else str(fails) + ' Fehler'} ({'PHP' if poll else 'Node'}, {B})")
