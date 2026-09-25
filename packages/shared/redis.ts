import { Redis } from "@upstash/redis";
import { env } from "./env";

export const redis = env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN ? new Redis({ url: env.UPSTASH_REDIS_URL, token: env.UPSTASH_REDIS_TOKEN }) : undefined;

/**
 * First-caller-wins claim. Returns true once per key, false after.
 *
 * Redis gives this atomically with SET NX. KV has no compare-and-set, so the
 * fallback is read-then-write: safe for callers minutes apart (our crons),
 * racy only for genuinely simultaneous calls. Content that must NEVER repeat
 * also goes through claimPostedKey(), which is a unique index in Postgres.
 *
 * Returning true when no backend exists would disable duplicate protection
 * entirely, so a missing backend returns FALSE — better a skipped post than
 * a double post.
 */
export async function once(key: string, ttlSec: number): Promise<boolean> {
  if (redis) {
    try {
      return (await redis.set(key, "1", { nx: true, ex: ttlSec })) === "OK";
    } catch {
      /* fall through to KV */
    }
  }
  const kv = (globalThis as any).__CACHE_KV;
  if (kv) {
    try {
      if (await kv.get(key)) return false;
      await kv.put(key, "1", { expirationTtl: Math.max(60, ttlSec) });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
