// Uçtan uca duman testi: derlenmiş web paketini gerçek bir Chromium'da açar ve
// açılış, 3D başlatma, veri yükleme, arama, seçim, çevrimdışı davranış ve mobil yerleşimi doğrular.
//
// Kullanım:  npm run build && npm run test:e2e
// Ortam:     BASE_URL (verilmezse `vite preview` başlatılır), E2E_REQUIRE_WEBGL=0 (WebGL'siz ortamlar için)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { makeFixtures } from './fixtures.mjs';

const OUT = new URL('./artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const REQUIRE_WEBGL = process.env.E2E_REQUIRE_WEBGL !== '0';
const fx = makeFixtures();
const results = [];
let failed = 0;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    failed++;
    results.push(`✘ ${name}: ${e.message.split('\n')[0]}`);
  }
}

async function startPreview() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, stop: () => {} };
  const p = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', shell: process.platform === 'win32' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview başlamadı')), 30_000);
    p.stdout.on('data', (d) => String(d).includes('4173') && (clearTimeout(timer), resolve()));
  });
  return { url: 'http://localhost:4173/', stop: () => p.kill() };
}

async function routeData(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/csv; charset=utf-8' };
  await context.route('**/celestrak.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('satcat')) return route.fulfill({ status: 200, headers: cors, body: fx.satcat });
    const g = /GROUP=([^&]+)/.exec(u)?.[1];
    if (g === 'active') return route.fulfill({ status: 200, headers: cors, body: fx.active });
    return route.fulfill({ status: 200, headers: cors, body: fx.group(decodeURIComponent(g ?? '')) });
  });
  await context.route('**/amsat.org/**', (route) => route.abort());
}

const server = await startPreview();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  // ------------------------------------------------------------ masaüstü
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await routeData(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await step('Uygulama açılıyor ve açılış ekranı kapanıyor', async () => {
    await page.goto(server.url);
    await page.waitForFunction(() => window.__ST__?.ready === true, null, { timeout: 45_000 });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 5_000 });
  });

  await step(`3D Dünya (WebGL) başlatıldı${REQUIRE_WEBGL ? '' : ' [isteğe bağlı]'}`, async () => {
    const webgl = await page.evaluate(() => window.__ST__.webgl);
    if (REQUIRE_WEBGL && !webgl) throw new Error('WebGL başlatılamadı');
    if (!webgl) results.push('  ↳ bu ortamda WebGL yok; yedek arayüz doğrulandı');
  });

  await step('Uydu verisi yüklendi ve konumlar hesaplandı', async () => {
    await page.waitForFunction(() => window.__ST__.count >= 400 && window.__ST__.validCount >= 400, null, { timeout: 30_000 });
    const txt = await page.textContent('#result-count');
    if (!/400 uydu/.test(txt)) throw new Error(`sayaç: ${txt}`);
  });

  await step('Kategoriler (grup verisi) uygulandı', async () => {
    await page.waitForFunction(() => document.querySelector('[data-count="station"]')?.textContent === '1', null, { timeout: 90_000 });
  });

  await step('Arama: ada göre', async () => {
    await page.fill('#search', 'TEST HEO 004');
    await page.waitForFunction(() => document.querySelector('#result-count')?.textContent?.startsWith('1 /'), null, { timeout: 5_000 });
  });

  await step('Arama: ülkeye göre (Türkiye)', async () => {
    await page.fill('#search', 'türkiye');
    await page.waitForFunction(() => /^(6[0-9]|7[0-9]) \//.test(document.querySelector('#result-count')?.textContent ?? ''), null, { timeout: 5_000 });
    await page.fill('#search', '');
  });

  await step('Filtre: yörünge sınıfı (gelişmiş panel)', async () => {
    await page.click('#btn-advanced');
    await page.click('[data-orbit="LEO"]');
    await page.waitForFunction(() => !document.querySelector('#result-count')?.textContent?.startsWith('400'), null, { timeout: 5_000 });
    await page.click('#btn-reset');
    await page.waitForFunction(() => document.querySelector('#result-count')?.textContent === '400 uydu', null, { timeout: 5_000 });
  });

  await step('Uydu seçimi: bilgi kartı, hesaplanan değer etiketi', async () => {
    await page.fill('#search', 'TEST HEO 004');
    await page.waitForFunction(() => document.querySelector('#result-count')?.textContent?.startsWith('1 /'), null, { timeout: 5_000 });
    await page.click('.row:not([hidden])');
    const name = await page.textContent('#info-name');
    if (name !== 'TEST HEO 004') throw new Error(`yanlış uydu seçildi: ${name}`);
    await page.waitForSelector('#panel-info:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#info-grid')?.textContent?.includes('km/sn'), null, { timeout: 10_000 });
    const grid = await page.textContent('#info-grid');
    if (!grid.includes('hesaplanan')) throw new Error('hesaplanan etiketi yok');
    if (!grid.includes('Avrupa Uzay Ajansı')) throw new Error('ülke (SATCAT) bilgisi yok');
  });

  await step('Takip modu açılıp kapanıyor', async () => {
    await page.click('#btn-follow');
    if ((await page.getAttribute('#btn-follow', 'aria-pressed')) !== 'true') throw new Error('takip açılmadı');
    await page.waitForTimeout(1500);
    await page.click('#btn-follow');
  });

  await page.screenshot({ path: `${OUT}desktop.png` });

  await step('Çevrimdışı: konumlar dondurulur, durum gösterilir', async () => {
    await ctx.setOffline(true);
    await page.waitForFunction(() => document.querySelector('#status')?.dataset.state === 'offline', null, { timeout: 10_000 });
    const t1 = await page.evaluate(() => window.__ST__.state);
    if (t1 !== 'offline') throw new Error(t1);
    await page.screenshot({ path: `${OUT}desktop-offline.png` });
    await ctx.setOffline(false);
    await page.waitForFunction(() => document.querySelector('#status')?.dataset.state !== 'offline', null, { timeout: 40_000 });
  });

  await step('Hakkında penceresi ve geliştirici ifadesi', async () => {
    await page.click('#btn-about');
    const txt = await page.textContent('#about');
    if (!txt.includes('Furkan tarafından geliştirildi')) throw new Error('ifade yok');
    await page.keyboard.press('Escape');
  });

  if (REQUIRE_WEBGL) {
    await step('FPS ölçümü (yazılımsal GPU, yalnızca bilgi)', async () => {
      await page.waitForTimeout(4500);
      const fps = await page.evaluate(() => window.__ST__.fps());
      results.push(`  ↳ ölçülen FPS (SwiftShader, CPU üzerinde): ${fps.toFixed(1)}`);
    });
  }

  await step('Konsolda hata yok', async () => {
    const ignore = REQUIRE_WEBGL ? /textures\/|Failed to load resource|ERR_INTERNET_DISCONNECTED/ : /textures\/|Failed to load resource|ERR_INTERNET_DISCONNECTED|3D başlatılamadı/;
    const real = errors.filter((e) => !ignore.test(e));
    if (real.length) throw new Error(real.slice(0, 3).join(' | '));
  });
  await ctx.close();

  // ------------------------------------------------------------ mobil
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await routeData(mctx);
  const m = await mctx.newPage();
  await step('Mobil yerleşim: alt panel ve dokunmatik seçim', async () => {
    await m.goto(server.url);
    await m.waitForFunction(() => window.__ST__?.ready === true && window.__ST__.validCount > 0, null, { timeout: 45_000 });
    if (!(await m.evaluate(() => document.body.classList.contains('ui-mobile')))) throw new Error('mobil sınıfı yok');
    await m.screenshot({ path: `${OUT}mobile.png` });
    await m.tap('#sheet-handle');
    await m.waitForTimeout(400);
    await m.screenshot({ path: `${OUT}mobile-list.png` });
    await m.tap('.row:not([hidden])');
    await m.waitForSelector('#panel-info:not([hidden])');
    await m.waitForTimeout(1600);
    await m.screenshot({ path: `${OUT}mobile-info.png` });
  });
  await mctx.close();
} finally {
  await browser.close();
  server.stop();
}

console.log(results.join('\n'));
console.log(failed ? `\n${failed} adım BAŞARISIZ` : '\nTüm adımlar başarılı');
process.exit(failed ? 1 : 0);
