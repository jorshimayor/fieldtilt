/**
 * Operator escape hatch: render a card locally (resvg in Node — the free-plan
 * Worker can't) and publish text+card to X directly via the stored token.
 * Used when the LLM composer is unavailable (e.g. OpenRouter credits out).
 *
 *   npx tsx scripts/post-now.mts <payload.json>
 *   payload: { text: string, cardKind?: CardKind, cardData?: object }
 */
import { readFileSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] = line.slice(i + 1);
}

const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
const text: string = payload.text;
console.log("tweet chars:", text.length);
if (text.length > 280) throw new Error("tweet too long");

const { getLatestToken, refreshAccessToken, uploadMedia, publishTweet } = await import("../packages/shared/x.ts");
let tok = await getLatestToken();
if (!tok) throw new Error("no X token stored");
if (tok.expiresAt && new Date(tok.expiresAt) < new Date() && tok.refreshToken) tok = await refreshAccessToken(tok.refreshToken);

let mediaIds: string[] | undefined;
if (payload.cardKind) {
  const cards: any = await import("../packages/render/cards.ts");
  const { resolveCardImages } = await import("../packages/render/images.ts");
  const fnMap: Record<string, string> = {
    match_preview: "matchPreviewCard", score: "scoreCard", post_match: "postMatchCard",
    player_stat: "playerStatCard", transfer: "transferCard", form: "formCard",
    editorial: "editorialCard", milestone: "milestoneCard", comparison: "comparisonCard",
    leaderboard: "leaderboardCard", shot_map: "shotMapCard", head_to_head: "headToHeadCard", scatter: "scatterCard", match_stats: "matchStatsCard",
  };
  await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  const svg = cards[fnMap[payload.cardKind]](await resolveCardImages(payload.cardData || {}));
  const fonts = ["Regular", "Bold", "ExtraBold"].flatMap((w) => [
    readFileSync(`packages/render/fonts/Montserrat-${w}.ttf`),
    readFileSync(`packages/render/fonts/JetBrainsMono-${w}.ttf`),
  ]);
  const png = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Montserrat", loadSystemFonts: false } }).render().asPng();
  console.log("card rendered:", Math.round(png.length / 1024), "KB");
  const id = await uploadMedia(tok.accessToken, new Uint8Array(png));
  console.log("media uploaded:", id);
  mediaIds = [id];
}

const res = await publishTweet(tok.accessToken, text, mediaIds);
console.log("POSTED:", JSON.stringify(res));
