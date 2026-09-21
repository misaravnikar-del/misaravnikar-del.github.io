// Bookiraj.si — pobere PRAVE cene z Aviasales/Travelpayouts Data API.
//  1) 14 kuriranih prog (slike/opisi) → kartice; obdrži termine pod povprečjem.
//  2) ODKRIVANJE: za vseh 9 letališč potegne najcenejše lete v vse destinacije,
//     filtrira po whitelistu držav (varno/obljudeno), po SEZONI destinacije in
//     po MINIMALNI dolžini potovanja glede na oddaljenost → velik seznam akcij.
// Zažene GitHub Action (skrivnost TRAVELPAYOUTS_TOKEN); lokalno: TRAVELPAYOUTS_TOKEN=... node scripts/fetch-deals.mjs
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const MARKER = process.env.TP_MARKER || '779438';
if (!TOKEN) { console.error('Manjka TRAVELPAYOUTS_TOKEN'); process.exit(1); }

const ORIGINS = [
  {code:'LJU', city:'Ljubljana'}, {code:'TRS', city:'Trst'}, {code:'VCE', city:'Benetke'},
  {code:'ZAG', city:'Zagreb'}, {code:'VIE', city:'Dunaj'}, {code:'MXP', city:'Milano'},
  {code:'TSF', city:'Treviso'}, {code:'MUC', city:'Minhen'}, {code:'BUD', city:'Budimpešta'},
];

// ---- kurirane proge (slike) ----
const ROUTES = [
  {city:'Barcelona',code:'BCN',country:'Španija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'barcelona'},
  {city:'Rim',code:'FCO',country:'Italija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'rome'},
  {city:'Lizbona',code:'LIS',country:'Portugalska',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'lisbon'},
  {city:'Santorini',code:'JTR',country:'Grčija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'santorini'},
  {city:'Istanbul',code:'IST',country:'Turčija',fromCity:'Zagreb',fromCode:'ZAG',region:'europa',img:'istanbul'},
  {city:'Amsterdam',code:'AMS',country:'Nizozemska',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'amsterdam'},
  {city:'London',code:'LON',country:'Anglija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'london'},
  {city:'Reykjavík',code:'KEF',country:'Islandija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'iceland'},
  {city:'Dubaj',code:'DXB',country:'ZAE',fromCity:'Zagreb',fromCode:'ZAG',region:'azija',img:'dubai'},
  {city:'Bangkok',code:'BKK',country:'Tajska',fromCity:'Benetke',fromCode:'VCE',region:'azija',img:'bangkok'},
  {city:'Maldivi',code:'MLE',country:'Maldivi',fromCity:'Dunaj',fromCode:'VIE',region:'eksotika',img:'maldives'},
  {city:'New York',code:'JFK',country:'ZDA',fromCity:'Benetke',fromCode:'VCE',region:'amerika',img:'newyork'},
  {city:'Bali',code:'DPS',country:'Indonezija',fromCity:'Dunaj',fromCode:'VIE',region:'eksotika',img:'bali'},
  {city:'Marakeš',code:'RAK',country:'Maroko',fromCity:'Benetke',fromCode:'VCE',region:'eksotika',img:'marrakesh'},
  // ---- dodane 20.9.2026 (LJU / TRS / VCE) — slike so v img/<img>.jpg, opisi v COPY v index.html ----
  {city:'Pariz',code:'PAR',country:'Francija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'paris'},
  {city:'Praga',code:'PRG',country:'Češka',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'prague'},
  {city:'Berlin',code:'BER',country:'Nemčija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'berlin'},
  {city:'Tenerife',code:'TCI',country:'Španija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'tenerife'},
  {city:'Atene',code:'ATH',country:'Grčija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'athens'},
  {city:'Podgorica',code:'TGD',country:'Črna gora',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'podgorica'},
  {city:'Tirana',code:'TIA',country:'Albanija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'tirana'},
  {city:'Palermo',code:'PMO',country:'Italija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'palermo'},
  {city:'Edinburgh',code:'EDI',country:'Škotska',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'edinburgh'},
  {city:'Dubrovnik',code:'DBV',country:'Hrvaška',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'dubrovnik'},
  {city:'Krakov',code:'KRK',country:'Poljska',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'krakow'},
  {city:'Neapelj',code:'NAP',country:'Italija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'naples'},
  {city:'Malta',code:'MLA',country:'Malta',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'malta'},
  {city:'Varšava',code:'WAW',country:'Poljska',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'warsaw'},
  {city:'Sevilla',code:'SVQ',country:'Španija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'seville'},
  {city:'Marseille',code:'MRS',country:'Francija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'marseille'},
];

// ---- sezonski arhetipi: kateri MESECI so primerni ----
const SEASON = {
  eu:       {m:[1,2,3,4,5,6,7,8,9,10,11,12], note:'skozi vse leto'},
  medcity:  {m:[3,4,5,6,7,8,9,10,11],         note:'pomlad–jesen'},
  beach:    {m:[5,6,7,8,9,10],                note:'poletje'},
  tropic:   {m:[11,12,1,2,3,4],               note:'suha doba (nov–apr)'},
  desert:   {m:[10,11,12,1,2,3,4],            note:'okt–apr (poleti prevroče)'},
  southern: {m:[10,11,12,1,2,3,4],            note:'njihovo poletje (okt–apr)'},
  nordic:   {m:[1,2,3,4,5,6,7,8,9,10,11,12], note:'poletje za naravo, zima za sever. sij'},
  temperate:{m:[3,4,5,6,9,10,11],             note:'pomlad in jesen'},
  canada:   {m:[5,6,7,8,9,10],                note:'maj–okt'},
  safari:   {m:[1,2,6,7,8,9,10],              note:'suha doba (safari)'},
  andes:    {m:[5,6,7,8,9,10],                note:'suha doba (maj–okt)'},
  equator:  {m:[1,2,3,4,5,6,7,8,9,10,11,12], note:'skozi vse leto'},
};

// ---- katalog dovoljenih držav (ISO2 → SL ime, celina, sezona, eksotika) ----
// Kar ni tu, se izpusti (tako izločimo nevarne/neobljudene države).
const C = (sl,cont,season,x)=>({sl,cont,season,x:!!x});
const CATALOG = {
  // Evropa
  ES:C('Španija','evropa','medcity'), IT:C('Italija','evropa','medcity'), PT:C('Portugalska','evropa','medcity'),
  GR:C('Grčija','evropa','medcity'), FR:C('Francija','evropa','eu'), GB:C('Anglija','evropa','eu'),
  DE:C('Nemčija','evropa','eu'), NL:C('Nizozemska','evropa','eu'), BE:C('Belgija','evropa','eu'),
  IE:C('Irska','evropa','eu'), AT:C('Avstrija','evropa','eu'), CH:C('Švica','evropa','eu'),
  CZ:C('Češka','evropa','eu'), PL:C('Poljska','evropa','eu'), HU:C('Madžarska','evropa','eu'),
  SK:C('Slovaška','evropa','eu'), RO:C('Romunija','evropa','eu'), BG:C('Bolgarija','evropa','eu'),
  HR:C('Hrvaška','evropa','medcity'), RS:C('Srbija','evropa','eu'), BA:C('BiH','evropa','eu'),
  ME:C('Črna gora','evropa','medcity'), MK:C('Sev. Makedonija','evropa','eu'), AL:C('Albanija','evropa','medcity'),
  MT:C('Malta','evropa','beach'), CY:C('Ciper','evropa','beach'), TR:C('Turčija','evropa','medcity'),
  EE:C('Estonija','evropa','eu'), LV:C('Latvija','evropa','eu'), LT:C('Litva','evropa','eu'),
  LU:C('Luksemburg','evropa','eu'), DK:C('Danska','evropa','eu'), SE:C('Švedska','evropa','nordic'),
  NO:C('Norveška','evropa','nordic'), FI:C('Finska','evropa','nordic'), IS:C('Islandija','evropa','nordic',1),
  GE:C('Gruzija','azija','temperate',1), AM:C('Armenija','azija','temperate',1),
  // Bližnji vzhod / Zaliv
  AE:C('ZAE','azija','desert',1), QA:C('Katar','azija','desert',1), OM:C('Oman','azija','desert',1),
  SA:C('Savdska Arabija','azija','desert',1), JO:C('Jordanija','azija','desert',1), IL:C('Izrael','azija','desert',1),
  // Azija
  TH:C('Tajska','azija','tropic',1), VN:C('Vietnam','azija','tropic',1), ID:C('Indonezija','azija','tropic',1),
  MY:C('Malezija','azija','tropic',1), SG:C('Singapur','azija','tropic',1), LK:C('Šrilanka','azija','tropic',1),
  IN:C('Indija','azija','tropic',1), MV:C('Maldivi','azija','tropic',1), PH:C('Filipini','azija','tropic',1),
  KH:C('Kambodža','azija','tropic',1), NP:C('Nepal','azija','temperate',1), JP:C('Japonska','azija','temperate',1),
  KR:C('Južna Koreja','azija','temperate',1), CN:C('Kitajska','azija','temperate',1),
  // Afrika
  MA:C('Maroko','afrika','desert',1), EG:C('Egipt','afrika','desert',1), TN:C('Tunizija','afrika','beach',1),
  KE:C('Kenija','afrika','safari',1), TZ:C('Tanzanija','afrika','tropic',1), ZA:C('Južna Afrika','afrika','southern',1),
  NA:C('Namibija','afrika','southern',1), MU:C('Mauritius','afrika','tropic',1), SC:C('Sejšeli','afrika','tropic',1),
  CV:C('Zelenortski otoki','afrika','equator',1), SN:C('Senegal','afrika','tropic',1),
  // Severna Amerika
  US:C('ZDA','sev-amerika','eu'), CA:C('Kanada','sev-amerika','canada'),
  // Srednja Amerika (+ Karibi)
  MX:C('Mehika','sred-amerika','tropic',1), CU:C('Kuba','sred-amerika','tropic',1), DO:C('Dominikanska rep.','sred-amerika','tropic',1),
  JM:C('Jamajka','sred-amerika','tropic',1), CR:C('Kostarika','sred-amerika','equator',1), PA:C('Panama','sred-amerika','equator',1),
  // Južna Amerika
  BR:C('Brazilija','juz-amerika','southern',1), AR:C('Argentina','juz-amerika','southern',1),
  CL:C('Čile','juz-amerika','southern',1), PE:C('Peru','juz-amerika','andes',1), CO:C('Kolumbija','juz-amerika','equator',1),
  EC:C('Ekvador','juz-amerika','equator',1),
  // Oceanija
  AU:C('Avstralija','oceanija','southern',1), NZ:C('Nova Zelandija','oceanija','southern',1),
};

// ---- SL imena za pogosta mesta (ostala ostanejo v izvirniku) ----
const CITY_SL = {
  Vienna:'Dunaj', Venice:'Benetke', Rome:'Rim', Milan:'Milano', Florence:'Firence', Naples:'Neapelj',
  Munich:'Minhen', Prague:'Praga', Warsaw:'Varšava', Brussels:'Bruselj', Lisbon:'Lizbona', Athens:'Atene',
  Copenhagen:'Kopenhagen', Bucharest:'Bukarešta', Cologne:'Köln', Geneva:'Ženeva', Zurich:'Zürich',
  Istanbul:'Istanbul', Moscow:'Moskva', 'Saint Petersburg':'Sankt Peterburg', Cairo:'Kairo', Marrakesh:'Marakeš',
  Belgrade:'Beograd', Sarajevo:'Sarajevo', Skopje:'Skopje', Tirana:'Tirana', Bucharest2:'', Krakow:'Krakov',
  Seville:'Sevilja', Lyon:'Lyon', Nice:'Nica', Marseille:'Marseille', Hamburg:'Hamburg', Frankfurt:'Frankfurt',
  Dublin:'Dublin', Edinburgh:'Edinburg', Manchester:'Manchester', Lisbon2:'', Malaga:'Malaga',
  Valencia:'Valencia', Palma:'Palma de Mallorca', Ibiza:'Ibiza', Tenerife:'Tenerife', 'Las Palmas':'Las Palmas',
  Faro:'Faro', Porto:'Porto', Thessaloniki:'Solun', Heraklion:'Heraklion', Rhodes:'Rodos', Corfu:'Krf',
  Dubai:'Dubaj', Doha:'Doha', Bangkok:'Bangkok', Singapore:'Singapur', 'New York':'New York',
  'Cape Town':'Cape Town', Zanzibar:'Zanzibar', 'Male':'Male', Bali:'Bali', Denpasar:'Denpasar',
  Reykjavik:'Reykjavík', Helsinki:'Helsinki', Stockholm:'Stockholm', Oslo:'Oslo', Bergen:'Bergen',
  Tbilisi:'Tbilisi', Yerevan:'Erevan', Amman:'Aman', 'Tel Aviv':'Tel Aviv', Casablanca:'Casablanca',
  Toronto:'Toronto', Montreal:'Montreal', Havana:'Havana', 'Punta Cana':'Punta Cana', Cancun:'Cancún',
  'Rio de Janeiro':'Rio de Janeiro', 'Sao Paulo':'São Paulo', 'Buenos Aires':'Buenos Aires', Lima:'Lima',
  Bogota:'Bogota', Tokyo:'Tokio', Osaka:'Osaka', Seoul:'Seul', Beijing:'Peking', Shanghai:'Šanghaj',
  'Hong Kong':'Hong Kong', 'Kuala Lumpur':'Kuala Lumpur', 'Ho Chi Minh City':'Ho Ši Minh', Hanoi:'Hanoj',
  Colombo:'Kolombo', Mumbai:'Mumbaj', Delhi:'Delhi', Kathmandu:'Katmandu', Nairobi:'Nairobi',
};

const pad2 = n => String(n).padStart(2,'0');
const ddmm = iso => { const p = iso.slice(0,10).split('-'); return p[2]+p[1]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pub = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };

async function latest(o){
  const url = `https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=${o}&currency=eur&period_type=year&one_way=false&limit=1000&page=1&market=si`;
  try { const r = await fetch(url, { headers:{ 'X-Access-Token':TOKEN } }); if(!r.ok) return []; const j = await r.json(); return j.data||[]; }
  catch { return []; }
}
async function forDates(origin, dest){
  const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${dest}`
    + `&currency=eur&sorting=price&direct=false&limit=30&page=1&one_way=false&market=si`;
  try { const r = await fetch(url, { headers:{ 'X-Access-Token':TOKEN } }); if(!r.ok) return []; const j = await r.json(); return Array.isArray(j.data)?j.data:[]; }
  catch { return []; }
}

// imenski slovarji
const cities = await pub('https://api.travelpayouts.com/data/en/cities.json');
const countries = await pub('https://api.travelpayouts.com/data/en/countries.json');
const CITY = {}, CC = {};
if (cities) for (const c of cities) CITY[c.code] = { name:c.name, cc:c.country_code };
if (countries) for (const c of countries) CC[c.code] = c.name;
const cityName = code => { const n = (CITY[code]&&CITY[code].name)||code; return CITY_SL[n]||n; };

// =================== 1) KURIRANE (kartice) ===================
const curated = [];
for (const rt of ROUTES) {
  const data = await forDates(rt.fromCode, rt.code); await sleep(250);
  if (!data.length) { console.log(`—  ${rt.fromCode}→${rt.code} ${rt.city}: ni podatkov`); continue; }
  const prices = data.map(d=>d.price).filter(p=>p>0);
  const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
  const seen = new Set();
  const below = data.filter(d=>d.price<avg).sort((a,b)=>a.price-b.price)
    .filter(d=>{ const k=d.departure_at.slice(0,10); if(seen.has(k))return false; seen.add(k); return true; })
    .slice(0,6).map(d=>({ depart:d.departure_at.slice(0,10), ret:d.return_at?d.return_at.slice(0,10):null,
      price:Math.round(d.price), airline:d.airline||'', transfers:d.transfers??0,
      url:'https://www.aviasales.com'+d.link+'&marker='+MARKER }));
  if (!below.length) { console.log(`~  ${rt.city}: ni pod povprečjem`); continue; }
  curated.push({ city:rt.city, code:rt.code, country:rt.country, fromCity:rt.fromCity, fromCode:rt.fromCode,
    region:rt.region, img:rt.img, fromPrice:Math.min(...below.map(t=>t.price)), avg:Math.round(avg), terms:below });
  console.log(`✓  ${rt.city}: povpr. ${Math.round(avg)}€ · od ${Math.min(...below.map(t=>t.price))}€`);
}
curated.sort((a,b)=>a.fromPrice-b.fromPrice);

// =================== 2) ODKRIVANJE (velik seznam) ===================
const CURATED_DEST = new Set(ROUTES.map(r=>r.code));
const nightsBetween = (dep,ret) => Math.round((new Date(ret)-new Date(dep))/86400000);
const minNights = dist => dist>7000 ? 6 : dist>5000 ? 5 : dist>3500 ? 4 : dist>2000 ? 3 : 2;

const best = {}; // key origin|dest → najcenejši veljaven
let scanned=0, kept=0;
for (const o of ORIGINS) {
  const data = await latest(o.code); await sleep(250);
  for (const it of data) {
    scanned++;
    if (!it.value || !it.depart_date || !it.return_date) continue;
    const dest = it.destination;
    if (CURATED_DEST.has(dest)) continue;              // ne podvajaj kartic
    const ci = CITY[dest]; if (!ci) continue;
    const cat = CATALOG[ci.cc]; if (!cat) continue;    // samo dovoljene države
    const depMonth = +it.depart_date.slice(5,7);
    if (!SEASON[cat.season].m.includes(depMonth)) continue;   // sezona
    const nights = nightsBetween(it.depart_date, it.return_date);
    if (nights < minNights(it.distance||0) || nights > 30) continue; // dolžina potovanja
    const key = o.code+'|'+dest;
    if (best[key] && best[key].price <= it.value) continue;
    best[key] = {
      fromCode:o.code, fromCity:o.city, code:dest, city:cityName(dest), en:ci.name, enCountry:CC[ci.cc]||'',
      country:cat.sl, continent:cat.cont, exotic:cat.x,
      price:Math.round(it.value), depart:it.depart_date.slice(0,10), ret:it.return_date.slice(0,10),
      nights, transfers:it.number_of_changes??0, season:SEASON[cat.season].note,
      url:'https://www.aviasales.com/search/'+it.origin+ddmm(it.depart_date)+dest+ddmm(it.return_date)+'1?marker='+MARKER,
    };
    kept++;
  }
}
// ZDRUŽI PO DESTINACIJI (ena kartica = ena destinacija; ponudbe iz VSEH letališč v `offers`)
const byDest = {};
for (const d of Object.values(best)) {
  const off = {fromCode:d.fromCode, fromCity:d.fromCity, price:d.price, depart:d.depart, ret:d.ret, nights:d.nights, transfers:d.transfers, url:d.url};
  if (!byDest[d.code]) byDest[d.code] = Object.assign({}, d, {offers:[off]});
  else byDest[d.code].offers.push(off);
}
let uniq = Object.values(byDest);
uniq.forEach(d=>{
  d.offers.sort((a,b)=>a.price-b.price);
  d.froms = [...new Set(d.offers.map(o=>o.fromCode))];
  const c = d.offers[0];  // najcenejši = privzet prikaz (brez filtra po odhodu)
  d.fromCode=c.fromCode; d.fromCity=c.fromCity; d.price=c.price; d.depart=c.depart; d.ret=c.ret; d.nights=c.nights; d.transfers=c.transfers; d.url=c.url;
});
const fullByCont = {}; uniq.forEach(d=>{fullByCont[d.continent]=(fullByCont[d.continent]||0)+1;});
console.log(`\nPregledano ${scanned} letov · unikatnih destinacij ${uniq.length}`);
console.log('Po celinah:', JSON.stringify(fullByCont));

// uravnotežen izbor po celinah (da pridejo zraven tudi eksotične)
const CAPS = {evropa:70, azija:35, afrika:30, 'sev-amerika':14, 'sred-amerika':20, 'juz-amerika':12, oceanija:5};
const groups = {}; uniq.forEach(d=>{(groups[d.continent]=groups[d.continent]||[]).push(d);});
let picked = [];
for (const k in groups){ groups[k].sort((a,b)=>a.price-b.price); picked = picked.concat(groups[k].slice(0, CAPS[k]||25)); }

// SLIKE: prava fotografija mesta prek MediaWiki pageimages (~960px); prenesi lokalno
mkdirSync(new URL('../img/deals/', import.meta.url), {recursive:true});
async function photoURL(city, country){
  try{
    const u='https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch='+encodeURIComponent(city+' '+country)+'&gsrlimit=3&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=900&origin=*';
    const r=await fetch(u,{headers:{'User-Agent':'BookirajBot/1.0 (misa.ravnikar@gmail.com)'}}); if(!r.ok) return null;
    const j=await r.json(); const pages=Object.values((j.query&&j.query.pages)||{});
    if(!pages.length) return null;
    pages.sort((a,b)=>((a.index||9)-(b.index||9)));           // vrstni red iskanja
    const pick=pages.find(p=>p.thumbnail&&p.coordinates)||pages.find(p=>p.thumbnail); // pravo mesto (koordinate) ima prednost
    return (pick&&pick.thumbnail&&pick.thumbnail.source)||null;
  }catch{ return null; }
}
async function download(url, code){
  try{
    const r=await fetch(url,{headers:{'User-Agent':'BookirajBot/1.0 (misa.ravnikar@gmail.com)'}}); if(!r.ok) return false;
    const ct=r.headers.get('content-type')||''; if(!ct.startsWith('image/')) return false;
    const buf=Buffer.from(await r.arrayBuffer()); if(buf.byteLength<3000) return false;
    writeFileSync(new URL('../img/deals/'+code+'.jpg', import.meta.url), buf); return true;
  }catch{ return false; }
}
let discover = [], withImg=0, noImg=0;
for (const d of picked){
  let ok = existsSync(new URL('../img/deals/'+d.code+'.jpg', import.meta.url));  // ne prenašaj že prenesenih
  if (!ok) {
    const src = await photoURL(d.en, d.enCountry); await sleep(120);
    if (src) { ok = await download(src, d.code); await sleep(120); }
  }
  if (!ok) { noImg++; continue; }         // brez slike destinacije ne dodamo
  const photo = 'img/deals/'+d.code+'.jpg';
  // RAZČLENI: ločena kartica za VSAK odhod (ne združuj); vse kartice iste destinacije rabijo isto (pravo) sliko
  for (const o of d.offers) {
    discover.push({
      fromCode:o.fromCode, fromCity:o.fromCity, code:d.code, city:d.city,
      country:d.country, continent:d.continent, exotic:d.exotic, season:d.season,
      price:o.price, depart:o.depart, ret:o.ret, nights:o.nights, transfers:o.transfers,
      url:o.url, photo,
    });
  }
  withImg++;
}
discover.sort((a,b)=>a.price-b.price);
const byCont = {}; discover.forEach(d=>{byCont[d.continent]=(byCont[d.continent]||0)+1;});
console.log(`Slike: ${withImg} ok · ${noImg} brez slike (izpuščene)`);
console.log('Kartice po celinah:', JSON.stringify(byCont));

const payload = { updated:new Date().toISOString(), deals:curated, discover };
writeFileSync(new URL('../deals.js', import.meta.url), 'window.__BOOKIRAJ_DEALS__ = '+JSON.stringify(payload)+';\n');
console.log(`\nKurirane akcije: ${curated.length} · Odkrite akcije (kartice): ${discover.length}`);
