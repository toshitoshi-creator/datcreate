/** Thin promise helpers over raw IndexedDB (no runtime dependency). */

export const DB_NAME = 'dot-life';
/** IndexedDB structural version (object stores / indexes). */
export const DB_VERSION = 1;

export const STORES = {
  games: 'games',
  pixels: 'pixels',
  environment: 'environment',
  milestones: 'milestones',
  meta: 'meta',
} as const;

export function openDatabase(factory: IDBFactory, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const old = ev.oldVersion;
      // Structural migrations: each step only adds; never drops user data.
      if (old < 1) {
        db.createObjectStore(STORES.games, { keyPath: 'gameId' });
        const pixels = db.createObjectStore(STORES.pixels, { keyPath: 'id' });
        pixels.createIndex('byGameIndex', ['gameId', 'growthIndex'], { unique: true });
        // A grid cell can hold at most one dot per game — enforced by the DB itself.
        pixels.createIndex('byGameCell', ['gameId', 'x', 'y'], { unique: true });
        const env = db.createObjectStore(STORES.environment, { keyPath: 'id' });
        env.createIndex('byCapturedAt', 'capturedAt');
        env.createIndex('byGame', 'gameId');
        const ms = db.createObjectStore(STORES.milestones, { keyPath: 'id' });
        ms.createIndex('byGame', 'gameId');
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}
