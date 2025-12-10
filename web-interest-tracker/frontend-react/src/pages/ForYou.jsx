import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";

export function ForYou() {
  const [items, setItems] = useState([]);
  const [windowDays, setWindowDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadForYou();
  }, []);

  async function loadForYou() {
    try {
      setLoading(true);

      // Use /discover as the source of truth
      const data = await api.get("/discover");
      const recommended = data.recommendedItems || [];
      const trendingDomains = data.trendingDomains || [];
      const topProfiles = data.topProfiles || [];

      const primaryDomain = trendingDomains[0]?.domain || null;
      const primaryProfile = topProfiles[0]?.profile || null;

      // Re-rank items specifically for "For You"
      const scored = recommended
        .map((item) => {
          const baseScore = item.metrics?.score ?? 0;
          let boost = 0;

          // Small boost if this item is on your top domain
          if (primaryDomain && item.domain === primaryDomain) {
            boost += 0.15;
          }

          // Small boost if this item matches your top profile
          if (primaryProfile && item.profile === primaryProfile) {
            boost += 0.15;
          }

          return {
            ...item,
            _forYouScore: baseScore + boost,
          };
        })
        .sort(
          (a, b) => (b._forYouScore ?? 0) - (a._forYouScore ?? 0)
        );

      setItems(scored);
      setWindowDays(data.windowDays || 7);
      setError("");
    } catch (e) {
      console.error(e);
      setError(e.message || "Failed to load For You items");
    } finally {
      setLoading(false);
    }
  }

  
  async function handleAddToCart(trackedItemId) {
    try {
      setError("");

      let carts = await api.get("/cart");
      let cartId = carts[0]?.id;

      if (!cartId) {
        const cart = await api.post("/cart", { name: "My Cart" });
        cartId = cart.id;
      }

      await api.post(`/cart/${cartId}/items`, { trackedItemId });

      // notify App.jsx
      if (onCartUpdated) onCartUpdated();

    } catch (e) {
      console.error(e);
      setError("Failed to add item to cart");
    }
  }



  return (
    <div className="page">
      <div className="page-header">
        <h2>For You</h2>
        <span className="muted">
          Based on last {windowDays} days of activity
        </span>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div>Loading...</div>
      ) : items.length === 0 ? (
        <div>No interesting items yet. Start tracking things!</div>
      ) : (
        <div className="card-list">
          {items.map((item) => (
            <div key={item.id} className="card">
              <h3>{item.name}</h3>
              <div className="muted">{item.url}</div>
              <div className="metric-row">
                <span>
                  Latest:{" "}
                  <strong>{item.latestSnapshot?.valueRaw ?? "—"}</strong>
                </span>
                {item.metrics.deltaPct != null && (
                  <span
                    className={
                      "chip " +
                      (item.metrics.deltaPct < 0
                        ? "chip-down"
                        : "chip-up")
                    }
                  >
                    {(item.metrics.deltaPct * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="muted">
                {item.metrics.changeCount} changes ·{" "}
                {item.metrics.snapshotCount} snapshots
              </div>

              {/* P: Add to Cart from For You */}
              <button
                type="button"
                onClick={() => handleAddToCart(item.id)}
                style={{ marginTop: "0.5rem" }}
              >
                Add to Cart
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
