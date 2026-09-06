<div align="center">

# ?? Recall

### Search your browsing history by *meaning*, not just keywords

**A Chrome extension powered by a real AI model that runs 100% inside your browser.**
No server. No API key. No subscription. Completely private.

![Version](https://img.shields.io/badge/version-0.2.0-gold)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Privacy](https://img.shields.io/badge/privacy-100%25%20local-brightgreen)

</div>

---

## What Is Recall?

Normal browser history search (Ctrl+H) only finds pages containing the **exact words** you type. If you remember an article's idea but not its exact wording, you're stuck.

**Recall fixes that.** It silently indexes every page you visit using a real transformer neural network model, then lets you search by meaning:

| You search for... | Recall finds... |
|---|---|
| `"how machines learn"` | Your saved article on *deep learning* |
| `"Italian food recipes"` | The *pasta carbonara* page you bookmarked |
| `"climate change solutions"` | Your *renewable energy* research article |
| `"box"` | The *Boxing* Wikipedia article (hybrid boost) |

---

## Features

### Core
- ?? **Semantic search** — finds pages by meaning, not keyword matching
- ? **Instant results** — HNSW approximate nearest-neighbor index for O(log N) search
- ?? **100% private** — AI model runs entirely in your browser via WebAssembly
- ?? **No external dependencies** — zero network calls after first model download

### v0.2.0 — What's New
- ? **First-time setup screen** — live progress bar while the model downloads (~25 MB)
- ?? **Chunked embedding** — up to 5 overlapping chunks per article (full depth, not just the opening)
- ?? **Date & domain filters** — filter results by date range or website domain
- ?? **HNSW fast index** — O(log N) search replaces O(N) brute force; page cap raised to **2,000**
- ?? **Export / Import** — back up and restore your entire indexed history as a JSON file
- ?? **WASM path bug fixed** — `wasmPaths` now correctly uses a base URL string
- ?? **Silent error fixed** — `sendMessage` rejection when service worker is sleeping is now handled

---

## How It Works

Think of it as a 5-stage pipeline:

```
Visit a page
    ¦
    ?
1. CAPTURE (content.js)
   Reads the page DOM, strips nav/ads/footers,
   extracts real article text. Skips pages < 200 chars.
    ¦
    ?
2. ORCHESTRATE (background.js)
   Splits text into up to 5 overlapping 500-char chunks.
   Sends each chunk to the AI model for embedding.
    ¦
    ?
3. EMBED — the AI part (offscreen.js)
   transformers.js + ONNX Runtime Web runs all-MiniLM-L6-v2
   inside a hidden browser page (full browser environment).
   Each chunk ? a 384-number semantic fingerprint (vector).
    ¦
    ?
4. STORE (db.js)
   Saves { url, title, text, domain, chunks[], capturedAt }
   to IndexedDB. Nothing ever leaves your machine.
    ¦
    ?
5. INDEX (hnsw.js)
   Inserts the chunk vector into the HNSW graph index
   for fast O(log N) retrieval at search time.


-- SEARCH TIME -------------------------------------------

Type a query in the popup
    ¦
    +- Same AI model converts query ? 384-number vector
    +- HNSW graph finds top-150 candidate pages instantly
    +- Date / domain filters applied
    +- Exact cosine similarity across ALL chunks of candidates
    +- Hybrid keyword boost (catches literal substring matches)
    +- Top 8 results shown, ranked by % match
```

---

## The AI Model — `all-MiniLM-L6-v2`

| Property | Value |
|---|---|
| **Made by** | Microsoft Research |
| **Published on** | Hugging Face Hub (Apache 2.0) |
| **Architecture** | 6-layer transformer (distilled from BERT) |
| **Output** | 384-dimensional embedding vector |
| **Training data** | 1 billion+ sentence pairs (Wikipedia, Reddit, StackOverflow, news) |
| **Model size** | ~23 MB (quantized ONNX format) |
| **Accuracy** | 68.1/100 on STS benchmark (vs ~76 for paid GPT-4 embeddings) |
| **Runs** | 100% locally via WebAssembly — zero API calls |

### How the model understands meaning

The model converts text into a point in 384-dimensional space. Semantically similar texts land **close together**, different topics land **far apart** — regardless of the exact words used:

```
"neural networks"  ?-+
"machine learning" ? +-- clustered together
"deep learning"    ?-+

"pasta carbonara"  ?-+
"Italian cooking"  ? +-- clustered together
"recipe tutorial"  ?-+

"football results" ?   ? far from both clusters
```

### The Technology Stack Explained

**ONNX (Open Neural Network Exchange)**
A universal file format for AI models — like PDF for documents but for neural networks. Allows models trained in Python/PyTorch to run in JavaScript, mobile apps, or any environment. The model file (`model_quantized.onnx`) contains the architecture + all learned weights in a standardized format.

**WebAssembly (WASM)**
A near-native-speed execution engine built into every modern browser. The ONNX Runtime is written in C++ and compiled to WASM — this is the `ort-wasm-simd-threaded.asyncify.wasm` file (23 MB) bundled in `lib/ort/`. WASM runs the neural network at close to native CPU speed inside Chrome's sandbox, with no access to your filesystem or system outside the browser.

The WASM binary is bundled locally (not fetched from a CDN) because Chrome's Content Security Policy blocks loading executable code from the internet.

---

## Architecture

```
recall-extension/
¦
+-- manifest.json          # MV3 config — permissions, CSP, service worker
¦
+-- content.js             # Runs on every page — DOM extraction, noise filtering
¦
+-- background.js          # Service worker brain
¦                          # Chunking, orchestration, HNSW integration,
¦                          # search with filters, import/export handlers
¦
+-- offscreen.html         # Shell for the offscreen ML document
+-- offscreen.js           # Loads model, embeds text, broadcasts progress events
¦
+-- hnsw.js                # Pure-JS HNSW approximate nearest-neighbor graph
¦                          # O(log N) search, fully serializable to IndexedDB
¦
+-- db.js                  # IndexedDB storage layer (schema v3)
¦                          # Stores pages with chunks[], domain field
¦                          # HNSW persistence, bulk save for import
¦
+-- similarity.js          # Cosine similarity computation
¦
+-- setup.html             # First-time onboarding tab
+-- setup.css              # Setup page styles
+-- setup.js               # Progress bar — listens for download events
¦
+-- popup.html             # Extension popup UI
+-- popup.css              # Popup styles
+-- popup.js               # Search, filters, export, import logic
¦
+-- lib/
¦   +-- transformers-bundle.js         # Hugging Face transformers.js (bundled)
¦   +-- ort/
¦       +-- ort-wasm-simd-threaded.asyncify.wasm  # ONNX Runtime (23 MB)
¦       +-- ort-wasm-simd-threaded.asyncify.mjs   # ONNX Runtime JS loader
¦
+-- icons/                 # Extension icons (16, 48, 128px)
```

---

## Database Schema (v3)

Each saved page record in IndexedDB:

```json
{
  "url":        "https://en.wikipedia.org/wiki/Machine_learning",
  "title":      "Machine learning - Wikipedia",
  "text":       "Machine learning is a branch of artificial intelligence...",
  "domain":     "en.wikipedia.org",
  "capturedAt": "2026-09-06T12:30:00.000Z",
  "chunks": [
    { "text": "Machine learning. Machine learning is a branch...", "vector": [0.021, -0.114, ...] },
    { "text": "...supervised learning algorithms adjust their...",  "vector": [0.033,  0.098, ...] },
    { "text": "...neural networks consist of interconnected...",    "vector": [-0.05,  0.201, ...] }
  ]
}
```

> **Migration:** v1/v2 records (single `vector` field) are automatically upgraded to v3 format on first load. No data loss.

---

## Installing Locally

1. Clone this repo:
   ```bash
   git clone https://github.com/backlashblitz/recall-extension.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** ? select the `recall-extension` folder

5. The extension icon appears in your toolbar. On first install, a **setup tab** opens automatically with a live model download progress bar.

6. Browse normally — every page is quietly indexed. Click the extension icon to search.

> **After editing any file:** go to `chrome://extensions` and click the ? reload button on the Recall card, then reload any open tabs.

---

## Pages Recall CAN Index

? Wikipedia articles, news articles (BBC, CNN, Reuters), blog posts, Medium, Stack Overflow, Reddit threads, documentation sites (MDN, docs.python.org), research paper pages, product pages with rich descriptions

## Pages Recall CANNOT Index

| Page type | Why |
|---|---|
| `chrome://` internal pages | Content scripts don't run there |
| Gmail / Google Docs | Content is in canvas/shadow DOM |
| PDF files in browser | Extension sees the PDF viewer, not the text |
| Login/paywall pages | Less than 200 chars of real content — skipped |
| Pages you manually excluded | By design |

---

## Using the Popup

| Control | What it does |
|---|---|
| Search box | Type a query — live results after 450ms pause, or press Enter |
| **Filters ?** | Expand to filter by date range or domain |
| **Export** | Download all indexed pages as a `.json` backup |
| **Import** | Restore from a `.json` backup file |
| **Exclude [domain]** | Stop indexing the current site |
| **Clear all** | Wipe the entire index (with confirmation) |
| Pages remembered | Live count of indexed pages (max 2,000) |

---

## Tech Stack

| Technology | Role |
|---|---|
| **Manifest V3** | Chrome extension platform |
| **transformers.js** (Hugging Face) | In-browser ML model loading and inference |
| **ONNX Runtime Web** | Neural network execution engine (via WebAssembly) |
| **all-MiniLM-L6-v2** | Sentence transformer model for semantic embeddings |
| **HNSW** (custom pure-JS) | Approximate nearest-neighbor graph for fast search |
| **IndexedDB** | Client-side storage for pages + HNSW index |
| **Vanilla JS** | No framework — lightweight by design |
| **esbuild** | Used to bundle transformers.js + WASM locally |

---

## Privacy

- **Zero network calls** after the model is downloaded once
- **No account, no login, no telemetry**
- Everything — model inference, vector storage, search — runs inside your browser
- The model is cached by the browser after first download (no re-download on restart)
- You can export and delete your data at any time

---

## Changelog

### v0.2.0
- Added first-time setup screen with live model download progress bar
- Chunked article embedding (up to 5 overlapping chunks per page)
- Date and domain filters in the popup
- HNSW approximate nearest-neighbor index (O(log N) search)
- Page cap raised: 500 ? 2,000
- Export / Import (JSON backup and restore)
- Fixed: `wasmPaths` must be a base URL string, not a key-value object
- Fixed: Uncaught `sendMessage` rejection when service worker is sleeping
- Fixed: `pruneOldest()` double IndexedDB open
- DB schema bumped: v2 ? v3 (chunks, domain field, HNSW store)

### v0.1.0
- Initial release
- Page capture with DOM noise filtering
- In-browser embedding via transformers.js + ONNX Runtime WASM
- IndexedDB storage
- Cosine similarity search
- Hybrid keyword + semantic scoring
- Exclude-site feature
- Storage cap (500 pages)

---

<div align="center">
Built with ?? — runs entirely in your browser, respects your privacy.
</div>
