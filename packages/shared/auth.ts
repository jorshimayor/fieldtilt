import { env } from "./env";

/**
 * Shared-secret guard for operational endpoints (crons, test tools, publish).
 *
 * If CRON_SECRET is set, requests must carry `Authorization: Bearer <secret>`
 * (or `?key=<secret>` for browser convenience). If it is NOT set, requests are
 * rejected in production-looking environments and allowed locally — so you
 * can't accidentally ship an open endpoint that spends LLM/API quota.
 */
export function requireOpsAuth(req: Request): Response | null {
  const secret = env.CRON_SECRET;
  const url = new URL(req.url);
  const isLocal =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "local";
  if (!secret) {
    if (isLocal) return null;
    return json(
      { error: "CRON_SECRET is not configured. Set it as a Worker secret to enable this endpoint." },
      503
    );
  }
  const header = req.headers.get("authorization") || "";
  const bearer = header.replace(/^Bearer\s+/i, "");
  const queryKey = url.searchParams.get("key") || "";
  if (bearer === secret || queryKey === secret) return null;
  return json({ error: "unauthorized" }, 401);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
