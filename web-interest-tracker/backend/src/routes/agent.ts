// src/routes/agent.ts
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import {
  analyzePageAndProposeSelector,
  analyzePageAndProposeSelectorsMulti,
  AgentProfile,
  planNavigationForProduct,
  planNavigationForPage,
  categorizeTrackedItem
} from "../services/aiAgent";



import { parseNumericFromText } from "../utils/parseValue";

export default function agentRouter(prisma: PrismaClient) {
  const router = Router();

  /**
   * POST /agent/track
   *
   * Body: {
   *   prompt: string;
   *   urls: string[];
   *   profile?: AgentProfile; // "ecommerce_price" | "poll_average" | "generic_metric"
   * }
   *
   * For each URL, asks the AI agent to pick ONE element to track,
   * then creates a TrackedItem + initial Snapshot.
   */
  router.post("/track", async (req, res) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        urls?: string[];
        profile?: AgentProfile;
      };

      const { prompt, urls, profile } = body;

      if (!prompt || !Array.isArray(urls) || urls.length === 0) {
        return res
          .status(400)
          .json({ error: "prompt and urls are required" });
      }

      const results: any[] = [];

      for (const url of urls) {
        try {
          const proposal = await analyzePageAndProposeSelector({
            prompt,
            url,
            profile: profile ?? "generic_metric"
          });

          if (!proposal) {
            results.push({ url, status: "no_match" });
            continue;
          }

          const inferredType =
            proposal.type ??
            (proposal.valueNumeric != null ? "number" : "text");

            const baseName =
            proposal.name ?? `Tracked from agent: ${url.slice(0, 60)}`;

            let category: string | undefined;
            let tags: string[] | undefined;

            try {
            const cat = await categorizeTrackedItem({
                name: baseName,
                url,
                type: inferredType,
                sampleText: proposal.sampleText
            });
            if (cat) {
                category = cat.category;
                tags = cat.tags;
            }
            } catch (e) {
            console.error("categorizeTrackedItem error (/agent/track)", e);
            }

            const item = await prisma.trackedItem.create({
            data: {
                name: baseName,
                url,
                selector: proposal.selector,
                sampleText: proposal.sampleText,
                type: inferredType,
                category,
                tags
            }
            });


          const numeric =
            proposal.valueNumeric ??
            parseNumericFromText(proposal.sampleText);

          await prisma.snapshot.create({
            data: {
              trackedItemId: item.id,
              valueRaw: proposal.sampleText,
              valueNumeric: numeric,
              status: "ok"
            }
          });

          results.push({ url, status: "ok", itemId: item.id });
        } catch (e: any) {
          console.error(`Error processing url ${url}`, e);
          results.push({
            url,
            status: "error",
            errorMessage: e?.message ?? String(e)
          });
        }
      }

      res.json({ results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * POST /agent/track-multi
   *
   * Body: {
   *   prompt: string;
   *   url: string;
   *   profile?: AgentProfile;
   * }
   *
   * On a SINGLE page, asks the AI agent to find MULTIPLE elements
   * to track (e.g., price, rating, review count, stock), and creates
   * one TrackedItem + Snapshot per element.
   */
  router.post("/track-multi", async (req, res) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        url?: string;
        profile?: AgentProfile;
      };

      const { prompt, url, profile } = body;

      if (!prompt || !url) {
        return res
          .status(400)
          .json({ error: "prompt and url are required" });
      }

      const multi = await analyzePageAndProposeSelectorsMulti({
        prompt,
        url,
        profile: profile ?? "generic_metric"
      });

      if (!multi) {
        return res.json({ url, status: "no_match", items: [] });
      }

      const created: any[] = [];

        for (const p of multi.items) {
        const inferredType =
            p.type ?? (typeof p.valueNumeric === "number" ? "number" : "text");

        const baseName =
            p.name || `Tracked from agent multi: ${url.slice(0, 40)}`;

        let category: string | undefined;
        let tags: string[] | undefined;

        try {
            const cat = await categorizeTrackedItem({
            name: baseName,
            url,
            type: inferredType,
            sampleText: p.sampleText
            });
            if (cat) {
            category = cat.category;
            tags = cat.tags;
            }
        } catch (e) {
            console.error("categorizeTrackedItem error (/agent/track-multi)", e);
        }

        const item = await prisma.trackedItem.create({
            data: {
            name: baseName,
            url,
            selector: p.selector,
            sampleText: p.sampleText,
            type: inferredType,
            category,
            tags
            }
        });

        const numeric =
            typeof p.valueNumeric === "number"
            ? p.valueNumeric
            : parseNumericFromText(p.sampleText);

        const snapshot = await prisma.snapshot.create({
            data: {
            trackedItemId: item.id,
            valueRaw: p.sampleText,
            valueNumeric: numeric,
            status: "ok"
            }
        });

        created.push({
            itemId: item.id,
            name: item.name,
            type: item.type,
            snapshotId: snapshot.id
        });
        }


      res.json({ url, status: "ok", items: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    }
  });

    /**
     * POST /agent/navigate-track
     *
     * Body: {
     *   startUrl: string;       // e.g. category or search page
     *   instruction: string;    // e.g. "Find the men's License to Train Jogger in black and track price + rating"
     *   profile?: AgentProfile; // optional, defaults to "generic_metric"
     * }
     *
     * Steps:
     * 1) Use AI to choose a product detail URL from startUrl (planNavigationForProduct)
     * 2) Run multi-element tracking on the resulting product page (analyzePageAndProposeSelectorsMulti)
     * 3) Create one TrackedItem + Snapshot per element
     */
    router.post("/navigate-track", async (req, res) => {
    try {
        const body = (req.body || {}) as {
        startUrl?: string;
        instruction?: string;
        profile?: AgentProfile;
        };

        const { startUrl, instruction, profile } = body;

        if (!startUrl || !instruction) {
        return res
            .status(400)
            .json({ error: "startUrl and instruction are required" });
        }

        // Step 1: ask AI which product link to follow
        const plan = await planNavigationForProduct({
        startUrl,
        instruction
        });

        if (!plan) {
        return res.status(422).json({
            error: "no_navigation_plan",
            message: "AI could not find a suitable product link on the startUrl"
        });
        }

        console.log(
        `[navigate-track] From ${startUrl} → chosen product: ${plan.targetUrl} (reason: ${plan.reason})`
        );

        const targetUrl = plan.targetUrl;

        // Step 2: run multi-element extraction on the product page
        const multi = await analyzePageAndProposeSelectorsMulti({
        prompt: instruction,
        url: targetUrl,
        profile: profile ?? "generic_metric"
        });

        if (!multi || !multi.items || multi.items.length === 0) {
        return res.json({
            startUrl,
            productUrl: targetUrl,
            status: "no_match",
            items: []
        });
        }

        // Step 3: create TrackedItems + Snapshots
        const created: any[] = [];

        for (const p of multi.items) {
        const inferredType =
            p.type ?? (typeof p.valueNumeric === "number" ? "number" : "text");

        const baseName =
            p.name ||
            `Tracked from agent navigate: ${instruction.slice(0, 40)}`;

        let category: string | undefined;
        let tags: string[] | undefined;

        try {
            const cat = await categorizeTrackedItem({
            name: baseName,
            url: targetUrl,
            type: inferredType,
            sampleText: p.sampleText
            });
            if (cat) {
            category = cat.category;
            tags = cat.tags;
            }
        } catch (e) {
            console.error("categorizeTrackedItem error (/agent/navigate-track)", e);
        }

        const item = await prisma.trackedItem.create({
            data: {
            name: baseName,
            url: targetUrl,
            selector: p.selector,
            sampleText: p.sampleText,
            type: inferredType,
            category,
            tags
            }
        });

        const numeric =
            typeof p.valueNumeric === "number"
            ? p.valueNumeric
            : parseNumericFromText(p.sampleText);

        const snapshot = await prisma.snapshot.create({
            data: {
            trackedItemId: item.id,
            valueRaw: p.sampleText,
            valueNumeric: numeric,
            status: "ok"
            }
        });

        created.push({
            itemId: item.id,
            name: item.name,
            type: item.type,
            snapshotId: snapshot.id
        });
        }


        res.json({
        startUrl,
        productUrl: targetUrl,
        status: "ok",
        items: created,
        reason: plan.reason
        });
    } catch (err) {
        console.error("navigate-track route error:", err);
        res.status(500).json({ error: "internal_error" });
    }
    });

    /**
     * POST /agent/multihop-track
     *
     * Body: {
     *   startUrl: string;       // e.g. homepage like "https://shop.lululemon.com/"
     *   instruction: string;    // e.g. "Find the men's License to Train Jogger in black and track price + rating + reviews."
     *   profile?: AgentProfile;
     * }
     *
     * Flow:
     * 1) Hop 1: homepage/startUrl -> intermediate page (category/search/product grid)
     * 2) Hop 2: intermediate page -> product detail (via planNavigationForProduct)
     * 3) Multi-track on product detail (price, rating, reviews, etc.)
     */
    router.post("/multihop-track", async (req, res) => {
    try {
        const body = (req.body || {}) as {
        startUrl?: string;
        instruction?: string;
        profile?: AgentProfile;
        };

        const { startUrl, instruction, profile } = body;

        if (!startUrl || !instruction) {
        return res
            .status(400)
            .json({ error: "startUrl and instruction are required" });
        }

        console.log("[MULTIHOP] startUrl:", startUrl);
        console.log("[MULTIHOP] instruction:", instruction);

        // Hop 1: homepage -> intermediate category/search page
        const hop1 = await planNavigationForPage({
        startUrl,
        instruction
        });

        if (!hop1) {
        return res.status(422).json({
            error: "no_hop1",
            message:
            "AI could not find a useful next page from the startUrl."
        });
        }

        const intermediateUrl = hop1.targetUrl;
        console.log(
        `[MULTIHOP] Hop1: ${startUrl} -> ${intermediateUrl} (reason: ${hop1.reason})`
        );

        // Hop 2: intermediate page -> product detail page
        let hop2 = await planNavigationForProduct({
        startUrl: intermediateUrl,
        instruction
        });

        let secondIntermediateUrl: string | undefined;

        if (!hop2) {
        console.log(
            "[MULTIHOP] Hop2 failed from intermediateUrl, trying a second intermediate hop"
        );

        // Try one more hop from intermediate page to a better category/grid page
        const hop2Intermediate = await planNavigationForPage({
            startUrl: intermediateUrl,
            instruction
        });

        if (hop2Intermediate) {
            secondIntermediateUrl = hop2Intermediate.targetUrl;
            console.log(
            `[MULTIHOP] Hop2a: ${intermediateUrl} -> ${secondIntermediateUrl} (reason: ${hop2Intermediate.reason})`
            );

            hop2 = await planNavigationForProduct({
            startUrl: secondIntermediateUrl,
            instruction
            });
        }
        }

        if (!hop2) {
        return res.status(422).json({
            error: "no_hop2",
            message:
            "AI could not find a product detail link even after a second hop.",
            intermediateUrl,
            secondIntermediateUrl
        });
        }

        const productUrl = hop2.targetUrl;
        console.log(
        `[MULTIHOP] Hop2 final: -> ${productUrl} (reason: ${hop2.reason})`
        );

        // Multi-element extraction on product page
        const multi = await analyzePageAndProposeSelectorsMulti({
        prompt: instruction,
        url: productUrl,
        profile: profile ?? "generic_metric"
        });

        if (!multi || !multi.items || multi.items.length === 0) {
        return res.json({
            startUrl,
            intermediateUrl,
            secondIntermediateUrl,
            productUrl,
            status: "no_match",
            items: []
        });
        }

        const created: any[] = [];

        for (const p of multi.items) {
        const inferredType =
            p.type ??
            (typeof p.valueNumeric === "number" ? "number" : "text");

        const baseName =
            p.name ||
            `Tracked from multihop: ${instruction.slice(0, 40)}`;

        const item = await prisma.trackedItem.create({
            data: {
            name: baseName,
            url: productUrl,
            selector: p.selector,
            sampleText: p.sampleText,
            type: inferredType
            }
        });

        const numeric =
            typeof p.valueNumeric === "number"
            ? p.valueNumeric
            : parseNumericFromText(p.sampleText);

        const snapshot = await prisma.snapshot.create({
            data: {
            trackedItemId: item.id,
            valueRaw: p.sampleText,
            valueNumeric: numeric,
            status: "ok"
            }
        });

        // You can also update lastSuccessAt/consecutiveFailures here if you want:
        await prisma.trackedItem.update({
            where: { id: item.id },
            data: {
            lastSuccessAt: new Date(),
            consecutiveFailures: 0
            }
        });

        created.push({
            itemId: item.id,
            name: item.name,
            type: item.type,
            snapshotId: snapshot.id
        });
        }

        res.json({
        startUrl,
        intermediateUrl,
        secondIntermediateUrl,
        productUrl,
        status: "ok",
        hop1Reason: hop1.reason,
        hop2Reason: hop2.reason,
        items: created
        });
    } catch (err) {
        console.error("multihop-track route error:", err);
        res.status(500).json({ error: "internal_error" });
    }
    });


    /**
     * POST /agent/compare-prices
     *
     * Body: {
     *   prompt: string;        // e.g. "Track the main product price in USD."
     *   urls: string[];        // multiple store/product URLs
     *   profile?: AgentProfile; // usually "ecommerce_price"
     *   persist?: boolean;     // default true; set false if you only want comparison, no tracked items
     * }
     *
     * Returns current prices + a summary.
     */
    router.post("/compare-prices", async (req, res) => {
    try {
        const body = (req.body || {}) as {
        prompt?: string;
        urls?: string[];
        profile?: AgentProfile;
        persist?: boolean;
        };

        const { prompt, urls, profile, persist } = body;

        if (!prompt || !urls || !Array.isArray(urls) || urls.length === 0) {
        return res
            .status(400)
            .json({ error: "prompt and urls are required" });
        }

        const effectiveProfile = profile ?? "ecommerce_price";
        const doPersist = persist !== false; // default true

        const results: {
        url: string;
        status: "ok" | "no_match" | "error";
        errorMessage?: string;
        priceNumeric?: number | null;
        priceRaw?: string | null;
        itemId?: number;
        snapshotId?: number;
        }[] = [];

        for (const url of urls) {
        try {
            const proposal = await analyzePageAndProposeSelector({
            prompt,
            url,
            profile: effectiveProfile
            });

            if (!proposal) {
            results.push({
                url,
                status: "no_match"
            });
            continue;
            }

            const numeric =
            proposal.valueNumeric ??
            parseNumericFromText(proposal.sampleText);

            let itemId: number | undefined;
            let snapshotId: number | undefined;

            if (doPersist) {
            const inferredType = proposal.type ?? "price";
            const baseName =
                proposal.name || `Price from compare: ${url.slice(0, 40)}`;

            let category: string | undefined;
            let tags: string[] | undefined;

            try {
                const cat = await categorizeTrackedItem({
                name: baseName,
                url,
                type: inferredType,
                sampleText: proposal.sampleText
                });
                if (cat) {
                category = cat.category;
                tags = cat.tags;
                }
            } catch (e) {
                console.error("categorizeTrackedItem error (/agent/compare-prices)", e);
            }

            const item = await prisma.trackedItem.create({
                data: {
                name: baseName,
                url,
                selector: proposal.selector,
                sampleText: proposal.sampleText,
                type: inferredType,
                category,
                tags
                }
            });

            itemId = item.id;

            const snapshot = await prisma.snapshot.create({
                data: {
                trackedItemId: item.id,
                valueRaw: proposal.sampleText,
                valueNumeric: numeric,
                status: "ok"
                }
            });

            snapshotId = snapshot.id;
            }


            results.push({
            url,
            status: "ok",
            priceNumeric: numeric ?? null,
            priceRaw: proposal.sampleText,
            itemId,
            snapshotId
            });
        } catch (e: any) {
            console.error(`compare-prices error for ${url}`, e);
            results.push({
            url,
            status: "error",
            errorMessage: e?.message ?? String(e)
            });
        }
        }

        // Build summary (cheapest, most expensive)
        const okResults = results.filter(
        (r) => r.status === "ok" && r.priceNumeric != null
        ) as { url: string; priceNumeric: number }[];

        let cheapest: { url: string; priceNumeric: number } | null = null;
        let priciest: { url: string; priceNumeric: number } | null = null;

        for (const r of okResults) {
        if (!cheapest || r.priceNumeric < cheapest.priceNumeric) {
            cheapest = r;
        }
        if (!priciest || r.priceNumeric > priciest.priceNumeric) {
            priciest = r;
        }
        }

        res.json({
        status: "ok",
        results,
        summary: {
            cheapest,
            priciest,
            countOk: okResults.length,
            countTotal: results.length
        }
        });
    } catch (err) {
        console.error("compare-prices route error:", err);
        res.status(500).json({ error: "internal_error" });
    }
    });


  return router;
}
