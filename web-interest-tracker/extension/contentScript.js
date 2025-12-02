console.log("[TackR] contentScript loaded on", window.location.href);

let selectMode = false;
let highlightEl = null;

function parseNumericFromText(text) {
  const match = text.replace(/\s+/g, " ").match(/-?\d[\d,]*(\.\d+)?/);
  if (!match) return null;
  const cleaned = match[0].replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isNaN(value) ? null : value;
}

function getCssSelector(el) {
  if (el.id) return `#${el.id}`;

  const parts = [];
  let current = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();

    if (current.className) {
      const classes = current.className
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".");
      if (classes) selector += `.${classes}`;
    }

    let nth = 1;
    let sib = current;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName.toLowerCase() === current.tagName.toLowerCase()) {
        nth++;
      }
    }
    selector += `:nth-of-type(${nth})`;

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function getNthOfType(el) {
  if (!el.parentElement) return null;
  let nth = 1;
  let sibling = el;
  while ((sibling = sibling.previousElementSibling)) {
    if (sibling.tagName.toLowerCase() === el.tagName.toLowerCase()) {
      nth++;
    }
  }
  return nth;
}

function buildNodeDescriptor(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : "div";
  const classList = Array.from(el.classList || []);
  return {
    tag,
    classes: classList.slice(0, 3),
    nthOfType: getNthOfType(el)
  };
}

function buildFingerprint(el) {
  const path = [];
  let current = el;
  let depth = 0;

  while (
    current &&
    current.nodeType === Node.ELEMENT_NODE &&
    current !== document.body &&
    depth < 10
  ) {
    path.unshift(buildNodeDescriptor(current));
    current = current.parentElement;
    depth++;
  }

  if (current === document.body) {
    path.unshift(buildNodeDescriptor(current));
  }

  return { path };
}

function enableSelectMode() {
  if (selectMode) return;
  selectMode = true;
  console.log("[TackR] Select mode ENABLED");
  alert("TackR: select mode ON. Hover and click an element to track.");
  document.addEventListener("mouseover", hoverHandler, true);
  document.addEventListener("mouseout", hoverOutHandler, true);
  document.addEventListener("click", clickHandler, true);
}

function disableSelectMode() {
  selectMode = false;
  console.log("[TackR] Select mode DISABLED");
  if (highlightEl) {
    highlightEl.style.outline = "";
    highlightEl = null;
  }
  document.removeEventListener("mouseover", hoverHandler, true);
  document.removeEventListener("mouseout", hoverOutHandler, true);
  document.removeEventListener("click", clickHandler, true);
}

function hoverHandler(e) {
  if (!selectMode) return;
  const target = e.target;
  if (highlightEl && highlightEl !== target) {
    highlightEl.style.outline = "";
  }
  highlightEl = target;
  highlightEl.style.outline = "2px solid red";
  e.stopPropagation();
}

function hoverOutHandler(e) {
  if (!selectMode) return;
  if (e.target === highlightEl) {
    highlightEl.style.outline = "";
    highlightEl = null;
  }
  e.stopPropagation();
}

function clickHandler(e) {
  if (!selectMode) return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target;
  console.log("[TackR] Clicked element for tracking", target);

  const selector = getCssSelector(target);
  const url = window.location.href;
  const text = target.innerText || target.value || "";
  const sample = text.slice(0, 200);
  const numeric = parseNumericFromText(sample);
  const fingerprint = buildFingerprint(target);

  const itemName = prompt(
    "Name this tracked item (e.g. Nike shoes price):",
    sample.slice(0, 80)
  );
  if (!itemName) {
    disableSelectMode();
    return;
  }

  const trackedItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: itemName,
    url,
    selector,
    sampleText: sample,
    initialValueRaw: sample,
    initialValueNumeric: numeric,
    fingerprint,
    createdAt: new Date().toISOString()
  };

  console.log("[TackR] Sending ADD_TRACKED_ITEM", trackedItem);

  chrome.runtime.sendMessage(
    { type: "ADD_TRACKED_ITEM", payload: trackedItem },
    () => {}
  );

  alert("Tracked item saved. You can view it in the extension popup.");
  disableSelectMode();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[TackR] contentScript got message", msg);
  if (msg.type === "START_SELECT_MODE") {
    enableSelectMode();
    sendResponse({ ok: true });
  }
});
