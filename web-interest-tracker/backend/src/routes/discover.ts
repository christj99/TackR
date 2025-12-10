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

export default function discoverRouter(prisma: PrismaClient) {
  const router = Router();

  // GET /discover
  //
  // Returns:
  //  - trendingDomains: domains with lots of items / activity
  //  - topProfiles: profile usage stats (ecommerce_price, finance_metric, etc.)
  //  - recommendedItems: interesting items not yet on any boards (For-You style)
  //
  router.get("/", async (_req, res) => {
    try {
      const DAYS = 7;
      const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

      // Pull all active tracked items with recent snapshots + board membership
      const items = await prisma.trackedItem.findMany({
        where: { isActive: true },
        include: {
          snapshots: {
            where: { takenAt: { gte: since } },
            orderBy: { takenAt: "asc" }
          },
          boardItems: true
        }
      });

      // -------------------------------------------------------------------
      // 1) Trending domains
      // -------------------------------------------------------------------
      type DomainStats = {
        domain: string;
        itemCount: number;
        snapshotCount: number;
        lastActivityAt: Date | null;
        profiles: Record<string, number>;
      };

      const domainMap = new Map<string, DomainStats>();

      for (const item of items) {
        const domain = getDomainFromUrl(item.url) ?? "unknown";
        const profile = item.profile ?? "unknown";

        if (!domainMap.has(domain)) {
          domainMap.set(domain, {
            domain,
            itemCount: 0,
            snapshotCount: 0,
            lastActivityAt: null,
            profiles: {}
          });
        }

        const stats = domainMap.get(domain)!;
        stats.itemCount += 1;
        stats.snapshotCount += item.snapshots.length;

        if (!stats.profiles[profile]) {
          stats.profiles[profile] = 0;
        }
        stats.profiles[profile] += 1;

        const lastSnap = item.snapshots[item.snapshots.length - 1];
        if (lastSnap) {
          const ts = lastSnap.takenAt as any;
          const snapDate = ts instanceof Date ? ts : new Date(ts);
          if (
            !stats.lastActivityAt ||
            snapDate.getTime() > stats.lastActivityAt.getTime()
          ) {
            stats.lastActivityAt = snapDate;
          }
        }
      }

      const trendingDomains = Array.from(domainMap.values())
        .map((d) => ({
          domain: d.domain,
          itemCount: d.itemCount,
          snapshotCount: d.snapshotCount,
          lastActivityAt: d.lastActivityAt
            ? d.lastActivityAt.toISOString()
            : null,
          profiles: d.profiles
        }))
        // simple sort: many items + recent activity first
        .sort((a, b) => {
          const aScore =
            a.itemCount +
            (a.lastActivityAt ? new Date(a.lastActivityAt).getTime() / 1e11 : 0);
          const bScore =
            b.itemCount +
            (b.lastActivityAt ? new Date(b.lastActivityAt).getTime() / 1e11 : 0);
          return bScore - aScore;
        })
        .slice(0, 10);

      // -------------------------------------------------------------------
      // 2) Top profiles (ecommerce_price, finance_metric, etc.)
      // -------------------------------------------------------------------
      type ProfileStats = {
        profile: string;
        itemCount: number;
        lastActivityAt: Date | null;
      };

      const profileMap = new Map<string, ProfileStats>();

      for (const item of items) {
        const profile = item.profile ?? "unknown";

        if (!profileMap.has(profile)) {
          profileMap.set(profile, {
            profile,
            itemCount: 0,
            lastActivityAt: null
          });
        }

        const stats = profileMap.get(profile)!;
        stats.itemCount += 1;

        const lastSnap = item.snapshots[item.snapshots.length - 1];
        if (lastSnap) {
          const ts = lastSnap.takenAt as any;
          const snapDate = ts instanceof Date ? ts : new Date(ts);
          if (
            !stats.lastActivityAt ||
            snapDate.getTime() > stats.lastActivityAt.getTime()
          ) {
            stats.lastActivityAt = snapDate;
          }
        }
      }

      const topProfiles = Array.from(profileMap.values())
        .map((p) => ({
          profile: p.profile,
          itemCount: p.itemCount,
          lastActivityAt: p.lastActivityAt
            ? p.lastActivityAt.toISOString()
            : null
        }))
        .sort((a, b) => b.itemCount - a.itemCount);

      // -------------------------------------------------------------------
      // 3) Recommended items: active, interesting, NOT already on any board
      //    (So "things worth pinning somewhere")
      // -------------------------------------------------------------------
      type RecommendedItem = {
        id: number;
        name: string;
        url: string;
        domain: string | null;
        type: string;
        profile: string | null;
        category: string | null;
        tags: any | null;
        latestSnapshot: {
          id: number;
          valueRaw: string;
          valueNumeric: number | null;
          status: string;
          takenAt: string;
        } | null;
        metrics: {
          snapshotCount: number;
          changeCount: number;
          delta: number | null;
          deltaPct: number | null;
          freshnessScore: number;
          score: number;
        };
      };

      const recommended: RecommendedItem[] = [];

      for (const item of items) {
        // Skip items already on a board (assume these are already "discovered")
        if (item.boardItems && item.boardItems.length > 0) continue;

        const snaps = item.snapshots;
        if (snaps.length === 0) continue;

        const first = snaps[0];
        const latest = snaps[snaps.length - 1];

        const numericSeries = snaps
          .map((s: any) => s.valueNumeric)
          .filter((v: any): v is number => typeof v === "number");

        const snapshotCount = snaps.length;
        let changeCount = 0;

        if (numericSeries.length > 1) {
          let prev = numericSeries[0];
          for (let i = 1; i < numericSeries.length; i++) {
            const v = numericSeries[i];
            if (v !== prev) {
              changeCount++;
              prev = v;
            }
          }
        }

        let delta: number | null = null;
        let deltaPct: number | null = null;

        if (
          typeof first.valueNumeric === "number" &&
          typeof latest.valueNumeric === "number"
        ) {
          delta = latest.valueNumeric - first.valueNumeric;
          if (Math.abs(first.valueNumeric) > 1e-9) {
            deltaPct = delta / Math.abs(first.valueNumeric);
          }
        }

        // Freshness 0–1 based on latest snapshot within the window
        const now = Date.now();
        const latestTs = new Date(latest.takenAt as any).getTime();
        const ageMs = now - latestTs;
        const windowMs = DAYS * 24 * 60 * 60 * 1000;

        const freshnessScore = Math.max(
          0,
          1 - ageMs / windowMs
        );

        // -----------------------------------------------------------------
        // Scoring components:
        //  - changeScore: "how often did it move?" (diminishing returns)
        //  - magnitudeScore: "how big was the movement?" (capped)
        //  - historyScore: "do we have a reasonable history?"
        //  - freshnessScore: "how recent is the latest movement?"
        // -----------------------------------------------------------------

        // 1) Change frequency (0–1, with diminishing returns)
        //    1 change -> ok, 3–5 changes -> good, 10+ changes -> saturated
        const normalizedChanges = Math.min(changeCount, 10) / 10;
        const changeScore = Math.sqrt(normalizedChanges); // concave curve

        // 2) Magnitude of movement (0–1, cap at 50% move)
        let magnitudeScore = 0;
        if (deltaPct != null) {
          const capped = Math.min(Math.abs(deltaPct), 0.5); // treat 50%+ the same
          magnitudeScore = capped / 0.5; // 0–1
        }

        // 3) History depth (0–1, more snapshots is better but saturates)
        const historyScore = Math.min(
          Math.log2(snapshotCount + 1) / 4,
          1
        );

        // 4) Base score: weighted combination
        const baseScore =
          0.35 * changeScore +   // how often it moves
          0.35 * magnitudeScore + // how far it moved
          0.20 * freshnessScore + // how recent
          0.10 * historyScore;    // how much data we have

        // 5) Apply additional time-decay: very stale items get dampened
        const score = baseScore * (0.6 + 0.4 * freshnessScore);


        if (score <= 0) continue;

        recommended.push({
          id: item.id,
          name: item.name,
          url: item.url,
          domain: getDomainFromUrl(item.url),
          type: item.type,
          profile: item.profile ?? null,
          category: (item as any).category ?? null,
          tags: (item as any).tags ?? null,
          latestSnapshot: latest
            ? {
                id: latest.id,
                valueRaw: latest.valueRaw,
                valueNumeric: latest.valueNumeric,
                status: latest.status,
                takenAt: latest.takenAt.toISOString
                  ? latest.takenAt.toISOString()
                  : new Date(latest.takenAt as any).toISOString()
              }
            : null,
          metrics: {
            snapshotCount,
            changeCount,
            delta,
            deltaPct,
            freshnessScore,
            score
          }
        });
      }

      recommended.sort((a, b) => b.metrics.score - a.metrics.score);
      const TOP_N = 20;
      const topRecommended = recommended.slice(0, TOP_N);

      return res.json({
        windowDays: DAYS,
        trendingDomains,
        topProfiles,
        recommendedItems: topRecommended
      });
    } catch (err) {
      console.error("GET /discover error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
