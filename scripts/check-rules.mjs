// Bookiraj.si — PREVERI, da sveže generirani deals.js spoštuje Mišina pravila.
// Zažene se v nočni rutini TAKOJ za fetch-deals.mjs in PRED objavo.
// Konča z 0 = vse v redu, 1 = pravilo kršeno (takrat se NE objavi).
// Zagon: node scripts/check-rules.mjs [pot/do/deals.js]
import { readFileSync } from 'node:fs';

const file = process.argv[2] || new URL('../deals.js', import.meta.url);
const src = readFileSync(file, 'utf8');
const o = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const curated = o.deals || [], discover = o.discover || [], all = curated.concat(discover);

const MIN_DISCOUNT = Math.round((o.rules?.minDiscount ?? 0.40) * 100);
const MIN_DISCOUNT_FULL = Math.round((o.rules?.minDiscountFull ?? 0.20) * 100);
const ALWAYS_UNDER = o.rules?.alwaysUnder ?? 50;
const MARKER = '779438';
// Pravilo 1: naša odhodna letališča niso destinacija
const HOME_HUBS = new Set(['LJU','TRS','VCE','ZAG','VIE','MXP','TSF','MUC','BUD','MIL','LIN','BGY','VRN']);

const fail = [], warn = [];
const cap = a => a.slice(0, 5).join(', ') + (a.length > 5 ? ` … (+${a.length - 5})` : '');

// --- 1. odhodna letališča nikoli kot cilj ---
const hubDest = all.filter(d => HOME_HUBS.has(d.code)).map(d => d.fromCode + '→' + d.code);
if (hubDest.length) fail.push(`1. Destinacija je naše odhodno letališče: ${cap(hubDest)}`);

// --- 2. vsaj -40 % ali pod 50 € ---
// Velja tudi, če je termin −40 % glede na povprečje SVOJEGA počitniškega obdobja (holDiscount).
const badTerm = [];
for (const d of all)
  for (const t of (d.terms || [])) {
    // klasični (nenizkocenovni) prevozniki imajo nižji prag — glej pravilo v fetch-deals.mjs
    const need = (t.lc === false) ? MIN_DISCOUNT_FULL : MIN_DISCOUNT;
    if (!((t.discount ?? 0) >= need || t.price < ALWAYS_UNDER || (t.holDiscount ?? 0) >= need))
      badTerm.push(`${d.fromCode}→${d.code} ${t.depart} ${t.price}€ (−${t.discount ?? 0} %)`);
  }
if (badTerm.length) fail.push(`2. Termin ni akcija (nizkocenovnik pod −${MIN_DISCOUNT} %, klasični prevoznik pod −${MIN_DISCOUNT_FULL} %, in ni pod ${ALWAYS_UNDER} €): ${cap(badTerm)}`);

// --- 3. eno odhodno letališče = svoja kartica (brez združevanja) ---
const seen = new Map();
const dup = [];
for (const d of discover) {
  const k = d.fromCode + '|' + d.code;
  if (seen.has(k)) dup.push(k); else seen.set(k, d);
  if (d.froms || d.offers) dup.push(k + ' (združeni odhodi)');
}
if (dup.length) fail.push(`3. Podvojene ali združene kartice: ${cap([...new Set(dup)])}`);

// --- 4. vsi datumi istega para na eni kartici ---
const noTerms = all.filter(d => !(d.terms && d.terms.length)).map(d => d.fromCode + '→' + d.code);
if (noTerms.length) fail.push(`4. Kartica brez terminov: ${cap(noTerms)}`);
const badOrder = all.filter(d => (d.terms || []).some((t, i, a) => i && a[i-1].depart > t.depart))
  .map(d => d.fromCode + '→' + d.code);
if (badOrder.length) warn.push(`4. Termini niso urejeni po datumu: ${cap(badOrder)}`);

// --- 5. vse povezave na Aviasales z Mišinim markerjem ---
const badUrl = [];
for (const d of all)
  for (const t of (d.terms || []))
    if (!/^https:\/\/(www\.)?aviasales\.com\//.test(t.url || '') || !(t.url || '').includes('marker=' + MARKER))
      badUrl.push(`${d.fromCode}→${d.code} ${t.depart}`);
if (badUrl.length) fail.push(`5. Povezava ne vodi na Aviasales z markerjem ${MARKER}: ${cap(badUrl)}`);

// --- 6. počitniške oznake ---
const HOL = {
  'Jesenske':['2026-10-24','2026-11-01'],
  'Novoletne':['2026-12-25','2027-01-03'],
  'Zimske (vzhodna Slovenija)':['2027-02-13','2027-02-21'],
  'Zimske (zahodna in osrednja SLO)':['2027-02-20','2027-02-28'],
  'Prvomajske':['2027-04-24','2027-05-02'],
  'Poletne':['2027-06-26','2027-08-31'],
};
const holMiss = [];
const holCount = {};
for (const d of all)
  for (const t of (d.terms || [])) {
    const should = Object.keys(HOL).filter(n => t.depart >= HOL[n][0] && t.depart <= HOL[n][1]);
    const has = t.hol || [];
    should.forEach(n => { holCount[n] = (holCount[n] || 0) + 1; });
    if (should.length !== has.length) holMiss.push(`${d.fromCode}→${d.code} ${t.depart}`);
  }
if (holMiss.length) fail.push(`6. Manjka oznaka šolskih počitnic: ${cap(holMiss)}`);

// --- 8. pri vsakem terminu piše letalska družba in prtljaga ---
const BAGS = new Set(['osebna','rocna','oddana']);
const noAir = [], noBag = [];
for (const d of all)
  for (const t of (d.terms || [])) {
    if (!t.airlineName || t.airlineName === t.airline) noAir.push(`${d.fromCode}→${d.code} ${t.depart}${t.airline?' ('+t.airline+')':''}`);
    if (!BAGS.has(t.bag)) noBag.push(`${d.fromCode}→${d.code} ${t.depart}`);
  }
if (noAir.length > all.length * 0.1) fail.push(`8. Manjka ime letalske družbe pri ${noAir.length} terminih: ${cap(noAir)}`);
else if (noAir.length) warn.push(`8. Ime prevoznika ni znano pri ${noAir.length} terminih (koda ni v imeniku): ${cap(noAir)}`);
if (noBag.length) fail.push(`8. Manjka oznaka prtljage: ${cap(noBag)}`);

// --- 9. dolžina potovanja (evropske ≥4 dni, izven Evrope ≥7, zelo oddaljene ≥10) ---
const D = { eu:4, shortEu:3, shortEuMax:40, far:7, veryFar:10, veryFarKm:7000, max:31 };
// Zelo oddaljene smejo biti krajše od 10 dni, če so poceni — zato tu preverjamo le spodnjo mejo 7.
const badLen = [];
for (const d of all)
  for (const t of (d.terms || [])) {
    const days = t.days != null ? t.days : (t.nights != null ? t.nights + 1 : null);
    if (days == null) { badLen.push(`${d.fromCode}→${d.code} ${t.depart} (brez datuma vrnitve)`); continue; }
    const far = d.continent && d.continent !== 'evropa';
    // (mejo za »zelo oddaljene« ≥10 dni uveljavi fetch-deals.mjs, kjer pozna razdaljo;
    //  tu preverimo evropsko ≥4 dni in izven-evropsko ≥7 dni)
    const ok = days <= D.max && (
      far ? days >= D.far
          : (days >= D.eu || (days >= D.shortEu && t.price < D.shortEuMax)));
    if (!ok) badLen.push(`${d.fromCode}→${d.code} ${t.depart} ${days} dni ${t.price}€${far?' (izven Evrope)':''}`);
  }
if (badLen.length) fail.push(`9. Prekratko (ali predolgo) potovanje: ${cap(badLen)}`);

// --- 7. zdravje ---
if (curated.length < 3) fail.push(`7. Premalo kuriranih akcij: ${curated.length} (najmanj 3)`);
if (discover.length < 25) fail.push(`7. Premalo odkritih kartic: ${discover.length} (najmanj 25)`);

// --- izpis ---
const terms = all.reduce((s, d) => s + (d.terms || []).length, 0);
console.log(`Preverjam deals.js · kuriranih ${curated.length} · odkritih ${discover.length} · terminov ${terms}`);
console.log(`Počitniški termini: ${Object.keys(holCount).length ? Object.entries(holCount).map(([k,v])=>`${k} ${v}`).join(' · ') : 'trenutno nobeden'}`);
warn.forEach(w => console.log('⚠️  ' + w));
if (fail.length) {
  console.error('\n❌ PRAVILA KRŠENA — NE OBJAVLJAJ:');
  fail.forEach(f => console.error('   • ' + f));
  process.exit(1);
}
console.log('\n✅ Vsa Mišina pravila so upoštevana — objava je varna.');
