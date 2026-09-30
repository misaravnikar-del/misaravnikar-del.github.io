# -*- coding: utf-8 -*-
"""Zgradi brezšivni organski vzorec (kot plastnice na zemljevidu) v SVG.

Polje je vsota sinusov s CELOŠTEVILSKIMI frekvencami, zato je natanko periodično
v obeh smereh — plastnice se zato na robovih ujamejo in vzorec se lahko ponavlja
brez vidnega šiva. Iz polja z marching squares potegnemo krivulje in jih narišemo
kot debele zaobljene poteze, tako kot na Mišini predlogi.
"""
import math, numpy as np

W = H = 1200          # velikost ploščice
N = 480               # gostota vzorčenja
VALOVI = [            # (frekvenca x, frekvenca y, amplituda, faza)
    (1, 0, 1.00, 0.35), (0, 1, 0.92, 1.90), (1, 1, 0.62, 2.70),
    (1, -1, 0.55, 0.80), (2, 1, 0.22, 4.10), (1, 2, 0.20, 1.20),
]
NIVOJI = [-0.78, -0.18, 0.42, 1.02]   # stran od sedel, da se krivulje ne cepijo
DEBELINA = 66
NAJKRAJSA = 420                       # krajše krivulje so le vijuge — jih izpustimo

xs = np.linspace(0, W, N + 1)
ys = np.linspace(0, H, N + 1)
X, Y = np.meshgrid(xs, ys)
F = np.zeros_like(X)
for a, b, amp, ph in VALOVI:
    F += amp * np.sin(2 * math.pi * (a * X / W + b * Y / H) + ph)

def marching(F, level):
    """Vrne seznam daljic (x1,y1,x2,y2) za dano višino."""
    G = F - level
    seg = []
    def tocka(p, q, vp, vq):
        t = vp / (vp - vq)
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
    for j in range(N):
        for i in range(N):
            v = [G[j, i], G[j, i+1], G[j+1, i+1], G[j+1, i]]
            p = [(xs[i], ys[j]), (xs[i+1], ys[j]), (xs[i+1], ys[j+1]), (xs[i], ys[j+1])]
            idx = sum((1 << k) for k in range(4) if v[k] > 0)
            if idx in (0, 15):
                continue
            robovi = []
            for k in range(4):
                k2 = (k + 1) % 4
                if (v[k] > 0) != (v[k2] > 0):
                    robovi.append(tocka(p[k], p[k2], v[k], v[k2]))
            if len(robovi) == 2:
                seg.append((robovi[0], robovi[1]))
            elif len(robovi) == 4:            # dvoumen primer — povežemo po parih
                seg.append((robovi[0], robovi[1])); seg.append((robovi[2], robovi[3]))
    return seg

def verige(seg):
    """Daljice zloži v neprekinjene poti."""
    kl = lambda t: (round(t[0], 3), round(t[1], 3))
    sos = {}
    for a, b in seg:
        sos.setdefault(kl(a), []).append((kl(a), kl(b)))
        sos.setdefault(kl(b), []).append((kl(b), kl(a)))
    videna, poti = set(), []
    for a, b in seg:
        k = (kl(a), kl(b))
        if k in videna or (k[1], k[0]) in videna:
            continue
        pot = [k[0], k[1]]
        videna.add(k)
        for smer in (0, 1):
            while True:
                rep = pot[-1] if smer == 0 else pot[0]
                naprej = None
                for s, e in sos.get(rep, []):
                    if (s, e) in videna or (e, s) in videna:
                        continue
                    naprej = (s, e); break
                if not naprej:
                    break
                videna.add(naprej)
                if smer == 0: pot.append(naprej[1])
                else: pot.insert(0, naprej[1])
            if smer == 0 and pot[0] == pot[-1]:
                break
        if len(pot) > 6:
            dolzina = sum(((pot[i+1][0]-pot[i][0])**2 + (pot[i+1][1]-pot[i][1])**2) ** 0.5
                          for i in range(len(pot)-1))
            if dolzina >= NAJKRAJSA:
                poti.append(pot)
    return poti

def zgladi(pot):
    """Krivuljo poenostavi in izriše s kvadratnimi Bézierji — mehke, oble oblike."""
    p = pot[::5] if len(pot) > 80 else (pot[::2] if len(pot) > 24 else pot)
    if len(p) < 3:
        return None
    # Če se krivulja skoraj zapre, jo zapremo — sicer okrogli zaključek naredi topo konico.
    zaprta = ((p[0][0] - pot[-1][0])**2 + (p[0][1] - pot[-1][1])**2) ** 0.5 < 90
    d = f"M{p[0][0]:.1f},{p[0][1]:.1f}"
    for i in range(1, len(p) - 1):
        mx, my = (p[i][0] + p[i+1][0]) / 2, (p[i][1] + p[i+1][1]) / 2
        d += f" Q{p[i][0]:.1f},{p[i][1]:.1f} {mx:.1f},{my:.1f}"
    d += f" T{p[-1][0]:.1f},{p[-1][1]:.1f}"
    if zaprta:
        d += " Z"
    return d

poti = []
for lv in NIVOJI:
    for pot in verige(marching(F, lv)):
        d = zgladi(pot)
        if d:
            poti.append(d)

# Poteze so BELE — maska mora delovati tako po svetlosti kot po prosojnosti.
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
       f'<g fill="none" stroke="#fff" stroke-width="{DEBELINA}" stroke-linecap="round" stroke-linejoin="round">']
for d in poti:
    svg.append(f'<path d="{d}"/>')
svg += ['</g>', '</svg>']
open('vzorec.svg', 'w').write('\n'.join(svg))
print(f'poti: {len(poti)} · velikost: {len("".join(svg))/1024:.1f} kB')
