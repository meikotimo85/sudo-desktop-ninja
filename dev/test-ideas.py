# test-ideas.py – E2E-Test Ideen-Board (1.15): Einreichen, Spam-Schutz, Freigabe, Stimmen, CORS, Mail, Verwaltung
# Frische Datenbank nötig. Gegen PHP (8091, Standard) oder Node: $env:SUDO_BASE='http://127.0.0.1:8090'
# Mail-Prüfung: Zentrale mit Mail-Ordner starten (PHP: SUDO_TEST_MAILDIR für config.test.php, Node: MAIL_DIR)
# und denselben Ordner hier als SUDO_TEST_MAILDIR setzen – ohne Ordner wird die Mail-Prüfung übersprungen.
import glob, json, os, urllib.request, http.cookiejar
B = os.environ.get('SUDO_BASE', 'http://127.0.0.1:8091')
MAILDIR = os.environ.get('SUDO_TEST_MAILDIR', '')
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
def J(m, u, b=None, h={}, full=False):
    r = urllib.request.Request(B + u, method=m, data=json.dumps(b).encode() if b is not None else None, headers={**({'content-type': 'application/json'} if b is not None else {}), **h})
    try: x = op.open(r); t = x.read().decode(); res = (x.status, (json.loads(t) if t else None), dict(x.headers))
    except urllib.error.HTTPError as e: t = e.read().decode(); res = (e.code, (json.loads(t) if t else None), dict(e.headers))
    return res if full else res[:2]
fails = 0
def check(name, cond, info=''):
    global fails
    if not cond: fails += 1
    print(('OK     ' if cond else 'FEHLER ') + name + ('' if cond else '  ->  ' + str(info)[:300]))
hdr = lambda hs, k: next((v for kk, v in hs.items() if kk.lower() == k), None)

J('POST', '/auth/password', {'password': 'test-passwort-16'}); A = {'x-csrf': J('GET', '/admin/api/me')[1]['csrf']}
idea = lambda **kw: {'title': 'Termine im Sudo', 'text': 'Sudo zeigt mir kurz vor einem Termin eine Erinnerung.', 'ms': 5000, **kw}

# Ausgeschaltet (Standard)
c, r = J('GET', '/api/ideas')
check('Aus: Liste leer und enabled false', c == 200 and r == {'enabled': False, 'items': []}, (c, r))
c, r = J('POST', '/api/ideas', idea())
check('Aus: Einreichen 403', c == 403 and r['message'] == 'Das Ideen-Board ist ausgeschaltet.', (c, r))

c, r = J('PUT', '/admin/api/settings', {'ideas_enabled': 'true', 'ideas_mail': 'it@firma.de', 'ideas_origins': 'https://info.firma.de, http://127.0.0.1:8099'}, A)
check('Einschalten mit Mail und Infoseiten-Adresse', c == 200 and r['settings']['ideas_enabled'] == 'true', (c, r))
check('Ungültige Mail-Adresse: 400', J('PUT', '/admin/api/settings', {'ideas_mail': 'keine-mail'}, A)[0] == 400)
check('Ungültige Infoseiten-Adresse: 400', J('PUT', '/admin/api/settings', {'ideas_origins': 'javascript:alert(1)'}, A)[0] == 400)

# Spam-Schutz und Prüfungen
c, r = J('POST', '/api/ideas', idea(website='http://spam'))
check('Verstecktes Feld ausgefüllt: 400', c == 400 and r['message'] == 'Das hat leider nicht geklappt. Bitte noch einmal versuchen.', (c, r))
check('Zu schnell ausgefüllt: 400', J('POST', '/api/ideas', idea(ms=800))[0] == 400)
c, r = J('POST', '/api/ideas', idea(title='Hi'))
check('Titel zu kurz: 400 mit Meldung', c == 400 and r['message'] == 'Bitte einen Titel mit mindestens 5 Zeichen angeben.', (c, r))
c, r = J('POST', '/api/ideas', idea(text='kurz'))
check('Text zu kurz: 400 mit Meldung', c == 400 and r['message'] == 'Bitte die Idee in mindestens 10 Zeichen beschreiben.', (c, r))
c, r = J('POST', '/api/ideas', idea(email='nicht-gültig'))
check('Falsche E-Mail: 400 mit Meldung', c == 400 and r['message'] == 'Die E-Mail-Adresse sieht nicht richtig aus.', (c, r))

# Einreichen – wartet auf Freigabe
c, r = J('POST', '/api/ideas', idea(name='Kim', email='kim@firma.de', title='Termine\r\nim Sudo'))
check('Einreichen: ok, nicht öffentlich', c == 200 and r['ok'] and r['public'] is False and isinstance(r['id'], int), (c, r))
i1 = r['id']
check('Einreichen: Hinweis auf Freigabe', 'kurzen Blick der IT' in r['message'], r)
check('Öffentliche Liste noch leer', J('GET', '/api/ideas')[1]['items'] == [])
if MAILDIR:
    f = glob.glob(os.path.join(MAILDIR, 'idee-%d.eml' % i1))
    m = open(f[0], encoding='utf-8', errors='replace').read() if f else ''
    check('Mail an die IT abgelegt', bool(f) and 'it@firma.de' in m and 'Reply-To: kim@firma.de' in m, m[:300])
    check('Mail ohne Zeilenumbruch im Betreff', bool(f) and '\nim Sudo' not in m.split('\r\n\r\n')[0], m[:300])
else: print('--     Mail-Prüfung übersprungen (SUDO_TEST_MAILDIR fehlt)')

adm = J('GET', '/admin/api/ideas', None, A)[1]
a1 = [x for x in adm['items'] if x['id'] == i1][0]
check('Verwaltung sieht Name, Mail und Stand', a1['name'] == 'Kim' and a1['email'] == 'kim@firma.de' and a1['status'] == 'neu' and a1['public'] is False and a1['title'] == 'Termine im Sudo', a1)
check('Verwaltung: Mail-Empfänger', adm['mail']['to'] == 'it@firma.de', adm['mail'])

# Abstimmen geht erst nach Freigabe
V1, V2 = 'browser-eins-1234567890', 'browser-zwei-1234567890'
check('Stimme für verborgene Idee: 404', J('POST', '/api/ideas/%d/vote' % i1, {'voter': V1})[0] == 404)
check('Freigeben', J('PATCH', '/admin/api/ideas/%d' % i1, {'public': True, 'answer': 'Klingt gut, schauen wir uns an.'}, A)[0] == 200)
pub = J('GET', '/api/ideas')[1]['items']
check('Öffentlich ohne Name und Mail', len(pub) == 1 and set(pub[0]) == {'id', 'title', 'text', 'status', 'votes', 'answer', 'created'} and pub[0]['answer'].startswith('Klingt gut'), pub)

c, r = J('POST', '/api/ideas/%d/vote' % i1, {'voter': V1})
check('Erste Stimme', c == 200 and r == {'ok': True, 'votes': 1, 'voted': True}, (c, r))
check('Gleicher Browser zählt nur einmal', J('POST', '/api/ideas/%d/vote' % i1, {'voter': V1})[1]['votes'] == 1)
check('Zweiter Browser', J('POST', '/api/ideas/%d/vote' % i1, {'voter': V2})[1]['votes'] == 2)
c, r = J('POST', '/api/ideas/%d/vote' % i1, {'voter': V2, 'off': True})
check('Stimme zurücknehmen', c == 200 and r['votes'] == 1 and r['voted'] is False, (c, r))
check('Ungültige Kennung: 400', J('POST', '/api/ideas/%d/vote' % i1, {'voter': 'kurz'})[0] == 400)
check('Unbekannte Idee: 404', J('POST', '/api/ideas/999999/vote', {'voter': V1})[0] == 404)
check('Kaputte Adresse: 404', J('POST', '/api/ideas/abc/vote', {'voter': V1})[0] == 404)

# Sofort öffentlich
J('PUT', '/admin/api/settings', {'ideas_auto': 'true'}, A)
c, r = J('POST', '/api/ideas', idea(title='Dunkles Design'))
check('Sofort öffentlich', c == 200 and r['public'] is True, (c, r))
i2 = r['id']
items = J('GET', '/api/ideas')[1]['items']
check('Liste nach Stimmen sortiert', [x['id'] for x in items] == [i1, i2], [x['id'] for x in items])

# Stand: umgesetzt sperrt das Abstimmen
check('Unbekannter Stand: 400', J('PATCH', '/admin/api/ideas/%d' % i2, {'status': 'fertig'}, A)[0] == 400)
J('PATCH', '/admin/api/ideas/%d' % i2, {'status': 'umgesetzt'}, A)
c, r = J('POST', '/api/ideas/%d/vote' % i2, {'voter': V1})
check('Umgesetzt: keine Stimmen mehr (409)', c == 409 and r['message'] == 'Für diese Idee kann nicht mehr abgestimmt werden.', (c, r))

# CORS nur für freigegebene Adressen
c, r, h = J('GET', '/api/ideas', None, {'Origin': 'https://info.firma.de'}, full=True)
check('CORS: freigegebene Adresse', hdr(h, 'access-control-allow-origin') == 'https://info.firma.de', h)
c, r, h = J('GET', '/api/ideas', None, {'Origin': 'https://boese.example'}, full=True)
check('CORS: fremde Adresse ohne Freigabe', hdr(h, 'access-control-allow-origin') is None, h)
c, r, h = J('OPTIONS', '/api/ideas', None, {'Origin': 'http://127.0.0.1:8099', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}, full=True)
check('CORS: Vorabanfrage 204', c == 204 and hdr(h, 'access-control-allow-origin') == 'http://127.0.0.1:8099' and 'POST' in (hdr(h, 'access-control-allow-methods') or ''), (c, h))

# Begrenzung: höchstens 5 Ideen je Adresse und Stunde (2 sind schon eingereicht)
codes = [J('POST', '/api/ideas', idea(title='Idee Nummer %d' % n))[0] for n in range(4)]
check('Begrenzung: die sechste Idee wird abgewiesen', codes == [200, 200, 200, 429], codes)

# Löschen
check('Löschen', J('DELETE', '/admin/api/ideas/%d' % i1, None, A)[0] == 200)
check('Gelöschte Idee: 404 in der Verwaltung', J('PATCH', '/admin/api/ideas/%d' % i1, {'public': False}, A)[0] == 404)
check('Gelöschte Idee nicht mehr öffentlich', i1 not in [x['id'] for x in J('GET', '/api/ideas')[1]['items']])
check('Protokoll', any(a['action'] == 'idea_add' for a in J('GET', '/admin/api/audit', None, A)[1]))

print('\n' + ('Alles grün.' if not fails else '%d Fehler.' % fails))
raise SystemExit(1 if fails else 0)
