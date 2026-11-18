// Snapshot storage: the emulated machine's state kept in IndexedDB, so a reload can resume it.
// One record per browser (the guest is a single machine), keyed by a constant name.
const DB_NAME = "webvm.snapshots.v1";
const STORE = "snapshots";
const KEY = "machine";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("this browser has no IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("could not open snapshot storage"));
    request.onblocked = () => reject(new Error("snapshot storage is locked by another tab"));
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      const request = fn(store);
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("snapshot storage failed"));
      tx.onabort = () => reject(tx.error || new Error("snapshot storage was aborted"));
    });
  } finally {
    db.close();
  }
}

/** The stored snapshot record, or null. A record is { blob, savedAt, imageUrl, memoryMB, … }. */
export async function readSnapshot() {
  const record = await run("readonly", (store) => store.get(KEY));
  return record && record.blob ? record : null;
}

export async function writeSnapshot(record) {
  await run("readwrite", (store) => store.put(record, KEY));
}

export async function deleteSnapshot() {
  await run("readwrite", (store) => store.delete(KEY));
}
