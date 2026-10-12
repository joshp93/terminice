import { describe, expect, it } from "vitest";
import { fitsSideBySide, planSplitRows, SPLIT_LINE_LIMIT, splitLineWidth } from "./splitDiff";

const PATCH = ["@@ -1,3 +1,3 @@", " kept", "-gone", "+arrived", " tail"];

describe("splitLineWidth", () => {
  it("measures the longest line", () => {
    expect(splitLineWidth(["ab", "abcd", "a"])).toBe(4);
  });

  it("gives up on a patch with a line too long to compare", () => {
    expect(splitLineWidth(["x".repeat(SPLIT_LINE_LIMIT + 1)])).toBeNull();
  });

  it("still splits a patch whose longest line is exactly at the limit", () => {
    expect(splitLineWidth(["x".repeat(SPLIT_LINE_LIMIT)])).toBe(SPLIT_LINE_LIMIT);
  });

  it("measures an empty patch as nothing", () => {
    expect(splitLineWidth([])).toBe(0);
  });
});

describe("fitsSideBySide", () => {
  const fits = (available: number, longest = 40, characterWidth = 8) =>
    fitsSideBySide({ available, longest, characterWidth });

  it("fits when both columns and their padding are inside the card", () => {
    expect(fits(40 * 8 * 2 + 33)).toBe(true);
  });

  it("does not fit when a column would be cut short", () => {
    expect(fits(40 * 8 * 2)).toBe(false);
  });

  /// Without a canvas there is no way to know how wide a character is, and
  /// guessing would be worse than one column.
  it("does not fit when a character cannot be measured", () => {
    expect(fits(2000, 40, 0)).toBe(false);
  });

  it("does not fit in a card that has not been laid out yet", () => {
    expect(fits(0)).toBe(false);
  });

  /// The same card in the same font: the answer is about the patch, not the
  /// window, which is the whole reason this is measured rather than assumed.
  it("answers differently for two patches in one card", () => {
    expect(fits(700, 20)).toBe(true);
    expect(fits(700, 80)).toBe(false);
  });
});

describe("planSplitRows", () => {
  it("pairs a removal with the addition that took its place", () => {
    expect(planSplitRows(["-gone", "+arrived"])).toEqual([
      { kind: "pair", left: "-gone", right: "+arrived" },
    ]);
  });

  it("draws a hunk header across both columns", () => {
    expect(planSplitRows(["@@ -1 +1 @@"])).toEqual([{ kind: "across", text: "@@ -1 +1 @@" }]);
  });

  it("names the file across both columns as well", () => {
    expect(planSplitRows(["--- a/x", "+++ b/x"])).toEqual([
      { kind: "across", text: "--- a/x" },
      { kind: "across", text: "+++ b/x" },
    ]);
  });

  it("shows a context line on both sides, so the columns stay in step", () => {
    expect(planSplitRows([" kept"])).toEqual([{ kind: "pair", left: " kept", right: " kept" }]);
  });

  it("leaves the spare rows blank when one side is longer", () => {
    expect(planSplitRows(["-a", "-b", "-c", "+x"])).toEqual([
      { kind: "pair", left: "-a", right: "+x" },
      { kind: "pair", left: "-b", right: null },
      { kind: "pair", left: "-c", right: null },
    ]);
  });

  it("leaves the left side blank when a line was only added", () => {
    expect(planSplitRows(["+new"])).toEqual([{ kind: "pair", left: null, right: "+new" }]);
  });

  /// A removal separated from an addition by an unchanged line is its own
  /// change: the two are not two ways of writing the same line.
  it("does not pair across a line both sides carry", () => {
    expect(planSplitRows(["-a", " between", "+b"])).toEqual([
      { kind: "pair", left: "-a", right: null },
      { kind: "pair", left: " between", right: " between" },
      { kind: "pair", left: null, right: "+b" },
    ]);
  });

  it("lays a whole hunk out in order", () => {
    expect(planSplitRows(PATCH)).toEqual([
      { kind: "across", text: "@@ -1,3 +1,3 @@" },
      { kind: "pair", left: " kept", right: " kept" },
      { kind: "pair", left: "-gone", right: "+arrived" },
      { kind: "pair", left: " tail", right: " tail" },
    ]);
  });

  it("has nothing to lay out for an empty patch", () => {
    expect(planSplitRows([])).toEqual([]);
  });
});
