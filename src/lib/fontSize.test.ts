import { describe, expect, it } from "vitest";
import {
  atFontSizeLimit,
  FONT_SIZE_STEP,
  fontSizeLabel,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  stepFontSize,
} from "./fontSize";

describe("stepFontSize", () => {
  it("moves by one step at a time", () => {
    expect(stepFontSize(14, 1)).toBe(14 + FONT_SIZE_STEP);
    expect(stepFontSize(14, -1)).toBe(14 - FONT_SIZE_STEP);
  });

  it("moves as many steps as it is asked for", () => {
    expect(stepFontSize(14, 4)).toBe(14 + 4 * FONT_SIZE_STEP);
  });

  it("keeps half pixels exact rather than accumulating error", () => {
    let size = 14;
    for (let press = 0; press < 10; press += 1) size = stepFontSize(size, 1);
    expect(size).toBe(19);
    expect(Number.isInteger(size * 2)).toBe(true);
  });

  it("stops at the largest size", () => {
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE);
    expect(stepFontSize(MAX_FONT_SIZE - FONT_SIZE_STEP, 5)).toBe(MAX_FONT_SIZE);
  });

  it("stops at the smallest size", () => {
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE);
    expect(stepFontSize(MIN_FONT_SIZE + FONT_SIZE_STEP, -5)).toBe(MIN_FONT_SIZE);
  });

  it("pulls a size that is off the scale onto it", () => {
    expect(stepFontSize(13.7, 0)).toBe(13.5);
  });
});

describe("atFontSizeLimit", () => {
  it("reports an end of the range", () => {
    expect(atFontSizeLimit(MAX_FONT_SIZE, 1)).toBe(true);
    expect(atFontSizeLimit(MIN_FONT_SIZE, -1)).toBe(true);
  });

  it("does not report a size with room left", () => {
    expect(atFontSizeLimit(14, 1)).toBe(false);
    expect(atFontSizeLimit(14, -1)).toBe(false);
  });
});

describe("fontSizeLabel", () => {
  it("leaves off a trailing zero", () => {
    expect(fontSizeLabel(14)).toBe("14px");
  });

  it("keeps a half pixel", () => {
    expect(fontSizeLabel(13.5)).toBe("13.5px");
  });
});
