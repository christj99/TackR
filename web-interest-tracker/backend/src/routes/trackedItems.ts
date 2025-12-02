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
          type // optional override
        } = req.body;



        if (!name || !url || !selector) {
        return res.status(400).json({ error: "name, url, selector required" });
        }

        // Decide the type: explicit > inferred
        const inferredType = inferItemType(sampleText, initialValueNumeric);
        const itemType: "price" | "number" | "text" =
        type === "price" || type === "number" || type === "text"
            ? type
            : inferredType;

        const item = await prisma.trackedItem.create({
          data: { name, url, selector, sampleText, type: itemType, fingerprint }
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
            status: "ok"
            }
        });
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

        const summarized = items.map((item) => {
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
        return res.status(400).json({ error: "invalid id" });
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
        return res.status(404).json({ error: "tracked item not found" });
      }

      const lastGoodSnapshot = item.snapshots[0] || null;
      const sampleText = lastGoodSnapshot?.valueRaw || item.sampleText || null;

      console.log(
        `[repair-selector] Attempting repair for item ${item.id} on ${item.url} using sampleText="${sampleText}"`
      );

      const proposal = await repairSelectorWithAI({
        url: item.url,
        originalSelector: item.selector,
        sampleText,
        fingerprint: item.fingerprint // if your schema has this as Json
      });

      if (!proposal) {
        return res
          .status(422)
          .json({ error: "no_viable_repair", message: "AI could not find a better selector" });
      }

      // Update the tracked item with the new selector and sample text
      const updated = await prisma.trackedItem.update({
        where: { id: item.id },
        data: {
          selector: proposal.selector,
          sampleText: proposal.sampleText,
          type: proposal.type ?? item.type // keep existing if not provided
          // you could also store a selector history, lastRepairAt, etc. later
        }
      });

      // Optionally, create an immediate snapshot with the new text
      let snapshot = null;
      if (proposal.sampleText) {
        const numeric =
          proposal.valueNumeric ??
          // fall back to your parseNumericFromText util if you like:
          parseNumericFromText(proposal.sampleText)
          null;

         const now = new Date();
 

        snapshot = await prisma.snapshot.create({
          data: {
            trackedItemId: updated.id,
            valueRaw: proposal.sampleText,
            valueNumeric: numeric,
            status: "ok"
          }
        });
        await prisma.trackedItem.update({
          where: { id: updated.id },
          data: {
            lastSuccessAt: now,
            consecutiveFailures: 0,
            updatedAt: now
          }
        });        
      }

      res.json({
        status: "ok",
        item: updated,
        snapshot
      });
    } catch (err) {
      console.error("repair-selector route error:", err);
      res.status(500).json({ error: "internal_error" });
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


  return router;
}
