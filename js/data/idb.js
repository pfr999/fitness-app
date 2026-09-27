// IndexedDB mínima: un almacén clave → valor. Si IndexedDB no está disponible, cae a memoria.

const DB = 'fitness-app', STORE = 'kv';
let dbp = null;
const mem = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(fn(null));
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => resolve(undefined);
      }),
  );
}

export const idb = {
  async get(key) {
    const db = await open();
    if (!db) return mem.get(key);
    return tx('readonly', (s) => s.get(key));
  },
  async set(key, value) {
    const db = await open();
    if (!db) return void mem.set(key, value);
    return tx('readwrite', (s) => s.put(value, key));
  },
  async del(key) {
    const db = await open();
    if (!db) return void mem.delete(key);
    return tx('readwrite', (s) => s.delete(key));
  },
  async keys(prefix = '') {
    const db = await open();
    const all = db ? await tx('readonly', (s) => s.getAllKeys()) : [...mem.keys()];
    return (all || []).filter((k) => String(k).startsWith(prefix));
  },
};
