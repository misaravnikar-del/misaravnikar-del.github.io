# -*- coding: utf-8 -*-
"""
Bookiraj.si — slike akcij pridejo IZKLJUČNO iz Mišine mape na namizju.

Mišina pravila (24. 9. 2026):
  15) »Odstrani vse slike, in dodaj samo te, če jih imam jaz v svojih mapah.«
  16) »Slika ne sme biti na platformi nikoli enaka — če se leti iz Ljubljane in Benetk,
       potem moraš dati 2 sliki gor, za vsako akcijo svojo.«
  17) »Za tiste, ki jih nimam, jih začasno arhiviraj, tako da jih jaz vseeno lahko vidim,
       in mi pošlji mail, katere slike manjkajo. Ko jih dodam v mapo, jih objavi.«

Kaj naredi:
  • prebere deals.js in mapo ~/Desktop/Bookiraj.si
  • vsaki KARTICI (odhod→cilj) dodeli SVOJO sliko — nobena se ne ponovi
  • slike zapiše kot img/deals/<ODHOD>-<CILJ>.jpg (prej so bile po destinaciji)
  • kartice brez slike premakne v arhiv (arhiv.js) — niso objavljene, a jih Miša vidi
  • zapiše seznam manjkajočih slik v arhiv.js (za dnevni mail)

Zagon: python3 scripts/slike-iz-mape.py
"""
import io, json, os, re, sys, shutil, unicodedata
from collections import defaultdict
try:
    from PIL import Image
except ImportError:
    sys.exit('Manjka Pillow: pip3 install Pillow')

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA  = os.path.expanduser('~/Desktop/Bookiraj.si')
DEALS = os.path.join(KOREN, 'deals.js')
VSE   = os.path.join(KOREN, 'deals-vse.js')   # poln seznam, vir za razdelitev
ARHIV = os.path.join(KOREN, 'arhiv.js')
SLIKE = os.path.join(KOREN, 'img', 'deals')
EXT   = ('.jpg', '.jpeg', '.png', '.webp')
# Miša (24.9.2026): »ne jih stiskat«. Slike zato ohranimo v izvirni velikosti
# (2000 px) in skoraj brez izgube (JPEG 95). Pretvorba iz PNG v JPEG je nujna —
# izvirni PNG-ji so po 4–6 MB in bi stran ustavili.
SIRINA, KAKOVOST = 2000, 95

# mape, ki niso destinacije
NE_MAPE = {'Logotip', 'Stampi', 'spletna-stran', 'Dodatno'}
# ime države na strani → ime mape, kjer se razlikujeta
DRZAVA_ALIAS = {'zimbabve': 'zimbabwe'}
# mesto na strani → ime v datoteki, kjer se razlikujeta
MESTO_ALIAS  = {'paris': 'pariz', 'funchal': 'madeira', 'seul': 'seoul'}
# Ime v mapi, ki pokriva VEČ mest — npr. »Sicilija 1.png« velja za Katanijo in Palermo.
# Brez tega bi take slike obležale neuporabljene, mesta pa bi po nepotrebnem čakala.
POKRIVA = {
    'sicilija':   ['catania', 'palermo', 'trapani'],
    'sardinija':  ['cagliari', 'olbia', 'alghero'],
    'madeira':    ['funchal', 'portosanto'],
    'kreta':      ['heraklion', 'chania'],
    'baleari':    ['palmademallorca', 'ibiza', 'menorca'],
    'kanarskiotoki': ['tenerife', 'laspalmasdegrancanaria', 'lanzarote', 'fuerteventura'],
}

def norm(x):
    x = unicodedata.normalize('NFD', x or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', x)

def osnova(fn):                      # »Neapelj 4.png« → »Neapelj«
    return re.sub(r'\s*\d+$', '', os.path.splitext(fn)[0]).strip()

def preberi_mapo():
    """država → [(pot, ime-osnove)] — urejeno, da je izbira ponovljiva."""
    out = defaultdict(list)
    if not os.path.isdir(MAPA):
        sys.exit(f'Ne najdem mape {MAPA}')
    for celina in sorted(os.listdir(MAPA)):
        cp = os.path.join(MAPA, celina)
        if not os.path.isdir(cp) or celina.startswith('_') or celina in NE_MAPE:
            continue
        for drzava in sorted(os.listdir(cp)):
            dp = os.path.join(cp, drzava)
            if not os.path.isdir(dp):
                continue
            for f in sorted(os.listdir(dp)):
                if f.lower().endswith(EXT) and not f.startswith('.'):
                    out[norm(drzava)].append((os.path.join(dp, f), osnova(f)))
    return out

def izberi(pool, mesto):
    """Najprej slika, ki imenuje TO mesto; sicer slika širšega območja, ki mesto pokriva
       (npr. »Sicilija« za Katanijo). Slike DRUGIH mest iste države se NE uporabijo —
       za Rim ne sme biti Neapelj."""
    m = MESTO_ALIAS.get(norm(mesto), norm(mesto))
    for p in pool:                                   # 1) datoteka imenuje to mesto
        n = norm(p[1])
        if n == m or (m and (m in n or n in m)):
            return p
    for p in pool:                                   # 2) datoteka imenuje območje, ki ga pokriva
        if m in POKRIVA.get(norm(p[1]), []):
            return p
    return None

def main():
    mapa = preberi_mapo()
    # Vir je POLN seznam akcij (deals-vse.js). Če bi brali že zožen deals.js, bi ob
    # vsakem zagonu izgubili akcije, ki čakajo na sliko — arhiv bi se izpraznil.
    vir = VSE if os.path.exists(VSE) else DEALS
    src = io.open(vir, encoding='utf-8').read()
    o = json.loads(src[src.index('{'):src.rindex('}') + 1])
    kurirane, odkrite = o.get('deals') or [], o.get('discover') or []

    # 1) počisti stare slike — na strani ostanejo SAMO Mišine
    if os.path.isdir(SLIKE):
        shutil.rmtree(SLIKE)
    os.makedirs(SLIKE, exist_ok=True)

    # 2) razdeli slike: ena na kartico, nobena dvakrat
    na_voljo = {k: list(v) for k, v in mapa.items()}
    drzavne  = {k: [p for p in v if norm(p[1]) == k] for k, v in mapa.items()}
    objavi_k, objavi_o, arhiv = [], [], []
    manjka = defaultdict(lambda: {'drzava': '', 'kartice': []})

    def obdelaj(c, kam):
        drz = DRZAVA_ALIAS.get(norm(c.get('country', '')), norm(c.get('country', '')))
        pool = na_voljo.get(drz, [])
        pick = izberi(pool, c['city']) or next((p for p in pool if p in drzavne.get(drz, [])), None)
        if not pick:
            kljuc = c['city'] + '|' + c.get('country', '')
            manjka[kljuc]['drzava'] = c.get('country', '')
            manjka[kljuc]['kartice'].append(c['fromCity'] + ' → ' + c['city'])
            arhiv.append({'fromCode': c['fromCode'], 'fromCity': c['fromCity'], 'code': c['code'],
                          'city': c['city'], 'country': c.get('country', ''),
                          'price': min(t['price'] for t in c['terms']) if c.get('terms') else None,
                          'terminov': len(c.get('terms') or []), 'razlog': 'ni slike v mapi'})
            return
        pool.remove(pick)
        ime = f"{c['fromCode']}-{c['code']}.jpg"
        im = Image.open(pick[0]).convert('RGB')
        w, h = im.size
        if w > SIRINA:
            im = im.resize((SIRINA, round(h * SIRINA / w)), Image.LANCZOS)
        im.save(os.path.join(SLIKE, ime), 'JPEG', quality=KAKOVOST, optimize=True, progressive=True)
        c['photo'] = 'img/deals/' + ime
        c['photoVir'] = os.path.relpath(pick[0], MAPA)
        kam.append(c)

    for c in kurirane: obdelaj(c, objavi_k)
    for c in odkrite:  obdelaj(c, objavi_o)

    # 3) zapiši
    o['deals'], o['discover'] = objavi_k, objavi_o
    io.open(DEALS, 'w', encoding='utf-8').write(
        'window.__BOOKIRAJ_DEALS__ = ' + json.dumps(o, ensure_ascii=False) + ';\n')

    manjka_list = sorted(
        ({'mesto': k.split('|')[0], 'drzava': v['drzava'], 'kartic': len(v['kartice'])}
         for k, v in manjka.items()),
        key=lambda x: (-x['kartic'], x['drzava'], x['mesto']))
    io.open(ARHIV, 'w', encoding='utf-8').write(
        '// Akcije, ki čakajo na sliko v mapi Bookiraj.si. Niso objavljene, a jih vidiš\n'
        '// v nadzorni plošči. Ko dodaš sliko v mapo, jih naslednji zagon objavi.\n'
        'window.__BOOKIRAJ_ARHIV__ = ' + json.dumps(
            {'updated': o.get('updated'), 'arhiv': arhiv, 'manjka': manjka_list},
            ensure_ascii=False) + ';\n')

    porabljenih = sum(len(v) for v in mapa.values()) - sum(len(v) for v in na_voljo.values())
    print(f"Objavljeno: {len(objavi_k) + len(objavi_o)} kartic (vsaka s svojo sliko)")
    print(f"V arhivu:   {len(arhiv)} kartic · manjka slik za {len(manjka_list)} destinacij")
    print(f"Porabljenih slik iz mape: {porabljenih} od {sum(len(v) for v in mapa.values())}")
    if manjka_list:
        print('\nNajbolj pogrešane destinacije:')
        for m in manjka_list[:15]:
            print(f"   {m['kartic']:>2} × {m['mesto']} ({m['drzava']})")

if __name__ == '__main__':
    main()
