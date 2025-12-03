import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";

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
          <div className="muted">No recommendations yet.</div>
        ) : (
          <div className="card-list">
            {recommendedItems.map((item) => (
              <div key={item.id} className="card">
                <h3>{item.name}</h3>
                <div className="muted">{item.domain}</div>
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
