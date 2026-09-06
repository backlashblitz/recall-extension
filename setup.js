// setup.js — First-time onboarding page script.
// Triggers model warm-up and displays live download progress.

const stateLoading  = document.getElementById("stateLoading");
const stateReady    = document.getElementById("stateReady");
const progressFill  = document.getElementById("progressFill");
const progressFile  = document.getElementById("progressFile");
const progressPct   = document.getElementById("progressPct");
const closeBtn      = document.getElementById("closeBtn");

closeBtn.addEventListener("click", () => window.close());

// Track per-file progress and average them for the overall bar
const fileProgress = new Map();

function updateProgressBar() {
  if (fileProgress.size === 0) return;
  let total = 0;
  for (const p of fileProgress.values()) total += p;
  const avg = Math.round(total / fileProgress.size);
  progressFill.style.width = `${avg}%`;
  progressPct.textContent  = `${avg} %`;
}

function showReady() {
  stateLoading.classList.add("hidden");
  stateReady.classList.remove("hidden");
}

// Listen for progress events broadcast by offscreen.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "MODEL_DOWNLOAD_PROGRESS") {
    const { file, progress, status } = message;

    if (file) {
      // Show just the filename, not the full path
      const shortName = file.split("/").pop();
      progressFile.textContent = shortName;

      if (status === "progress" && typeof progress === "number") {
        fileProgress.set(file, progress);
        updateProgressBar();
      } else if (status === "done") {
        fileProgress.set(file, 100);
        updateProgressBar();
      }
    }
  }

  if (message.type === "MODEL_READY") {
    // Ensure bar reaches 100% visually before switching state
    progressFill.style.width = "100%";
    progressPct.textContent  = "100 %";
    setTimeout(showReady, 400);
  }
});

// Kick off model loading via background.js (which opens the offscreen doc and
// runs a warm-up embed — progress events will flow back here automatically).
chrome.runtime.sendMessage({ type: "WARM_UP_MODEL" }).catch(() => {
  // Background SW may not be ready yet — retry once after a short delay.
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "WARM_UP_MODEL" }).catch(() => {});
  }, 1000);
});
