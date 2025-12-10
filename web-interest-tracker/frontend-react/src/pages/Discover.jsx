import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Sparkline } from "../components/Sparkline.jsx";


export function Discover() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadDiscover();
  }, []);

  async function loadDiscover() {
    try {
      setLoading(true);
      const d = await api.get("/discover");
      setData(d);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load Discover");
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



  if (loading) {
    return (
      <div className="page">
        <h2>Discover</h2>
        <div>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h2>Discover</h2>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <h2>Discover</h2>
        <div>No data.</div>
      </div>
    );
  }

  const { trendingDomains = [], topProfiles = [], recommendedItems = [] } = data;

  return (
    <div className="page">
      <h2>Discover</h2>

      <section>
        <h3>Trending Domains</h3>
        <div className="pill-row">
          {trendingDomains.map((d) => (
            <div key={d.domain} className="pill">
              <div className="pill-title">{d.domain}</div>
              <div className="pill-sub">
                {d.itemCount} items · {d.snapshotCount} snapshots
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Top Profiles</h3>
        <div className="pill-row">
          {topProfiles.map((p) => (
            <div key={p.profile} className="pill">
              <div className="pill-title">{p.profile}</div>
              <div className="pill-sub">
                {p.itemCount} items
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Worth Pinning</h3>
        {recommendedItems.length === 0 ? (
          <div>No strong recommendations yet.</div>
        ) : (
          <div className="card-list">
            {recommendedItems.map((item) => (
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

              {/* Mini sparkline */}
              {item.sparkline?.points && item.sparkline.points.length >= 2 && (
                <Sparkline points={item.sparkline.points} />
              )}


                {/* P: Add to Cart from Discover */}
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
      </section>
    </div>
  );
}
