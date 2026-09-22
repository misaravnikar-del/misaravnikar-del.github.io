// Bookiraj.si — zgradi SVG zemljevid sveta za stran »O nas«.
// Vir: Natural Earth 110m (javna domena). Projekcija: Robinson (lepša od navadne pravokotne).
// Izhod: map/world.svg — vsaka država je <path id="SI" ...>, da jo lahko pobarvamo.
// Zagon: node scripts/build-world-map.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const W = 1000;                    // širina risbe
const MIN_AREA = 0.55;             // izpusti drobne otoke (v enotah risbe²)

// ---- Robinsonova projekcija (standardna tabela na 5° širine) ----
const RX = [1,0.9986,0.9954,0.99,0.9822,0.973,0.96,0.9427,0.9216,0.8962,0.8679,0.835,0.7986,0.7597,0.7186,0.6732,0.6213,0.5722,0.5322];
const RY = [0,0.062,0.124,0.186,0.248,0.31,0.372,0.434,0.4958,0.5571,0.6176,0.6769,0.7346,0.7903,0.8435,0.8936,0.9394,0.9761,1];
function robinson(lon, lat){
  const a = Math.min(Math.abs(lat), 89.999) / 5;
  const i = Math.min(Math.floor(a), 17), t = a - i;
  const x = RX[i] + (RX[i+1] - RX[i]) * t;
  const y = RY[i] + (RY[i+1] - RY[i]) * t;
  return [0.8487 * x * (lon * Math.PI / 180), 1.3523 * y * (lat < 0 ? -1 : 1)];
}
// meje risbe (Robinson: x ∈ ±0.8487π, y ∈ ±1.3523)
const XMAX = 0.8487 * Math.PI, YMAX = 1.3523;
const S = W / (2 * XMAX), H = Math.round(2 * YMAX * S);
const px = (lon, lat) => { const [x,y] = robinson(lon, lat); return [ (x + XMAX) * S, (YMAX - y) * S ]; };

const r1 = n => Math.round(n * 10) / 10;
function ringPath(ring){
  let d = '', prev = null, area = 0;
  for (const [lon, lat] of ring) {
    const [x, y] = px(lon, lat);
    const X = r1(x), Y = r1(y);
    if (prev && X === prev[0] && Y === prev[1]) continue;     // poenostavi
    d += (prev ? 'L' : 'M') + X + ' ' + Y;
    if (prev) area += prev[0] * Y - X * prev[1];
    prev = [X, Y];
  }
  return { d: d ? d + 'Z' : '', area: Math.abs(area) / 2 };
}
function polyPath(coords, type){
  const polys = type === 'Polygon' ? [coords] : coords;
  let out = '';
  for (const poly of polys) {
    const outer = ringPath(poly[0]);
    if (outer.area < MIN_AREA) continue;                      // drobni otoki ven
    out += outer.d;
    for (let i = 1; i < poly.length; i++) {                   // luknje (npr. Lesoto v JAR)
      const hole = ringPath(poly[i]);
      if (hole.area >= MIN_AREA) out += hole.d;
    }
  }
  return out;
}

console.log('Prenašam geopodatke …');
const res = await fetch(SRC);
if (!res.ok) { console.error('Ne morem prenesti zemljevida:', res.status); process.exit(1); }
const geo = await res.json();
console.log(`Držav v viru: ${geo.features.length}`);

const paths = [], skipped = [];
for (const f of geo.features) {
  const p = f.properties;
  const cc = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH
           : (p.ISO_A2 && p.ISO_A2 !== '-99') ? p.ISO_A2 : null;
  const name = p.NAME_EN || p.NAME || p.ADMIN || '';
  if (!cc) { skipped.push(name); continue; }
  if (cc === 'AQ') continue;                                   // Antarktika – ne rabimo
  const d = polyPath(f.geometry.coordinates, f.geometry.type);
  if (!d) { skipped.push(name); continue; }
  paths.push({ cc, name, d });
}
paths.sort((a,b)=>a.cc.localeCompare(b.cc));

// ---- majhne države, ki jih v viru 110m sploh ni: narišemo jih kot točko ----
// (Malta, Maldivi, Singapur, Karibi … so prave potovalne destinacije in morajo biti na zemljevidu.)
const DOTS = {
  MT:[14.45,35.90,'Malta'],            MV:[73.50,3.20,'Maldives'],        SG:[103.82,1.35,'Singapore'],
  BH:[50.55,26.10,'Bahrain'],          HK:[114.17,22.32,'Hong Kong'],     MC:[7.42,43.74,'Monaco'],
  AD:[1.52,42.50,'Andorra'],           LI:[9.55,47.16,'Liechtenstein'],   SM:[12.45,43.94,'San Marino'],
  MU:[57.55,-20.25,'Mauritius'],       SC:[55.50,-4.60,'Seychelles'],     CV:[-23.60,15.10,'Cabo Verde'],
  BB:[-59.55,13.15,'Barbados'],        AG:[-61.80,17.10,'Antigua and Barbuda'],
  LC:[-60.98,13.90,'Saint Lucia'],     GD:[-61.68,12.12,'Grenada'],       KN:[-62.75,17.30,'Saint Kitts and Nevis'],
  VC:[-61.20,13.25,'Saint Vincent'],   DM:[-61.37,15.42,'Dominica'],      AW:[-69.97,12.52,'Aruba'],
  CW:[-68.95,12.17,'Curaçao'],         TC:[-71.80,21.70,'Turks and Caicos'],
  KM:[43.30,-11.70,'Comoros'],         ST:[6.73,0.34,'São Tomé and Príncipe'],
  BM:[-64.75,32.30,'Bermuda'],         KY:[-81.25,19.30,'Cayman Islands'],
};
const centersExtra = {};
const known = new Set(paths.map(p=>p.cc));
const dots = [];
for (const cc in DOTS) {
  if (known.has(cc)) continue;
  const [lon, lat, name] = DOTS[cc];
  const [x, y] = px(lon, lat);
  dots.push({ cc, name, x: r1(x), y: r1(y) });
  centersExtra[cc] = [r1(x), r1(y)];
}
console.log(`Dodanih majhnih držav kot točke: ${dots.length} (${dots.map(d=>d.cc).join(', ')})`);

const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Zemljevid sveta">
<g class="wm__land">
${paths.map(p=>`<path id="c-${p.cc}" data-cc="${p.cc}" data-name="${p.name.replace(/"/g,'&quot;')}" d="${p.d}"/>`).join('\n')}
</g>
<g class="wm__land wm__dots">
${dots.map(d=>`<circle id="c-${d.cc}" data-cc="${d.cc}" data-name="${d.name.replace(/"/g,'&quot;')}" cx="${d.x}" cy="${d.y}" r="3.2"/>`).join('\n')}
</g>
</svg>
`;
mkdirSync(new URL('../map/', import.meta.url), { recursive: true });
writeFileSync(new URL('../map/world.svg', import.meta.url), svg);
console.log(`Narisanih držav: ${paths.length} · velikost ${(svg.length/1024).toFixed(0)} KB · risba ${W}×${H}`);
if (skipped.length) console.log('Izpuščeno (brez kode ali premajhno):', skipped.slice(0,12).join(', '), skipped.length>12?`… (+${skipped.length-12})`:'');


// ---- slovenska imena in celine (za izpis na strani) ----
const SL = {
 AD:'Andora',AE:'Združeni arabski emirati',AF:'Afganistan',AG:'Antigva in Barbuda',AL:'Albanija',AM:'Armenija',AO:'Angola',
 AR:'Argentina',AT:'Avstrija',AU:'Avstralija',AW:'Aruba',AZ:'Azerbajdžan',BA:'Bosna in Hercegovina',BB:'Barbados',
 BD:'Bangladeš',BE:'Belgija',BF:'Burkina Faso',BG:'Bolgarija',BH:'Bahrajn',BI:'Burundi',BJ:'Benin',BM:'Bermudi',
 BN:'Brunej',BO:'Bolivija',BR:'Brazilija',BS:'Bahami',BT:'Butan',BW:'Bocvana',BY:'Belorusija',BZ:'Belize',CA:'Kanada',
 CD:'DR Kongo',CF:'Srednjeafriška republika',CG:'Kongo',CH:'Švica',CI:'Slonokoščena obala',CL:'Čile',CM:'Kamerun',
 CN:'Kitajska',CO:'Kolumbija',CR:'Kostarika',CU:'Kuba',CV:'Zelenortski otoki',CW:'Curaçao',CY:'Ciper',CZ:'Češka',
 DE:'Nemčija',DJ:'Džibuti',DK:'Danska',DM:'Dominika',DO:'Dominikanska republika',DZ:'Alžirija',EC:'Ekvador',EE:'Estonija',
 EG:'Egipt',EH:'Zahodna Sahara',ER:'Eritreja',ES:'Španija',ET:'Etiopija',FI:'Finska',FJ:'Fidži',FK:'Falklandi',
 FR:'Francija',GA:'Gabon',GB:'Združeno kraljestvo',GD:'Grenada',GE:'Gruzija',GH:'Gana',GL:'Grenlandija',GM:'Gambija',
 GN:'Gvineja',GQ:'Ekvatorialna Gvineja',GR:'Grčija',GT:'Gvatemala',GW:'Gvineja Bissau',GY:'Gvajana',HK:'Hongkong',
 HN:'Honduras',HR:'Hrvaška',HT:'Haiti',HU:'Madžarska',ID:'Indonezija',IE:'Irska',IL:'Izrael',IN:'Indija',IQ:'Irak',
 IR:'Iran',IS:'Islandija',IT:'Italija',JM:'Jamajka',JO:'Jordanija',JP:'Japonska',KE:'Kenija',KG:'Kirgizistan',
 KH:'Kambodža',KM:'Komori',KN:'Saint Kitts in Nevis',KP:'Severna Koreja',KR:'Južna Koreja',KW:'Kuvajt',KY:'Kajmanski otoki',
 KZ:'Kazahstan',LA:'Laos',LB:'Libanon',LC:'Sveta Lucija',LI:'Lihtenštajn',LK:'Šrilanka',LR:'Liberija',LS:'Lesoto',
 LT:'Litva',LU:'Luksemburg',LV:'Latvija',LY:'Libija',MA:'Maroko',MC:'Monako',MD:'Moldavija',ME:'Črna gora',
 MG:'Madagaskar',MK:'Severna Makedonija',ML:'Mali',MM:'Mjanmar',MN:'Mongolija',MR:'Mavretanija',MT:'Malta',
 MU:'Mauritius',MV:'Maldivi',MW:'Malavi',MX:'Mehika',MY:'Malezija',MZ:'Mozambik',NA:'Namibija',NC:'Nova Kaledonija',
 NE:'Niger',NG:'Nigerija',NI:'Nikaragva',NL:'Nizozemska',NO:'Norveška',NP:'Nepal',NZ:'Nova Zelandija',OM:'Oman',
 PA:'Panama',PE:'Peru',PG:'Papua Nova Gvineja',PH:'Filipini',PK:'Pakistan',PL:'Poljska',PR:'Portoriko',PS:'Palestina',
 PT:'Portugalska',PY:'Paragvaj',QA:'Katar',RO:'Romunija',RS:'Srbija',RU:'Rusija',RW:'Ruanda',SA:'Savdska Arabija',
 SB:'Salomonovi otoki',SC:'Sejšeli',SD:'Sudan',SE:'Švedska',SG:'Singapur',SI:'Slovenija',SK:'Slovaška',SL:'Sierra Leone',
 SM:'San Marino',SN:'Senegal',SO:'Somalija',SR:'Surinam',SS:'Južni Sudan',ST:'Sao Tome in Principe',SV:'Salvador',
 SY:'Sirija',SZ:'Esvatini',TC:'Otoki Turks in Caicos',TD:'Čad',TG:'Togo',TH:'Tajska',TJ:'Tadžikistan',TL:'Vzhodni Timor',
 TM:'Turkmenistan',TN:'Tunizija',TR:'Turčija',TT:'Trinidad in Tobago',TW:'Tajvan',TZ:'Tanzanija',UA:'Ukrajina',
 UG:'Uganda',US:'Združene države Amerike',UY:'Urugvaj',UZ:'Uzbekistan',VC:'Saint Vincent in Grenadine',VE:'Venezuela',
 VN:'Vietnam',VU:'Vanuatu',XK:'Kosovo',YE:'Jemen',ZA:'Južnoafriška republika',ZM:'Zambija',ZW:'Zimbabve',
};
const CONT_SL = { Europe:'Evropa', Asia:'Azija', Africa:'Afrika', 'North America':'Severna Amerika',
  'South America':'Južna Amerika', Oceania:'Oceanija', 'Seven seas (open ocean)':'Oceanija', Antarctica:'Antarktika' };
const DOT_CONT = { MT:'Evropa',MV:'Azija',SG:'Azija',BH:'Azija',HK:'Azija',MC:'Evropa',AD:'Evropa',LI:'Evropa',
  SM:'Evropa',MU:'Afrika',SC:'Afrika',CV:'Afrika',BB:'Severna Amerika',AG:'Severna Amerika',LC:'Severna Amerika',
  GD:'Severna Amerika',KN:'Severna Amerika',VC:'Severna Amerika',DM:'Severna Amerika',AW:'Severna Amerika',
  CW:'Severna Amerika',TC:'Severna Amerika',KM:'Afrika',ST:'Afrika',BM:'Severna Amerika',KY:'Severna Amerika' };
const meta = {};
for (const f of geo.features) {
  const p = f.properties;
  const cc = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH : (p.ISO_A2 && p.ISO_A2 !== '-99') ? p.ISO_A2 : null;
  if (!cc || cc === 'AQ') continue;
  meta[cc] = { sl: SL[cc] || p.NAME_EN || p.NAME, cont: CONT_SL[p.CONTINENT] || p.CONTINENT };
}
for (const d of dots) meta[d.cc] = { sl: SL[d.cc] || d.name, cont: DOT_CONT[d.cc] || 'Evropa' };
writeFileSync(new URL('../map/meta.json', import.meta.url), JSON.stringify(meta));
console.log(`Imena in celine: ${Object.keys(meta).length} držav · brez slovenskega imena: ${Object.keys(meta).filter(c=>!SL[c]).length}`);

// še pomožna tabela: koda → središče države (za pine), v pikslih risbe
const centers = {};
for (const f of geo.features) {
  const p = f.properties;
  const cc = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH : (p.ISO_A2 && p.ISO_A2 !== '-99') ? p.ISO_A2 : null;
  if (!cc || cc === 'AQ') continue;
  const lon = Number(p.LABEL_X ?? p.LON ?? NaN), lat = Number(p.LABEL_Y ?? p.LAT ?? NaN);
  if (!isFinite(lon) || !isFinite(lat)) continue;
  const [x,y] = px(lon, lat);
  centers[cc] = [r1(x), r1(y)];
}
Object.assign(centers, centersExtra);
writeFileSync(new URL('../map/centers.json', import.meta.url), JSON.stringify(centers));
console.log(`Središč držav: ${Object.keys(centers).length}`);
