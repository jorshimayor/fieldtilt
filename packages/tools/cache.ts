import { redis } from "@shared/redis";

/**
 * Cache backend, in preference order: Cloudflare KV -> Upstash Redis ->
 * per-isolate memory.
 *
 * KV is first-party on purpose. The previous backend was an external
 * free-tier Redis that was deleted without warning; with nothing absorbing
 * load, the five-minute crons queried Postgres on every tick, the database
 * never auto-suspended, and its compute quota was exhausted. A cache that
 * can vanish silently is a cache that can take the database with it.
 *
 * Two KV constraints shape this file:
 *  - `expirationTtl` must be at least 60 seconds, so anything shorter is
 *    deliberately kept in memory only. Those short TTLs exist to dedupe
 *    within a burst, not across invocations, so nothing is lost.
 *  - KV is eventually consistent (up to ~60s). Fine for caching; see
 *    `once()` in shared/redis.ts for what that means for idempotency.
 */

type Entry<T> = { value: T; expiresAt: number };
const store = new Map<string, Entry<unknown>>();
const KV_MIN_TTL_SEC = 60;

const kv = (): any => (globalThis as any).__CACHE_KV;

let healthy = true;
export function isCacheHealthy(): boolean {
  return healthy;
}

/**
 * Prove the cache actually persists, by writing a token and reading it back
 * through the real backend.
 *
 * A missing backend does not necessarily throw — a dead Upstash simply
 * returned null for every read — so "no exception" is not evidence of
 * health, and the in-memory fallback would happily answer its own round
 * trip inside one isolate. Only a value that survives the backend counts.
 */
export async function verifyCache(): Promise<boolean> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const k = kv();
  if (k) {
    try {
      await k.put("cache:healthcheck", token, { expirationTtl: KV_MIN_TTL_SEC });
      healthy = (await k.get("cache:healthcheck")) === token;
      return healthy;
    } catch {
      healthy = false;
      return false;
    }
  }
  if (redis) {
    try {
      await redis.set("cache:healthcheck", token, { ex: 120 });
      const back = await redis.get<string>("cache:healthcheck");
      healthy = back != null && String(back) === token;
    } catch {
      healthy = false;
    }
    return healthy;
  }
  healthy = false;
  return false;
}

export async function setCache<T>(key: string, value: T, ttlMs: number) {
  const ttlSec = Math.ceil(ttlMs / 1000);
  // Sub-minute TTLs are burst-dedupe, not cross-invocation state.
  if (ttlSec >= KV_MIN_TTL_SEC) {
    const k = kv();
    if (k) {
      try {
        await k.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
        healthy = true;
        return;
      } catch {
        healthy = false;
      }
    } else if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), { ex: ttlSec });
        healthy = true;
        return;
      } catch {
        healthy = false;
      }
    }
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function getCache<T>(key: string): Promise<T | undefined> {
  const k = kv();
  if (k) {
    try {
      const v = await k.get(key);
      healthy = true;
      if (v != null) return JSON.parse(v) as T;
    } catch {
      healthy = false;
    }
  } else if (redis) {
    try {
      const v = await redis.get<string>(key);
      healthy = true;
      if (v != null) return (typeof v === "string" ? JSON.parse(v) : v) as T;
    } catch {
      healthy = false;
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
