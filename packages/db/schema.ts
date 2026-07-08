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
