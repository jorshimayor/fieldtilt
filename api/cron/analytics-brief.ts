export const config = { runtime: "edge" };

/**
 * Daily Chelsea Analytics & Research Brief — the operator's own spec
 * (recovered from their assistant notes): exactly 20 items in 3 tiers —
 * 7 simple stats, 7 intermediate trends, 6 complex metrics + research
 * topics — composed STRICTLY from gathered data and delivered through the
 * personal assistant's channels (Telegram + Slack).
 *
 * Dedup: the last 3 briefs are stored in `messages` (modelUsed =
 * "analytics_brief") and fed back as "do not repeat".
 * Coverage honesty: free-tier data is men's-first; the composer is told to
 * label any Women/Academy item with its web_lookup source or skip it.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "../../packages/db/client";
import { messages } from "../../packages/db/schema";
import { withErrorLogging } from "../../packages/observability/index";
import { requireOpsAuth } from "../../packages/shared/auth";
import { routeAndChat } from "../../packages/shared/openrouter";
import { notifyAssistant } from "../../packages/shared/assistant";
import { club } from "../../packages/shared/club";
import { execTool } from "../../packages/agent/tools";
import { composeAndPost } from "../../packages/shared/poster";

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  const c = club();

  // ---- gather (parallel, tolerant of individual failures) ----
  const spec: [string, Record<string, unknown>][] = [
    ["get_recent_results", { count: 6 }],
    ["get_upcoming_fixtures", { count: 4 }],
    ["get_standings", {}],
    ["get_top_performers", {}],
    ["get_advanced_player_stats", {}],
    ["get_league_xg_table", {}],
    ["get_head_to_head", {}],
    ["web_lookup", { question: `${c.fullName} Women latest result and Academy standout this week` }],
  ];
  const gathered: Record<string, unknown> = {};
  await Promise.all(
    spec.map(async ([name, args]) => {
      try {
        gathered[name] = await execTool(name, args);
      } catch (e) {
        gathered[name] = { error: String((e as Error).message || e) };
      }
    })
  );

  // ---- previous briefs (dedup) ----
  const prev = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.modelUsed, "analytics_brief"))
    .orderBy(desc(messages.id))
    .limit(3);

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const out = await routeAndChat({
    messages: [
      {
        role: "system",
        content: `You are the ${c.fullName} Analytics & Research Agent. Produce today's brief with EXACTLY 20 items in this exact format:

📅 ${c.name} Daily Analytics & Research Brief — ${today}

🟢 Simple Stats & Facts (7)
1-7: one-sentence fragments from recent results, scorers, fixtures, standings.

🟡 Intermediate Trends & Data (7)
8-14: trends across the gathered data — form runs, H2H angles vs upcoming opponents, xG vs goals gaps, league-table context.

🔴 Complex Metrics & Research Topics (6)
15-17: advanced metrics from the xG data (xG/xA over/under-performance, xGChain, npxG).
18-20: specific tactical research QUESTIONS derived from the data (questions, not claims).

HARD RULES:
- Every stat MUST come from the provided data. NEVER invent a number, player, or result.
- Items using web_lookup facts must end with their source domain in parentheses; if the lookup failed or lacks Women/Academy data, use men's-team items instead — do not fabricate.
- Credit "xG: Understat" once under the 🔴 tier.
- One punchy sentence fragment per item. No repeats of previous days' items (provided below).
- Exactly 20 numbered items. Plain text, no markdown asterisks.`,
      },
      {
        role: "user",
        content:
          `GATHERED DATA:\n${JSON.stringify(gathered).slice(0, 9000)}\n\n` +
          (prev.length ? `PREVIOUS BRIEFS (do not repeat their items):\n${prev.map((p) => p.content.slice(0, 900)).join("\n---\n")}` : "First brief — no history."),
      },
    ],
  });

  const brief = (out.content || "").trim();
  if (!brief || brief.length < 200) {
    return Response.json({ ok: false, error: "composer returned no usable brief" }, { status: 502 });
  }

  await db.insert(messages).values({ direction: "out", content: brief.slice(0, 8000), modelUsed: "analytics_brief" });
  await notifyAssistant(`${c.name} Daily Analytics Brief`, brief.slice(0, 3300));

  // ---- STATS OF THE DAY: the brief's best items become approval-ready
  // drafts (one per tier) with terminal editorial cards. Queued, never
  // auto-posted: the operator approves, schedules, or rejects.
  const items = [...brief.matchAll(/^(\d+)\.\s+(.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
  const picks = [items.find((i) => i.n === 1), items.find((i) => i.n === 8), items.find((i) => i.n === 15)].filter(
    (i): i is { n: number; text: string } => Boolean(i && i.text.length > 20)
  );
  const wrap = (t: string, width = 34, max = 4) => {
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const wd of words) {
      if ((cur + " " + wd).trim().length > width && cur) {
        lines.push(cur.trim());
        cur = wd;
      } else cur = (cur + " " + wd).trim();
      if (lines.length === max) break;
    }
    if (cur && lines.length < max) lines.push(cur.trim());
    return lines;
  };
  const day = new Date().toISOString().slice(0, 10);
  const statOfDay: Record<string, unknown>[] = [];
  for (const [i, pick] of picks.entries()) {
    try {
      const r = await composeAndPost({
        kind: "weekly_deep_dive",
        source: "cron:stat-of-day",
        data: { theme: "Stat of the day", numbers: pick.text, window: "today" },
        card: {
          kind: "editorial",
          data: {
            eyebrow: `Stat of the day ${picks.length > 1 ? i + 1 : ""}`.trim(),
            lines: wrap(pick.text).map((line, li, arr) => ({ text: line, em: li === arr.length - 1 })),
            dateLabel: today,
            palette: "terminal",
          },
        },
        forceQueue: true,
        idKey: `tweet:statofday:${day}:${pick.n}`,
        idTtlSec: 20 * 60 * 60,
      });
      statOfDay.push({ item: pick.n, draftId: r.draftId, skipped: r.skipped });
    } catch (e) {
      statOfDay.push({ item: pick.n, error: String((e as Error).message || e).slice(0, 120) });
    }
  }

  return Response.json({ ok: true, items: (brief.match(/^\d+\./gm) || []).length, chars: brief.length, statOfDay });
});
