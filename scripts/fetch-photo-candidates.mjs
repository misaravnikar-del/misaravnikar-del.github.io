// Bookiraj.si — poišče KANDIDATNE fotografije za vsako destinacijo (za swipe izbor).
// Vir: Wikipedia (glavna slika članka) + Wikimedia Commons (iskanje po datotekah).
// Vhod:  /tmp/bkrj-mesta.json  [{code, city, country, cont, kuriran}]
// Izhod: /tmp/bkrj-kandidati.json [{code, city, country, cont, kuriran, photos:[{url,w,h,title}]}]
// Zagon: node scripts/fetch-photo-candidates.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'BookirajBot/1.0 (misa.ravnikar@gmail.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = async u => { try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.json() : null; } catch { return null; } };

// filenami, ki niso fotografije destinacije
const BAD = /(map|flag|coat[_ ]of|seal|logo|locator|location|diagram|chart|graph|blank|outline|plan[_ ]|icon|symbol|emblem|banner|svg|\.ogv|\.webm|\.pdf|\.tif|\.gif|collage|montage|panorama[_ ]of[_ ]the[_ ]world)/i;
const OKEXT = /\.(jpe?g|png)$/i;

// 1) slovar kod → angleška imena
const cities = await getJSON('https://api.travelpayouts.com/data/en/cities.json');
const countries = await getJSON('https://api.travelpayouts.com/data/en/countries.json');
const CITY = {}, CC = {};
if (cities) for (const c of cities) CITY[c.code] = { name: c.name, cc: c.country_code };
if (countries) for (const c of countries) CC[c.code] = c.name;

// 2) glavna slika iz Wikipedije (članek o mestu)
async function wikiMain(en, enCountry) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch='
    + encodeURIComponent(en + ' ' + enCountry) + '&gsrlimit=3&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=1400&origin=*';
  const j = await getJSON(u);
  const pages = Object.values((j && j.query && j.query.pages) || {});
  if (!pages.length) return [];
  pages.sort((a, b) => ((a.index || 9) - (b.index || 9)));
  const pick = pages.find(p => p.thumbnail && p.coordinates) || pages.find(p => p.thumbnail);
  return pick && pick.thumbnail ? [{ url: pick.thumbnail.source, w: pick.thumbnail.width, h: pick.thumbnail.height, title: 'Wikipedia: ' + (pick.title || en) }] : [];
}

// 3) fotografije iz Wikimedia Commons
async function commons(en, enCountry, limit = 30) {
  const q = `${en} ${enCountry}`.trim();
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent(q) + '&gsrnamespace=6&gsrlimit=' + limit
    + '&prop=imageinfo&iiprop=url|size&iiurlwidth=1400&origin=*';
  const j = await getJSON(u);
  const pages = Object.values((j && j.query && j.query.pages) || {});
  const out = [];
  pages.sort((a, b) => ((a.index || 99) - (b.index || 99)));
  for (const p of pages) {
    const t = p.title || '';
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii) continue;
    const name = t.replace(/^File:/, '');
    if (BAD.test(name) || !OKEXT.test(name)) continue;
    const w = ii.thumbwidth || ii.width, h = ii.thumbheight || ii.height;
    if (!w || !h) continue;
    if (h > w * 1.05) continue;                  // preskoči pokončne
    if ((ii.width || 0) < 900) continue;         // premajhne
    out.push({ url: ii.thumburl || ii.url, w, h, title: name });
  }
  return out;
}

const list = JSON.parse(readFileSync('/tmp/bkrj-mesta.json', 'utf8'));
const result = [];
let i = 0;
for (const d of list) {
  i++;
  const ci = CITY[d.code];
  const en = (ci && ci.name) || d.city;
  const enCountry = (ci && CC[ci.cc]) || '';
  const a = await wikiMain(en, enCountry); await sleep(120);
  const b = await commons(en, enCountry); await sleep(150);
  const seen = new Set();
  const photos = [...a, ...b].filter(p => { const k = p.url.split('/').pop(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  result.push({ ...d, en, photos });
  console.log(`[${String(i).padStart(3)}/${list.length}] ${d.city} (${d.country}) → ${photos.length} kandidatov`);
}

writeFileSync('/tmp/bkrj-kandidati.json', JSON.stringify(result, null, 1));
const withPhotos = result.filter(r => r.photos.length).length;
const total = result.reduce((s, r) => s + r.photos.length, 0);
console.log(`\nGOTOVO: ${withPhotos}/${result.length} destinacij ima kandidate · skupaj ${total} fotografij`);
console.log('Brez kandidatov:', result.filter(r => !r.photos.length).map(r => r.city).join(', ') || '—');
