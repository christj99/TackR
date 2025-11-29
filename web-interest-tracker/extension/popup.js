const selectBtn = document.getElementById("selectBtn");
const itemsDiv = document.getElementById("items");

function renderItems(items) {
  itemsDiv.innerHTML = "";
  if (!items || items.length === 0) {
    itemsDiv.textContent = "No tracked items yet.";
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "item";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = item.url;

    const sample = document.createElement("div");
    sample.className = "sample";
    sample.textContent = item.sampleText || "";

    div.appendChild(name);
    div.appendChild(url);
    div.appendChild(sample);

    itemsDiv.appendChild(div);
  });
}

function loadItems() {
  fetch("http://localhost:4000/tracked-items")
    .then((res) => res.json())
    .then((items) => {
      renderItems(items);
    })
    .catch((err) => {
      console.error("Failed to load tracked items:", err);
      itemsDiv.textContent = "Error loading items.";
    });
}

selectBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "START_SELECT_MODE" },
      (response) => {
        // optional
      }
    );
  });
});

document.addEventListener("DOMContentLoaded", loadItems);
