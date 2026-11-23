/// Yörünge hesaplama işçisi (Web Worker). Ana iş parçacığını ve çizimi bloklamaz.
import { EARTH_RADIUS_KM } from '../config.ts';
import type { ElementSource, SatDetail } from '../core/types.ts';
import { createSatRec, geodetic, propagateAt, type SatRec } from './satlib.ts';

export type WorkerIn =
  | { type: 'load'; gen: number; sources: ElementSource[] }
  | { type: 'tick'; gen: number; t: number; selected: number }
  | { type: 'orbit'; gen: number; index: number; t: number; periodMin: number; samples: number };

export type WorkerOut =
  | { type: 'loaded'; gen: number; count: number; failed: number }
  | {
      type: 'positions';
      gen: number;
      t: number;
      pos: Float32Array;
      vel: Float32Array;
      valid: Uint8Array;
      validCount: number;
      detail: SatDetail | null;
    }
  | { type: 'orbit'; gen: number; index: number; points: Float32Array | null };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  postMessage(msg: WorkerOut, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const R = EARTH_RADIUS_KM;
let recs: Array<SatRec | null> = [];
let gen = 0;

function load(m: Extract<WorkerIn, { type: 'load' }>): void {
  gen = m.gen;
  recs = m.sources.map(createSatRec);
  const failed = recs.reduce((n, r) => n + (r ? 0 : 1), 0);
  scope.postMessage({ type: 'loaded', gen, count: recs.length, failed });
}

function tick(m: Extract<WorkerIn, { type: 'tick' }>): void {
  if (m.gen !== gen) return;
  const n = recs.length;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const valid = new Uint8Array(n);
  const d = new Date(m.t);
  let validCount = 0;
  let detail: SatDetail | null = null;

  for (let i = 0; i < n; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const r = propagateAt(rec, d);
    if (!r) continue;
    const k = i * 3;
    // TEME (x, y, z) → sahne (x, z, -y), birim: Dünya yarıçapı; hız: yarıçap/saniye
    pos[k] = r.p.x / R;
    pos[k + 1] = r.p.z / R;
    pos[k + 2] = -r.p.y / R;
    vel[k] = r.v.x / R;
    vel[k + 1] = r.v.z / R;
    vel[k + 2] = -r.v.y / R;
    valid[i] = 1;
    validCount++;
    if (i === m.selected) {
      const g = geodetic(r.p, d);
      detail = { index: i, ...g, speedKmS: Math.hypot(r.v.x, r.v.y, r.v.z) };
    }
  }
  scope.postMessage({ type: 'positions', gen, t: m.t, pos, vel, valid, validCount, detail }, [
    pos.buffer,
    vel.buffer,
    valid.buffer,
  ]);
}

/** Seçili uydunun bir tam periyotluk yörüngesi (şimdiki anın ±yarım periyodu), ataletsel çerçevede. */
function orbit(m: Extract<WorkerIn, { type: 'orbit' }>): void {
  if (m.gen !== gen) return;
  const rec = recs[m.index];
  if (!rec || !(m.periodMin > 0)) {
    scope.postMessage({ type: 'orbit', gen, index: m.index, points: null });
    return;
  }
  const samples = Math.max(16, m.samples);
  const span = m.periodMin * 60_000;
  const out = new Float32Array((samples + 1) * 3);
  let count = 0;
  for (let s = 0; s <= samples; s++) {
    const r = propagateAt(rec, new Date(m.t - span / 2 + (span * s) / samples));
    if (!r) continue;
    out[count * 3] = r.p.x / R;
    out[count * 3 + 1] = r.p.z / R;
    out[count * 3 + 2] = -r.p.y / R;
    count++;
  }
  const points = count > 1 ? out.slice(0, count * 3) : null;
  scope.postMessage({ type: 'orbit', gen, index: m.index, points }, points ? [points.buffer] : []);
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'load') load(m);
  else if (m.type === 'tick') tick(m);
  else if (m.type === 'orbit') orbit(m);
};
