/**
 * One pipeline for every automated post:
 *
 *   data → LLM copy → DRAFT row (approval queue) → [auto-post if enabled]
 *
 * With flags.publish_draft_only = true (the default), nothing is posted:
 * drafts wait in the dashboard queue where you can edit the text, preview the
 * infographic, and post with one click. Set the flag false to auto-post.
 *
 * Auto-posting renders the PNG server-side (needs Workers Paid CPU). The
 * manual dashboard flow rasterizes in YOUR browser instead, which is why the
 * queue works on the free plan.
 */
import { routeAndChat } from "./openrouter";
import {
  buildTweetMessages,
  normalizeTweet,
  normalizeLongform,
  TweetKind,
  Tone,
} from "./tweet-prompts";
import { publishTweetForUser } from "./x";
import { once } from "./redis";
import { db } from "@db/client";
import { messages, postedItems, drafts } from "@db/schema";
import { eq } from "drizzle-orm";
import { renderCardPng, CardKind } from "@render/index";
import flags from "../../config/flags.json";

export type PostResult = {
  draftId: string;
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
  source?: string;
  longform?: boolean;
  /** Always queue as pending, even when auto-post is enabled (dashboard composes). */
  forceQueue?: boolean;
  /** Redis idempotency key — claimed before posting. */
  idKey?: string;
  idTtlSec?: number;
}): Promise<PostResult> {
  // Claim the idempotency key BEFORE spending LLM tokens or queueing — this is
  // what keeps a 5-minute poller from stacking duplicate drafts in the queue.
  if (opts.idKey) {
    const first = await once(opts.idKey, opts.idTtlSec ?? 24 * 60 * 60);
    if (!first) {
      return { draftId: "", tweet: "", posted: false, tweetId: "", imageAttached: false, skipped: "idempotency: already composed" };
    }
  }

  const tone: Tone = opts.tone === "savage" && flags.savage_mode_enabled ? "savage" : "professional";
  const llm = await routeAndChat({
    messages: buildTweetMessages(opts.kind, tone, opts.data),
  });
  const tweet = opts.longform ? normalizeLongform(llm.content) : normalizeTweet(llm.content);
  if (!tweet) {
    return { draftId: "", tweet: "", posted: false, tweetId: "", imageAttached: false, skipped: "llm produced SKIP" };
  }

  const [draft] = await db
    .insert(drafts)
    .values({
      kind: opts.kind,
      source: opts.source || null,
      content: tweet,
      longform: Boolean(opts.longform),
      cardKind: opts.card?.kind || null,
      cardData: opts.card?.data ?? null,
      modelUsed: llm.model,
    })
    .returning({ id: drafts.id });
  const draftId = draft?.id || "";

  if (flags.publish_draft_only || opts.forceQueue) {
    return { draftId, tweet, posted: false, tweetId: "", imageAttached: false, skipped: "queued for approval" };
  }

  const { tweetId, imageAttached } = await postDraftNow(draftId);
  return { draftId, tweet, posted: true, tweetId, imageAttached };
}

/**
 * Post a draft to X. If `image` is provided (browser-rendered PNG from the
 * dashboard), it's used as-is; otherwise the card renders server-side.
 * `contentOverride` lets the dashboard post edited text.
 */
export async function postDraftNow(
  draftId: string,
  opts?: { image?: Uint8Array; contentOverride?: string }
): Promise<{ tweetId: string; imageAttached: boolean; content: string }> {
  const rows = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  const draft = rows[0];
  if (!draft) throw new Error(`draft_not_found: ${draftId}`);
  if (draft.status === "posted") throw new Error(`draft_already_posted: ${draftId}`);

  const content = (opts?.contentOverride || draft.content).trim();
  if (!content) throw new Error("draft_empty_content");

  let image = opts?.image;
  if (!image && draft.cardKind && flags.image_generation_enabled) {
    image = await renderCardPng(draft.cardKind as CardKind, draft.cardData);
  }

  const res = await publishTweetForUser(content, image);

  await db
    .update(drafts)
    .set({ status: "posted", tweetId: res.id, content, postedAt: new Date() })
    .where(eq(drafts.id, draftId));
  await db.insert(messages).values({
    direction: "out",
    content,
    modelUsed: draft.modelUsed,
    imageUrl: image ? `card:${draft.cardKind}` : null,
  });

  return { tweetId: res.id, imageAttached: Boolean(image), content };
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
