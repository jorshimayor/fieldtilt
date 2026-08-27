/**
 * Grounded web lookup — Gemini free tier with the google_search tool.
 *
 * Fills the gaps the structured providers can't cover on the free plan:
 * domestic cup fixtures, lower-league opponents, kickoff times, team news.
 * Every answer carries its source URLs; the chat agent is REQUIRED to cite
 * them, so this never becomes an invented-stats side door.
 *
 * Free-tier quotas are real (per-minute + per-day grounded-query caps):
 * one retry on 429/5xx, then a clean failure the agent can report.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey(): string {
  const k = (globalThis as any).process?.env?.GEMINI_API_KEY || "";
  if (!k) throw new Error("web_lookup_unconfigured: GEMINI_API_KEY not set");
  return k;
}

function model(): string {
  return (globalThis as any).process?.env?.GEMINI_MODEL || "gemini-3.6-flash";
}

export type GroundedAnswer = {
  answer: string;
  /** Source URLs from the grounding metadata (may be redirect URLs). */
  sources: string[];
  /** Human-readable source titles/domains where available. */
  sourceTitles: string[];
};

/** Pure parser — unit-tested against the generateContent response shape. */
export function parseGroundedResponse(json: any): GroundedAnswer {
  const cand = (json?.candidates || [])[0] || {};
  const answer = ((cand.content?.parts as any[]) || [])
    .map((p) => p?.text || "")
    .join("")
    .trim();
  const chunks = (cand.groundingMetadata?.groundingChunks as any[]) || [];
  const sources: string[] = [];
  const sourceTitles: string[] = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    if (uri && !sources.includes(uri)) {
      sources.push(uri);
      sourceTitles.push(ch?.web?.title || uri);
    }
  }
  return { answer, sources, sourceTitles };
}

/** Pure parser for the DuckDuckGo HTML results page — unit-tested. */
export function parseDdgHtml(htmlText: string): { title: string; url: string; snippet: string }[] {
  const links = [...htmlText.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...htmlText.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const clean = (t: string) =>
    t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
  return links.slice(0, 6).map((m, i) => {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    return { title: clean(m[2]), url, snippet: clean(snips[i]?.[1] || "") };
  });
}

/**
 * Free fallback: DuckDuckGo results + the house LLM to synthesize an answer
 * strictly from the snippets, with the result URLs as sources.
 */
async function ddgLookup(question: string): Promise<GroundedAnswer> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(question)}`,
    { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } }
  );
  if (!res.ok) throw new Error(`web_lookup_ddg_failed_${res.status}`);
  const results = parseDdgHtml(await res.text());
  if (!results.length) throw new Error("web_lookup_ddg_empty: no results");

  const { routeAndChat } = await import("../shared/openrouter");
  const context = results
    .map((r, i) => `[${i + 1}] ${r.title} (${new URL(r.url).hostname})\n${r.snippet}`)
    .join("\n\n");
  const out = await routeAndChat({
    messages: [
      {
        role: "system",
        content:
          "Answer the question using ONLY the search snippets provided. Cite which numbered source(s) support the answer. If the snippets don't contain the answer, reply exactly: NOT FOUND. One or two sentences, no preamble.",
      },
      { role: "user", content: `Question: ${question}\n\nSearch snippets:\n${context}` },
    ],
  });
  const answer = (out.content || "").trim();
  if (!answer || answer === "NOT FOUND") throw new Error("web_lookup_not_found: sources did not contain the answer");
  return {
    answer,
    sources: results.map((r) => r.url),
    sourceTitles: results.map((r) => `${r.title} — ${new URL(r.url).hostname}`),
  };
}

export async function groundedLookup(question: string): Promise<GroundedAnswer> {
  const url = `${GEMINI_BASE}/${model()}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: question }] }],
    tools: [{ google_search: {} }],
  });

  // Gemini grounding first (best quality when the project has grounding
  // quota — currently it 429s: grounding is billing-gated on new projects),
  // then the free DDG + house-LLM fallback.
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
      const parsed = parseGroundedResponse((await res.json().catch(() => ({}))) as any);
      if (parsed.answer) return parsed;
    }
  } catch {
    /* fall through to DDG */
  }
  return ddgLookup(question);
}
