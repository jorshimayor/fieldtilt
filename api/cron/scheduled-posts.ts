export const config = { runtime: "edge" };

/**
 * Scheduled-posts sweep — piggybacks on the every-5-minutes cron tick.
 *
 * Posts every scheduled draft whose time has come. The dashboard captures a
 * browser-rendered PNG at schedule time (scheduledPng), so posting here is
 * pure IO and free-plan safe. When no PNG was captured the sweep lets
 * postDraftNow try the server-side render; after 3 attempts (a CPU-killed
 * invocation still burns an attempt because the counter is bumped FIRST) it
 * posts text-only rather than looping forever.
 */

import { db } from "../../packages/db/client";
import { drafts } from "../../packages/db/schema";
import { and, eq, lte, asc } from "drizzle-orm";
import { postDraftNow } from "../../packages/shared/poster";
import { notifyAssistant } from "../../packages/shared/assistant";
import { once } from "../../packages/shared/redis";
import { withErrorLogging } from "../../packages/observability/index";

const MAX_PER_TICK = 3;
const MAX_RENDER_ATTEMPTS = 3;

export default withErrorLogging(async function handler(): Promise<Response> {
  const due = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, "scheduled"), lte(drafts.scheduledFor, new Date())))
    .orderBy(asc(drafts.scheduledFor))
    .limit(MAX_PER_TICK);
  if (!due.length) return json({ due: 0 });

  const results: Record<string, unknown>[] = [];
  for (const d of due) {
    // Concurrency guard: two overlapping ticks must not double-post.
    if (!(await once(`sched:post:${d.id}`, 10 * 60))) {
      results.push({ id: d.id, skipped: "claimed by another tick" });
      continue;
    }
    // Burn the attempt BEFORE any render so a CPU-killed run still counts.
    const attempts = (d.scheduleAttempts ?? 0) + 1;
    await db.update(drafts).set({ scheduleAttempts: attempts }).where(eq(drafts.id, d.id));
    try {
      let image: Uint8Array | undefined;
      if (d.scheduledPng) {
        const raw = d.scheduledPng.replace(/^data:image\/png;base64,/, "");
        const bin = atob(raw);
        image = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) image[i] = bin.charCodeAt(i);
      }
      const res = await postDraftNow(d.id, {
        image,
        skipImage: !image && attempts > MAX_RENDER_ATTEMPTS,
      });
      // Clear the stored PNG so posted rows don't hold megabytes forever.
      await db.update(drafts).set({ scheduledPng: null }).where(eq(drafts.id, d.id));
      void notifyAssistant(
        "fieldtilt: scheduled post published",
        `"${res.content.slice(0, 160)}"\n\nhttps://x.com/i/status/${res.tweetId}`
      );
      results.push({ id: d.id, posted: true, tweetId: res.tweetId, imageAttached: res.imageAttached });
    } catch (e) {
      const error = String((e as Error).message || e).slice(0, 160);
      results.push({ id: d.id, error, attempts });
      if (attempts >= MAX_RENDER_ATTEMPTS + 2) {
        // Hard-stuck (auth/network, not render): park it back in pending.
        await db
          .update(drafts)
          .set({ status: "pending", scheduledFor: null, scheduledPng: null })
          .where(eq(drafts.id, d.id));
        void notifyAssistant(
          "fieldtilt: scheduled post FAILED",
          `Draft ${d.id.slice(0, 8)} could not post after ${attempts} attempts (${error}). Moved back to pending: https://fieldtilt.joelobafemii.workers.dev/#queue`
        );
      }
    }
  }
  return json({ due: due.length, results });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
