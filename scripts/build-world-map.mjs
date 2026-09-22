// Bookiraj.si — zgradi SVG zemljevid sveta za stran »O nas«.
// Vir: Natural Earth 110m (javna domena). Projekcija: Robinson (lepša od navadne pravokotne).
// Izhod: map/world.svg — vsaka država je <path id="SI" ...>, da jo lahko pobarvamo.
// Zagon: node scripts/build-world-map.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

// 50m namesto 110m: bistveno natančnejši obrisi in prave oblike majhnih držav in otokov
// (Malta, Maldivi, Singapur, Karibi … v 110m sploh niso obstajali).
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const W = Number(process.env.MAP_W || 1800);   // širina risbe (večja = natančneje)
const MIN_AREA = Number(process.env.MIN_AREA || 0.09);  // izpusti le res drobne pikice
const EPS = Number(process.env.EPS || 0.20);   // poenostavitev obrisa v pikslih risbe

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
// Douglas–Peucker: odvrže točke, ki se od ravne črte odmikajo manj kot EPS — obris ostane
// na oko enak, datoteka pa je nekajkrat manjša.
// ⚠️ Obroči držav so SKLENJENI (prva točka = zadnja). Če DP poženemo kar čez cel obroč,
// sta sidri enaki in razdalja do "črte" je neskončna — zato obroč najprej razrežemo na
// dva dela pri najbolj oddaljeni točki in vsakega poenostavimo posebej.
function dp(pts, eps){
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length-1] = 1;
  const stack = [[0, pts.length-1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let max = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const dist = len < 1e-9
        ? Math.hypot(x - ax, y - ay)
        : Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
      if (dist > max) { max = dist; idx = i; }
    }
    if (max > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
function simplify(pts, eps){
  let p = pts;
  const n = p.length;
  if (n > 2 && p[0][0] === p[n-1][0] && p[0][1] === p[n-1][1]) p = p.slice(0, n-1);
  if (p.length < 5) return p;
  let far = 1, best = -1;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = dp(p.slice(0, far + 1), eps);
  const b = dp(p.slice(far), eps);
  return a.concat(b.slice(1));
}
function ringPath(ring, min){
  let pts = [];
  for (const [lon, lat] of ring) pts.push(px(lon, lat));
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%pts.length]; area += x1*y2 - x2*y1; }
  area = Math.abs(area) / 2;
  if (area < (min == null ? MIN_AREA : min)) return { d:'', area };
  pts = simplify(pts, EPS);
  if (pts.length < 3) return { d:'', area };
  let d = '', prev = null;
  for (const [x, y] of pts) {
    const X = r1(x), Y = r1(y);
    if (prev && X === prev[0] && Y === prev[1]) continue;
    d += (prev ? 'L' : 'M') + X + ' ' + Y;
    prev = [X, Y];
  }
  return { d: d ? d + 'Z' : '', area };
}
function polyPath(coords, type, minArea){
  const polys = type === 'Polygon' ? [coords] : coords;
  const min = minArea == null ? MIN_AREA : minArea;
  let out = '';
  for (const poly of polys) {
    const outer = ringPath(poly[0], min);
    if (!outer.d) continue;                                   // drobni otoki ven
    out += outer.d;
    for (let i = 1; i < poly.length; i++) {                   // luknje (npr. Lesoto v JAR)
      const hole = ringPath(poly[i], min);
      if (hole.d) out += hole.d;
    }
  }
  // Država, ki je sestavljena iz samih drobnih otokov (Maldivi, Monako …), bi sicer izpadla.
  // Raje ji spustimo prag, kot da bi jo narisali kot piko.
  if (!out && min > 0.004) return polyPath(coords, type, min / 6);
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
// Nekaj držav ima v viru več zapisov z isto kodo (Avstralija + njena drobna ozemlja).
// Združimo jih v eno pot, sicer bi imeli podvojene id-je in bi silhueta lahko zajela
// napačen kos.
const merged = {};
for (const p of paths) {
  if (merged[p.cc]) { merged[p.cc].d += p.d; if (p.d.length > merged[p.cc].mainLen) { merged[p.cc].name = p.name; merged[p.cc].mainLen = p.d.length; } }
  else merged[p.cc] = { cc:p.cc, name:p.name, d:p.d, mainLen:p.d.length };
}
const dupCount = paths.length - Object.keys(merged).length;
paths.length = 0;
for (const cc in merged) paths.push(merged[cc]);
if (dupCount) console.log(`Združenih podvojenih zapisov: ${dupCount}`);
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
