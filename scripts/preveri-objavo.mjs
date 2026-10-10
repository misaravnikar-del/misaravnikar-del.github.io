// Bookiraj.si — VAROVALKA PRED OBJAVO.
//
// Zakaj obstaja: 27. 9. 2026 je z diska izginila datoteka CNAME (delovna kopija je
// stala v začasni mapi /private/tmp, ki jo sistem občasno počisti). Ker je bil nato
// uporabljen "git add -A", je bil izbris objavljen — in bookiraj.si je vrnil 404,
// ker GitHub Pages brez CNAME ne ve, na kateri domeni naj stran teče.
//
// Ta skripta ustavi objavo, če manjka katera od nujnih datotek ali če bi objava
// izbrisala nenavadno veliko datotek. Zaženi jo VEDNO pred "git push".
// Zagon: node scripts/preveri-objavo.mjs
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const KOREN = new URL('..', import.meta.url).pathname;
const je = p => existsSync(new URL('../' + p, import.meta.url));

// datoteke, brez katerih stran ne deluje
const NUJNE = [
  ['CNAME',            'brez nje bookiraj.si vrne 404'],
  ['index.html',       'to je cela stran'],
  ['deals.js',         'brez nje ni nobene akcije'],
  ['.nojekyll',        'brez nje GitHub preskoči mape z podčrtajem'],
  ['img/logo.png',     'logotip v glavi in nogi'],
  ['img/favicon-32.png','ikona v zavihku'],
  ['slike/index.html', 'seznam manjkajočih slik'],
  ['nadzor/index.html','nadzorna plošča'],
  // Te štiri so 27. 9. 2026 izginile skupaj s CNAME in nihče tega ni opazil do
  // 10. 10., ko je Miša vprašala za zemljevid na strani »O nas« — bil je ves ta
  // čas skrit, ker se brez njih ne izriše.
  ['map/world.svg',   'zemljevid obiskanih držav na strani O nas'],
  ['map/centers.json','središča držav za zemljevid'],
  ['map/photos.json', 'fotografije ob zemljevidu'],
  ['map/meta.json',   'imena in celine za zemljevid'],
];

const napake = [];
for (const [p, zakaj] of NUJNE) if (!je(p)) napake.push(`manjka ${p} — ${zakaj}`);

// CNAME mora vsebovati pravo domeno
if (je('CNAME')) {
  const d = readFileSync(new URL('../CNAME', import.meta.url), 'utf8').trim();
  if (d !== 'bookiraj.si') napake.push(`CNAME vsebuje "${d}", pričakujem "bookiraj.si"`);
}

// nobena sledena datoteka ne sme manjkati z diska
let manjkajoce = [];
try {
  manjkajoce = execSync('git ls-files --deleted', { cwd: KOREN, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch {}
// slike akcij se ob vsakem zagonu na novo razdelijo — njihov izbris je pričakovan
const nepricakovane = manjkajoce.filter(f => !f.startsWith('img/deals/'));
if (nepricakovane.length)
  napake.push(`z diska je izginilo ${nepricakovane.length} datotek, ki so v repozitoriju:\n     `
    + nepricakovane.slice(0, 12).join('\n     ')
    + (nepricakovane.length > 12 ? `\n     … (+${nepricakovane.length - 12})` : ''));

if (napake.length) {
  console.error('\n❌ NE OBJAVLJAJ — stran bi se pokvarila:');
  napake.forEach(n => console.error('   • ' + n));
  console.error('\nDatoteke obnovi iz zgodovine, npr.:  git checkout HEAD -- CNAME');
  process.exit(1);
}
// Oznaka različice na podatkovnih datotekah: brez nje brskalnik servira star
// deals.js, ki kaže na preimenovane slike — kartice takrat ostanejo prazne.
import { writeFileSync } from 'node:fs';
const v = new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');
const htmlPot = new URL('../index.html', import.meta.url);
let html = readFileSync(htmlPot, 'utf8');
const prej = html;
html = html.replace(/(<script src="(?:deals|sights)\.js)(\?v=\d+)?(">)/g, `$1?v=${v}$3`);
if (html !== prej) { writeFileSync(htmlPot, html); console.log(`   oznaka različice podatkov: ?v=${v}`); }

console.log('✅ Vse nujne datoteke so na mestu — objava je varna.');
