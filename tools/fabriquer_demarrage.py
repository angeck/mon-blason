#!/usr/bin/env python3
"""mypocketclub · n° 90 (5.12.0) : images de démarrage iPhone (apple-touch-startup-image), grand logo sur fond encre,
comme l'écran d'ouverture de l'application (5.0.0). Source : img/logo-mypocketclub.svg (charte du 3 novembre 2026),
« pocket » passé en blanc et « club » en bleu clair (#6B8BFF), comme claude/logos/mypocketclub/logo-mypocketclub-fond-encre.svg.
Produit img/demarrage/iphone-LxH.png et affiche les balises <link> à coller dans index.html.
Usage : python3 tools/fabriquer_demarrage.py   (demande rsvg-convert)"""
import os, re, subprocess, tempfile
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(R, 'img', 'demarrage')
os.makedirs(OUT, exist_ok=True)
logo = open(os.path.join(R, 'img', 'logo-mypocketclub.svg')).read()
logo = logo.replace('<path fill="#11162E" d="M202.', '<path fill="#FFFFFF" d="M202.', 1).replace('<path fill="#2F5BFF" d="M528.', '<path fill="#6B8BFF" d="M528.', 1)
inner = re.search(r'<svg[^>]*viewBox="29.4 27.6 652.5 136.8"[^>]*>(.*)</svg>\s*$', logo, re.S).group(1)
# (largeur CSS, hauteur CSS, densité) des iPhone, en portrait
PHONES = [(320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (414, 896, 2), (414, 896, 3), (390, 844, 3),
          (428, 926, 3), (393, 852, 3), (430, 932, 3), (402, 874, 3), (440, 956, 3)]
links = []
for w, h, r in PHONES:
    W, H = w * r, h * r
    lw = W * 0.72; lh = lw * 136.8 / 652.5   # logo sur 72 % de la largeur, centré, un peu au-dessus du milieu
    x = (W - lw) / 2; y = H * 0.46 - lh / 2
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#11162E"/><svg x="{x:.1f}" y="{y:.1f}" width="{lw:.1f}" height="{lh:.1f}" viewBox="29.4 27.6 652.5 136.8">{inner}</svg></svg>'
    name = f'iphone-{W}x{H}.png'
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as t: t.write(svg)
    subprocess.run(['rsvg-convert', '-w', str(W), '-h', str(H), '-o', os.path.join(OUT, name), t.name], check=True)
    os.unlink(t.name)
    links.append(f'<link rel="apple-touch-startup-image" href="img/demarrage/{name}" media="(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: portrait)">')
print('\n'.join(links))
