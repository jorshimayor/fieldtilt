export const config = { runtime: "edge" };

/**
 * FBref import endpoint (CRON_SECRET protected, CORS-open — the key is the
 * gate, and the caller is the operator's own browser on fbref.com).
 *
 *   POST /api/ingest?key=...   body: bookmarklet JSON (text/plain to skip
 *                              CORS preflight): {player, url, position?,
 *                              scout:[{stat,per90,percentile}],
 *                              career:[{season,squad,comp,minutes,goals,assists}]}
 *   GET  /api/ingest?key=...   → { imported: { "Player": "2026-08-27", ... } }
 */

import { storeFbrefImport, listImportedPlayers } from "../packages/tools/positional";
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const denied = requireOpsAuth(req);
  if (denied) return denied;

  if (req.method === "GET") {
    return json({ imported: await listImportedPlayers() });
  }
  if (req.method !== "POST") return json({ error: "GET or POST only" }, 405);

  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  try {
    const r = await storeFbrefImport(body);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 160) }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}
