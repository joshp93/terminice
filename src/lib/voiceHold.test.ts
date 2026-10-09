import { describe, expect, it } from "vitest";
import { HOLD_TO_TALK_MS, holdCleanupRange } from "./voiceHold";

describe("holdCleanupRange", () => {
  it("takes back the run of spaces the hold typed", () => {
    expect(holdCleanupRange("hello   ", 5, 8)).toEqual({ from: 5, to: 8 });
  });

  it("takes back a single space", () => {
    expect(holdCleanupRange("hello ", 5, 6)).toEqual({ from: 5, to: 6 });
  });

  /// A space typed deliberately before the hold is not redundant, and eating
  /// it would run the dictated words into the word before them.
  it("leaves the space before the hold where it was", () => {
    expect(holdCleanupRange("hello  ", 6, 7)).toEqual({ from: 6, to: 7 });
    expect(holdCleanupRange("hello ", 6, 6)).toBeNull();
  });

  it("takes back spaces in the middle of a line", () => {
    expect(holdCleanupRange("one two", 3, 4)).toEqual({ from: 3, to: 4 });
  });

  it("does nothing when the hold typed nothing at all", () => {
    expect(holdCleanupRange("hello", 5, 5)).toBeNull();
  });

  it("does nothing when something other than a space arrived", () => {
    expect(holdCleanupRange("hello x", 5, 7)).toBeNull();
    expect(holdCleanupRange("hellox", 5, 6)).toBeNull();
  });

  it("does nothing when the caret is not where the hold left it", () => {
    expect(holdCleanupRange("hello   ", 8, 5)).toBeNull();
    expect(holdCleanupRange("hello", -1, 2)).toBeNull();
    expect(holdCleanupRange("hello", 2, 99)).toBeNull();
  });

  it("does not count a tab as a space", () => {
    expect(holdCleanupRange("hello\t", 5, 6)).toBeNull();
  });
});

describe("HOLD_TO_TALK_MS", () => {
  it("gives the reader half a second before the microphone opens", () => {
    expect(HOLD_TO_TALK_MS).toBe(500);
  });
});
