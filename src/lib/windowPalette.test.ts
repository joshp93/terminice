import { describe, expect, it } from "vitest";
import { paletteColour, WINDOW_INK, WINDOW_PALETTE } from "./windowPalette";

/** How dark a colour is, for comparing two of them. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** The contrast ratio between two colours, as the accessibility rules measure it. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("the window palette", () => {
  it("has no colour twice", () => {
    expect(new Set(WINDOW_PALETTE).size).toBe(WINDOW_PALETTE.length);
  });

  /// The bar is a strip of colour across the top of the window, so the words on
  /// it have to be readable on every colour an instance can be given.
  it("is readable on every colour in it", () => {
    for (const colour of WINDOW_PALETTE) {
      expect(contrast(colour, WINDOW_INK)).toBeGreaterThanOrEqual(7);
    }
  });

  it("draws a claimed colour", () => {
    expect(paletteColour(0)).toBe(WINDOW_PALETTE[0]);
    expect(paletteColour(3)).toBe(WINDOW_PALETTE[3]);
  });

  /// An instance that cannot claim one is still drawn in the application's
  /// colours rather than left unstyled, and so is one handed a colour from a
  /// longer palette than this one.
  it("falls back into the palette for anything outside it", () => {
    expect(paletteColour(null)).toBe(WINDOW_PALETTE[0]);
    expect(paletteColour(0.5)).toBe(WINDOW_PALETTE[0]);
    expect(paletteColour(WINDOW_PALETTE.length)).toBe(WINDOW_PALETTE[0]);
    expect(paletteColour(WINDOW_PALETTE.length + 2)).toBe(WINDOW_PALETTE[2]);
  });
});
