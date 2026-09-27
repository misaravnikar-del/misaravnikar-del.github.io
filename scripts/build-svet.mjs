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

const po = {};
for (const a of airports) {
  if (!a.flightable || a.iata_type !== 'airport' || !a.code || !a.country_code) continue;
  const mesto = CITY[a.city_code] || '';
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
    letalisca: po[cc].sort((a, b) => a.mesto.localeCompare(b.mesto, 'sl')),
  }))
  .filter(d => d.letalisca.length)
  .sort((a, b) => a.sl.localeCompare(b.sl, 'sl'));

const skupaj = drzave.reduce((n, d) => n + d.letalisca.length, 0);
writeFileSync(new URL('../svet.js', import.meta.url),
  '// Vse države in njihova komercialna letališča (vir: Travelpayouts).\n'
  + '// Zgrajeno s scripts/build-svet.mjs — ne urejaj na roko.\n'
  + 'window.__BOOKIRAJ_SVET__ = ' + JSON.stringify({ drzave }) + ';\n');

const brezSL = drzave.filter(d => !SL[d.cc]);
console.log(`Držav: ${drzave.length} · komercialnih letališč: ${skupaj}`);
if (brezSL.length) console.log(`Brez slovenskega imena (${brezSL.length}): ${brezSL.map(d => d.cc + ' ' + d.sl).join(', ')}`);
