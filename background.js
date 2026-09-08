// background.js � Central service worker / orchestrator for Recall v0.2.0.
//
// Responsibilities:
//   1. Open first-time setup tab on fresh install
//   2. Receive captured page text from content.js
//   3. Split text into overlapping chunks and embed each chunk via offscreen.js
//   4. Save {url, title, text, domain, chunks, capturedAt} to IndexedDB
//   5. Insert representative vector into the HNSW approximate-NN index
//   6. Answer SEARCH_QUERY requests (with optional date/domain filters)
//      using HNSW candidate retrieval + exact chunk-level re-ranking
//   7. Handle IMPORT_DATA / EXPORT_DATA for backup/restore
//   8. Handle WARM_UP_MODEL from the setup page

import {
  savePage, bulkSavePages, getAllPages, getPageCount,
  pruneOldest, clearAllPages,
  saveHNSW, loadHNSW, clearHNSW
} from "./db.js";
import { cosineSimilarity } from "./similarity.js";
import { HNSW } from "./hnsw.js";

// -- Constants -------------------------------------------------------------

const MAX_PAGES  = 2000;       // raised from 500 now that we have HNSW
const MIN_SCORE  = 0.25;       // raised: filters out noise/unrelated results

const OFFSCREEN_URL = "offscreen.html";

// -- Offscreen document management -----------------------------------------

let creatingOffscreenDocument = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  if (creatingOffscreenDocument) { await creatingOffscreenDocument; return; }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url:           OFFSCREEN_URL,
    reasons:       ["WORKERS"],
    justification: "Run in-browser embedding model (transformers.js) in a full browser context."
  });
  await creatingOffscreenDocument;
  creatingOffscreenDocument = null;
}

async function embedText(text) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "EMBED_TEXT", text });
  if (!response?.ok) throw new Error(response?.error ?? "Unknown embedding error");
  return response.vector;
}

// -- Chunking --------------------------------------------------------------

/**
 * Split text into overlapping windows.
 * @param {string} text
 * @param {number} [chunkSize=500]   Characters per chunk
 * @param {number} [overlap=100]     Overlap between consecutive chunks
 * @param {number} [maxChunks=5]     Hard cap � keeps embedding time bounded
 * @returns {string[]}
 */
function splitIntoChunks(text, chunkSize = 500, overlap = 100, maxChunks = 5) {
  const chunks = [];
  let start    = 0;
  while (start < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

// -- HNSW index (in-memory cache) ------------------------------------------

let hnswIndex = null;

async function getHNSW() {
  if (hnswIndex) return hnswIndex;
  const data = await loadHNSW();
  hnswIndex = data
    ? HNSW.deserialize(data)
    : new HNSW({ M: 16, efConstruction: 100, efSearch: 50 });
  return hnswIndex;
}

async function persistHNSW() {
  if (hnswIndex) await saveHNSW(hnswIndex.serialize());
}

async function rebuildHNSW() {
  const pages = await getAllPages();
  hnswIndex = new HNSW({ M: 16, efConstruction: 100, efSearch: 50 });
  for (const page of pages) {
    if (page.chunks?.length > 0) {
      hnswIndex.insert(page.url, page.chunks[0].vector);
    }
  }
  await persistHNSW();
  console.log("[Recall] HNSW index rebuilt with", hnswIndex.nodes.length, "nodes.");
}

// -- Page capture pipeline -------------------------------------------------

async function handlePageCaptured(payload) {
  const { url, title, text, capturedAt } = payload;

  let domain = "";
  try { domain = new URL(url).hostname; } catch { /* ignore */ }

  console.log("[Recall] Captured page:", { url, title, capturedAt, textLength: text.length });

  // Build the text we will embed: title (high signal) + article body, then chunk it.
  const fullText   = title ? `${title}. ${text}` : text;
  const rawChunks  = splitIntoChunks(fullText);

  // Embed each chunk � each gets its own 384-float semantic vector.
  const chunks = [];
  for (const chunkText of rawChunks) {
    const vector = await embedText(chunkText);
    chunks.push({ text: chunkText, vector });
  }

  await savePage({ url, title, text, domain, chunks, capturedAt });

  // Insert the first (most representative) chunk into the HNSW index.
  const hnsw = await getHNSW();
  hnsw.insert(url, chunks[0].vector);
  await persistHNSW();

  const count = await getPageCount();
  console.log("[Recall] Saved. Total pages remembered:", count);

  const pruned = await pruneOldest(MAX_PAGES);
  if (pruned > 0) {
    console.log(`[Recall] Pruned ${pruned} oldest page(s) (cap: ${MAX_PAGES}).`);
  }
}

// -- Search ----------------------------------------------------------------

/**
 * @param {string} query
 * @param {{ fromDate?: string, toDate?: string, domain?: string }} [filters]
 */
async function handleSearch(query, filters = {}) {
  if (!query?.trim()) return [];

  const queryVector = await embedText(query);
  const queryLower  = query.trim().toLowerCase();

  // Phase 1: HNSW candidate pre-selection (O(log N) instead of O(N))
  const hnsw = await getHNSW();
  let pages  = await getAllPages();

  if (hnsw.nodes.length >= 20) {
    // Ask HNSW for the top-150 approximate candidates; exact re-rank follows.
    const candidates   = hnsw.search(queryVector, 150);
    const candidateSet = new Set(candidates.map(c => c.externalId));
    pages = pages.filter(p => candidateSet.has(p.url));
  }
  // (For < 20 pages, brute force is negligible and skipping HNSW avoids edge cases.)

  // Phase 2: Apply date / domain filters
  if (filters.fromDate) {
    pages = pages.filter(p => p.capturedAt >= filters.fromDate);
  }
  if (filters.toDate) {
    // Include the full "to" day
    pages = pages.filter(p => p.capturedAt <= filters.toDate + "T23:59:59.999Z");
  }
  if (filters.domain?.trim()) {
    const domainQuery = filters.domain.trim().toLowerCase();
    pages = pages.filter(p => (p.domain ?? "").includes(domainQuery));
  }

  // Phase 3: Exact chunk-level cosine similarity re-ranking
  const scored = pages.map(page => {
    // Use the best-matching chunk, not just the first one
    let semanticScore = 0;
    for (const chunk of (page.chunks ?? [])) {
      const s = cosineSimilarity(queryVector, chunk.vector);
      if (s > semanticScore) semanticScore = s;
    }

    // Hybrid keyword boost -- additive, not a hard floor.
    // Title match = strong signal (the page is specifically about this topic).
    // Body text match = weak signal (word just happens to appear somewhere).
    // Using additive boost means semantic score still determines ranking order
    // when multiple pages share the same keyword.
    const titleLower     = (page.title ?? "").toLowerCase();
    const inTitle = titleLower.includes(queryLower);
    const inBody  = !inTitle && page.text.toLowerCase().includes(queryLower);
    const boost   = inTitle ? 0.35 : (inBody ? 0.08 : 0);
    const score   = Math.min(1.0, semanticScore + boost);

    return {
      url:   page.url,
      title: page.title,
      snippet: page.text.length > 160 ? page.text.slice(0, 160) + "\u2026" : page.text,
      score,
      capturedAt: page.capturedAt,
      domain:     page.domain
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(r => r.score >= MIN_SCORE).slice(0, 5);
}

// -- Lifecycle -------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Recall] Extension installed/updated. Reason:", details.reason);
  if (details.reason === "install") {
    // Open the first-time setup page in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
});

// -- Message router --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // -- Warm up the embedding model (triggered by setup page) --------------
  if (message.type === "WARM_UP_MODEL") {
    ensureOffscreenDocument()
      .then(() => embedText("warm up"))  // progress events broadcast from offscreen
      .catch(() => {});
    sendResponse({ ok: true });          // ack immediately; progress comes via events
    return true;
  }

  // -- Page captured by content.js ----------------------------------------
  if (message.type === "PAGE_CAPTURED") {
    handlePageCaptured(message.payload).catch(err => {
      console.error("[Recall] Failed to process captured page:", err);
    });
    return; // fire-and-forget
  }

  // -- Search query from popup --------------------------------------------
  if (message.type === "SEARCH_QUERY") {
    handleSearch(message.query, message.filters ?? {})
      .then(results => sendResponse({ ok: true, results }))
      .catch(err    => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // -- Stats --------------------------------------------------------------
  if (message.type === "GET_STATS") {
    getPageCount()
      .then(count => sendResponse({ ok: true, count }))
      .catch(err  => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // -- Clear all data (pages + HNSW) -------------------------------------
  if (message.type === "CLEAR_ALL") {
    Promise.all([clearAllPages(), clearHNSW()])
      .then(() => {
        hnswIndex = null; // invalidate in-memory cache
        sendResponse({ ok: true });
      })
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // -- Export all pages to JSON -------------------------------------------
  if (message.type === "EXPORT_DATA") {
    getAllPages()
      .then(pages => sendResponse({ ok: true, pages }))
      .catch(err  => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // -- Import pages from JSON backup -------------------------------------
  if (message.type === "IMPORT_DATA") {
    const records = message.pages ?? [];
    bulkSavePages(records)
      .then(() => rebuildHNSW())      // rebuild index over all imported pages
      .then(() => sendResponse({ ok: true, count: records.length }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
