/**
 * SVG → PNG rasterization via resvg-wasm.
 *
 * The wasm binary ships next to the worker bundle (dist/resvg.wasm — copied by
 * build:worker) and is compiled by Cloudflare at deploy time via the
 * `CompiledWasm` rule in wrangler.toml. Fonts come embedded from fonts.ts.
 *
 * NOTE: rasterizing a 1200x675 card takes well over the 10ms CPU budget of the
 * Workers *free* plan — the $5/mo Workers Paid plan (30s CPU) is required for
 * image posts in production.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// Resolved at runtime relative to dist/worker.mjs; kept external in esbuild.
import resvgWasm from "./resvg.wasm";
import { fontBuffers, FONT_FAMILY } from "./fonts";
import { color } from "./theme";

let ready: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!ready) {
    ready = initWasm(resvgWasm as unknown as WebAssembly.Module).catch((e) => {
      // A warm isolate may have initialized already; that's fine.
      if (!/already/i.test(String(e?.message || e))) {
        ready = null;
        throw e;
      }
    }) as Promise<void>;
  }
  return ready;
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    background: color.bg,
    font: {
      fontBuffers,
      defaultFontFamily: FONT_FAMILY,
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  rendered.free();
  resvg.free();
  return png;
}
