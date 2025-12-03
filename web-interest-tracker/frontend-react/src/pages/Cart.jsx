import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";

export function Cart() {
  const [carts, setCarts] = useState([]);
  const [selectedCartId, setSelectedCartId] = useState(null);
  const [refreshData, setRefreshData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCarts();
  }, []);

  useEffect(() => {
    if (selectedCartId != null) {
      refreshCart(selectedCartId);
    }
  }, [selectedCartId]);

  async function loadCarts() {
    try {
      setLoading(true);
      const data = await api.get("/cart");
      setCarts(data);
      if (data.length > 0) setSelectedCartId(data[0].id);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load carts");
    } finally {
      setLoading(false);
    }
  }

  async function refreshCart(id) {
    try {
      const ref = await api.post(`/cart/${id}/refresh`, {});
      setRefreshData(ref);
    } catch (e) {
      setError(e.message || "Failed to refresh cart");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <h2>Cart</h2>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Cart</h2>
        <select
          value={selectedCartId ?? ""}
          onChange={(e) =>
            setSelectedCartId(
              e.target.value ? Number(e.target.value) : null
            )
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

      {selectedCartId == null ? (
        <div>No cart selected.</div>
      ) : !refreshData ? (
        <div>Refreshing cart...</div>
      ) : (
        <CartDetail data={refreshData} />
      )}
    </div>
  );
}

function CartDetail({ data }) {
  return (
    <div>
      <h3>{data.name || `Cart #${data.cartId}`}</h3>
      <div className="muted">
        Refreshed at {new Date(data.refreshedAt).toLocaleString()}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Domain</th>
            <th>Qty</th>
            <th>Added Price</th>
            <th>Current Price</th>
            <th>Savings</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.cartItemId}>
              <td>{it.name}</td>
              <td>{it.domain}</td>
              <td>{it.quantity}</td>
              <td>{formatPrice(it.addedPrice)}</td>
              <td>{formatPrice(it.lastPrice)}</td>
              <td>{formatPrice(it.cheaper ? it.addedPrice - it.lastPrice : 0)}</td>
              <td>{formatPrice(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals-row">
        <span>
          Subtotal: <strong>{formatPrice(data.totals?.grandTotal)}</strong>
        </span>
      </div>
    </div>
  );
}

function formatPrice(v) {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}
