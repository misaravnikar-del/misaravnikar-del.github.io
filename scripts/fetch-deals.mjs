// Bookiraj.si — pobere PRAVE cene z Aviasales/Travelpayouts Data API.
//  1) kurirane proge (slike/opisi) → kartice
//  2) ODKRIVANJE: za vseh 9 letališč potegne najcenejše lete v vse destinacije,
//     filtrira po whitelistu držav (varno/obljudeno), po SEZONI destinacije,
//     po MINIMALNI dolžini potovanja in po ODDALJENOSTI (glej PRAVILA spodaj).
//
// PRAVILA, KI JIH JE DOLOČILA MIŠA (22.9.2026):
// 14. Hrvaška, Avstrija in Madžarska niso destinacija (24.9.2026) — sosede, kamor se pelje.
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
//  8. Kartica nikoli ne vodi naravnost na Aviasales — vedno prek strani akcije,
//     tudi če je na voljo samo en let.
//  9. Pri vsakem terminu piše letalska družba in prtljaga (privzeta politika prevoznika).
// 10. Datume iščemo mesec po mesec (SEARCH_MONTHS), ne le 30 najcenejših v letu.
// 11. Za božične in zimske počitnice imajo prednost tople, oddaljene destinacije.
// 12. DOLŽINA POTOVANJA: evropske ≥4 dni (3 dni le pod SHORT_EU_MAX €),
//     izven Evrope ≥7 dni, zelo oddaljene (≥VERYFAR_KM) ≥10 dni.
// Zažene GitHub Action (skrivnost TRAVELPAYOUTS_TOKEN); lokalno: TRAVELPAYOUTS_TOKEN=... node scripts/fetch-deals.mjs
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const MARKER = process.env.TP_MARKER || '779438';
if (!TOKEN) { console.error('Manjka TRAVELPAYOUTS_TOKEN'); process.exit(1); }

// ---- Mišina pravila (nastavljivo prek okoljskih spremenljivk) ----
const HOME = 'LJU';                                            // domače letališče = merilo bližine
const MIN_HOME_KM  = Number(process.env.MIN_HOME_KM  || 440);  // destinacija mora biti vsaj toliko od Ljubljane
const MIN_ROUTE_KM = Number(process.env.MIN_ROUTE_KM || 300);  // in vsaj toliko od odhodnega letališča
const MIN_DISCOUNT = Number(process.env.MIN_DISCOUNT || 0.40); // vsaj 40 % pod povprečjem proge …
const ALWAYS_UNDER = Number(process.env.ALWAYS_UNDER || 50);   // … ali cena pod 50 €
// Miša (22.9.2026): »zakaj nimava med akcijami nobenega Turkish Airlines, ali pa Qatar …
// dodaj še take ponudbe«. Razlog: klasični prevozniki imajo bistveno ožji razpon cen kot
// nizkocenovniki, zato skoraj nikoli ne padejo 40 % pod povprečje proge (npr. VCE→BKK:
// China Eastern −33 %, Air China −30 %, ITA −25 %). Zanje zato velja nižji prag.
// Miša (23.9.2026): »pa dodaj še turkish airlines«. Izmerjeno na 140 progah:
// Turkish Airlines ne pade nikoli 40 % pod povprečje, najboljša ponudba je −33 %.
// Pri pragu −20 % ustreza 10 ponudb, pri −15 % pa 21. Zato prag za klasične
// prevoznike (TK, QR, EK, LH, AF …) spuščen na 15 %. V absolutnem znesku je to
// več kot −40 % pri nizkocenovniku: −15 % na 600 € dolgi let je 90 € prihranka.
const MIN_DISCOUNT_FULL = Number(process.env.MIN_DISCOUNT_FULL || 0.15);
// Miša (23.9.2026): »ja spusti na 30«. Ljubljana ima malo prog in majhne cenovne skoke —
// od 38 prog z dovolj podatki jih le 4 sploh kdaj pade 40 % pod povprečje, nobena karta
// pa ni pod 50 €. Zato zanjo velja nižji prag; za ostala letališča ostane 40 %.
// 23.9.2026: »ljubljano spusti na 10%«. Izmerjeno na vseh ljubljanskih progah:
// prag −40 % doseže 4 proge, −30 % jih 9, −25 % jih 14, −10 % pa 28 od 38 — se pravi
// skoraj vse. Ljubljana ima malo prog in ozke cenovne razpone; Miša je odločila, da
// ji je pokritost pomembnejša od strogosti. Za ostala letališča ostane −40 %.
const MIN_DISCOUNT_BY_ORIGIN = { LJU: Number(process.env.MIN_DISCOUNT_LJU || 0.10) };
const discFor = from => (from && MIN_DISCOUNT_BY_ORIGIN[from] != null) ? MIN_DISCOUNT_BY_ORIGIN[from] : MIN_DISCOUNT;
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
// Miša (23.9.2026): »jaz si želim več oddaljenih destinacij, a lahko pregledaš res čisto
// vse opcije«. Zato zdaj v dveh korakih:
//   SITO  – vsaka najdena proga dobi EN klic (letni pregled). Poceni, a pove, ali proga
//           sploh ima kakšen termin, ki ustreza pravilu, in kakšno je povprečje.
//   GLOBINA – mesec-po-mesec iščemo samo pri progah, ki so sito prestale, pri čemer imajo
//           oddaljene prednost pred cenenimi evropskimi skoki.
const SCREEN_ALL = process.env.SCREEN_ALL !== '0';           // preseji čisto vse najdene proge
const FAR_KM     = Number(process.env.FAR_KM     || 2500);   // od kod naprej šteje za »oddaljeno«
const FAR_SHARE  = Number(process.env.FAR_SHARE  || 0.65);   // toliko mest v globinskem iskanju gre oddaljenim

// ---- DOLŽINA POTOVANJA (Miša, 22.9.2026) ----
// »Evropske ne smejo biti krajše kot 4 dni, lahko so 3 dni če je cena res zelo nizka,
//  manj kot to pa sploh ne. Za izven evropske destinacije pa najmanj 7 dni.
//  Te neke zelo oddaljene destinacije pa od cca 10 dni.«
// DNEVI = noči + 1 (odhod v četrtek, vrnitev v nedeljo = 4 dni, 3 noči) — tako se pri nas govori.
const MIN_DAYS_EU      = Number(process.env.MIN_DAYS_EU      || 4);
const SHORT_EU_DAYS    = Number(process.env.SHORT_EU_DAYS    || 3);   // izjema …
const SHORT_EU_MAX     = Number(process.env.SHORT_EU_MAX     || 40);  // … samo pod toliko €
const MIN_DAYS_FAR     = Number(process.env.MIN_DAYS_FAR     || 7);   // izven Evrope
const MIN_DAYS_VERYFAR = Number(process.env.MIN_DAYS_VERYFAR || 10);  // zelo oddaljene
const VERYFAR_KM       = Number(process.env.VERYFAR_KM       || 7000);
// Miša (22.9.2026): »tudi 8-dnevne lahko pustiš, če so poceni, to ni strogo pravilo.«
// Zelo oddaljena destinacija sme biti krajša od 10 dni (a nikoli pod 7), če je cena
// res dobra — pod VERYFAR_SHORT_MAX € ali vsaj toliko pod povprečjem proge.
const VERYFAR_SHORT_MAX  = Number(process.env.VERYFAR_SHORT_MAX  || 700);
const VERYFAR_SHORT_DISC = Number(process.env.VERYFAR_SHORT_DISC || 0.35);
const MAX_DAYS         = Number(process.env.MAX_DAYS         || 31);
function tripOK(nights, cont, km, price, avg){
  if (nights == null || nights < 1) return false;
  const days = nights + 1;
  if (days > MAX_DAYS) return false;
  if (km && km >= VERYFAR_KM) {                                   // Maldivi, Tajska, Karibi …
    if (days >= MIN_DAYS_VERYFAR) return true;
    const cheap = price < VERYFAR_SHORT_MAX
      || (avg && price <= avg * (1 - VERYFAR_SHORT_DISC));
    return days >= MIN_DAYS_FAR && cheap;                         // krajše samo, če je res poceni
  }
  if (cont && cont !== 'evropa') return days >= MIN_DAYS_FAR;    // Maroko, Egipt, Gruzija …
  if (days >= MIN_DAYS_EU) return true;
  return days >= SHORT_EU_DAYS && price < SHORT_EU_MAX;          // 3 dni le pri res nizki ceni
}

const ALL_ORIGINS = [
  {code:'LJU', city:'Ljubljana'}, {code:'TRS', city:'Trst'}, {code:'VCE', city:'Benetke'},
  {code:'ZAG', city:'Zagreb'}, {code:'VIE', city:'Dunaj'}, {code:'MXP', city:'Milano'},
  {code:'TSF', city:'Treviso'}, {code:'MUC', city:'Minhen'}, {code:'BUD', city:'Budimpešta'},
];
// ONLY_ORIGINS=LJU  → iskanje samo za to letališče. Ker so ljubljanske cene v povprečju
// višje od milanskih ali budimpeštanskih, LJU v skupnem izboru skoraj vedno izpade;
// usmerjen zagon mu da svoj prostor. Uporabi skupaj z MERGE=1, da ostale kartice ostanejo.
const ONLY = (process.env.ONLY_ORIGINS||'').toUpperCase().split(',').map(x=>x.trim()).filter(Boolean);
const ORIGINS = ONLY.length ? ALL_ORIGINS.filter(o=>ONLY.includes(o.code)) : ALL_ORIGINS;
if (ONLY.length && !ORIGINS.length) { console.error('ONLY_ORIGINS ne ustreza nobenemu letališču:', ONLY.join(',')); process.exit(1); }
// MERGE=1 → nove kartice se zlijejo z obstoječim deals.js; zamenjajo se SAMO tiste
// z odhodnih letališč, ki smo jih pravkar preiskali. Ostale ostanejo nedotaknjene.
const MERGE = process.env.MERGE === '1';

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
  pacific:  {m:[5,6,7,8,9,10],                note:'suha doba (maj–okt)'},
};

// ---- katalog dovoljenih držav (ISO2 → SL ime, celina, sezona, eksotika) ----
// Kar ni tu, se izpusti (tako izločimo nevarne/neobljudene države).
const C = (sl,cont,season,x)=>({sl,cont,season,x:!!x});

// PRAVILO 14 (Miša, 24.9.2026): »ne letiš na hrvaško, avstrijo, madžarsko«.
// Isti razlog kot pri pravilu 1: to so sosede, kamor se pelje z avtom ali vlakom —
// nesmiselno je leteti tja, sploh z letališča, ki je pogosto že v tisti državi.
// Velja za VSA letališča teh držav (Split, Dubrovnik, Salzburg, Debrecen …),
// ne le za ZAG, VIE in BUD.
const NO_DEST_CC = new Set(['HR','AT','HU']);
// ===================== MIŠIN ŽELENI SEZNAM (23.9.2026) =====================
// »iz ljubljane dodaš London v vseh mesecih, španijo do konca novembra, ciper in malta
//  zdaj do konca oktobra, francija za vse mesece, jug italije za vse mesece, švedska in
//  finska in norveška od oktobra naprej, islandija, turčija kadarkoli, grčija do konec
//  novembra, maroko, tunizija, nizozemska, dubaj, abudhabi kadarkoli, vse azijske države
//  kadarkoli, afriške za safari kadarkoli … iz benetk kanarske otoke ali madeiro od
//  oktobra do marca«
//
// Kaj naredi ta seznam:
//  a) preskoči splošno sezonsko pravilo (npr. Skandinavija pozimi sicer izpade),
//  b) omeji odhode na Mišino okno (from/until, prazno = kadarkoli),
//  c) tem progam da prednost pri izbiri, da jih cenene evropske ne izrinejo.
// Ne izmisli si prog: če leta iz Ljubljane v Laos ni, ga tudi tukaj ne bo.
const SOUTH_IT = ['NAP','BRI','BDS','SUF','PMO','CTA','REG','TPS','CAG','OLB','AHO','PSR','CRV','QSR'];
const CANARY   = ['TFS','TFN','TCI','LPA','ACE','FUE','SPC','GMZ','VDE'];
const MADEIRA  = ['FNC','PXO'];
const ASIA_CC  = ['CN','JP','SG','MY','VN','LA','KH','ID','LK','PH','TH','IN','MV','NP','KR','TW','HK','MO','AE','QA','OM','SA','JO','IL','GE','AM'];
const SAFARI_CC= ['ZA','UG','NA','KE','TZ','MG','MU','SC','RW','BW','ZM','ZW'];
const WISH = [
  { from:'LJU', what:'London',              codes:['LON','LHR','LGW','STN','LTN','LCY'] },
  { from:'LJU', what:'Španija',             cc:['ES'],                until:'2026-11-30' },
  { from:'LJU', what:'Ciper in Malta',      cc:['CY','MT'],           until:'2026-10-31' },
  { from:'LJU', what:'Francija',            cc:['FR'] },
  { from:'LJU', what:'Jug Italije',         codes:SOUTH_IT },
  { from:'LJU', what:'Skandinavija',        cc:['SE','FI','NO'],      since:'2026-10-01' },
  { from:'LJU', what:'Islandija',           cc:['IS'] },
  { from:'LJU', what:'Turčija',             cc:['TR'] },
  { from:'LJU', what:'Grčija',              cc:['GR'],                until:'2026-11-30' },
  { from:'LJU', what:'Maroko',              cc:['MA'] },
  { from:'LJU', what:'Tunizija',            cc:['TN'] },
  { from:'LJU', what:'Nizozemska',          cc:['NL'] },
  { from:'LJU', what:'Azija in Zaliv',      cc:ASIA_CC },
  { from:'LJU', what:'Afrika za safari',    cc:SAFARI_CC },
  { from:'VCE', what:'Kanarski otoki in Madeira', codes:CANARY.concat(MADEIRA),
                since:'2026-10-01', until:'2027-03-31' },
];
// vrne pravilo z želenega seznama za to progo (ali null)
function wishFor(from, dest){
  const ci = CITY[dest];
  for (const w of WISH) {
    if (w.from !== from) continue;
    if (w.codes && w.codes.includes(dest)) return w;
    if (w.cc && ci && w.cc.includes(ci.cc)) return w;
  }
  return null;
}
// ali odhod pade v Mišino okno za to progo
const wishDateOK = (w, dep) => !w || ((!w.since || dep >= w.since) && (!w.until || dep <= w.until));

const CATALOG = {
  // Evropa
  ES:C('Španija','evropa','medcity'), IT:C('Italija','evropa','medcity'), PT:C('Portugalska','evropa','medcity'),
  GR:C('Grčija','evropa','medcity'), FR:C('Francija','evropa','eu'), GB:C('Anglija','evropa','eu'),
  DE:C('Nemčija','evropa','eu'), NL:C('Nizozemska','evropa','eu'), BE:C('Belgija','evropa','eu'),
  IE:C('Irska','evropa','eu'), CH:C('Švica','evropa','eu'),   // Avstrija: pravilo 14
  CZ:C('Češka','evropa','eu'), PL:C('Poljska','evropa','eu'),   // Madžarska: pravilo 14
  SK:C('Slovaška','evropa','eu'), RO:C('Romunija','evropa','eu'), BG:C('Bolgarija','evropa','eu'),
  RS:C('Srbija','evropa','eu'), BA:C('BiH','evropa','eu'),   // Hrvaška: pravilo 14
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
  TW:C('Tajvan','azija','tropic',1), HK:C('Hongkong','azija','tropic',1), MO:C('Macao','azija','tropic',1),   // Miša, 23.9.2026: »vse azijske države«
  // Afrika
  MA:C('Maroko','afrika','desert',1), EG:C('Egipt','afrika','desert',1), TN:C('Tunizija','afrika','beach',1),
  KE:C('Kenija','afrika','safari',1), TZ:C('Tanzanija','afrika','tropic',1), ZA:C('Južna Afrika','afrika','southern',1),
  UG:C('Uganda','afrika','safari',1), MG:C('Madagaskar','afrika','tropic',1),   // Miša, 23.9.2026: safari
  RW:C('Ruanda','afrika','safari',1), BW:C('Bocvana','afrika','safari',1),
  ZM:C('Zambija','afrika','safari',1), ZW:C('Zimbabve','afrika','safari',1),   // Miša, 23.9.2026: »te vse daj v seznam dovoljenih«
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
  PF:C('Francoska Polinezija','oceanija','pacific',1), FJ:C('Fidži','oceanija','pacific',1),   // Bora Bora, Tahiti, Fidži
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

// Nekaj letaliških kod v javnem imeniku nima koordinat (Rio GIG, Buenos Aires EZE …),
// zato pravilo o dolžini potovanja zanje ne bi znalo uveljaviti meje za »zelo oddaljene«.
const GEO_PATCH = {
  // ⚠️ MXP (Milano Malpensa) in TSF (Treviso) sta kodi LETALIŠČ, ne mest — v javnem imeniku
  // mest ju ni, zato razdalje z njiju sploh ni bilo mogoče izračunati. Posledica: pravilo
  // »zelo oddaljene ≥10 dni« za vse lete iz Milana in Trevisa ni delovalo.
  MXP:{lat:45.630,lon:8.723},  TSF:{lat:45.648,lon:12.194},
  GIG:{lat:-22.81,lon:-43.25}, EZE:{lat:-34.82,lon:-58.54}, SDU:{lat:-22.91,lon:-43.16},
  AEP:{lat:-34.56,lon:-58.42}, HKT:{lat:8.11,lon:98.32},   KBV:{lat:8.10,lon:98.99},
  DAD:{lat:16.04,lon:108.20}, PQC:{lat:10.23,lon:103.97}, SEZ:{lat:-4.67,lon:55.52},
  PUJ:{lat:18.57,lon:-68.36}, CUN:{lat:21.04,lon:-86.87}, PTY:{lat:9.07,lon:-79.38},
  NBO:{lat:-1.32,lon:36.93},  DKR:{lat:14.67,lon:-17.07}, SID:{lat:16.74,lon:-22.95},
};
for (const k in GEO_PATCH) if (!GEOC[k]) GEOC[k] = GEO_PATCH[k];

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
  const _ci = CITY[dest];
  if (_ci && NO_DEST_CC.has(_ci.cc)) return true; // pravilo 14: Hrvaška, Avstrija, Madžarska
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
const isLowcost = code => !!(AIR[code] && AIR[code].lowcost);
function pickTerms(data, avg, km, opt){
  const minDisc = discFor(opt && opt.from);        // prag velja glede na odhodno letališče
  const cutLow  = avg * (1 - minDisc);             // nizkocenovniki: strog prag
  const cutFull = avg * (1 - Math.min(MIN_DISCOUNT_FULL, minDisc));   // klasični prevozniki: nikoli strožji
  const win = (opt && opt.window) || null;                  // {start,end} za počitniško iskanje
  const seen = new Set();
  return data
    .filter(d => d.price > 0 && (d.price <= (isLowcost(d.airline) ? cutLow : cutFull) || d.price < ALWAYS_UNDER))
    .filter(d => {
      if (!win) return true;
      const dep = (d.departure_at||'').slice(0,10);
      const ret = d.return_at ? d.return_at.slice(0,10) : dep;
      return dep >= win.start && dep <= win.end && ret <= win.endPlus;   // potovanje ostane v počitnicah
    })
    // Mišino okno z želenega seznama (npr. Španija samo do konca novembra)
    .filter(d => wishDateOK(opt && opt.wish, (d.departure_at||'').slice(0,10)))
    .sort((a,b)=>a.price-b.price)
    .filter(d => { const k = (d.departure_at||'').slice(0,10); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .map(d => {
      const depart = d.departure_at.slice(0,10);
      const ret = d.return_at ? d.return_at.slice(0,10) : null;
      const hol = holidaysFor(depart);
      const code = d.airline || '';
      const nights = ret ? Math.round((new Date(ret)-new Date(depart))/86400000) : null;
      return { depart, ret, price:Math.round(d.price), airline:code, airlineName:airName(code),
        lc:isLowcost(code), bag:bagTier(code, km), transfers:d.transfers??0,
        nights, days: nights!=null ? nights+1 : null,
        discount: Math.max(0, Math.round((avg-d.price)/avg*100)),
        hol: hol.length ? hol : undefined,
        // pravilo 5: vedno Aviasales z Mišinim markerjem
        url: 'https://www.aviasales.com'+d.link+'&marker='+MARKER };
    })
    // DOLŽINA POTOVANJA (Mišino pravilo) — prekratkih izletov ne objavljamo
    .filter(t => tripOK(t.nights, opt && opt.cont, km, t.price, avg));
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
function contOf(code){ const ci = CITY[code]; const cat = ci && CATALOG[ci.cc]; return cat ? cat.cont : null; }
function routeTerms(data, fromCode, code, meta){
  const avg = routeAvg(data, fromCode, code, meta);
  if (avg == null) return null;
  const terms = pickTerms(data, avg, distKm(fromCode, code), {cont:contOf(code), from:fromCode, wish:wishFor(fromCode, code)}).slice(0,MAX_TERMS).sort((a,b)=>a.depart<b.depart?-1:1);
  if (!terms.length) return null;
  const r = cardStats(terms, avg);
  r.rawAvg = avg;
  return r;
}

// =================== 1) KURIRANE (kartice) ===================
const curated = [];
let skipCur = 0;
const ORIGIN_SET = new Set(ORIGINS.map(o=>o.code));
for (const rt of ROUTES) {
  if (!ORIGIN_SET.has(rt.fromCode)) continue;   // usmerjen zagon (ONLY_ORIGINS)
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
    const wish = wishFor(o.code, dest);                  // Mišin želeni seznam
    const depMonth = +it.depart_date.slice(5,7);
    if (!wish && !SEASON[cat.season].m.includes(depMonth)) { dropSeason++; continue; }
    const nights = nightsBetween(it.depart_date, it.return_date);
    if (!tripOK(nights, cat.cont, it.distance||distKm(o.code,dest), it.value)) { dropNights++; continue; }
    const key = o.code+'|'+dest;
    if (cand[key] && cand[key].hint <= it.value) continue;
    cand[key] = { fromCode:o.code, fromCity:o.city, code:dest, city:cityName(dest),
      en:ci.name, enCountry:CC[ci.cc]||'', country:cat.sl, continent:cat.cont, exotic:cat.x,
      season:SEASON[cat.season].note, hint:Math.round(it.value), wish:wish||null,
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
      const wish = wishFor(o.code, dest);
      if (!wish && !SEASON[cat.season].m.includes(+it.depart_date.slice(5,7))) continue;
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
        season:SEASON[cat.season].note, hint:Math.round(it.value), winterSun, wish:wish||null,
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
// MIŠIN ŽELENI SEZNAM IMA PREDNOST: te proge gredo v preverjanje pred vsemi drugimi,
// sicer jih cenene evropske proge izrinejo iz kvote MAX_PAIRS.
const wishPairs = pairs.filter(d => d.wish && !sunKeys.has(d.fromCode+'|'+d.code));
const wishKeys = new Set(wishPairs.map(d=>d.fromCode+'|'+d.code));
{
  const byWhat = {};
  wishPairs.forEach(d => { byWhat[d.wish.what] = (byWhat[d.wish.what]||0)+1; });
  console.log(`Z Mišinega želenega seznama najdenih ${wishPairs.length} prog: ${Object.entries(byWhat).map(([k,v])=>k+' '+v).join(' · ')||'nobene'}`);
}
console.log(`Zimsko sonce (tropske/oddaljene za božič in zimske počitnice): ${pairs.filter(d=>d.winterSun).length} najdenih, jemljem ${sunPairs.length}`);

// uravnotežen izbor po celinah, da pridejo zraven tudi eksotične
const CAPS = {evropa:90, azija:140, afrika:110, 'sev-amerika':60, 'sred-amerika':80, 'juz-amerika':60, oceanija:30};
const groups = {};
pairs.forEach(d=>{ const k=d.fromCode+'|'+d.code; if(!sunKeys.has(k) && !wishKeys.has(k)) (groups[d.continent]=groups[d.continent]||[]).push(d); });
let rest = [];
for (const k in groups) rest = rest.concat(groups[k].slice(0, CAPS[k]||25));
rest.sort((a,b)=>a.hint-b.hint);
// KVOTA NA ODHODNO LETALIŠČE (Miša, 23.9.2026: »poišči mi še akcije iz Ljubljane«).
// Brez nje skupno razvrščanje po ceni vedno da prednost Milanu in Budimpešti, kjer so
// cene najnižje, Ljubljana pa izpade — med 149 karticami so bile iz LJU samo štiri.
// Zdaj vsako letališče najprej dobi svojih PER_ORIGIN najcenejših prog, šele nato
// preostala mesta zapolnimo po ceni.
const PER_ORIGIN = Number(process.env.PER_ORIGIN || 30);
{
  const seenPer = {}, firstPass = [], laterPass = [];
  for (const d of rest) {
    seenPer[d.fromCode] = (seenPer[d.fromCode] || 0) + 1;
    (seenPer[d.fromCode] <= PER_ORIGIN ? firstPass : laterPass).push(d);
  }
  rest = firstPass.concat(laterPass);
}
let ordered = wishPairs.concat(sunPairs, rest);

// ---- SITO: en klic na VSAKO najdeno progo -------------------------------------------
// Tako res pregledamo vse opcije, ne le najcenejših MAX_PAIRS. Klic je isti, ki bi ga
// globinsko iskanje naredilo tako in tako (letni pregled), zato ni zavržen — rezultat
// shranimo in ga spodaj ponovno uporabimo.
const SCREEN = new Map();   // 'ODHOD|CILJ' → {base, avg}
if (SCREEN_ALL) {
  let ok = 0, dead = 0;
  console.log(`\nSito: preverjam vseh ${ordered.length} najdenih prog (po en klic) …`);
  for (const d of ordered) {
    const base = await forDates(d.fromCode, d.code); await sleep(SLEEP_MS);
    if (!base.length) { dead++; continue; }
    const avg = routeAvg(base, d.fromCode, d.code, {city:d.city, country:d.country});
    if (avg == null) { dead++; continue; }
    const hits = pickTerms(base, avg, distKm(d.fromCode, d.code),
      {cont:d.continent, from:d.fromCode, wish:d.wish});
    SCREEN.set(d.fromCode+'|'+d.code, {base, avg});
    d.screenHits = hits.length;
    d.km = distKm(d.fromCode, d.code) || 0;
    if (hits.length) ok++;
  }
  console.log(`Sito končano: ${ok} prog ima vsaj en termin po pravilu · ${dead} brez uporabnih podatkov.`);
  // Naprej gredo samo proge, ki so sito prestale.
  ordered = ordered.filter(d => d.screenHits > 0);
  // Miša želi več oddaljenih: najprej napolnimo FAR_SHARE mest z oddaljenimi (najdlje prve),
  // preostanek pa z bližnjimi po ceni. Brez tega evropski skoki spet zasedejo vse.
  const far   = ordered.filter(d => d.km >= FAR_KM).sort((a,b)=>b.km-a.km);
  const near  = ordered.filter(d => d.km <  FAR_KM);
  const farN  = Math.min(far.length, Math.round(MAX_PAIRS * FAR_SHARE));
  ordered = far.slice(0, farN).concat(near, far.slice(farN));
  console.log(`Oddaljenih (nad ${FAR_KM} km) je ${far.length}, v globinsko iskanje jih gre ${Math.min(farN, MAX_PAIRS)}.`);
}

let picked = ordered;
if (picked.length > MAX_PAIRS) picked = picked.slice(0, MAX_PAIRS);
const perOut = {}; picked.forEach(d=>{ perOut[d.fromCode]=(perOut[d.fromCode]||0)+1; });
const farOut = picked.filter(d=>(d.km||distKm(d.fromCode,d.code)||0) >= FAR_KM).length;
console.log(`\nGlobinsko iskanje datumov za ${picked.length} prog (${farOut} oddaljenih, ${picked.filter(d=>d.winterSun).length} zimsko sonce) …`);
console.log(`Po odhodnih letališčih: ${Object.entries(perOut).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+v).join(' · ')}`);

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
  const cached = SCREEN.get(d.fromCode+'|'+d.code);        // klic iz sita, da ga ne ponavljamo
  let base = cached ? cached.base : null;
  if (!base) { base = await forDates(d.fromCode, d.code); calls++; await sleep(SLEEP_MS); }
  if (!base.length) { noData++; continue; }
  const avg = cached ? cached.avg : routeAvg(base, d.fromCode, d.code, meta);
  if (avg == null) { noDeal++; continue; }
  const km = distKm(d.fromCode, d.code);

  let found = pickTerms(base, avg, km, {cont:d.continent, from:d.fromCode, wish:d.wish});   // najcenejši čez celo leto
  for (const mth of monthList) {
    const data = await forDates(d.fromCode, d.code, mth); calls++; await sleep(SLEEP_MS);
    if (!data.length) continue;
    found = found.concat(pickTerms(data, avg, km, {cont:d.continent, from:d.fromCode, wish:d.wish}));   // pravilo 2 glede na letno povprečje

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
      const extra = pickTerms(inWin, holAvg, km, {window:w, cont:d.continent, from:d.fromCode, wish:d.wish}).map(t => {
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
// Pri usmerjenem zagonu (ONLY_ORIGINS + MERGE) je malo kartic normalno — takrat
// zahtevamo le, da je zagon sploh kaj našel; celoto preveri check-rules.mjs po zlitju.
const MIN_CUR = (ONLY.length && MERGE) ? 0 : 3;
const MIN_DIS = (ONLY.length && MERGE) ? 1 : 25;
if (curated.length < MIN_CUR || discover.length < MIN_DIS) {
  console.error(`\n❌ PREMALO PODATKOV — deals.js NI bil prepisan (obstoječe akcije ostanejo).`);
  console.error(`   kurirane ${curated.length} (najmanj ${MIN_CUR}) · odkrite ${discover.length} (najmanj ${MIN_DIS})`);
  console.error(`   API: ${apiCalls} klicev · ${rateHits} zavrnjenih zaradi omejitve · ${hardFails} neuspelih.`);
  console.error(`   Najverjetneje začasna omejitev Travelpayouts. Poskusi čez kakšno uro.`);
  process.exit(2);
}

// ---- PRAVILO 7: dnevna zgodovina povprečij v Supabase ----
await logPrices(priceLog);

// ---- ZLITJE: ohrani kartice z letališč, ki jih ta zagon ni preiskal ----
let outCurated = curated, outDiscover = discover;
if (MERGE) {
  try {
    const prev = readFileSync(new URL('../deals.js', import.meta.url), 'utf8');
    const old = JSON.parse(prev.slice(prev.indexOf('{'), prev.lastIndexOf('}')+1));
    const keep = d => !ORIGIN_SET.has(d.fromCode);
    const keptCur = (old.deals||[]).filter(keep), keptDis = (old.discover||[]).filter(keep);
    outCurated = keptCur.concat(curated).sort((a,b)=>a.fromPrice-b.fromPrice);
    outDiscover = keptDis.concat(discover);
    console.log(`Zlito z obstoječim: obdržanih ${keptCur.length}+${keptDis.length} kartic z drugih letališč, osveženih ${curated.length}+${discover.length} z ${[...ORIGIN_SET].join(', ')}.`);
  } catch (e) {
    console.error('Zlitje ni uspelo (obstoječega deals.js ne znam prebrati):', e.message);
    process.exit(2);
  }
}
const payload = { updated:new Date().toISOString(), rules:{minDiscount:MIN_DISCOUNT, minDiscountFull:MIN_DISCOUNT_FULL, minDiscountByOrigin:MIN_DISCOUNT_BY_ORIGIN, alwaysUnder:ALWAYS_UNDER, minHomeKm:MIN_HOME_KM}, deals:outCurated, discover:outDiscover };
writeFileSync(new URL('../deals.js', import.meta.url), 'window.__BOOKIRAJ_DEALS__ = '+JSON.stringify(payload)+';\n');
const allTerms = outCurated.concat(outDiscover).reduce((s,d)=>s+d.terms.length,0);
console.log(`\nKurirane akcije: ${outCurated.length} (${skipCur} brez akcije) · Odkrite kartice: ${outDiscover.length} · skupaj terminov: ${allTerms}`);
