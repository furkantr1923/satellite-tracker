import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/core/csv.ts';
import {
  parseCatalogNumber,
  parseGpCsv,
  parseGpCsvIds,
  parseOmmEpoch,
  parseSatcatCsv,
  parseTleText,
  tleChecksum,
} from '../src/core/elements.ts';
import { eciToScene, gmstRad, orbitFromElements, subsolarPoint, sunDirectionEci } from '../src/core/astro.ts';
import { applyFilter, buildCatalog, buildGroupMap, defaultFilter, dedupeElements } from '../src/core/catalog.ts';
import { ownerDisplay } from '../src/core/countries.ts';
import { fmtAgo, fold } from '../src/core/text.ts';
import { GP_CSV, SATCAT_CSV, TLE_00005 } from './fixtures.ts';
import type { Category, Dataset, OrbitClass } from '../src/core/types.ts';

const ALL_CATS: Category[] = ['station', 'weather', 'nav', 'earth', 'science', 'military', 'comm', 'other'];
const ALL_ORBITS: OrbitClass[] = ['LEO', 'MEO', 'GEO', 'HEO', 'OTHER'];

test('CSV: tırnaklı alan, virgül, CRLF ve boş alanlar', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""",\n1,,3');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'he said "hi"', ''],
    ['1', '', '3'],
  ]);
});

test('OMM EPOCH mikro saniyeli ve Z sonekli biçimleri çözer', () => {
  assert.equal(parseOmmEpoch('2026-11-23T08:14:22.5'), Date.UTC(2026, 10, 23, 8, 14, 22, 500));
  assert.equal(parseOmmEpoch('2026-11-23T08:14:22Z'), Date.UTC(2026, 10, 23, 8, 14, 22));
  assert.ok(Number.isNaN(parseOmmEpoch('bozuk')));
});

test('GP CSV: geçerli kayıtlar alınır, bozuk kayıt reddedilir, 6 haneli NORAD desteklenir', () => {
  const { records, rejected } = parseGpCsv(GP_CSV);
  assert.equal(records.length, 6);
  assert.equal(rejected, 1);
  const iss = records.find((r) => r.norad === 25544)!;
  assert.equal(iss.name, 'ISS (ZARYA)');
  assert.equal(iss.intlDes, '1998-067A');
  assert.equal(iss.src.kind, 'omm');
  assert.equal(iss.meanMotion, 15.49812345);
  assert.ok(records.some((r) => r.norad === 100123), '6 haneli katalog numarası');
  assert.equal(records.find((r) => r.norad === 33591)!.name, 'NOAA 19');
});

test('GP CSV: başlıkta zorunlu sütun yoksa açık hata verir', () => {
  assert.throws(() => parseGpCsv('FOO,BAR\n1,2'), /Beklenmeyen GP CSV/);
  assert.deepEqual(parseGpCsvIds(GP_CSV).slice(0, 2), [25544, 33591]);
});

test('TLE: sağlama toplamı, Alpha-5 ve Vallado 00005 örneği', () => {
  const [, l1, l2] = TLE_00005.split('\n') as [string, string, string];
  assert.equal(tleChecksum(l1), 3);
  assert.equal(tleChecksum(l2), 7);
  assert.equal(parseCatalogNumber('A0001'), 100001);
  assert.equal(parseCatalogNumber('Z9999'), 339999);
  assert.ok(Number.isNaN(parseCatalogNumber('I0001')));
  const { records, rejected } = parseTleText(TLE_00005);
  assert.equal(rejected, 0);
  assert.equal(records[0]!.norad, 5);
  assert.equal(records[0]!.name, 'TEST 00005');
  assert.equal(records[0]!.intlDes, '1958-002B');
  assert.equal(new Date(records[0]!.epochMs).toISOString().slice(0, 10), '2000-06-27');
  const corrupt = TLE_00005.replace('4753', '4754');
  assert.equal(parseTleText(corrupt).rejected, 1);
});

test('SATCAT: yörüngeden düşmüş (DECAY_DATE dolu) nesneler atlanır', () => {
  const rows = parseSatcatCsv(SATCAT_CSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], [25544, 'ISS', '1998-11-20', 420, 415]);
});

test('Yörünge sınıflandırma: LEO / MEO / GEO / HEO', () => {
  assert.equal(orbitFromElements(15.5, 0.0005).cls, 'LEO');
  assert.equal(orbitFromElements(2.0056, 0.01).cls, 'MEO');
  assert.equal(orbitFromElements(1.0027, 0.0002).cls, 'GEO');
  assert.equal(orbitFromElements(2.006, 0.71).cls, 'HEO');
  assert.equal(orbitFromElements(0, 0).cls, 'OTHER');
  const geo = orbitFromElements(1.0027, 0);
  assert.ok(Math.abs(geo.apogeeKm - 35786) < 20, `GEO irtifası ${geo.apogeeKm}`);
  const iss = orbitFromElements(15.5, 0.0005);
  assert.ok(iss.apogeeKm > 380 && iss.apogeeKm < 460, `ISS irtifası ${iss.apogeeKm}`);
});

test('GMST: J2000 anında 280,4606°', () => {
  const deg = (gmstRad(Date.UTC(2000, 0, 1, 12)) * 180) / Math.PI;
  assert.ok(Math.abs(deg - 280.46061837) < 1e-6, String(deg));
});

test('Güneş: gündönümünde sapma ≈ +23,44°, 12:00 UTC civarı güneş altı boylamı ≈ 0°', () => {
  const s = sunDirectionEci(Date.UTC(2026, 5, 21, 12));
  const dec = (Math.asin(s[2]) * 180) / Math.PI;
  assert.ok(Math.abs(dec - 23.44) < 0.1, String(dec));
  const p = subsolarPoint(Date.UTC(2026, 2, 20, 12));
  assert.ok(Math.abs(p.lon) < 5, `boylam ${p.lon}`); // zaman denklemi ±4°
  assert.ok(Math.abs(p.lat) < 0.5, `enlem ${p.lat}`);
  const q = subsolarPoint(Date.UTC(2026, 2, 21, 0));
  assert.ok(Math.abs(Math.abs(q.lon) - 180) < 5, `gece yarısı boylam ${q.lon}`);
});

test('Koordinat eşlemesi: Three.js küre UV düzeni ile ECEF uyumlu', () => {
  // three.js SphereGeometry: x = -cos(u·2π)·sinθ, y = cosθ, z = sin(u·2π)·sinθ
  const sphere = (u: number, v: number): number[] => {
    const phi = u * 2 * Math.PI;
    const theta = v * Math.PI;
    return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
  };
  const out = [0, 0, 0];
  const R = 6378.135;
  // ECEF boylam 0 (u = 0,5), boylam 90°D (u = 0,75), kuzey kutbu (v = 0)
  eciToScene(R, 0, 0, out);
  sphere(0.5, 0.5).forEach((c, i) => assert.ok(Math.abs(c - out[i]!) < 1e-9));
  eciToScene(0, R, 0, out);
  sphere(0.75, 0.5).forEach((c, i) => assert.ok(Math.abs(c - out[i]!) < 1e-9));
  eciToScene(0, 0, R, out);
  sphere(0, 0).forEach((c, i) => assert.ok(Math.abs(c - out[i]!) < 1e-9));
});

test('Katalog: tekilleştirme, kategori önceliği, ülke ve filtre', () => {
  const { records } = parseGpCsv(GP_CSV);
  const older = { ...records[0]!, epochMs: records[0]!.epochMs - 1e7, name: 'ISS OLD' };
  assert.equal(dedupeElements([older, ...records]).filter((r) => r.norad === 25544)[0]!.name, 'ISS (ZARYA)');

  const groups = buildGroupMap(
    new Map([
      ['amateur', [25544]],
      ['stations', [25544]],
      ['weather', [33591]],
      ['intelsat', [44476]],
    ]),
  );
  assert.equal(groups.get(25544), 'station', 'istasyon, amatörden önceliklidir');

  const ds: Dataset = {
    elements: records,
    elementsFetchedAt: 0,
    elementsSource: 'celestrak',
    groups,
    groupsFetchedAt: 0,
    satcat: new Map([[44476, { owner: 'ITSO', launchDate: '2019-08-06', apogeeKm: 1, perigeeKm: 1 }]]),
    satcatFetchedAt: 0,
  };
  const sats = buildCatalog(ds);
  const is39 = sats.find((s) => s.norad === 44476)!;
  assert.equal(is39.category, 'comm');
  assert.equal(is39.country, 'Intelsat');
  assert.equal(is39.orbit.cls, 'GEO');
  assert.equal(sats.find((s) => s.norad === 25544)!.country, null, 'SATCAT yoksa ülke uydurulmaz');

  const f = defaultFilter({ categories: ALL_CATS, orbits: new Set(ALL_ORBITS) });
  assert.equal(applyFilter(sats, f).indices.length, sats.length);
  assert.equal(applyFilter(sats, { ...f, query: 'iss' }).indices.length, 1);
  assert.equal(applyFilter(sats, { ...f, query: 'intelsat' }).indices.length, 1, 'ülke/sahip adıyla arama');
  assert.equal(applyFilter(sats, { ...f, orbits: new Set<OrbitClass>(['HEO']) }).indices.length, 1);
  assert.equal(applyFilter(sats, { ...f, owner: 'ITSO' }).mask[is39.index], 1);
});

test('Metin: Türkçe katlama, ülke kodu ve zaman ifadeleri', () => {
  assert.equal(fold('İSTANBUL Işık ÇĞÜŞÖ'), 'istanbul isik cguso');
  assert.equal(ownerDisplay('TURK'), 'Türkiye');
  assert.equal(ownerDisplay('XYZQ'), 'Sahip kodu: XYZQ');
  assert.equal(fmtAgo(0, 30_000), 'az önce');
  assert.equal(fmtAgo(0, 90 * 60_000), '1 sa 30 dk önce');
});
