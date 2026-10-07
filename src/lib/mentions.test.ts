import { describe, expect, it } from "vitest";
import { MENTION_MINIMUM, MENTION_PREFIX, mentionIn } from "./mentions";

describe("mention constants", () => {
  it("opens the menu with an at sign", () => {
    expect(MENTION_PREFIX).toBe("@");
  });

  it("waits for two characters before opening the menu", () => {
    expect(MENTION_MINIMUM).toBe(2);
  });
});

describe("mentionIn", () => {
  it("reads the query and where its at sign sits", () => {
    expect(mentionIn("hi @src", 7)).toEqual({ query: "src", from: 3 });
  });

  it("accepts an at sign at the very start of the text", () => {
    expect(mentionIn("@ab", 3)).toEqual({ query: "ab", from: 0 });
  });

  it("accepts a mention after a newline", () => {
    expect(mentionIn("line\n@src", 9)).toEqual({ query: "src", from: 5 });
  });

  it("ignores text after the caret", () => {
    expect(mentionIn("use @src rest", 8)).toEqual({ query: "src", from: 4 });
  });

  it("takes the nearest at sign when several appear", () => {
    expect(mentionIn("@aa @bb", 7)).toEqual({ query: "bb", from: 4 });
  });

  it("keeps slashes and dots in the query", () => {
    expect(mentionIn("see @src/lib.ts", 15)).toEqual({ query: "src/lib.ts", from: 4 });
  });
});

describe("mentionIn refusals", () => {
  it("returns null when there is no at sign", () => {
    expect(mentionIn("hello", 3)).toBeNull();
    expect(mentionIn("", 0)).toBeNull();
  });

  it("returns null when the caret is before the at sign", () => {
    expect(mentionIn("@src", 0)).toBeNull();
  });

  it("returns null until enough characters follow the at sign", () => {
    expect(mentionIn("a @s", 4)).toBeNull();
    expect(mentionIn("@s", 2)).toBeNull();
  });

  it("returns null when the at sign does not open a word", () => {
    expect(mentionIn("foo@bar", 7)).toBeNull();
    expect(mentionIn("x @@ab", 6)).toBeNull();
  });

  it("returns null once a space has been typed past the query", () => {
    expect(mentionIn("@foo bar", 8)).toBeNull();
  });
});
