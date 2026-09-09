/**
 * RSS layer — both directions.
 *
 * INBOUND: BBC Sport publishes stable per-club RSS feeds (no key, no
 * scraping walls — the sturdiest free news source we've found after the
 * FBref/Sofascore blocks). `getClubNews` gives the agent grounded,
 * citable headlines for team news, injuries and pressers.
 *
 * OUTBOUND: `buildPostsFeed` renders the account's posted content as RSS
 * so anyone (or any agent) can subscribe to fieldtilt's output.
 */

import { getCache, setCache } from "./cache";
import { club } from "@shared/club";

export type NewsItem = { title: string; link: string; publishedAt: string; summary: string };

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();

/** Pure parser — unit-tested against a real feed snapshot. */
export function parseRss(xml: string, limit = 10): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag: string) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return mm ? strip(mm[1]) : "";
    };
    items.push({
      title: pick("title"),
      link: pick("link") || pick("guid"),
      publishedAt: pick("pubDate"),
      summary: pick("description").slice(0, 300),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** Latest BBC headlines for the tracked club (15-min cache). */
export async function getClubNews(limit = 8): Promise<{ items: NewsItem[]; source: string }> {
  const url = `https://feeds.bbci.co.uk/sport/football/teams/${club().slug}/rss.xml`;
  const key = `rss:bbc:${club().slug}`;
  const cached = await getCache<{ items: NewsItem[]; source: string }>(key);
  if (cached) return { ...cached, items: cached.items.slice(0, limit) };
  const res = await fetch(url, { headers: { "User-Agent": "fieldtilt/1.0" } });
  if (!res.ok) throw new Error(`bbc_rss_failed_${res.status}`);
  const items = parseRss(await res.text(), 12);
  const data = { items, source: "BBC Sport" };
  await setCache(key, data, 15 * 60 * 1000);
  return { ...data, items: items.slice(0, limit) };
}

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The account's posted content as an RSS feed (public distribution). */
export function buildPostsFeed(
  posts: { content: string; tweetId: string | null; postedAt: Date | string | null }[]
): string {
  const c = club();
  const items = posts
    .map((p) => {
      const link = p.tweetId ? `https://x.com/i/status/${p.tweetId}` : "https://fieldtilt.joelobafemii.workers.dev";
      const date = p.postedAt ? new Date(p.postedAt).toUTCString() : new Date().toUTCString();
      const title = escXml(p.content.split("\n")[0].slice(0, 120));
      return `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description>${escXml(p.content.slice(0, 500))}</description></item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>fieldtilt — ${escXml(c.fullName)} data feed</title>
<link>https://fieldtilt.joelobafemii.workers.dev/terminal</link>
<description>Grounded football stats and infographics, published by the fieldtilt system.</description>
${items}
</channel></rss>`;
}
