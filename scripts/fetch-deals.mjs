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
const MAX_PAIRS    = Number(process.env.MAX_PAIRS    || 300);  // varovalka za število API klicev
// »še išči datume, tudi nepočitniške, dokler ne rečem da je dovolj« — koliko mesecev naprej
// pregledamo za vsako progo. Več mesecev = več terminov, a daljši zagon. Zvišaj, ko reče »še«.
// ⚠️ SEARCH_MONTHS × MAX_PAIRS = število API klicev. Pri ~3900 klicih nas Travelpayouts
// začasno omeji (429) in zagon vrne prazno. 6 mesecev × 300 prog je preizkušeno varno.
const SEARCH_MONTHS= Number(process.env.SEARCH_MONTHS|| 6);
const SLEEP_MS     = Number(process.env.SLEEP_MS     || 150);
const MAX_TERMS    = Number(process.env.MAX_TERMS    || 40);   // največ terminov na kartico

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
const plusDays = (iso,n) => { const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
// Miša: »za počitniške termine bolj oddaljene destinacije. Sploh za božične in zimske daj
// tropske — Maldivi, Tajska, Kostarika, Karibi, Bahami, Egipt, Afrika, Indonezija, Azija …«
const SUNNY = new Set(['tropic','desert','southern','equator','safari']);   // sezonski arhetipi toplih krajev
const WINTER_HOL = new Set(['Novoletne','Zimske (vzhodna Slovenija)','Zimske (zahodna in osrednja SLO)']);
const SUN_MIN_KM = Number(process.env.SUN_MIN_KM || 2500);   // »bolj oddaljene«
const SUN_QUOTA  = Number(process.env.SUN_QUOTA  || 90);     // koliko takih prog vedno pride v izbor

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
  LA:C('Laos','azija','tropic',1),
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
  // Srednja Amerika (+ Karibi) — Miša želi za božič/zimo tropske destinacije
  MX:C('Mehika','sred-amerika','tropic',1), CU:C('Kuba','sred-amerika','tropic',1), DO:C('Dominikanska rep.','sred-amerika','tropic',1),
  JM:C('Jamajka','sred-amerika','tropic',1), CR:C('Kostarika','sred-amerika','equator',1), PA:C('Panama','sred-amerika','equator',1),
  BS:C('Bahami','sred-amerika','tropic',1), BB:C('Barbados','sred-amerika','tropic',1), AG:C('Antigva in Barbuda','sred-amerika','tropic',1),
  AW:C('Aruba','sred-amerika','tropic',1), CW:C('Curaçao','sred-amerika','tropic',1), LC:C('Sveta Lucija','sred-amerika','tropic',1),
  TT:C('Trinidad in Tobago','sred-amerika','tropic',1), TC:C('Otoki Turks in Caicos','sred-amerika','tropic',1),
  PR:C('Portoriko','sred-amerika','tropic',1), BZ:C('Belize','sred-amerika','tropic',1), GT:C('Gvatemala','sred-amerika','equator',1),
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

// Travelpayouts ob preveč klicih zapored začasno zavrača (429). Takrat počakamo in poskusimo
// znova — sicer bi se zagon tiho končal s praznimi podatki.
let rateHits = 0, hardFails = 0, apiCalls = 0;
async function api(url){
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      apiCalls++;
      const r = await fetch(url, { headers:{ 'X-Access-Token':TOKEN } });
      if (r.status === 429 || r.status === 503) { rateHits++; await sleep(2500*(attempt+1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(900*(attempt+1)); }
  }
  hardFails++; return null;
}
async function latest(o){
  const j = await api(`https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=${o}&currency=eur&period_type=year&one_way=false&limit=1000&page=1&market=si`);
  return (j && j.data) || [];
}
async function forDates(origin, dest, month){
  const j = await api(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${dest}`
    + `&currency=eur&sorting=price&direct=false&limit=30&page=1&one_way=false&market=si`
    + (month ? `&departure_at=${month}` : ''));
  return (j && Array.isArray(j.data)) ? j.data : [];
}
// najcenejši leti za DOLOČEN MESEC (za iskanje počitniških akcij)
async function latestMonth(origin, month){
  const j = await api(`https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=${origin}&currency=eur`
    + `&period_type=month&beginning_of_period=${month}-01&one_way=false&limit=1000&page=1&market=si`);
  return (j && j.data) || [];
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

// ---- letalske družbe + prtljaga ----
// Miša: »vedno naj tudi piše katera letalska družba je in z ikono naj bo narisano
// katera prtljaga pripada«. API ne vrne prtljage za konkretno vozovnico, zato jo
// sklepamo iz PRIVZETE politike prevoznika (Travelpayouts zastavica is_lowcost) in
// dolžine leta. Na strani je to jasno označeno kot privzeto, ne kot zagotovilo.
const airlines = await pub('https://api.travelpayouts.com/data/airlines.json');
const AIR = {};
if (airlines) for (const a of airlines) if (a.code) AIR[a.code] = { name:a.name||a.code, lowcost:!!a.is_lowcost };
const airName = c => (AIR[c] && AIR[c].name) || c || '';
// 'osebna' = samo majhna torba pod sedežem · 'rocna' = ročna v kabini · 'oddana' = tudi oddana prtljaga
function bagTier(code, km){
  const a = AIR[code];
  if (a && a.lowcost) return 'osebna';
  if (!a) return 'rocna';                       // neznan prevoznik → previdna sredina
  return (km && km > 3500) ? 'oddana' : 'rocna';
}

// ---- skupna obdelava ene proge (odhod → prihod) ----
// Pravilo 2: obdržimo SAMO termine vsaj MIN_DISCOUNT pod povprečjem proge ALI pod ALWAYS_UNDER €.
// Pravilo 4: vsi datumi gredo na isto kartico. Pravilo 6: vsak termin dobi oznako počitnic.
const priceLog = [];   // pravilo 7: dnevna zgodovina povprečij
const AVG = {};        // 'ODHOD|CILJ' → povprečje proge (da ga ne računamo dvakrat)
function routeAvg(data, fromCode, code, meta){
  const prices = data.map(d=>d.price).filter(p=>p>0);
  if (prices.length < 3) return null;                       // premalo vzorcev za pošteno povprečje
  const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
  AVG[fromCode+'|'+code] = avg;
  priceLog.push({ from_code:fromCode, code, city:meta.city, country:meta.country,
    avg:Math.round(avg), min:Math.round(Math.min(...prices)), samples:prices.length });
  return avg;
}
function pickTerms(data, avg, km, opt){
  const cut = avg * (1 - MIN_DISCOUNT);
  const win = (opt && opt.window) || null;                  // {start,end} za počitniško iskanje
  const seen = new Set();
  return data
    .filter(d => d.price > 0 && (d.price <= cut || d.price < ALWAYS_UNDER))
    .filter(d => {
      if (!win) return true;
      const dep = (d.departure_at||'').slice(0,10);
      const ret = d.return_at ? d.return_at.slice(0,10) : dep;
      return dep >= win.start && dep <= win.end && ret <= win.endPlus;   // potovanje ostane v počitnicah
    })
    .sort((a,b)=>a.price-b.price)
    .filter(d => { const k = (d.departure_at||'').slice(0,10); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .map(d => {
      const depart = d.departure_at.slice(0,10);
      const ret = d.return_at ? d.return_at.slice(0,10) : null;
      const hol = holidaysFor(depart);
      const code = d.airline || '';
      return { depart, ret, price:Math.round(d.price), airline:code, airlineName:airName(code),
        bag:bagTier(code, km), transfers:d.transfers??0,
        nights: ret ? Math.round((new Date(ret)-new Date(depart))/86400000) : null,
        discount: Math.max(0, Math.round((avg-d.price)/avg*100)),
        hol: hol.length ? hol : undefined,
        // pravilo 5: vedno Aviasales z Mišinim markerjem
        url: 'https://www.aviasales.com'+d.link+'&marker='+MARKER };
    });
}
// Združi termine na eno kartico (pravilo 4): brez podvojenih datumov, urejeno po datumu.
function mergeTerms(){
  const seen = new Set(), out = [];
  for (const t of [].concat(...arguments).filter(Boolean)) {
    if (seen.has(t.depart)) continue;
    seen.add(t.depart); out.push(t);
  }
  return out.sort((a,b)=>a.depart<b.depart?-1:1).slice(0,MAX_TERMS);
}
function cardStats(terms, avg){
  const fromPrice = Math.min(...terms.map(t=>t.price));
  return { avg:Math.round(avg), terms, fromPrice,
    discount: Math.max(0, Math.round((avg-fromPrice)/avg*100)),
    holidays: [...new Set(terms.flatMap(t=>t.hol||[]))] };
}
function routeTerms(data, fromCode, code, meta){
  const avg = routeAvg(data, fromCode, code, meta);
  if (avg == null) return null;
  const terms = pickTerms(data, avg, distKm(fromCode, code)).slice(0,MAX_TERMS).sort((a,b)=>a.depart<b.depart?-1:1);
  if (!terms.length) return null;
  const r = cardStats(terms, avg);
  r.rawAvg = avg;
  return r;
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
// 2a-2) Še en pregled po MESECIH ŠOLSKIH POČITNIC — celoletni pregled vrne najcenejše
// datume v letu in počitniške proge pogosto sploh ne pridejo v izbor.
const holMonths = [...new Set(HOLIDAYS.flatMap(h => {
  const out = [], d = new Date(h.start+'T00:00:00Z'), end = new Date(h.end+'T00:00:00Z');
  while (d <= end) { out.push(d.toISOString().slice(0,7)); d.setUTCMonth(d.getUTCMonth()+1, 1); }
  return out;
}))];
let holScanned = 0, holAdded = 0;
for (const mth of holMonths) {
  for (const o of ORIGINS) {
    const data = await latestMonth(o.code, mth); await sleep(200);
    for (const it of data) {
      holScanned++;
      if (!it.value || !it.depart_date || !it.return_date) continue;
      const dest = it.destination;
      if (CURATED_PAIR.has(o.code+'|'+dest)) continue;
      const ci = CITY[dest]; if (!ci) continue;
      const cat = CATALOG[ci.cc]; if (!cat) continue;
      if (tooClose(o.code, dest)) continue;
      if (!SEASON[cat.season].m.includes(+it.depart_date.slice(5,7))) continue;
      const key = o.code+'|'+dest;
      // zimsko sonce: tropska/topla destinacija, dovolj daleč, v božičnih ali zimskih počitnicah
      const winterSun = SUNNY.has(cat.season) && (distKm(HOME,dest)||0) >= SUN_MIN_KM
        && holidaysFor(it.depart_date.slice(0,10)).some(n => WINTER_HOL.has(n));
      if (cand[key]) {
        cand[key].hint = Math.min(cand[key].hint, Math.round(it.value));
        if (winterSun) cand[key].winterSun = true;
        continue;
      }
      cand[key] = { fromCode:o.code, fromCity:o.city, code:dest, city:cityName(dest),
        en:ci.name, enCountry:CC[ci.cc]||'', country:cat.sl, continent:cat.cont, exotic:cat.x,
        season:SEASON[cat.season].note, hint:Math.round(it.value), winterSun,
        homeKm:distKm(HOME,dest), routeKm:distKm(o.code,dest) };
      holAdded++;
    }
  }
}

let pairs = Object.values(cand).sort((a,b)=>a.hint-b.hint);
console.log(`\nPregledano ${scanned} letov (celo leto) + ${holScanned} v počitniških mesecih · kandidatnih prog ${pairs.length} (${holAdded} samo iz počitnic)`);
console.log(`Izpuščeno: ${dropClose} prebližu (<${MIN_HOME_KM} km od Ljubljane) · ${dropCat} država ni v katalogu · ${dropSeason} napačna sezona · ${dropNights} dolžina potovanja`);

// ZIMSKO SONCE IMA PREDNOST: tople, oddaljene destinacije za božične in zimske počitnice
// pridejo v izbor pred cenenimi evropskimi skoki (te bi sicer vedno zasedle mesta).
const sunPairs = pairs.filter(d => d.winterSun).slice(0, SUN_QUOTA);
const sunKeys = new Set(sunPairs.map(d=>d.fromCode+'|'+d.code));
console.log(`Zimsko sonce (tropske/oddaljene za božič in zimske počitnice): ${pairs.filter(d=>d.winterSun).length} najdenih, jemljem ${sunPairs.length}`);

// uravnotežen izbor po celinah, da pridejo zraven tudi eksotične
const CAPS = {evropa:120, azija:60, afrika:45, 'sev-amerika':25, 'sred-amerika':40, 'juz-amerika':20, oceanija:10};
const groups = {};
pairs.forEach(d=>{ if(!sunKeys.has(d.fromCode+'|'+d.code)) (groups[d.continent]=groups[d.continent]||[]).push(d); });
let rest = [];
for (const k in groups) rest = rest.concat(groups[k].slice(0, CAPS[k]||25));
rest.sort((a,b)=>a.hint-b.hint);
let picked = sunPairs.concat(rest);
if (picked.length > MAX_PAIRS) picked = picked.slice(0, MAX_PAIRS);
console.log(`Preverjam prave cene za ${picked.length} prog (od tega ${picked.filter(d=>d.winterSun).length} zimsko sonce) …`);

// 2b) GLOBOKO ISKANJE DATUMOV
// Miša: »še išči datume, tudi nepočitniške, dokler ne rečem da je dovolj.«
// Zato za vsako progo ne pogledamo le 30 najcenejših letov čez celo leto, ampak gremo
// MESEC PO MESEC (SEARCH_MONTHS naprej). Tako najdemo veliko več terminov, ki ustrezajo
// pravilu 2. Vsi gredo na ISTO kartico (pravilo 4). Isti klici pokrijejo tudi počitnice.
const monthList = (() => {
  const out = [], d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < SEARCH_MONTHS; i++) { out.push(d.toISOString().slice(0,7)); d.setUTCMonth(d.getUTCMonth()+1); }
  return out;
})();
const winOf = mth => HOLIDAYS
  .map(h => ({ name:h.name, start:h.start, end:h.end, endPlus:plusDays(h.end,3) }))
  .filter(w => w.start.slice(0,7) <= mth && mth <= w.end.slice(0,7));

const kept = [];
let noDeal = 0, noData = 0, calls = 0, holTerms = 0;
for (const d of picked) {
  const meta = {city:d.city, country:d.country};
  const base = await forDates(d.fromCode, d.code); calls++; await sleep(SLEEP_MS);
  if (!base.length) { noData++; continue; }
  const avg = routeAvg(base, d.fromCode, d.code, meta);
  if (avg == null) { noDeal++; continue; }
  const km = distKm(d.fromCode, d.code);

  let found = pickTerms(base, avg, km);                     // najcenejši čez celo leto
  for (const mth of monthList) {
    const data = await forDates(d.fromCode, d.code, mth); calls++; await sleep(SLEEP_MS);
    if (!data.length) continue;
    found = found.concat(pickTerms(data, avg, km));         // pravilo 2 glede na letno povprečje

    // Počitniški termini se primerjajo tudi s povprečjem SVOJEGA obdobja
    // (božični let skoraj nikoli ni 40 % pod letnim povprečjem — takrat so cene višje za vse).
    for (const w of winOf(mth)) {
      const inWin = data.filter(x => {
        const dep = (x.departure_at||'').slice(0,10);
        const ret = x.return_at ? x.return_at.slice(0,10) : dep;
        return x.price > 0 && dep >= w.start && dep <= w.end && ret <= w.endPlus;
      });
      const wp = inWin.map(x=>x.price);
      if (wp.length < 3) continue;
      const holAvg = wp.reduce((a,b)=>a+b,0)/wp.length;
      const extra = pickTerms(inWin, holAvg, km, {window:w}).map(t => {
        t.holAvg = Math.round(holAvg); t.holName = w.name; t.holDiscount = t.discount;
        t.discount = Math.max(0, Math.round((avg-t.price)/avg*100));
        return t;
      });
      holTerms += extra.length;
      found = found.concat(extra);
    }
  }
  const terms = mergeTerms(found);
  if (!terms.length) { noDeal++; continue; }
  kept.push(Object.assign({}, d, cardStats(terms, avg)));
}
const keptTerms = kept.reduce((s,k)=>s+k.terms.length,0);
console.log(`Ustreza pravilu (−${Math.round(MIN_DISCOUNT*100)} % ali <${ALWAYS_UNDER} €): ${kept.length} kartic · ${keptTerms} terminov (${holTerms} počitniških) · brez akcije ${noDeal} · brez podatkov ${noData} · API klicev ${calls}`);

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
    airline:c.airline, airlineName:c.airlineName, bag:c.bag,
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

// ---- VAROVALKA: nikoli ne prepiši deals.js s praznimi/okrnjenimi podatki ----
// Če API omeji klice (429) ali pade, bi sicer stran ostala brez akcij.
if (curated.length < 3 || discover.length < 25) {
  console.error(`\n❌ PREMALO PODATKOV — deals.js NI bil prepisan (obstoječe akcije ostanejo).`);
  console.error(`   kurirane ${curated.length} (najmanj 3) · odkrite ${discover.length} (najmanj 25)`);
  console.error(`   API: ${apiCalls} klicev · ${rateHits} zavrnjenih zaradi omejitve · ${hardFails} neuspelih.`);
  console.error(`   Najverjetneje začasna omejitev Travelpayouts. Poskusi čez kakšno uro.`);
  process.exit(2);
}

// ---- PRAVILO 7: dnevna zgodovina povprečij v Supabase ----
await logPrices(priceLog);

const payload = { updated:new Date().toISOString(), rules:{minDiscount:MIN_DISCOUNT, alwaysUnder:ALWAYS_UNDER, minHomeKm:MIN_HOME_KM}, deals:curated, discover };
writeFileSync(new URL('../deals.js', import.meta.url), 'window.__BOOKIRAJ_DEALS__ = '+JSON.stringify(payload)+';\n');
const allTerms = curated.concat(discover).reduce((s,d)=>s+d.terms.length,0);
console.log(`\nKurirane akcije: ${curated.length} (${skipCur} brez akcije) · Odkrite kartice: ${discover.length} · skupaj terminov: ${allTerms}`);
