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
      // Use discover's recommendedItems as the "For You" feed
      const data = await api.get("/discover");
      setItems(data.recommendedItems || []);
      setWindowDays(data.windowDays || 7);
      setError("");
    } catch (e) {
      console.error("Failed to load For You items:", e);
      setError(e.message || "Failed to load For You items");
    } finally {
      setLoading(false);
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
