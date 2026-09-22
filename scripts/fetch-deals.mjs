// Bookiraj.si — pobere PRAVE cene z Aviasales/Travelpayouts Data API.
//  1) kurirane proge (slike/opisi) → kartice
//  2) ODKRIVANJE: za vseh 9 letališč potegne najcenejše lete v vse destinacije,
//     filtrira po whitelistu držav (varno/obljudeno), po SEZONI destinacije,
//     po MINIMALNI dolžini potovanja in po ODDALJENOSTI (glej PRAVILA spodaj).
//
// PRAVILA, KI JIH JE DOLOČILA MIŠA (22.9.2026):
//  1. Naša odhodna letališča so SAMO odhodna, nikoli prihodna. Stranke so iz Slovenije —
//     nima smisla, da se peljejo v Benetke, da bi spet čez Slovenijo leteli v Budimpešto.
//     Zato: destinacija ne sme biti nobeno od ORIGINS (niti drugo letališče istega mesta).
//     Dodatna varovalka za mesta, ki jih ni na tem seznamu (Split, Verona, Bratislava …):
//     destinacija mora biti vsaj MIN_HOME_KM od Ljubljane. Od Ljubljane: Minhen 320,
//     Budimpešta 381, Milano 418, Split 322 (zavrni) · Rim 490, Praga 447, Dubrovnik 490 (sprejmi).
//  2. Na stran gredo SAMO akcije vsaj 40 % pod povprečjem proge ALI pod 50 €.
//  3. Vsako odhodno letališče ima SVOJO kartico (nikoli ne združuj LJU + VCE).
//  4. Isti par odhod→prihod = ENA kartica z VSEMI datumi (terms[]).
//  5. Vse povezave vodijo na Aviasales z Mišinim affiliate markerjem.
//  6. Termini, ki padejo v šolske počitnice, dobijo oznako (zavihek Počitniški termini).
//  7. Dnevna povprečja cen se zapišejo v Supabase (tabela price_history) za zgodovino.
// Zažene GitHub Action (skrivnost TRAVELPAYOUTS_TOKEN); lokalno: TRAVELPAYOUTS_TOKEN=... node scripts/fetch-deals.mjs
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const MARKER = process.env.TP_MARKER || '779438';
if (!TOKEN) { console.error('Manjka TRAVELPAYOUTS_TOKEN'); process.exit(1); }

// ---- Mišina pravila (nastavljivo prek okoljskih spremenljivk) ----
const HOME = 'LJU';                                            // domače letališče = merilo bližine
const MIN_HOME_KM  = Number(process.env.MIN_HOME_KM  || 440);  // destinacija mora biti vsaj toliko od Ljubljane
const MIN_ROUTE_KM = Number(process.env.MIN_ROUTE_KM || 300);  // in vsaj toliko od odhodnega letališča
const MIN_DISCOUNT = Number(process.env.MIN_DISCOUNT || 0.40); // vsaj 40 % pod povprečjem proge …
const ALWAYS_UNDER = Number(process.env.ALWAYS_UNDER || 50);   // … ali cena pod 50 €
const MAX_PAIRS    = Number(process.env.MAX_PAIRS    || 320);  // varovalka za število API klicev

// ---- šolske počitnice 2026/27 (Miša, 22.9.2026) ----
const HOLIDAYS = [
  { name:'Jesenske',                         start:'2026-10-24', end:'2026-11-01' },
  { name:'Novoletne',                        start:'2026-12-25', end:'2027-01-03' },
  { name:'Zimske (vzhodna Slovenija)',       start:'2027-02-13', end:'2027-02-21' },
  { name:'Zimske (zahodna in osrednja SLO)', start:'2027-02-20', end:'2027-02-28' },
  { name:'Prvomajske',                       start:'2027-04-24', end:'2027-05-02' },
  { name:'Poletne',                          start:'2027-06-26', end:'2027-08-31' },
];
const holidaysFor = dep => HOLIDAYS.filter(h => dep >= h.start && dep <= h.end).map(h => h.name);

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

// ---- PRAVILO 7: dnevna zgodovina povprečij (Supabase, tabela price_history) ----
// Miša do nje dostopa na https://bookiraj.si/nadzor/cene (isto geslo kot nadzorna plošča).
const SB_URL  = process.env.SUPABASE_URL || 'https://fliwoulbwqcnufdfgvcj.supabase.co';
const SB_KEY  = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaXdvdWxid3FjbnVmZGZndmNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDQwNDIsImV4cCI6MjEwNTU4MDA0Mn0.sTk_F4WrLukbyozCipYkaFuFjkcdru2M9BiYw-wD1Zo';
const SB_PASS = process.env.BKRJ_PASS || 'bookiraj-nadzor-2026';
async function logPrices(rows){
  if (!rows.length) return;
  let ok = 0;
  for (let i = 0; i < rows.length; i += 200) {                  // po kosih, da zahteva ni prevelika
    const chunk = rows.slice(i, i+200);
    try {
      const r = await fetch(SB_URL+'/rest/v1/rpc/log_prices', { method:'POST',
        headers:{ apikey:SB_KEY, Authorization:'Bearer '+SB_KEY, 'Content-Type':'application/json' },
        body: JSON.stringify({ pass:SB_PASS, rows:chunk }) });
      if (r.ok) ok += chunk.length; else console.log('  zgodovina cen: HTTP '+r.status+' '+(await r.text()).slice(0,120));
    } catch (e) { console.log('  zgodovina cen: '+e.message); }
  }
  console.log(`Zgodovina cen: zapisanih ${ok}/${rows.length} prog (bookiraj.si/nadzor/cene)`);
}

// imenski slovarji
const cities = await pub('https://api.travelpayouts.com/data/en/cities.json');
const countries = await pub('https://api.travelpayouts.com/data/en/countries.json');
const CITY = {}, CC = {}, GEOC = {};
if (cities) for (const c of cities) { CITY[c.code] = { name:c.name, cc:c.country_code }; if (c.coordinates) GEOC[c.code] = c.coordinates; }
if (countries) for (const c of countries) CC[c.code] = c.name;
const cityName = code => { const n = (CITY[code]&&CITY[code].name)||code; return CITY_SL[n]||n; };

// ---- razdalje (veliki krog) ----
const rad = d => d*Math.PI/180;
function distKm(a, b){
  const A = GEOC[a], B = GEOC[b];
  if (!A || !B) return null;                       // brez koordinat ne moremo soditi
  const dLat = rad(B.lat-A.lat), dLon = rad(B.lon-A.lon);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(A.lat))*Math.cos(rad(B.lat))*Math.sin(dLon/2)**2;
  return Math.round(2*6371*Math.asin(Math.sqrt(h)));
}
// Pravilo 1a: naša odhodna letališča so SAMO odhodna — nikoli cilj.
// (Z drugimi letališči istih mest: Milano MXP/LIN/BGY, Benetke VCE/TSF, Rim je cilj in ni tu.)
const HOME_HUBS = new Set([
  ...ORIGINS.map(o=>o.code),
  'MIL','MXP','LIN','BGY',          // Milano
  'VCE','TSF','VRN',                // Benetke / Treviso / Verona
  'MUC','BUD','VIE','ZAG','LJU','TRS',
]);
// Pravilo 1b: in nič, kar je tako blizu, da se tja pelješ z avtom (Split, Bratislava, Gradec …).
function tooClose(origin, dest){
  if (HOME_HUBS.has(dest)) return true;            // naše odhodno letališče ni destinacija
  const home = distKm(HOME, dest);
  if (home == null) return true;                   // neznana lega → raje izpusti
  if (home < MIN_HOME_KM) return true;
  const route = distKm(origin, dest);
  if (route != null && route < MIN_ROUTE_KM) return true;
  return false;
}

// ---- skupna obdelava ene proge (odhod → prihod) ----
// Vrne povprečje proge in SAMO tiste termine, ki ustrezajo Mišinemu pravilu 2
// (vsaj MIN_DISCOUNT pod povprečjem ALI pod ALWAYS_UNDER €). Datumi se zberejo
// na eno kartico (pravilo 4) in vsak dobi oznako počitnic (pravilo 6).
const priceLog = [];   // pravilo 7: dnevna zgodovina povprečij
function routeTerms(data, fromCode, code, meta){
  const prices = data.map(d=>d.price).filter(p=>p>0);
  if (prices.length < 3) return null;                       // premalo vzorcev za pošteno povprečje
  const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
  const minAll = Math.min(...prices);
  priceLog.push({ from_code:fromCode, code, city:meta.city, country:meta.country,
    avg:Math.round(avg), min:Math.round(minAll), samples:prices.length });

  const cut = avg * (1 - MIN_DISCOUNT);
  const seen = new Set();
  const terms = data
    .filter(d => d.price > 0 && (d.price <= cut || d.price < ALWAYS_UNDER))
    .sort((a,b)=>a.price-b.price)
    .filter(d => { const k = (d.departure_at||'').slice(0,10); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0,8)
    .map(d => {
      const depart = d.departure_at.slice(0,10);
      const ret = d.return_at ? d.return_at.slice(0,10) : null;
      const hol = holidaysFor(depart);
      return { depart, ret, price:Math.round(d.price), airline:d.airline||'', transfers:d.transfers??0,
        nights: ret ? Math.round((new Date(ret)-new Date(depart))/86400000) : null,
        discount: Math.max(0, Math.round((avg-d.price)/avg*100)),
        hol: hol.length ? hol : undefined,
        // pravilo 5: vedno Aviasales z Mišinim markerjem
        url: 'https://www.aviasales.com'+d.link+'&marker='+MARKER };
    })
    .sort((a,b)=>a.depart<b.depart?-1:1);                   // na kartici po datumu
  if (!terms.length) return null;
  const fromPrice = Math.min(...terms.map(t=>t.price));
  return { avg:Math.round(avg), terms, fromPrice,
    discount: Math.max(0, Math.round((avg-fromPrice)/avg*100)),
    holidays: [...new Set(terms.flatMap(t=>t.hol||[]))] };
}

// =================== 1) KURIRANE (kartice) ===================
const curated = [];
let skipCur = 0;
for (const rt of ROUTES) {
  const data = await forDates(rt.fromCode, rt.code); await sleep(250);
  if (!data.length) { console.log(`—  ${rt.fromCode}→${rt.code} ${rt.city}: ni podatkov`); continue; }
  const r = routeTerms(data, rt.fromCode, rt.code, {city:rt.city, country:rt.country});
  if (!r) { skipCur++; console.log(`~  ${rt.city}: ni akcije (−${Math.round(MIN_DISCOUNT*100)} % ali <${ALWAYS_UNDER} €)`); continue; }
  curated.push({ city:rt.city, code:rt.code, country:rt.country, fromCity:rt.fromCity, fromCode:rt.fromCode,
    region:rt.region, img:rt.img, fromPrice:r.fromPrice, avg:r.avg, terms:r.terms, holidays:r.holidays });
  console.log(`✓  ${rt.city}: povpr. ${r.avg}€ · od ${r.fromPrice}€ (−${r.discount} %)${r.holidays.length?' · '+r.holidays.join(', '):''}`);
}
curated.sort((a,b)=>a.fromPrice-b.fromPrice);

// =================== 2) ODKRIVANJE (velik seznam) ===================
const CURATED_PAIR = new Set(ROUTES.map(r=>r.fromCode+'|'+r.code));
const nightsBetween = (dep,ret) => Math.round((new Date(ret)-new Date(dep))/86400000);
const minNights = dist => dist>7000 ? 6 : dist>5000 ? 5 : dist>3500 ? 4 : dist>2000 ? 3 : 2;

// 2a) kandidatni pari odhod→prihod (pravilo 3: par, ne destinacija)
const cand = {};
let scanned=0, dropClose=0, dropCat=0, dropSeason=0, dropNights=0;
for (const o of ORIGINS) {
  const data = await latest(o.code); await sleep(250);
  for (const it of data) {
    scanned++;
    if (!it.value || !it.depart_date || !it.return_date) continue;
    const dest = it.destination;
    if (CURATED_PAIR.has(o.code+'|'+dest)) continue;         // ne podvajaj kurirane kartice
    const ci = CITY[dest]; if (!ci) continue;
    const cat = CATALOG[ci.cc]; if (!cat) { dropCat++; continue; }      // samo dovoljene države
    if (tooClose(o.code, dest)) { dropClose++; continue; }              // PRAVILO 1
    const depMonth = +it.depart_date.slice(5,7);
    if (!SEASON[cat.season].m.includes(depMonth)) { dropSeason++; continue; }
    const nights = nightsBetween(it.depart_date, it.return_date);
    if (nights < minNights(it.distance||0) || nights > 30) { dropNights++; continue; }
    const key = o.code+'|'+dest;
    if (cand[key] && cand[key].hint <= it.value) continue;
    cand[key] = { fromCode:o.code, fromCity:o.city, code:dest, city:cityName(dest),
      en:ci.name, enCountry:CC[ci.cc]||'', country:cat.sl, continent:cat.cont, exotic:cat.x,
      season:SEASON[cat.season].note, hint:Math.round(it.value),
      homeKm:distKm(HOME,dest), routeKm:distKm(o.code,dest) };
  }
}
let pairs = Object.values(cand).sort((a,b)=>a.hint-b.hint);
console.log(`\nPregledano ${scanned} letov · kandidatnih prog ${pairs.length}`);
console.log(`Izpuščeno: ${dropClose} prebližu (<${MIN_HOME_KM} km od Ljubljane) · ${dropCat} država ni v katalogu · ${dropSeason} napačna sezona · ${dropNights} dolžina potovanja`);

// uravnotežen izbor po celinah, da pridejo zraven tudi eksotične
const CAPS = {evropa:130, azija:60, afrika:45, 'sev-amerika':25, 'sred-amerika':30, 'juz-amerika':20, oceanija:10};
const groups = {}; pairs.forEach(d=>{(groups[d.continent]=groups[d.continent]||[]).push(d);});
let picked = [];
for (const k in groups) picked = picked.concat(groups[k].slice(0, CAPS[k]||25));
picked.sort((a,b)=>a.hint-b.hint);
if (picked.length > MAX_PAIRS) picked = picked.slice(0, MAX_PAIRS);
console.log(`Preverjam prave cene za ${picked.length} prog …`);

// 2b) prave cene + povprečje proge + PRAVILO 2 (−40 % ali <50 €)
const kept = [];
let noDeal = 0, noData = 0;
for (const d of picked) {
  const data = await forDates(d.fromCode, d.code); await sleep(180);
  if (!data.length) { noData++; continue; }
  const r = routeTerms(data, d.fromCode, d.code, {city:d.city, country:d.country});
  if (!r) { noDeal++; continue; }
  kept.push(Object.assign({}, d, r));
}
console.log(`Ustreza pravilu (−${Math.round(MIN_DISCOUNT*100)} % ali <${ALWAYS_UNDER} €): ${kept.length} · brez akcije ${noDeal} · brez podatkov ${noData}`);

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
const imgOK = new Map();                       // code → ali imamo sliko (ena slika na destinacijo)
let discover = [], noImg = 0;
for (const d of kept){
  if (!imgOK.has(d.code)) {
    let ok = existsSync(new URL('../img/deals/'+d.code+'.jpg', import.meta.url));
    if (!ok) {
      const src = await photoURL(d.en, d.enCountry); await sleep(120);
      if (src) { ok = await download(src, d.code); await sleep(120); }
    }
    imgOK.set(d.code, ok);
  }
  if (!imgOK.get(d.code)) { noImg++; continue; }   // brez slike destinacije ne dodamo
  const c = d.terms.reduce((m,t)=>t.price<m.price?t:m, d.terms[0]);   // najcenejši termin = naslovni
  discover.push({
    fromCode:d.fromCode, fromCity:d.fromCity, code:d.code, city:d.city,
    country:d.country, continent:d.continent, exotic:d.exotic, season:d.season,
    price:c.price, avg:d.avg, discount:d.discount,
    depart:c.depart, ret:c.ret, nights:c.nights, transfers:c.transfers, url:c.url,
    terms:d.terms, holidays:d.holidays, photo:'img/deals/'+d.code+'.jpg',
  });
}
discover.sort((a,b)=>a.price-b.price);
const byCont = {}; discover.forEach(d=>{byCont[d.continent]=(byCont[d.continent]||0)+1;});
const holCount = {}; discover.concat(curated).forEach(d=>(d.holidays||[]).forEach(h=>{holCount[h]=(holCount[h]||0)+1;}));
console.log(`Slike: ${discover.length} kartic · ${noImg} izpuščenih brez slike`);
console.log('Kartice po celinah:', JSON.stringify(byCont));
console.log('Počitniški termini:', JSON.stringify(holCount));

// ---- PRAVILO 5: nobena povezava ne sme uiti z Aviasalesa ----
const badUrl = [];
for (const d of curated.concat(discover))
  for (const t of (d.terms||[]))
    if (!/^https:\/\/(www\.)?aviasales\.com\//.test(t.url) || t.url.indexOf('marker='+MARKER) < 0) badUrl.push(d.code+' '+t.depart);
if (badUrl.length) { console.error('NAPAKA: povezave brez Aviasales/markerja:', badUrl.slice(0,5)); process.exit(1); }

// ---- PRAVILO 7: dnevna zgodovina povprečij v Supabase ----
await logPrices(priceLog);

const payload = { updated:new Date().toISOString(), rules:{minDiscount:MIN_DISCOUNT, alwaysUnder:ALWAYS_UNDER, minHomeKm:MIN_HOME_KM}, deals:curated, discover };
writeFileSync(new URL('../deals.js', import.meta.url), 'window.__BOOKIRAJ_DEALS__ = '+JSON.stringify(payload)+';\n');
const allTerms = curated.concat(discover).reduce((s,d)=>s+d.terms.length,0);
console.log(`\nKurirane akcije: ${curated.length} (${skipCur} brez akcije) · Odkrite kartice: ${discover.length} · skupaj terminov: ${allTerms}`);
