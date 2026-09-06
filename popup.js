// popup.js — Recall v0.2.0 popup UI.
// New in v0.2.0: date/domain filters, export data, import data.

document.addEventListener("DOMContentLoaded", async () => {

  // -- Element refs ------------------------------------------------------
  const pageCountEl    = document.getElementById("pageCount");
  const searchInput    = document.getElementById("searchInput");
  const searchBtn      = document.getElementById("searchBtn");
  const resultsBox     = document.getElementById("resultsBox");
  const statusText     = document.getElementById("statusText");
  const excludeSiteBtn = document.getElementById("excludeSiteBtn");
  const clearAllBtn    = document.getElementById("clearAllBtn");
  const exportBtn      = document.getElementById("exportBtn");
  const importBtn      = document.getElementById("importBtn");

  // Filter elements
  const filterToggle    = document.getElementById("filterToggle");
  const filterPanel     = document.getElementById("filterPanel");
  const filterActiveTag = document.getElementById("filterActiveTag");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const fromDate        = document.getElementById("fromDate");
  const toDate          = document.getElementById("toDate");
  const domainFilter    = document.getElementById("domainFilter");

  // -- Stats --------------------------------------------------------------
  async function refreshStats() {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATS" });
    if (response?.ok) pageCountEl.textContent = response.count;
  }

  // -- Exclude-site toggle ------------------------------------------------
  let currentHostname = null;

  async function getCurrentTabHostname() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    try { return new URL(tab.url).hostname; } catch { return null; }
  }

  async function refreshExcludeButton() {
    currentHostname = await getCurrentTabHostname();
    if (!currentHostname) { excludeSiteBtn.style.display = "none"; return; }
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
      ? excludedSites.filter(h => h !== currentHostname)
      : [...excludedSites, currentHostname];
    await chrome.storage.local.set({ excludedSites: updated });
    await refreshExcludeButton();
  });

  // -- Clear all ----------------------------------------------------------
  clearAllBtn.addEventListener("click", async () => {
    if (!confirm("Delete all remembered pages? This can't be undone.")) return;
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_ALL" });
    if (response?.ok) {
      resultsBox.innerHTML = "";
      searchInput.value   = "";
      statusText.textContent = "All data cleared.";
      await refreshStats();
    } else {
      statusText.textContent = "Failed to clear data — see console.";
    }
  });

  // -- Filters ------------------------------------------------------------
  filterToggle.addEventListener("click", () => {
    const isOpen = filterPanel.classList.toggle("open");
    filterToggle.setAttribute("aria-expanded", isOpen);
    filterPanel.setAttribute("aria-hidden", !isOpen);
  });

  function filtersAreActive() {
    return fromDate.value || toDate.value || domainFilter.value.trim();
  }

  function updateFilterTag() {
    filterActiveTag.classList.toggle("hidden", !filtersAreActive());
  }

  [fromDate, toDate, domainFilter].forEach(el => {
    el.addEventListener("change", () => { updateFilterTag(); scheduleLiveSearch(); });
    el.addEventListener("input",  () => { updateFilterTag(); scheduleLiveSearch(); });
  });

  clearFiltersBtn.addEventListener("click", () => {
    fromDate.value      = "";
    toDate.value        = "";
    domainFilter.value  = "";
    updateFilterTag();
    scheduleLiveSearch();
  });

  function getFilters() {
    return {
      fromDate: fromDate.value  || undefined,
      toDate:   toDate.value    || undefined,
      domain:   domainFilter.value.trim() || undefined
    };
  }

  // -- Export -------------------------------------------------------------
  exportBtn.addEventListener("click", async () => {
    statusText.textContent = "Exporting…";
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_DATA" });
    if (!response?.ok) {
      statusText.textContent = "Export failed — see console.";
      return;
    }

    const payload = JSON.stringify(
      { version: 2, exportedAt: new Date().toISOString(), pages: response.pages },
      null, 2
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    statusText.textContent = `Exported ${response.pages.length} page(s).`;
  });

  // -- Import -------------------------------------------------------------
  importBtn.addEventListener("click", () => {
    const input  = document.createElement("input");
    input.type   = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      statusText.textContent = "Importing…";
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        statusText.textContent = "Invalid file — could not parse JSON.";
        return;
      }

      if (!data.version || !Array.isArray(data.pages)) {
        statusText.textContent = "Invalid backup format.";
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "IMPORT_DATA",
        pages: data.pages
      });

      if (response?.ok) {
        statusText.textContent = `Imported ${response.count} page(s). Rebuilding index…`;
        await refreshStats();
        statusText.textContent = `Import complete — ${response.count} pages restored.`;
      } else {
        statusText.textContent = "Import failed — see console.";
      }
    };
    input.click();
  });

  // -- Render results -----------------------------------------------------
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderResults(results) {
    resultsBox.innerHTML = "";
    if (results.length === 0) {
      resultsBox.innerHTML = `<div class="empty">No relevant matches found. Try a different phrase, or browse a few more pages first.</div>`;
      return;
    }
    for (const r of results) {
      const item = document.createElement("a");
      item.className = "result";
      item.href      = r.url;
      item.target    = "_blank";
      item.innerHTML = `
        <div class="result-title">${escapeHtml(r.title || r.url)}</div>
        <div class="result-snippet">${escapeHtml(r.snippet)}</div>
        <div class="result-meta">
          <span class="result-score">${(r.score * 100).toFixed(0)}% match</span>
          <span class="result-domain">${escapeHtml(r.domain || "")}</span>
        </div>
      `;
      resultsBox.appendChild(item);
    }
  }

  // -- Search -------------------------------------------------------------
  let debounceTimer   = null;
  let searchRequestId = 0;

  async function runSearch(fromTyping = false) {
    const query = searchInput.value.trim();
    if (!query) { resultsBox.innerHTML = ""; statusText.textContent = "Ready."; return; }

    const thisRequestId = ++searchRequestId;

    if (!fromTyping) {
      searchBtn.disabled   = true;
      searchInput.disabled = true;
    }
    statusText.textContent = "Searching…";

    const response = await chrome.runtime.sendMessage({
      type:    "SEARCH_QUERY",
      query,
      filters: getFilters()
    });

    if (thisRequestId !== searchRequestId) return; // stale response

    if (!fromTyping) {
      searchBtn.disabled   = false;
      searchInput.disabled = false;
    }

    if (response?.ok) {
      renderResults(response.results);
      const filterNote = filtersAreActive() ? " (filtered)" : "";
      statusText.textContent = `Found ${response.results.length} match(es)${filterNote}.`;
    } else {
      statusText.textContent = "Search failed — see console for details.";
      console.error("[Recall/popup] Search failed:", response?.error);
    }
  }

  function scheduleLiveSearch() {
    clearTimeout(debounceTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) { resultsBox.innerHTML = ""; statusText.textContent = "Ready."; return; }
    statusText.textContent = "Typing…";
    debounceTimer = setTimeout(() => runSearch(true), 450);
  }

  searchBtn.addEventListener("click", () => runSearch(false));
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(debounceTimer); runSearch(false); }
  });
  searchInput.addEventListener("input", scheduleLiveSearch);

  // -- Init ---------------------------------------------------------------
  await refreshStats();
  await refreshExcludeButton();
  updateFilterTag();
});
