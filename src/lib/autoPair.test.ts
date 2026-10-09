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

  it("pairs against whitespace, where a pair can be seen to be wanted", () => {
    expect(plan("(", " ", "")).toEqual({ kind: "insert", text: "()", caretOffset: 1 });
    expect(plan("`", " ", "")).toEqual({ kind: "insert", text: "``", caretOffset: 1 });
  });
});

describe("planAutoPair refusal", () => {
  it("leaves the character alone when a character follows it", () => {
    expect(plan("(", "", "a")).toBeNull();
    expect(plan("`", "", "z")).toBeNull();
    expect(plan("(", "", ",")).toBeNull();
  });

  it("leaves the character alone when a character precedes it", () => {
    expect(plan("(", "d", "")).toBeNull();
    expect(plan("[", "e", "")).toBeNull();
    expect(plan("{", "}", "")).toBeNull();
    expect(plan('"', "x", "")).toBeNull();
  });

  /// Closing a span by hand means typing the character that closes it, so the
  /// second backtick of `` `code` `` must not bring one of its own.
  it("does not double up a character typed at the end of a word", () => {
    expect(plan("`", "d", "")).toBeNull();
  });

  it("leaves a character alone between two characters", () => {
    expect(plan("(", "a", "b")).toBeNull();
  });

  it("never pairs the emphasis characters, so a bullet still starts", () => {
    expect(plan("*", "", "")).toBeNull();
    expect(plan("*", "\n", "")).toBeNull();
    expect(plan("_", "", "")).toBeNull();
    expect(plan("_", " ", "")).toBeNull();
  });

  it("leaves an emphasis character alone at the end of a word", () => {
    expect(plan("*", "e", "")).toBeNull();
    expect(plan("_", "e", "")).toBeNull();
    expect(plan("*", "1", "")).toBeNull();
    expect(plan("_", "1", "")).toBeNull();
  });

  it("leaves an emphasis character alone in the middle of a word", () => {
    expect(plan("*", "a", "b")).toBeNull();
    expect(plan("_", "a", "b")).toBeNull();
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
