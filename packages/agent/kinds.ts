/** Shared kind lists — a leaf module with type-only imports so agents can
 * import it without dragging in the wasm renderer. */
import type { TweetKind } from "../shared/tweet-prompts";
import type { CardKind } from "../render/index";

export const TWEET_KINDS: TweetKind[] = [
  "match_preview",
  "live_update",
  "post_match",
  "player_stat",
  "transfer_news",
  "weekly_deep_dive",
  "long_read",
];
export const CARD_KINDS: CardKind[] = [
  "match_preview",
  "score",
  "post_match",
  "player_stat",
  "transfer",
  "form",
  "editorial",
  "milestone",
  "comparison",
  "leaderboard",
];
