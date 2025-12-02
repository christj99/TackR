// src/services/aiAgent.ts
import OpenAI from "openai";
import { parse } from "node-html-parser";


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
  | "ecommerce_price"
  | "poll_average"
  | "generic_metric";
  
  
export type NavigationPlan = {
  targetUrl: string;
  reason?: string;
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

  const systemPrompt = `
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

Rules:
- Only include items that are clearly relevant to the user instruction.
- For ecommerce, good candidates: main price, rating, number of reviews, stock/availability text.
- Ensure each selector targets exactly one element.

Return ONLY a JSON object with this shape.
`;

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

  let html: string;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`repairSelectorWithAI: fetch failed for ${url} with status ${res.status}`);
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.error(`repairSelectorWithAI: network/fetch error for ${url}`, e);
    return null;
  }

  const truncatedHtml =
    html.length > 20000 ? html.slice(0, 20000) : html;

  const systemPrompt = `
You are an assistant that repairs broken CSS selectors on web pages.

The user previously tracked an element using an OLD selector and its text.
The page has changed, so the old selector may no longer point to the right element.

Your job:
1. Use the OLD selector, the previously seen text ("sampleText"), and the fingerprint info (DOM path hints) as guidance.
2. Inspect the NEW HTML and find the SINGLE element that best matches what was previously tracked.
   - Similar visible text / price / label.
   - Similar DOM context (if fingerprint hints are provided).
3. Return:
   - "selector": a NEW CSS selector that uniquely identifies that element in the NEW HTML.
   - "sampleText": the current visible text of that element.
   - "type": "price" | "number" | "text" (same rules as before).
   - "valueNumeric": numeric value if applicable.
   - "name": optional human-readable name (if you can infer it).

Rules:
- If you cannot find a good match, return an empty JSON object: {}.
- Do NOT return explanations, ONLY a JSON object.
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
      console.error("repairSelectorWithAI: model returned empty content");
      return null;
    }

    let data: Proposal;
    try {
      data = JSON.parse(raw) as Proposal;
    } catch (e) {
      console.error("repairSelectorWithAI: failed to parse model JSON:", raw);
      return null;
    }

    if (!data.selector || !data.sampleText) {
      console.error("repairSelectorWithAI: incomplete proposal:", data);
      return null;
    }

    return {
      selector: data.selector,
      sampleText: data.sampleText,
      type: data.type ?? "text",
      valueNumeric:
        typeof data.valueNumeric === "number" ? data.valueNumeric : null,
      name: data.name
    };
  } catch (e) {
    console.error("repairSelectorWithAI: OpenAI error for", url, e);
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
- Choose EXACTLY ONE candidate whose link most likely leads to the product detail page that matches the instruction.
- Return ONLY a JSON object:

{
  "candidateId": number,
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

    const parsed = JSON.parse(raw) as { candidateId?: number; reason?: string };

    if (
      typeof parsed.candidateId !== "number" ||
      parsed.candidateId < 0
    ) {
      console.error(
        "planNavigationForProduct: model did not choose a valid candidateId:",
        parsed
      );
      return null;
    }

    const candidate = candidates.find(
      (c) => c.id === parsed.candidateId
    );
    if (!candidate) {
      console.error(
        "planNavigationForProduct: chosen candidateId not found in candidates:",
        parsed.candidateId
      );
      return null;
    }

    return {
      targetUrl: candidate.fullUrl,
      reason: parsed.reason
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
- Choose EXACTLY ONE candidate that is the best "next step" toward fulfilling the instruction.
  - This might be a category page (e.g. "Men's Joggers"), a search results page, or even the product detail page itself.
- Return ONLY a JSON object:

{
  "candidateId": number,
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

    const parsed = JSON.parse(raw) as {
      candidateId?: number;
      reason?: string;
    };

    if (
      typeof parsed.candidateId !== "number" ||
      parsed.candidateId < 0
    ) {
      console.error(
        "planNavigationForPage: model did not choose a valid candidateId:",
        parsed
      );
      return null;
    }

    const candidate = candidates.find(
      (c) => c.id === parsed.candidateId
    );
    if (!candidate) {
      console.error(
        "planNavigationForPage: chosen candidateId not found in candidates:",
        parsed.candidateId
      );
      return null;
    }

    return {
      targetUrl: candidate.fullUrl,
      reason: parsed.reason
    };
  } catch (e) {
    console.error("planNavigationForPage: OpenAI error for", startUrl, e);
    return null;
  }
}
