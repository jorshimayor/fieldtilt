export const config = { runtime: "edge" };

/**
 * Approval queue API (protected by CRON_SECRET).
 *
 *   GET  /api/drafts?status=pending           → list drafts (default pending)
 *   POST /api/drafts {action:"compose", kind, tone, data, card?, longform?}
 *        → run the LLM pipeline, returns the new draft (never auto-posts)
 *   POST /api/drafts {action:"post", id, content?, pngBase64?}
 *        → post to X. `content` = edited text. `pngBase64` = image rendered
 *          in the browser (free-plan path); omitted → server renders (paid).
 *   POST /api/drafts {action:"reject", id}
 *   POST /api/drafts {action:"restore", id}   → rejected → pending
 */

import { db } from "../packages/db/client";
import { drafts } from "../packages/db/schema";
import { desc, eq } from "drizzle-orm";
import { composeAndPost, postDraftNow } from "../packages/shared/poster";
import { TweetKind, Tone } from "../packages/shared/tweet-prompts";
import { CardKind } from "../packages/render/index";
import { withErrorLogging } from "../packages/observability/index";

const VALID_KINDS: TweetKind[] = [
  "match_preview",
  "live_update",
  "post_match",
  "player_stat",
  "transfer_news",
  "weekly_deep_dive",
  "long_read",
];

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending") as "pending" | "posted" | "rejected";
    const rows = await db
      .select()
      .from(drafts)
      .where(eq(drafts.status, status))
      .orderBy(desc(drafts.createdAt))
      .limit(30);
    return json({ drafts: rows });
  }

  if (req.method !== "POST") return json({ error: "GET or POST only" }, 405);
  const body = (await req.json().catch(() => null)) as any;
  if (!body?.action) return json({ error: "missing action" }, 400);

  if (body.action === "compose") {
    if (!VALID_KINDS.includes(body.kind)) {
      return json({ error: "invalid kind", allowed: VALID_KINDS }, 400);
    }
    const result = await composeAndPostAsDraft({
      kind: body.kind,
      tone: body.tone === "savage" ? "savage" : "professional",
      data: body.data || {},
      card: body.card,
      longform: Boolean(body.longform),
    });
    return json(result);
  }

  if (body.action === "post") {
    if (!body.id) return json({ error: "missing id" }, 400);
    let image: Uint8Array | undefined;
    if (typeof body.pngBase64 === "string" && body.pngBase64.length) {
      const raw = body.pngBase64.replace(/^data:image\/png;base64,/, "");
      const bin = atob(raw);
      image = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) image[i] = bin.charCodeAt(i);
    }
    const res = await postDraftNow(body.id, {
      image,
      contentOverride: typeof body.content === "string" ? body.content : undefined,
    });
    return json({ ok: true, ...res });
  }

  if (body.action === "reject" || body.action === "restore") {
    if (!body.id) return json({ error: "missing id" }, 400);
    const status = body.action === "reject" ? "rejected" : "pending";
    await db.update(drafts).set({ status }).where(eq(drafts.id, body.id));
    return json({ ok: true, id: body.id, status });
  }

  return json({ error: `unknown action: ${body.action}` }, 400);
});

/** Compose into the queue regardless of the auto-post flag. */
async function composeAndPostAsDraft(opts: {
  kind: TweetKind;
  tone: Tone;
  data: Record<string, unknown>;
  card?: { kind: CardKind; data: unknown };
  longform: boolean;
}) {
  const result = await composeAndPost({ ...opts, source: "dashboard", forceQueue: true });
  return result;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
