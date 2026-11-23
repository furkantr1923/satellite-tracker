/** Basit anahtar-değer önbelleği: IndexedDB, yoksa bellek içi yedek. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryKV implements KV {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.m.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.m.set(key, value);
  }
}

const DB_NAME = 'satellite-tracker';
const STORE = 'kv';

class IndexedKV implements KV {
  private dbp: Promise<IDBDatabase>;
  constructor() {
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB açılamadı'));
    });
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.dbp;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB işlemi başarısız'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB işlemi iptal edildi'));
    });
  }
  get<T>(key: string): Promise<T | undefined> {
    return this.run<T | undefined>('readonly', (s) => s.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (s) => s.put(value, key));
  }
}

/** IndexedDB kullanılamıyorsa (gizli mod vb.) bellek içi önbelleğe düşer. */
export function createKV(): KV {
  if (typeof indexedDB === 'undefined') return new MemoryKV();
  const idb = new IndexedKV();
  const mem = new MemoryKV();
  let failed = false;
  return {
    async get<T>(key: string) {
      if (failed) return mem.get<T>(key);
      try {
        return await idb.get<T>(key);
      } catch {
        failed = true;
        return mem.get<T>(key);
      }
    },
    async set(key: string, value: unknown) {
      if (failed) return mem.set(key, value);
      try {
        await idb.set(key, value);
      } catch {
        failed = true;
        await mem.set(key, value);
      }
    },
  };
}
