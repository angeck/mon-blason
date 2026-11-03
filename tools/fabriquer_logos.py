#!/usr/bin/env python3
"""mypocketclub · fabrique les icônes de l'application à partir des SVG de la charte (n° 97 et n° 106, charte validée le 3 novembre 2026).
Sources (copies des fichiers du projet claude/logos/mypocketclub/, seule référence : 04-jetons-design.css) :
  img/ballon-mypocketclub-etoile.svg (ballon de la marque « étoile creuse », n° 106), img/ballon-*.svg (ballons des sports).
Produit, en remplaçant le ballon dans les dessins existants (le « my » en tracés ne change pas) :
  img/icone-application.svg (icône), icon.svg (favicon), img/icone-application-maskable.svg (Android, dessin réduit à 70 %),
  icon-192.png, icon-512.png, icon-maskable-192.png, icon-maskable-512.png, apple-touch-icon.png (180),
  favicon-32.png, favicon-48.png, badge-96.png (ballon de la marque blanc, barre des notifications).
Usage : python3 tools/fabriquer_logos.py   (demande rsvg-convert)"""
import os, re, subprocess, tempfile
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG = os.path.join(R, 'img')
ball = open(os.path.join(IMG, 'ballon-mypocketclub-etoile.svg')).read()
inner_ball = re.search(r'<svg[^>]*viewBox="0 0 56 56">(.*)</svg>\s*$', ball, re.S).group(1)
NESTED = re.compile(r'(<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 56 56">).*?</svg>', re.S)

def put_ball(svg, clip_id):
    # identifiant de découpe propre à chaque fichier (plusieurs dessins peuvent être affichés dans la même page)
    b = inner_ball.replace('id="kf2"', f'id="{clip_id}"').replace('url(#kf2)', f'url(#{clip_id})')
    return NESTED.sub(lambda m: m.group(1) + b + '</svg>', svg, count=1)

# Icône : carré bleu, « my » en étiquette, ballon de la marque
p = os.path.join(IMG, 'icone-application.svg')
icon = put_ball(open(p).read(), 'kf2ix')
icon = re.sub(r'<!--[^>]*-->', '<!-- mypocketclub · icône (étoile creuse) validée le 2026-11-03. « my » en tracés (Bricolage Grotesque 800). -->', icon, count=1)
open(p, 'w').write(icon)
# Favicon : carré bleu arrondi, ballon seul
p = os.path.join(R, 'icon.svg')
fav = put_ball(open(p).read(), 'kf2fy').replace('width="32" height="32"', 'width="64" height="64"', 1)
open(p, 'w').write(fav)
# Version maskable : même dessin réduit à 70 % au centre, sur le carré bleu plein (zone sûre d'Android)
inner = re.search(r'<rect width="100" height="100" fill="#2F5BFF"/>(.*)</svg>\s*$', icon, re.S).group(1)
mask = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">'
        '<!-- mypocketclub · icône maskable (étoile creuse) 2026-11-03 : dessin réduit à 70 % pour la zone sûre Android -->'
        '<rect width="100" height="100" fill="#2F5BFF"/><g transform="translate(15 15) scale(.7)">' + inner + '</g></svg>\n')
open(os.path.join(IMG, 'icone-application-maskable.svg'), 'w').write(mask)
# Badge des notifications (Android le teinte lui-même) : ballon de la marque en blanc sur fond transparent
# (les panneaux encre deviennent pleins, le jaune devient transparent : les étoiles restent creusées)
badge = ball.replace('fill="#FFC93C"', 'fill="none"').replace('stroke="#FFC93C"', 'stroke="none"').replace('#11162E', '#FFFFFF')
tmp = tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False); tmp.write(badge); tmp.close()
def png(src, out, px):
    subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px), '-o', os.path.join(R, out), src], check=True)
for out, px in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    png(os.path.join(IMG, 'icone-application.svg'), out, px)
for out, px in (('icon-maskable-192.png', 192), ('icon-maskable-512.png', 512)):
    png(os.path.join(IMG, 'icone-application-maskable.svg'), out, px)
for out, px in (('favicon-32.png', 32), ('favicon-48.png', 48)):
    png(os.path.join(R, 'icon.svg'), out, px)
png(tmp.name, 'badge-96.png', 96)
os.unlink(tmp.name)
print('ok : icônes mypocketclub fabriquées (ballon étoile creuse)')
