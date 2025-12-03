import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

function getDomainFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}


export default function cartRouter(prisma: PrismaClient) {
  const router = Router();

  // GET /cart
  router.get("/", async (_req, res) => {
    try {
      const carts = await prisma.cart.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          items: {
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

      res.json(carts);
    } catch (err) {
      console.error("GET /cart error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /cart  -> create cart
  router.post("/", async (req, res) => {
    try {
      const { name } = req.body || {};

      const cart = await prisma.cart.create({
        data: { name: name ?? null }
      });

      res.status(201).json(cart);
    } catch (err) {
      console.error("POST /cart error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /cart/:cartId/items -> add tracked item to cart
  router.post("/:cartId/items", async (req, res) => {
    try {
      const cartId = Number(req.params.cartId);
      const { trackedItemId } = req.body || {};

      if (!cartId || Number.isNaN(cartId)) {
        return res.status(400).json({ error: "invalid_cart_id" });
      }
      const tid = Number(trackedItemId);
      if (!tid || Number.isNaN(tid)) {
        return res.status(400).json({ error: "invalid_tracked_item_id" });
      }

      const item = await prisma.trackedItem.findUnique({
        where: { id: tid },
        include: {
          snapshots: {
            orderBy: { takenAt: "desc" },
            take: 1
          }
        }
      });

      if (!item) {
        return res.status(404).json({ error: "tracked_item_not_found" });
      }

      const snap = item.snapshots[0];

      const addedPrice =
        snap && typeof snap.valueNumeric === "number"
          ? snap.valueNumeric
          : null;

      const addedValueRaw = snap ? snap.valueRaw : null;

      const cartItem = await prisma.cartItem.upsert({
        where: {
          cartId_trackedItemId: { cartId, trackedItemId: tid }
        },
        update: {
          quantity: { increment: 1 }
        },
        create: {
          cartId,
          trackedItemId: tid,
          addedPrice,
          addedValueRaw,
          lastCheckedAt: new Date(),
          lastPrice: addedPrice,
          lastValueRaw: addedValueRaw
        }
      });

      res.status(201).json(cartItem);
    } catch (err) {
      console.error("POST /cart/:cartId/items error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /cart/:cartId/items/:itemId  -> update quantity or refresh
  router.patch("/:cartId/items/:itemId", async (req, res) => {
    try {
      const itemId = Number(req.params.itemId);
      const { quantity } = req.body || {};

      if (!itemId || Number.isNaN(itemId)) {
        return res.status(400).json({ error: "invalid_item_id" });
      }

      const updated = await prisma.cartItem.update({
        where: { id: itemId },
        data: {
          quantity: quantity ?? undefined
        }
      });

      res.json(updated);
    } catch (err) {
      console.error("PATCH cart item error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /cart/:cartId/items/:itemId
  router.delete("/:cartId/items/:itemId", async (req, res) => {
    try {
      const itemId = Number(req.params.itemId);

      if (!itemId || Number.isNaN(itemId)) {
        return res.status(400).json({ error: "invalid_item_id" });
      }

      await prisma.cartItem.delete({ where: { id: itemId } });

      res.json({ status: "deleted" });
    } catch (err: any) {
      if (err?.code === "P2025") {
        // Record not found -> treat as idempotent delete
        return res.json({ status: "deleted" });
      }
      console.error("DELETE cart item error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * POST /cart/:cartId/refresh
   *
   * Refreshes all items in the cart by looking at the latest snapshots
   * for each underlying TrackedItem. Updates:
   *  - lastCheckedAt
   *  - lastPrice / lastValueRaw
   *
   * Returns:
   *  - per-item info (price changes, line totals)
   *  - cart totals
   */
  router.post("/:cartId/refresh", async (req, res) => {
    try {
      const cartId = Number(req.params.cartId);
      if (!cartId || Number.isNaN(cartId)) {
        return res.status(400).json({ error: "invalid_cart_id" });
      }

      const cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
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

      if (!cart) {
        return res.status(404).json({ error: "cart_not_found" });
      }

      const now = new Date();

      type RefreshedItem = {
        cartItemId: number;
        trackedItemId: number;
        name: string;
        url: string;
        domain: string | null;
        quantity: number;
        addedPrice: number | null;
        lastPrice: number | null;
        currentPrice: number | null;
        priceChanged: boolean;
        cheaper: boolean | null;
        latestSnapshotId: number | null;
        latestSnapshotTakenAt: string | null;
        isStale: boolean;
        lineTotal: number | null;
      };

      const refreshedItems: RefreshedItem[] = [];

      let grandTotal = 0;
      const totalsByDomain: Record<string, number> = {};

      for (const ci of cart.items) {
        const ti = ci.trackedItem;
        const latestSnap = ti.snapshots[0];

        const currentPrice =
          latestSnap && typeof latestSnap.valueNumeric === "number"
            ? latestSnap.valueNumeric
            : null;

        // Decide what to store as "lastPrice" on the cart item:
        const newLastPrice =
          currentPrice != null ? currentPrice : ci.lastPrice;

        const newLastValueRaw =
          latestSnap?.valueRaw ?? ci.lastValueRaw ?? ci.addedValueRaw ?? null;

        // Determine if this item is "stale" relative to the latest snapshot
        let isStale = false;
        if (ci.lastCheckedAt && latestSnap?.takenAt) {
          isStale =
            new Date(latestSnap.takenAt).getTime() >
            new Date(ci.lastCheckedAt).getTime();
        }

        const addedPrice = ci.addedPrice ?? null;
        const lastPrice = newLastPrice ?? null;

        let priceChanged = false;
        let cheaper: boolean | null = null;

        if (addedPrice != null && lastPrice != null) {
          if (lastPrice !== addedPrice) {
            priceChanged = true;
            cheaper = lastPrice < addedPrice;
          }
        }

        // Compute line total based on lastPrice and quantity
        const unitPrice = lastPrice ?? addedPrice ?? null;
        const lineTotal =
          unitPrice != null ? unitPrice * (ci.quantity || 1) : null;

        if (lineTotal != null) {
          grandTotal += lineTotal;
          const domain = getDomainFromUrl(ti.url) ?? "unknown";
          if (!totalsByDomain[domain]) {
            totalsByDomain[domain] = 0;
          }
          totalsByDomain[domain] += lineTotal;
        }

        // Persist cartItem refresh info
        await prisma.cartItem.update({
          where: { id: ci.id },
          data: {
            lastCheckedAt: now,
            lastPrice: newLastPrice,
            lastValueRaw: newLastValueRaw
          }
        });

        refreshedItems.push({
          cartItemId: ci.id,
          trackedItemId: ti.id,
          name: ti.name,
          url: ti.url,
          domain: getDomainFromUrl(ti.url),
          quantity: ci.quantity,
          addedPrice,
          lastPrice: newLastPrice,
          currentPrice,
          priceChanged,
          cheaper,
          latestSnapshotId: latestSnap?.id ?? null,
          latestSnapshotTakenAt: latestSnap?.takenAt
            ? latestSnap.takenAt.toISOString
              ? latestSnap.takenAt.toISOString()
              : new Date(latestSnap.takenAt as any).toISOString()
            : null,
          isStale,
          lineTotal
        });
      }

      return res.json({
        cartId: cart.id,
        name: cart.name,
        refreshedAt: now.toISOString(),
        totals: {
          grandTotal,
          byDomain: totalsByDomain
        },
        items: refreshedItems
      });
    } catch (err: any) {
      console.error("POST /cart/:cartId/refresh error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * GET /cart/:cartId/checkout-summary
   *
   * Produces a simulated checkout breakdown:
   *  - groups items by merchant (domain)
   *  - computes item subtotals
   *  - applies merchant rules (free-shipping, tax, flat shipping)
   *  - computes per-merchant totals + global totals
   *  - computes savings (addedPrice vs. currentPrice)
   */
  router.get("/:cartId/checkout-summary", async (req, res) => {
    try {
      const cartId = Number(req.params.cartId);
      if (!cartId || Number.isNaN(cartId)) {
        return res.status(400).json({ error: "invalid_cart_id" });
      }

      // Load cart + latest prices
      const cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
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

      if (!cart) return res.status(404).json({ error: "cart_not_found" });

      // Helper to get domain
      const getDomain = (url: string) => {
        try {
          return new URL(url).hostname;
        } catch {
          return "unknown";
        }
      };

      // STEP 1 — group items by domain (merchant)
      const byMerchant: Record<string, any> = {};

      for (const ci of cart.items) {
        const ti = ci.trackedItem;
        const snap = ti.snapshots[0];
        const domain = getDomain(ti.url);

        if (!byMerchant[domain]) {
          byMerchant[domain] = {
            merchant: domain,
            items: [],
            subtotal: 0,
            shipping: 0,
            tax: 0,
            total: 0,
            savings: 0,
            count: 0
          };
        }

        const currentPrice =
          snap && typeof snap.valueNumeric === "number"
            ? snap.valueNumeric
            : ci.lastPrice ?? ci.addedPrice ?? null;

        const qty = ci.quantity || 1;
        const lineSubtotal =
          currentPrice != null ? currentPrice * qty : 0;

        const addedPrice = ci.addedPrice ?? null;
        const savings =
          addedPrice != null && currentPrice != null
            ? (addedPrice - currentPrice) * qty
            : 0;

        byMerchant[domain].items.push({
          cartItemId: ci.id,
          trackedItemId: ti.id,
          name: ti.name,
          quantity: qty,
          currentPrice,
          addedPrice,
          lineSubtotal,
          savings
        });

        byMerchant[domain].subtotal += lineSubtotal;
        byMerchant[domain].savings += savings;
        byMerchant[domain].count += qty;
      }

      // STEP 2 — Apply merchant rules (free shipping, tax)
      for (const domain of Object.keys(byMerchant)) {
        const m = byMerchant[domain];
        const rule = await prisma.merchantRule.findUnique({
          where: { domain }
        });

        const subtotal = m.subtotal;

        // shipping:
        let shipping = 0;
        if (rule) {
          const { freeShippingMin, flatShipping } = rule;
          if (
            freeShippingMin != null &&
            subtotal >= freeShippingMin
          ) {
            shipping = 0;
          } else {
            shipping = flatShipping ?? 5.99;
          }
        } else {
          // fallback logic
          shipping = subtotal >= 50 ? 0 : 5.99;
        }

        // tax:
        let tax = 0;
        if (rule?.taxRate != null) {
          tax = subtotal * rule.taxRate;
        } else {
          tax = subtotal * 0.085; // generic
        }

        m.shipping = shipping;
        m.tax = tax;
        m.total = subtotal + shipping + tax;
      }

      // STEP 3 — compute global totals
      let grandSubtotal = 0;
      let grandShipping = 0;
      let grandTax = 0;
      let grandTotal = 0;
      let grandSavings = 0;

      for (const domain of Object.keys(byMerchant)) {
        const m = byMerchant[domain];
        grandSubtotal += m.subtotal;
        grandShipping += m.shipping;
        grandTax += m.tax;
        grandTotal += m.total;
        grandSavings += m.savings;
      }

      return res.json({
        cartId: cart.id,
        name: cart.name,
        merchants: Object.values(byMerchant),
        totals: {
          subtotal: grandSubtotal,
          shipping: grandShipping,
          tax: grandTax,
          total: grandTotal,
          savings: grandSavings
        }
      });
    } catch (err) {
      console.error("GET /cart/:cartId/checkout-summary error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });


  return router;
}
