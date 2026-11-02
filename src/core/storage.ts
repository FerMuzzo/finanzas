// Minimal IndexedDB key value store. Only encrypted content is written here.

const DB_NAME = 'finanzas';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const kv = {
  get<T>(key: string): Promise<T | undefined> {
    return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  },
  set(key: string, value: unknown): Promise<unknown> {
    return tx('readwrite', (s) => s.put(value, key));
  },
  /** Write several keys in one atomic transaction. */
  setMany(entries: Record<string, unknown>): Promise<unknown> {
    return tx('readwrite', (s) => {
      for (const [k, v] of Object.entries(entries)) s.put(v, k);
    });
  },
  del(key: string): Promise<unknown> {
    return tx('readwrite', (s) => s.delete(key));
  },
  clear(): Promise<unknown> {
    return tx('readwrite', (s) => s.clear());
  },
};
