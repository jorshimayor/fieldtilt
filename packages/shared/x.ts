export function createAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL("https://twitter.com/i/oauth2/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  // media.write is required for uploading infographics. If you authorized the
  // bot before this scope existed, visit /api/x/auth again to re-consent.
  u.searchParams.set("scope", "tweet.read tweet.write users.read media.write dm.read offline.access");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", state);
  u.searchParams.set("code_challenge_method", "plain");
  return u.toString();
}

import { env } from "./env";
import { db } from "@db/client";
import { oauthTokens } from "@db/schema";
import { desc, eq } from "drizzle-orm";

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const b64 =
    typeof (globalThis as any).btoa === "function"
      ? (globalThis as any).btoa(raw)
      : Buffer.from(raw, "utf8").toString("base64");
  return `Basic ${b64}`;
}

export async function publishTweet(
  token: string,
  text: string,
  mediaIds?: string[]
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text };
  if (mediaIds && mediaIds.length) body.media = { media_ids: mediaIds };
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.data?.id) {
    throw new Error(`x_tweet_failed_${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return { id: json.data.id };
}

/**
 * Upload an image via the X API v2 media endpoint (OAuth2 user context,
 * requires the media.write scope). Simple upload — fine for PNGs under 5MB.
 */
export async function uploadMedia(
  token: string,
  bytes: Uint8Array,
  mimeType = "image/png"
): Promise<string> {
  // X's v2 media endpoint 503s intermittently — retry 5xx with backoff
  // (verified: unauthenticated probes 401 while authenticated uploads 503,
  // i.e. the service is up but flaky on the upload path).
  const waits = [0, 1200, 3000];
  let lastErr = "";
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const form = new FormData();
    const copy = new Uint8Array(bytes); // detach from any pooled buffer
    form.append("media", new Blob([copy.buffer as ArrayBuffer], { type: mimeType }));
    form.append("media_category", "tweet_image");
    const res = await fetch("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    const id = json?.data?.id || json?.media_id_string || "";
    if (res.ok && id) return String(id);
    lastErr = `x_media_upload_failed_${res.status}: ${JSON.stringify(json).slice(0, 500)}`;
    if (res.status < 500) break; // 4xx won't heal on retry
  }
  throw new Error(lastErr);
}

export async function startOAuth(state: string): Promise<{ url: string; verifier: string }> {
  const url = createAuthUrl(env.X_CLIENT_ID || "", env.X_REDIRECT_URI || "", state);
  return { url, verifier: state };
}

export async function completeOAuth(state: string, code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  const clientId = env.X_CLIENT_ID || "";
  const clientSecret = env.X_CLIENT_SECRET || "";
  const redirectUri = env.X_REDIRECT_URI || "";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: state,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) headers.Authorization = basicAuthHeader(clientId, clientSecret);

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });
  const json = (await res.json().catch(() => ({}))) as any;
  const accessToken = json?.access_token || "";
  if (!res.ok || !accessToken) {
    throw new Error(`x_oauth_exchange_failed_${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const refreshToken = json?.refresh_token || undefined;
  const expiresIn = json?.expires_in || 0;
  const expiresAt = new Date(Date.now() + Number(expiresIn || 0) * 1000);
  await db.insert(oauthTokens).values({ platform: "x", accessToken, refreshToken: refreshToken || null, expiresAt });
  return { accessToken, refreshToken, expiresAt };
}

export async function getLatestToken(userId?: number): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null> {
  const rows = await db.select().from(oauthTokens).orderBy(desc(oauthTokens.createdAt)).limit(1);
  if (!rows[0]) return null;
  return { accessToken: rows[0].accessToken, refreshToken: rows[0].refreshToken || undefined, expiresAt: rows[0].expiresAt || undefined };
}

export async function refreshAccessToken(rt: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  const clientId = env.X_CLIENT_ID || "";
  const clientSecret = env.X_CLIENT_SECRET || "";

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) headers.Authorization = basicAuthHeader(clientId, clientSecret);

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });
  const json = (await res.json().catch(() => ({}))) as any;
  const accessToken = json?.access_token || "";
  if (!res.ok || !accessToken) {
    throw new Error(`x_token_refresh_failed_${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const refreshToken = json?.refresh_token || undefined;
  const expiresIn = json?.expires_in || 0;
  const expiresAt = new Date(Date.now() + Number(expiresIn || 0) * 1000);
  await db.insert(oauthTokens).values({ platform: "x", accessToken, refreshToken: refreshToken || null, expiresAt });
  return { accessToken, refreshToken, expiresAt };
}

export async function ensureAccessToken(): Promise<string | null> {
  const tok = await getLatestToken();
  if (!tok) return null;
  const soon = tok.expiresAt ? tok.expiresAt.getTime() - Date.now() < 60_000 : false;
  if (soon && tok.refreshToken) {
    const r = await refreshAccessToken(tok.refreshToken);
    return r.accessToken;
  }
  return tok.accessToken;
}

/**
 * Publish a tweet as the connected account, optionally with an image.
 * Throws if no account is connected (visit /api/x/auth first) or if X
 * rejects the post — crons surface this via withErrorLogging.
 */
export async function publishTweetForUser(
  text: string,
  image?: Uint8Array
): Promise<{ id: string; mediaId?: string }> {
  const at = await ensureAccessToken();
  if (!at) {
    throw new Error("x_not_connected: no OAuth token stored. Visit /api/x/auth to connect the account.");
  }
  let mediaIds: string[] | undefined;
  let mediaId: string | undefined;
  if (image && image.length) {
    mediaId = await uploadMedia(at, image);
    mediaIds = [mediaId];
  }
  const res = await publishTweet(at, text, mediaIds);
  return { ...res, mediaId };
}
