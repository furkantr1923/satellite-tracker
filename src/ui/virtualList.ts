/** Yalnızca görünen satırları çizen sanal liste — 15.000+ uyduda bile akıcı kaydırma. */
export class VirtualList {
  private items: ArrayLike<number> = [];
  private readonly spacer: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private active = -1;
  private raf = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly rowHeight: () => number,
    private readonly renderRow: (index: number, row: HTMLDivElement) => void,
    private readonly onPick: (index: number) => void,
  ) {
    this.spacer = document.createElement('div');
    this.spacer.className = 'list-spacer';
    el.appendChild(this.spacer);
    el.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(el);
    el.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLDivElement>('.row');
      const i = row ? Number(row.dataset.index) : NaN;
      if (Number.isInteger(i)) this.onPick(i);
    });
  }

  setItems(items: ArrayLike<number>, emptyText: string): void {
    this.items = items;
    this.el.scrollTop = 0;
    // Katalog yenilenmiş olabilir: aynı indeksteki satırlar da yeniden çizilsin
    for (const row of this.pool) delete row.dataset.index;
    this.spacer.dataset.empty = items.length ? '' : emptyText;
    this.render();
  }

  setActive(index: number, reveal: boolean): void {
    this.active = index;
    if (reveal) {
      const pos = Array.prototype.indexOf.call(this.items, index) as number;
      if (pos >= 0) {
        const h = this.rowHeight();
        const top = pos * h;
        if (top < this.el.scrollTop || top + h > this.el.scrollTop + this.el.clientHeight) {
          this.el.scrollTop = Math.max(0, top - this.el.clientHeight / 2 + h / 2);
        }
      }
    }
    this.render();
  }

  refresh(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const h = this.rowHeight();
    const n = this.items.length;
    this.spacer.style.height = `${Math.max(n * h, 1)}px`;
    const empty = this.spacer.dataset.empty;
    let emptyEl = this.spacer.querySelector<HTMLDivElement>('.list-empty');
    if (!n && empty) {
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'list-empty';
        this.spacer.appendChild(emptyEl);
      }
      emptyEl.textContent = empty;
    } else emptyEl?.remove();

    const first = Math.max(0, Math.floor(this.el.scrollTop / h) - 4);
    const last = Math.min(n, Math.ceil((this.el.scrollTop + this.el.clientHeight) / h) + 4);
    const need = Math.max(0, last - first);
    while (this.pool.length < need) {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'option');
      this.spacer.appendChild(row);
      this.pool.push(row);
    }
    for (let j = 0; j < this.pool.length; j++) {
      const row = this.pool[j]!;
      const pos = first + j;
      if (j >= need) {
        row.hidden = true;
        continue;
      }
      const index = this.items[pos]!;
      row.hidden = false;
      row.style.transform = `translateY(${pos * h}px)`;
      if (row.dataset.index !== String(index)) {
        row.dataset.index = String(index);
        this.renderRow(index, row);
      }
      const isActive = index === this.active;
      row.classList.toggle('active', isActive);
      row.setAttribute('aria-selected', String(isActive));
    }
  }
}
