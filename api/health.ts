export const config = { runtime: "edge" };

/**
 * Production readiness probe. Reports which subsystems are configured —
 * booleans only, never secret values. Open endpoint (safe to expose).
 */

import flags from "../config/flags.json";
import { currentSeason, seasonLabel } from "../packages/tools/football";

function has(key: string): boolean {
  const v = (globalThis as any).process?.env?.[key];
  return typeof v === "string" && v.length > 0;
}

export default async function handler(): Promise<Response> {
  const checks = {
    llm_openrouter: has("OPENROUTER_API_KEY"),
    football_data: has("API_FOOTBALL_KEY"),
    database_neon: has("NEON_DATABASE_URL"),
    cache_upstash: has("UPSTASH_REDIS_URL") && has("UPSTASH_REDIS_TOKEN"),
    x_oauth_app: has("X_CLIENT_ID") && has("X_CLIENT_SECRET") && has("X_REDIRECT_URI"),
    ops_secret: has("CRON_SECRET"),
  };

  let xAccountConnected: boolean | "unknown" = "unknown";
  if (checks.database_neon) {
    try {
      const { getLatestToken } = await import("../packages/shared/x");
      xAccountConnected = Boolean(await getLatestToken());
    } catch {
      xAccountConnected = false;
    }
  }

  const ready =
    checks.llm_openrouter &&
    checks.football_data &&
    checks.database_neon &&
    checks.x_oauth_app &&
    xAccountConnected === true;

  return new Response(
    JSON.stringify(
      {
        ok: true,
        readyToPost: ready && !flags.publish_draft_only,
        draftMode: flags.publish_draft_only,
        season: seasonLabel(currentSeason()),
        checks,
        xAccountConnected,
        hints: [
          !checks.x_oauth_app ? "Set X_CLIENT_ID / X_CLIENT_SECRET / X_REDIRECT_URI" : null,
          checks.x_oauth_app && xAccountConnected !== true ? "Visit /api/x/auth to connect the X account" : null,
          flags.publish_draft_only ? "publish_draft_only is ON — set it false in config/flags.json to go live" : null,
          !checks.ops_secret ? "Set CRON_SECRET to enable/protect the ops endpoints" : null,
        ].filter(Boolean),
      },
      null,
      2
    ),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
