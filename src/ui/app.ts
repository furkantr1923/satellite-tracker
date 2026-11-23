import { APP, CATEGORIES, CATEGORY_BY_ID, ORBIT_CLASSES, REFRESH } from '../config.ts';
import { ownerOptions } from '../core/catalog.ts';
import {
  escapeHtml,
  fmt1,
  fmtAgo,
  fmtDateTime,
  fmtInt,
  fmtIsoDate,
  fmtLat,
  fmtLon,
  fmtUtcClock,
} from '../core/text.ts';
import type { Category, DataStatus, FilterState, OrbitClass, SatDetail, Satellite } from '../core/types.ts';
import { VirtualList } from './virtualList.ts';

export interface UiHandlers {
  onSelect(index: number): void;
  onDeselect(): void;
  onFilter(f: FilterState): void;
  onFocus(): void;
  onFollow(on: boolean): void;
  onAutoRotate(on: boolean): void;
  onRetry(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} bulunamadı`);
  return el as T;
};

const NA = '<span class="na">Veri mevcut değil</span>';
const calc = '<span class="tag calc" title="Yörünge elemanlarından SGP4 ile hesaplandı">hesaplanan</span>';
const tag = (t: string, title: string): string => `<span class="tag" title="${title}">${t}</span>`;

export class AppUI {
  private sats: Satellite[] = [];
  private filter: FilterState;
  private readonly list: VirtualList;
  private selected: Satellite | null = null;
  private detail: SatDetail | null = null;
  private detailValid = true;
  private status: DataStatus | null = null;
  private validCount = 0;
  private resultCount = 0;
  private mobile = false;
  private searchTimer = 0;
  private sysInfo = '';

  constructor(private readonly h: UiHandlers) {
    this.filter = {
      query: '',
      categories: new Set(CATEGORIES.map((c) => c.id)),
      orbits: new Set(ORBIT_CLASSES.map((o) => o.id)),
      owner: null,
    };
    this.list = new VirtualList(
      $('list'),
      () => (this.mobile ? 52 : 46),
      (i, row) => this.renderRow(i, row),
      (i) => this.h.onSelect(i),
    );
    this.buildChips();
    this.bind();
    this.updateResponsive();
    window.addEventListener('resize', () => this.updateResponsive());
    setInterval(() => this.tickClock(), 1000);
    this.tickClock();
    $('about-ver').textContent = `Sürüm ${APP.version}`;
  }

  // ------------------------------------------------------------ yerleşim

  private updateResponsive(): void {
    const m = window.matchMedia('(max-width: 820px), (max-height: 520px)').matches;
    if (m === this.mobile && document.body.classList.contains('ui-ready')) return;
    this.mobile = m;
    document.body.classList.toggle('ui-mobile', m);
    document.body.classList.add('ui-ready');
    this.list.refresh();
  }

  get isMobile(): boolean {
    return this.mobile;
  }

  private setSheet(expanded: boolean): void {
    $('panel-list').classList.toggle('expanded', expanded);
  }

  // ------------------------------------------------------------ filtreler

  private buildChips(): void {
    const chips = $('chips');
    chips.innerHTML = CATEGORIES.map(
      (c) =>
        `<button class="chip" data-cat="${c.id}" aria-pressed="true"><i style="background:${c.color}"></i>${c.label}<small data-count="${c.id}"></small></button>`,
    ).join('');
    chips.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
      if (!b) return;
      const id = b.dataset.cat as Category;
      const all = this.filter.categories.size === CATEGORIES.length;
      // İlk tıklama: yalnızca o kategori; sonrakiler: aç/kapat
      if (all) this.filter.categories = new Set([id]);
      else if (this.filter.categories.has(id)) this.filter.categories.delete(id);
      else this.filter.categories.add(id);
      if (this.filter.categories.size === 0) this.filter.categories = new Set(CATEGORIES.map((c) => c.id));
      this.syncChips();
      this.emitFilter();
    });

    const oc = $('orbit-chips');
    oc.innerHTML = ORBIT_CLASSES.map(
      (o) => `<button class="chip" data-orbit="${o.id}" title="${o.hint}" aria-pressed="true">${o.label}</button>`,
    ).join('');
    oc.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-orbit]');
      if (!b) return;
      const id = b.dataset.orbit as OrbitClass;
      if (this.filter.orbits.has(id)) this.filter.orbits.delete(id);
      else this.filter.orbits.add(id);
      if (this.filter.orbits.size === 0) this.filter.orbits = new Set(ORBIT_CLASSES.map((o) => o.id));
      this.syncChips();
      this.emitFilter();
    });
  }

  private syncChips(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => {
      b.setAttribute('aria-pressed', String(this.filter.categories.has(b.dataset.cat as Category)));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-orbit]').forEach((b) => {
      b.setAttribute('aria-pressed', String(this.filter.orbits.has(b.dataset.orbit as OrbitClass)));
    });
  }

  private emitFilter(): void {
    this.h.onFilter({
      ...this.filter,
      categories: new Set(this.filter.categories),
      orbits: new Set(this.filter.orbits),
    });
  }

  private bind(): void {
    const search = $<HTMLInputElement>('search');
    search.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.filter.query = search.value;
        this.emitFilter();
      }, 120);
    });
    search.addEventListener('focus', () => this.mobile && this.setSheet(true));

    $('btn-advanced').addEventListener('click', (e) => {
      const adv = $('advanced');
      adv.hidden = !adv.hidden;
      (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!adv.hidden));
    });
    $<HTMLSelectElement>('owner-select').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.filter.owner = v || null;
      this.emitFilter();
    });
    $('btn-reset').addEventListener('click', () => {
      this.filter = {
        query: '',
        categories: new Set(CATEGORIES.map((c) => c.id)),
        orbits: new Set(ORBIT_CLASSES.map((o) => o.id)),
        owner: null,
      };
      search.value = '';
      $<HTMLSelectElement>('owner-select').value = '';
      this.syncChips();
      this.emitFilter();
    });

    $('btn-list').addEventListener('click', () => $('panel-list').classList.toggle('closed'));
    $('sheet-handle').addEventListener('click', () => {
      this.setSheet(!$('panel-list').classList.contains('expanded'));
    });
    this.bindSheetDrag();

    $('btn-close-info').addEventListener('click', () => this.h.onDeselect());
    $('btn-focus').addEventListener('click', () => this.h.onFocus());
    $('btn-follow').addEventListener('click', (e) => {
      const on = (e.currentTarget as HTMLElement).getAttribute('aria-pressed') !== 'true';
      this.setFollow(on);
      this.h.onFollow(on);
    });
    $('btn-rotate').addEventListener('click', (e) => {
      const el = e.currentTarget as HTMLElement;
      const on = el.getAttribute('aria-pressed') !== 'true';
      el.setAttribute('aria-pressed', String(on));
      this.h.onAutoRotate(on);
    });
    $('btn-retry').addEventListener('click', () => this.h.onRetry());

    const about = $<HTMLDialogElement>('about');
    $('btn-about').addEventListener('click', () => {
      $('about-sys').textContent = this.sysInfo;
      about.showModal();
    });
    $('btn-close-about').addEventListener('click', () => about.close());
    about.addEventListener('click', (e) => e.target === about && about.close());

    window.addEventListener('keydown', (e) => {
      const typing = (e.target as HTMLElement).matches('input, select, textarea');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        $('panel-list').classList.remove('closed');
        search.focus();
      } else if (e.key === 'Escape') {
        if (typing) (e.target as HTMLElement).blur();
        else if (!about.open) this.h.onDeselect();
      } else if (!typing && (e.key === 'l' || e.key === 'L')) {
        $('panel-list').classList.toggle('closed');
      } else if (!typing && (e.key === 'f' || e.key === 'F') && this.selected) {
        $('btn-follow').click();
      }
    });
  }

  private bindSheetDrag(): void {
    const handle = $('sheet-handle');
    let startY = 0;
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      dragging = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 30) this.setSheet(dy < 0);
    });
  }

  // ------------------------------------------------------------ veri

  setCatalog(sats: Satellite[]): void {
    this.sats = sats;
    const counts = new Map<Category, number>();
    for (const s of sats) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const n = counts.get(el.dataset.count as Category) ?? 0;
      el.textContent = n ? fmtInt(n) : '';
    });

    const sel = $<HTMLSelectElement>('owner-select');
    const current = sel.value;
    const opts = ownerOptions(sats);
    sel.innerHTML =
      `<option value="">Tümü</option>` +
      opts.map((o) => `<option value="${escapeHtml(o.code)}">${escapeHtml(o.label)} (${fmtInt(o.count)})</option>`).join('');
    if (opts.some((o) => o.code === current)) sel.value = current;
    else if (current) {
      sel.value = '';
      this.filter.owner = null;
    }
    sel.disabled = opts.length === 0;
    sel.title = opts.length ? '' : 'SATCAT verisi henüz alınmadı';
  }

  setResults(indices: number[]): void {
    this.resultCount = indices.length;
    const empty = this.sats.length ? 'Filtreye uyan uydu yok' : 'Veri bekleniyor…';
    this.list.setItems(indices, empty);
    this.updateCount();
  }

  private updateCount(): void {
    const total = this.sats.length;
    const txt =
      this.resultCount === total
        ? `${fmtInt(total)} uydu`
        : `${fmtInt(this.resultCount)} / ${fmtInt(total)} uydu gösteriliyor`;
    $('result-count').textContent = total ? txt : '—';
  }

  setValidCount(n: number): void {
    this.validCount = n;
  }

  setSystemInfo(text: string): void {
    this.sysInfo = text;
  }

  private renderRow(i: number, row: HTMLDivElement): void {
    const s = this.sats[i];
    if (!s) return;
    const color = CATEGORY_BY_ID.get(s.category)!.color;
    const country = s.country ?? 'Ülke bilinmiyor';
    row.innerHTML =
      `<span class="row-dot" style="background:${color}"></span>` +
      `<div class="row-main"><div class="row-name">${escapeHtml(s.name)}</div>` +
      `<div class="row-sub">${escapeHtml(country)} · ${s.orbit.cls === 'OTHER' ? 'Diğer' : s.orbit.cls}</div></div>` +
      `<span class="row-id">${s.norad}</span>`;
  }

  // ------------------------------------------------------------ seçim

  showInfo(s: Satellite | null, reveal = true): void {
    this.selected = s;
    this.detail = null;
    const panel = $('panel-info');
    if (!s) {
      panel.hidden = true;
      this.list.setActive(-1, false);
      this.setFollow(false);
      return;
    }
    panel.hidden = false;
    if (this.mobile) this.setSheet(false);
    this.list.setActive(s.index, reveal);
    const cat = CATEGORY_BY_ID.get(s.category)!;
    $('info-cat').innerHTML = `<i style="background:${cat.color}"></i>${
      s.categoryKnown ? cat.label : 'Kategori verisi bekleniyor'
    }`;
    $('info-name').textContent = s.name;
    $('info-ids').textContent = `NORAD ${s.norad}${s.intlDes ? ` · ${s.intlDes}` : ''}`;
    this.renderInfoGrid();
  }

  updateDetail(d: SatDetail | null, valid: boolean): void {
    if (!this.selected) return;
    this.detail = d && d.index === this.selected.index ? d : null;
    this.detailValid = valid;
    this.renderInfoGrid();
  }

  private renderInfoGrid(): void {
    const s = this.selected;
    if (!s) return;
    const d = this.detail;
    const now = Date.now();
    const o = s.orbit;
    const src = s.elements.src.kind === 'omm' ? 'CelesTrak' : 'AMSAT';
    const rows: Array<[string, string]> = [];

    rows.push(['Ülke', s.country ? `${escapeHtml(s.country)}${tag('SATCAT', 'CelesTrak SATCAT sahip alanı')}` : NA]);
    if (d) {
      rows.push(['Yükseklik', `${fmtInt(d.altKm)} km${calc}`]);
      rows.push(['Hız', `${fmt1(d.speedKmS)} km/sn · ${fmtInt(d.speedKmS * 3600)} km/sa${calc}`]);
      rows.push(['Konum', `${fmtLat(d.latDeg)}, ${fmtLon(d.lonDeg)}${calc}`]);
    } else {
      const why = this.detailValid ? NA : '<span class="na">Bu eleman kümesiyle hesaplanamadı</span>';
      rows.push(['Yükseklik', why], ['Hız', why], ['Konum', why]);
    }
    const oc = o.cls === 'OTHER' ? 'Diğer' : o.cls;
    rows.push([
      'Yörünge',
      Number.isFinite(o.periodMin)
        ? `${oc} · ${fmt1(o.periodMin)} dk · ${fmt1(s.elements.inclinationDeg)}° eğim${tag(src, 'Kaynak yörünge elemanlarından')}`
        : NA,
    ]);
    rows.push(['Fırlatma', fmtIsoDate(s.launchDate) ? `${fmtIsoDate(s.launchDate)}${tag('SATCAT', 'CelesTrak SATCAT')}` : NA]);
    rows.push([
      'Eleman tarihi',
      `${fmtDateTime(s.elements.epochMs)} <span class="na">(${fmtAgo(s.elements.epochMs, now)})</span>${tag(src, 'Yörünge elemanlarının epoch zamanı')}`,
    ]);
    if (this.status?.frozenAt) {
      rows.push(['Konum anı', `${fmtDateTime(this.status.frozenAt)} <span class="na">(donduruldu)</span>`]);
    }

    $('info-grid').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  setFollow(on: boolean): void {
    $('btn-follow').setAttribute('aria-pressed', String(on));
  }

  // ------------------------------------------------------------ durum

  setStatus(s: DataStatus): void {
    this.status = s;
    this.renderStatus();
    if (this.selected) this.renderInfoGrid();
  }

  private renderStatus(): void {
    const s = this.status;
    if (!s) return;
    const now = Date.now();
    const el = $('status');
    el.dataset.state = s.state;
    let text = s.message;
    if (s.state === 'offline' && s.frozenAt) {
      text = `${this.mobile ? 'Çevrimdışı' : s.message} · ${fmtDateTime(s.frozenAt)}`;
    } else if ((s.state === 'live' || s.state === 'stale') && s.elementsFetchedAt) {
      const lead = s.state === 'live' ? 'Çevrimiçi' : s.message;
      text = this.mobile
        ? `${lead} · ${fmtAgo(s.elementsFetchedAt, now)}`
        : `${lead} · veri ${fmtAgo(s.elementsFetchedAt, now)} alındı · ${fmtInt(this.validCount || this.sats.length)} uydu`;
      if (s.message.endsWith('…')) text = s.message;
    }
    if (s.nextRetryAt && s.state === 'offline') {
      const sec = Math.max(0, Math.round((s.nextRetryAt - now) / 1000));
      if (!this.mobile) text += ` · yeniden deneme ${sec} sn`;
    }
    $('status-text').textContent = text;
    $('status').title = [s.message, s.lastError ?? '', `Kontrol aralığı: ${REFRESH.checkIntervalMs / 1000} sn`]
      .filter(Boolean)
      .join('\n');
    $('btn-retry').hidden = !(s.state === 'paused' || s.state === 'empty' || s.state === 'offline');
  }

  private tickClock(): void {
    $('clock').textContent = fmtUtcClock(Date.now());
    this.renderStatus();
  }

  setRendererError(msg: string): void {
    const el = $('globe-error');
    el.hidden = false;
    el.textContent = msg;
  }
}
