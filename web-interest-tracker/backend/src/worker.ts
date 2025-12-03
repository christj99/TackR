import dotenv from "dotenv";
import { PrismaClient, TrackedItem } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { load } from "cheerio";
import { chromium, Browser } from "playwright";
import { parseNumericFromText } from "./utils/parseValue";

dotenv.config();

type FingerprintNode = {
  tag: string;
  classes?: string[];
  nthOfType?: number | null;
};

type Fingerprint = {
  path: FingerprintNode[];
};

function cssFromNodeDescriptor(node: FingerprintNode): string {
  let sel = node.tag || "div";
  if (node.classes && node.classes.length) {
    const safeClasses = node.classes
      .filter(Boolean)
      .map((cls) => cls.replace(/"/g, '\\"'));
    if (safeClasses.length) {
      sel += "." + safeClasses.join(".");
    }
  }
  if (node.nthOfType && node.nthOfType > 0) {
    sel += `:nth-of-type(${node.nthOfType})`;
  }
  return sel;
}

function cssFromFingerprint(fp: Fingerprint): string {
  if (!fp.path || !fp.path.length) return "";
  return fp.path.map(cssFromNodeDescriptor).join(" > ");
}

async function tryFingerprintFallback(
  page: import("playwright").Page,
  item: TrackedItem
): Promise<string | null> {
  if (!item.fingerprint) {
    console.log(`Item ${item.id}: no fingerprint stored, skipping fallback`);
    return null;
  }

  const fp = item.fingerprint as unknown as Fingerprint;
  if (!fp.path || !Array.isArray(fp.path) || fp.path.length === 0) {
    console.log(`Item ${item.id}: invalid fingerprint shape`);
    return null;
  }

  const css = cssFromFingerprint(fp);
  if (!css) {
    console.log(`Item ${item.id}: fingerprint produced empty CSS`);
    return null;
  }

  console.log(
    `Item ${item.id}: fingerprint CSS fallback selector "${css}"`
  );

  const locator = page.locator(css);
  const count = await locator.count();
  console.log(
    `Item ${item.id}: fingerprint fallback matched ${count} element(s)`
  );

  if (count !== 1) {
    return null;
  }

  const first = locator.first();
  const text = ((await first.innerText()) || "").trim();
  if (!text) {
    console.log(
      `Item ${item.id}: fingerprint fallback element has empty innerText`
    );
    return null;
  }

  console.log(`Item ${item.id}: fingerprint fallback got "${text}"`);
  return text;
}


const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

const ENABLE_DYNAMIC =
  (process.env.ENABLE_DYNAMIC_SCRAPE || "true").toLowerCase() !== "false";

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await chromium.launch();
  return sharedBrowser;
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

async function fetchHtml(url: string, retry = 1): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WebInterestTracker/0.1; +https://example.com)"
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }

    return await res.text();
  } catch (err) {
    console.warn(`fetchHtml error for ${url}`, err);
    if (retry > 0) {
      console.log(`Retrying fetchHtml for ${url} (remaining retries: ${retry})`);
      return fetchHtml(url, retry - 1);
    }
    throw err;
  }
}


/**
 * Fast static HTML scrape using fetch + cheerio.
 * Returns the text content of the first matching element, or null if not found.
 */
async function tryStaticScrape(item: TrackedItem): Promise<string | null> {
  try {
    const html = await fetchHtml(item.url);
    const $ = load(html);
    const el = $(item.selector);

    if (el.length === 0) {
      console.log(`Item ${item.id}: static scrape selector missing`);
      return null;
    }

    const text = el.first().text().trim();
    console.log(`Item ${item.id}: static scrape got "${text}"`);
    return text || null;
  } catch (err) {
    console.warn(`Item ${item.id}: static scrape error`, err);
    return null; // allow dynamic fallback
  }
}

/**
 * Dynamic scrape using Playwright (headless Chromium).
 * Uses a shared browser instance for the whole worker run.
 */
async function tryDynamicScrape(item: TrackedItem): Promise<string | null> {
  if (!ENABLE_DYNAMIC) {
    console.log(`Item ${item.id}: dynamic scrape disabled by config`);
    return null;
  }

  const browser = await getBrowser();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  try {
    console.log(`Item ${item.id}: dynamic scrape visiting ${item.url}`);

    await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    // buffer for hydration
    await page.waitForTimeout(3000);

    // --- First pass: exact CSS selector ---
    const locator = page.locator(item.selector);
    const count = await locator.count();

    if (count > 0) {
      console.log(
        `Item ${item.id}: dynamic scrape selector "${item.selector}" matched ${count} element(s)`
      );
      const first = locator.first();
      const text = ((await first.innerText()) || "").trim();
      if (text) {
        console.log(`Item ${item.id}: dynamic scrape got "${text}"`);
        return text;
      } else {
        console.log(
          `Item ${item.id}: dynamic selector matched but innerText empty`
        );
      }
    } else {
      console.log(
        `Item ${item.id}: dynamic scrape selector "${item.selector}" matched 0 elements`
      );
    }

    // --- Second pass: structural fingerprint fallback ---
    const fpText = await tryFingerprintFallback(page, item);
    if (fpText) {
      return fpText;
    }

    // If both fail, no value from dynamic
    return null;
  } catch (err) {
    console.error(`Item ${item.id}: dynamic scrape error`, err);
    throw err;
  } finally {
    await page.close();
  }
}




async function processTrackedItem(id: number) {
  const item = await prisma.trackedItem.findUnique({ where: { id } });
  if (!item) return;

  try {
    // 1) Try static HTML first (fast + cheap)
    let text: string | null = await tryStaticScrape(item);

    // 2) If static failed or selector missing, try dynamic (if enabled)
    if (!text) {
      text = await tryDynamicScrape(item);
    }

    // 3) If still nothing, mark as missing
    if (!text) {
      await prisma.snapshot.create({
        data: {
          trackedItemId: item.id,
          valueRaw: "",
          valueNumeric: null,
          status: "missing"
        }
      });
      console.log(
        `Item ${item.id}: selector missing after static + dynamic (or dynamic disabled)`
      );
      return;
    }

    // 4) We got some text — parse numeric (if any) and store snapshot
    const numeric = parseNumericFromText(text);

    const snapshot = await prisma.snapshot.create({
      data: {
        trackedItemId: item.id,
        valueRaw: text,
        valueNumeric: numeric,
        status: "ok"
      }
    });

    console.log(
      `Item ${item.id}: captured "${text}" (numeric=${numeric ?? "null"})`
    );

    // Evaluate triggers if numeric
    if (typeof numeric === "number") {
      const triggers = await prisma.trigger.findMany({
        where: { trackedItemId: item.id, active: true }
      });

      for (const trig of triggers) {
        if (
          trig.lastFiredAt == null &&
          // Reuse the same semantics as meetsComparison in trackedItems.ts
          ((trig.comparison === "lt" && numeric < trig.threshold) ||
            (trig.comparison === "lte" && numeric <= trig.threshold) ||
            (trig.comparison === "gt" && numeric > trig.threshold) ||
            (trig.comparison === "gte" && numeric >= trig.threshold) ||
            (trig.comparison === "eq" && numeric === trig.threshold) ||
            (trig.comparison === "neq" && numeric !== trig.threshold))
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
            `Trigger ${trig.id} fired for item ${item.id} (value=${numeric}, comparison=${trig.comparison}, threshold=${trig.threshold})`
          );
        }
      }
    }

  } catch (err) {
    console.error(`Error processing item ${item.id}`, err);
    await prisma.snapshot.create({
      data: {
        trackedItemId: item.id,
        valueRaw: "",
        valueNumeric: null,
        status: "error"
      }
    });
  }
}

async function runOnce() {
  const items = await prisma.trackedItem.findMany();
  console.log(`Found ${items.length} tracked items`);

  for (const item of items) {
    await processTrackedItem(item.id);
  }

  console.log("Done.");
}

runOnce()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await closeBrowser();
    await prisma.$disconnect();
  });
