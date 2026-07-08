/**
 * Fonts embedded into the worker bundle as binary (see build:worker
 * `--loader:.ttf=binary`). Montserrat, SIL Open Font License.
 */
import montserratRegular from "./fonts/Montserrat-Regular.ttf";
import montserratBold from "./fonts/Montserrat-Bold.ttf";
import montserratExtraBold from "./fonts/Montserrat-ExtraBold.ttf";

export const fontBuffers: Uint8Array[] = [
  montserratRegular,
  montserratBold,
  montserratExtraBold,
];

export const FONT_FAMILY = "Montserrat";
