// Stockage local (IndexedDB, repli sur localStorage) : tout reste sur l'appareil.

const DB_NAME = 'familien';
const STORE = 'kv';
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) return reject(new Error('IndexedDB indisponible'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export async function get(key) {
  try {
    return await tx('readonly', (s) => s.get(key));
  } catch {
    try { const v = localStorage.getItem('familien:' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
  }
}

export async function set(key, value) {
  try {
    await tx('readwrite', (s) => s.put(value, key));
  } catch {
    try { localStorage.setItem('familien:' + key, JSON.stringify(value)); } catch { /* plein ou bloqué */ }
  }
}

export async function del(key) {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignoré */ }
  try { localStorage.removeItem('familien:' + key); } catch { /* ignoré */ }
}

// Demande au navigateur de ne pas effacer les données en cas de manque de place.
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* ignoré */ }
}
