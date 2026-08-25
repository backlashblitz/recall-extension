// Module 1: confirms the extension loaded correctly.
// Module 2: receives captured page text from content.js.
// Module 3: turns that text into an embedding vector (via offscreen doc).
// Module 4: stores {url, title, text, vector} in IndexedDB, and answers
//           search queries by comparing the query's vector against every
//           stored page's vector (cosine similarity).

import { savePage, getAllPages, getPageCount, pruneOldest, clearAllPages } from "./db.js";
import { cosineSimilarity } from "./similarity.js";

const MAX_PAGES = 500; // Module 6: cap storage so it doesn't grow unbounded

const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreenDocument = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"],
    justification: "Run in-browser embedding model (transformers.js) which needs a full browser context."
  });

  await creatingOffscreenDocument;
  creatingOffscreenDocument = null;
}

async function embedText(text) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "EMBED_TEXT", text });
  if (!response || !response.ok) {
    throw new Error(response?.error || "Unknown error from offscreen document");
  }
  return response.vector;
}

async function handlePageCaptured(payload) {
  const { url, title, text, capturedAt } = payload;
  console.log("[Recall] Captured page:", { url, title, capturedAt, textLength: text.length });

  // Prepend the title — it's a concise, high-signal summary of the topic,
  // which helps short queries (e.g. "computer") match relevant long articles
  // that don't happen to repeat that exact word early in the body text.
  const textForEmbedding = title ? `${title}. ${text}` : text;
  const vector = await embedText(textForEmbedding);

  await savePage({
    url,
    title,
    text,
    vector,
    capturedAt
  });

  const count = await getPageCount();
  console.log("[Recall] Saved. Total pages remembered:", count);

  const pruned = await pruneOldest(MAX_PAGES);
  if (pruned > 0) {
    console.log(`[Recall] Storage cap (${MAX_PAGES}) exceeded — pruned ${pruned} oldest page(s).`);
  }
}

async function handleSearch(query) {
  if (!query || !query.trim()) return [];

  const MIN_SCORE = 0.05; // only filter clearly-irrelevant/negative scores;
  // short queries vs long documents naturally score lower even when relevant

  const queryVector = await embedText(query);
  const pages = await getAllPages();
  const queryLower = query.trim().toLowerCase();

  const scored = pages.map((page) => {
    const semanticScore = cosineSimilarity(queryVector, page.vector);

    // Hybrid boost: if the query literally appears in the title or text,
    // treat it as a strong match even if the embedding similarity is low.
    // This catches cases like "box" -> "Boxing" that pure semantic
    // similarity misses because "box" and "boxing" are different concepts
    // to the embedding model, even though "box" is a substring of "boxing".
    const titleLower = (page.title || "").toLowerCase();
    const isKeywordMatch = titleLower.includes(queryLower) || page.text.toLowerCase().includes(queryLower);
    const score = isKeywordMatch ? Math.max(semanticScore, 0.5) : semanticScore;

    return {
      url: page.url,
      title: page.title,
      snippet: page.text.slice(0, 160) + "...",
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((r) => r.score >= MIN_SCORE).slice(0, 8);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Recall] Extension installed and background worker running.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PAGE_CAPTURED") {
    handlePageCaptured(message.payload).catch((err) => {
      console.error("[Recall] Failed to process captured page:", err);
    });
    return; // no sendResponse needed
  }

  if (message.type === "SEARCH_QUERY") {
    handleSearch(message.query)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep channel open — async response
  }

  if (message.type === "GET_STATS") {
    getPageCount()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "CLEAR_ALL") {
    clearAllPages()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
