// Bookiraj.si — shrani MIŠINE POTRJENE slike (JA iz platforme za izbor) v mapo na namizju.
// Struktura: ~/Desktop/Bookiraj.si/<Celina>/<Država>/<Mesto> N.jpg
// - Njene izbire imajo PREDNOST: shranijo se prve, nikoli se ne prepišejo.
// - Manifest .bookiraj-slike.json prepreči podvajanje ob ponovnem zagonu.
// Zagon: node scripts/save-approved-photos.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const U = 'https://fliwoulbwqcnufdfgvcj.supabase.co';
const K = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaXdvdWxid3FjbnVmZGZndmNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDQwNDIsImV4cCI6MjEwNTU4MDA0Mn0.sTk_F4WrLukbyozCipYkaFuFjkcdru2M9BiYw-wD1Zo';
const PASS = process.env.BKRJ_PASS || 'bookiraj-nadzor-2026';
const ROOT = process.env.PHOTO_ROOT || join(homedir(), 'Desktop', 'Bookiraj.si');
const UA = { 'User-Agent': 'BookirajBot/1.0 (misa.ravnikar@gmail.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safe = s => String(s).replace(/[\/\\:*?"<>|]/g, '-').trim();
const OKEXT = /\.(jpe?g|png)$/i;

const r = await fetch(U + '/rest/v1/rpc/photo_votes_all', {
  method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
  body: JSON.stringify({ pass: PASS })
});
if (!r.ok) { console.error('Napaka pri branju glasov:', r.status, await r.text()); process.exit(1); }
const votes = await r.json();
const ja = votes.filter(v => v.decision === 'ja');
console.log(`Potrjenih slik v bazi: ${ja.length} · mapa: ${ROOT}`);

const manifestPath = join(ROOT, '.bookiraj-slike.json');
let manifest = {};
if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {} }

// združi po mestu, ohrani vrstni red potrjevanja
const byCity = new Map();
for (const v of ja) {
  if (!byCity.has(v.code)) byCity.set(v.code, { ...v, urls: [] });
  byCity.get(v.code).urls.push(v.url);
}

let added = 0, cities = 0, skippedDup = 0;
for (const [code, d] of byCity) {
  const dir = join(ROOT, safe(d.cont || 'Evropa'), safe(d.country || '—'));
  const city = safe(d.city || code);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const have = new Set(manifest[code] || []);
  const files = readdirSync(dir).filter(f => OKEXT.test(f));
  const mine = files.filter(f => f.toLowerCase().startsWith(city.toLowerCase()));
  const used = new Set(mine.map(f => { const m = f.match(/\s(\d+)\.(jpe?g|png)$/i); return m ? Number(m[1]) : 1; }));

  let n = 0, got = 0;
  for (const url of d.urls) {
    if (have.has(url)) { skippedDup++; continue; }
    do { n++; } while (used.has(n));
    const ext = (url.match(/\.(jpe?g|png)/i) || ['.jpg'])[0].toLowerCase().replace('.jpeg', '.jpg');
    const file = join(dir, `${city} ${n}${ext}`);
    if (existsSync(file)) { used.add(n); continue; }
    try {
      const rr = await fetch(url, { headers: UA });
      if (!rr.ok) { console.log(`   ✗ ${city}: ${rr.status} ${url.slice(0, 60)}…`); continue; }
      const buf = Buffer.from(await rr.arrayBuffer());
      if (buf.length < 12000) continue;
      writeFileSync(file, buf);
      used.add(n); got++; added++;
      (manifest[code] = manifest[code] || []).push(url);
    } catch (e) { console.log(`   ✗ ${city}: ${e.message}`); }
    await sleep(120);
  }
  if (got) { cities++; console.log(`✓  ${d.city} (${d.country}) → +${got} · skupaj ${mine.length + got}`); }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 0));
console.log(`\nGOTOVO · shranjenih novih: ${added} · mest: ${cities} · že shranjenih prej: ${skippedDup}`);

// katera mesta imajo še manj kot 5
const short = [];
for (const [code, d] of byCity) {
  const dir = join(ROOT, safe(d.cont || 'Evropa'), safe(d.country || '—'));
  const city = safe(d.city || code);
  if (!existsSync(dir)) continue;
  const mine = readdirSync(dir).filter(f => OKEXT.test(f) && f.toLowerCase().startsWith(city.toLowerCase()));
  if (mine.length < 5) short.push(`${d.city} (${mine.length})`);
}
if (short.length) console.log(`Manj kot 5 slik: ${short.join(', ')}`);
