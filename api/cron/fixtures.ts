export const config = { runtime: "edge" };

/**
 * Daily morning cron — 07:00 UTC (08:00 WAT).
 *
 * 1. Warms the `nextfixture` cache key that gates the 5-minute match-day
 *    poller (so it doesn't burn API-Football quota on non-match days).
 * 2. If the next Chelsea fixture kicks off within 48h, posts a MATCH PREVIEW
 *    tweet with a preview infographic. Otherwise stays quiet.
 */

import { getChelseaFixtures } from "../../packages/tools/football";
import { setCache } from "../../packages/tools/cache";
import { composeAndPost } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";

export const NEXT_FIXTURE_KEY = "nextfixture:chelsea";

export default withErrorLogging(async function handler(): Promise<Response> {
  const { fixtures } = await getChelseaFixtures({ next: 1 });
  const next = fixtures[0];
  if (!next) return json({ skipped: "no upcoming fixture" });

  // Gate for the match-day poller (24h TTL, refreshed daily).
  await setCache(NEXT_FIXTURE_KEY, { id: next.id, date: next.date }, 24 * 60 * 60 * 1000);

  const kickoff = new Date(next.date).getTime();
  const hoursAway = (kickoff - Date.now()) / 36e5;
  if (hoursAway > 48) {
    return json({ skipped: `next fixture ${Math.round(hoursAway)}h away — no preview yet`, fixtureId: next.id });
  }

  const dateLabel = new Date(next.date).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const result = await composeAndPost({
    kind: "match_preview",
    data: {
      opponent: next.opponent,
      competition: next.competition,
      date: `${dateLabel} WAT`,
      venue: next.venue,
      hook: next.isChelseaHome ? "Home fixture at the Bridge." : "Away day.",
    },
    card: {
      kind: "match_preview",
      data: {
        home: next.home,
        away: next.away,
        competition: next.competition,
        dateLabel: `${dateLabel} WAT`,
        venue: next.venue,
      },
    },
    idKey: `tweet:fixtures:${next.id}:${new Date().toISOString().slice(0, 10)}`,
  });

  return json({ fixtureId: next.id, opponent: next.opponent, date: next.date, ...result });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
