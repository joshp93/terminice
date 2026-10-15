/**
 * The pastel colours a window can wear, so that instances can be told apart.
 *
 * Sixteen of them, spread around the colour circle, and ordered so that two
 * colours next to each other in the list are as far apart as they can be: the
 * first free one wins, so the colours two instances are given are usually
 * neighbours in this array, and neighbours here should never look alike.
 *
 * All of them are drawn at the light end, and the ink below is dark enough to
 * be read on every one of them — measured at 8:1 or better, which is the same
 * standard the rest of the interface is held to.
 */
export const WINDOW_PALETTE: readonly string[] = [
  "#f1b1a7",
  "#a7e7f1",
  "#c2f1a7",
  "#d6a7f1",
  "#f1e8a7",
  "#a7b0f1",
  "#a7f1c3",
  "#f1a7d5",
  "#f1cda7",
  "#a7cbf1",
  "#a7f1a8",
  "#f1a7f0",
  "#def1a7",
  "#baa7f1",
  "#a7f1df",
  "#f1a7b9",
];

/** The colour everything on the window bar is written in. */
export const WINDOW_INK = "#1b1b22";

/**
 * The colour the bar's edges are drawn in.
 *
 * A quarter of the ink, so a chip on the bar reads as one without a second
 * colour being introduced for edges that the pastel already carries.
 */
export const WINDOW_LINE = "rgb(27 27 34 / 26%)";

/**
 * The colour at one place in the palette.
 *
 * An index outside it — which is what an instance gets when every colour is
 * already taken — is folded back into the palette rather than leaving the
 * window bar unstyled.
 *
 * @param index - The claimed colour, or null when none was claimed.
 * @returns The colour to draw the window bar in.
 */
export function paletteColour(index: number | null): string {
  if (index === null || !Number.isInteger(index)) return WINDOW_PALETTE[0];
  return WINDOW_PALETTE[
    ((index % WINDOW_PALETTE.length) + WINDOW_PALETTE.length) % WINDOW_PALETTE.length
  ];
}
