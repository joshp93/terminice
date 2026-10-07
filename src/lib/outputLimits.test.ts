import { describe, expect, it } from "vitest";
import { capForDisplay, capForModel, MAX_DISPLAY_OUTPUT, MAX_MODEL_OUTPUT } from "./outputLimits";

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
