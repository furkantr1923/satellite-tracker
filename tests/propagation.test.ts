// Gerçek satellite.js (SGP4/SDP4) ile doğruluk testi. Kütüphane kurulu değilse (ör. çevrimdışı geliştirme) atlanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpCsv, parseTleText } from '../src/core/elements.ts';
import { GP_CSV, TLE_00005 } from './fixtures.ts';

type Lib = typeof import('../src/worker/satlib.ts');
let lib: Lib | null = null;
try {
  const sat = (await import('satellite.js')) as { sgp4?: unknown };
  if (typeof sat.sgp4 === 'function') lib = await import('../src/worker/satlib.ts');
} catch {
  lib = null;
}
const skip = lib ? false : 'satellite.js kurulu değil';

test('SGP4: Vallado 00005 test vektörü (t = 0 ve t = 360 dk)', { skip }, () => {
  const el = parseTleText(TLE_00005).records[0]!;
  const rec = lib!.createSatRec(el.src)!;
  assert.ok(rec, 'satrec oluşturulamadı');
  const at = (min: number) => lib!.propagateAt(rec, new Date(el.epochMs + min * 60_000))!;
  const r0 = at(0).p;
  assert.ok(Math.abs(r0.x - 7022.46529266) < 1 && Math.abs(r0.y + 1400.08296755) < 1 && Math.abs(r0.z - 0.03995155) < 1, JSON.stringify(r0));
  const r6 = at(360).p;
  assert.ok(Math.abs(r6.x + 7154.03120202) < 2 && Math.abs(r6.y + 3783.17682504) < 2 && Math.abs(r6.z + 3536.19412294) < 2, JSON.stringify(r6));
});

test('OMM (CSV) → SGP4: ISS irtifası ve hızı makul aralıkta', { skip }, () => {
  const iss = parseGpCsv(GP_CSV).records.find((r) => r.norad === 25544)!;
  const rec = lib!.createSatRec(iss.src)!;
  assert.ok(rec, 'json2satrec başarısız');
  const d = new Date(iss.epochMs + 30 * 60_000);
  const r = lib!.propagateAt(rec, d)!;
  const g = lib!.geodetic(r.p, d);
  const speed = Math.hypot(r.v.x, r.v.y, r.v.z);
  assert.ok(g.altKm > 350 && g.altKm < 460, `irtifa ${g.altKm}`);
  assert.ok(speed > 7.5 && speed < 7.8, `hız ${speed}`);
  assert.ok(Math.abs(g.latDeg) <= 52, `enlem ${g.latDeg}`);
});

test('OMM: 6 haneli katalog numarası ve GEO/HEO (SDP4 derin uzay) yayılımı', { skip }, () => {
  const recs = parseGpCsv(GP_CSV).records;
  for (const norad of [100123, 44476, 28163, 36585]) {
    const el = recs.find((r) => r.norad === norad)!;
    const rec = lib!.createSatRec(el.src);
    assert.ok(rec, `satrec ${norad}`);
    const r = lib!.propagateAt(rec!, new Date(el.epochMs + 3_600_000));
    assert.ok(r, `yayılım ${norad}`);
  }
});
