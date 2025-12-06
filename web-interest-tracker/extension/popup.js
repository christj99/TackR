const API_BASE = "https://tackr-production.up.railway.app";

const selectBtn = document.getElementById("selectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const itemsDiv = document.getElementById("items");
const statusDiv = document.getElementById("status");

const aiUrlInput = document.getElementById("aiUrl");
const aiPromptInput = document.getElementById("aiPrompt");
const aiTrackBtn = document.getElementById("aiTrackBtn");
const aiTrackMultiBtn = document.getElementById("aiTrackMultiBtn");

function setStatus(msg) {
  if (!statusDiv) return;
  statusDiv.textContent = msg || "";
}

function renderItems(items) {
  itemsDiv.innerHTML = "";
  if (!items || items.length === 0) {
    itemsDiv.textContent = "No tracked items yet.";
    return;
  }

  for (const item of items) {
    const div = document.createElement("div");
    div.className = "item";

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = item.name;

    const urlEl = document.createElement("div");
    urlEl.className = "url";
    urlEl.textContent = item.url;

    const sampleEl = document.createElement("div");
    sampleEl.className = "sample";
    sampleEl.textContent = item.sampleText || "";

    div.appendChild(nameEl);
    div.appendChild(urlEl);
    div.appendChild(sampleEl);

    itemsDiv.appendChild(div);
  }
}

function loadItems() {
  console.log("[TackR popup] loading items from", `${API_BASE}/tracked-items`);
  fetch(`${API_BASE}/tracked-items`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((items) => {
      console.log("[TackR popup] items:", items);
      renderItems(items);
      setStatus("");
    })
    .catch((err) => {
      console.error("Failed to load tracked items:", err);
      itemsDiv.textContent = "Error loading items.";
      setStatus("Error loading items.");
    });
}

// Manual select: tell content script to start select mode
selectBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    console.log(
      "[TackR popup] sending START_SELECT_MODE to tab",
      tabs[0].id
    );
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "START_SELECT_MODE" },
      () => {}
    );
  });
});

// Refresh: ask background to refresh and reload list
refreshBtn.addEventListener("click", () => {
  setStatus("Refreshing in background...");
  refreshBtn.disabled = true;

  console.log("[TackR popup] sending MANUAL_REFRESH to background");

  chrome.runtime.sendMessage({ type: "MANUAL_REFRESH" }, (response) => {
    refreshBtn.disabled = false;

    if (chrome.runtime.lastError) {
      console.error(
        "MANUAL_REFRESH error:",
        chrome.runtime.lastError.message
      );
      setStatus("Refresh failed.");
      return;
    }

    if (!response || !response.ok) {
      console.error("MANUAL_REFRESH failed:", response);
      setStatus("Refresh failed.");
      return;
    }

    setStatus("Refreshed. Reloading items...");
    loadItems();
  });
});

// ---- AI helpers ----

function getCurrentTabUrlFallback(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return cb(null);
    cb(tabs[0].url || null);
  });
}

// AI Track (single)
aiTrackBtn.addEventListener("click", () => {
  const prompt = aiPromptInput.value.trim();
  const manualUrl = aiUrlInput.value.trim();

  if (!prompt) {
    setStatus("AI prompt is required.");
    return;
  }

  const proceed = (url) => {
    if (!url) {
      setStatus("No URL provided and cannot detect current tab URL.");
      return;
    }

    const payload = {
      prompt,
      profile: "ecommerce_price",
      urls: [url]
    };

    console.log("[TackR popup] AI single payload:", payload);

    setStatus("AI tracking (single)...");
    fetch(`${API_BASE}/agent/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        const text = await res.text();
        console.log(
          "[TackR popup] /agent/track response:",
          res.status,
          text
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
        return JSON.parse(text);
      })
      .then((data) => {
        console.log("[TackR popup] AI track result:", data);
        setStatus("AI track complete. Reloading items...");
        loadItems();
      })
      .catch((err) => {
        console.error("AI track error:", err);
        setStatus("AI track failed: " + err.message);
      });
  };

  if (manualUrl) {
    proceed(manualUrl);
  } else {
    getCurrentTabUrlFallback(proceed);
  }
});

// AI Track (multi)
aiTrackMultiBtn.addEventListener("click", () => {
  const prompt = aiPromptInput.value.trim();
  const manualUrl = aiUrlInput.value.trim();

  if (!prompt) {
    setStatus("AI prompt is required.");
    return;
  }

  const proceed = (url) => {
    if (!url) {
      setStatus("No URL provided and cannot detect current tab URL.");
      return;
    }

    const payload = {
      prompt,
      profile: "ecommerce_price",
      url
    };

    console.log("[TackR popup] AI multi payload:", payload);

    setStatus("AI tracking (multi)...");
    fetch(`${API_BASE}/agent/track-multi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        const text = await res.text();
        console.log(
          "[TackR popup] /agent/track-multi response:",
          res.status,
          text
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
        return JSON.parse(text);
      })
      .then((data) => {
        console.log("[TackR popup] AI track-multi result:", data);
        setStatus("AI multi-track complete. Reloading items...");
        loadItems();
      })
      .catch((err) => {
        console.error("AI track-multi error:", err);
        setStatus("AI multi-track failed: " + err.message);
      });
  };

  if (manualUrl) {
    proceed(manualUrl);
  } else {
    getCurrentTabUrlFallback(proceed);
  }
});

document.addEventListener("DOMContentLoaded", loadItems);
