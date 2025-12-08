import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";

export function Boards({ selectedBoardId, onSelectBoard }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [boardDetail, setBoardDetail] = useState(null);

  useEffect(() => {
    loadBoards();
  }, []);

  useEffect(() => {
    if (selectedBoardId != null) {
      loadBoardDetail(selectedBoardId);
    } else {
      setBoardDetail(null);
    }
  }, [selectedBoardId]);

  async function loadBoards() {
    try {
      setLoading(true);
      const data = await api.get("/boards");
      setBoards(data);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load boards");
    } finally {
      setLoading(false);
    }
  }

  async function loadBoardDetail(id) {
    try {
      const data = await api.get(`/boards/${id}`);
      setBoardDetail(data);
    } catch (e) {
      setError(e.message || "Failed to load board");
    }
  }

  async function handleCreateBoard(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post("/boards", {
        name: newName.trim()
      });
      setBoards([created, ...boards]);
      setNewName("");
      onSelectBoard(created.id);
    } catch (e) {
      setError(e.message || "Failed to create board");
    } finally {
      setCreating(false);
    }
  }

  async function handleRemoveItem(boardId, trackedItemId) {
    try {
      await api.del(`/boards/${boardId}/items/${trackedItemId}`);
      // Refresh detail + sidebar counts
      await loadBoardDetail(boardId);
      await loadBoards();
    } catch (e) {
      setError(e.message || "Failed to remove item from board");
    }
  }

  async function handleAddItemToBoard(boardId, trackedItemId) {
    try {
      await api.post(`/boards/${boardId}/items`, { trackedItemId });
      // Refresh detail + sidebar counts (in case we’re viewing the target board)
      await loadBoardDetail(boardId);
      await loadBoards();
    } catch (e) {
      setError(e.message || "Failed to add item to board");
    }
  }

  async function handleAddToCart(trackedItemId) {
    try {
      setError("");

      // 1) Get existing carts
      let carts = [];
      try {
        carts = await api.get("/cart");
      } catch (e) {
        // if this fails, we’ll just try to create a new cart
        console.error("Failed to load carts when adding to cart:", e);
      }

      let cartId = carts[0]?.id;

      // 2) If no cart yet, create a default one
      if (!cartId) {
        const cart = await api.post("/cart", { name: "My Cart" });
        cartId = cart.id;
      }

      // 3) Add this tracked item to the cart
      await api.post(`/cart/${cartId}/items`, { trackedItemId });

      // (Optional) you could set some “added” UI state here later
    } catch (e) {
      console.error("Failed to add item to cart:", e);
      setError(e.message || "Failed to add item to cart");
    }
  }


  return (
    <div className="page">
      <div className="page-header">
        <h2>Boards</h2>
        <form className="inline-form" onSubmit={handleCreateBoard}>
          <input
            type="text"
            placeholder="New board name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" disabled={creating}>
            + Create
          </button>
        </form>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="board-layout">
        <div className="board-list">
          {loading ? (
            <div>Loading boards...</div>
          ) : (
            boards.map((b) => (
              <div
                key={b.id}
                className={
                  "board-card" +
                  (selectedBoardId === b.id ? " board-card-active" : "")
                }
                onClick={() => onSelectBoard(b.id)}
              >
                <h3>{b.name}</h3>
                <p>{b._count?.items ?? 0} items</p>
              </div>
            ))
          )}
        </div>

        <div className="board-detail">
          {selectedBoardId == null ? (
            <div className="placeholder">
              Select a board to view its items.
            </div>
          ) : !boardDetail ? (
            <div>Loading board...</div>
          ) : (
            <BoardDetail
              board={boardDetail}
              boards={boards}
              onRemoveItem={handleRemoveItem}
              onAddItemToBoard={handleAddItemToBoard}
              onAddToCart={handleAddToCart}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function BoardDetail({
  board,
  boards,
  onRemoveItem,
  onAddItemToBoard,
  onAddToCart,
}) {
  return (
    <div>
      <h3>{board.name}</h3>
      {board.items.length === 0 ? (
        <p>No items on this board yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Latest Value</th>
              <th>Profile</th>
              <th>Last Success</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {board.items.map((bi) => {
              const ti = bi.trackedItem;
              const snap = ti.snapshots[0];

              return (
                <tr key={bi.id}>
                  <td>{ti.name}</td>
                  <td>{snap?.valueRaw ?? "—"}</td>
                  <td>{ti.profile ?? "—"}</td>
                  <td>
                    {ti.lastSuccessAt
                      ? new Date(ti.lastSuccessAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {/* Remove from this board */}
                    <button
                      type="button"
                      onClick={() => onRemoveItem(board.id, ti.id)}
                    >
                      Remove
                    </button>

                    {/* Move / add to another board */}
                    {boards && boards.length > 1 && (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const targetId = Number(e.target.value);
                          if (!targetId) return;
                          onAddItemToBoard(targetId, ti.id);
                          e.target.value = "";
                        }}
                      >
                        <option value="">Move to…</option>
                        {boards
                          .filter((b) => b.id !== board.id)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                      </select>
                    )}

                    {/* Add to Cart */}
                    <button
                      type="button"
                      onClick={() => onAddToCart(ti.id)}
                      style={{ marginLeft: "0.5rem" }}
                    >
                      Add to Cart
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

