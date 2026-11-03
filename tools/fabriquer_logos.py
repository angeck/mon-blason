#!/usr/bin/env python3
"""mypocketclub · fabrique les icônes de l'application à partir des SVG de la charte (n° 97, charte validée le 3 novembre 2026).
Sources (copies des fichiers du projet claude/logos/mypocketclub/, seule référence : 04-jetons-design.css) :
  img/icone-application.svg (icône), icon.svg (favicon), img/ballon-*.svg (ballons jaune et encre).
Produit : img/icone-application-maskable.svg (Android, dessin réduit à 70 %), icon-192.png, icon-512.png,
icon-maskable-192.png, icon-maskable-512.png, apple-touch-icon.png (180), badge-96.png (ballon médecine blanc, barre des notifications).
Usage : python3 tools/fabriquer_logos.py   (demande rsvg-convert)"""
import os, re, subprocess, tempfile
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG = os.path.join(R, 'img')
icon = open(os.path.join(IMG, 'icone-application.svg')).read()
# Version maskable : même dessin réduit à 70 % au centre, sur le carré bleu plein (zone sûre d'Android)
inner = re.search(r'<rect width="100" height="100" fill="#2F5BFF"/>(.*)</svg>\s*$', icon, re.S).group(1)
mask = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">'
        '<!-- mypocketclub · icône validée le 2026-11-03, version maskable (Android) : dessin réduit à 70 % pour rester dans la zone sûre -->'
        '<rect width="100" height="100" fill="#2F5BFF"/><g transform="translate(15 15) scale(.7)">' + inner + '</g></svg>\n')
open(os.path.join(IMG, 'icone-application-maskable.svg'), 'w').write(mask)
# Badge des notifications (Android le teinte lui-même) : ballon médecine au trait blanc sur fond transparent
med = open(os.path.join(IMG, 'ballon-medecine.svg')).read()
badge = med.replace('fill="#FFC93C"', 'fill="none"').replace('#11162E', '#FFFFFF')
tmp = tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False); tmp.write(badge); tmp.close()
def png(src, out, px):
    subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px), '-o', os.path.join(R, out), src], check=True)
for out, px in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    png(os.path.join(IMG, 'icone-application.svg'), out, px)
for out, px in (('icon-maskable-192.png', 192), ('icon-maskable-512.png', 512)):
    png(os.path.join(IMG, 'icone-application-maskable.svg'), out, px)
png(tmp.name, 'badge-96.png', 96)
os.unlink(tmp.name)
print('ok : icônes mypocketclub fabriquées')
