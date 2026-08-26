import dashboardHtml from "../public/index.html";
import themeCss from "../public/theme.css";

import apiIndex from "../api/index";
import apiDashboard from "../api/dashboard";
import apiGenerateTweet from "../api/generate-tweet";
import apiHealth from "../api/health";
import apiRender from "../api/render";
import apiDrafts from "../api/drafts";
import apiChat from "../api/chat";
import apiSuggest from "../api/suggest";
import apiAnalytics from "../api/analytics";
import cronPrewarm from "../api/cron/prewarm";
import cronFixtures from "../api/cron/fixtures";
import cronWeekly from "../api/cron/weekly";
import cronMatchDay from "../api/cron/match-day";
import cronTransfers from "../api/cron/transfers";
import cronSpotlight from "../api/cron/spotlight";
import cronAccountability from "../api/cron/accountability";
import xAuth from "../api/x/auth";
import xCallback from "../api/x/callback";
import xPublish from "../api/x/publish";
import testTools from "../api/test/tools";
import { requireOpsAuth } from "../packages/shared/auth";

type EnvBindings = Record<string, string | undefined>;

function setProcessEnv(env: EnvBindings): void {
  const g = globalThis as any;
  if (!g.process) g.process = {};
  // Service bindings aren't strings — handlers reach them via globalThis.
  if ((env as any).ASSISTANT) g.__ASSISTANT = (env as any).ASSISTANT;
  const normalized: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env || {})) {
    normalized[k] = v;
    if (k.startsWith("env.")) {
      normalized[k.slice(4)] = v;
    }
  }
  const nested = (env as any)?.env;
  if (nested && typeof nested === "object") {
    for (const [k, v] of Object.entries(nested)) {
      normalized[k] = v as any;
    }
  }
  g.process.env = { ...(g.process.env || {}), ...normalized };
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function serveDashboard(): Response {
  return new Response(dashboardHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function callHandler(
  handler: ((req: Request) => Promise<Response>) | (() => Promise<Response>),
  req: Request
): Promise<Response> {
  if ((handler as any).length === 0) return (handler as any)();
  return (handler as any)(req);
}

type Route = { handler: (req: Request) => Promise<Response>; protected?: boolean };

// Endpoints that spend money/quota (LLM calls, API-Football, posting to X)
// are gated behind CRON_SECRET — see packages/shared/auth.ts.
const routes: Record<string, Route> = {
  "/api/index": { handler: apiIndex as any, protected: true },
  "/api/health": { handler: apiHealth as any },
  "/api/dashboard": { handler: apiDashboard as any },
  "/api/generate-tweet": { handler: apiGenerateTweet as any, protected: true },
  "/api/render": { handler: apiRender as any }, // does its own auth check
  "/api/drafts": { handler: apiDrafts as any, protected: true },
  "/api/chat": { handler: apiChat as any, protected: true },
  "/api/suggest": { handler: apiSuggest as any, protected: true },
  "/api/analytics": { handler: apiAnalytics as any, protected: true },

  "/api/cron/prewarm": { handler: cronPrewarm as any, protected: true },
  "/api/cron/fixtures": { handler: cronFixtures as any, protected: true },
  "/api/cron/weekly": { handler: cronWeekly as any, protected: true },
  "/api/cron/match-day": { handler: cronMatchDay as any, protected: true },
  "/api/cron/transfers": { handler: cronTransfers as any, protected: true },
  "/api/cron/spotlight": { handler: cronSpotlight as any, protected: true },
  "/api/cron/accountability": { handler: cronAccountability as any, protected: true },

  "/api/x/auth": { handler: xAuth as any },
  "/api/x/callback": { handler: xCallback as any },
  "/api/x/publish": { handler: xPublish as any, protected: true },

  "/api/test/tools": { handler: testTools as any, protected: true },
};

/** Build the internal Request used when the Cloudflare scheduler fires. */
function cronRequest(path: string): Request {
  const secret = (globalThis as any).process?.env?.CRON_SECRET || "";
  return new Request(`https://local${path}`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

export default {
  async fetch(req: Request, env: EnvBindings): Promise<Response> {
    setProcessEnv(env);
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/" || p === "/index.html") return serveDashboard();
    if (p === "/theme.css") {
      return new Response(themeCss, {
        status: 200,
        headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    const route = routes[p];
    if (!route) return notFound();
    if (route.protected) {
      const denied = requireOpsAuth(req);
      if (denied) return denied;
    }
    return callHandler(route.handler, req);
  },

  async scheduled(event: any, env: EnvBindings): Promise<void> {
    setProcessEnv(env);
    const cron = (event as any).cron as string | undefined;

    if (cron === "*/5 * * * *") {
      await callHandler(cronPrewarm as any, cronRequest("/api/cron/prewarm"));
      await callHandler(cronMatchDay as any, cronRequest("/api/cron/match-day"));
      return;
    }

    if (cron === "0 7 * * *") {
      await callHandler(cronFixtures as any, cronRequest("/api/cron/fixtures"));
      return;
    }

    if (cron === "0 8 * * *") {
      await callHandler(cronTransfers as any, cronRequest("/api/cron/transfers"));
      return;
    }

    if (cron === "0 9 * * 1") {
      await callHandler(cronWeekly as any, cronRequest("/api/cron/weekly"));
      return;
    }

    if (cron === "0 12 * * 3") {
      await callHandler(cronSpotlight as any, cronRequest("/api/cron/spotlight"));
      return;
    }

    if (cron === "30 21 * * *") {
      await callHandler(cronAccountability as any, cronRequest("/api/cron/accountability"));
    }
  },
};
