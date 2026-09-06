// db.js — IndexedDB storage layer (v3 schema).
//
// Schema changes from v2 -> v3:
//   - Pages now store `chunks: [{text, vector}]` instead of a single `vector`
//   - Pages now store `domain` field (extracted from URL) for filter queries
//   - New "hnsw" object store for the approximate nearest-neighbor index
//   - Old v1/v2 records are migrated automatically on first upgrade
//
// Nothing in this file ever opens a network connection.

const DB_NAME    = "recall-db";
const DB_VERSION = 3;
const STORE_PAGES = "pages";
const STORE_HNSW  = "hnsw";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db  = request.result;
      const { transaction } = request;

      // -- Pages store ---------------------------------------------------
      let store;
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        store = db.createObjectStore(STORE_PAGES, { keyPath: "url" });
      } else {
        store = transaction.objectStore(STORE_PAGES);
      }

      if (!store.indexNames.contains("capturedAt")) {
        store.createIndex("capturedAt", "capturedAt");
      }
      if (!store.indexNames.contains("domain")) {
        store.createIndex("domain", "domain");
      }

      // -- HNSW store ----------------------------------------------------
      if (!db.objectStoreNames.contains(STORE_HNSW)) {
        db.createObjectStore(STORE_HNSW, { keyPath: "id" });
      }

      // -- Migration: v1/v2 -> v3 ----------------------------------------
      // Convert old {vector} records to {chunks, domain} format.
      if (event.oldVersion >= 1 && event.oldVersion < 3) {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;

          const rec = cursor.value;
          let changed = false;

          // Add domain if missing
          if (!rec.domain) {
            try { rec.domain = new URL(rec.url).hostname; } catch { rec.domain = ""; }
            changed = true;
          }

          // Convert single vector -> chunks array
          if (rec.vector && !rec.chunks) {
            rec.chunks = [{
              text: rec.text ? rec.text.slice(0, 500) : "",
              vector: Array.from(rec.vector)
            }];
            delete rec.vector;
            changed = true;
          }

          if (changed) cursor.update(rec);
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// -- Page CRUD -------------------------------------------------------------

export async function savePage(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, "readwrite");
    tx.objectStore(STORE_PAGES).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function bulkSavePages(records) {
  if (!records || records.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_PAGES, "readwrite");
    const store = tx.objectStore(STORE_PAGES);
    for (const rec of records) store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function deletePage(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, "readwrite");
    tx.objectStore(STORE_PAGES).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function clearAllPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, "readwrite");
    tx.objectStore(STORE_PAGES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function getAllPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_PAGES, "readonly");
    const request = tx.objectStore(STORE_PAGES).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

export async function getPageCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_PAGES, "readonly");
    const request = tx.objectStore(STORE_PAGES).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// Storage cap: delete the oldest `excess` pages by capturedAt.
export async function pruneOldest(maxCount) {
  const db = await openDB();

  const count = await new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_PAGES, "readonly");
    const req = tx.objectStore(STORE_PAGES).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });

  if (count <= maxCount) return 0;

  const excess = count - maxCount;
  let deleted  = 0;

  await new Promise((resolve, reject) => {
    const tx         = db.transaction(STORE_PAGES, "readwrite");
    const store      = tx.objectStore(STORE_PAGES);
    const cursorReq  = store.index("capturedAt").openCursor(); // oldest first

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor && deleted < excess) {
        store.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });

  return deleted;
}

// -- HNSW store ------------------------------------------------------------

const HNSW_KEY = "singleton";

export async function saveHNSW(serialized) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HNSW, "readwrite");
    tx.objectStore(STORE_HNSW).put({ id: HNSW_KEY, data: serialized });
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function loadHNSW() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_HNSW, "readonly");
    const request = tx.objectStore(STORE_HNSW).get(HNSW_KEY);
    request.onsuccess = () => resolve(request.result?.data ?? null);
    request.onerror   = () => reject(request.error);
  });
}

export async function clearHNSW() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HNSW, "readwrite");
    tx.objectStore(STORE_HNSW).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
