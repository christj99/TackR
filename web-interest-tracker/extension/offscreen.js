chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_SCRAPE") {
    const { url, selector } = msg;
    scrapeStaticHtml(url, selector)
      .then((valueRaw) => sendResponse({ valueRaw }))
      .catch((err) => {
        console.error("OFFSCREEN_SCRAPE error:", err);
        sendResponse({ valueRaw: "" });
      });
    return true;
  }
});

async function scrapeStaticHtml(url, selector) {
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) return "";
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const el = doc.querySelector(selector);
    if (!el) return "";
    const text = el.textContent || "";
    return text.trim();
  } catch (e) {
    console.error("scrapeStaticHtml error", e);
    return "";
  }
}
