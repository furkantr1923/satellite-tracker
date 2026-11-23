// `npx cap add android` sonrası Android projesini markaya uygun hâle getirir:
// - Uygulama ikonlarını (resources/android) kopyalar
// - Capacitor'ın varsayılan açılış görsellerini lacivert düz renkle değiştirir
// - Bildirim izni eklenmediğini doğrular (uygulama bildirim kullanmaz)
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const RES = 'android/app/src/main/res';
if (!existsSync(RES)) {
  console.error('android/ klasörü yok. Önce: npx cap add android');
  process.exit(1);
}

// 1) İkonlar
cpSync('resources/android', RES, { recursive: true });
// Uyarlanabilir ikon tanımı: lacivert arka plan + bizim ön plan
const anydpi = join(RES, 'mipmap-anydpi-v26');
if (existsSync(anydpi)) {
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    writeFileSync(
      join(anydpi, f),
      `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/st_icon_bg"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`,
    );
  }
}
writeFileSync(
  join(RES, 'values', 'st_colors.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="st_icon_bg">#0B1D3A</color>\n</resources>\n`,
);
const legacyBg = join(RES, 'values', 'ic_launcher_background.xml');
if (existsSync(legacyBg)) {
  writeFileSync(legacyBg, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#0B1D3A</color>\n</resources>\n`);
}

// 2) Açılış görselleri → aynı boyutta düz lacivert PNG
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function solidPng(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let splashCount = 0;
for (const dir of readdirSync(RES)) {
  const p = join(RES, dir, 'splash.png');
  if (dir.startsWith('drawable') && existsSync(p) && statSync(p).isFile()) {
    const b = readFileSync(p);
    writeFileSync(p, solidPng(b.readUInt32BE(16), b.readUInt32BE(20), [2, 6, 15]));
    splashCount++;
  }
}

// 3) Bildirim izni olmamalı
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
if (manifest.includes('POST_NOTIFICATIONS')) {
  writeFileSync('android/app/src/main/AndroidManifest.xml', manifest.replace(/\s*<uses-permission[^>]*POST_NOTIFICATIONS[^>]*\/>/g, ''));
}
console.log(`Android hazırlandı: ikonlar kopyalandı, ${splashCount} açılış görseli güncellendi.`);
