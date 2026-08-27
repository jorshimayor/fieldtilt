export const config = { runtime: "edge" };

/**
 * Stat-source reachability probe (CRON_SECRET protected). Reports whether a
 * whitelisted external data host answers Worker-side fetches — used to pick
 * the backend for the positional-metrics tool. GET /api/probe?target=<key>
 */
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

const TARGETS: Record<string, string> = {
  fbref: "https://fbref.com/en/search/search.fcgi?search=Moises+Caicedo",
  sofascore: "https://api.sofascore.com/api/v1/search/all?q=caicedo",
  sofascore_www: "https://www.sofascore.com/api/v1/search/all?q=caicedo",
  fotmob: "https://www.fotmob.com/api/searchData?term=caicedo&lang=en",
  understat: "https://understat.com/team/Chelsea/2025",
};

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  // ---- API-Football key validator: answers "does my plan see the current
  // season (and therefore live cups)?" the empirical way. ----
  if (new URL(req.url).searchParams.get("target") === "api-football") {
    const key = (globalThis as any).process?.env?.API_FOOTBALL_KEY || "";
    if (!key) {
      return new Response(
        JSON.stringify({ configured: false, note: "no API_FOOTBALL_KEY set. Sign up free at api-football.com, then: wrangler secret put API_FOOTBALL_KEY. The cup overlay activates automatically." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    try {
      const teamId = (await import("../packages/shared/club")).club().ids.apiFootball;
      // Free plans reject next/last params; a season query answers both
      // questions (param access AND season-window access) in one call.
      const season = new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
      const res = await fetch(`https://v3.football.api-sports.io/fixtures?team=${teamId}&season=${season}`, {
        headers: { "x-apisports-key": key },
      });
      const j = (await res.json()) as any;
      const fixtures = (j?.response || []).slice(0, 400).map((r: any) => ({
        date: r?.fixture?.date,
        competition: r?.league?.name,
        home: r?.teams?.home?.name,
        away: r?.teams?.away?.name,
      }));
      const cupCount = fixtures.filter((f: any) => f.competition && !/premier league/i.test(f.competition)).length;
      const upcomingOnly = fixtures.filter((f: any) => f.date > new Date().toISOString()).slice(0, 6);
      return new Response(
        JSON.stringify(
          {
            configured: true,
            status: res.status,
            planErrors: j?.errors && Object.keys(j.errors).length ? j.errors : null,
            currentSeasonVisible: fixtures.length > 0,
            upcoming: upcomingOnly,
            totalFixturesThisSeason: fixtures.length,
            cupFixturesVisible: cupCount,
            verdict:
              fixtures.length > 0
                ? `plan sees the current season (${cupCount} cup fixture(s) in the next 5) - the overlay is LIVE`
                : "key works but returned no upcoming fixtures - the plan likely excludes the current season; cup coverage needs their paid tier",
          },
          null,
          1
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e) {
      return new Response(JSON.stringify({ configured: true, error: String((e as Error).message || e).slice(0, 160) }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  const u = new URL(req.url);
  const key = u.searchParams.get("target") || "";
  const raw = u.searchParams.get("url") || "";
  let targets: Record<string, string> = key && TARGETS[key] ? { [key]: TARGETS[key] } : TARGETS;
  if (raw) {
    // Arbitrary probe, but ONLY on known data hosts — never an open proxy.
    const allowed = ["fbref.com", "www.sofascore.com", "api.sofascore.com", "www.fotmob.com", "understat.com"];
    try {
      const target = new URL(raw);
      if (!allowed.includes(target.hostname)) return new Response("host not whitelisted", { status: 400 });
      targets = { probe: target.toString() };
    } catch {
      return new Response("bad url", { status: 400 });
    }
  }
  const out: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(targets)) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      const body = (await res.text()).slice(0, 160);
      out[name] = { status: res.status, snippet: body.replace(/\s+/g, " ") };
    } catch (e) {
      out[name] = { error: String((e as Error).message || e).slice(0, 120) };
    }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "Content-Type": "application/json" } });
});
