// Module 4: local storage for captured pages + their embedding vectors.
// IndexedDB works fine inside a service worker (unlike XMLHttpRequest),
// so this lives directly in background.js's world — no offscreen needed.

const DB_NAME = "recall-db";
const DB_VERSION = 2;
const STORE_NAME = "pages";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      let store;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
      } else {
        store = request.transaction.objectStore(STORE_NAME);
      }
      // Index on capturedAt so we can efficiently find the oldest pages
      // when pruning storage (Module 6: storage limit).
      if (!store.indexNames.contains("capturedAt")) {
        store.createIndex("capturedAt", "capturedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePage(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePage(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(url);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getPageCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Module 6: storage cap. If we're over maxCount, delete the oldest pages
// (by capturedAt) until we're back at the limit — keeps the extension from
// growing unbounded on heavy browsing.
export async function pruneOldest(maxCount) {
  const db = await openDB();
  const count = await getPageCount();
  if (count <= maxCount) return 0;

  const excess = count - maxCount;
  let deleted = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("capturedAt");
    const cursorRequest = index.openCursor(); // ascending = oldest first

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor && deleted < excess) {
        store.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return deleted;
}
