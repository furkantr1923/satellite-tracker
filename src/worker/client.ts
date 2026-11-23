import type { PositionFrame, Satellite } from '../core/types.ts';
import type { WorkerIn, WorkerOut } from './propagator.worker.ts';

/** Ana iş parçacığı tarafı: işçiye eleman kümelerini yükler, zaman adımlarını ister. */
export class PropagatorClient {
  onFrame: (f: PositionFrame) => void = () => {};
  onOrbit: (index: number, points: Float32Array | null) => void = () => {};
  onLoaded: (count: number, failed: number) => void = () => {};
  onError: (msg: string) => void = () => {};

  private readonly worker: Worker;
  private gen = 0;
  private inFlight = false;
  private loaded = false;

  constructor() {
    this.worker = new Worker(new URL('./propagator.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.handle(e.data);
    this.worker.onerror = (e) => this.onError(e.message || 'Yörünge hesaplayıcı başlatılamadı');
  }

  private post(m: WorkerIn): void {
    this.worker.postMessage(m);
  }

  private handle(m: WorkerOut): void {
    if (m.gen !== this.gen) {
      if (m.type === 'positions') this.inFlight = false;
      return;
    }
    if (m.type === 'loaded') {
      this.loaded = true;
      this.onLoaded(m.count, m.failed);
    } else if (m.type === 'positions') {
      this.inFlight = false;
      const { type: _t, ...frame } = m;
      this.onFrame(frame);
    } else if (m.type === 'orbit') {
      this.onOrbit(m.index, m.points);
    }
  }

  load(sats: Satellite[]): void {
    this.gen++;
    this.loaded = false;
    this.inFlight = false;
    this.post({ type: 'load', gen: this.gen, sources: sats.map((s) => s.elements.src) });
  }

  /** Önceki hesap bitmeden yenisini göndermez (yavaş cihazlarda kuyruk birikmesini önler). */
  tick(t: number, selected: number): boolean {
    if (!this.loaded || this.inFlight) return false;
    this.inFlight = true;
    this.post({ type: 'tick', gen: this.gen, t, selected });
    return true;
  }

  orbit(index: number, t: number, periodMin: number): void {
    if (!this.loaded) return;
    this.post({ type: 'orbit', gen: this.gen, index, t, periodMin, samples: 240 });
  }

  get generation(): number {
    return this.gen;
  }
}
