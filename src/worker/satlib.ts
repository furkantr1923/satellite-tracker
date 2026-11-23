import * as satellite from 'satellite.js';
import type { ElementSource } from '../core/types.ts';

/**
 * satellite.js (SGP4/SDP4, MIT) için ince adaptör.
 * Kütüphanenin yalnızca kullandığımız yüzeyi tiplenir; sürüm farklarına (false / null dönüşleri) dayanıklıdır.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export type SatRec = { error?: number } & Record<string, unknown>;

interface SatLib {
  twoline2satrec(l1: string, l2: string): SatRec;
  json2satrec(omm: unknown): SatRec;
  propagate(rec: SatRec, d: Date): { position?: Vec3 | boolean; velocity?: Vec3 | boolean } | null | false;
  gstime(d: Date): number;
  eciToGeodetic(p: Vec3, gmst: number): { latitude: number; longitude: number; height: number };
}

const lib = satellite as unknown as SatLib;

export function createSatRec(src: ElementSource): SatRec | null {
  try {
    const rec = src.kind === 'omm' ? lib.json2satrec(src.omm) : lib.twoline2satrec(src.line1, src.line2);
    return rec && !rec.error ? rec : null;
  } catch {
    return null;
  }
}

const isVec = (v: unknown): v is Vec3 =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as Vec3).x) &&
  Number.isFinite((v as Vec3).y) &&
  Number.isFinite((v as Vec3).z);

/** TEME konum (km) ve hız (km/s). Hesaplanamazsa (ör. yörüngeden düşmüş) null. */
export function propagateAt(rec: SatRec, d: Date): { p: Vec3; v: Vec3 } | null {
  try {
    const pv = lib.propagate(rec, d);
    if (!pv || !isVec(pv.position) || !isVec(pv.velocity) || rec.error) return null;
    return { p: pv.position, v: pv.velocity };
  } catch {
    return null;
  }
}

export function geodetic(p: Vec3, d: Date): { latDeg: number; lonDeg: number; altKm: number } {
  const g = lib.eciToGeodetic(p, lib.gstime(d));
  let lon = (g.longitude * 180) / Math.PI;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { latDeg: (g.latitude * 180) / Math.PI, lonDeg: lon, altKm: g.height };
}
