// Bookiraj.si — za vsako destinacijo poišče 3–5 znamenitosti, ki jih je vredno videti.
// Vir: Wikidata (znamenitosti v okolici mesta, urejene po prepoznavnosti) + slika iz Wikimedie.
// Slovenska imena vzamemo, kjer obstajajo; sicer angleška.
// Izhod: sights.js  →  window.__BOOKIRAJ_SIGHTS__ = { "BCN": [{n,d,img,url}], ... }
// Zagon: node scripts/build-sights.mjs [koda …]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'BookirajBot/1.0 (misa.ravnikar@gmail.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 3, MAX = 5, RADIUS = 30;       // km od središča mesta

// ---- razredi, ki jih štejemo za znamenitost (Wikidata P31) ----
const GOOD = new Set([
  'Q33506','Q207694','Q24699794',                       // muzej, umetnostni muzej
  'Q16970','Q2977','Q44613','Q160742','Q32815','Q34627',// cerkev, katedrala, samostan, opatija, mošeja, sinagoga
  'Q23413','Q751876','Q1785071','Q57831','Q16560',      // grad, dvorec, trdnjava, utrdba, palača
  'Q22698','Q1107656','Q46169','Q22746',                // park, vrt, botanični vrt, zgodovinski vrt
  'Q46831','Q8502','Q54050','Q150784','Q23397',         // gorovje, gora, hrib, jama, jezero
  'Q40080','Q34763','Q23442','Q9430',                   // plaža, polotok, otok, ocean
  'Q4989906','Q575759','Q1129743','Q2319498',           // spomenik, spominski objekt, znamenitost, znamenitost mesta
  'Q174782','Q1281877','Q1021645',                      // trg, mestni trg, glavni trg
  'Q12518','Q57821','Q1440300','Q811979',               // stolp, utrdba, arhitekturni objekt
  'Q839954','Q473972','Q46124','Q1370598',              // arheološko najdišče, zavarovano območje, svetišče
  'Q12280','Q158438','Q3947','Q41176',                  // most, svetilnik, hiša, stavba
  'Q483110','Q43229','Q2087181','Q570116',              // stadion, organizacija, turistična znamenitost
  'Q1244442','Q1076486','Q431289','Q4022',              // reka
  'Q34442','Q184460','Q179700','Q860861','Q11707',      // cesta, kip, skulptura, restavracija
  'Q39614','Q1107656','Q205495','Q2143825',             // pokopališče, živalski vrt
  'Q3152824','Q1497364','Q1637706','Q515',              // četrt
]);
// kar zagotovo ni znamenitost
const BAD = new Set([
  'Q1248784','Q644371','Q62447','Q55488','Q55491',      // letališče, terminal, železniška postaja
  'Q515','Q3957','Q532','Q486972','Q5119','Q15284',     // mesto, naselje, vas, prestolnica, občina
  'Q6256','Q10864048','Q56061','Q82794',                // država, upravna enota, geografska regija
  'Q5','Q43229','Q4830453','Q783794','Q891723',         // človek, podjetje
  'Q3918','Q875538','Q2385804','Q16917','Q4287745',     // univerza, šola, bolnišnica
  'Q7075','Q41176','Q11424','Q5398426','Q7889',         // knjižnica, film, TV-serija, videoigra
]);

// ---- destinacije iz deals.js ----
const src = readFileSync(new URL('../deals.js', import.meta.url), 'utf8');
const deals = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const cards = (deals.deals || []).concat(deals.discover || []);

const cities = await (await fetch('https://api.travelpayouts.com/data/en/cities.json', { headers: UA })).json();
const GEO = {}, NAME = {};
for (const c of cities) if (c.coordinates && c.coordinates.lat != null) {
  GEO[c.code] = c.coordinates; NAME[c.code] = c.name;
}
// nekaj letaliških kod, ki v imeniku nimajo koordinat
const PATCH = { HKT:{lat:7.883,lon:98.392}, CUN:{lat:21.161,lon:-86.851}, SEZ:{lat:-4.674,lon:55.522},
  PTY:{lat:9.071,lon:-79.384}, NBO:{lat:-1.319,lon:36.928}, GIG:{lat:-22.81,lon:-43.25},
  EZE:{lat:-34.822,lon:-58.536}, DKR:{lat:14.671,lon:-17.073}, SID:{lat:16.741,lon:-22.949} };
for (const k in PATCH) if (!GEO[k]) GEO[k] = PATCH[k];

const only = process.argv.slice(2).map(x => x.toUpperCase());
const codes = [...new Set(cards.map(c => c.code))].filter(c => !only.length || only.includes(c));

// ---- Wikidata ----
async function sparql(q) {
  const u = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(u, { headers: { ...UA, Accept: 'application/sparql-results+json' } });
      if (r.status === 429 || r.status === 503) { await sleep(3000 * (a + 1)); continue; }
      if (!r.ok) return null;
      return (await r.json()).results.bindings;
    } catch { await sleep(1500); }
  }
  return null;
}

function query(lat, lon) {
  return `SELECT ?item ?itemLabel ?itemDescription ?img ?cls ?links WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${RADIUS}" . }
  ?item wdt:P18 ?img ; wdt:P31 ?cls ; wikibase:sitelinks ?links .
  FILTER(?links > 12)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "sl,en,de,it". }
} ORDER BY DESC(?links) LIMIT 120`;
}

const out = existsSync(new URL('../sights.js', import.meta.url))
  ? (() => { const t = readFileSync(new URL('../sights.js', import.meta.url), 'utf8');
             try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; } })()
  : {};

let done = 0, found = 0, skipped = 0;
for (const code of codes) {
  const g = GEO[code];
  if (!g) { skipped++; console.log(`—  ${code}: ni koordinat`); continue; }
  const rows = await sparql(query(g.lat, g.lon));
  await sleep(1200);
  if (!rows) { skipped++; console.log(`—  ${code}: Wikidata ne odgovarja`); continue; }

  // združi vrstice po znamenitosti (ena ima lahko več razredov)
  const byId = new Map();
  for (const r of rows) {
    const id = r.item.value.split('/').pop();
    const cls = r.cls.value.split('/').pop();
    if (!byId.has(id)) byId.set(id, {
      id, n: r.itemLabel.value, d: r.itemDescription ? r.itemDescription.value : '',
      img: r.img.value, links: +r.links.value, cls: new Set()
    });
    byId.get(id).cls.add(cls);
  }
  const list = [...byId.values()]
    .filter(x => ![...x.cls].some(c => BAD.has(c)))
    .filter(x => [...x.cls].some(c => GOOD.has(c)))
    .filter(x => !/^Q\d+$/.test(x.n))                       // brez imena v znanem jeziku
    .sort((a, b) => b.links - a.links);

  // ne ponavljaj istega imena
  const seen = new Set(), picked = [];
  for (const x of list) {
    const key = x.n.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    picked.push({
      n: x.n,
      d: (x.d || '').charAt(0).toUpperCase() + (x.d || '').slice(1),
      img: x.img.replace('http://', 'https://') + '?width=720',
      url: 'https://www.wikidata.org/wiki/' + x.id
    });
    if (picked.length >= MAX) break;
  }
  if (picked.length >= MIN) { out[code] = picked; found++; console.log(`✓  ${code} ${NAME[code]||''}: ${picked.map(p=>p.n).join(' · ')}`); }
  else { skipped++; console.log(`~  ${code} ${NAME[code]||''}: samo ${picked.length} znamenitosti, premalo`); }
  if (++done % 25 === 0) writeFileSync(new URL('../sights.js', import.meta.url),
    'window.__BOOKIRAJ_SIGHTS__ = ' + JSON.stringify(out) + ';\n');
}

writeFileSync(new URL('../sights.js', import.meta.url),
  'window.__BOOKIRAJ_SIGHTS__ = ' + JSON.stringify(out) + ';\n');
console.log(`\nZnamenitosti: ${found} destinacij urejenih · ${skipped} izpuščenih · skupaj v datoteki ${Object.keys(out).length}`);
