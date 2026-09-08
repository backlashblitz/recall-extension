// Module 2: runs automatically on every http/https page.
// Job: pull out the "real" text of the page (not nav/ads/footer/scripts),
// then hand it off to background.js. Storage happens in Module 4 —
// for now background.js just logs it so we can eyeball extraction quality.

(function () {
  console.log("[Recall] content script injected on:", location.href);

  // Tags whose content is basically never the "real" content of a page.
  const NOISE_TAGS = new Set([
    "SCRIPT", "STYLE", "NAV", "FOOTER", "HEADER", "ASIDE",
    "NOSCRIPT", "IFRAME", "SVG", "FORM", "BUTTON"
  ]);

  // CSS selectors matching common non-article regions: nav menus, tables of
  // contents, sidebars, language pickers, etc. Checked via closest() so we
  // skip the whole subtree, not just the tag itself.
  const NOISE_SELECTOR = [
    "nav", "[role='navigation']",
    "#toc", ".toc", "[id*='toc' i]", ".vector-toc",
    ".sidebar", ".side-bar", ".menu", ".navbox",
    ".vector-menu", ".mw-jump-link", "#mw-navigation",
    ".navbar", ".breadcrumb", ".pagination",
    "[aria-hidden='true']",
    // Wikipedia-specific noise: language selector, inter-language links,
    // portal boxes, categories, external-links sections
    "#p-lang-btn", ".interlanguage-link", ".mw-portlet-lang",
    ".mw-portlet", "#p-navigation", "#p-interaction",
    "#p-tb", "#p-coll-print_export", "#p-wikibase-otherprojects",
    ".catlinks", ".mw-indicators", ".printfooter",
    ".reflist", ".references", "[class*='lang-list']",
    "[id*='coordinates']", ".geo-nondefault", ".geo-default"
  ].join(",");

  function extractMainText() {
    // Prefer a real <article> or <main> if the page defines one —
    // most well-built sites (blogs, news, docs) mark up content this way.
    const preferred = document.querySelector("article, main, [role='main']");
    const root = preferred || document.body;

    if (!root) return "";

    // Walk the tree, skipping noise tags, collecting visible text.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentEl = node.parentElement;
        if (!parentEl) return NodeFilter.FILTER_REJECT;
        if (NOISE_TAGS.has(parentEl.tagName)) return NodeFilter.FILTER_REJECT;
        if (parentEl.closest(NOISE_SELECTOR)) return NodeFilter.FILTER_REJECT;
        const txt = node.textContent;
        if (!txt || !txt.trim()) return NodeFilter.FILTER_REJECT;

        // Reject nodes that are mostly non-Latin characters.
        // These are language-name dumps from Wikipedia's language selector
        // (e.g. "Afrikaans Shqip Азәрбајҹанҹаджа Български...").
        // If more than 35% of word characters are outside the basic Latin
        // + extended Latin + common punctuation range, skip the node.
        const wordChars = txt.replace(/\s/g, "");
        if (wordChars.length > 20) {
          const nonLatin = (txt.match(/[^\u0000-\u024F\s]/g) || []).length;
          if (nonLatin / wordChars.length > 0.35) return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let chunks = [];
    let node;
    while ((node = walker.nextNode())) {
      chunks.push(node.textContent.trim());
    }

    // Collapse excess whitespace/newlines from the concatenation.
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }

  async function capturePage() {
    // Module 6: respect the user's "exclude this site" list.
    const { excludedSites = [] } = await chrome.storage.local.get("excludedSites");
    if (excludedSites.includes(location.hostname)) {
      console.log("[Recall] Skipping capture — this site is excluded:", location.hostname);
      return;
    }

    const text = extractMainText();
    console.log("[Recall] Extracted text length:", text.length);

    // Skip pages with barely any real content (login walls, redirects, etc.)
    if (text.length < 200) {
      console.log("[Recall] Skipped — text too short (page may not have loaded yet, or selector found nothing).");
      return;
    }

    // The service worker may be asleep when this fires. Chrome will throw
    // "Could not establish connection. Receiving end does not exist." in that
    // case — that's benign (the SW wakes up on next message). Silence it so
    // it doesn't pollute the extension's error panel.
    chrome.runtime.sendMessage({
      type: "PAGE_CAPTURED",
      payload: {
        url: location.href,
        title: document.title,
        text: text,
        capturedAt: new Date().toISOString()
      }
    }).catch(() => {});
  }

  // Page is already idle by the time this script runs (run_at: document_idle),
  // but give client-rendered sites (React/Vue apps) a moment to finish painting.
  setTimeout(capturePage, 1500);
})();
