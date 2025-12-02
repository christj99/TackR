const API_BASE = "http://localhost:4000";


// On install, set up periodic refresh
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tackr-refresh", { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tackr-refresh") {
    refreshTrackedItems();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ADD_TRACKED_ITEM") {
    const item = msg.payload;

    fetch(`${API_BASE}/tracked-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.name,
        url: item.url,
        selector: item.selector,
        sampleText: item.sampleText,
        initialValueRaw: item.initialValueRaw,
        initialValueNumeric: item.initialValueNumeric,
        fingerprint: item.fingerprint
      })
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error("API error:", res.status, text);
          sendResponse({
            ok: false,
            error: "api_error",
            status: res.status
          });
          return;
        }
        const data = await res.json();
        console.log("Saved to backend:", data);
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        console.error("Network error:", err);
        sendResponse({ ok: false, error: "network_error" });
      });

    return true;
  }

  if (msg.type === "MANUAL_REFRESH") {
    refreshTrackedItems().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ---------- Offscreen helper ----------

async function ensureOffscreenDoc() {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Scrape HTML for TackR tracking"
  });
}

async function scrapeItemOffscreen(item) {
  try {
    await ensureOffscreenDoc();
  } catch (e) {
    console.error("ensureOffscreenDoc error", e);
    return "";
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "OFFSCREEN_SCRAPE",
        url: item.url,
        selector: item.selector
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "OFFSCREEN_SCRAPE error:",
            chrome.runtime.lastError.message
          );
          resolve("");
          return;
        }
        resolve(response?.valueRaw || "");
      }
    );
  });
}

// ---------- Hidden-tab fallback ----------

async function scrapeItemInBrowser(item) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: item.url, active: false }, (tab) => {
      if (!tab || !tab.id) {
        console.error("Failed to create tab for", item.url);
        resolve("");
        return;
      }

      const tabId = tab.id;

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);

          chrome.scripting.executeScript(
            {
              target: { tabId },
              func: scrapeInPage,
              args: [item.selector]
            },
            (results) => {
              if (chrome.runtime.lastError) {
                console.error(
                  "scripting error:",
                  chrome.runtime.lastError.message
                );
                cleanupTab(tabId, () => resolve(""));
                return;
              }

              const [result] = results || [];
              const valueRaw = result?.result || "";

              if (!valueRaw) {
                console.log(
                  `No text found for item ${item.id} on ${item.url}`
                );
                cleanupTab(tabId, () => resolve(""));
                return;
              }

              console.log(
                `Scraped value in browser for item ${item.id}: "${valueRaw}"`
              );
              cleanupTab(tabId, () => resolve(valueRaw));
            }
          );
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// runs inside the page context (tab)
function scrapeInPage(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return "";
    const text = el.innerText || el.textContent || "";
    return text.trim();
  } catch (e) {
    return "";
  }
}

function cleanupTab(tabId, done) {
  chrome.tabs.remove(tabId, () => done());
}


// ---------- Refresh pipeline ----------

async function refreshTrackedItems() {
  try {
    const res = await fetch(`${API_BASE}/tracked-items`);
    if (!res.ok) {
      console.error("Failed to load tracked items", res.status);
      return;
    }
    const items = await res.json();
    console.log(`Refreshing ${items.length} tracked items`);

    const slice = items.slice(0, 5); // adjust batch size as you like

    for (const item of slice) {
      let valueRaw = await scrapeItemOffscreen(item);
      if (!valueRaw) {
        console.log(
          `Offscreen scrape empty for item ${item.id}, falling back to browser`
        );
        valueRaw = await scrapeItemInBrowser(item);
      }

      if (!valueRaw) {
        console.log(
          `No value captured for item ${item.id} after offscreen+browser`
        );

        try {
          const failRes = await fetch(
            `${API_BASE}/tracked-items/${item.id}/failure`,
            { method: "POST" }
          );
          const failText = await failRes.text();
          console.log(
            `[TackR] failure response for item ${item.id}:`,
            failRes.status,
            failText
          );

          if (failRes.ok) {
            const failData = JSON.parse(failText);
            if (failData.shouldRepair) {
              console.log(
                `[TackR] Item ${item.id} reached failure threshold, triggering auto-repair`
              );
              try {
                const repRes = await fetch(
                  `${API_BASE}/tracked-items/${item.id}/repair-selector`,
                  { method: "POST" }
                );
                const repText = await repRes.text();
                console.log(
                  `[TackR] repair-selector response for ${item.id}:`,
                  repRes.status,
                  repText
                );
              } catch (e) {
                console.error(
                  `[TackR] repair-selector call failed for item ${item.id}`,
                  e
                );
              }
            }
          }
        } catch (e) {
          console.error(
            `[TackR] failure reporting failed for item ${item.id}`,
            e
          );
        }

        continue; // move to next item
      }

      // SUCCESS
      try {
        await fetch(`${API_BASE}/tracked-items/${item.id}/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valueRaw })
        });
      } catch (e) {
        console.error("Failed to send snapshot", e);
      }
    }
  } catch (err) {
    console.error("refreshTrackedItems error", err);
  }
}

