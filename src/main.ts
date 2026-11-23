import './styles/main.css';
import { APP } from './config.ts';
import { applyFilter, buildCatalog } from './core/catalog.ts';
import { DataService } from './core/dataService.ts';
import { createHttp } from './core/net.ts';
import { detectPlatform, detectProfile } from './core/platform.ts';
import { createKV } from './core/storage.ts';
import type { FilterState, PositionFrame, Satellite } from './core/types.ts';
import type { GlobeView } from './render/globe-view.ts';
import { AppUI } from './ui/app.ts';
import { Splash } from './ui/splash.ts';
import { PropagatorClient } from './worker/client.ts';

/** Otomatik testler ve tanılama için salt-okunur durum. */
interface DebugState {
  ready: boolean;
  webgl: boolean;
  textures: boolean;
  count: number;
  validCount: number;
  selected: number;
  state: string;
  fps: () => number;
}

async function boot(): Promise<void> {
  const splash = new Splash();
  const platform = detectPlatform();
  const profile = detectProfile(platform);
  const debug: DebugState = {
    ready: false,
    webgl: false,
    textures: false,
    count: 0,
    validCount: 0,
    selected: -1,
    state: 'loading',
    fps: () => 0,
  };
  (window as unknown as { __ST__: DebugState }).__ST__ = debug;

  let sats: Satellite[] = [];
  let frame: PositionFrame | null = null;
  let selected = -1;
  let selectedNorad = -1;
  let frozenAt: number | null = null;
  let filter: FilterState | null = null;
  let globe: GlobeView | null = null;
  let lastOrbitReq = 0;

  /** Simülasyon zamanı: çevrimiçiyken gerçek zaman, çevrimdışıyken dondurulmuş an. */
  const simTime = (): number => frozenAt ?? Date.now();

  const prop = new PropagatorClient();
  const data = new DataService({ http: createHttp(), kv: createKV() });

  const select = (i: number, reveal = true): void => {
    const s = sats[i];
    if (!s) return;
    selected = i;
    selectedNorad = s.norad;
    debug.selected = i;
    globe?.select(i);
    ui.showInfo(s, reveal);
    prop.tick(simTime(), selected);
    requestOrbit(true);
    setTimeout(() => globe?.focus(), 60);
  };

  const deselect = (): void => {
    selected = -1;
    selectedNorad = -1;
    debug.selected = -1;
    globe?.select(-1);
    ui.showInfo(null);
  };

  const requestOrbit = (force = false): void => {
    const s = sats[selected];
    if (!s) return;
    const now = Date.now();
    if (!force && now - lastOrbitReq < 60_000) return;
    lastOrbitReq = now;
    prop.orbit(selected, simTime(), s.orbit.periodMin);
  };

  const applyCurrentFilter = (): void => {
    if (!filter) return;
    const { indices, mask } = applyFilter(sats, filter);
    ui.setResults(indices);
    globe?.setVisibility(mask);
  };

  const ui = new AppUI({
    onSelect: (i) => select(i),
    onDeselect: deselect,
    onFilter: (f) => {
      filter = f;
      applyCurrentFilter();
    },
    onFocus: () => globe?.focus(),
    onFollow: (on) => {
      globe?.setFollow(on);
      if (on) globe?.focus();
    },
    onAutoRotate: (on) => globe?.setAutoRotate(on),
    onRetry: () => data.retryNow(),
  });

  // ---- 3D motoru (WebGL yoksa uygulama liste + bilgi kartıyla çalışmaya devam eder)
  splash.setStep('3D Dünya hazırlanıyor…');
  try {
    const mod = await import('./render/globe-view.ts');
    globe = new mod.GlobeView(
      document.getElementById('globe')!,
      document.getElementById('labels')!,
      profile,
      {
        onPick: (i) => select(i, true),
        onQualityChange: (lvl) => ui.setSystemInfo(sysInfo(lvl)),
      },
      simTime,
    );
    const r = await globe.init();
    debug.webgl = true;
    debug.textures = r.textures;
    debug.fps = () => globe?.fps ?? 0;
  } catch (e) {
    console.error('3D başlatılamadı', e);
    globe = null;
    ui.setRendererError(
      '3D görüntüleme başlatılamadı (WebGL desteklenmiyor veya devre dışı). Uydu listesi, arama ve bilgi kartı kullanılabilir.',
    );
  }

  const sysInfo = (quality = 0): string =>
    [
      `Platform: ${platform === 'windows' ? 'Windows' : platform === 'android' ? 'Android' : 'Tarayıcı'}`,
      `Grafik profili: ${profile.label}${quality ? ` (otomatik düşürüldü: seviye ${quality})` : ''}`,
      `Hesap aralığı: ${profile.tickMs / 1000} sn`,
      `3D: ${debug.webgl ? (debug.textures ? 'NASA dokuları' : 'yordamsal küre (doku bulunamadı)') : 'kapalı'}`,
    ].join(' · ');
  ui.setSystemInfo(sysInfo());

  // ---- yörünge hesaplayıcı
  prop.onLoaded = () => {
    prop.tick(simTime(), selected);
    requestOrbit(true);
  };
  prop.onFrame = (f) => {
    if (f.pos.length !== sats.length * 3) return;
    frame = f;
    debug.validCount = f.validCount;
    ui.setValidCount(f.validCount);
    globe?.updateFrame(f);
    if (selected >= 0) ui.updateDetail(f.detail, f.valid[selected] === 1);
  };
  prop.onOrbit = (i, pts) => {
    if (i === selected) globe?.setOrbit(pts);
  };
  prop.onError = (msg) => console.error('İşçi hatası:', msg);

  setInterval(() => {
    if (document.hidden || !sats.length) return;
    // Çevrimdışıyken konum zaten dondurulmuş anda; aynı anı tekrar hesaplamaya gerek yok.
    if (frozenAt !== null && frame && frame.t === frozenAt && (selected < 0 || frame.detail)) return;
    prop.tick(simTime(), selected);
    requestOrbit();
  }, profile.tickMs);

  // ---- veri katmanı
  data.onDataset = (ds) => {
    sats = buildCatalog(ds);
    frame = null;
    debug.count = sats.length;
    ui.setCatalog(sats);
    globe?.setCatalog(sats);
    prop.load(sats);
    if (!filter) {
      filter = {
        query: '',
        categories: new Set(['station', 'weather', 'nav', 'earth', 'science', 'military', 'comm', 'other']),
        orbits: new Set(['LEO', 'MEO', 'GEO', 'HEO', 'OTHER']),
        owner: null,
      };
    }
    applyCurrentFilter();
    // Katalog yenilendiğinde seçimi NORAD numarasıyla koru
    if (selectedNorad >= 0) {
      const again = sats.find((s) => s.norad === selectedNorad);
      if (again) {
        selected = again.index;
        debug.selected = selected;
        globe?.select(selected);
        ui.showInfo(again, false);
      } else deselect();
    }
  };
  data.onStatus = (s) => {
    const wasFrozen = frozenAt;
    frozenAt = s.frozenAt;
    debug.state = s.state;
    ui.setStatus(s);
    if (wasFrozen !== frozenAt && sats.length) {
      prop.tick(simTime(), selected);
      requestOrbit(true);
    }
  };

  splash.setStep('Yörünge verileri yükleniyor…');
  await data.init();
  await splash.done();
  data.start();
  debug.ready = true;
  console.info(`${APP.name} ${APP.version} — ${platform} / ${profile.id}`);
}

void boot();
