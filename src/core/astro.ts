import { EARTH_RADIUS_KM, MU_KM3_S2 } from '../config.ts';
import type { OrbitInfo } from './types.ts';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export const julianDate = (ms: number): number => ms / 86_400_000 + 2440587.5;

/** Greenwich ortalama yıldız zamanı (IAU-82), radyan. satellite.js gstime ile aynı formül. */
export function gmstRad(ms: number): number {
  const t = (julianDate(ms) - 2451545.0) / 36525;
  let g =
    -6.2e-6 * t * t * t +
    0.093104 * t * t +
    (876600.0 * 3600 + 8640184.812866) * t +
    67310.54841; // saniye
  g = ((g * DEG) / 240.0) % TWO_PI;
  return g < 0 ? g + TWO_PI : g;
}

/**
 * Güneş yönü (birim vektör, yer merkezli ekvatoral/ataletsel çerçeve).
 * Astronomical Almanac düşük duyarlıklı formülü (~0,01°) — gece/gündüz sınırı için yeterli.
 */
export function sunDirectionEci(ms: number): [number, number, number] {
  const n = julianDate(ms) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)];
}

/** Güneş altı noktası (enlem, boylam derece) — test ve doğrulama için. */
export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const [x, y, z] = sunDirectionEci(ms);
  const lat = Math.atan2(z, Math.hypot(x, y)) / DEG;
  let lon = (Math.atan2(y, x) - gmstRad(ms)) / DEG;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon };
}

/**
 * Ataletsel (TEME/ECI, km) → sahne koordinatı (Dünya yarıçapı = 1, Y yukarı = kuzey).
 * Eşleme: (x, y, z) → (x, z, -y). Bu, x ekseni etrafında -90° dönüş olup sağ el kuralını korur.
 */
export function eciToScene(x: number, y: number, z: number, out: Float32Array | number[], o = 0): void {
  out[o] = x / EARTH_RADIUS_KM;
  out[o + 1] = z / EARTH_RADIUS_KM;
  out[o + 2] = -y / EARTH_RADIUS_KM;
}

/**
 * Kaynaktaki ortalama hareket ve dışmerkezlikten yörünge sınıfı (deterministik, belgelenmiş kural).
 * Bu değerler kaynağın verdiği elemanlardan türetilir; tahmin değildir.
 */
export function orbitFromElements(meanMotionRevDay: number, ecc: number): OrbitInfo {
  if (!(meanMotionRevDay > 0) || !Number.isFinite(ecc)) {
    return { cls: 'OTHER', periodMin: NaN, apogeeKm: NaN, perigeeKm: NaN };
  }
  const n = (meanMotionRevDay * TWO_PI) / 86400; // rad/s
  const a = Math.cbrt(MU_KM3_S2 / (n * n));
  const perigeeKm = a * (1 - ecc) - EARTH_RADIUS_KM;
  const apogeeKm = a * (1 + ecc) - EARTH_RADIUS_KM;
  const periodMin = 1440 / meanMotionRevDay;

  let cls: OrbitInfo['cls'];
  if (ecc >= 0.25) cls = 'HEO';
  else if (meanMotionRevDay >= 0.95 && meanMotionRevDay <= 1.05 && ecc < 0.05) cls = 'GEO';
  else if (apogeeKm < 2000) cls = 'LEO';
  else if (apogeeKm < 35000) cls = 'MEO';
  else cls = 'OTHER';
  return { cls, periodMin, apogeeKm, perigeeKm };
}
