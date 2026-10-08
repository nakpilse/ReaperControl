// --- tiny IndexedDB store for the folder handle ---
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open("reaper-midi", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});

const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction("kv", mode); const req = fn(t.objectStore("kv"));
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
};

export const idb = {
  get: <T>(k: string) => tx<T | undefined>("readonly", s => s.get(k)),
  set: (k: string, v: unknown) => tx("readwrite", s => s.put(v, k)),
  del: (k: string) => tx("readwrite", s => s.delete(k)),
};
