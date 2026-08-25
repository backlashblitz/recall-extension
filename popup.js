// Module 4: real search — sends the query to background.js, which embeds
// it and compares against every stored page's vector.

document.addEventListener("DOMContentLoaded", async () => {
  const pageCountEl = document.getElementById("pageCount");
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const resultsBox = document.getElementById("resultsBox");
  const statusText = document.getElementById("statusText");
  const excludeSiteBtn = document.getElementById("excludeSiteBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");

  async function refreshStats() {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATS" });
    if (response?.ok) {
      pageCountEl.textContent = response.count;
    }
  }

  // Module 6: exclude-this-site toggle
  let currentHostname = null;

  async function getCurrentTabHostname() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    try {
      return new URL(tab.url).hostname;
    } catch {
      return null; // e.g. chrome:// pages have no meaningful hostname
    }
  }

  async function refreshExcludeButton() {
    currentHostname = await getCurrentTabHostname();
    if (!currentHostname) {
      excludeSiteBtn.style.display = "none";
      return;
    }

    const { excludedSites = [] } = await chrome.storage.local.get("excludedSites");
    const isExcluded = excludedSites.includes(currentHostname);
    excludeSiteBtn.textContent = isExcluded
      ? `Re-enable ${currentHostname}`
      : `Exclude ${currentHostname}`;
    excludeSiteBtn.classList.toggle("active", isExcluded);
  }

  excludeSiteBtn.addEventListener("click", async () => {
    if (!currentHostname) return;
    const { excludedSites = [] } = await chrome.storage.local.get("excludedSites");
    const isExcluded = excludedSites.includes(currentHostname);

    const updated = isExcluded
      ? excludedSites.filter((h) => h !== currentHostname)
      : [...excludedSites, currentHostname];

    await chrome.storage.local.set({ excludedSites: updated });
    await refreshExcludeButton();
  });

  clearAllBtn.addEventListener("click", async () => {
    const confirmed = confirm("Delete all remembered pages? This can't be undone.");
    if (!confirmed) return;

    const response = await chrome.runtime.sendMessage({ type: "CLEAR_ALL" });
    if (response?.ok) {
      resultsBox.innerHTML = "";
      searchInput.value = "";
      statusText.textContent = "All data cleared.";
      await refreshStats();
    } else {
      statusText.textContent = "Failed to clear data — see console.";
    }
  });

  function renderResults(results) {
    resultsBox.innerHTML = "";

    if (results.length === 0) {
      resultsBox.innerHTML = `<div class="empty">No relevant matches found. Try a different phrase, or browse a few more pages first.</div>`;
      return;
    }

    for (const r of results) {
      const item = document.createElement("a");
      item.className = "result";
      item.href = r.url;
      item.target = "_blank";
      item.innerHTML = `
        <div class="result-title">${escapeHtml(r.title || r.url)}</div>
        <div class="result-snippet">${escapeHtml(r.snippet)}</div>
        <div class="result-score">${(r.score * 100).toFixed(0)}% match</div>
      `;
      resultsBox.appendChild(item);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  let debounceTimer = null;
  let searchRequestId = 0; // guards against stale/out-of-order responses

  async function runSearch(fromTyping = false) {
    const query = searchInput.value.trim();
    if (!query) {
      resultsBox.innerHTML = "";
      statusText.textContent = "Ready.";
      return;
    }

    const thisRequestId = ++searchRequestId;

    if (!fromTyping) {
      searchBtn.disabled = true;
      searchInput.disabled = true;
    }
    statusText.textContent = "Searching...";

    const response = await chrome.runtime.sendMessage({ type: "SEARCH_QUERY", query });

    // A newer search started while this one was in flight — drop this result.
    if (thisRequestId !== searchRequestId) return;

    if (!fromTyping) {
      searchBtn.disabled = false;
      searchInput.disabled = false;
    }

    if (response?.ok) {
      renderResults(response.results);
      statusText.textContent = `Found ${response.results.length} match(es).`;
    } else {
      statusText.textContent = "Search failed — see console for details.";
      console.error("[Recall/popup] Search failed:", response?.error);
    }
  }

  function scheduleLiveSearch() {
    clearTimeout(debounceTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) {
      resultsBox.innerHTML = "";
      statusText.textContent = "Ready.";
      return;
    }
    statusText.textContent = "Typing...";
    debounceTimer = setTimeout(() => runSearch(true), 450);
  }

  searchBtn.addEventListener("click", () => runSearch(false));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      runSearch(false);
    }
  });
  searchInput.addEventListener("input", scheduleLiveSearch);

  await refreshStats();
  await refreshExcludeButton();
});

