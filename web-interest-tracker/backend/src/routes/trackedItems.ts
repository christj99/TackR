import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

export default function trackedItemsRouter(prisma: PrismaClient) {
  const router = Router();

  // POST /tracked-items
  router.post("/", async (req, res) => {
    try {
      const { name, url, selector, sampleText } = req.body;
      if (!name || !url || !selector) {
        return res.status(400).json({ error: "name, url, selector required" });
      }

      const item = await prisma.trackedItem.create({
        data: { name, url, selector, sampleText },
      });

      res.status(201).json(item);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /tracked-items
  router.get("/", async (_req, res) => {
    try {
      const items = await prisma.trackedItem.findMany({
        orderBy: { createdAt: "desc" },
      });
      res.json(items);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /tracked-items/:id
  router.get("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const item = await prisma.trackedItem.findUnique({
        where: { id },
        include: { snapshots: { orderBy: { takenAt: "desc" } } },
      });

      if (!item) return res.status(404).json({ error: "not_found" });

      res.json(item);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /tracked-items/:id/snapshots
  router.get("/:id/snapshots", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const snapshots = await prisma.snapshot.findMany({
        where: { trackedItemId: id },
        orderBy: { takenAt: "desc" },
        take: 200,
      });

      res.json(snapshots);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

    // GET /tracked-items/summary  -> each item + latest snapshot
  router.get("/summary/all", async (_req, res) => {
    try {
      const items = await prisma.trackedItem.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          snapshots: {
            orderBy: { takenAt: "desc" },
            take: 1
          }
        }
      });

      const summarized = items.map((item) => {
        const latest = item.snapshots[0] || null;
        return {
          id: item.id,
          name: item.name,
          url: item.url,
          selector: item.selector,
          sampleText: item.sampleText,
          createdAt: item.createdAt,
          latestSnapshot: latest
            ? {
              valueRaw: latest.valueRaw,
              valueNumeric: latest.valueNumeric,
              status: latest.status,
              takenAt: latest.takenAt
            }
            : null
        };
      });

      res.json(summarized);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });


  return router;
}
