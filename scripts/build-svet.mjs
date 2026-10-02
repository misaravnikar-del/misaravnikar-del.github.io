// Bookiraj.si — zgradi svet.js: vse države sveta in njihova KOMERCIALNA letališča.
// Vir: Travelpayouts (airports.json, countries.json, cities.json).
// Filter: flightable = true in iata_type = "airport" (brez heliportov, postaj in
// majhnih letališč za zasebna letala).
// Izhod: svet.js → window.__BOOKIRAJ_SVET__ = {drzave:[{cc,sl,letalisca:[{k,ime,mesto}]}]}
// Zagon: node scripts/build-svet.mjs
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'BookirajBot/1.0 (misa.ravnikar@gmail.com)' };
const get = async u => (await fetch(u, { headers: UA })).json();

const [airports, countries, cities] = await Promise.all([
  get('https://api.travelpayouts.com/data/en/airports.json'),
  get('https://api.travelpayouts.com/data/en/countries.json'),
  get('https://api.travelpayouts.com/data/en/cities.json'),
]);

// slovenska imena držav; kar ni tu, ostane v angleščini
const SL = {
AD:'Andora',AE:'Združeni arabski emirati',AF:'Afganistan',AG:'Antigva in Barbuda',AI:'Angvila',AL:'Albanija',
AM:'Armenija',AO:'Angola',AR:'Argentina',AS:'Ameriška Samoa',AT:'Avstrija',AU:'Avstralija',AW:'Aruba',
AZ:'Azerbajdžan',BA:'Bosna in Hercegovina',BB:'Barbados',BD:'Bangladeš',BE:'Belgija',BF:'Burkina Faso',
BG:'Bolgarija',BH:'Bahrajn',BI:'Burundi',BJ:'Benin',BM:'Bermudi',BN:'Brunej',BO:'Bolivija',BR:'Brazilija',
BS:'Bahami',BT:'Butan',BW:'Bocvana',BY:'Belorusija',BZ:'Belize',CA:'Kanada',CD:'Demokratična republika Kongo',
CF:'Srednjeafriška republika',CG:'Kongo',CH:'Švica',CI:'Slonokoščena obala',CK:'Cookovi otoki',CL:'Čile',
CM:'Kamerun',CN:'Kitajska',CO:'Kolumbija',CR:'Kostarika',CU:'Kuba',CV:'Zelenortski otoki',CW:'Curaçao',
CY:'Ciper',CZ:'Češka',DE:'Nemčija',DJ:'Džibuti',DK:'Danska',DM:'Dominika',DO:'Dominikanska republika',
DZ:'Alžirija',EC:'Ekvador',EE:'Estonija',EG:'Egipt',ER:'Eritreja',ES:'Španija',ET:'Etiopija',FI:'Finska',
FJ:'Fidži',FK:'Falklandski otoki',FM:'Mikronezija',FO:'Ferski otoki',FR:'Francija',GA:'Gabon',GB:'Združeno kraljestvo',
GD:'Grenada',GE:'Gruzija',GF:'Francoska Gvajana',GH:'Gana',GI:'Gibraltar',GL:'Grenlandija',GM:'Gambija',
GN:'Gvineja',GP:'Guadeloupe',GQ:'Ekvatorialna Gvineja',GR:'Grčija',GT:'Gvatemala',GU:'Guam',GW:'Gvineja Bissau',
GY:'Gvajana',HK:'Hongkong',HN:'Honduras',HR:'Hrvaška',HT:'Haiti',HU:'Madžarska',ID:'Indonezija',IE:'Irska',
IL:'Izrael',IN:'Indija',IQ:'Irak',IR:'Iran',IS:'Islandija',IT:'Italija',JM:'Jamajka',JO:'Jordanija',JP:'Japonska',
KE:'Kenija',KG:'Kirgizistan',KH:'Kambodža',KI:'Kiribati',KM:'Komori',KN:'Saint Kitts in Nevis',KP:'Severna Koreja',
KR:'Južna Koreja',KW:'Kuvajt',KY:'Kajmanski otoki',KZ:'Kazahstan',LA:'Laos',LB:'Libanon',LC:'Sveta Lucija',
LK:'Šrilanka',LR:'Liberija',LS:'Lesoto',LT:'Litva',LU:'Luksemburg',LV:'Latvija',LY:'Libija',MA:'Maroko',
MC:'Monako',MD:'Moldavija',ME:'Črna gora',MG:'Madagaskar',MH:'Marshallovi otoki',MK:'Severna Makedonija',
ML:'Mali',MM:'Mjanmar',MN:'Mongolija',MO:'Macao',MP:'Severni Marianski otoki',MQ:'Martinik',MR:'Mavretanija',
MT:'Malta',MU:'Mauritius',MV:'Maldivi',MW:'Malavi',MX:'Mehika',MY:'Malezija',MZ:'Mozambik',NA:'Namibija',
NC:'Nova Kaledonija',NE:'Niger',NG:'Nigerija',NI:'Nikaragva',NL:'Nizozemska',NO:'Norveška',NP:'Nepal',
NR:'Nauru',NZ:'Nova Zelandija',OM:'Oman',PA:'Panama',PE:'Peru',PF:'Francoska Polinezija',PG:'Papua Nova Gvineja',
PH:'Filipini',PK:'Pakistan',PL:'Poljska',PM:'Saint Pierre in Miquelon',PR:'Portoriko',PS:'Palestina',
PT:'Portugalska',PW:'Palau',PY:'Paragvaj',QA:'Katar',RE:'Reunion',RO:'Romunija',RS:'Srbija',RU:'Rusija',
RW:'Ruanda',SA:'Savdska Arabija',SB:'Salomonovi otoki',SC:'Sejšeli',SD:'Sudan',SE:'Švedska',SG:'Singapur',
SI:'Slovenija',SK:'Slovaška',SL:'Sierra Leone',SN:'Senegal',SO:'Somalija',SR:'Surinam',SS:'Južni Sudan',
ST:'Sao Tome in Principe',SV:'Salvador',SX:'Sint Maarten',SY:'Sirija',SZ:'Esvatini',TC:'Otoki Turks in Caicos',
TD:'Čad',TG:'Togo',TH:'Tajska',TJ:'Tadžikistan',TL:'Vzhodni Timor',TM:'Turkmenistan',TN:'Tunizija',TO:'Tonga',
TR:'Turčija',TT:'Trinidad in Tobago',TW:'Tajvan',TZ:'Tanzanija',UA:'Ukrajina',UG:'Uganda',US:'Združene države Amerike',
UY:'Urugvaj',UZ:'Uzbekistan',VC:'Saint Vincent in Grenadine',VE:'Venezuela',VG:'Britanski Deviški otoki',
VI:'Ameriški Deviški otoki',VN:'Vietnam',VU:'Vanuatu',WS:'Samoa',XK:'Kosovo',YE:'Jemen',YT:'Mayotte',
ZA:'Južna Afrika',ZM:'Zambija',ZW:'Zimbabve',
// manjša ozemlja in otoki
AB:'Abhazija',AX:'Ålandski otoki',BQ:'Nizozemski Karibi',CX:'Božični otok',CC:'Kokosovi otoki',
KX:'Krim',GG:'Guernsey',IM:'Otok Man',JE:'Jersey',MS:'Montserrat',NU:'Niue',NF:'Norfolški otok',
NY:'Severni Ciper',SH:'Sveta Helena',MF:'Saint Martin',SJ:'Svalbard in Jan Mayen',TV:'Tuvalu',
WF:'Wallis in Futuna',EH:'Zahodna Sahara',
};

// celine — ista imena kot Mišine mape na namizju
const CEL = {
evropa:['AD','AL','AT','AX','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI','FO','FR','GB','GG','GI','GR','HR','HU','IE','IM','IS','IT','JE','KX','LI','LT','LU','LV','MC','MD','ME','MK','MT','NO','NL','PL','PT','RO','RS','RU','SE','SI','SJ','SK','SM','TR','UA','VA','XK','NY'],
azija:['AE','AF','AM','AZ','BD','BH','BN','BT','CN','GE','HK','ID','IL','IN','IQ','IR','JO','JP','KG','KH','KP','KR','KW','KZ','LA','LB','LK','MM','MN','MO','MV','MY','NP','OM','PH','PK','PS','QA','SA','SG','SY','TH','TJ','TL','TM','TW','UZ','VN','YE','AB'],
afrika:['AO','BF','BI','BJ','BW','CD','CF','CG','CI','CM','CV','DJ','DZ','EG','EH','ER','ET','GA','GH','GM','GN','GQ','GW','KE','KM','LR','LS','LY','MA','MG','ML','MR','MU','MW','MZ','NA','NE','NG','RE','RW','SC','SD','SH','SL','SN','SO','SS','ST','SZ','TD','TG','TN','TZ','UG','YT','ZA','ZM','ZW'],
'severna-amerika':['BM','CA','GL','PM','US'],
'srednja-amerika':['AG','AI','AW','BB','BQ','BS','BZ','CR','CU','CW','DM','DO','GD','GP','GT','HN','HT','JM','KN','KY','LC','MF','MQ','MS','MX','NI','PA','PR','SV','SX','TC','TT','VC','VG','VI'],
'juzna-amerika':['AR','BO','BR','CL','CO','EC','FK','GF','GY','PE','PY','SR','UY','VE'],
oceanija:['AS','AU','CC','CK','CX','FJ','FM','GU','KI','MH','MP','NC','NF','NR','NU','NZ','PF','PG','PW','SB','TO','TV','VU','WF','WS'],
};
const CEL_SL = { evropa:'Evropa', azija:'Azija', afrika:'Afrika',
  'severna-amerika':'Severna Amerika', 'srednja-amerika':'Srednja Amerika',
  'juzna-amerika':'Južna Amerika', oceanija:'Oceanija', drugo:'Drugo' };
const CC2CEL = {};
for (const k in CEL) for (const cc of CEL[k]) CC2CEL[cc] = k;

const CITY = {};
for (const c of cities) CITY[c.code] = c.name;
const EN = {};
for (const c of countries) EN[c.code] = c.name;

// krajše ime letališča: »Ljubljana Joze Pucnik Airport« → »Joze Pucnik«
const skrajsaj = (ime, mesto) => {
  let s = (ime || '').replace(/\s+(International|Intl\.?|Regional|Municipal|Airport|Airfield|Aerodrome|Air Base)\b/gi, ' ')
                     .replace(/\s{2,}/g, ' ').trim();
  if (mesto && s.toLowerCase().startsWith(mesto.toLowerCase())) s = s.slice(mesto.length).trim();
  return s.replace(/^[-–,]\s*/, '');
};

// ---- SAMO TJA, KAMOR SE RES LETI --------------------------------------------------
// Miša, 2. 10. 2026: »preveč letališč je tukaj pod državami, daj samo ta večja, kamor
// naša letala dejansko letijo«. Prej je bil seznam vseh 3682 komercialnih letališč na
// svetu, kar je za izbiranje slik neuporabno. Zdaj ostanejo samo cilji, do katerih je
// let z njenih devetih letališč — seznam prebere iz cilji.json, ki ga naredi ta skript
// sam (en klic na odhodno letališče), sicer pa iz obstoječih akcij.
const ODHOD = ['LJU','TRS','VCE','TSF','ZAG','VIE','BUD','MUC','MXP'];
// Odhodna letališča in njihove dvojnice niso nikoli cilj (Mišino pravilo 1),
// prav tako ne sosednje države (pravilo 1b) in cilji s seznama NE_CILJI.
const NIKOLI_CILJ = new Set([...ODHOD, 'MIL','LIN','BGY','VRN','VBS','MXP','PAH','CRV']);
// Izključimo tudi po IMENU MESTA: Brescia-Montichiari je v imeniku pod mestom
// »Verona«, zato se je po kodi prikradlo nazaj.
const NIKOLI_MESTO = new Set(['ljubljana','trieste','trst','venice','benetke','treviso',
  'zagreb','vienna','dunaj','budapest','budimpešta','munich','minhen','milan','milano','verona']);
const NIKOLI_DRZAVA = new Set(['HR','AT','HU','SI']);

async function doseglijiviCilji() {
  const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const out = new Set();
  if (TOKEN) {
    for (const o of ODHOD) {
      for (const ow of ['false','true']) {
        try {
          const r = await fetch(`https://api.travelpayouts.com/aviasales/v3/get_latest_prices`
            + `?origin=${o}&currency=eur&period_type=year&one_way=${ow}&limit=1000&page=1`
            + `&market=si&token=${TOKEN}`);
          const j = await r.json();
          for (const x of (j.data || [])) if (x.destination) out.add(x.destination);
        } catch { /* ta klic preskočimo */ }
      }
    }
  }
  // kar je kdaj bilo v akcijah, velja v vsakem primeru
  for (const f of ['../deals-vse.js', '../deals.js', '../arhiv.js']) {
    try {
      const t = readFileSync(new URL(f, import.meta.url), 'utf8');
      const o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      for (const k of ['deals','discover','arhiv'])
        for (const x of (o[k] || [])) if (x.code) out.add(x.code);
    } catch { /* datoteke ni — nič hudega */ }
  }
  return out;
}

const cilji = await doseglijiviCilji();
// cilj je lahko koda MESTA (PAR) — potem veljajo vsa letališča tega mesta (CDG, ORY, BVA)
const dovoljeno = new Set(cilji);
for (const a of airports) if (a.city_code && cilji.has(a.city_code)) dovoljeno.add(a.code);
console.log(`Ciljev, kamor se res leti: ${cilji.size} · po razširitvi na letališča: ${dovoljeno.size}`);

const po = {}, videnoMesto = new Set();
for (const a of airports) {
  if (!a.flightable || a.iata_type !== 'airport' || !a.code || !a.country_code) continue;
  if (!dovoljeno.has(a.code)) continue;
  if (NIKOLI_CILJ.has(a.code) || NIKOLI_DRZAVA.has(a.country_code)) continue;
  if (NIKOLI_MESTO.has((CITY[a.city_code] || a.name || '').toLowerCase())) continue;
  const mesto = CITY[a.city_code] || '';
  // Eno MESTO = ena vrstica. Za izbiranje slik je Milano Malpensa isto kot Linate —
  // slika je slika mesta, ne letališča.
  const kljuc = a.country_code + '|' + (mesto || a.name).toLowerCase();
  if (videnoMesto.has(kljuc)) continue;
  videnoMesto.add(kljuc);
  (po[a.country_code] = po[a.country_code] || []).push({
    k: a.code,
    mesto: mesto || a.name,
    ime: skrajsaj(a.name, mesto),
  });
}

const drzave = Object.keys(po)
  .map(cc => ({
    cc,
    sl: SL[cc] || EN[cc] || cc,
    cel: CC2CEL[cc] || 'drugo',
    letalisca: po[cc].sort((a, b) => a.mesto.localeCompare(b.mesto, 'sl')),
  }))
  .filter(d => d.letalisca.length)
  .sort((a, b) => a.sl.localeCompare(b.sl, 'sl'));

const skupaj = drzave.reduce((n, d) => n + d.letalisca.length, 0);
writeFileSync(new URL('../svet.js', import.meta.url),
  '// Vse države in njihova komercialna letališča (vir: Travelpayouts).\n'
  + '// Zgrajeno s scripts/build-svet.mjs — ne urejaj na roko.\n'
  + 'window.__BOOKIRAJ_SVET__ = ' + JSON.stringify({ drzave, celine: CEL_SL }) + ';\n');
const brezCel = drzave.filter(d => d.cel === 'drugo');
if (brezCel.length) console.log(`Brez celine (${brezCel.length}): ${brezCel.map(d => d.cc + ' ' + d.sl).join(', ')}`);
Object.keys(CEL_SL).forEach(k => {
  const n = drzave.filter(d => d.cel === k);
  if (n.length) console.log(`  ${CEL_SL[k]}: ${n.length} držav · ${n.reduce((s,d)=>s+d.letalisca.length,0)} letališč`);
});

const brezSL = drzave.filter(d => !SL[d.cc]);
console.log(`Držav: ${drzave.length} · komercialnih letališč: ${skupaj}`);
if (brezSL.length) console.log(`Brez slovenskega imena (${brezSL.length}): ${brezSL.map(d => d.cc + ' ' + d.sl).join(', ')}`);
