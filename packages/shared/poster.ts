/**
 * One pipeline for every automated post:
 *
 *   data → LLM tweet copy → infographic PNG → X (media + tweet) → Neon log
 *
 * Honors flags.publish_draft_only (composes + renders but never posts) and
 * takes an idempotency key BEFORE posting so retries can't double-post.
 */
import { routeAndChat } from "./openrouter";
import {
  buildTweetMessages,
  normalizeTweet,
  TweetKind,
  Tone,
} from "./tweet-prompts";
import { publishTweetForUser } from "./x";
import { once } from "./redis";
import { db } from "@db/client";
import { messages, postedItems } from "@db/schema";
import { eq } from "drizzle-orm";
import { renderCardPng, CardKind } from "@render/index";
import flags from "../../config/flags.json";

export type PostResult = {
  tweet: string;
  posted: boolean;
  tweetId: string;
  imageAttached: boolean;
  skipped?: string;
};

export async function composeAndPost(opts: {
  kind: TweetKind;
  tone?: Tone;
  data: Record<string, unknown>;
  card?: { kind: CardKind; data: unknown };
  /** Redis idempotency key — claimed before posting. */
  idKey?: string;
  idTtlSec?: number;
}): Promise<PostResult> {
  const tone: Tone = opts.tone === "savage" && flags.savage_mode_enabled ? "savage" : "professional";
  const llm = await routeAndChat({
    messages: buildTweetMessages(opts.kind, tone, opts.data),
  });
  const tweet = normalizeTweet(llm.content);
  if (!tweet) {
    return { tweet: "", posted: false, tweetId: "", imageAttached: false, skipped: "llm produced SKIP" };
  }

  // Render even in draft mode so template regressions surface immediately.
  let image: Uint8Array | undefined;
  if (opts.card && flags.image_generation_enabled) {
    image = await renderCardPng(opts.card.kind, opts.card.data);
  }

  let tweetId = "";
  let posted = false;
  if (!flags.publish_draft_only) {
    if (opts.idKey) {
      const first = await once(opts.idKey, opts.idTtlSec ?? 24 * 60 * 60);
      if (!first) {
        return { tweet, posted: false, tweetId: "", imageAttached: false, skipped: "idempotency: already posted" };
      }
    }
    const res = await publishTweetForUser(tweet, image);
    tweetId = res.id;
    posted = true;
  }

  await db.insert(messages).values({
    direction: "out",
    content: tweet,
    modelUsed: llm.model,
    imageUrl: image ? `card:${opts.card!.kind}` : null,
  });

  return { tweet, posted, tweetId, imageAttached: Boolean(image) };
}

/**
 * Durable one-shot claim in Postgres. Returns true the first time a key is
 * seen; false forever after. Used for content that must never repeat
 * (transfers, spotlights) even if Redis is cold.
 */
export async function claimPostedKey(key: string, kind: string): Promise<boolean> {
  const rows = await db
    .insert(postedItems)
    .values({ key, kind })
    .onConflictDoNothing()
    .returning({ key: postedItems.key });
  return rows.length > 0;
}

export async function recordPostedTweet(key: string, tweetId: string): Promise<void> {
  await db.update(postedItems).set({ tweetId }).where(eq(postedItems.key, key));
}
