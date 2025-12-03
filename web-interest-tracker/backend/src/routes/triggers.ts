import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

const VALID_COMPARISONS = ["lt", "lte", "gt", "gte", "eq", "neq"] as const;
type Comparison = (typeof VALID_COMPARISONS)[number];

function isValidComparison(c: any): c is Comparison {
  return typeof c === "string" && VALID_COMPARISONS.includes(c as Comparison);
}

export default function triggersRouter(prisma: PrismaClient) {
  const router = Router();

  // POST /triggers
  // Body: { trackedItemId: number; comparison: "lt"|"lte"|"gt"|"gte"|"eq"|"neq"; threshold: number; active?: boolean }
  router.post("/", async (req, res) => {
    try {
      const { trackedItemId, comparison, threshold, active } = req.body || {};

      const tid = Number(trackedItemId);
      if (!tid || Number.isNaN(tid)) {
        return res.status(400).json({ error: "invalid_trackedItemId" });
      }

      if (!isValidComparison(comparison)) {
        return res.status(400).json({
          error: "invalid_comparison",
          valid: VALID_COMPARISONS
        });
      }

      const th = Number(threshold);
      if (Number.isNaN(th)) {
        return res.status(400).json({ error: "invalid_threshold" });
      }

      const item = await prisma.trackedItem.findUnique({
        where: { id: tid }
      });

      if (!item) {
        return res.status(404).json({ error: "tracked_item_not_found" });
      }

      const trigger = await prisma.trigger.create({
        data: {
          trackedItemId: tid,
          comparison,
          threshold: th,
          active: active ?? true
        }
      });

      res.status(201).json(trigger);
    } catch (err) {
      console.error("POST /triggers error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /triggers
  // Optional query params: ?trackedItemId=123&active=true
  router.get("/", async (req, res) => {
    try {
      const { trackedItemId, active } = req.query;

      const where: any = {};

      if (trackedItemId != null) {
        const tid = Number(trackedItemId);
        if (!tid || Number.isNaN(tid)) {
          return res.status(400).json({ error: "invalid_trackedItemId" });
        }
        where.trackedItemId = tid;
      }

      if (active != null) {
        where.active = active === "true";
      }

      const triggers = await prisma.trigger.findMany({
        where,
        orderBy: { createdAt: "desc" }
      });

      res.json(triggers);
    } catch (err) {
      console.error("GET /triggers error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /triggers/:id
  router.get("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      const trigger = await prisma.trigger.findUnique({
        where: { id },
        include: {
          trackedItem: true,
          events: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              snapshot: true
            }
          }
        }
      });

      if (!trigger) {
        return res.status(404).json({ error: "trigger_not_found" });
      }

      res.json(trigger);
    } catch (err) {
      console.error("GET /triggers/:id error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /triggers/:id
  // Body: { active?: boolean; threshold?: number; comparison?: ... }
  router.patch("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      const { active, threshold, comparison } = req.body || {};
      const data: any = {};

      if (typeof active === "boolean") {
        data.active = active;
      }

      if (threshold != null) {
        const th = Number(threshold);
        if (Number.isNaN(th)) {
          return res.status(400).json({ error: "invalid_threshold" });
        }
        data.threshold = th;
      }

      if (comparison != null) {
        if (!isValidComparison(comparison)) {
          return res.status(400).json({
            error: "invalid_comparison",
            valid: VALID_COMPARISONS
          });
        }
        data.comparison = comparison;
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "no_fields_to_update" });
      }

      const updated = await prisma.trigger.update({
        where: { id },
        data
      });

      res.json(updated);
    } catch (err) {
      console.error("PATCH /triggers/:id error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /triggers/:id
  router.delete("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      await prisma.trigger.delete({ where: { id } });
      res.json({ status: "deleted" });
    } catch (err: any) {
      // Treat "already gone" as success
      if (err?.code === "P2025") {
        return res.json({ status: "deleted" });
      }
      console.error("DELETE /triggers/:id error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /triggers/:id/events
  router.get("/:id/events", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      const events = await prisma.triggerEvent.findMany({
        where: { triggerId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          snapshot: true
        }
      });

      res.json(events);
    } catch (err) {
      console.error("GET /triggers/:id/events error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
