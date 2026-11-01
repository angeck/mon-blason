#!/usr/bin/env python3
"""Pocket Club · fabrique les ballons et l'icône 4/4 (charte validée le 1er novembre 2026 au soir, claude/logos/ du projet).
Source unique : img/ballon-foot.svg (dessin le plus long) + les dessins courts ci-dessous. Usage : python3 tools/fabriquer_logos.py"""
import os, re, subprocess
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG = os.path.join(R, 'img')
HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 200 200">'
RING = '<circle cx="100" cy="100" r="88" fill="none" stroke="#11162E" stroke-width="8"/>'
BASKET = '<circle cx="100" cy="100" r="88" fill="#F08A24"/><g clip-path="url(#c)" fill="none" stroke="#11162E" stroke-width="6" stroke-linecap="round"><path d="M100 8V192"/><path d="M8 100H192"/><path d="M38 30C64 58 64 142 38 170"/><path d="M162 30C136 58 136 142 162 170"/></g>'
_V = 'M100 100C118 72 148 56 194 58L194 98C158 88 128 92 100 100Z'
_VS = 'M100 100C118 72 148 56 194 58M100 100C128 92 158 88 194 98'
VOLLEY = '<circle cx="100" cy="100" r="88" fill="#FFC93C"/><g clip-path="url(#c)">' + ''.join(f'<path d="{_V}" fill="#2F5BFF" transform="rotate({a} 100 100)"/>' for a in (0, 120, 240)) + ''.join(f'<path d="{_VS}" fill="none" stroke="#11162E" stroke-width="3.5" stroke-linecap="round" transform="rotate({a} 100 100)"/>' for a in (0, 120, 240)) + '</g>'
RUGBY = '<circle cx="100" cy="100" r="88" fill="#B5652B"/><g clip-path="url(#c)"><g transform="rotate(-35 100 100)"><path d="M0 100C30 54 170 54 200 100M0 100C30 146 170 146 200 100" fill="none" stroke="#7A3F14" stroke-width="3.5"/><path d="M58 92C84 82 116 82 142 92" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/><path d="M66 81V98M79 78V95M93 76V93M107 76V93M121 78V95M134 81V98" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/></g></g>'
OVALE = HEAD + '<g transform="rotate(-35 100 100)"><ellipse cx="100" cy="100" rx="92" ry="56" fill="#B5652B"/><path d="M14 100C40 64 160 64 186 100M14 100C40 136 160 136 186 100" fill="none" stroke="#7A3F14" stroke-width="3.5"/><path d="M62 80C86 72 114 72 138 80" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/><path d="M70 70V87M82 68V85M94 67V84M106 67V84M118 68V85M130 70V87" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="92" ry="56" fill="none" stroke="#11162E" stroke-width="8"/></g></svg>'
CLIP = '<defs><clipPath id="c"><circle cx="100" cy="100" r="88"/></clipPath></defs>'
foot = open(os.path.join(IMG, 'ballon-foot.svg')).read()
FOOT = re.search(r'</defs>(.*)<circle cx="100" cy="100" r="88" fill="none"', foot, re.S).group(1)

def ball(inner): return HEAD + CLIP + inner + RING + '</svg>'
def quarter(inner, k, x, y):
    inner = inner.replace('url(#c)', f'url(#c{k})')
    return f'<g clip-path="url(#q{k})"><g transform="translate({x} {y}) scale(0.9) translate(-100 -100)"><defs><clipPath id="c{k}"><circle cx="100" cy="100" r="88"/></clipPath></defs>{inner}</g></g>'
QDEFS = ''.join(f'<clipPath id="q{k}"><rect x="{x}" y="{y}" width="100" height="100"/></clipPath>' for k, x, y in (('b', 0, 0), ('f', 100, 0), ('v', 0, 100), ('r', 100, 100)))
QUARTS = quarter(BASKET, 'b', 50, 50) + quarter(FOOT, 'f', 150, 50) + quarter(VOLLEY, 'v', 50, 150) + quarter(RUGBY, 'r', 150, 150)
B44 = HEAD + f'<defs>{QDEFS}<clipPath id="disc"><circle cx="100" cy="100" r="88"/></clipPath></defs><g clip-path="url(#disc)">{QUARTS}</g><circle cx="100" cy="100" r="88" fill="none" stroke="#11162E" stroke-width="7"/></svg>'
ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 200 200">' + f'<defs>{QDEFS}</defs>{QUARTS}</svg>'
files = {'ballon-basket.svg': ball(BASKET), 'ballon-volley.svg': ball(VOLLEY), 'ballon-rugby-rond.svg': ball(RUGBY), 'ballon-rugby-ovale.svg': OVALE, 'ballon-4-4.svg': B44, 'icone-application-4-4.svg': ICON}
for n, s in files.items(): open(os.path.join(IMG, n), 'w').write(s)
open(os.path.join(R, 'icon.svg'), 'w').write(B44)  # onglet du navigateur = ballon 4/4
# Icônes de l'application : le 4/4 plein cadre (quatre carrés, sans fond), déjà dans la zone sûre pour « maskable »
for out, px in (('icon-192.png', 192), ('icon-512.png', 512), ('icon-maskable-192.png', 192), ('icon-maskable-512.png', 512), ('apple-touch-icon.png', 180)):
    subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px), '-o', os.path.join(R, out), os.path.join(IMG, 'icone-application-4-4.svg')], check=True)
print('ok', ', '.join(files))
