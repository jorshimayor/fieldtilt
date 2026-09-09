export const config = { runtime: "edge" };

/**
 * The plan API — feeds /plan. PROTECTED: the season calendar and editorial
 * ledger are private strategy (career plan, commercial commitments), synced
 * into Neon by scripts/plan-sync.mts precisely so they never enter the
 * public repo or worker bundle. The /plan shell is public; its content is
 * not.
 */

import { db } from "../packages/db/client";
import { statCache } from "../packages/db/schema";
import { inArray } from "drizzle-orm";
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  const rows = await db.select().from(statCache).where(inArray(statCache.key, ["plan:season", "plan:ledger"]));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.data]));
  if (!byKey["plan:season"] && !byKey["plan:ledger"]) {
    return new Response(JSON.stringify({ error: "no plan synced yet - run: npx tsx scripts/plan-sync.mts" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ season: byKey["plan:season"] || null, ledger: byKey["plan:ledger"] || null }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
