// src/services/aiAgent.ts
import OpenAI from "openai";
import { parse } from "node-html-parser";
import { parseNumericFromText } from "../utils/parseValue";



const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export type Proposal = {
  name?: string;
  selector: string;
  sampleText: string;
  type?: "price" | "number" | "text";
  valueNumeric?: number | null;
};

export type AgentProfile =
  | "ecommerce_price"   // ecommerce: price, rating, reviews, stock
  | "poll_average"      // polling / aggregate stats
  | "finance_metric"    // stock/crypto/market metrics
  | "sports_score"      // scores, odds, standings summaries
  | "news_headline"     // key headline + sentiment-ish score
  | "generic_metric";

  
  
export type NavigationPlan = {
  targetUrl: string;
  reason?: string;
  fallbackUrls?: string[]; // additional candidates to try if primary doesn't work
};


type LinkCandidate = {
  id: number;
  href: string;
  fullUrl: string;
  text: string;
};

export type Categorization = {
  category: string;
  tags: string[];
};

export async function categorizeTrackedItem(params: {
  name: string;
  url: string;
  type: string;
  sampleText?: string | null;
}): Promise<Categorization | null> {
  const { name, url, type, sampleText } = params;

  const systemPrompt = `
You are a tagging system for TackR, an app that tracks values on web pages.

Given a tracked item with:
- name (human label),
- URL,
- type ("price" | "number" | "text"),
- sampleText (the visible text/value),

You must:
1. Assign ONE short, high-level category, like:
   - "product_price"
   - "product_availability"
   - "product_reviews"
   - "polling_data"
   - "financial_metric"
   - "content_snippet"
   - "other_metric"
2. Assign 2-6 concise tags (lowercase words/phrases), e.g.:
   - ["lululemon", "jogger", "mens", "apparel", "price", "usd"]

Return ONLY a JSON object:
{
  "category": "string",
  "tags": ["tag1", "tag2", ...]
}

Rules:
- Category must be a single word or snake_case label.
- Tags should be short, descriptive, and derived from name/url/sampleText, NOT random.
- If unsure, category can be "other_metric".
`;

  const userPrompt = `
Tracked item:
- name: ${name}
- url: ${url}
- type: ${type}
- sampleText: ${sampleText ?? "(none)"}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    if (!raw) {
      console.error("categorizeTrackedItem: empty model response");
      return null;
    }

    const parsed = JSON.parse(raw) as Categorization;
    if (!parsed.category || !Array.isArray(parsed.tags)) {
      console.error(
        "categorizeTrackedItem: invalid JSON response:",
        parsed
      );
      return null;
    }

    return parsed;
  } catch (e) {
    console.error("categorizeTrackedItem: OpenAI error", e);
    return null;
  }
}


function extractLinkCandidates(startUrl: string, html: string): LinkCandidate[] {
  const root = parse(html);
  const anchors = root.querySelectorAll("a");
  const base = new URL(startUrl);
  const candidates: LinkCandidate[] = [];

  anchors.forEach((a, idx) => {
    const href = a.getAttribute("href");
    if (!href) return;

    try {
      const full = new URL(href, base).toString();
      const text =
        (a.text ||
          a.getAttribute("aria-label") ||
          a.getAttribute("title") ||
          "") // some sites put product name in aria-label/title
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 200);

      candidates.push({
        id: idx,
        href,
        fullUrl: full,
        text
      });
    } catch {
      // ignore bad URLs
    }
  });

  return candidates;
}

function scoreCandidateForInstruction(
  c: LinkCandidate,
  instruction: string
): number {
  const instr = instruction.toLowerCase();
  const combined = (c.text + " " + c.fullUrl).toLowerCase();

  const words = instr
    .split(/[^a-z0-9]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  let score = 0;

  // Match important words from the instruction
  for (const w of words) {
    if (!w) continue;
    if (combined.includes(w)) {
      score += 3;
    }
  }

  const url = c.fullUrl.toLowerCase();

  // Heuristics for ecommerce-like navigation:
  if (url.includes("/c/")) score += 3; // category pages
  if (url.includes("/category")) score += 2;
  if (url.includes("/men")) score += 1;
  if (url.includes("jogger")) score += 3;
  if (url.includes("pants")) score += 1;

  // Deprioritize obvious marketing/story pages unless they also scored well
  if (url.includes("/story/") && score < 5) {
    score -= 2;
  }

  // Avoid footers / legal / social
  if (
    url.includes("/privacy") ||
    url.includes("/terms") ||
    url.includes("twitter.com") ||
    url.includes("facebook.com") ||
    url.includes("instagram.com")
  ) {
    score -= 4;
  }

  return score;
}

function filterAndSortCandidatesForInstruction(
  candidates: LinkCandidate[],
  instruction: string
): LinkCandidate[] {
  if (!instruction.trim()) return candidates;

  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidateForInstruction(c, instruction)
  }));

  // Filter out very low-score candidates if we have enough decent ones
  const highScore = scored.filter((s) => s.score > 0);
  const pool =
    highScore.length >= 10
      ? highScore
      : scored; // fallback: keep everything if we have almost no signal

  // Sort descending by score
  pool.sort((a, b) => b.score - a.score);

  return pool.map((s) => s.candidate);
}


function buildSystemPrompt(profile: AgentProfile): string {
  const base = `
You are an assistant that chooses DOM elements to track on web pages.

You MUST:
- Return a SINGLE best element unless otherwise specified.
- Return a CSS selector that uniquely identifies that element.
- Return that element's visible text as "sampleText".
- Classify type as:
  - "price" if currency-like
  - "number" if numeric but not a price
  - "text" otherwise
- Optionally include "valueNumeric" if type is "price" or "number".
- Optionally include a friendly "name" for the item.
Return ONLY a JSON object: { selector, sampleText, type, valueNumeric, name }.
`;

  if (profile === "ecommerce_price") {
    return (
      base +
      `
For ecommerce pages:
- Prefer the MAIN product price (not crossed-out old prices, not per-installment info).
- Ignore coupon/discount messaging.
- If multiple prices exist, choose the one most visually prominent for the main product.
`
    );
  }

  if (profile === "poll_average") {
    return (
      base +
      `
For polling/aggregate data pages:
- Prefer the MAIN aggregate number (e.g. "Biden +2", "Trump 45.3%", "Polling average 48.1%" or similar).
- Avoid individual poll entries; choose an overall summary number.
`
    );
  }

  return base;
}

export type MultiProposalItem = {
  name: string;
  selector: string;
  sampleText: string;
  type: "price" | "number" | "text";
  valueNumeric?: number | null;
};

export type MultiProposal = {
  items: MultiProposalItem[];
};

function buildMultiSystemPrompt(profile: AgentProfile): string {
  const base = `
You are an assistant that chooses DOM elements to track on web pages.

Given a user instruction and the HTML of a single page, you must choose MULTIPLE elements to track.

Return an object:
{
  "items": [
    {
      "name": string,          // human-readable label, e.g. "Price", "Rating", "Review Count"
      "selector": string,      // CSS selector that uniquely identifies that element
      "sampleText": string,    // visible text content
      "type": "price" | "number" | "text",
      "valueNumeric": number | null
    },
    ...
  ]
}

General rules:
- Only include items that are clearly relevant to the user instruction.
- Ensure each selector targets exactly one element.
- "price" if the text looks like currency, "number" for numeric metrics, "text" otherwise.
- valueNumeric should be parsed numeric value for "price" / "number" when possible.
`;

  if (profile === "ecommerce_price") {
    return (
      base +
      `
Profile: ecommerce_price
Focus on the main product and related metrics. Good candidates:
- Main product price (NOT crossed-out prices or per-installment text).
- Aggregate rating (e.g. "4.6", "4.6 out of 5").
- Number of reviews.
- Clear stock/availability text (e.g. "In stock", "Out of stock").

Avoid:
- Individual review snippets.
- Coupon codes, shipping estimates, or upsell modules.
`
    );
  }

  if (profile === "poll_average") {
    return (
      base +
      `
Profile: poll_average
Focus on aggregate polling / summary statistics. Good candidates:
- Main aggregate number (e.g. "Biden +2", "Polling average 48.1%").
- Overall approval / disapproval percentages.
- Clearly labeled averages or summary rows.

Avoid:
- Individual poll rows.
- Raw tables of all polls unless one row is marked as "average".
`
    );
  }

  if (profile === "finance_metric") {
    return (
      base +
      `
Profile: finance_metric
Focus on the key quote metrics for a stock/crypto/index. Good candidates:
- Last / current price.
- Daily % change and/or absolute change.
- Market cap or volume if prominently displayed.

Avoid:
- Long tables of historical prices.
- Irrelevant news headlines unless the instruction explicitly asks for them.
`
    );
  }

  if (profile === "sports_score") {
    return (
      base +
      `
Profile: sports_score
Focus on the current or final score and key game summary metrics. Good candidates:
- Current or final score (home vs away).
- Game status (e.g. "Q3 10:24", "Final").
- Odds / spread for the main game, if present.

Avoid:
- Standings tables for all teams unless the instruction is about standings.
- Full box scores unless the instruction asks for detailed stats.
`
    );
  }

  if (profile === "news_headline") {
    return (
      base +
      `
Profile: news_headline
Focus on the main story elements. Good candidates:
- Main headline text.
- Subheadline or dek line.
- Timestamp or "Last updated" if clearly visible.

Avoid:
- Sidebar / unrelated headlines.
- Long article body text blocks.
`
    );
  }

  // Fallback: generic behavior
  return base + `
Profile: generic_metric
Choose the most relevant metrics or text snippets based on the user instruction. Prefer concise, high-signal values over long bodies of text.
`;
}


export async function analyzePageAndProposeSelectorsMulti(params: {
  prompt: string;
  url: string;
  profile?: AgentProfile;
}): Promise<MultiProposal | null> {
  const { prompt, url, profile = "generic_metric" } = params;

  let html: string;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`fetch failed for ${url} with status ${res.status}`);
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.error(`Network/fetch error for ${url}`, e);
    return null;
  }

  const truncatedHtml =
    html.length > 20000 ? html.slice(0, 20000) : html;
    
  const systemPrompt = buildMultiSystemPrompt(profile);


  const userPrompt = `
User instruction:
"${prompt}"

URL:
${url}

HTML (truncated):
${truncatedHtml}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    if (!raw) {
      console.error("Model returned empty content (multi)");
      return null;
    }

    let data: MultiProposal;
    try {
      data = JSON.parse(raw) as MultiProposal;
    } catch (e) {
      console.error("Failed to parse multi-model JSON:", raw);
      return null;
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      console.error("Multi-model returned no items:", data);
      return null;
    }

    return data;
  } catch (e) {
    console.error("OpenAI error (multi) for", url, e);
    return null;
  }
}

  
export async function analyzePageAndProposeSelector(params: {
  prompt: string;
  url: string;
  profile?: AgentProfile;
}): Promise<Proposal | null> {
  const { prompt, url, profile = "generic_metric" } = params;
  

  // 1) Fetch HTML
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`fetch failed for ${url} with status ${res.status}`);
    return null;
  }
  const html = await res.text();

  // Truncate so we don't send megabytes to the model
  const truncatedHtml =
    html.length > 20000 ? html.slice(0, 20000) : html;

    const systemPrompt = buildSystemPrompt(profile);


  const userPrompt = `
User instruction:
"${prompt}"

URL:
${url}

HTML (truncated):
${truncatedHtml}
`;

  // 2) Call OpenAI Responses API in JSON mode
  // 2) Call OpenAI Chat Completions API in JSON mode
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini", // or any JSON-capable chat model you prefer
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }
  });

  const raw = completion.choices[0].message.content;
  if (!raw) {
    console.error("Model returned empty content");
    return null;
  }

  let data: Proposal;
  try {
    data = JSON.parse(raw) as Proposal;
  } catch (e) {
    console.error("Failed to parse model JSON:", raw);
    return null;
  }


  try {
    data = JSON.parse(raw) as Proposal;
  } catch (e) {
    console.error("Failed to parse model JSON:", raw);
    return null;
  }

  if (!data.selector || !data.sampleText) {
    console.error("Model returned incomplete proposal:", data);
    return null;
  }

  return {
    selector: data.selector,
    sampleText: data.sampleText,
    type: data.type ?? "text",
    valueNumeric:
      typeof data.valueNumeric === "number"
        ? data.valueNumeric
        : null,
    name: data.name
  };
}

// src/services/aiAgent.ts (add this)

export async function repairSelectorWithAI(params: {
  url: string;
  originalSelector: string;
  sampleText?: string | null;
  fingerprint?: any; // whatever shape you used; we just pass it through for context
}): Promise<Proposal | null> {
  const { url, originalSelector, sampleText, fingerprint } = params;

  // 1) Fetch fresh HTML
  let html: string;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `repairSelectorWithAI: fetch failed for ${url} with status ${res.status}`
      );
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.error(`repairSelectorWithAI: network error for ${url}`, e);
    return null;
  }

  const truncatedHtml =
    html.length > 20000 ? html.slice(0, 20000) : html;

  // 2) System + user prompts
  const systemPrompt = `
You are an assistant that repairs broken CSS selectors when page HTML changes.

Given:
- The OLD selector (which used to work on this URL).
- Previously seen text near that element ("sampleText").
- Optional DOM fingerprint hints (path of tags/classes).
- The NEW HTML of the same URL.

Your job:
1. Find the element in the NEW HTML that corresponds to the same semantic content as before
   (e.g., the main product price, rating, etc.).
2. Propose a NEW CSS selector for that element.
3. Return a JSON object:

{
  "selector": string,        // new CSS selector
  "sampleText": string,      // visible text of that element
  "type": "price" | "number" | "text",
  "valueNumeric": number | null,
  "name": string | null
}

Rules:
- If you CANNOT find a good match, return {} (empty object).
- Prefer short, robust selectors (classes / data attributes) over brittle absolute paths.
- "price" if it looks like a currency amount, "number" for plain numeric metrics, otherwise "text".
- Do NOT include explanations, ONLY the JSON object.
`;

  const userPrompt = `
URL:
${url}

OLD selector:
${originalSelector}

Previously seen text ("sampleText"):
${sampleText ?? "(none provided)"}

Fingerprint (DOM path hints, if any):
${fingerprint ? JSON.stringify(fingerprint, null, 2) : "(none)"}

NEW HTML (truncated):
${truncatedHtml}
`;

  // 3) Call the model
  let raw: string | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    raw = completion.choices[0].message.content;
  } catch (e) {
    console.error("repairSelectorWithAI: OpenAI error", e);
    return null;
  }

  if (!raw) {
    console.error("repairSelectorWithAI: model returned empty content");
    return null;
  }

  let data: Partial<Proposal>;
  try {
    data = JSON.parse(raw) as Partial<Proposal>;
  } catch (e) {
    console.error("repairSelectorWithAI: failed to parse JSON:", raw);
    return null;
  }

  if (!data.selector || typeof data.selector !== "string") {
    console.error(
      "repairSelectorWithAI: model did not provide a selector:",
      data
    );
    return null;
  }

  // 4) Validate the selector actually matches something in the NEW HTML
  try {
    const root = parse(html);
    const el = root.querySelector(data.selector);
    if (!el) {
      console.error(
        `repairSelectorWithAI: proposed selector "${data.selector}" matches no element`
      );
      return null;
    }

    const text = (data.sampleText ?? el.textContent ?? "").trim();
    if (!text) {
      console.error(
        `repairSelectorWithAI: proposed selector "${data.selector}" produced empty text`
      );
      return null;
    }

    // Fill in type / numeric if missing
    let type: "price" | "number" | "text" =
      data.type ?? "text";
    let numeric: number | null =
      typeof data.valueNumeric === "number"
        ? data.valueNumeric
        : null;

    if (!numeric) {
      const parsedNum = parseNumericFromText(text);
      if (typeof parsedNum === "number") {
        numeric = parsedNum;
        if (!data.type) {
          // If it looks like currency, caller can still interpret as "price"
          type = "number";
        }
      }
    }

    const proposal: Proposal = {
      selector: data.selector,
      sampleText: text,
      type,
      valueNumeric: numeric,
      name: data.name
    };

    return proposal;
  } catch (e) {
    console.error(
      "repairSelectorWithAI: error validating selector against HTML",
      e
    );
    return null;
  }
}


export async function planNavigationForProduct(params: {
  startUrl: string;
  instruction: string;
}): Promise<NavigationPlan | null> {
  const { startUrl, instruction } = params;

  let html: string;
  try {
    console.log("[NAV] Fetching", startUrl);
    const res = await fetch(startUrl);
    if (!res.ok) {
      console.error(
        `planNavigationForProduct: fetch failed for ${startUrl} with status ${res.status}`
      );
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.error(
      `planNavigationForProduct: network/fetch error for ${startUrl}`,
      e
    );
    return null;
  }

  const candidates = extractLinkCandidates(startUrl, html);
  if (candidates.length === 0) {
    console.error("[NAV] No link candidates found on page");
    return null;
  }

  // limit to keep prompt size manageable
  const limited = candidates.slice(0, 200);

  const systemPrompt = `
You are an assistant that chooses which product detail link to follow from a category/search page.

You are given:
- A user instruction describing the desired product.
- A list of link candidates already extracted from the page. Each has:
  - "id": a numeric identifier
  - "fullUrl": absolute URL
  - "text": visible text or label near the link

Your job:
- Choose ONE primary candidate whose link most likely leads to the correct product detail page.
- Optionally choose 1-3 fallback candidates in case the primary link does not have the expected content.
- Return ONLY a JSON object:

{
  "primaryId": number,
  "fallbackIds": number[],    // optional, may be empty
  "reason": "short explanation of why this link was chosen"
}


Rules:
- You MUST pick an id that exists in the provided candidates array.
- Do NOT invent new URLs.
- Prefer product detail links (names like the product, possibly with color or code), not filters or nav menus.
- If you truly cannot find any reasonable candidate, return: { "candidateId": -1, "reason": "why" }.
`;

  const userPrompt = `
Instruction:
"${instruction}"

startUrl:
${startUrl}

Link candidates (truncated list):
${JSON.stringify(
  limited.map((c) => ({
    id: c.id,
    fullUrl: c.fullUrl,
    text: c.text
  })),
  null,
  2
)}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    console.log("[NAV] Raw model response:", raw);

    if (!raw) {
      console.error(
        "planNavigationForProduct: model returned empty content"
      );
      return null;
    }

    let parsed: {
      primaryId?: number;
      fallbackIds?: number[];
      reason?: string;
    };

    try {
      parsed = JSON.parse(raw) as {
        primaryId?: number;
        fallbackIds?: number[];
        reason?: string;
      };
    } catch (e) {
      console.error("planNavigationForProduct: failed to parse JSON:", raw);
      return null;
    }

    if (
      typeof parsed.primaryId !== "number" ||
      parsed.primaryId < 0
    ) {
      console.error(
        "planNavigationForProduct: model did not choose a valid primaryId:",
        parsed
      );
      return null;
    }

    const primary = candidates.find((c) => c.id === parsed.primaryId);

    if (!primary) {
      console.error(
        "planNavigationForProduct: chosen primaryId not found in candidates:",
        parsed.primaryId
      );
      return null;
    }

    // Map fallbackIds -> URLs, ignoring invalid ids
    const fallbackIds = Array.isArray(parsed.fallbackIds)
      ? parsed.fallbackIds
      : [];

    const fallbackCandidates = fallbackIds
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is LinkCandidate => Boolean(c));

    return {
      targetUrl: primary.fullUrl,
      reason: parsed.reason,
      fallbackUrls: fallbackCandidates.map((c) => c.fullUrl)
    };

  } catch (e) {
    console.error("planNavigationForProduct: OpenAI error for", startUrl, e);
    return null;
  }
}

export async function planNavigationForPage(params: {
  startUrl: string;
  instruction: string;
}): Promise<NavigationPlan | null> {
  const { startUrl, instruction } = params;

  let html: string;
  try {
    console.log("[NAV-PAGE] Fetching", startUrl);
    const res = await fetch(startUrl);
    if (!res.ok) {
      console.error(
        `planNavigationForPage: fetch failed for ${startUrl} with status ${res.status}`
      );
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.error(
      `planNavigationForPage: network/fetch error for ${startUrl}`,
      e
    );
    return null;
  }

  let candidates = extractLinkCandidates(startUrl, html);
  if (candidates.length === 0) {
    console.error("[NAV-PAGE] No link candidates found on page");
    return null;
  }

  // 🔥 NEW: instruction-aware filtering + ranking
  const ranked = filterAndSortCandidatesForInstruction(
    candidates,
    instruction
  );

  // We don't want to blow up the prompt, so keep top N
  const limited = ranked.slice(0, 200);

  const systemPrompt = `
You are an assistant that chooses which page link to follow next from a site homepage or category page.

You are given:
- A user instruction describing the desired product or target.
- A list of link candidates extracted from the current page. Each has:
  - "id": numeric identifier
  - "fullUrl": absolute URL
  - "text": visible text or label near the link

Your job:
- Choose ONE primary candidate that is the best "next step" toward fulfilling the instruction.
- Optionally choose 1-3 fallback candidates in case the primary link is not ideal.
- Return ONLY a JSON object:

{
  "primaryId": number,
  "fallbackIds": number[],    // optional, may be empty
  "reason": "short explanation of why this link was chosen"
}


Rules:
- You MUST pick an "id" that exists in the provided candidates.
- Do NOT invent new URLs.
- Prefer:
  - category/search pages or product grid pages when starting from a generic homepage
  - product detail links when already on a product grid.
- If you truly cannot find any reasonable candidate, return: { "candidateId": -1, "reason": "why" }.
`;

  const userPrompt = `
Instruction:
"${instruction}"

startUrl:
${startUrl}

Top link candidates (already pre-ranked; id refers to original id):
${JSON.stringify(
  limited.map((c) => ({
    id: c.id,
    fullUrl: c.fullUrl,
    text: c.text
  })),
  null,
  2
)}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    console.log("[NAV-PAGE] Raw model response:", raw);

    if (!raw) {
      console.error(
        "planNavigationForPage: model returned empty content"
      );
      return null;
    }

    let parsed: {
      primaryId?: number;
      fallbackIds?: number[];
      reason?: string;
    };

    try {
      parsed = JSON.parse(raw) as {
        primaryId?: number;
        fallbackIds?: number[];
        reason?: string;
      };
    } catch (e) {
      console.error("planNavigationForPage: failed to parse JSON:", raw);
      return null;
    }

    if (
      typeof parsed.primaryId !== "number" ||
      parsed.primaryId < 0
    ) {
      console.error(
        "planNavigationForPage: model did not choose a valid primaryId:",
        parsed
      );
      return null;
    }

    const primary = candidates.find((c) => c.id === parsed.primaryId);

    if (!primary) {
      console.error(
        "planNavigationForPage: chosen primaryId not found in candidates:",
        parsed.primaryId
      );
      return null;
    }

    const fallbackIds = Array.isArray(parsed.fallbackIds)
      ? parsed.fallbackIds
      : [];

    const fallbackCandidates = fallbackIds
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is LinkCandidate => Boolean(c));

    return {
      targetUrl: primary.fullUrl,
      reason: parsed.reason,
      fallbackUrls: fallbackCandidates.map((c) => c.fullUrl)
    };

  } catch (e) {
    console.error("planNavigationForPage: OpenAI error for", startUrl, e);
    return null;
  }
}
