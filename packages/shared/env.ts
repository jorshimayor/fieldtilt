/**
 * Lazy env loader.
 *
 * Required keys (OPENROUTER_API_KEY, NEON_DATABASE_URL) are validated the first
 * time they are *read*, not at module load. This lets routes that don't touch
 * a given subsystem boot without the whole env being populated — e.g.
 * /api/generate-tweet only needs OPENROUTER_API_KEY and will no longer crash
 * because NEON_DATABASE_URL is missing.
 *
 * Usage is unchanged:  import { env } from "@shared/env"; env.OPENROUTER_API_KEY
 */

export type Env = {
  OPENROUTER_API_KEY: string;
  NEON_DATABASE_URL: string;
  API_FOOTBALL_KEY?: string;
  FOOTBALL_DATA_KEY?: string;
  FOOTBALL_PROVIDER?: string;
  UPSTASH_REDIS_URL?: string;
  UPSTASH_REDIS_TOKEN?: string;
  SENTRY_DSN?: string;
  TAVILY_API_KEY?: string;
  NANO_BANANA_API_KEY?: string;
  GEMINI_API_KEY?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
  OTLP_ENDPOINT?: string;
  CRON_SECRET?: string;
  API_FOOTBALL_DAILY_BUDGET?: string;
  OPENROUTER_MODEL?: string;
};

const REQUIRED: (keyof Env)[] = ["OPENROUTER_API_KEY", "NEON_DATABASE_URL"];

function read(key: keyof Env): string | undefined {
  const procEnv = (globalThis as any).process?.env;
  return procEnv ? procEnv[key as string] : undefined;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;
    const key = prop as keyof Env;
    const raw = read(key);
    if (raw === undefined || raw === "") {
      if (REQUIRED.includes(key)) {
        throw new Error(
          `Missing env: ${String(
            key
          )}. Add it to .env/.dev.vars (local) or Cloudflare Worker secrets (prod).`
        );
      }
      return undefined;
    }
    return raw;
  },
}) as Env;
