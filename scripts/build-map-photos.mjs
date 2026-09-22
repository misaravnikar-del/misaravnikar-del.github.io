// Bookiraj.si — poveže slike destinacij z državami, da jih zemljevid na strani »O nas«
// lahko pokaže ob prehodu z miško. Izhod: map/photos.json  { "FR": [{city,photo}], ... }
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
const UA={'User-Agent':'BookirajBot/1.0 (misa.ravnikar@gmail.com)'};
const get=async u=>{const r=await fetch(u,{headers:UA});return r.ok?r.json():null;};

const cities=await get('https://api.travelpayouts.com/data/en/cities.json');
const CITY={}; for(const c of cities||[]) CITY[c.code]={name:c.name, cc:c.country_code};
const SL={Vienna:'Dunaj',Venice:'Benetke',Rome:'Rim',Milan:'Milano',Naples:'Neapelj',Munich:'Minhen',Prague:'Praga',
 Warsaw:'Varšava',Lisbon:'Lizbona',Athens:'Atene',Copenhagen:'Kopenhagen',Cologne:'Köln',Geneva:'Ženeva',Zurich:'Zürich',
 Krakow:'Krakov',Seville:'Sevilja',Nice:'Nica',Dublin:'Dublin',Edinburgh:'Edinburg',Marrakesh:'Marakeš',Dubai:'Dubaj',
 Bangkok:'Bangkok','New York':'New York',Reykjavik:'Reykjavík',Brussels:'Bruselj',Bucharest:'Bukarešta',Belgrade:'Beograd',
 Cairo:'Kairo',Istanbul:'Istanbul',Tokyo:'Tokio',Singapore:'Singapur',Male:'Male',Lima:'Lima',Bogota:'Bogota',
 Thessaloniki:'Solun',Rhodes:'Rodos',Corfu:'Krf',Toronto:'Toronto',Havana:'Havana',Cancun:'Cancún',Yerevan:'Erevan'};

const byCC={};
const dir=new URL('../img/deals/', import.meta.url);
for (const f of readdirSync(dir)) {
  const m=f.match(/^([A-Z]{3})\.jpg$/i); if(!m) continue;
  const code=m[1].toUpperCase(), ci=CITY[code]; if(!ci||!ci.cc) continue;
  const name=SL[ci.name]||ci.name;
  (byCC[ci.cc]=byCC[ci.cc]||[]).push({ city:name, photo:'img/deals/'+code+'.jpg' });
}
// kurirane slike (lepše, imajo prednost)
const CUR={barcelona:['ES','Barcelona'],rome:['IT','Rim'],lisbon:['PT','Lizbona'],santorini:['GR','Santorini'],
 istanbul:['TR','Istanbul'],amsterdam:['NL','Amsterdam'],london:['GB','London'],iceland:['IS','Reykjavík'],
 dubai:['AE','Dubaj'],bangkok:['TH','Bangkok'],maldives:['MV','Maldivi'],newyork:['US','New York'],
 bali:['ID','Bali'],marrakesh:['MA','Marakeš'],paris:['FR','Pariz'],prague:['CZ','Praga'],berlin:['DE','Berlin'],
 tenerife:['ES','Tenerife'],athens:['GR','Atene'],podgorica:['ME','Podgorica'],tirana:['AL','Tirana'],
 palermo:['IT','Palermo'],edinburgh:['GB','Edinburg'],dubrovnik:['HR','Dubrovnik'],krakow:['PL','Krakov'],
 naples:['IT','Neapelj'],malta:['MT','Malta'],warsaw:['PL','Varšava'],seville:['ES','Sevilla'],marseille:['FR','Marseille']};
for (const slug in CUR){
  const [cc,city]=CUR[slug];
  if(!existsSync(new URL('../img/'+slug+'.jpg', import.meta.url))) continue;
  (byCC[cc]=byCC[cc]||[]).unshift({ city, photo:'img/'+slug+'.jpg' });
}
for (const cc in byCC){
  const seen=new Set();
  byCC[cc]=byCC[cc].filter(p=>{const k=p.city.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).slice(0,4);
}
writeFileSync(new URL('../map/photos.json', import.meta.url), JSON.stringify(byCC));
console.log(`Držav s slikami: ${Object.keys(byCC).length} · slik skupaj: ${Object.values(byCC).reduce((s,a)=>s+a.length,0)}`);
console.log('Primeri:', Object.entries(byCC).slice(0,6).map(([c,a])=>c+'('+a.length+')').join(' '));
