// Bookiraj.si — dopolni KNJIŽNICO SLIK na namizju: vsaj 5 fotografij za vsako destinacijo.
// Struktura: ~/Desktop/Bookiraj.si/<Celina>/<Država>/<Mesto> N.jpg   (kot obstoječi "Pariz 1.png")
// - NIKOLI ne prepiše obstoječih datotek; samo doda manjkajoče do LIMIT.
// - Beleži prenesene URL-je v .bookiraj-slike.json, da ne prenaša istih fotografij.
// - Destinacije prebere iz žive deals.js (ali lokalne, če je na voljo).
// Zagon: node scripts/fill-photo-library.mjs            (do 5 na mesto)
//        MIN_PHOTOS=5 MAX_NEW=600 node scripts/fill-photo-library.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.PHOTO_ROOT || join(homedir(), 'Desktop', 'Bookiraj.si');
const MIN = Number(process.env.MIN_PHOTOS || 5);       // koliko slik želimo na mesto
const MAX_NEW = Number(process.env.MAX_NEW || 600);    // varovalka: največ prenosov na zagon
const UA = { 'User-Agent': 'BookirajBot/1.0 (misa.ravnikar@gmail.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = async u => { try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.json() : null; } catch { return null; } };

const CONT = { europa:'Evropa', evropa:'Evropa', azija:'Azija', afrika:'Afrika',
  'sev-amerika':'Severna Amerika', 'juz-amerika':'Južna Amerika', 'sred-amerika':'Srednja Amerika', oceanija:'Oceanija' };
const BAD = /(map|flag|coat[_ ]of|seal|logo|locator|location|diagram|chart|graph|blank|outline|plan[_ ]|icon|symbol|emblem|banner|svg|\.ogv|\.webm|\.pdf|\.tif|\.gif)/i;
const OKEXT = /\.(jpe?g|png)$/i;
const safe = s => String(s).replace(/[\/\\:*?"<>|]/g, '-').trim();

// ---------- 1) destinacije ----------
async function destinations(){
  let txt = null;
  try { const r = await fetch('https://bookiraj.si/deals.js?cb=' + Date.now(), { headers: UA }); if (r.ok) txt = await r.text(); } catch {}
  if (!txt) { try { txt = readFileSync(new URL('../deals.js', import.meta.url), 'utf8'); } catch {} }
  if (!txt) throw new Error('Ne najdem deals.js (ne na spletu ne lokalno)');
  const o = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const realCont = {}; for (const d of (o.discover || [])) realCont[d.code] = CONT[d.continent] || d.continent;
  const m = new Map();
  for (const d of o.deals) m.set(d.code, { code:d.code, city:d.city, country:d.country, cont: realCont[d.code] || CONT[d.region] || 'Evropa' });
  for (const d of (o.discover || [])) if (!m.has(d.code)) m.set(d.code, { code:d.code, city:d.city, country:d.country, cont: realCont[d.code] || 'Evropa' });
  return [...m.values()];
}

// ---------- 2) kandidati ----------
const cities = await getJSON('https://api.travelpayouts.com/data/en/cities.json');
const countries = await getJSON('https://api.travelpayouts.com/data/en/countries.json');
const CITY = {}, CC = {};
if (cities) for (const c of cities) CITY[c.code] = { name:c.name, cc:c.country_code };
if (countries) for (const c of countries) CC[c.code] = c.name;

async function candidates(code, cityFallback){
  const ci = CITY[code];
  const en = (ci && ci.name) || cityFallback;
  const enCountry = (ci && CC[ci.cc]) || '';
  const out = [];
  // glavna slika članka
  const w = await getJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch='
    + encodeURIComponent(en + ' ' + enCountry) + '&gsrlimit=3&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=1600&origin=*');
  const pages = Object.values((w && w.query && w.query.pages) || {});
  pages.sort((a,b)=>((a.index||9)-(b.index||9)));
  const main = pages.find(p=>p.thumbnail&&p.coordinates) || pages.find(p=>p.thumbnail);
  if (main && main.thumbnail) out.push({ url: main.thumbnail.source, name: 'wikipedia' });
  await sleep(120);
  // Commons
  const c = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search'
    + '&gsrsearch=' + encodeURIComponent(`${en} ${enCountry}`.trim()) + '&gsrnamespace=6&gsrlimit=25'
    + '&prop=imageinfo&iiprop=url|size&iiurlwidth=1600&origin=*');
  const ps = Object.values((c && c.query && c.query.pages) || {});
  ps.sort((a,b)=>((a.index||99)-(b.index||99)));
  for (const p of ps) {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
    const nm = (p.title||'').replace(/^File:/, '');
    if (BAD.test(nm) || !OKEXT.test(nm)) continue;
    const W = ii.thumbwidth || ii.width, H = ii.thumbheight || ii.height;
    if (!W || !H || H > W * 1.05 || (ii.width||0) < 900) continue;
    out.push({ url: ii.thumburl || ii.url, name: nm });
  }
  const seen = new Set();
  return out.filter(p => { const k = p.url.split('/').pop(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- 3) glavno ----------
const manifestPath = join(ROOT, '.bookiraj-slike.json');
let manifest = {};
if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {} }

const list = await destinations();
console.log(`Destinacij: ${list.length} · cilj: ${MIN} slik na mesto · mapa: ${ROOT}`);

let added = 0, filled = 0, newCities = [], skipped = 0;

for (const d of list) {
  if (added >= MAX_NEW) { console.log('… dosežena varovalka MAX_NEW, ostalo bo jutri.'); break; }
  const dir = join(ROOT, safe(d.cont), safe(d.country));
  const city = safe(d.city);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // preštej obstoječe slike za to mesto (npr. "Pariz.jpg", "Pariz 1.png", "Pariz 2.jpg")
  const files = readdirSync(dir).filter(f => OKEXT.test(f));
  const mine = files.filter(f => f.toLowerCase().startsWith(city.toLowerCase()));
  if (mine.length >= MIN) { skipped++; continue; }

  const isNew = mine.length === 0;
  const need = MIN - mine.length;
  const have = new Set(manifest[d.code] || []);
  const cand = (await candidates(d.code, d.city)).filter(p => !have.has(p.url));
  await sleep(150);
  if (!cand.length) { console.log(`—  ${d.city}: ni novih kandidatov`); continue; }

  // naslednja prosta številka
  let n = 0;
  const used = new Set(mine.map(f => {
    const m = f.match(/\s(\d+)\.(jpe?g|png)$/i); return m ? Number(m[1]) : 1;
  }));
  let got = 0;
  for (const p of cand) {
    if (got >= need || added >= MAX_NEW) break;
    do { n++; } while (used.has(n));
    const ext = (p.url.match(/\.(jpe?g|png)/i) || ['.jpg'])[0].toLowerCase().replace('.jpeg', '.jpg');
    const file = join(dir, `${city} ${n}${ext}`);
    if (existsSync(file)) { used.add(n); continue; }
    try {
      const r = await fetch(p.url, { headers: UA });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 12000) continue;               // preskoči sličice/napake
      writeFileSync(file, buf);
      used.add(n); got++; added++;
      (manifest[d.code] = manifest[d.code] || []).push(p.url);
    } catch {}
    await sleep(120);
  }
  if (got) { filled++; if (isNew) newCities.push(`${d.city} (${d.country})`);
    console.log(`✓  ${d.city} (${d.country}): +${got} → skupaj ${mine.length + got}`); }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 0));
console.log(`\nGOTOVO · dodanih fotografij: ${added} · dopolnjenih mest: ${filled} · že polnih: ${skipped}`);
if (newCities.length) console.log(`NOVA MESTA (prej brez slik): ${newCities.join(', ')}`);
