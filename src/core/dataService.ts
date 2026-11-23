import { CATEGORY_GROUPS, ENDPOINTS, REFRESH } from '../config.ts';
import { buildGroupMap } from './catalog.ts';
import { parseGpCsv, parseGpCsvIds, parseSatcatCsv, parseTleText, satcatRowsToMap, type SatcatRow } from './elements.ts';
import { HttpError, NetworkError, type Http } from './net.ts';
import type { KV } from './storage.ts';
import type { Category, Dataset, DataState, DataStatus, ElementSet, SourceId } from './types.ts';

interface ElementsCache {
  text: string;
  fetchedAt: number;
  source: SourceId;
}
interface GroupsCache {
  entries: Array<[number, Category]>;
  fetchedAt: number;
}
interface SatcatCache {
  rows: SatcatRow[];
  fetchedAt: number;
}
interface MetaCache {
  lastOnlineAt: number;
}

export interface DataServiceDeps {
  http: Http;
  kv: KV;
  now?: () => number;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

type OfflineReason = 'device' | 'network' | null;

export function parseElements(text: string, source: SourceId): ElementSet[] {
  return source === 'amsat' ? parseTleText(text).records : parseGpCsv(text).records;
}

/**
 * Veri katmanı: önbellek → ağ sırası, API sınırlarına saygı, yedek kaynak, çevrimdışı dondurma.
 *
 * Kurallar:
 * - Her 30 sn'de durum kontrol edilir; yalnızca veri "vadesi geldiyse" istek atılır
 *   (GP: 2 sa, SATCAT/gruplar: 7 gün). Aynı veri tekrar tekrar indirilmez.
 * - CelesTrak 200 dışı yanıt verirse otomatik sorgu durdurulur ve kullanıcıya gösterilir
 *   (CelesTrak kullanım politikası). Kullanıcı "Tekrar dene" ile yeniden başlatabilir.
 * - Bağlantı yoksa son konumlar dondurulur; yapay hareket üretilmez.
 */
export class DataService {
  onDataset: (ds: Dataset) => void = () => {};
  onStatus: (s: DataStatus) => void = () => {};

  private readonly http: Http;
  private readonly kv: KV;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  private ds: Dataset | null = null;
  private busy = false;
  private offlineReason: OfflineReason = null;
  private frozenAt: number | null = null;
  private lastOnlineAt: number | null = null;
  private nextRetryAt: number | null = null;
  private retryDelay: number = REFRESH.retryBaseMs;
  private paused = false;
  private lastError: string | null = null;
  private progress: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMetaWrite = 0;

  constructor(deps: DataServiceDeps) {
    this.http = deps.http;
    this.kv = deps.kv;
    this.now = deps.now ?? (() => Date.now());
    this.isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get dataset(): Dataset | null {
    return this.ds;
  }

  /** Önbellekten yükler; ağa çıkmaz. */
  async init(): Promise<void> {
    const [el, gr, sc, meta] = await Promise.all([
      this.kv.get<ElementsCache>('elements').catch(() => undefined),
      this.kv.get<GroupsCache>('groups').catch(() => undefined),
      this.kv.get<SatcatCache>('satcat').catch(() => undefined),
      this.kv.get<MetaCache>('meta').catch(() => undefined),
    ]);
    this.lastOnlineAt = meta?.lastOnlineAt ?? null;
    if (el) {
      try {
        const elements = parseElements(el.text, el.source);
        if (elements.length) {
          this.ds = {
            elements,
            elementsFetchedAt: el.fetchedAt,
            elementsSource: el.source,
            groups: gr ? new Map(gr.entries) : null,
            groupsFetchedAt: gr?.fetchedAt ?? null,
            satcat: sc ? satcatRowsToMap(sc.rows) : null,
            satcatFetchedAt: sc?.fetchedAt ?? null,
          };
        }
      } catch {
        this.ds = null; // bozuk önbellek — yok say
      }
    }
    if (!this.isOnline()) {
      this.offlineReason = 'device';
      this.frozenAt = this.lastOnlineAt ?? this.ds?.elementsFetchedAt ?? this.now();
    }
    if (this.ds) this.onDataset(this.ds);
    this.emitStatus();
  }

  start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.offlineReason === 'device' && this.isOnline()) {
          this.leaveOffline();
          this.emitStatus();
        }
        void this.tick();
      });
      window.addEventListener('offline', () => {
        this.enterOffline('device');
        this.emitStatus();
      });
    }
    this.timer = setInterval(() => void this.tick(), REFRESH.checkIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Kullanıcının "Tekrar dene" düğmesi. */
  retryNow(): void {
    this.paused = false;
    this.nextRetryAt = null;
    this.retryDelay = REFRESH.retryBaseMs;
    void this.tick(true);
  }

  async tick(force = false): Promise<void> {
    if (this.busy) return;
    const now = this.now();

    if (!this.isOnline()) {
      this.enterOffline('device');
      this.emitStatus();
      return;
    }
    if (this.offlineReason === 'device') this.leaveOffline();
    if (this.offlineReason === null) this.touchOnline(now);

    if ((this.paused || (this.nextRetryAt !== null && now < this.nextRetryAt)) && !force) {
      this.emitStatus();
      return;
    }

    const ds = this.ds;
    const dueEl = !ds || ds.elementsSource !== 'celestrak' || now - ds.elementsFetchedAt >= REFRESH.elementsMaxAgeMs;
    const dueSc = !ds || !ds.satcat || now - (ds.satcatFetchedAt ?? 0) >= REFRESH.satcatMaxAgeMs;
    const dueGr = !ds || !ds.groups || now - (ds.groupsFetchedAt ?? 0) >= REFRESH.groupsMaxAgeMs;
    if (!dueEl && !dueSc && !dueGr) {
      this.emitStatus();
      return;
    }

    this.busy = true;
    this.emitStatus();
    try {
      const completed = await this.refresh(dueEl, dueSc, dueGr);
      if (completed) this.onSuccess();
    } catch (e) {
      this.onFailure(e);
    } finally {
      this.busy = false;
      this.progress = null;
      this.emitStatus();
    }
  }

  /** @returns tüm adımlar birincil kaynaktan tamamlandıysa true */
  private async refresh(dueEl: boolean, dueSc: boolean, dueGr: boolean): Promise<boolean> {
    let first = true;
    const pace = async (): Promise<void> => {
      if (!first) await this.sleep(REFRESH.interRequestDelayMs);
      first = false;
    };

    if (dueEl) {
      this.setProgress('Yörünge verileri indiriliyor…');
      await pace();
      let text: string;
      let source: SourceId = 'celestrak';
      let primaryError: unknown = null;
      try {
        text = await this.http.getText(ENDPOINTS.active);
      } catch (e) {
        if (this.ds) throw e;
        primaryError = e;
        this.setProgress('Birincil kaynağa ulaşılamadı, yedek kaynak deneniyor…');
        await pace();
        text = await this.http.getText(ENDPOINTS.amsat).catch(() => {
          throw e;
        });
        source = 'amsat';
      }
      const elements = parseElements(text, source);
      if (elements.length === 0) throw new Error('Kaynak boş veya geçersiz veri döndürdü');
      const fetchedAt = this.now();
      await this.kv.set('elements', { text, fetchedAt, source } satisfies ElementsCache);
      this.ds = {
        elements,
        elementsFetchedAt: fetchedAt,
        elementsSource: source,
        groups: this.ds?.groups ?? null,
        groupsFetchedAt: this.ds?.groupsFetchedAt ?? null,
        satcat: this.ds?.satcat ?? null,
        satcatFetchedAt: this.ds?.satcatFetchedAt ?? null,
      };
      this.onDataset(this.ds);
      if (source === 'amsat') {
        this.registerPrimaryFailure(primaryError);
        return false;
      }
    }

    if (dueSc && this.ds) {
      this.setProgress('Uydu kataloğu (SATCAT) indiriliyor…');
      await pace();
      const rows = parseSatcatCsv(await this.http.getText(ENDPOINTS.satcat));
      const fetchedAt = this.now();
      await this.kv.set('satcat', { rows, fetchedAt } satisfies SatcatCache);
      this.ds = { ...this.ds, satcat: satcatRowsToMap(rows), satcatFetchedAt: fetchedAt };
      this.onDataset(this.ds);
    }

    if (dueGr && this.ds) {
      const groups = CATEGORY_GROUPS.flatMap(([, g]) => g);
      const memberships = new Map<string, number[]>();
      for (let k = 0; k < groups.length; k++) {
        const g = groups[k]!;
        this.setProgress(`Kategori verileri alınıyor (${k + 1}/${groups.length})…`);
        await pace();
        try {
          memberships.set(g, parseGpCsvIds(await this.http.getText(ENDPOINTS.group(g))));
        } catch (e) {
          // Var olmayan grup (404) veya beklenmeyen içerik: o grubu atla. Diğer hatalarda dur.
          if (e instanceof NetworkError || (e instanceof HttpError && e.status !== 404)) throw e;
        }
      }
      const map = buildGroupMap(memberships);
      const fetchedAt = this.now();
      await this.kv.set('groups', { entries: [...map.entries()], fetchedAt } satisfies GroupsCache);
      this.ds = { ...this.ds, groups: map, groupsFetchedAt: fetchedAt };
      this.onDataset(this.ds);
    }
    return true;
  }

  private setProgress(msg: string): void {
    this.progress = msg;
    this.emitStatus();
  }

  private touchOnline(now: number): void {
    this.lastOnlineAt = now;
    if (now - this.lastMetaWrite > 25_000) {
      this.lastMetaWrite = now;
      void this.kv.set('meta', { lastOnlineAt: now } satisfies MetaCache).catch(() => {});
    }
  }

  private onSuccess(): void {
    this.retryDelay = REFRESH.retryBaseMs;
    this.nextRetryAt = null;
    this.lastError = null;
    if (this.offlineReason === 'network') this.leaveOffline();
    this.touchOnline(this.now());
  }

  private registerPrimaryFailure(e: unknown): void {
    if (e instanceof HttpError) {
      this.paused = true;
      this.lastError = `CelesTrak HTTP ${e.status} döndürdü; kullanım politikası gereği otomatik sorgu durduruldu.`;
    } else {
      this.lastError = 'CelesTrak\'a ulaşılamadı; yedek kaynak kullanılıyor.';
      this.scheduleRetry();
    }
  }

  private onFailure(e: unknown): void {
    if (e instanceof NetworkError) {
      this.enterOffline('network');
      this.lastError = 'Veri kaynağına bağlanılamadı.';
      this.scheduleRetry();
    } else if (e instanceof HttpError) {
      this.paused = true;
      this.lastError = `CelesTrak HTTP ${e.status} döndürdü; kullanım politikası gereği otomatik sorgu durduruldu.`;
    } else {
      this.lastError = `Veri işlenemedi: ${e instanceof Error ? e.message : String(e)}`;
      this.nextRetryAt = this.now() + REFRESH.retryMaxMs;
    }
  }

  private scheduleRetry(): void {
    this.nextRetryAt = this.now() + this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, REFRESH.retryMaxMs);
  }

  private enterOffline(reason: Exclude<OfflineReason, null>): void {
    if (this.offlineReason === null) this.frozenAt = this.now();
    if (this.offlineReason !== 'device') this.offlineReason = reason;
  }

  private leaveOffline(): void {
    this.offlineReason = null;
    this.frozenAt = null;
  }

  status(): DataStatus {
    const now = this.now();
    const ds = this.ds;
    let state: DataState;
    let message: string;
    if (this.offlineReason) {
      state = 'offline';
      message =
        this.offlineReason === 'device'
          ? 'Çevrimdışı — son konumlar gösteriliyor, hareket durduruldu'
          : 'Kaynağa ulaşılamıyor — son konumlar gösteriliyor, hareket durduruldu';
    } else if (this.paused) {
      state = 'paused';
      message = this.lastError ?? 'Otomatik sorgu durduruldu';
    } else if (!ds) {
      state = this.busy ? 'loading' : 'empty';
      message = this.progress ?? this.lastError ?? 'Veri bekleniyor';
    } else if (ds.elementsSource !== 'celestrak' || now - ds.elementsFetchedAt > REFRESH.staleAfterMs) {
      state = 'stale';
      message =
        this.progress ??
        (ds.elementsSource === 'amsat' ? 'Yedek kaynak (AMSAT) — yalnızca amatör uydular' : 'Yörünge verisi güncel değil');
    } else {
      state = 'live';
      message = this.progress ?? 'CelesTrak verisi güncel';
    }
    return {
      state,
      online: this.offlineReason === null,
      message,
      elementsFetchedAt: ds?.elementsFetchedAt ?? null,
      elementsSource: ds?.elementsSource ?? null,
      frozenAt: this.frozenAt,
      nextRetryAt: this.nextRetryAt,
      lastError: this.lastError,
    };
  }

  private emitStatus(): void {
    this.onStatus(this.status());
  }
}
