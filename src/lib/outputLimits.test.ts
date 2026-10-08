import { describe, expect, it } from "vitest";
import {
  capForCard,
  capForDisplay,
  capForModel,
  clipLine,
  MAX_CARD_OUTPUT,
  MAX_DISPLAY_OUTPUT,
  MAX_MODEL_OUTPUT,
  MAX_PREVIEW_LINE,
} from "./outputLimits";

describe("capForModel", () => {
  it("leaves text that fits completely alone", () => {
    expect(capForModel("hello")).toBe("hello");
  });

  it("leaves text exactly at the limit alone", () => {
    const text = "x".repeat(MAX_MODEL_OUTPUT);
    expect(capForModel(text)).toBe(text);
  });

  it("keeps the first 30000 characters and says how much was dropped", () => {
    const capped = capForModel("x".repeat(MAX_MODEL_OUTPUT + 5_000));

    expect(capped.startsWith("x".repeat(MAX_MODEL_OUTPUT))).toBe(true);
    expect(capped).toContain(`… output truncated at ${MAX_MODEL_OUTPUT} bytes`);
  });

  it("does not keep any of the tail", () => {
    expect(capForModel(`${"a".repeat(MAX_MODEL_OUTPUT)}TAIL`)).not.toContain("TAIL");
  });

  it("steps back a character rather than splitting a surrogate pair", () => {
    const text = `${"a".repeat(MAX_MODEL_OUTPUT - 1)}😀tail`;
    const capped = capForModel(text);

    expect(capped).toBe(
      `${"a".repeat(MAX_MODEL_OUTPUT - 1)}\n… output truncated at ${MAX_MODEL_OUTPUT} bytes`,
    );
    expect(capped).not.toMatch(/[\uD800-\uDBFF]/);
  });

  it("keeps a surrogate pair that fits inside the cap", () => {
    const text = `${"a".repeat(10)}😀tail`;
    expect(capForModel(text)).toBe(text);
  });

  it("counts multi-byte characters the same way", () => {
    const text = "é".repeat(MAX_MODEL_OUTPUT + 1);
    expect(capForModel(text).startsWith("é".repeat(MAX_MODEL_OUTPUT))).toBe(true);
  });
});

describe("capForDisplay", () => {
  it("leaves text that fits completely alone", () => {
    expect(capForDisplay("hello")).toBe("hello");
  });

  it("keeps far more than the model is given", () => {
    const text = "x".repeat(MAX_MODEL_OUTPUT * 5);
    expect(capForDisplay(text)).toBe(text);
    expect(text.length).toBeLessThan(MAX_DISPLAY_OUTPUT);
  });

  it("caps an output large enough to threaten the pane", () => {
    const capped = capForDisplay("x".repeat(MAX_DISPLAY_OUTPUT + 1));

    expect(capped.startsWith("x".repeat(MAX_DISPLAY_OUTPUT))).toBe(true);
    expect(capped).toContain("truncated for display");
  });

  it("says display rather than bytes, so the two caps are told apart", () => {
    const capped = capForDisplay("x".repeat(MAX_DISPLAY_OUTPUT + 1));
    expect(capped).not.toContain("output truncated at");
  });

  it("steps back a character rather than splitting a surrogate pair", () => {
    const text = `${"a".repeat(MAX_DISPLAY_OUTPUT - 1)}😀tail`;
    expect(capForDisplay(text)).not.toMatch(/[\uD800-\uDBFF]/);
  });
});

describe("capForCard", () => {
  it("leaves an output that fits completely alone", () => {
    expect(capForCard("hello")).toBe("hello");
  });

  it("caps an output far below what the transcript would keep", () => {
    const capped = capForCard("x".repeat(MAX_CARD_OUTPUT + 1));

    expect(capped.startsWith("x".repeat(MAX_CARD_OUTPUT))).toBe(true);
    expect(capped).toContain(`… output truncated at ${MAX_CARD_OUTPUT} characters`);
    expect(MAX_CARD_OUTPUT).toBeLessThan(MAX_DISPLAY_OUTPUT);
  });

  it("keeps more than the model is given, because a reader can scroll", () => {
    expect(MAX_CARD_OUTPUT).toBeGreaterThan(MAX_MODEL_OUTPUT / 2);
  });

  it("steps back a character rather than splitting a surrogate pair", () => {
    const text = `${"a".repeat(MAX_CARD_OUTPUT - 1)}😀tail`;
    expect(capForCard(text)).not.toMatch(/[\uD800-\uDBFF]/);
  });
});

describe("clipLine", () => {
  it("leaves a line that fits alone", () => {
    expect(clipLine("short line")).toBe("short line");
  });

  it("leaves a line exactly at the limit alone", () => {
    const line = "x".repeat(MAX_PREVIEW_LINE);
    expect(clipLine(line)).toBe(line);
  });

  it("cuts a long line and says so", () => {
    const clipped = clipLine("x".repeat(MAX_PREVIEW_LINE + 500));

    expect(clipped).toBe(`${"x".repeat(MAX_PREVIEW_LINE)}…`);
  });

  it("takes a limit, so a caller can ask for a shorter one", () => {
    expect(clipLine("abcdef", 3)).toBe("abc…");
  });

  it("steps back a character rather than splitting a surrogate pair", () => {
    expect(clipLine(`${"a".repeat(MAX_PREVIEW_LINE - 1)}😀tail`)).not.toMatch(/[\uD800-\uDBFF]/);
  });
});
