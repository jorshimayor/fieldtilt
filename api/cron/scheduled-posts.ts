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
import { getCache, setCache, verifyCache } from "../../packages/tools/cache";
import { withErrorLogging } from "../../packages/observability/index";

const MAX_PER_TICK = 3;
const MAX_RENDER_ATTEMPTS = 3;

/**
 * Redis-held "when is the next scheduled post due".
 *
 * This sweep used to query Postgres on every 5-minute tick, forever. Neon
 * auto-suspends an idle compute after ~5 minutes, so a query every 5
 * minutes meant the database never slept: ~720 compute hours a month
 * against a free-tier allowance near 190. It exhausted the quota and took
 * the whole bot down with it.
 *
 * Now the clock lives in Redis (which is what a cheap hot key is for) and
 * Postgres is only woken when something is actually due. NEXT_KEY holds the
 * earliest due time; PROBE_KEY bounds how often we re-derive that from the
 * database when Redis has no opinion (cold start, eviction), so a lost key
 * degrades to one wakeup an hour rather than silently never posting.
 */
export const NEXT_KEY = "sched:next";
const PROBE_KEY = "sched:probe";
const PROBE_COOLDOWN_MS = 60 * 60 * 1000;

export default withErrorLogging(async function handler(): Promise<Response> {
  // Prove the cache works BEFORE deciding to query Postgres: it is the only
  // thing standing between this five-minute cron and the compute quota.
  if (!(await verifyCache())) {
    // Without a working cache there is no way to stop this sweep from waking
    // Postgres every five minutes. Delaying scheduled posts is recoverable;
    // burning the database's compute quota is not.
    return json({
      due: 0,
      skipped: "cache unavailable - refusing to poll the database",
      fix: "recreate the Upstash database and update UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN",
    });
  }
  const next = await getCache<string>(NEXT_KEY);
  if (next) {
    if (Date.parse(next) > Date.now()) {
      return json({ due: 0, skipped: "nothing due", next });
    }
  } else {
    // No cached clock: check the DB at most once an hour to rebuild it.
    if (await getCache(PROBE_KEY)) return json({ due: 0, skipped: "nothing due (probe cooldown)" });
    await setCache(PROBE_KEY, true, PROBE_COOLDOWN_MS);
  }

  const due = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, "scheduled"), lte(drafts.scheduledFor, new Date())))
    .orderBy(asc(drafts.scheduledFor))
    .limit(MAX_PER_TICK);
  if (!due.length) {
    await refreshNext();
    return json({ due: 0, skipped: "nothing due (db-checked)" });
  }

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
  await refreshNext();
  return json({ due: due.length, results });
});

/** Re-derive the next due time from Postgres. Called only when already awake. */
async function refreshNext(): Promise<void> {
  try {
    const [soonest] = await db
      .select({ at: drafts.scheduledFor })
      .from(drafts)
      .where(eq(drafts.status, "scheduled"))
      .orderBy(asc(drafts.scheduledFor))
      .limit(1);
    if (soonest?.at) {
      // Long TTL: this key is the schedule, not a cache of it.
      await setCache(NEXT_KEY, new Date(soonest.at).toISOString(), 30 * 24 * 60 * 60 * 1000);
    } else {
      // Nothing scheduled: park the clock far out; scheduling writes it back.
      await setCache(NEXT_KEY, new Date(Date.now() + 365 * 864e5).toISOString(), 30 * 24 * 60 * 60 * 1000);
    }
  } catch {
    /* leaving the old clock in place is safer than clearing it */
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
