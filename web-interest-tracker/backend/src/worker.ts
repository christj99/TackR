import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { parseNumericFromText } from "./utils/parseValue";

dotenv.config();

const prisma = new PrismaClient();

async function fetchHtml(url: string): Promise<string> {
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
}

async function processTrackedItem(id: number) {
  const item = await prisma.trackedItem.findUnique({ where: { id } });
  if (!item) return;

  try {
    const html = await fetchHtml(item.url);
    const $ = load(html);
    const el = $(item.selector);

    if (el.length === 0) {
      await prisma.snapshot.create({
        data: {
          trackedItemId: item.id,
          valueRaw: "",
          valueNumeric: null,
          status: "missing"
        }
      });
      console.log(`Item ${item.id}: selector missing`);
      return;
    }

    const text = el.first().text().trim();
    const numeric = parseNumericFromText(text);

    await prisma.snapshot.create({
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
    await prisma.$disconnect();
  });
