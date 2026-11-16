# test-dex.py – E2E-Test Mitarbeiter-Erlebnis (1.10): Stimmungsbarometer, „Läuft es wieder?“, Start-Checkliste, Tipps
# Frische Datenbank nötig. Gegen PHP (8091, Standard) oder Node: $env:SUDO_BASE='http://127.0.0.1:8090'
# Ohne Fremdpakete; „OK“/„FEHLER“ je Prüfung, am Ende die Summe.
import json, os, sys, urllib.request, http.cookiejar
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
J('POST', '/auth/password', {'password': 'test-passwort-16'}); A = {'x-csrf': J('GET', '/admin/api/me')[1]['csrf']}
devs = []
for i in range(7):
    c, d = J('POST', '/api/enroll', {'code': 'TEST-PHP-1234', 'name': f'PC{i}', 'user': f'nutzer{i}', 'upn': f'nutzer{i}@firma.de'})
    devs.append({'authorization': 'Bearer ' + d['token']})
D = devs[0]

# --- Einstellungen und Tipps
check('Tipps ungültig abgelehnt', J('PUT', '/admin/api/settings', {'tips_custom': json.dumps([{'app': 'excel', 'text': 'x'}])}, A)[0] == 400)
check('Tipps unbekanntes Programm abgelehnt', J('PUT', '/admin/api/settings', {'tips_custom': json.dumps([{'app': 'paint', 'text': 'Ein Tipp für Paint'}])}, A)[0] == 400)
c, d = J('PUT', '/admin/api/settings', {'pulse_min': '5', 'onboard_enabled': 'true', 'tips_custom': json.dumps([{'app': 'excel', 'text': 'Rechnungen liegen in <b>Buchhaltung</b>/Eingang.'}])}, A)
check('Einstellungen gespeichert', c == 200, d)
x = J('GET', '/admin/api/dex', None, A)[1]
check('Tipp ohne HTML gespeichert', x['tips'] == [{'app': 'excel', 'text': 'Rechnungen liegen in Buchhaltung/Eingang.'}], x['tips'])
check('Checkliste mitgeliefert (8 Punkte)', len(x['onboard']['items']) == 8, len(x['onboard']['items']))
check('Neue Geräte im Checklisten-Stand', len(x['onboard']['devices']) == 7, len(x['onboard']['devices']))

# --- Stimmungsbarometer
check('Frage zu kurz abgelehnt', J('POST', '/admin/api/pulse', {'question': 'kurz'}, A)[0] == 400)
check('Ziel ungültig abgelehnt', J('POST', '/admin/api/pulse', {'question': 'Wie gefällt dir das?', 'target': 'quatsch'}, A)[0] == 400)
c, d = J('POST', '/admin/api/pulse', {'question': 'Wie zufrieden bist du mit dem neuen Drucker?', 'days': 7, 'target': 'all'}, A)
check('Umfrage angelegt', c == 200 and d.get('id'), d); sid = d['id']
if poll:
    p = J('POST', '/api/poll', {}, D)[1]['dex']
    check('Abruf: Umfrage kommt an', [s['id'] for s in p['pulse']['surveys']] == [sid], p['pulse'])
    check('Abruf: Checkliste kommt an', p['onboard'] and len(p['onboard']['items']) == 8, p['onboard'])
    check('Abruf: eigener Tipp kommt an', p['tips']['items'][0]['app'] == 'excel', p['tips'])
check('Sterne außerhalb 1–5 abgelehnt', J('POST', '/api/pulse', {'id': sid, 'score': 9}, devs[1])[0] == 400)
for i, sc in enumerate([5, 4, 4, 2]): J('POST', '/api/pulse', {'id': sid, 'score': sc, 'comment': 'Toner leer' if i == 3 else ''}, devs[i])
x = J('GET', '/admin/api/dex', None, A)[1]; p0 = [p for p in x['pulse'] if p['id'] == sid][0]
check('Unter 5 Antworten: keine Auswertung', not p0['enough'] and p0['avg'] is None and p0['comments'] == [] and p0['n'] == 4, p0)
check('Zweite Antwort desselben Geräts ignoriert', J('POST', '/api/pulse', {'id': sid, 'score': 1}, devs[0])[1] == {'ok': True, 'already': True})
J('POST', '/api/pulse', {'id': sid, 'score': 3}, devs[4])
check('Überspringen', J('POST', '/api/pulse', {'id': sid, 'skip': True}, devs[5])[1] == {'ok': True, 'skipped': True})
x = J('GET', '/admin/api/dex', None, A)[1]; p0 = [p for p in x['pulse'] if p['id'] == sid][0]
check('Ab 5 Antworten: Durchschnitt 3,6', p0['enough'] and p0['avg'] == 3.6 and p0['n'] == 5 and p0['skipped'] == 1, p0)
check('Verteilung stimmt', p0['dist'] in ({'1': 0, '2': 1, '3': 1, '4': 2, '5': 1}, {1: 0, 2: 1, 3: 1, 4: 2, 5: 1}), p0['dist'])
check('Anmerkung ohne Gerät', p0['comments'] and p0['comments'][0]['text'] == 'Toner leer' and set(p0['comments'][0].keys()) == {'day', 'score', 'text'}, p0['comments'])
check('Nach Gerätezustand (ohne Angabe)', p0['byHealth']['unknown']['n'] == 5, p0['byHealth'])
if poll: check('Beantwortet: nicht mehr im Abruf', J('POST', '/api/poll', {}, D)[1]['dex']['pulse']['surveys'] == [])
check('Umfrage beenden', J('POST', f'/admin/api/pulse/{sid}/end', {}, A)[0] == 200)
check('Beendet: keine Antwort mehr', J('POST', '/api/pulse', {'id': sid, 'score': 4}, devs[6])[0] == 404)
J('PUT', '/admin/api/settings', {'pulse_monthly': 'true'}, A)
x = J('GET', '/admin/api/dex', None, A)[1]
check('Monatsfrage legt sich selbst an', any(p['kind'] == 'monthly' and p['active'] for p in x['pulse']), [(p['kind'], p['active']) for p in x['pulse']])
J('GET', '/admin/api/dex', None, A); x = J('GET', '/admin/api/dex', None, A)[1]
check('Monatsfrage nur einmal', sum(1 for p in x['pulse'] if p['kind'] == 'monthly') == 1)

# --- Läuft es wieder?
c, d = J('POST', '/admin/api/incidents', {'title': 'VPN gestört', 'sev': 'stoerung', 'target': 'all'}, A); iid = d['id']
check('Rückmeldung zu offener Störung abgelehnt', J('POST', '/api/pulse/incident', {'id': iid, 'ok': True}, devs[0])[0] == 404)
J('POST', '/api/incident/affected', {'id': iid, 'on': True}, devs[0]); J('POST', '/api/incident/affected', {'id': iid, 'on': True}, devs[1])
J('POST', f'/admin/api/incidents/{iid}/resolve', {'text': 'Läuft wieder'}, A)
check('Läuft wieder (ja)', J('POST', '/api/pulse/incident', {'id': iid, 'ok': True}, devs[0])[0] == 200)
check('Geht noch nicht (nein)', J('POST', '/api/pulse/incident', {'id': iid, 'ok': False}, devs[1])[0] == 200)
f = J('GET', '/admin/api/dex', None, A)[1]['feedback']
check('Verwaltung: 1 ok, 1 mit Namen offen', f and f[0]['ok'] == 1 and [s['user'] for s in f[0]['still']] == ['nutzer1@firma.de'], f)
check('Protokoll: geht noch nicht', any(a['action'] == 'incident_still' for a in J('GET', '/admin/api/audit', None, A)[1]))

# --- Start-Checkliste
items = J('GET', '/admin/api/dex', None, A)[1]['onboard']['items']
check('Unbekannte Prüfung abgelehnt', J('POST', '/admin/api/onboard', {'title': 'VPN einrichten', 'check': 'vpn'}, A)[0] == 400)
check('Link http abgelehnt', J('POST', '/admin/api/onboard', {'title': 'VPN einrichten', 'link': 'http://x.de'}, A)[0] == 400)
c, d = J('POST', '/admin/api/onboard', {'title': 'VPN einrichten', 'check': 'manual', 'link': 'sudo:wissen', 'target': 'all'}, A)
check('Eigener Punkt angelegt', c == 200, d); new = d['id']
check('Gerät hakt ab (manuell)', J('POST', '/api/onboard', {'id': new, 'done': True}, D)[0] == 200)
check('Gerät hakt ab (automatisch)', J('POST', '/api/onboard', {'id': items[1]['id'], 'done': True, 'auto': True}, D)[0] == 200)
check('Unbekannter Punkt abgelehnt', J('POST', '/api/onboard', {'id': 99999, 'done': True}, D)[0] == 404)
dv = [d for d in J('GET', '/admin/api/dex', None, A)[1]['onboard']['devices'] if d['name'] == 'PC0'][0]
check('Fortschritt 2 von 9', dv['done'] == 2 and dv['total'] == 9 and 'VPN einrichten' not in dv['open'], dv)
J('PATCH', f'/admin/api/onboard/{new}', {'active': False}, A)
dv = [d for d in J('GET', '/admin/api/dex', None, A)[1]['onboard']['devices'] if d['name'] == 'PC0'][0]
check('Pausierter Punkt zählt nicht', dv['total'] == 8 and dv['done'] == 1, dv)
J('PATCH', f'/admin/api/onboard/{items[0]["id"]}', {'move': 1}, A)
it2 = J('GET', '/admin/api/dex', None, A)[1]['onboard']['items']
check('Verschieben', it2[1]['id'] == items[0]['id'], [i['title'] for i in it2[:3]])
check('Erneut zeigen', J('POST', f'/admin/api/onboard/device/{dv["id"]}', {}, A)[0] == 200)
check('Punkt löschen', J('DELETE', f'/admin/api/onboard/{new}', None, A)[0] == 200)
if poll:
    J('PUT', '/admin/api/settings', {'onboard_days': '1'}, A)
    check('Checkliste noch da (erneut gezeigt)', J('POST', '/api/poll', {}, D)[1]['dex']['onboard'] is not None)
    J('PUT', '/admin/api/settings', {'onboard_enabled': 'false'}, A)
    check('Checkliste aus: kommt nicht mehr', J('POST', '/api/poll', {}, D)[1]['dex']['onboard'] is None)

# --- Selbsthilfe-Zähler kennt die neuen Werkzeuge
check('Selbsthilfe „slow“ gezählt', J('POST', '/api/selfhelp', {'tool': 'slow', 'ok': True}, D)[0] == 200)
check('Selbsthilfe „meet“ gezählt', J('POST', '/api/selfhelp', {'tool': 'meet', 'ok': False}, D)[0] == 200)
check('Umfrage löschen', J('DELETE', f'/admin/api/pulse/{sid}', None, A)[0] == 200)
check('Ohne Anmeldung: 401', J('POST', '/api/pulse', {'id': 1, 'score': 3})[0] == 401)
print(f"\n{'Alles gut' if not fails else str(fails) + ' Fehler'} ({'PHP' if poll else 'Node'}, {B})")
sys.exit(1 if fails else 0)
