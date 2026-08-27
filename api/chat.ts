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

import { execTool, TWEET_KINDS, CARD_KINDS } from "../packages/agent/tools";
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
import { CLUB_DIRECTORY } from "../packages/render/clubs";
import { withErrorLogging } from "../packages/observability/index";

const MAX_STEPS = 6;
const MAX_HISTORY = 24;


/** Compact "name @handle" list for the tagging rule — never let the LLM guess handles. */
const HANDLE_LINE = Object.entries(CLUB_DIRECTORY)
  .map(([name, a]) => `${name} ${a.handle}`)
  .join(", ");

function systemPrompt(): string {
  const caps = provider().capabilities;
  const c = club();
  return `You are the control-room agent for the ${c.fullName} X (Twitter) account.
Today: ${new Date().toISOString().slice(0, 10)}. Season: ${seasonLabel(currentSeason())}. Data provider: ${activeProviderName()}${caps.xg ? "" : " (no possession/xG/transfer data on this tier — never invent those numbers)"}.

You are BOTH the operator's post composer AND their analyst. Two modes, pick by intent:
- QUESTION MODE: when the operator asks a question (what happened, who scored, how good is X, compare A and B), ANSWER IT DIRECTLY with real numbers from tools. Use web_lookup freely for anything the structured tools cannot see: cup matches, individual match performances, breaking news. Cite sources. A good analysis reply is a short stat-dense paragraph, not one line. Do NOT create a draft unless asked; you may end with one sentence offering to draft it.
- POST MODE: when the operator asks for a post/draft/card, follow the rules below.

Rules:
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
  - leaderboard {title ("Most xG per 90"), context?, entries:[{value, label, sub?, highlight?}] (max 7, ranked; highlight=true for our players), footnote}   (ranked list — top-N by any metric from the data)
  - shot_map {player, context?, shots:[{x, y, xG, result}] (pass through EXACTLY what get_player_shots returned), remark? (one scout line), footnote ("xG: Understat")}   (attacking-half shot map, dot size = xG, goals highlighted)
  - head_to_head {title? (max 2 short lines), context?, playerA, playerB, roleA?/roleB? (short tags like "New signing" / "${c.name} No. 1"), photoAWiki/photoBWiki (just the player names — the renderer fetches real Wikipedia headshots), crestAClub/crestBClub (club names — renderer fetches the crests), metrics:[{label, a, b, aDisplay?, bDisplay?, higherIsBetter?}] (max 8; set higherIsBetter:false for conceded/cards so the GREEN winner tint lands right), careerTitle?, careerA/careerB:[{label, value}] (max 3 each), tagline?, footnote ("photos: Wikimedia Commons")}   (the premium duel card: photos + crests + winner-tinted stat table — the go-to for signing debates, GK battles, transfer comparisons)
  - match_stats {home, away, homeGoals?, awayGoals?, competition?, statusLabel? ("FULL TIME"), rows:[{label, home, away}] (max 12; ANY metric: xG, possession, shots, distance covered, duels; values like "2.41", "66%", "612/688" all render; split bars draw when both sides are numeric), footnote ("source: Sofascore")}   (the full Sofascore-style match sheet — the go-to for hand-sourced cup match stats)
  - scatter {title, context?, xLabel, yLabel, points:[{label, x, y, score? (0..1, tints red->amber->green), highlight?}] (max 26), quadrants?:{tl,tr,bl,br} (corner captions), xInvert?/yInvert? (flip an axis so up/right = better, e.g. yInvert for xGA), footnote}   (quadrant map — league xG maps from get_league_xg_table, fit analyses, any 2-metric landscape)
- Every card also accepts "palette": "neutral" (dark editorial, default) | "home" (club royal blue + gold) | "away" (light) | "terminal" (mono type, scanlines, prompt chrome: the brand terminal-agentic skin, great for data-heavy analysis cards like leaderboards, shot maps and xG tables). Pick home for home fixtures and club celebration moments, away for away fixtures, neutral or terminal for analysis. Mention your palette choice only if asked.
- Milestone/spotlight tweet format (fan-account standard): a hook line containing the big number, then a line-broken stat list — one stat per line prefixed with a fitting emoji (⚽ goals, 🅰️ assists, ⏱ minutes/per-90, 🧤 saves, 🏆 trophies), then the suffix. Keep it under the character limit.
- The "data" argument of create_draft grounds the tweet copy — put the real numbers/facts there. It must never be empty.
- When the user asks for a post, you MUST actually call create_draft — never say a draft was created unless the create_draft tool returned a draftId in this conversation.
- Dates shown to fans: convert to ${c.timezone} time (${c.tzLabel}) like "Sat 24 Aug, 20:00 ${c.tzLabel}".
- Advanced stats (get_advanced_player_stats / get_league_xg_table) come from Understat's xG model — when a post leans on them, credit "xG: Understat" in the copy or card. Great for over/under-performance takes (goals vs xG), profiling (xGChain/xGBuildup), and transfer arguments. NEVER produce Opta-style historical trivia ("first player since…") — no tool can verify it.
- Positional metrics (get_positional_stats/get_player_career) are OPERATOR-IMPORTED FBref data. If a player is not imported the tool says so - relay that honestly and suggest importing via the bookmarklet on the Stat sources page; never fill positional stats from memory. Cross-league comparisons MUST use get_league_coefficients (adjust + footnote) or explicitly state the numbers are unadjusted.
- web_lookup fills free-tier gaps (cup fixtures, lower-league opponents, kickoff times). Facts from it MUST carry their source: put the source name in the create_draft data and credit it in the copy or card footnote (e.g. "fixture: BBC Sport"). If web_lookup errors, say so — never fill the gap from memory.
- STYLE: never use em dashes or en dashes in tweet copy or card text; hyphens/commas only. Multi-fact tweets use line breaks: hook, blank line, one fact per line.
- TAGGING: when another club is central to the post (opponent, comparison, transfer counterparty), tag their official X handle once on the line that mentions them. Use ONLY these handles, never guess: ${HANDLE_LINE}.
- Replies: plain text, no markdown. Post-mode confirmations stay to one or two sentences; question-mode answers can run a short paragraph of numbers.`;
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
    "get_player_shots",
    "A player's full shot map this season (source: Understat): x/y pitch coordinates, xG and result per shot, plus totals. Feeds the shot_map card and spatial narratives (e.g. 'all 5 goals from inside the box').",
    { player: { type: "string", description: "Player name (partial ok)" } }
  ),
  tool(
    "get_positional_stats",
    "Positional metrics from FBref/Opta (per-90 + percentile vs positional peers, last 365 days): aerial duels, clearances, tackles, dribblers tackled (carry defending), interceptions, recoveries, errors, progressive passes/carries, take-ons, dispossessed, key passes. pack='defender'|'midfielder' filters to the curated set. STORE-BACKED: only works for players the operator has imported via the FBref bookmarklet; on error, say the player is not imported yet - NEVER estimate these numbers. Credit 'FBref/Opta' when used.",
    { player: { type: "string" }, pack: { type: "string", description: "defender | midfielder | omit for all" } },
    ["player"]
  ),
  tool(
    "get_player_career",
    "Season-by-season career (squad, competition, minutes, G/A) from the player's FBref import. Powers YEAR VS YEAR comparisons (head_to_head card with seasons as roleA/roleB) and former-club angles. Store-backed like get_positional_stats.",
    { player: { type: "string" } },
    ["player"]
  ),
  tool(
    "get_former_club_players",
    "Which imported players used to play for a given opponent (career squads from FBref imports) - the 'facing his former club' angle for match previews. Only sees imported players; say so if the list is empty.",
    { opponent: { type: "string" } },
    ["opponent"]
  ),
  tool(
    "get_points_vs_past_seasons",
    "The club's CURRENT league points/position compared with the same number of games played in each of the last N seasons (football-data historic standings). Feeds 'best start since ...' posts, a leaderboard card of season starts, or a comparison card.",
    { count: { type: "number", description: "past seasons to include, 1-4, default 3" } }
  ),
  tool(
    "get_league_coefficients",
    "Transparent cross-league adjustment constants (league-adj-v1, PL=1.00). Use when comparing players across leagues so weaker-league per-90s don't flatter: multiply and DISCLOSE the adjustment in the footnote. Never compare cross-league without either applying this or saying the numbers are unadjusted.",
    {}
  ),
  tool(
    "web_lookup",
    "Multi-source web lookup (Wikipedia + DuckDuckGo, with Gemini grounding when available) for football facts the structured tools CANNOT provide: domestic cup fixtures/kickoff times, lower-league opponents, confirmed team news. Returns an answer WITH source URLs — cite them. Never use it for stats the other tools already cover.",
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
