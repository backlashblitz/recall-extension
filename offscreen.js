// This runs inside the offscreen document — a hidden but FULL browser page
// (unlike the service worker, it has XMLHttpRequest, DOM, everything).
// transformers.js needs that full environment to load its WASM backend.

import { pipeline, env } from "./lib/transformers-bundle.js";

// Silence a harmless, expected warning: the library tries to cache the
// downloaded WASM binary via the Cache API, but Cache.put() doesn't support
// chrome-extension:// URLs (a browser limitation, not a bug in our code).
// The fetch itself still succeeds either way — this only stops the noisy
// (but functionally irrelevant) warning from showing up in the extension's
// Errors panel.
if (typeof caches !== "undefined" && caches.open) {
  const originalOpen = caches.open.bind(caches);
  caches.open = async function (name) {
    const cache = await originalOpen(name);
    const originalPut = cache.put.bind(cache);
    cache.put = async function (request, response) {
      try {
        return await originalPut(request, response);
      } catch (err) {
        return undefined; // swallow — see comment above
      }
    };
    return cache;
  };
}

env.allowLocalModels = false;
env.useBrowserCache = true;

// Critical fix: by default, onnxruntime-web tries to fetch its WASM runtime
// from a CDN (jsdelivr). That's blocked by the extension's Content Security
// Policy. We bundled those files locally (lib/ort/) — point to them instead.
// IMPORTANT: wasmPaths must be a BASE URL string (directory, trailing slash
// required). ORT's wasm loader appends filenames itself. Passing a key-value
// object looks plausible but silently breaks on most ORT versions.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/ort/");

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let embedderPromise = null;

function getEmbedder() {
  if (!embedderPromise) {
    console.log("[Recall/offscreen] Loading embedding model (first time only)...");
    embedderPromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
      progress_callback: (progress) => {
        if (progress.status === "progress" || progress.status === "done") {
          // Broadcast to background.js and any listening extension pages (e.g. setup tab)
          chrome.runtime.sendMessage({
            type:     "MODEL_DOWNLOAD_PROGRESS",
            file:     progress.file,
            progress: progress.progress ?? 0,
            status:   progress.status
          }).catch(() => {}); // ignore if no listeners

          if (progress.status === "progress") {
            console.log(`[Recall/offscreen] Downloading: ${progress.file} — ${Math.round(progress.progress || 0)}%`);
          }
        }
      }
    }).then(pipe => {
      // Notify all extension pages that the model is fully ready
      chrome.runtime.sendMessage({ type: "MODEL_READY" }).catch(() => {});
      console.log("[Recall/offscreen] Model ready.");
      return pipe;
    });
  }
  return embedderPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "EMBED_TEXT") return; // not for us

  (async () => {
    try {
      const extractor = await getEmbedder();
      const truncated = message.text.slice(0, 2000);
      const output = await extractor(truncated, { pooling: "mean", normalize: true });
      sendResponse({ ok: true, vector: Array.from(output.data) });
    } catch (err) {
      console.error("[Recall/offscreen] Embedding failed:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep sendResponse channel open for the async work above
});

console.log("[Recall/offscreen] Offscreen document ready.");
