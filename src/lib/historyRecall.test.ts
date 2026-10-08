import { describe, expect, it } from "vitest";
import { type RecallInput, recallStepFor } from "./historyRecall";

/** What the composer looks like, with the caret in the middle unless told otherwise. */
const at = (overrides: Partial<RecallInput>): RecallInput => ({
  key: "ArrowUp",
  atStart: false,
  atEnd: false,
  writingCommand: false,
  ...overrides,
});

describe("recallStepFor", () => {
  it("steps back from the very start", () => {
    expect(recallStepFor(at({ key: "ArrowUp", atStart: true }))).toBe(-1);
  });

  it("leaves the key alone once the caret is inside the message", () => {
    expect(recallStepFor(at({ key: "ArrowUp" }))).toBeNull();
    expect(recallStepFor(at({ key: "ArrowDown" }))).toBeNull();
  });

  it("steps forward from the very end", () => {
    expect(recallStepFor(at({ key: "ArrowDown", atEnd: true }))).toBe(1);
  });

  it("steps forward from the very start as well, so a message can be walked past", () => {
    expect(recallStepFor(at({ key: "ArrowDown", atStart: true }))).toBe(1);
  });

  it("steps back only from the start, never from the end", () => {
    expect(recallStepFor(at({ key: "ArrowUp", atEnd: true }))).toBeNull();
  });

  /// The end of a command is where its menu is open, and the menu reads Down as
  /// a move through its own entries.
  it("steps forward from the start of a command but not from its end", () => {
    expect(recallStepFor(at({ key: "ArrowDown", atStart: true, writingCommand: true }))).toBe(1);
    expect(recallStepFor(at({ key: "ArrowDown", atEnd: true, writingCommand: true }))).toBeNull();
  });

  it("steps back from the start of a command as it does from any other start", () => {
    expect(recallStepFor(at({ key: "ArrowUp", atStart: true, writingCommand: true }))).toBe(-1);
  });

  it("leaves every other key alone", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Enter", "Tab", "a", "F6"]) {
      expect(recallStepFor(at({ key, atStart: true, atEnd: true }))).toBeNull();
    }
  });
});
