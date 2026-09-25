import { Redis } from "@upstash/redis";
import { env } from "./env";

export const redis = env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN ? new Redis({ url: env.UPSTASH_REDIS_URL, token: env.UPSTASH_REDIS_TOKEN }) : undefined;

/**
 * First-caller-wins claim. Returns true once per key, false after.
 *
 * KV goes FIRST even though Redis SET NX is the atomically correct primitive,
 * because a dead Upstash host resolves set() to null instead of throwing —
 * and null is indistinguishable from SET NX's legitimate "key already exists".
 * A vanished Redis therefore reports every key as already claimed and skips
 * every post, silently, with no exception to catch. KV is the cache we
 * actually deploy and can verify, so it decides.
 *
 * KV has no compare-and-set, so this is read-then-write: safe for callers
 * minutes apart (our crons), racy only for genuinely simultaneous calls.
 * Content that must NEVER repeat also goes through claimPostedKey(), which is
 * a unique index in Postgres.
 *
 * Returning true when no backend exists would disable duplicate protection
 * entirely, so a missing backend returns FALSE — better a skipped post than
 * a double post.
 */
export async function once(key: string, ttlSec: number): Promise<boolean> {
  const kv = (globalThis as any).__CACHE_KV;
  if (kv) {
    try {
      if (await kv.get(key)) return false;
      await kv.put(key, "1", { expirationTtl: Math.max(60, ttlSec) });
      return true;
    } catch {
      /* fall through to Redis */
    }
  }
  if (redis) {
    try {
      return (await redis.set(key, "1", { nx: true, ex: ttlSec })) === "OK";
    } catch {
      return false;
    }
  }
  return false;
}
