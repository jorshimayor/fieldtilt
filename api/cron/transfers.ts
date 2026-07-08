export const config = { runtime: "edge" };

/**
 * Transfer watch — daily 08:00 UTC (09:00 WAT).
 *
 * Checks API-Football for confirmed Chelsea moves (in or out) from the last
 * 14 days, dedupes against the posted_items table (durable — a transfer is
 * announced exactly once), and posts up to 2 per run with a transfer card.
 */

import { getChelseaTransfers } from "../../packages/tools/football";
import { composeAndPost, claimPostedKey, recordPostedTweet } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";

const MAX_POSTS_PER_RUN = 2;

export default withErrorLogging(async function handler(): Promise<Response> {
  const { transfers } = await getChelseaTransfers({ sinceDays: 14 });
  if (!transfers.length) return json({ skipped: "no recent transfers" });

  const posted: unknown[] = [];
  for (const t of transfers) {
    if (posted.length >= MAX_POSTS_PER_RUN) break;
    const key = `transfer:${t.playerId}:${t.date}:${t.direction}`;
    const fresh = await claimPostedKey(key, "transfer");
    if (!fresh) continue;

    const feeLabel = /€|£|\$/.test(t.type) ? t.type : t.type === "N/A" ? "Undisclosed" : t.type;
    const result = await composeAndPost({
      kind: "transfer_news",
      data: {
        player: t.player,
        direction: t.direction === "in" ? "in" : "out",
        fee: feeLabel,
        counterparty: t.counterparty,
        reliability: "confirmed",
        source: "API-Football",
      },
      card: {
        kind: "transfer",
        data: {
          player: t.player,
          direction: t.direction,
          counterparty: t.counterparty,
          transferType: feeLabel,
          dateLabel: t.date,
        },
      },
    });
    if (result.tweetId) await recordPostedTweet(key, result.tweetId);
    posted.push({ player: t.player, direction: t.direction, ...result });
  }

  if (!posted.length) return json({ skipped: "all recent transfers already posted" });
  return json({ posted });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
