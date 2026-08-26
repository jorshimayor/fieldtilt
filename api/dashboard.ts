export const config = { runtime: "edge" };

/**
 * Dashboard aggregate endpoint. Returns:
 *   - Next 5 Chelsea fixtures
 *   - Stats for the most recent finished fixture (for the chart)
 *   - Last 10 outbound tweet rows from `messages`
 *
 * All calls are cached upstream; this route is safe to poll.
 */

import { getTeamFixtures, getMatchStats } from "../packages/tools/football";
import { db } from "../packages/db/client";
import { messages } from "../packages/db/schema";
import { desc, eq } from "drizzle-orm";
import { withErrorLogging } from "../packages/observability/index";

export default withErrorLogging(async function handler(): Promise<Response> {
  const [upcomingRes, recentRes, recentPosts] = await Promise.all([
    getTeamFixtures({ next: 10 }),
    getTeamFixtures({ last: 1 }),
    db
      .select()
      .from(messages)
      .where(eq(messages.direction, "out"))
      .orderBy(desc(messages.createdAt))
      .limit(10),
  ]);

  const last = recentRes.fixtures[0];
  const stats = last ? await getMatchStats(last.id) : null;

  return new Response(
    JSON.stringify({
      upcoming: upcomingRes.fixtures,
      lastFixture: last || null,
      lastStats: stats,
      recentPosts: recentPosts.map((r: any) => ({
        id: String(r.id),
        content: r.content,
        createdAt: r.createdAt,
        modelUsed: r.modelUsed,
      })),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
});
