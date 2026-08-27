/**
 * Card image resolver — turns URL/name fields in card data into embedded
 * data URIs before the SVG is built.
 *
 * Why: cards are rasterized either by resvg-wasm or by the dashboard's
 * <canvas> (free-plan path). Both refuse external hrefs, so every image must
 * arrive inline. Resolution is IO (fetch), not CPU, so it is free-plan safe.
 *
 * Recognized keys (top level only):
 *   - `fooUrl`  (http/https)        → fetched → `fooDataUri`
 *   - `photo*Wiki` (a player name)  → Wikipedia page image → `photo*DataUri`
 *   - `crest*Club` (a club name)    → football-data crest  → `crest*DataUri`
 *
 * Failures are silent per-field: the card falls back to its no-photo
 * treatment (initials monogram) rather than failing the render.
 */

import { clubAssets } from "./clubs";

const MAX_IMAGE_BYTES = 2_500_000;
const UA = { "User-Agent": "fieldtilt/1.0 (card renderer)" };

function toDataUri(contentType: string, buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let o = 0; o < bytes.length; o += chunk) {
    bin += String.fromCharCode(...bytes.subarray(o, o + chunk));
  }
  return `data:${contentType};base64,${btoa(bin)}`;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return toDataUri(ct.split(";")[0], buf);
  } catch {
    return null;
  }
}

/** Wikipedia page image for a player: search the name, take the top page's image. */
async function wikiPhotoUrl(name: string): Promise<string | null> {
  try {
    const sr = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + " footballer")}&format=json&srlimit=1`,
      { headers: UA }
    );
    if (!sr.ok) return null;
    const title = ((await sr.json()) as any)?.query?.search?.[0]?.title;
    if (!title) return null;
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, "_"))}`,
      { headers: UA }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    return j?.originalimage?.source || j?.thumbnail?.source || null;
  } catch {
    return null;
  }
}

/**
 * Resolve every image-bearing field in card data. Returns a new object with
 * `*DataUri` fields filled in and the source fields removed.
 */
export async function resolveCardImages(
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...data };
  const jobs: Promise<void>[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (/Url$/.test(key) && /^https?:\/\//.test(value)) {
      jobs.push(
        fetchAsDataUri(value).then((uri) => {
          if (uri) out[key.replace(/Url$/, "DataUri")] = uri;
          delete out[key];
        })
      );
    } else if (/^photo[A-Z]?Wiki$/.test(key)) {
      jobs.push(
        wikiPhotoUrl(value)
          .then((url) => (url ? fetchAsDataUri(url) : null))
          .then((uri) => {
            if (uri) out[key.replace(/Wiki$/, "DataUri")] = uri;
            delete out[key];
          })
      );
    } else if (/^crest[A-Z]?Club$/.test(key)) {
      const assets = clubAssets(value);
      jobs.push(
        (assets ? fetchAsDataUri(assets.crestUrl) : Promise.resolve(null)).then((uri) => {
          if (uri) out[key.replace(/Club$/, "DataUri")] = uri;
          delete out[key];
        })
      );
    }
  }
  await Promise.all(jobs);
  return out;
}
