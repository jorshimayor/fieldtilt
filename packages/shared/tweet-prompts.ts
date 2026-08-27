import { club } from "./club";

/**
 * Club tweet prompt library (club identity from @shared/club).
 *
 * Every prompt MUST:
 *  - stay under 280 characters (Twitter hard limit)
 *  - end with the club hashtag and emoji (from @shared/club)
 *  - stay factual (never invent stats) — the LLM is given raw data in the user message
 *  - match the tone: "professional" (calm, analytical) or "savage" (confident, SecretScout-style banter)
 *
 * The `system` string is the system prompt. The `user` template is a simple
 * f-string-like body where `${...}` tokens get replaced from the `data` object
 * before the call.
 */

export type TweetKind =
  | "match_preview"
  | "live_update"
  | "post_match"
  | "player_stat"
  | "transfer_news"
  | "weekly_deep_dive"
  | "long_read";

export type Tone = "professional" | "savage";

type PromptSpec = {
  system: (tone: Tone) => string;
  user: (data: Record<string, unknown>) => string;
};

const BASE_VOICE = (tone: Tone) => `
You are the ${club().fullName} tweet writer for this club account.
Voice: ${tone === "savage"
    ? "confident, witty, SecretScout-style banter. Never cruel. Never hateful. Never about race, gender, or protected traits. Keep it football."
    : "calm, analytical, fan-friendly, enthusiastic but measured."}
Hard rules:
- Output ONE tweet only. Plain text. No quotes around it.
- MAX 270 characters (leave room for safety).
- Always end with "${club().hashtag} ${club().emoji}".
- Never invent stats. Only use numbers explicitly provided in the user message.
- Stats lead. Open with the strongest number provided and work in as many of the provided numbers as fit naturally; a stat-dense tweet beats a vibes tweet every time.
- LAYOUT: never cram facts into one paragraph. Structure: hook line, then a BLANK line, then each fact on its OWN line, then a blank line before the hashtag suffix. Use real line breaks.
- NEVER use em dashes or en dashes anywhere. Use commas, periods, colons or hyphens instead.
- If the user message contains no usable facts, output exactly: SKIP
- Never mention other clubs in a derogatory, discriminatory way. Banter about football only.
- No hashtag spam. One or two hashtags max, with ${club().hashtag} always last.
`.trim();

export const tweetPrompts: Record<TweetKind, PromptSpec> = {
  match_preview: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a MATCH PREVIEW tweet.
Structure: opponent + competition + date + a hook (kick-off, venue, or a key storyline).`,
    user: (d) => `Opponent: ${d.opponent}
Competition: ${d.competition}
Date (local): ${d.date}
Venue: ${d.venue ?? "TBD"}
Hook: ${d.hook ?? "none"}`,
  },

  live_update: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a LIVE MATCH UPDATE tweet.
Structure: minute + event (goal / card / sub) + scoreline + one supporting stat (possession or xG).`,
    user: (d) => `Minute: ${d.minute}
Event: ${d.event}
Scorer/actor: ${d.actor ?? "n/a"}
Score: ${d.score}
Possession: ${d.possession ?? "n/a"}%
xG: ${d.xg ?? "n/a"}`,
  },

  post_match: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a POST-MATCH tweet.
Structure: final scoreline + possession + xG + shots + MOTM (if provided).`,
    user: (d) => `Final: ${d.score}
Possession: ${d.possession}%
xG: ${d.xg}
Shots (on target / total): ${d.shotsOnTarget}/${d.shotsTotal}
MOTM: ${d.motm ?? "n/a"} (${d.motmRating ?? "n/a"})`,
  },

  player_stat: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a PLAYER STAT highlight tweet.
Structure: when 3+ numbers are provided, use the fan-account list format —
hook line containing the biggest number, then one stat per line prefixed
with a fitting emoji (⚽ 🅰️ ⏱ 🎯 🏆), then the suffix. Otherwise: player
name + standout number(s) + short context.`,
    user: (d) => `Player: ${d.player}
Season: ${d.season}
Goals: ${d.goals ?? "n/a"}
Assists: ${d.assists ?? "n/a"}
Appearances: ${d.apps ?? "n/a"}
Extra stat (tackles, xG, pass%, key passes...): ${d.extra ?? "n/a"}`,
  },

  transfer_news: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a TRANSFER NEWS tweet.
Structure: player + direction (in/out/linked) + fee (if known) + source.
If reliability is 'rumor', use softening language like "reports" or "linked with".`,
    user: (d) => `Player: ${d.player}
Direction: ${d.direction}
Fee: ${d.fee ?? "undisclosed"}
From/To: ${d.counterparty ?? "n/a"}
Reliability: ${d.reliability ?? "rumor"}
Source: ${d.source ?? "n/a"}`,
  },

  weekly_deep_dive: {
    system: (tone) => `${BASE_VOICE(tone)}
Task: Write a WEEKLY DEEP-DIVE tweet.
Structure: a thematic insight (form, a player arc, a tactical trend) backed by one or two numbers.`,
    user: (d) => `Theme: ${d.theme}
Key numbers: ${d.numbers}
Window: ${d.window ?? "last 5 matches"}`,
  },

  long_read: {
    system: (tone) => `${BASE_VOICE(tone)}
OVERRIDE for this task only: this is a LONG-FORM post (X premium long post),
not a 280-character tweet. Target 600–1500 characters. Structure:
- A sharp one-line hook.
- 2–4 short paragraphs of analysis grounded ONLY in the numbers provided.
- A closing line, ending with the club hashtag and emoji.
Blank line between paragraphs. No markdown, no headers, no bullet lists.
Everything else in the rules above still applies (factual, one output, no invented stats).`,
    user: (d) => `Topic: ${d.topic}
Angle: ${d.angle ?? "form and underlying numbers"}
Data / numbers to ground the piece:
${d.numbers}
Window: ${d.window ?? "this season"}`,
  },
};

/** Hard safety: always enforce the suffix + length. */
const SUFFIX = () => `${club().hashtag} ${club().emoji}`;

export function normalizeTweet(raw: string): string {
  let t = (raw || "").trim();
  if (t === "SKIP") return "";
  // Strip accidental wrapping quotes
  t = t.replace(/^["“'`]+|["”'`]+$/g, "");
  // House style: no em/en dashes anywhere.
  t = t.replace(/[\u2014\u2013]/g, "-");
  // Preserve the line layout (hook / blank line / facts): collapse only
  // horizontal whitespace runs and cap blank lines at one.
  t = t.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // Append the club suffix if missing
  const c = club();
  if (!t.toLowerCase().includes(c.hashtag.toLowerCase())) t = `${t} ${SUFFIX()}`.trim();
  if (!t.includes(c.emoji)) t = `${t} ${c.emoji}`.trim();
  // Enforce 280-char budget by trimming from the end *before* the suffix
  if (t.length > 280) {
    const suffixRe = new RegExp(`\\s*${c.hashtag}\\s*${c.emoji}\\s*$`, "i");
    const body = t.replace(suffixRe, "").trim();
    const maxBody = 280 - (SUFFIX().length + 1); // 1 for space
    const trimmed = body.slice(0, maxBody - 1).replace(/\s+\S*$/, "") + "…";
    t = `${trimmed} ${SUFFIX()}`;
  }
  return t;
}

/** Long-form variant: keeps paragraphs, soft-caps at X's long-post limit. */
export function normalizeLongform(raw: string): string {
  let t = (raw || "").trim();
  if (t === "SKIP") return "";
  t = t.replace(/^["“'`]+|["”'`]+$/g, "").replace(/[\u2014\u2013]/g, "-").trim();
  if (!t.toLowerCase().includes(club().hashtag.toLowerCase())) t = `${t}\n\n${SUFFIX()}`;
  if (t.length > 4000) t = t.slice(0, 3999).replace(/\s+\S*$/, "") + "…";
  return t;
}

export function buildTweetMessages(
  kind: TweetKind,
  tone: Tone,
  data: Record<string, unknown>
): { role: "system" | "user"; content: string }[] {
  const spec = tweetPrompts[kind];
  return [
    { role: "system", content: spec.system(tone) },
    { role: "user", content: spec.user(data) },
  ];
}
