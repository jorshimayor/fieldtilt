/**
 * Full-squad layer — every player is content, not just the scorers.
 *
 * Two free sources merged by folded name:
 *   football-data /v4/teams/{id}  -> the official squad: position, DOB,
 *                                    nationality (28+ names, includes
 *                                    zero-minute players)
 *   FPL bootstrap-static (keyless) -> per-player price, minutes, goals,
 *                                    assists, form, ownership, points
 *
 * "Cost" honesty: the FPL price is a GAME price, never a transfer fee.
 * Copy must say "FPL price". Real fees come from web_lookup with a source.
 */

import { getCache, setCache } from "./cache";
import { club } from "@shared/club";

const FPL_BASE = "https://fantasy.premierleague.com/api";
const POS = ["", "GKP", "DEF", "MID", "FWD"];

export type SquadPlayer = {
  name: string;
  position: string;
  dateOfBirth: string | null;
  age: number | null;
  nationality: string | null;
  fpl: {
    webName: string;
    priceM: number;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheets: number;
    form: string;
    ownershipPct: string;
    totalPoints: number;
  } | null;
};

const fold = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();

/** Last name + initial matching: "Emiliano Martínez" <-> FPL "Martinez". */
function samePlayer(fullName: string, fplFirst: string, fplSecond: string, webName: string): boolean {
  const full = fold(fullName);
  const web = fold(webName);
  const second = fold(fplSecond);
  if (second && full.endsWith(second)) {
    const first = fold(fplFirst);
    return !first || full.startsWith(first[0]);
  }
  return web.length > 3 && full.includes(web);
}

export async function getFullSquad(): Promise<{ players: SquadPlayer[]; sources: string }> {
  const c = club();
  const key = `squad:full:${c.slug}`;
  const cached = await getCache<{ players: SquadPlayer[]; sources: string }>(key);
  if (cached) return cached;

  const fdKey = (globalThis as any).process?.env?.FOOTBALL_DATA_KEY || "";
  const [fdRes, fplBoot] = await Promise.all([
    fetch(`https://api.football-data.org/v4/teams/${c.ids.footballData}`, {
      headers: { "X-Auth-Token": fdKey, "User-Agent": "fieldtilt/1.0" },
    }),
    fetch(`${FPL_BASE}/bootstrap-static/`, { headers: { "User-Agent": "fieldtilt/1.0" } }),
  ]);
  if (!fdRes.ok) throw new Error(`squad_fd_failed_${fdRes.status}`);
  const fd = (await fdRes.json()) as any;
  let fplPlayers: any[] = [];
  if (fplBoot.ok) {
    const boot = (await fplBoot.json()) as any;
    const teamRow = (boot.teams || []).find((t: any) => fold(t.name).includes(fold(c.name)) || fold(c.name).includes(fold(t.name)));
    fplPlayers = teamRow ? (boot.elements || []).filter((p: any) => p.team === teamRow.id) : [];
  }

  const now = Date.now();
  const players: SquadPlayer[] = (fd.squad || []).map((s: any) => {
    const hit = fplPlayers.find((p) => samePlayer(s.name, p.first_name, p.second_name, p.web_name));
    return {
      name: s.name,
      position: s.position || "?",
      dateOfBirth: s.dateOfBirth || null,
      age: s.dateOfBirth ? Math.floor((now - Date.parse(s.dateOfBirth)) / (365.25 * 864e5)) : null,
      nationality: s.nationality || null,
      fpl: hit
        ? {
            webName: hit.web_name,
            priceM: hit.now_cost / 10,
            minutes: hit.minutes,
            goals: hit.goals_scored,
            assists: hit.assists,
            cleanSheets: hit.clean_sheets,
            form: hit.form,
            ownershipPct: hit.selected_by_percent,
            totalPoints: hit.total_points,
          }
        : null,
    };
  });
  // FPL-only rows (loanees back, new signings fd hasn't caught) get appended
  for (const p of fplPlayers) {
    if (!players.some((sp) => sp.fpl?.webName === p.web_name)) {
      players.push({
        name: `${p.first_name} ${p.second_name}`.trim(),
        position: POS[p.element_type] || "?",
        dateOfBirth: null,
        age: null,
        nationality: null,
        fpl: {
          webName: p.web_name,
          priceM: p.now_cost / 10,
          minutes: p.minutes,
          goals: p.goals_scored,
          assists: p.assists,
          cleanSheets: p.clean_sheets,
          form: p.form,
          ownershipPct: p.selected_by_percent,
          totalPoints: p.total_points,
        },
      });
    }
  }
  const data = { players, sources: "squad: football-data · prices/stats: Fantasy Premier League" };
  await setCache(key, data, 6 * 60 * 60 * 1000);
  return data;
}

/**
 * Coverage counting — pure, tested. A player is "mentioned" when their
 * distinctive last name (or full name) appears in posted content.
 */
export function countMentions(
  players: { name: string }[],
  posts: string[]
): { name: string; mentions: number }[] {
  const folded = posts.map((p) => fold(p));
  return players.map((pl) => {
    const full = fold(pl.name);
    const last = full.split(" ").slice(-1)[0];
    const needle = last.length >= 4 ? last : full; // "Joao" vs short surnames
    return { name: pl.name, mentions: folded.filter((c) => c.includes(needle)).length };
  });
}
