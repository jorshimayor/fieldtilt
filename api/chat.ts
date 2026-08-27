export const config = { runtime: "edge" };

/**
 * Agentic compose chat (protected by CRON_SECRET).
 *
 *   POST /api/chat { messages: [{role:"user"|"assistant", content:string}, …] }
 *   → { reply, toolLog: [{tool, ok, note?}], draftIds: [...] }
 *
 * A function-calling agent loop: the LLM gets the bot's own data layer as
 * tools (fixtures, standings, H2H, top performers…) plus create_draft, which
 * runs the normal compose pipeline into the APPROVAL QUEUE — the agent can
 * never post to X directly. Stateless: the client resends the transcript.
 */

import { groundedLookup } from "../packages/tools/websearch";
import { chatWithTools } from "../packages/shared/openrouter";
import { composeAndPost } from "../packages/shared/poster";
import {
  getTeamFixtures,
  getLeagueStandings,
  getTeamTopPerformers,
  getHeadToHead,
  currentSeason,
  seasonLabel,
  activeProviderName,
  provider,
  club,
} from "../packages/tools/football";
import { getTeamAdvancedStats, getLeagueXgTable } from "../packages/tools/understat";
import { db } from "../packages/db/client";
import { drafts } from "../packages/db/schema";
import { desc, eq } from "drizzle-orm";
import { TweetKind, Tone } from "../packages/shared/tweet-prompts";
import { CardKind } from "../packages/render/index";
import { withErrorLogging } from "../packages/observability/index";

const MAX_STEPS = 6;
const MAX_HISTORY = 24;

const TWEET_KINDS: TweetKind[] = [
  "match_preview",
  "live_update",
  "post_match",
  "player_stat",
  "transfer_news",
  "weekly_deep_dive",
  "long_read",
];
const CARD_KINDS: CardKind[] = [
  "match_preview",
  "score",
  "post_match",
  "player_stat",
  "transfer",
  "form",
  "editorial",
  "milestone",
  "comparison",
];

function systemPrompt(): string {
  const caps = provider().capabilities;
  const c = club();
  return `You are the control-room agent for the ${c.fullName} X (Twitter) account.
Today: ${new Date().toISOString().slice(0, 10)}. Season: ${seasonLabel(currentSeason())}. Data provider: ${activeProviderName()}${caps.xg ? "" : " (no possession/xG/transfer data on this tier — never invent those numbers)"}.

You help the operator create posts. Rules:
- STATS ARE THE PRODUCT. Every draft must lead with its strongest number and carry at least 3 supporting stats when the data allows — fetch MORE tools to get them (combine recent results + standings + advanced xG + top performers), don't settle for one number. Prefer the stat-dense card kinds and fill every stat field the data supports (player_stat with 5-6 stats + formPills, post_match with the full stats block). A post without a number is a failed post.
- ALWAYS fetch real data with tools before creating a draft. Never invent stats, dates, or opponents.
- create_draft composes tweet copy + an infographic spec into the APPROVAL QUEUE. It never posts to X; the operator reviews and posts from the dashboard.
- Prefer attaching a card. Card kinds and their data shapes:
  - match_preview {home, away, competition, dateLabel, venue?, footnote?}   (landscape; footnote for H2H)
  - score {home, away, homeGoals, awayGoals, competition, statusLabel, scorers?[], statLine?}
  - post_match {home, away, homeGoals, awayGoals, competition, statusLabel, seasonLabel?, scorers?[], stats:{possession?, xg?, shotsTotal?, shotsOnTarget?, corners?, passAccuracy?, fouls?}}
  - player_stat {player, season, competition?, context?, stats:[{label, value}] (max 6), formPills?: ["W"|"D"|"L"] (max 5, newest first — use recent results), remark?: one scout-style line grounded in the stats (e.g. "The underlying numbers say the goals are coming")}
  - transfer {player, direction:"in"|"out", counterparty, transferType?, dateLabel?}
  - form {seasonLabel, results:[{opponent, score, outcome:"W"|"D"|"L"}] (max 5), position?, points?, goalsFor?, goalsAgainst?, competition?}
  - editorial {eyebrow, lines:[{text, em?}] (max 7 short lines), dateLabel?}
  - milestone {player, value ("200"), milestoneLabel ("Appearances for ${c.name}"), context?, stats:[{label, value}] (max 6 career receipts), dateLabel?, competition?}   (use for round-number moments: appearances, goals, clean sheets)
  - comparison {title?, playerA, playerB, context ("Premier League 25/26 · per 90"), metrics:[{label, a, b, aDisplay?, bDisplay?}] (max 6; a/b numeric, playerA is OUR player), footnote ("xG: Understat")}   (butterfly chart — great for transfer debates and player arguments; prefer per-90 numbers)
- Every card also accepts "palette": "neutral" (dark editorial, default) | "home" (club royal blue + gold) | "away" (light). Pick home for home fixtures and club celebration moments, away for away fixtures, neutral for analysis. Mention your palette choice only if asked.
- Milestone/spotlight tweet format (fan-account standard): a hook line containing the big number, then a line-broken stat list — one stat per line prefixed with a fitting emoji (⚽ goals, 🅰️ assists, ⏱ minutes/per-90, 🧤 saves, 🏆 trophies), then the suffix. Keep it under the character limit.
- The "data" argument of create_draft grounds the tweet copy — put the real numbers/facts there. It must never be empty.
- When the user asks for a post, you MUST actually call create_draft — never say a draft was created unless the create_draft tool returned a draftId in this conversation.
- Dates shown to fans: convert to ${c.timezone} time (${c.tzLabel}) like "Sat 24 Aug, 20:00 ${c.tzLabel}".
- Advanced stats (get_advanced_player_stats / get_league_xg_table) come from Understat's xG model — when a post leans on them, credit "xG: Understat" in the copy or card. Great for over/under-performance takes (goals vs xG), profiling (xGChain/xGBuildup), and transfer arguments. NEVER produce Opta-style historical trivia ("first player since…") — no tool can verify it.
- web_lookup fills free-tier gaps (cup fixtures, lower-league opponents, kickoff times). Facts from it MUST carry their source: put the source name in the create_draft data and credit it in the copy or card footnote (e.g. "fixture: BBC Sport"). If web_lookup errors, say so — never fill the gap from memory.
- Be brief in replies: one or two sentences on what you did or found. Plain text, no markdown.`;
}

const TOOLS = [
  tool("get_upcoming_fixtures", "Next fixtures for the tracked club (date ISO, opponent, competition, venue, home/away).", {
    count: { type: "number", description: "1-10, default 3" },
  }),
  tool("get_recent_results", "The tracked club's most recent finished matches with scores and W/D/L outcomes.", {
    count: { type: "number", description: "1-10, default 5" },
  }),
  tool("get_standings", "League table: the tracked club's row plus the top of the table.", {}),
  tool("get_top_performers", "The tracked club's top players this season by goal involvements.", {}),
  tool(
    "get_advanced_player_stats",
    "Advanced xG-model stats for the tracked club's squad this season (source: Understat): xG, npxG, xA, shots, key passes, xGChain, xGBuildup, per-90 rates. Use for player profiling, transfer arguments, over/under-performance takes.",
    { player: { type: "string", description: "Optional player name filter (partial match)" } }
  ),
  tool(
    "get_league_xg_table",
    "League-wide team xG table this season (source: Understat): xG, xGA, npxG, npxGA, xPts per team. Use for 'only N teams have a better xGA'-style arguments.",
    {}
  ),
  tool("get_head_to_head", "Head-to-head record vs the next opponent (last ~10 meetings).", {}),
  tool(
    "web_lookup",
    "Grounded web search (Gemini + Google Search) for football facts the structured tools CANNOT provide: domestic cup fixtures/kickoff times, lower-league opponents, confirmed team news. Returns an answer WITH source URLs — cite them. Never use it for stats the other tools already cover.",
    { question: { type: "string", description: "One specific factual question, e.g. 'When and where do Chelsea play Luton Town next, any competition?'" } }
  ),
  tool("list_pending_drafts", "Drafts currently waiting in the approval queue.", {}),
  tool(
    "create_draft",
    "Compose a post (tweet copy via the house style + optional infographic card) into the approval queue.",
    {
      kind: { type: "string", enum: TWEET_KINDS, description: "Tweet kind" },
      tone: { type: "string", enum: ["professional", "savage"] },
      longform: { type: "boolean", description: "Long-form post (X premium)" },
      data_json: {
        type: "string",
        description:
          'JSON object string with the real facts that ground the tweet, e.g. "{\\"opponent\\":\\"Fulham\\",\\"competition\\":\\"Premier League\\",\\"date\\":\\"Mon 24 Aug, 20:00 WAT\\",\\"venue\\":\\"Craven Cottage\\",\\"hook\\":\\"H2H W6 D1 L3\\"}"',
      },
      card_kind: { type: "string", enum: CARD_KINDS, description: "Optional infographic kind" },
      card_data_json: {
        type: "string",
        description: "JSON object string with the card data (shapes in the system prompt). Required if card_kind is set.",
      },
    },
    ["kind", "data_json"]
  ),
];

function tool(name: string, description: string, props: Record<string, unknown>, required: string[] = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties: props, required },
    },
  };
}

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt;
}

/** Models sometimes send nested objects as JSON strings — accept both. */
function coerceObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function execTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "get_upcoming_fixtures": {
      const { fixtures } = await getTeamFixtures({ next: clamp(args?.count, 1, 10, 3) });
      return fixtures.map((f) => ({
        fixtureId: f.id,
        dateUtc: f.date,
        home: f.home,
        away: f.away,
        opponent: f.opponent,
        competition: f.competition,
        venue: f.venue || null,
        isHome: f.isHome,
      }));
    }
    case "get_recent_results": {
      const { fixtures } = await getTeamFixtures({ last: clamp(args?.count, 1, 10, 5) });
      return fixtures.map((f) => ({
        dateUtc: f.date,
        opponent: f.opponent,
        score: `${f.goalsHome ?? "?"}-${f.goalsAway ?? "?"}`,
        home: f.home,
        away: f.away,
        outcome: f.outcome,
        competition: f.competition,
      }));
    }
    case "get_standings": {
      const { team, table } = await getLeagueStandings(currentSeason());
      return { team, topSix: table.slice(0, 6) };
    }
    case "get_top_performers": {
      const { players } = await getTeamTopPerformers(currentSeason());
      return players.slice(0, 8);
    }
    case "get_advanced_player_stats": {
      const { players, source } = await getTeamAdvancedStats(currentSeason());
      if (!players.length) {
        return { error: "no advanced stats available yet (early season or Understat unreachable)" };
      }
      const fold = (s: string) =>
        s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const filter = fold(String(args?.player || "").trim());
      let picked = filter ? players.filter((p) => fold(p.player).includes(filter)) : players.slice(0, 12);
      let note: string | undefined;
      if (filter && !picked.length) {
        // Try last-name-only, then fall back to the full list so the agent
        // can locate the right spelling instead of concluding "no data".
        const last = filter.split(/\s+/).pop() || filter;
        picked = players.filter((p) => fold(p.player).includes(last));
        if (!picked.length) {
          picked = players.slice(0, 12);
          note = `no player matched "${args?.player}" — full squad list returned, check the spelling against player names`;
        }
      }
      return { players: picked, note, source: "Understat", url: source };
    }
    case "get_league_xg_table": {
      const { table, source } = await getLeagueXgTable(currentSeason());
      if (!table.length) {
        return { error: "no league xG data available yet (early season or Understat unreachable)" };
      }
      return { table, source: "Understat", url: source };
    }
    case "web_lookup": {
      const q = String(args?.question || "").trim();
      if (!q) return { error: "question required" };
      try {
        const r = await groundedLookup(q);
        return { answer: r.answer, sources: r.sourceTitles.slice(0, 4), source_urls: r.sources.slice(0, 4) };
      } catch (e) {
        return { error: String((e as Error).message || e) };
      }
    }
    case "get_head_to_head": {
      const { fixtures } = await getTeamFixtures({ next: 1 });
      const next = fixtures[0];
      if (!next) return { error: "no upcoming fixture" };
      const h2h = await getHeadToHead({ opponentId: next.opponentId, fixtureId: next.id });
      return { opponent: next.opponent, ...h2h, citation: undefined };
    }
    case "list_pending_drafts": {
      const rows = await db
        .select()
        .from(drafts)
        .where(eq(drafts.status, "pending"))
        .orderBy(desc(drafts.createdAt))
        .limit(10);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        card: r.cardKind,
        preview: (r.content || "").slice(0, 90),
      }));
    }
    case "create_draft": {
      if (!TWEET_KINDS.includes(args?.kind)) throw new Error(`invalid kind: ${args?.kind}`);
      const data = coerceObject(args?.data_json ?? args?.data);
      if (!data || !Object.keys(data).length) {
        throw new Error(
          `'data_json' is empty or invalid (received: ${JSON.stringify(args?.data_json ?? args?.data).slice(0, 120)}) — pass a JSON object string with the real facts, e.g. "{\\"opponent\\":\\"Fulham\\",\\"date\\":\\"Mon 24 Aug, 20:00 WAT\\",\\"hook\\":\\"H2H W6 D1 L3\\"}"`
        );
      }
      const cardKind = (args?.card_kind || coerceObject(args?.card)?.kind) as CardKind | undefined;
      const cardData = coerceObject(args?.card_data_json ?? coerceObject(args?.card)?.data);
      if (cardKind && !CARD_KINDS.includes(cardKind)) {
        throw new Error(`invalid card kind: ${cardKind}`);
      }
      if (cardKind && (!cardData || !Object.keys(cardData).length)) {
        throw new Error("card_kind set but card_data_json is empty — pass the card data as a JSON object string");
      }
      const result = await composeAndPost({
        kind: args.kind as TweetKind,
        tone: (args.tone === "savage" ? "savage" : "professional") as Tone,
        data,
        card: cardKind && cardData ? { kind: cardKind, data: cardData } : undefined,
        longform: Boolean(args.longform),
        source: "chat",
        forceQueue: true,
      });
      if (!result.draftId) {
        throw new Error(
          `compose refused (${result.skipped || "no output"}) — the tweet writer needs concrete facts in 'data'; include the numbers you fetched`
        );
      }
      return { draftId: result.draftId, tweet: result.tweet, queued: true };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = (await req.json().catch(() => null)) as { messages?: any[] } | null;
  const history = Array.isArray(body?.messages) ? body!.messages!.slice(-MAX_HISTORY) : [];
  if (!history.length) return json({ error: "messages required" }, 400);

  const msgs: any[] = [
    { role: "system", content: systemPrompt() },
    ...history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    })),
  ];

  const toolLog: { tool: string; ok: boolean; note?: string }[] = [];
  const draftIds: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { message } = await chatWithTools({ messages: msgs, tools: TOOLS });
    if (!message) break;
    msgs.push(message);

    const calls = message.tool_calls || [];
    if (!calls.length) {
      return json({ reply: message.content || "(no reply)", toolLog, draftIds });
    }
    for (const c of calls) {
      const name = c?.function?.name || "unknown";
      let result: unknown;
      try {
        const args = JSON.parse(c?.function?.arguments || "{}");
        result = await execTool(name, args);
        let note: string | undefined;
        if (name === "create_draft" && (result as any)?.draftId) {
          draftIds.push((result as any).draftId);
          note = `“${String((result as any).tweet || "").slice(0, 70)}…”`;
        }
        toolLog.push({ tool: name, ok: true, note });
      } catch (e: any) {
        result = { error: e?.message || String(e) };
        toolLog.push({ tool: name, ok: false, note: e?.message });
      }
      msgs.push({
        role: "tool",
        tool_call_id: c.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  return json({
    reply: "I hit my tool-step limit for one message — ask again or narrow the request.",
    toolLog,
    draftIds,
  });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
