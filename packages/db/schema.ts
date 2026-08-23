import { pgTable, bigint, text, boolean, smallint, timestamp, uuid, bigserial, integer, jsonb, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  platform: text("platform").notNull(),
  username: text("username"),
  isChelseaFan: boolean("is_chelsea_fan").default(false),
  rivalIntensity: smallint("rival_intensity").default(0),
  favoritePlayer: text("favorite_player"),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  platformIdx: index("users_platform_idx").on(table.platform, table.id)
}));

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  platform: text("platform").notNull(),
  currentTone: text("current_tone").$type<"professional" | "savage">().default("professional"),
  lastActive: timestamp("last_active").defaultNow()
});

export const messages = pgTable("messages", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  convoId: uuid("convo_id").references(() => conversations.id, { onDelete: "cascade" }),
  platformMessageId: text("platform_message_id"),
  direction: text("direction").$type<"in" | "out">().notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  modelUsed: text("model_used"),
  tokenUsage: integer("token_usage"),
  createdAt: timestamp("created_at").defaultNow()
});

export const quotes = pgTable("quotes", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  player: text("player").notNull(),
  content: text("content").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow()
});

export const newsCache = pgTable("news_cache", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  player: text("player"),
  data: jsonb("data"),
  expiresAt: timestamp("expires_at")
});

export const statCache = pgTable("stat_cache", {
  key: text("key").primaryKey(),
  data: jsonb("data"),
  expiresAt: timestamp("expires_at")
});

/**
 * Approval queue. Every composed post (tweet text + infographic spec) lands
 * here as `pending`; the dashboard lets you edit + post manually, or the
 * pipeline auto-posts when config/flags.json has publish_draft_only=false.
 * cardData stores the card's *data*, not pixels — images render on demand.
 */
export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(), // tweet kind (match_preview, live_update, …)
  source: text("source"), // e.g. "cron:fixtures", "dashboard"
  content: text("content").notNull(), // tweet text
  longform: boolean("longform").default(false),
  cardKind: text("card_kind"),
  cardData: jsonb("card_data"),
  status: text("status").$type<"pending" | "posted" | "rejected">().notNull().default("pending"),
  tweetId: text("tweet_id"),
  modelUsed: text("model_used"),
  createdAt: timestamp("created_at").defaultNow(),
  postedAt: timestamp("posted_at")
}, (table) => ({
  statusIdx: index("drafts_status_idx").on(table.status, table.createdAt)
}));

/**
 * Outputs from the Python analytics service (analytics/) — the contract
 * between "models in Python" and "delivery in TypeScript". The service
 * writes one row per (model, subject, gameweek); the Worker reads the
 * latest rows to publish weekly model calls and score last week's.
 */
export const modelOutputs = pgTable("model_outputs", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  model: text("model").notNull(), // e.g. "xg-v1", "season-forecast-v1"
  subject: text("subject"), // team/player/fixture the row is about
  season: integer("season"), // start year, e.g. 2026
  gameweek: integer("gameweek"),
  payload: jsonb("payload").notNull(), // model-specific: prediction, features, score
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  modelIdx: index("model_outputs_idx").on(table.model, table.season, table.gameweek)
}));

/**
 * Durable idempotency for posted content (transfers, spotlights, …).
 * Redis `once()` handles short-window dedup; this survives Redis eviction.
 */
export const postedItems = pgTable("posted_items", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  tweetId: text("tweet_id"),
  createdAt: timestamp("created_at").defaultNow()
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }),
  platform: text("platform").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow()
});
