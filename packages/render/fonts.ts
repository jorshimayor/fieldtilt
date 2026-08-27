/**
 * Fonts embedded into the worker bundle as binary (see build:worker
 * `--loader:.ttf=binary`). Montserrat + JetBrains Mono, both SIL OFL,
 * subset to Latin/Latin-Extended + punctuation to keep the bundle small.
 */
import montserratRegular from "./fonts/Montserrat-Regular.ttf";
import montserratBold from "./fonts/Montserrat-Bold.ttf";
import montserratExtraBold from "./fonts/Montserrat-ExtraBold.ttf";
import jbmRegular from "./fonts/JetBrainsMono-Regular.ttf";
import jbmBold from "./fonts/JetBrainsMono-Bold.ttf";
import jbmExtraBold from "./fonts/JetBrainsMono-ExtraBold.ttf";

export type FontFace = { family: string; weight: number; buf: Uint8Array };

export const fontFaces: FontFace[] = [
  { family: "Montserrat", weight: 400, buf: montserratRegular },
  { family: "Montserrat", weight: 700, buf: montserratBold },
  { family: "Montserrat", weight: 800, buf: montserratExtraBold },
  { family: "JetBrains Mono", weight: 400, buf: jbmRegular },
  { family: "JetBrains Mono", weight: 700, buf: jbmBold },
  { family: "JetBrains Mono", weight: 800, buf: jbmExtraBold },
];

/** Flat buffer list for resvg (it reads family names from the font tables). */
export const fontBuffers: Uint8Array[] = fontFaces.map((f) => f.buf);

export const FONT_FAMILY = "Montserrat";
