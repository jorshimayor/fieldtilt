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

const CORS = {
  "Access-Control-Allow-Origin": "*", // data itself is bearer-key gated
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const denied = requireOpsAuth(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }
  const rows = await db.select().from(statCache).where(inArray(statCache.key, ["plan:season", "plan:ledger", "plan:study"]));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.data]));
  if (!byKey["plan:season"] && !byKey["plan:ledger"]) {
    return new Response(JSON.stringify({ error: "no plan synced yet - run: npx tsx scripts/plan-sync.mts" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
  return new Response(
    JSON.stringify({ season: byKey["plan:season"] || null, ledger: byKey["plan:ledger"] || null, study: byKey["plan:study"] || null }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } }
  );
});
