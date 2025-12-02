// backend/public/dashboard.js

const API_BASE = "http://localhost:4000";

const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const statusFilter = document.getElementById("statusFilter");
const itemsTableBody = document.getElementById("itemsTableBody");
const statusText = document.getElementById("statusText");
const summaryText = document.getElementById("summaryText");
const refreshBtn = document.getElementById("refreshBtn");
const reloadBtn = document.getElementById("reloadBtn");

let allItems = [];
let lastLoadedAt = null;

async function fetchItems() {
  // Try summary endpoint first; fall back to raw /tracked-items
  try {
    const res = await fetch(`${API_BASE}/tracked-items/summary/all`);
    if (res.ok) {
      const data = await res.json();
      return data.items || data; // adjust if your shape is slightly different
    }
  } catch (e) {
    console.warn("summary/all failed, falling back to /tracked-items", e);
  }

  const res = await fetch(`${API_BASE}/tracked-items`);
  const items = await res.json();
  // Normalize a bit
  return items.map((it) => ({
    id: it.id,
    name: it.name,
    url: it.url,
    type: it.type,
    latestSnapshot: null,
    latestValueRaw: null,
    latestValueNumeric: null,
    status: null,
    lastCheckedAt: null,
    triggersTotal: 0,
    triggersFired: 0
  }));
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function makeTypeBadge(type) {
  const span = document.createElement("span");
  span.classList.add("badge");
  if (type === "price") {
    span.classList.add("badge-type-price");
    span.textContent = "Price";
  } else if (type === "number") {
    span.classList.add("badge-type-number");
    span.textContent = "Number";
  } else {
    span.classList.add("badge-type-text");
    span.textContent = "Text";
  }
  return span;
}

function makeStatusBadge(status) {
  const span = document.createElement("span");
  span.classList.add("badge");
  if (status === "ok" || !status) {
    span.classList.add("badge-status-ok");
    span.textContent = "OK";
  } else if (status === "missing") {
    span.classList.add("badge-status-missing");
    span.textContent = "Missing";
  } else {
    span.classList.add("badge-status-error");
    span.textContent = "Error";
  }
  return span;
}

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;
  const status = statusFilter.value;

  return allItems.filter((item) => {
    if (q) {
      const haystack =
        (item.name || "") +
        " " +
        (item.url || "");
      if (!haystack.toLowerCase().includes(q)) return false;
    }

    if (type && item.type !== type) return false;
    if (status && item.status !== status) return false;

    return true;
  });
}

function render() {
  const filtered = applyFilters();

  itemsTableBody.innerHTML = "";

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "No items match your filters.";
    tr.appendChild(td);
    itemsTableBody.appendChild(tr);
  } else {
    for (const item of filtered) {
      const tr = document.createElement("tr");

      // Item col
      const tdItem = document.createElement("td");
      const nameDiv = document.createElement("div");
      nameDiv.className = "name";
      nameDiv.textContent = item.name || `(ID ${item.id})`;

      const urlDiv = document.createElement("div");
      urlDiv.className = "url";
      urlDiv.textContent = item.url;

      tdItem.appendChild(nameDiv);
      tdItem.appendChild(urlDiv);

      // Latest Value
      const tdValue = document.createElement("td");
      const main = document.createElement("div");
      main.className = "value-main";
      main.textContent =
        item.latestValueRaw ||
        item.latestValueNumeric?.toString() ||
        "—";

      const sub = document.createElement("div");
      sub.className = "value-sub";
      if (
        item.latestValueNumeric != null &&
        item.latestValueRaw &&
        item.latestValueRaw !==
          String(item.latestValueNumeric)
      ) {
        sub.textContent = `Parsed: ${item.latestValueNumeric}`;
      } else {
        sub.textContent = "";
      }

      tdValue.appendChild(main);
      if (sub.textContent) tdValue.appendChild(sub);

      // Type / Status
      const tdTypeStatus = document.createElement("td");
      const typeBadge = makeTypeBadge(item.type || "text");
      const statusBadge = makeStatusBadge(
        item.status || "ok"
      );
      tdTypeStatus.appendChild(typeBadge);
      tdTypeStatus.appendChild(
        document.createTextNode(" ")
      );
      tdTypeStatus.appendChild(statusBadge);

      // Triggers
      const tdTriggers = document.createElement("td");
      const trigDiv = document.createElement("div");
      trigDiv.className = "trigger-pill";
      trigDiv.textContent = `${item.triggersFired ?? 0}/${
        item.triggersTotal ?? 0
      } fired`;
      tdTriggers.appendChild(trigDiv);

      // Last checked
      const tdLast = document.createElement("td");
      tdLast.textContent = formatDateTime(
        item.lastCheckedAt
      );

      tr.appendChild(tdItem);
      tr.appendChild(tdValue);
      tr.appendChild(tdTypeStatus);
      tr.appendChild(tdTriggers);
      tr.appendChild(tdLast);

      itemsTableBody.appendChild(tr);
    }
  }

  // Summary
  const total = allItems.length;
  const ok = allItems.filter(
    (i) => !i.status || i.status === "ok"
  ).length;
  const missing = allItems.filter(
    (i) => i.status === "missing"
  ).length;
  const err = allItems.filter(
    (i) => i.status === "error"
  ).length;

  summaryText.textContent =
    total === 0
      ? "No tracked items yet."
      : `${total} tracked • ${ok} OK • ${missing} missing • ${err} error`;

  if (lastLoadedAt) {
    statusText.textContent =
      "Last loaded " + formatDateTime(lastLoadedAt.toISOString());
  }
}

async function loadFromApi() {
  itemsTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="muted">Loading...</td>
    </tr>
  `;
  statusText.textContent = "Loading from API...";

  try {
    const items = await fetchItems();
    // Expect summary shape items: { id, name, url, type, latestValueRaw, latestValueNumeric, status, lastCheckedAt, triggersTotal, triggersFired }
    allItems = items.map((i) => ({
      id: i.id,
      name: i.name,
      url: i.url,
      type: i.type,
      latestValueRaw:
        i.latestValueRaw ??
        i.latestSnapshot?.valueRaw ??
        null,
      latestValueNumeric:
        i.latestValueNumeric ??
        i.latestSnapshot?.valueNumeric ??
        null,
      status:
        i.status ??
        i.latestSnapshot?.status ??
        "ok",
      lastCheckedAt:
        i.lastCheckedAt ??
        i.latestSnapshot?.takenAt ??
        null,
      triggersTotal: i.triggersTotal ?? 0,
      triggersFired: i.triggersFired ?? 0
    }));

    lastLoadedAt = new Date();
    render();
  } catch (e) {
    console.error("Failed to load items", e);
    itemsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">Error loading items from API.</td>
      </tr>
    `;
    statusText.textContent = "Error loading items";
  }
}

// Wire up filters
searchInput.addEventListener("input", () => render());
typeFilter.addEventListener("change", () => render());
statusFilter.addEventListener("change", () => render());

// "Reload from API" just re-fetches data
reloadBtn.addEventListener("click", () => {
  loadFromApi();
});

// "Refresh now" – for now this just reloads data;
// if you later create a backend refresh endpoint, you can call it here first.
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  statusText.textContent = "Refreshing...";
  try {
    // If you introduce a backend trigger later, call it here:
    // await fetch(`${API_BASE}/refresh`, { method: "POST" });
    await loadFromApi();
  } finally {
    refreshBtn.disabled = false;
  }
});

// Initial load
loadFromApi();
