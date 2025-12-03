import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

export default function boardsRouter(prisma: PrismaClient) {
  const router = Router();

  // GET /boards  -> list boards with item counts
  router.get("/", async (_req, res) => {
    try {
      const boards = await prisma.board.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { items: true }
          }
        }
      });

      res.json(boards);
    } catch (err) {
      console.error("GET /boards error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /boards  -> create a new board
  // body: { name: string; description?: string; filters?: any }
  router.post("/", async (req, res) => {
    try {
      const { name, description, filters } = req.body || {};

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name_required" });
      }

      const board = await prisma.board.create({
        data: {
          name,
          description: description ?? null,
          filters: filters ?? null
        }
      });

      res.status(201).json(board);
    } catch (err) {
      console.error("POST /boards error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /boards/:id  -> board + items + latest snapshot per tracked item
  router.get("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      const board = await prisma.board.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { createdAt: "desc" },
            include: {
              trackedItem: {
                include: {
                  snapshots: {
                    orderBy: { takenAt: "desc" },
                    take: 1
                  }
                }
              }
            }
          }
        }
      });

      if (!board) {
        return res.status(404).json({ error: "board_not_found" });
      }

      res.json(board);
    } catch (err) {
      console.error("GET /boards/:id error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /boards/:id/items  -> add a tracked item to board
  // body: { trackedItemId: number }
  router.post("/:id/items", async (req, res) => {
    try {
      const boardId = Number(req.params.id);
      const { trackedItemId } = req.body || {};

      if (!boardId || Number.isNaN(boardId)) {
        return res.status(400).json({ error: "invalid_board_id" });
      }

      const tid = Number(trackedItemId);
      if (!tid || Number.isNaN(tid)) {
        return res.status(400).json({ error: "invalid_tracked_item_id" });
      }

      const board = await prisma.board.findUnique({ where: { id: boardId } });
      if (!board) {
        return res.status(404).json({ error: "board_not_found" });
      }

      const item = await prisma.trackedItem.findUnique({ where: { id: tid } });
      if (!item) {
        return res.status(404).json({ error: "tracked_item_not_found" });
      }

      // Avoid duplicates via composite unique
      const boardItem = await prisma.boardItem.upsert({
        where: {
          boardId_trackedItemId: {
            boardId,
            trackedItemId: tid
          }
        },
        update: {},
        create: {
          boardId,
          trackedItemId: tid
        }
      });

      res.status(201).json(boardItem);
    } catch (err) {
      console.error("POST /boards/:id/items error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /boards/:id/items/:trackedItemId  -> remove mapping
  router.delete("/:id/items/:trackedItemId", async (req, res) => {
    try {
      const boardId = Number(req.params.id);
      const trackedItemId = Number(req.params.trackedItemId);

      if (!boardId || Number.isNaN(boardId)) {
        return res.status(400).json({ error: "invalid_board_id" });
      }
      if (!trackedItemId || Number.isNaN(trackedItemId)) {
        return res
          .status(400)
          .json({ error: "invalid_tracked_item_id" });
      }

      await prisma.boardItem.delete({
        where: {
          boardId_trackedItemId: {
            boardId,
            trackedItemId
          }
        }
      });

      res.json({ status: "deleted" });
    } catch (err: any) {
      // If it didn't exist, treat as idempotent delete
      if (err?.code === "P2025") {
        return res.json({ status: "deleted" });
      }
      console.error("DELETE /boards/:id/items/:trackedItemId error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
