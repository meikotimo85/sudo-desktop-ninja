import json, sys, urllib.request, http.cookiejar, time
import os
B=os.environ.get('SUDO_BASE','http://127.0.0.1:8091')
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}))
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
opn=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.ProxyHandler({}), NoRedir)
def R(m,u,b=None,h={},o=op):
    r=urllib.request.Request(B+u if u.startswith('/') else u,method=m,data=json.dumps(b).encode() if b is not None else None,headers={**({'content-type':'application/json'} if b is not None else {}),**h})
    try: x=o.open(r); return x.status, x.read().decode(), x.headers
    except urllib.error.HTTPError as e: return e.code, e.read().decode(), e.headers
def J(m,u,b=None,h={}): c,t,_=R(m,u,b,h); return c,(json.loads(t) if t else None)
R('POST','/auth/password',{'password':'test-passwort-16'}); csrf=J('GET','/admin/api/me')[1]['csrf']; A={'x-csrf':csrf}
tok=J('POST','/api/enroll',{'code':'TEST-PHP-1234','name':'PC-TEST-01','user':'meiko','upn':'admin@firma.de'})[1]['token']; D={'authorization':'Bearer '+tok}
# --- YouTube
print('add @ct3003:', J('POST','/admin/api/youtube',{'input':'https://www.youtube.com/@ct3003','target':'all'},A))
print('add UCbbb:', J('POST','/admin/api/youtube',{'input':'UCbbbbbbbbbbbbbbbbbbbbbb'},A)[1]['title'])
print('add unbekannt:', J('POST','/admin/api/youtube',{'input':'@gibtsnicht'},A))
print('doppelt:', J('POST','/admin/api/youtube',{'input':'UCaaaaaaaaaaaaaaaaaaaaaa'},A))
urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4800/_add?ch=UCaaaaaaaaaaaaaaaaaaaaaa&id=new111aaaaa&title=Windows%2012%20im%20Test')
urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4800/_add?ch=UCaaaaaaaaaaaaaaaaaaaaaa&id=short1aaaaa&title=Kurz&short=1')
print('check:', J('POST','/admin/api/youtube/check',{},A)[1])
print('check nochmal:', J('POST','/admin/api/youtube/check',{},A)[1])
p=J('POST','/api/poll',{},D)[1]; print('poll media:', p['media']); print('poll events:', [e['event'] for e in p['events']])
# --- Spotify
print('music vor Verbindung:', J('GET','/api/music',None,D)[1])
print('settings:', J('PUT','/admin/api/settings',{'spotify_client_id':'0123456789abcdef0123456789abcdef','spotify_client_secret':'fedcba9876543210fedcba9876543210'},A)[0])
c,t,h=R('GET','/admin/spotify/login',o=opn); loc=h['Location']; print('login →', c, loc[:60])
c,t,h=R('GET',loc,o=opn); cb=h['Location']; print('authorize →', c, cb[:70])
c,t,h=R('GET',cb.replace('localhost','127.0.0.1'),o=opn); print('callback →', c, h['Location'])
d=J('GET','/admin/api/music',None,A)[1]; print('admin:', d['settings']['connected'], d['settings']['account'], [x['name'] for x in d['devices']], d['playing'])
print('settings secret sichtbar?', 'spotify_client_secret' in J('GET','/admin/api/settings',None,A)[1])
J('PUT','/admin/api/settings',{'spotify_device_id':'echo1','spotify_device_name':'Echo Büro','music_enabled':'true','music_cost':'100','music_per_day':'2','music_gap_min':'0','music_from':'00:00','music_to':'24:00'},A)
print('status:', J('GET','/api/music',None,D)[1])
s=J('POST','/api/music/search',{'q':'alle'},D)[1]; print('suche:', [(t['name'],t['explicit']) for t in s['tracks']])
print('fremde id:', J('POST','/api/music/request',{'id':'t3','xp':500},D))
print('zu wenig XP:', J('POST','/api/music/request',{'id':'t1','xp':50},D))
print('wunsch:', J('POST','/api/music/request',{'id':'t1','xp':500},D))
print('wunsch 2:', J('POST','/api/music/request',{'id':'t2','xp':400},D)[0])
print('wunsch 3 (Limit):', J('POST','/api/music/request',{'id':'t2','xp':300},D))
print('queue:', json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4800/_queue').read()))
p=J('POST','/api/poll',{},D)[1]; print('ansage:', [e['event'] for e in p['events'] if e['event']['type']=='music'])
J('PUT','/admin/api/settings',{'spotify_device_id':'weg','music_per_day':'5'},A)
print('kein Gerät:', J('POST','/api/music/request',{'id':'t2','xp':300},D))
print('admin recent:', [(r['title'],r['status'],r['from']) for r in J('GET','/admin/api/music',None,A)[1]['recent']])
# --- 1.8.1: Live-Status, Überspringen, Sperren
M=lambda p: json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:4800'+p).read())
J('PUT','/admin/api/settings',{'spotify_device_id':'echo1','music_per_day':'9','music_gap_min':'0'},A)
d=J('GET','/admin/api/music',None,A)[1]; print('live:', [(r['title'],r['status'],r['pos']) for r in d['recent']], 'queue:', [t['name'] for t in d['queue']['queue']])
print('next ->', M('/_next')['current']['name'])
d=J('GET','/admin/api/music',None,A)[1]; print('live2:', [(r['title'],r['status'],r['pos']) for r in d['recent']])
rid=[r for r in d['recent'] if r['title']=='Africa' and r['status']=='queued'][0]['id']
print('veto Africa:', J('POST',f'/admin/api/music/veto/{rid}',{},A))
print('suche africa gesperrt:', [t['name'] for t in J('POST','/api/music/search',{'q':'alle'},D)[1]['tracks']])
print('wunsch africa:', J('POST','/api/music/request',{'id':'t2','xp':900},D))
print('next ->', M('/_next')['current']['name'])
time.sleep(11); J('POST','/api/poll',{},D); time.sleep(1.5)
st=M('/_state'); print('nach watch: current', st['current']['name'], 'nextCalls', st['nextCalls'])
d=J('GET','/admin/api/music',None,A)[1]; print('live3:', [(r['title'],r['status']) for r in d['recent']], 'blocked:', [b['title'] for b in d['blocked']])
print('skip:', J('POST','/admin/api/music/skip',{},A), M('/_state')['nextCalls'])
print('unblock:', J('DELETE','/admin/api/music/blocked/t2',None,A), len(J('GET','/admin/api/music',None,A)[1]['blocked']))
print('audit:', [a['action'] for a in J('GET','/admin/api/audit',None,A)[1][:6]] if isinstance(J('GET','/admin/api/audit',None,A)[1],list) else 'n/a')
