import React, { useState } from "react";
import { api } from "../api/client.js";

const DEFAULT_SITES = [
  "https://shop.lululemon.com/",
  "https://www.nike.com/"
];

export function PromptTrack() {
  const [instruction, setInstruction] = useState("");
  const [sitesText, setSitesText] = useState(DEFAULT_SITES.join("\n"));
  const [profile, setProfile] = useState("ecommerce_price");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!instruction.trim()) return;

    const startUrls = sitesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    setLoading(true);
    setError("");
    try {
      const data = await api.post("/agent/prompt-multihop", {
        instruction: instruction.trim(),
        startUrls,
        profile
      });
      setResults(data);
    } catch (e) {
      setError(e.message || "Failed to run prompt tracking");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h2>Track via Prompt</h2>

      <form className="prompt-form" onSubmit={handleSubmit}>
        <label>
          Instruction
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Find the mens License to Train Jogger and track its price, rating, and number of reviews."
          />
        </label>

        <label>
          Start URLs (one per line)
          <textarea
            value={sitesText}
            onChange={(e) => setSitesText(e.target.value)}
          />
        </label>

        <label>
          Profile
          <input
            type="text"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Running..." : "Run Agent"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {results && (
        <div className="results">
          <h3>Results</h3>
          <div className="muted">
            Instruction: {results.instruction}
          </div>
          {results.results?.map((r) => (
            <div key={r.startUrl} className="card">
              <h4>{r.startUrl}</h4>
              <div>Status: {r.status}</div>
              {r.productUrl && (
                <div className="muted">
                  Product URL: {r.productUrl}
                </div>
              )}
              {Array.isArray(r.items) && r.items.length > 0 && (
                <ul>
                  {r.items.map((it) => (
                    <li key={it.itemId}>
                      {it.name} (type: {it.type}) – item #{it.itemId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
