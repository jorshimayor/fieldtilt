export * from "./cards";
export { svgToPng } from "./png";
export { resolveCardImages } from "./images";
export { clubAssets, CLUB_DIRECTORY } from "./clubs";

import {
  matchPreviewCard,
  scoreCard,
  postMatchCard,
  playerStatCard,
  transferCard,
  formCard,
  editorialCard,
  milestoneCard,
  comparisonCard,
  leaderboardCard,
  shotMapCard,
  headToHeadCard,
  HeadToHeadData,
  MilestoneData,
  ComparisonData,
  LeaderboardData,
  ShotMapData,
  MatchPreviewData,
  ScoreCardData,
  PostMatchData,
  PlayerStatData,
  TransferCardData,
  FormCardData,
  EditorialData,
} from "./cards";
import { svgToPng } from "./png";

export type CardKind =
  | "match_preview"
  | "score"
  | "post_match"
  | "player_stat"
  | "transfer"
  | "form"
  | "editorial"
  | "milestone"
  | "comparison"
  | "leaderboard"
  | "shot_map"
  | "head_to_head";

export function buildCardSvg(kind: CardKind, data: unknown): string {
  switch (kind) {
    case "match_preview":
      return matchPreviewCard(data as MatchPreviewData);
    case "score":
      return scoreCard(data as ScoreCardData);
    case "post_match":
      return postMatchCard(data as PostMatchData);
    case "player_stat":
      return playerStatCard(data as PlayerStatData);
    case "transfer":
      return transferCard(data as TransferCardData);
    case "form":
      return formCard(data as FormCardData);
    case "editorial":
      return editorialCard(data as EditorialData);
    case "milestone":
      return milestoneCard(data as MilestoneData);
    case "comparison":
      return comparisonCard(data as ComparisonData);
    case "leaderboard":
      return leaderboardCard(data as LeaderboardData);
    case "shot_map":
      return shotMapCard(data as ShotMapData);
    case "head_to_head":
      return headToHeadCard(data as HeadToHeadData);
    default:
      throw new Error(`unknown card kind: ${kind}`);
  }
}


export async function renderCardPng(kind: CardKind, data: unknown): Promise<Uint8Array> {
  return svgToPng(buildCardSvg(kind, data));
}
