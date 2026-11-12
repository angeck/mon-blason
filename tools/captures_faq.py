#!/usr/bin/env python3
"""mypocketclub · 5.7.0 (n° 206), revu en 5.8.0 (n° 216) : fabrique les captures de la FAQ et de « Pour bien démarrer ».

Pour chaque fiche qui a « Me montrer », l'application refait les étapes (« Y aller ») avec le faux client des tests
(tests/faux_supabase.js : club de démonstration, aucune donnée réelle), puis photographie l'écran d'arrivée, zone à toucher
en jaune : img/faq/<fiche>-tel.jpg (téléphone) et img/faq/<fiche>-pc.jpg (ordinateur). La liste des captures réussies est
écrite dans js/faq_shots.js. Usage : python3 tools/captures_faq.py
5.8.0 : chaque fiche est photographiée avec le rôle qui la concerne (Trésorier, Secrétaire, Président…) ; la capture
téléphone est recadrée autour de la zone jaune (lisible en largeur téléphone) ; le rapport dit, pour chaque fiche,
jusqu'à quelle étape « Y aller » est arrivé (toutes les étapes doivent être atteintes).
"""
import http.server, os, threading, functools, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'img', 'faq')
os.makedirs(OUT, exist_ok=True)
FAKE = open(os.path.join(ROOT, 'tests', 'faux_supabase.js')).read()
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

PREP = """(async()=>{const {S,render}=await import('/js/core.js');
  const u=S.session.user; u.user_metadata={...(u.user_metadata||{}), onboarding:{hidden:true}, theme:'clair'};
  try { localStorage.setItem('pc_theme', 'clair'); } catch {}
  const c=S.clubs[S.clubId]; if (c) { c.color1='#2F5BFF'; c.color2='#FFC93C'; c.logo=null; }
  render();})()"""

# rôle du compte de test pour chaque famille de fiches (fonction de m1, présidence en plus)
FONC = {'SE': 'Secrétaire', 'CR': 'Correspondant rencontres', 'DT': 'Directeur technique', 'B1': 'Chargé de communication'}
def setup(pg, i):
    f = next((v for k, v in FONC.items() if i.startswith(k)), 'Trésorier')
    pres = 'true' if i.startswith('PR') else 'false'
    pg.evaluate("""(async([f,pres])=>{const D=window.__FAKE; D.memberships.find(m=>m.id==='m1').fonction=f;
      D.memberships=D.memberships.filter(m=>m.id!=='m10'); if(pres) D.memberships.push({id:'m10',club_id:'c-1',user_id:'u-me',role:'president',status:'active'});
      const c=await import('/js/core.js'); c.S.obShow=null; c.S.view=null; c.S.stack=[]; c.S.tab=0; c.S.casq=null; c.S.ftabs={}; c.S.ptab=null; c.S.lf=null; await c.refresh();})""", [f, pres == 'true'])
    pg.wait_for_timeout(250)

REPORT = {}
def shoot(pg, size, suffix, ids):
    ok = []
    pg.set_viewport_size(size)
    for i in ids:
        setup(pg, i)
        r = pg.evaluate("(async(id)=>{const m=await import('/js/v55.js'); return await m.goFiche(id);})", i)
        pg.wait_for_timeout(700)
        st = pg.evaluate("(async(id)=>{const m=await import('/js/v55.js'); return m.obProgress(id);})", i)
        REPORT.setdefault(i, {})[suffix] = st
        if r and pg.locator('.ob-hl').count():
            path = os.path.join(OUT, f'{i}-{suffix}.jpg')
            if suffix == 'tel':   # recadrée autour de la zone jaune, bandeau compris si possible
                b = pg.locator('.ob-hl').first.bounding_box()
                y = max(0, min(size['height'] - 560, int(b['y'] + b['height'] / 2 - 280)))
                pg.screenshot(path=path, type='jpeg', quality=72, clip={'x': 0, 'y': y, 'width': size['width'], 'height': 560})
            else:
                pg.screenshot(path=path, type='jpeg', quality=68)
            ok.append(i)
        pg.evaluate("(async()=>{const {S,render}=await import('/js/core.js'); S.obShow=null; S.view=null; S.stack=[]; S.tab=0; render();})()")
        pg.wait_for_timeout(150)
    return ok

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='fr-FR', device_scale_factor=1)
    ctx.route('https://cdn.jsdelivr.net/npm/@supabase/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=FAKE))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    ctx.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=''))
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg = ctx.new_page()
    pg.add_init_script("navigator.serviceWorker && (navigator.serviceWorker.register = () => Promise.resolve())")
    pg.goto('http://127.0.0.1:8766/index.html')
    pg.wait_for_selector('.tb', timeout=8000)
    pg.evaluate(PREP); pg.wait_for_timeout(300)
    ids = pg.evaluate("(async()=>{const m=await import('/js/v55.js'); return Object.entries(m.FICHES).filter(([,f])=>f.show).map(([k])=>k);})()")
    tel = shoot(pg, {'width': 390, 'height': 844}, 'tel', ids)
    pc = shoot(pg, {'width': 1280, 'height': 800}, 'pc', ids)
    b.close()
srv.shutdown()
both = [i for i in tel if i in pc]
for f in os.listdir(OUT):   # captures sans leur paire : retirées
    if f.split('-')[0] not in both: os.remove(os.path.join(OUT, f))
with open(os.path.join(ROOT, 'js', 'faq_shots.js'), 'w') as f:
    f.write('// Fabriqué par tools/captures_faq.py (5.7.0 · n° 206) : fiches qui ont une capture dans img/faq/\n')
    f.write('export const SHOTS = new Set(' + json.dumps(both) + ');\n')
print(len(both), 'fiches avec captures :', ' '.join(both))
for i, r in REPORT.items():
    t, p = r.get('tel', {}), r.get('pc', {})
    flag = '' if t.get('reached') and p.get('reached') else '   <-- étapes non atteintes'
    print(f"{i:4} tél. {t.get('at')}/{t.get('last')}  ordi {p.get('at')}/{p.get('last')}{flag}")
print('sans capture :', ' '.join(i for i in ids if i not in both))
