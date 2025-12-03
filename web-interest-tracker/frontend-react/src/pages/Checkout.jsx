import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";

export function Checkout() {
  const [cartId, setCartId] = useState(null);
  const [carts, setCarts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCarts();
  }, []);

  useEffect(() => {
    if (cartId != null) {
      loadSummary(cartId);
    }
  }, [cartId]);

  async function loadCarts() {
    try {
      const data = await api.get("/cart");
      setCarts(data);
      if (data.length > 0) setCartId(data[0].id);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load carts");
    }
  }

  async function loadSummary(id) {
    try {
      const s = await api.get(`/cart/${id}/checkout-summary`);
      setSummary(s);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load checkout summary");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Checkout Summary</h2>
        <select
          value={cartId ?? ""}
          onChange={(e) =>
            setCartId(e.target.value ? Number(e.target.value) : null)
          }
        >
          {carts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `Cart #${c.id}`}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      {!summary ? (
        <div>Select a cart to view summary.</div>
      ) : (
        <CheckoutDetail summary={summary} />
      )}
    </div>
  );
}

function CheckoutDetail({ summary }) {
  const { merchants = [], totals } = summary;

  return (
    <div>
      <h3>Per-Merchant Breakdown</h3>
      {merchants.map((m) => (
        <div key={m.merchant} className="card">
          <h4>{m.merchant}</h4>
          <div>
            Subtotal: {formatPrice(m.subtotal)} · Shipping:{" "}
            {formatPrice(m.shipping)} · Tax: {formatPrice(m.tax)}
          </div>
          <div>Total: {formatPrice(m.total)}</div>
          <div className="muted">
            Savings on this merchant: {formatPrice(m.savings)}
          </div>
        </div>
      ))}

      <h3>Totals</h3>
      <div className="totals-row">
        <span>Subtotal: {formatPrice(totals.subtotal)}</span>
        <span>Shipping: {formatPrice(totals.shipping)}</span>
        <span>Tax: {formatPrice(totals.tax)}</span>
        <span>
          Total: <strong>{formatPrice(totals.total)}</strong>
        </span>
        <span>Savings: {formatPrice(totals.savings)}</span>
      </div>
    </div>
  );
}

function formatPrice(v) {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}
