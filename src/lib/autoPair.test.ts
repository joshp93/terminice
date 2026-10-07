import { describe, expect, it } from "vitest";
import { pairNeedsTrim, planAutoPair } from "./autoPair";

const plan = (char: string, before = "", after = "", hasSelection = false) =>
  planAutoPair({ char, before, after, hasSelection });

describe("pairNeedsTrim", () => {
  it("is true for the emphasis characters", () => {
    expect(pairNeedsTrim("*")).toBe(true);
    expect(pairNeedsTrim("_")).toBe(true);
  });

  it("is false for brackets, quotes and backticks", () => {
    expect(pairNeedsTrim("(")).toBe(false);
    expect(pairNeedsTrim("[")).toBe(false);
    expect(pairNeedsTrim("{")).toBe(false);
    expect(pairNeedsTrim("`")).toBe(false);
    expect(pairNeedsTrim('"')).toBe(false);
  });
});

describe("planAutoPair with a selection", () => {
  it("surrounds the selection with the pair", () => {
    expect(plan("(", "", "", true)).toEqual({ kind: "surround", open: "(", close: ")" });
    expect(plan("[", "", "", true)).toEqual({ kind: "surround", open: "[", close: "]" });
    expect(plan("{", "", "", true)).toEqual({ kind: "surround", open: "{", close: "}" });
  });

  it("surrounds emphasis characters even where they would not pair", () => {
    expect(plan("*", "", "", true)).toEqual({ kind: "surround", open: "*", close: "*" });
    expect(plan("_", "", "", true)).toEqual({ kind: "surround", open: "_", close: "_" });
  });

  it("prefers wrapping over stepping over an existing partner", () => {
    expect(plan("(", "x", ")", true)).toEqual({ kind: "surround", open: "(", close: ")" });
  });
});

describe("planAutoPair insertion", () => {
  it("inserts both characters and leaves the caret between them", () => {
    expect(plan("(")).toEqual({ kind: "insert", text: "()", caretOffset: 1 });
    expect(plan("[")).toEqual({ kind: "insert", text: "[]", caretOffset: 1 });
    expect(plan("{")).toEqual({ kind: "insert", text: "{}", caretOffset: 1 });
    expect(plan("`")).toEqual({ kind: "insert", text: "``", caretOffset: 1 });
    expect(plan('"')).toEqual({ kind: "insert", text: '""', caretOffset: 1 });
  });

  it("steps over the partner when it is already the next character", () => {
    expect(plan("(", "x", ")")).toEqual({ kind: "skip", caretOffset: 1 });
    expect(plan("`", "x", "`")).toEqual({ kind: "skip", caretOffset: 1 });
  });

  it("pairs an asterisk typed after a word", () => {
    expect(plan("*", "a", " ")).toEqual({ kind: "insert", text: "**", caretOffset: 1 });
  });

  it("pairs an underscore typed after a word", () => {
    expect(plan("_", "a", " ")).toEqual({ kind: "insert", text: "__", caretOffset: 1 });
  });
});

describe("planAutoPair refusal", () => {
  it("leaves the character alone when a word follows it", () => {
    expect(plan("(", "", "a")).toBeNull();
    expect(plan("`", "", "z")).toBeNull();
  });

  it("does not open emphasis against whitespace, so a bullet still starts", () => {
    expect(plan("*", "", "")).toBeNull();
    expect(plan("*", "\n", "")).toBeNull();
    expect(plan("_", "", "")).toBeNull();
    expect(plan("_", " ", "")).toBeNull();
  });

  it("treats a digit before the caret as a word character", () => {
    expect(plan("*", "1", "")).toEqual({ kind: "insert", text: "**", caretOffset: 1 });
    expect(plan("_", "1", "")).toEqual({ kind: "insert", text: "__", caretOffset: 1 });
  });

  it("returns null for a character that starts no pair", () => {
    expect(plan("a")).toBeNull();
    expect(plan(" ")).toBeNull();
    expect(plan("\n")).toBeNull();
    expect(plan("!")).toBeNull();
  });
});

describe("planAutoPair closing characters", () => {
  it("steps over a closing character that is already there", () => {
    expect(plan(")", "", ")")).toEqual({ kind: "skip", caretOffset: 1 });
    expect(plan("]", "", "]")).toEqual({ kind: "skip", caretOffset: 1 });
    expect(plan("}", "", "}")).toEqual({ kind: "skip", caretOffset: 1 });
  });

  it("does nothing for a closing character with no twin", () => {
    expect(plan(")", "x", "y")).toBeNull();
    expect(plan("]", "", "")).toBeNull();
  });
});
