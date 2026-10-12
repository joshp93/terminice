import { describe, expect, it } from "vitest";
import { dictationPrefix } from "./voiceInsertion";

describe("dictationPrefix", () => {
  it("stands a transcript off a sentence that has just ended", () => {
    expect(dictationPrefix(".", "Well, I think so")).toBe(" ");
  });

  it("does the same after every mark a word is written hard against", () => {
    for (const mark of [",", ";", ":", "!", "?"]) {
      expect(dictationPrefix(mark, "and then")).toBe(" ");
    }
  });

  /// A space typed after the stop is the reader's own, and it is the space that
  /// then sits before the caret rather than the punctuation — so the gap is left
  /// as it is instead of being doubled.
  it("adds nothing when a gap is already there", () => {
    expect(dictationPrefix(" ", "Well")).toBe("");
  });

  it("adds nothing at the very start of the document", () => {
    expect(dictationPrefix("", "Hello")).toBe("");
  });

  it("adds nothing after an ordinary word", () => {
    expect(dictationPrefix("e", "and")).toBe("");
  });

  it("adds nothing after a mark that opens rather than closes", () => {
    expect(dictationPrefix("(", "and")).toBe("");
  });

  it("adds nothing when the words bring their own leading space", () => {
    expect(dictationPrefix(".", " Well")).toBe("");
  });
});
