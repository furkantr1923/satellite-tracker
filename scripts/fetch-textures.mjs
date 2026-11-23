// NASA Visible Earth dokularını public/textures/ altına indirir (kamu malı görseller).
// Derleme sırasında (CI veya yerel) bir kez çalıştırılır; dosyalar varsa atlanır.
// İndirme başarısız olursa uygulama yordamsal (ızgaralı) küreye düşer — derleme durmaz.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';

const DIR = 'public/textures';
const BASE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords';
const TEXTURES = [
  { file: 'earth_day.jpg', urls: [`${BASE}/57000/57752/land_shallow_topo_2048.jpg`] },
  { file: 'earth_night.jpg', urls: [`${BASE}/55000/55167/earth_lights_lrg.jpg`] },
  { file: 'earth_clouds.jpg', urls: [`${BASE}/57000/57747/cloud_combined_2048.jpg`] },
];

mkdirSync(DIR, { recursive: true });
let ok = 0;
for (const t of TEXTURES) {
  const out = `${DIR}/${t.file}`;
  if (existsSync(out) && statSync(out).size > 50_000) {
    console.log(`✔ ${t.file} zaten var`);
    ok++;
    continue;
  }
  let done = false;
  for (const url of t.urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'SatelliteTracker-build/1.0' } });
      const type = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !type.startsWith('image/') || buf.length < 50_000) throw new Error(`HTTP ${res.status} ${type} ${buf.length} B`);
      writeFileSync(out, buf);
      console.log(`✔ ${t.file} indirildi (${(buf.length / 1024).toFixed(0)} KB)`);
      ok++;
      done = true;
      break;
    } catch (e) {
      console.warn(`⚠ ${t.file}: ${url} → ${e.message}`);
    }
  }
  if (!done) console.warn(`⚠ ${t.file} indirilemedi; uygulama yordamsal yedek görünümü kullanacak.`);
}
console.log(`Dokular: ${ok}/${TEXTURES.length}`);
