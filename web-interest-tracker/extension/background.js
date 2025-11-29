// background.js (MV3, type: module if you want ES modules)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ADD_TRACKED_ITEM") {
    const item = msg.payload;

    fetch("http://localhost:4000/tracked-items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: item.name,
        url: item.url,
        selector: item.selector,
        sampleText: item.sampleText
      })
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error("API error:", res.status, text);
          sendResponse({ ok: false, error: "api_error", status: res.status });
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

    // keep the message channel open
    return true;
  }
});

