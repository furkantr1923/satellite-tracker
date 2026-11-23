import { REFRESH } from '../config.ts';

/** Bağlantı yok / zaman aşımı — yeniden denenebilir. */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** Sunucu 200 dışında yanıt verdi — CelesTrak politikası gereği otomatik sorgu durdurulur. */
export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Http {
  getText(url: string): Promise<string>;
}

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
}

function tauri(): TauriGlobal | null {
  const t = (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return t && t.core && typeof t.core.invoke === 'function' ? t : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new NetworkError('İstek zaman aşımına uğradı')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * Platforma göre HTTP:
 * - Windows (Tauri): Rust tarafındaki `fetch_text` komutu (izinli alan adlarıyla sınırlı, CORS'tan bağımsız).
 * - Android (Capacitor): CapacitorHttp yerel köprüsü `fetch`'i yamalar.
 * - Tarayıcı: standart fetch.
 */
export function createHttp(): Http {
  return {
    async getText(url: string): Promise<string> {
      const t = tauri();
      if (t) {
        let res: { status: number; body: string };
        try {
          res = await withTimeout(t.core.invoke<{ status: number; body: string }>('fetch_text', { url }), REFRESH.requestTimeoutMs);
        } catch (e) {
          if (e instanceof NetworkError) throw e;
          throw new NetworkError(String(e));
        }
        if (res.status !== 200) throw new HttpError(res.status, `Sunucu yanıtı: HTTP ${res.status}`);
        return res.body;
      }

      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let resp: Response;
      try {
        resp = await withTimeout(fetch(url, { signal: ctrl?.signal, cache: 'no-store' }), REFRESH.requestTimeoutMs);
      } catch (e) {
        ctrl?.abort();
        if (e instanceof NetworkError) throw e;
        throw new NetworkError(e instanceof Error ? e.message : String(e));
      }
      if (resp.status !== 200) throw new HttpError(resp.status, `Sunucu yanıtı: HTTP ${resp.status}`);
      try {
        return await withTimeout(resp.text(), REFRESH.requestTimeoutMs);
      } catch (e) {
        throw new NetworkError(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
