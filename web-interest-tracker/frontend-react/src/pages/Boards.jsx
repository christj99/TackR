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
            <BoardDetail board={boardDetail} />
          )}
        </div>
      </div>
    </div>
  );
}

function BoardDetail({ board }) {
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
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
