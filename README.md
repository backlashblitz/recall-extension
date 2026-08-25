# Recall — Module 1: Scaffold

## What this module does
- Sets up a Manifest V3 Chrome extension skeleton
- Shows a popup UI (search box is disabled for now — that comes in Module 5)
- Confirms `chrome.storage` permission works
- Confirms the background service worker loads

## How to test it (do this now)
1. Open Chrome, go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `semantic-memory` folder
5. You should see "Recall" appear in your extensions list with the gold ring icon
6. Click the extension icon in your toolbar → the popup should open showing:
   - "Recall" title
   - A disabled search box
   - Status line: "Module 1: scaffold running..."
   - "0 pages remembered"
7. Open the background worker console: on the extensions page, click **"service worker"** link under Recall — you should see `[Recall] Extension installed and background worker running.` logged

If all of that shows up correctly, Module 1 is done and we move to Module 2 (page text capture).

## Module 2: Page text capture (automatic)

### What this module does
- Adds `content.js`, which runs automatically on every http/https page you visit
- It extracts the "real" text of the page — prefers `<article>`/`<main>` if present, skips nav/footer/ads/scripts
- 1.5 seconds after the page settles, it sends the extracted text to `background.js`
- `background.js` currently just **logs it to console** (no storage yet — that's Module 4, so we can first confirm extraction quality)

### How to test it
1. Go to `chrome://extensions`, find "Recall", click the **reload icon** (🔄) to pick up the new files
2. Visit any content-heavy page — e.g. a Wikipedia article, a blog post, a news article
3. Wait ~2 seconds, then right-click the page → **Inspect** → go to the **Console** tab (this is the *page's* console, not the extension's)
4. You should see a log like:
   ```
   [Recall] Captured page: { url: "...", title: "...", capturedAt: "...", textLength: 3421, preview: "..." }
   ```
5. Try a few different kinds of pages (Wikipedia, a blog, YouTube, a news site) and check:
   - Is the `preview` text actually the article content, or is it picking up junk (menu items, ads, cookie banners)?
   - Is `textLength` reasonable (a real article should be 1000+ characters usually)?

Send me a couple of console screenshots from different sites — if extraction looks clean, we move to Module 3 (in-browser embeddings). If some sites extract poorly, we'll tune the extraction logic first.

## Module 3: In-browser embeddings

### What this module does
- Bundles `transformers.js` (Hugging Face's in-browser ML library) directly inside the extension — no CDN dependency, no server
- Loads a small embedding model, `Xenova/all-MiniLM-L6-v2` (~25MB), the **first time** it's needed. Chrome's own cache keeps it after that — so it only downloads once, ever, even across browser restarts
- Every time a page is captured (Module 2), its text is now converted into a **384-dimension vector** — a list of 384 numbers that represents the *meaning* of the text
- This is the same idea as your RokomariBG embeddings (multilingual-e5-base), just running client-side instead of on a GPU server, and with a smaller/faster model suited to a browser

### Important fix: Offscreen Document
Chrome extension service workers (`background.js`) don't have `XMLHttpRequest`, which the WASM runtime underneath transformers.js needs to initialize. The fix: the actual model now runs inside an **offscreen document** (`offscreen.html` / `offscreen.js`) — a hidden page with a full browser environment. `background.js` just creates that hidden page once and relays messages to/from it.

### How to test it
1. `chrome://extensions` → Remove the old "Recall" entry
2. Extract this fresh zip, **Load unpacked** the folder
3. Open the **service worker** console (click "service worker" on the extension card)
4. Visit any content-heavy page and reload it
5. **First time only**: model download logs will now appear with an `[offscreen]` prefix, e.g.:
   ```
   [Recall/offscreen] Loading embedding model (first time only)...
   [Recall/offscreen] Downloading: onnx/model_quantized.onnx — 43%
   ```
   (To see these directly: `chrome://extensions` → find "Recall" → there should be an **"offscreen document"** entry under "Inspect views" once it's created — click it to open its own console)
6. Back in the **service worker** console, once the offscreen document finishes, you'll see:
   ```
   [Recall] Embedding generated: { url: "...", dimensions: 384, firstValues: [...] }
   ```

If `dimensions: 384` shows up with real numbers in `firstValues`, Module 3 works — you now have a working in-browser embedding pipeline. Send me a screenshot and we move to Module 4 (storing these vectors + running actual similarity search).

## Module 4: Storage + real search

### What this module does
- Every captured page's `{url, title, text, vector}` now gets saved to **IndexedDB** (keyed by URL, so revisiting a page updates it instead of duplicating)
- The popup's search box is now **live** — typing a query and hitting "Find" (or Enter) embeds your query the same way pages are embedded, then compares it against every stored page using cosine similarity, and shows the closest matches with a % match score
- The "pages remembered" counter in the popup now reflects the real count

### How to test it
1. `chrome://extensions` → Remove the old "Recall" entry, extract this fresh zip, **Load unpacked**
2. Browse a handful of **different** pages — e.g. a Wikipedia article on machine learning, one on football, one on a cooking recipe. Give each one 5-10 seconds to be captured + embedded (check the service worker console for `[Recall] Saved. Total pages remembered: N`)
3. Click the Recall icon → you should see "pages remembered" go up as you browse
4. Type a search query that's **conceptually related but doesn't use the exact words** from a page you visited — e.g. if you visited the "Machine Learning" Wikipedia page, try searching "neural network training" or "AI algorithms"
5. Hit **Find** (or press Enter)
6. You should see results ranked by % match, with the most relevant page(s) at top — even though your query didn't use the article's exact wording

This is the core "semantic memory" behavior working end-to-end. If results look reasonable, Module 4 is done — Module 5 will polish the UI (loading states, snippet highlighting) and Module 6 will handle edge cases (very short pages, duplicate detection, storage limits, an "exclude this site" option).

## Module 5: Cleaner extraction + UI polish

### What changed
- **Extraction**: now skips navigation menus, tables of contents, sidebars, language pickers, and similar non-article regions (previously these leaked into captured text as noise — e.g. Wikipedia's "Toggle the table of contents... 39 languages..." showing up in snippets)
- **UI**: search button and input now disable while a search is in flight, so you can't double-submit

### How to test it
1. Reload the extension with this version
2. Visit a **new** page (previously-captured pages won't be re-captured until you revisit and reload them — that's expected, since capture is keyed by URL)
3. Search for something and check the snippet — it should now start with real article content, not menu/nav text

## Module 5.5: Live search-as-you-type

### What changed
- The search box now searches automatically as you type (450ms after you pause), no need to click "Find"
- Pressing Enter or clicking "Find" still searches immediately
- Results update live; if a newer keystroke triggers a new search before an old one finishes, the old (stale) result is discarded automatically

### Note on how this works
This is **semantic** search, not spelling autocomplete — it doesn't complete partial words. Typing "footb" may already match "Football" (since it's close to the real word), but a very short partial word like "spor" may not clearly signal "sports" yet, since it isn't a real word itself. Full or near-full words give the most accurate results; the shorter the input, the fuzzier the match.

## Module 5.6: Hybrid keyword + semantic search

### What changed
Pure semantic search misses cases like "box" not matching "Boxing" — to the embedding model, "box" (a container) and "boxing" (a sport) are different concepts, even though one is literally a substring of the other. Fixed by adding a **hybrid** check: if the query text literally appears in a page's title or body, that page is now guaranteed a strong match score, regardless of what the embedding similarity says. Meaning-based matching (the whole point of this extension — e.g. "neural network training" finding a "Machine Learning" page) still works exactly as before; this only adds a safety net for literal substring matches.

## Module 6: Storage limits, privacy controls, data management

### What's new
- **Storage cap**: keeps at most 500 pages. Once you go over, the oldest pages (by capture date) are automatically deleted to make room — storage won't grow forever
- **Exclude this site**: popup now has an "Exclude [hostname]" button. Click it while on a site (e.g. your bank, email, or any private page) and Recall will stop capturing pages from that domain. Click again to re-enable
- **Clear all data**: a "Clear all data" button in the popup wipes everything (with a confirmation prompt first)
- **Revisit handling**: this was already working since Module 4 (pages are keyed by URL), but worth noting explicitly — revisiting a page updates its stored copy instead of creating a duplicate

### How to test it
1. Reload the extension with this version
2. **Exclude test**: visit any site, open the popup, click "Exclude [hostname]" — button should change to "Re-enable [hostname]". Reload that page — check the page console, you should see `[Recall] Skipping capture — this site is excluded: ...`
3. **Clear all test**: click "Clear all data", confirm the prompt — "pages remembered" should drop to 0
4. **Storage cap**: not practical to test by hand (would need 500+ pages), but the logic is in `db.js`'s `pruneOldest()` — trust the code or dial `MAX_PAGES` down temporarily to something small like 3 to see it in action, then set it back

## Folder structure
```
semantic-memory/
├── manifest.json          # extension config (Manifest V3)
├── background.js          # service worker (embedding logic lives here now)
├── content.js             # runs on every page, extracts text
├── popup.html              # popup UI structure
├── popup.css              # popup styling
├── popup.js                # popup logic
├── db.js                   # IndexedDB storage (Module 4)
├── similarity.js            # cosine similarity search (Module 4)
├── lib/
│   └── transformers-bundle.js   # bundled in-browser ML library (custom-built, no bare imports)
└── icons/                  # extension icons
```
