export const config = { runtime: "edge" };

/**
 * Daily posting accountability — runs at 21:30 UTC (22:30 WAT).
 *
 * Counts posts published today (WAT day) via the approval queue. If fewer
 * than DAILY_POST_TARGET, it files a task with the OpenClaw personal
 * assistant (monster-agent-backend), whose completion pushes a nudge to
 * Telegram + Slack through its notification bus. The bot doesn't nag
 * directly — the assistant does, in one place with the rest of your day.
 */
import { gte, and, eq } from "drizzle-orm";

import { db } from "../../packages/db/client";
import { drafts } from "../../packages/db/schema";
import { withErrorLogging } from "../../packages/observability/index";
import { requireOpsAuth } from "../../packages/shared/auth";

const DAILY_POST_TARGET = 5;
const ASSISTANT_API =
  (globalThis as any).process?.env?.ASSISTANT_API_URL ||
  "https://monster-agent-backend.joelobafemii.workers.dev";

/** Start of the current WAT (UTC+1) day, as a UTC Date. */
function startOfWatDay(now = new Date()): Date {
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  const start = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate());
  return new Date(start - 60 * 60 * 1000);
}

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;

  const since = startOfWatDay();
  const rows = await db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.status, "posted"), gte(drafts.postedAt, since)));
  const count = rows.length;

  if (count >= DAILY_POST_TARGET) {
    return Response.json({ ok: true, posted: count, target: DAILY_POST_TARGET, nudged: false });
  }

  const description =
    `Posting accountability check (automated, from fieldtilt): I published only ${count} of my ` +
    `${DAILY_POST_TARGET} daily posts today on the fieldtilt X account. Write me a SHORT nudge ` +
    `(under 120 words) for Telegram: state the count plainly, then suggest 2-3 concrete post ideas ` +
    `I could still ship tonight or first thing tomorrow (Chelsea angle — matchday reaction, a stat ` +
    `from recent games, or a card from the drafts queue at https://fieldtilt.joelobafemii.workers.dev). ` +
    `No lecture — just the count and the fastest way back on pace.`;

  let assistant: { ok: boolean; taskId?: string; error?: string } = { ok: false };
  try {
    const res = await fetch(`${ASSISTANT_API}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    assistant = res.ok ? { ok: true, taskId: j.id } : { ok: false, error: `assistant ${res.status}` };
  } catch (e) {
    assistant = { ok: false, error: String(e) };
  }

  return Response.json({ ok: true, posted: count, target: DAILY_POST_TARGET, nudged: true, assistant });
});
