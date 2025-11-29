let selectMode = false;
let hoverOverlay = null;
let clickHandler = null;
let mouseOverHandler = null;

// Create a simple overlay to highlight elements
function createOverlay() {
  const div = document.createElement("div");
  div.style.position = "absolute";
  div.style.pointerEvents = "none";
  div.style.border = "2px dashed #00bcd4";
  div.style.zIndex = "999999";
  div.style.display = "none";
  document.body.appendChild(div);
  return div;
}

function getCssSelector(el) {
  if (el.id) {
    return `#${el.id}`;
  }
  const paths = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.className) {
      const classes = el.className
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .join(".");
      if (classes) selector += `.${classes}`;
    }
    const sibling = el;
    let nth = 1;
    while ((el = el.previousElementSibling)) {
      if (el.nodeName.toLowerCase() === sibling.nodeName.toLowerCase()) {
        nth++;
      }
    }
    selector += `:nth-of-type(${nth})`;
    paths.unshift(selector);
    el = sibling.parentElement;
  }
  return paths.join(" > ");
}

function enableSelectMode() {
  if (selectMode) return;
  selectMode = true;

  if (!hoverOverlay) hoverOverlay = createOverlay();

  mouseOverHandler = (e) => {
    if (!selectMode) return;
    const rect = e.target.getBoundingClientRect();
    hoverOverlay.style.left = `${window.scrollX + rect.left}px`;
    hoverOverlay.style.top = `${window.scrollY + rect.top}px`;
    hoverOverlay.style.width = `${rect.width}px`;
    hoverOverlay.style.height = `${rect.height}px`;
    hoverOverlay.style.display = "block";
  };

  clickHandler = (e) => {
    if (!selectMode) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    const selector = getCssSelector(target);
    const url = window.location.href;
    const text = target.innerText || target.value || "";

    const itemName = prompt(
      "Name this tracked item (e.g. Nike shoes price):",
      text.slice(0, 80)
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
      sampleText: text.slice(0, 200),
      createdAt: new Date().toISOString()
    };

    chrome.runtime.sendMessage(
      { type: "ADD_TRACKED_ITEM", payload: trackedItem },
      () => {
        // optional callback
      }
    );

    alert("Tracked item saved. You can view it in the extension popup.");
    disableSelectMode();
  };

  document.addEventListener("mouseover", mouseOverHandler, true);
  document.addEventListener("click", clickHandler, true);
}

function disableSelectMode() {
  selectMode = false;
  if (hoverOverlay) {
    hoverOverlay.style.display = "none";
  }
  if (mouseOverHandler) {
    document.removeEventListener("mouseover", mouseOverHandler, true);
    mouseOverHandler = null;
  }
  if (clickHandler) {
    document.removeEventListener("click", clickHandler, true);
    clickHandler = null;
  }
}

// Listen for messages from popup / background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_SELECT_MODE") {
    enableSelectMode();
    sendResponse({ ok: true });
  } else if (msg.type === "STOP_SELECT_MODE") {
    disableSelectMode();
    sendResponse({ ok: true });
  }
});
