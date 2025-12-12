import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Sparkline } from "../components/Sparkline.jsx";


export function ForYou() {
  const [items, setItems] = useState([]);
  const [windowDays, setWindowDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadForYou();
  }, []);
  
  function buildWhyExplanation(item, primaryDomain, primaryProfile) {
    const domain = item.domain;
    const profile = item.profile;
    const metrics = item.metrics || {};
    const deltaPct = metrics.deltaPct;
    const changeCount = metrics.changeCount;
    const snapshotCount = metrics.snapshotCount;

    const reasons = [];

    if (primaryDomain && domain === primaryDomain) {
      reasons.push(`you track a lot from ${primaryDomain}`);
    }

    if (primaryProfile && profile === primaryProfile) {
      const prettyProfile =
        primaryProfile === "ecommerce_price"
          ? "price changes"
          : primaryProfile;
      reasons.push(
        `it's the kind of metric you track most (${prettyProfile})`
      );
    }

    if (deltaPct != null && Math.abs(deltaPct) >= 0.05) {
      const dir = deltaPct > 0 ? "up" : "down";
      const pct = Math.abs(deltaPct * 100).toFixed(1);
      reasons.push(`its value moved ${dir} about ${pct}% recently`);
    }

    if (!reasons.length && snapshotCount >= 5 && changeCount >= 2) {
      reasons.push("it has been moving more than usual recently");
    }

    if (!reasons.length) {
      return "Because it looks interesting based on recent changes.";
    }

    if (reasons.length === 1) {
      return "Because " + reasons[0] + ".";
    }
    if (reasons.length === 2) {
      return "Because " + reasons[0] + " and " + reasons[1] + ".";
    }

    return (
      "Because " +
      reasons[0] +
      ", " +
      reasons[1] +
      " and " +
      reasons[2] +
      "."
    );
  }
  

  async function loadForYou() {
    try {
      setLoading(true);

      const data = await api.get("/discover");
      const recommended = data.recommendedItems || [];
      const trendingDomains = data.trendingDomains || [];
      const topProfiles = data.topProfiles || [];

      const primaryDomain = trendingDomains[0]?.domain || null;
      const primaryProfile = topProfiles[0]?.profile || null;

      const scored = recommended
        .map((item) => {
          const baseScore = item.metrics?.score ?? 0;
          let boost = 0;

          if (primaryDomain && item.domain === primaryDomain) {
            boost += 0.15;
          }

          if (primaryProfile && item.profile === primaryProfile) {
            boost += 0.15;
          }

          const why = buildWhyExplanation(
            item,
            primaryDomain,
            primaryProfile
          );

          return {
            ...item,
            _forYouScore: baseScore + boost,
            _why: why,
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

              {item._why && (
                <div
                  className="muted"
                  style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}
                >
                  {item._why}
                </div>
              )}

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
