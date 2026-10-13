/* ---------- History: finished videos kept on this phone (IndexedDB) for one day ---------- */
const DB_NAME = 'recap-history', STORE = 'items';
export const KEEP_MS = 24 * 60 * 60 * 1000;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(e => { dbp = null; throw e; });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

// items older than a day are deleted automatically
export async function histPurge() {
  const cut = Date.now() - KEEP_MS;
  try {
    await tx('readwrite', s => {
      s.openCursor().onsuccess = e => {
        const c = e.target.result; if (!c) return;
        if (!(c.value.created > cut)) c.delete();
        c.continue();
      };
    });
  } catch {}
}

export async function histAdd(item) {
  await histPurge();
  return tx('readwrite', s => s.add({ ...item, created: Date.now() }));
}

export async function histList() {
  await histPurge();
  const all = await tx('readonly', s => s.getAll());
  return (all || []).sort((a, b) => b.created - a.created);
}

export const histGet = id => tx('readonly', s => s.get(id));
export const histDel = id => tx('readwrite', s => s.delete(id));
export const histClear = () => tx('readwrite', s => s.clear());
