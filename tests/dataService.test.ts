import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataService } from '../src/core/dataService.ts';
import { HttpError, NetworkError, type Http } from '../src/core/net.ts';
import { MemoryKV } from '../src/core/storage.ts';
import type { Dataset, DataStatus } from '../src/core/types.ts';
import { GP_CSV, GP_HEADER, SATCAT_CSV, STATIONS_CSV, TLE_00005, WEATHER_CSV } from './fixtures.ts';

const HOUR = 3_600_000;

class FakeHttp implements Http {
  calls: string[] = [];
  mode: 'ok' | 'network' | 'http403' = 'ok';
  amsatOk = false;
  async getText(url: string): Promise<string> {
    this.calls.push(url);
    if (url.includes('amsat')) {
      if (this.amsatOk) return TLE_00005;
      throw new NetworkError('yok');
    }
    if (this.mode === 'network') throw new NetworkError('bağlantı yok');
    if (this.mode === 'http403') throw new HttpError(403, 'yasak');
    if (url.includes('GROUP=active')) return GP_CSV;
    if (url.includes('satcat')) return SATCAT_CSV;
    if (url.includes('GROUP=stations')) return STATIONS_CSV;
    if (url.includes('GROUP=weather')) return WEATHER_CSV;
    if (url.includes('GROUP=dmc')) throw new HttpError(404, 'yok');
    return GP_HEADER;
  }
}

function setup(opts: { online?: boolean; now?: number } = {}) {
  const http = new FakeHttp();
  const kv = new MemoryKV();
  const clock = { now: opts.now ?? Date.UTC(2026, 10, 23, 12), online: opts.online ?? true };
  const mk = () => {
    const svc = new DataService({ http, kv, now: () => clock.now, isOnline: () => clock.online, sleep: async () => {} });
    const out = { datasets: [] as Dataset[], statuses: [] as DataStatus[] };
    svc.onDataset = (d) => out.datasets.push(d);
    svc.onStatus = (s) => out.statuses.push(s);
    return { svc, out };
  };
  return { http, kv, clock, mk };
}

test('İlk açılış: GP + SATCAT + gruplar indirilir, durum "live"', async () => {
  const { http, mk } = setup();
  const { svc, out } = mk();
  await svc.init();
  await svc.tick();
  const ds = svc.dataset!;
  assert.equal(ds.elements.length, 6);
  assert.equal(ds.groups!.get(25544), 'station');
  assert.equal(ds.groups!.get(33591), 'weather');
  assert.equal(ds.satcat!.get(25544)!.owner, 'ISS');
  assert.equal(svc.status().state, 'live');
  assert.equal(svc.status().frozenAt, null);
  assert.ok(http.calls[0]!.includes('GROUP=active&FORMAT=csv'));
  assert.ok(out.datasets.length >= 3, 'veri parça parça yayınlanır');
});

test('Vadesi gelmeyen veri tekrar indirilmez (API sınırı)', async () => {
  const { http, clock, mk } = setup();
  const { svc } = mk();
  await svc.init();
  await svc.tick();
  const n = http.calls.length;
  clock.now += 30 * 60_000;
  await svc.tick();
  assert.equal(http.calls.length, n, '30 dk sonra istek yok');
  clock.now += 2 * HOUR;
  await svc.tick();
  assert.equal(http.calls.length, n + 1, '2 saat sonra yalnızca GP verisi yenilenir');
});

test('Önbellekten açılış: ağ isteği olmadan veri gösterilir', async () => {
  const { http, kv, clock, mk } = setup();
  await (async () => {
    const { svc } = mk();
    await svc.init();
    await svc.tick();
  })();
  http.calls = [];
  clock.now += 10 * 60_000;
  const { svc, out } = mk();
  await svc.init();
  assert.equal(out.datasets.length, 1);
  assert.equal(out.datasets[0]!.elements.length, 6);
  await svc.tick();
  assert.equal(http.calls.length, 0);
  assert.ok(await kv.get('elements'));
});

test('Bağlantı kesilince konumlar dondurulur, yeniden denenir, gelince çözülür', async () => {
  const { http, clock, mk } = setup();
  const { svc } = mk();
  await svc.init();
  await svc.tick();
  clock.now += 3 * HOUR;
  http.mode = 'network';
  await svc.tick();
  const s = svc.status();
  assert.equal(s.state, 'offline');
  assert.equal(s.frozenAt, clock.now);
  assert.ok(s.nextRetryAt! > clock.now);

  const callsBefore = http.calls.length;
  clock.now += 5_000;
  await svc.tick();
  assert.equal(http.calls.length, callsBefore, 'geri çekilme süresi dolmadan istek yok');

  http.mode = 'ok';
  clock.now += 60_000;
  await svc.tick();
  assert.equal(svc.status().state, 'live');
  assert.equal(svc.status().frozenAt, null);
});

test('Cihaz çevrimdışı açılırsa son çevrimiçi anda dondurulur', async () => {
  const { clock, mk } = setup();
  const t0 = clock.now;
  await (async () => {
    const { svc } = mk();
    await svc.init();
    await svc.tick();
  })();
  clock.now += 5 * HOUR;
  clock.online = false;
  const { svc } = mk();
  await svc.init();
  assert.equal(svc.status().state, 'offline');
  assert.equal(svc.status().frozenAt, t0);
});

test('HTTP 403: otomatik sorgu durur, yalnızca "Tekrar dene" ile sürer', async () => {
  const { http, clock, mk } = setup();
  const { svc } = mk();
  await svc.init();
  await svc.tick();
  clock.now += 3 * HOUR;
  http.mode = 'http403';
  await svc.tick();
  assert.equal(svc.status().state, 'paused');
  const n = http.calls.length;
  clock.now += 3 * HOUR;
  await svc.tick();
  assert.equal(http.calls.length, n, 'durdurulduktan sonra istek atılmaz');
  http.mode = 'ok';
  svc.retryNow();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(svc.status().state, 'live');
});

test('Önbellek yokken birincil kaynak yoksa yedek (AMSAT) kullanılır ve açıkça belirtilir', async () => {
  const { http, mk } = setup();
  http.mode = 'network';
  http.amsatOk = true;
  const { svc } = mk();
  await svc.init();
  await svc.tick();
  assert.equal(svc.dataset!.elementsSource, 'amsat');
  assert.equal(svc.dataset!.elements[0]!.src.kind, 'tle');
  assert.equal(svc.status().state, 'stale');
  assert.match(svc.status().message, /AMSAT/);
});
