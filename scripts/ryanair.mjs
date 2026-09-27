// Bookiraj.si — cene naravnost iz Ryanaira
//
// ZAKAJ OBSTAJA TA DATOTEKA
// Baza cen Travelpayouts (od koder jemljemo vse ostalo) je PREDPOMNILNIK tega, kar so
// ljudje že iskali. Akcijskih Ryanairovih cen pogosto sploh ne pozna. 27. 9. 2026 je
// Izlet na dlani oglaševal Treviso → Valencia za 30 €, Travelpayouts pa je za tiste dni
// vračal 86 € ali celo nič. Preverjeno takrat:
//   TSF→VLC  6. 10.  Ryanair 30 €  · Travelpayouts tega dne NIMA
//   TSF→SVQ  1. 12.  Ryanair 35 €  · Travelpayouts tega dne NIMA
//   TSF→BER 30. 11.  Ryanair 39 €  · Travelpayouts 58 €
// Iskalnik na Aviasalesu pa te cene NAJDE (za isti termin je pokazal 33 €), ker ob kliku
// naredi živo iskanje. Zato Ryanaira uporabimo samo za to, da IZVEMO, kateri dnevi so
// poceni — povezava pa gre še naprej na Aviasales z Mišinim markerjem (pravilo 5).
//
// Vir je javni iskalnik, ki ga uporablja ryanair.com. Omejitve, ugotovljene s preizkusom
// 27. 9. 2026:
//   • limit sme biti največ 20 (pri 30 vrne InvalidLimit)
//   • offset ne dela — vsak klic vrne NAJCENEJŠI let za vsak cilj v oknu
//   • okno povratka mora segati čez okno odhoda, sicer vrne 400
//   • filter po cilju je arrivalAirportIataCode (ednina)
// Iz tega sledi dvostopenjska raba, enaka kot pri Travelpayouts:
//   1) en klic na ODHODNO LETALIŠČE in mesec → seznam poceni ciljev (poceni, ~60 klicev)
//   2) za zanimive proge še klic na PROGO in mesec → več terminov iste proge

const API = 'https://services-api.ryanair.com/farfnd/v4/roundTripFares';
const UA  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128';
const spi = ms => new Promise(r => setTimeout(r, ms));

const iso  = d => d.toISOString().slice(0, 10);
const prvi = (leto, mesec) => new Date(Date.UTC(leto, mesec, 1));
const plus = (d, dni) => new Date(d.getTime() + dni * 86400000);

let klicev = 0, napak = 0;
export const ryanairStats = () => ({ klicev, napak });

// Proge, kjer Ryanair ne leti — da jih v istem zagonu ne sprašujemo znova.
const mrtve = new Set();

function okno(zamik) {
  const d = new Date();
  const a = prvi(d.getUTCFullYear(), d.getUTCMonth() + zamik);
  const b = plus(prvi(d.getUTCFullYear(), d.getUTCMonth() + zamik + 1), -1);
  // Odhod v tem mesecu, povratek do tri tedne po koncu meseca (daljša potovanja).
  return { odA: iso(a), odB: iso(b), naA: iso(plus(a, 1)), naB: iso(plus(b, 21)) };
}

async function poizvedba(from, to, zamik) {
  const w = okno(zamik);
  const url = `${API}?departureAirportIataCode=${from}`
    + (to ? `&arrivalAirportIataCode=${to}` : '')
    + `&outboundDepartureDateFrom=${w.odA}&outboundDepartureDateTo=${w.odB}`
    + `&inboundDepartureDateFrom=${w.naA}&inboundDepartureDateTo=${w.naB}`
    + '&currency=EUR&limit=20';
  try {
    klicev++;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) { napak++; return []; }
    const j = await r.json();
    return (j && j.fares) || [];
  } catch { napak++; return []; }
}

const vTermin = f => ({
  code:    f.outbound.arrivalAirport.iataCode,
  depart:  f.outbound.departureDate.slice(0, 10),
  ret:     f.inbound.departureDate.slice(0, 10),
  price:   Math.round(f.summary.price.value),
  airline: 'FR',
});

const uporaben = f => f && f.outbound && f.inbound && f.summary
  && f.summary.price && f.summary.price.value > 0;

// en termin na datum odhoda (najcenejši), urejeno po datumu
function poDnevu(termini) {
  const m = new Map();
  for (const t of [...termini].sort((a, b) => a.price - b.price))
    if (!m.has(t.depart)) m.set(t.depart, t);
  return [...m.values()].sort((a, b) => (a.depart < b.depart ? -1 : 1));
}

/**
 * 1. STOPNJA — kaj je poceni z DANEGA LETALIŠČA. En klic na mesec.
 * @returns {Promise<Map<string, Array>>} cilj → termini
 */
export async function ryanairIzLetalisca(from, { mesecev = 7, pavza = 250 } = {}) {
  const out = new Map();
  for (let i = 0; i < mesecev; i++) {
    for (const f of await poizvedba(from, null, i)) {
      if (!uporaben(f)) continue;
      const t = vTermin(f);
      if (!out.has(t.code)) out.set(t.code, []);
      out.get(t.code).push(t);
    }
    await spi(pavza);
  }
  for (const [k, v] of out) out.set(k, poDnevu(v));
  return out;
}

/**
 * 2. STOPNJA — vsi poceni termini NA DOLOČENI PROGI.
 * @returns {Promise<Array<{depart,ret,price,airline}>>}
 */
export async function ryanairProga(from, to, { mesecev = 7, pavza = 250 } = {}) {
  const kljuc = from + '|' + to;
  if (mrtve.has(kljuc)) return [];
  const out = [];
  let praznih = 0;
  for (let i = 0; i < mesecev; i++) {
    const fares = (await poizvedba(from, to, i)).filter(uporaben);
    if (!fares.length) praznih++;
    out.push(...fares.map(vTermin));
    await spi(pavza);
  }
  if (praznih === mesecev) mrtve.add(kljuc);
  return poDnevu(out);
}

// Preizkus iz ukazne vrstice:
//   node scripts/ryanair.mjs TSF        → kaj je poceni iz Trevisa
//   node scripts/ryanair.mjs TSF VLC    → vsi termini na progi
if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2);
  if (!from) { console.error('Uporaba: node scripts/ryanair.mjs ODHOD [CILJ]'); process.exit(1); }
  if (to) {
    const t = await ryanairProga(from, to);
    console.log(`${from} → ${to}: ${t.length} terminov`);
    for (const x of t) console.log(`   ${x.depart} → ${x.ret}  ${x.price} €`);
  } else {
    const m = await ryanairIzLetalisca(from);
    const vrst = [...m.entries()].map(([c, t]) => [c, Math.min(...t.map(x => x.price)), t.length])
      .sort((a, b) => a[1] - b[1]);
    console.log(`${from}: Ryanair leti na ${vrst.length} ciljev`);
    for (const [c, cena, n] of vrst) console.log(`   ${c}  od ${cena} €  (${n} terminov)`);
  }
  console.log('klicev:', ryanairStats().klicev, '· napak:', ryanairStats().napak);
}
