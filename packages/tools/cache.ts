import { redis } from "@shared/redis";

type Entry<T> = { value: T; expiresAt: number };
const store = new Map<string, Entry<unknown>>();

/**
 * Cache health, remembered per isolate.
 *
 * A deleted Upstash database does not announce itself: every get/set just
 * fails, the in-memory fallback cannot survive between cron invocations, and
 * the five-minute crons start hitting Postgres on every tick. That is what
 * exhausted Neon's compute quota and took the bot down — a dead CACHE killed
 * the DATABASE. So cache failures are now caught rather than thrown, and
 * callers that exist to protect the database can ask whether the cache is
 * actually working before deciding to query.
 */
let healthy = true;
export function isCacheHealthy(): boolean {
  return healthy;
}

export async function setCache<T>(key: string, value: T, ttlMs: number) {
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), { ex: Math.ceil(ttlMs / 1000) });
      healthy = true;
      return;
    } catch {
      healthy = false;
      // fall through to the in-memory copy so this isolate still benefits
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function getCache<T>(key: string): Promise<T | undefined> {
  if (redis) {
    try {
      const v = await redis.get<string>(key);
      healthy = true;
      if (v !== null && v !== undefined) {
        return (typeof v === "string" ? JSON.parse(v) : v) as T;
      }
      return undefined;
    } catch {
      healthy = false;
      // fall through to the in-memory copy
    }
  }
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}
