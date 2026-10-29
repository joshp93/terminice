import { describe, expect, it } from "vitest";
import { changedRanges } from "./inlineDiff";

describe("changedRanges", () => {
  it("finds nothing in two identical lines", () => {
    expect(changedRanges("const a = 1;", "const a = 1;")).toEqual({ before: [], after: [] });
  });

  /// The case the marking exists for: one character in the middle of a line is
  /// one character marked, not the whole line.
  it("finds a single changed character", () => {
    expect(changedRanges("const a = 1;", "const a = 2;")).toEqual({
      before: [{ start: 10, end: 11 }],
      after: [{ start: 10, end: 11 }],
    });
  });

  it("finds several separate edits on one line", () => {
    const marks = changedRanges("let a = 1, b = 2;", "let c = 1, d = 2;");

    expect(marks.before).toEqual([
      { start: 4, end: 5 },
      { start: 11, end: 12 },
    ]);
    expect(marks.after).toEqual([
      { start: 4, end: 5 },
      { start: 11, end: 12 },
    ]);
  });

  it("marks an insertion on the new side alone", () => {
    expect(changedRanges("abc", "abXc")).toEqual({
      before: [],
      after: [{ start: 2, end: 3 }],
    });
  });

  it("marks a deletion on the old side alone", () => {
    expect(changedRanges("abXc", "abc")).toEqual({
      before: [{ start: 2, end: 3 }],
      after: [],
    });
  });

  it("marks the whole of a line that shares nothing", () => {
    expect(changedRanges("abc", "xyz")).toEqual({
      before: [{ start: 0, end: 3 }],
      after: [{ start: 0, end: 3 }],
    });
  });

  /// Shared text on both sides of an edit stays unmarked, which is what makes
  /// the marked part readable in context. The shared `ed-after` is the tail the
  /// two lines have in common; the rewrite in front of it is one mark, not two,
  /// because the one character that happens to match inside it is noise.
  it("leaves the shared text around an edit alone", () => {
    const marks = changedRanges("before-changed-after", "before-altered-after");
    expect(marks.before).toEqual([{ start: 7, end: 12 }]);
    expect(marks.after).toEqual([{ start: 8, end: 12 }]);
  });

  it("handles a line that became empty", () => {
    expect(changedRanges("gone", "")).toEqual({
      before: [{ start: 0, end: 4 }],
      after: [],
    });
  });
});
