import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parseNumericFromText } from "../utils/parseValue";
import { repairSelectorWithAI } from "../services/aiAgent";


function meetsComparison(
  value: number,
  comparison: string,
  threshold: number
): boolean {
  switch (comparison) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "eq":
      return value === threshold;
    case "neq":
      return value !== threshold;
    default:
      return false;
  }
}


function inferItemType(
  sampleText?: string | null,
  initialValueNumeric?: number | null
): "price" | "number" | "text" {
  const hasNumeric = typeof initialValueNumeric === "number";
  const text = (sampleText || "").toLowerCase();

  if (hasNumeric) {
    // crude but effective: look for common currency symbols
    if (/[€$£¥]/.test(text)) {
      return "price";
    }
    return "number";
  }

  return "text";
}


export default function trackedItemsRouter(prisma: PrismaClient) {
  const router = Router();

    // POST /tracked-items
  router.post("/", async (req, res) => {
    try {
      const {
        name,
        url,
        selector,
        sampleText,
        initialValueRaw,
        initialValueNumeric,
        fingerprint,
        type,           // optional override: "price" | "number" | "text"
        profile         // optional AgentProfile
      } = req.body || {};

      if (!name || !url || !selector) {
        return res.status(400).json({ error: "missing_required_fields" });
      }

      // Decide the type: explicit > inferred
      const inferredType = inferItemType(sampleText, initialValueNumeric);
      const itemType: "price" | "number" | "text" =
        type === "price" || type === "number" || type === "text"
          ? type
          : inferredType;

      // Create the tracked item
      const item = await prisma.trackedItem.create({
        data: {
          name,
          url,
          selector,
          sampleText,
          type: itemType,
          fingerprint,
          profile: profile ?? "generic_metric",
        },
      });

      // If the extension captured an initial value, create a snapshot immediately
      if (typeof initialValueRaw === "string") {
        await prisma.snapshot.create({
          data: {
            trackedItemId: item.id,
            valueRaw: initialValueRaw,
            valueNumeric:
              typeof initialValueNumeric === "number"
                ? initialValueNumeric
                : null,
            status: "ok",
          },
        });
      }

      // 🔹 M: attach new items to a default board ("My Items")

      const DEFAULT_BOARD_NAME = "My Items";

      // Find or create the default board
      let board = await prisma.board.findFirst({
        where: { name: DEFAULT_BOARD_NAME },
      });

      if (!board) {
        board = await prisma.board.create({
          data: {
            name: DEFAULT_BOARD_NAME,
            description: "Default board for all tracked items",
            // filters omitted → stays null by default
          },
        });
      }

      // Create BoardItem mapping (ignore if it already exists)
      try {
        await prisma.boardItem.create({
          data: {
            boardId: board.id,
            trackedItemId: item.id,
          },
        });
      } catch (err: any) {
        // Unique constraint (boardId, trackedItemId) – safe to ignore
        if (err?.code !== "P2002") {
          console.error(
            "Failed to create BoardItem for new tracked item:",
            err
          );
        }
      }

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

        const summarized = items.map((item: any) => {
        const latest = item.snapshots[0] || null;
        return {
            id: item.id,
            name: item.name,
            url: item.url,
            selector: item.selector,
            sampleText: item.sampleText,
            type: item.type,               // ⬅️ NEW
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

  // DELETE /tracked-items/:id
  router.delete("/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      // ensure it exists first (to give a 404 instead of silent no-op)
      const existing = await prisma.trackedItem.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }

      await prisma.trackedItem.delete({ where: { id } });

      // Snapshots, triggers, and triggerEvents should be removed via cascade
      return res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

    // POST /tracked-items/:id/snapshots
  // body: { valueRaw: string }
  router.post("/:id/snapshots", async (req, res) => {
    try {
      const trackedItemId = Number(req.params.id);
      const { valueRaw } = req.body;

      if (Number.isNaN(trackedItemId)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      if (typeof valueRaw !== "string") {
        return res.status(400).json({ error: "valueRaw_required" });
      }

      const item = await prisma.trackedItem.findUnique({
        where: { id: trackedItemId }
      });

      if (!item) {
        return res.status(404).json({ error: "tracked_item_not_found" });
      }
      
      if (!valueRaw || typeof valueRaw !== "string") {
        return res
          .status(400)
          .json({ error: "valueRaw (string) is required" });
      }      

      const numeric = parseNumericFromText(valueRaw);
      const now = new Date();

      const snapshot = await prisma.snapshot.create({
        data: {
          trackedItemId,
          valueRaw,
          valueNumeric: numeric,
          status: "ok"
        }
      });
      
      await prisma.trackedItem.update({
        where: { id: item.id },
        data: {
          lastSuccessAt: now,
          consecutiveFailures: 0,
          updatedAt: now
        }
      });      

      // Evaluate triggers if numeric
      if (typeof numeric === "number") {
        const triggers = await prisma.trigger.findMany({
          where: { trackedItemId, active: true }
        });

        for (const trig of triggers) {
          if (
            trig.lastFiredAt == null &&
            meetsComparison(numeric, trig.comparison, trig.threshold)
          ) {
            await prisma.triggerEvent.create({
              data: {
                triggerId: trig.id,
                snapshotId: snapshot.id
              }
            });

            await prisma.trigger.update({
              where: { id: trig.id },
              data: { lastFiredAt: new Date() }
            });

            console.log(
              `Trigger ${trig.id} fired for item ${trackedItemId} (value=${numeric}, comparison=${trig.comparison}, threshold=${trig.threshold})`
            );
          }
        }
      }

      res.status(201).json({ snapshot });
    } catch (err) {
      console.error("create snapshot error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /tracked-items/:id/repair-selector
  // Attempts to repair a broken selector using AI.
  // Optionally accepts { prompt?: string } in the body if you want a custom repair instruction later.
  router.post("/:id/repair-selector", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid_id" });
      }

      const item = await prisma.trackedItem.findUnique({
        where: { id },
        include: {
          snapshots: {
            where: { status: "ok" },
            orderBy: { takenAt: "desc" },
            take: 1
          }
        }
      });

      if (!item) {
        return res.status(404).json({ error: "tracked_item_not_found" });
      }

      // Use last good snapshot as best "sampleText" if available
      const lastOkSnapshot = item.snapshots[0];
      const sampleText =
        lastOkSnapshot?.valueRaw ?? item.sampleText ?? null;

      const proposal = await repairSelectorWithAI({
        url: item.url,
        originalSelector: item.selector,
        sampleText,
        fingerprint: item.fingerprint
      });

      if (!proposal) {
        return res.status(422).json({
          error: "repair_failed",
          message: "AI could not produce a valid replacement selector."
        });
      }

      // Update the tracked item with the new selector & sample text
      const now = new Date();
      const updated = await prisma.trackedItem.update({
        where: { id: item.id },
        data: {
          selector: proposal.selector,
          sampleText: proposal.sampleText,
          type: proposal.type ?? item.type,
          // reset health counters on successful repair
          consecutiveFailures: 0,
          lastSuccessAt: now,
          updatedAt: now
        }
      });

      // Create an immediate snapshot for the repaired selector
      const valueRaw = proposal.sampleText;
      const valueNumeric =
        typeof proposal.valueNumeric === "number"
          ? proposal.valueNumeric
          : parseNumericFromText(proposal.sampleText);

      const snapshot = await prisma.snapshot.create({
        data: {
          trackedItemId: updated.id,
          valueRaw,
          valueNumeric:
            typeof valueNumeric === "number" ? valueNumeric : null,
          status: "ok"
        }
      });

      return res.json({
        status: "repaired",
        item: updated,
        snapshot
      });
    } catch (err) {
      console.error("repair-selector route error:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  });


  router.post("/:id/failure", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: "invalid id" });
      }

      const item = await prisma.trackedItem.findUnique({
        where: { id }
      });

      if (!item) {
        return res.status(404).json({ error: "tracked item not found" });
      }

      const now = new Date();

      const updated = await prisma.trackedItem.update({
        where: { id: item.id },
        data: {
          consecutiveFailures: { increment: 1 },
          lastFailureAt: now,
          updatedAt: now
        }
      });

      const FAILURE_THRESHOLD = 3;
      const shouldRepair =
        updated.consecutiveFailures >= FAILURE_THRESHOLD && updated.isActive;

      res.json({
        status: "recorded",
        consecutiveFailures: updated.consecutiveFailures,
        shouldRepair
      });
    } catch (err) {
      console.error("failure route error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /tracked-items/for-you
  // Returns a ranked list of "interesting" tracked items based on recent activity.
router.get("/for-you", async (_req, res) => {
  try {
    res.json({
      windowDays: 7,
      count: 0,
      items: [],
    });
  } catch (err) {
    console.error("GET /tracked-items/for-you error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});




  return router;
}
