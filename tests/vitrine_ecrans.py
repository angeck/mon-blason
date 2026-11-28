#!/usr/bin/env python3
"""mypocketclub · bêta 1.9.0 : tests de la page publique « vitrine » (vitrine.html, 404.html, js/vitrine.js) dans un navigateur sans écran,
avec un petit faux client Supabase (données fictives, aucun enfant réel).
Usage : python3 tests/vitrine_ecrans.py [dossier_captures]"""
import http.server, os, sys, threading, functools, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else None
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
class H(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):  # comme GitHub Pages : une adresse inconnue sert 404.html
        if code == 404:
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().send_error(code, message, explain)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

T1, T2, T3 = '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'
DATA = {
  'club': {'id': 'c0c0c0c0-0000-0000-0000-000000000001', 'name': 'Basket Club des Tilleuls', 'city': 'Lardy', 'sport': 'Basket-ball', 'postal_code': '91510', 'logo': None, 'color1': '#2F5BFF', 'color2': '#FFC93C', 'crest_bg': None, 'mpc': True},
  'slug': 'bc-tilleuls-91', 'enabled': True, 'season': '2026-2027', 'logged': False, 'can_edit': False,
  'content': {'presentation': 'Un club familial où chacun trouve sa place.', 'values': ['Convivialité', 'Formation'], 'fees': [['U7 à U11', '120 €'], ['Seniors', '180 €']],
              'docs': ['Certificat médical'], 'when': ['Essais gratuits pendant 2 semaines'], 'wanted': ['Des coachs pour les U9'], 'palmares': [['2024', 'Régional 2', 'Champion']],
              'partners': ['Boulangerie du Centre'], 'links': [['Instagram', 'https://instagram.com/exemple'], ['Pas sûr', 'http://exemple.fr']]},
  'layout': {'order': [], 'hidden': []},
  'teams': [{'id': T1, 'name': 'U11 mixte', 'category': 'U11', 'players': 12, 'status': 'recrute', 'slots_hidden': False, 'fee': 120},
            {'id': T2, 'name': 'Seniors', 'category': 'Seniors', 'players': 9, 'status': 'complet', 'slots_hidden': False, 'fee': 180},
            {'id': T3, 'name': 'Loisirs', 'category': 'Loisirs', 'players': 7, 'status': 'recrute', 'slots_hidden': True}],
  'slots': [{'team': T1, 'day': 3, 'start': '14:00', 'min': 90, 'gym': 'Gymnase du Parc'}, {'team': T2, 'day': 5, 'start': '20:30', 'min': 120, 'gym': 'Salle Jean Moulin'},
            {'team': T1, 'day': 6, 'start': '10:00', 'min': 60, 'gym': 'Gymnase du Parc'}],
  'counts': {'teams': 3, 'players': 28, 'gyms': 2},
  'gyms': [{'name': 'Gymnase du Parc', 'address': '1 rue du Parc, 91510 Lardy'}, {'name': 'Salle Jean Moulin', 'address': ''}],
  'matches': [{'at': '2026-12-05T14:00:00+01:00', 'type': 'Match', 'opponents': 'ES Étréchy', 'teams': 'U11 mixte', 'gym': 'Gymnase du Parc'}],
  'results': None,
}
FAKE = """
const st = { calls: [] }; window.__VIT = st;
const DATA = __DATA__;
function q(v){ return Promise.resolve(v); }
export function createClient(){
  return {
    auth: { getSession: () => q({ data: { session: null } }), onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; } },
    rpc(fn, args){ st.calls.push([fn, args]);
      if (fn === 'vitrine_public') { if (args.p_slug !== DATA.slug) return q({ data: null, error: null }); const d = JSON.parse(JSON.stringify(DATA)); if (window.__LOGO) { d.club.logo = window.__LOGO; d.club.crest_bg = '#FFFFFF'; d.club.color1 = '#123A7A'; d.club.mpc = false; } if (window.__EDIT) { d.can_edit = true; d.logged = true; d.results = []; } return q({ data: d, error: null }); }
      if (fn === 'vitrine_save') return q({ data: {}, error: null });
      return q({ data: null, error: { message: 'inconnu' } }); },
    functions: { invoke(name, o){ st.calls.push([name, o.body]); return q({ data: { envoye: true }, error: null }); } },
  };
}
""".replace('__DATA__', json.dumps(DATA))
results, errors = [], []
def check(n, c): results.append((n, bool(c)))

with sync_playwright() as p:
    b = p.chromium.launch()
    for vw, tag in [((1280, 900), 'ordi'), ((390, 844), 'tel')]:
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, locale='fr-FR')
        ctx.route('https://cdn.jsdelivr.net/npm/@supabase/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=FAKE))
        ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        ctx.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.turnstile={render:function(e,o){setTimeout(function(){o.callback('jeton')},10);return 1},reset:function(){}}"))
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
        pg.goto('http://127.0.0.1:8766/bc-tilleuls-91')
        pg.wait_for_selector('.vhd', timeout=8000)
        # bêta 1.9.1 : avec un logo, le blason est dans l'écusson, comme sur la convocation
        pg2 = ctx.new_page(); pg2.add_init_script("window.__LOGO = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 10 10%22%3E%3Ccircle cx=%225%22 cy=%225%22 r=%225%22/%3E%3C/svg%3E'")
        pg2.goto('http://127.0.0.1:8766/bc-tilleuls-91'); pg2.wait_for_selector('.vhd', timeout=8000)
        check(f'{tag} · logo du club dans l’écusson (forme de la convocation, contour)', pg2.locator('.vecu img').count() == 1 and 'polygon' in pg2.evaluate("getComputedStyle(document.querySelector('.vecu')).clipPath") and pg2.locator('.vblason').count() == 0)
        pg2.close()
        t = pg.inner_text('#vit')
        check(f'{tag} · adresse /nom-du-club servie par 404.html : nom du club', 'Basket Club des Tilleuls' in t)
        check(f'{tag} · chiffres', '28' in t and 'licenciés' in t)
        check(f'{tag} · planning : équipes et heures dynamiques', 'U11 mixte' in t and ('14h–15h30' in t or '14 h – 15 h 30' in t))
        check(f'{tag} · créneaux cachés : horaires sur demande', 'horaires sur demande' in t)
        check(f'{tag} · Complet et On recrute', 'Complet' in t and 'On recrute' in t)
        check(f'{tag} · résultats réservés aux membres', 'réservés aux membres' in t)
        check(f'{tag} · lien http refusé, https gardé', 'Instagram' in t and 'Pas sûr' not in t)
        check(f'{tag} · aucun bouton d’édition pour un visiteur', not pg.query_selector('[data-a=edit]'))
        check(f'{tag} · noindex', pg.evaluate("document.querySelector('meta[name=robots]')?.content.includes('noindex')"))
        if tag == 'ordi':
            check('ordi · calendrier affiché, liste cachée', pg.evaluate("getComputedStyle(document.querySelector('.cal')).display !== 'none' && getComputedStyle(document.querySelector('.callist')).display === 'none'"))
            check('ordi · un créneau tient sur une ligne', pg.evaluate("[...document.querySelectorAll('.slot span')].every(s => s.scrollWidth <= s.clientWidth + 1)"))
        else:
            check('tél · liste par jour affichée, calendrier caché', pg.evaluate("getComputedStyle(document.querySelector('.cal')).display === 'none' && getComputedStyle(document.querySelector('.callist')).display !== 'none'"))
            check('tél · pas de défilement horizontal', pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        OUT and pg.screenshot(path=os.path.join(OUT, f'vitrine-{tag}.png'), full_page=True)
        # cotisation : prise équipe par équipe dans les tarifs, pas dans le texte saisi à la main
        tf = pg.inner_text('#vit')  # la tuile « Cotisation » est ouverte d'office
        check(f'{tag} · cotisation prise équipe par équipe', 'U11 mixte' in tf and '120 €' in tf and 'Seniors' in tf and '180 €' in tf and 'U7 à U11' not in tf)
        check(f'{tag} · équipe sans tarif : pas de ligne Loisirs dans la cotisation', 'Loisirs' not in pg.inner_text('.carte.acc.on .det'))
        check(f'{tag} · sans logo : ballon mpc, pas d’écusson', pg.locator('.vblason img').count() == 1 and pg.locator('.vecu').count() == 0)
        # accordéon
        pg.click('[data-a=acc][data-id=docs]'); pg.wait_for_timeout(100)
        check(f'{tag} · tuile « Pièces à fournir » dépliée', 'Certificat médical' in pg.inner_text('#vit'))
        # formulaire d'essai : équipes complètes retirées, envoi
        pg.click('.vhero [data-a=form][data-k=essai]'); pg.wait_for_selector('#vf')
        opts = pg.evaluate("[...document.querySelectorAll('#vteam option')].map(o => o.textContent)")
        check(f'{tag} · essai : seules les équipes qui recrutent', 'U11 mixte' in opts and 'Seniors' not in opts)
        OUT and pg.screenshot(path=os.path.join(OUT, f'vitrine-{tag}-essai.png'))
        pg.select_option('#vteam', T1); pg.select_option('#vbirth', '2016'); pg.fill('#vname', 'Camille Test'); pg.fill('#vcontact', 'camille@example.org')
        pg.check('#vf input[name=consent]'); pg.wait_for_timeout(100)
        pg.click('#vf button[type=submit]'); pg.wait_for_selector('.vform .ok', timeout=4000)
        sent = pg.evaluate("window.__VIT.calls.find(c => c[0] === 'vitrine-demande')")
        check(f'{tag} · demande envoyée avec le jeton anti-robot et l’année', bool(sent) and sent[1]['captcha'] == 'jeton' and sent[1]['birth'] == 2016 and sent[1]['kind'] == 'essai' and sent[1]['consent'] is True)
        pg.click('.vform .ok [data-a=close]')
        # édition (président ou responsable connecté)
        pg.add_init_script('window.__EDIT = true'); pg.goto('http://127.0.0.1:8766/vitrine.html?c=bc-tilleuls-91'); pg.wait_for_selector('[data-a=edit]')
        check(f'{tag} · ?c= marche aussi ; membre connecté : résultats sans flou', 'réservés aux membres' not in pg.inner_text('#vit'))
        pg.click('[data-a=edit]'); pg.wait_for_selector('.vedbar')
        first = pg.evaluate("document.querySelector('.blk.ed').dataset.b")
        pg.click('.blk.ed [data-a=down]'); pg.wait_for_timeout(50)
        check(f'{tag} · ↓ descend le premier bloc', pg.evaluate("document.querySelectorAll('.blk.ed')[1].dataset.b") == first)
        pg.click('[data-b=palmares] [data-a=eye]'); pg.click(f'[data-a=status][data-id="{T2}"]'); pg.click(f'[data-a=slots][data-id="{T1}"]')
        OUT and pg.screenshot(path=os.path.join(OUT, f'vitrine-{tag}-edition.png'), full_page=True)
        pg.click('[data-a=save]'); pg.wait_for_timeout(300)
        sv = pg.evaluate("window.__VIT.calls.find(c => c[0] === 'vitrine_save')")
        ok = bool(sv) and sv[1]['p_patch']['layout']['order'][1] == first and 'palmares' in sv[1]['p_patch']['layout']['hidden'] and sv[1]['p_patch']['team_status'] == {} and T1 in sv[1]['p_patch']['slots_hidden']
        check(f'{tag} · enregistrement : ordre, bloc caché, place, créneaux', ok)
        # page inconnue
        pg.goto('http://127.0.0.1:8766/club-inconnu'); pg.wait_for_selector('.v404')
        check(f'{tag} · club inconnu : « Hors-jeu ! »', 'Hors-jeu' in pg.inner_text('#vit'))
        OUT and pg.screenshot(path=os.path.join(OUT, f'vitrine-{tag}-404.png'))
        ctx.close()
    b.close()

ko = [n for n, c in results if not c]
for n in ko: print('ÉCHEC ·', n)
if errors: print('ERREURS JS :', errors[:8])
print(f'Vitrine (écrans) : {len(results) - len(ko)}/{len(results)} réussis' + ('' if not errors else f' · {len(errors)} erreur(s) JS'))
sys.exit(1 if ko or errors else 0)
