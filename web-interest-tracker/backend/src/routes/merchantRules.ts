import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

export default function merchantRulesRouter(prisma: PrismaClient) {
  const router = Router();

  // GET /merchant-rules
  // List all merchant rules
  router.get("/", async (_req, res) => {
    try {
      const rules = await prisma.merchantRule.findMany({
        orderBy: { domain: "asc" }
      });
      res.json(rules);
    } catch (err) {
      console.error("GET /merchant-rules error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /merchant-rules
  // Body: { domain: string; freeShippingMin?: number; flatShipping?: number; taxRate?: number }
  router.post("/", async (req, res) => {
    try {
      const { domain, freeShippingMin, flatShipping, taxRate } = req.body || {};

      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "domain_required" });
      }

      const data: any = { domain };

      if (freeShippingMin != null) {
        const v = Number(freeShippingMin);
        if (Number.isNaN(v)) {
          return res
            .status(400)
            .json({ error: "invalid_freeShippingMin" });
        }
        data.freeShippingMin = v;
      }

      if (flatShipping != null) {
        const v = Number(flatShipping);
        if (Number.isNaN(v)) {
          return res.status(400).json({ error: "invalid_flatShipping" });
        }
        data.flatShipping = v;
      }

      if (taxRate != null) {
        const v = Number(taxRate);
        if (Number.isNaN(v)) {
          return res.status(400).json({ error: "invalid_taxRate" });
        }
        data.taxRate = v;
      }

      const rule = await prisma.merchantRule.create({ data });
      res.status(201).json(rule);
    } catch (err: any) {
      // handle unique constraint
      if (err?.code === "P2002") {
        return res
          .status(409)
          .json({ error: "domain_exists", message: "Rule for this domain already exists." });
      }
      console.error("POST /merchant-rules error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /merchant-rules/:domain
  // Body: { freeShippingMin?: number; flatShipping?: number; taxRate?: number }
  router.patch("/:domain", async (req, res) => {
    try {
      const domain = req.params.domain;
      if (!domain) {
        return res.status(400).json({ error: "domain_required" });
      }

      const { freeShippingMin, flatShipping, taxRate } = req.body || {};
      const data: any = {};

      if (freeShippingMin != null) {
        const v = Number(freeShippingMin);
        if (Number.isNaN(v)) {
          return res
            .status(400)
            .json({ error: "invalid_freeShippingMin" });
        }
        data.freeShippingMin = v;
      }

      if (flatShipping != null) {
        const v = Number(flatShipping);
        if (Number.isNaN(v)) {
          return res.status(400).json({ error: "invalid_flatShipping" });
        }
        data.flatShipping = v;
      }

      if (taxRate != null) {
        const v = Number(taxRate);
        if (Number.isNaN(v)) {
          return res.status(400).json({ error: "invalid_taxRate" });
        }
        data.taxRate = v;
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "no_fields_to_update" });
      }

      const updated = await prisma.merchantRule.update({
        where: { domain },
        data
      });

      res.json(updated);
    } catch (err: any) {
      if (err?.code === "P2025") {
        return res.status(404).json({ error: "rule_not_found" });
      }
      console.error("PATCH /merchant-rules/:domain error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /merchant-rules/:domain
  router.delete("/:domain", async (req, res) => {
    try {
      const domain = req.params.domain;
      if (!domain) {
        return res.status(400).json({ error: "domain_required" });
      }

      await prisma.merchantRule.delete({
        where: { domain }
      });

      res.json({ status: "deleted" });
    } catch (err: any) {
      if (err?.code === "P2025") {
        return res.json({ status: "deleted" });
      }
      console.error("DELETE /merchant-rules/:domain error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
