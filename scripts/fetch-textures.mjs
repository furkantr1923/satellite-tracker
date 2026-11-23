// NASA Visible Earth dokularını public/textures/ altına indirir (kamu malı görseller).
// Derleme sırasında (CI veya yerel) bir kez çalıştırılır; dosyalar varsa atlanır.
// İndirme başarısız olursa uygulama yordamsal (ızgaralı) küreye düşer — derleme durmaz.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

const DIR = 'public/textures';
const BASE = 'https://eoimages.gsfc.nasa.gov/images/imagerecords';
// Yedek: NASA Blue Marble / Black Marble görüntülerinin three-globe (MIT) deposundaki kopyaları
const MIRROR = 'https://unpkg.com/three-globe/example/img';
const MIRROR2 = 'https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img';
const TEXTURES = [
  {
    file: 'earth_day.jpg',
    urls: [`${BASE}/57000/57752/land_shallow_topo_2048.jpg`, `${MIRROR}/earth-blue-marble.jpg`, `${MIRROR2}/earth-blue-marble.jpg`],
  },
  {
    file: 'earth_night.jpg',
    urls: [`${BASE}/55000/55167/earth_lights_lrg.jpg`, `${MIRROR}/earth-night.jpg`, `${MIRROR2}/earth-night.jpg`],
  },
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
      console.warn(`⚠ ${t.file}: ${url} → ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`);
      // Yedek: sistemin curl'ü (farklı TLS/HTTP yığını)
      try {
        execFileSync('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '90', '-A', 'SatelliteTracker-build/1.0', '-o', out, url], { stdio: 'inherit' });
        if (statSync(out).size < 50_000) throw new Error('dosya çok küçük');
        console.log(`✔ ${t.file} curl ile indirildi (${(statSync(out).size / 1024).toFixed(0)} KB)`);
        ok++;
        done = true;
        break;
      } catch (e2) {
        if (existsSync(out)) unlinkSync(out);
        console.warn(`⚠ ${t.file}: curl → ${e2.message.split('\n')[0]}`);
      }
    }
  }
  if (!done) console.warn(`⚠ ${t.file} indirilemedi; uygulama yordamsal yedek görünümü kullanacak.`);
}
console.log(`Dokular: ${ok}/${TEXTURES.length}`);
