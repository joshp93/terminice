import { describe, expect, it } from "vitest";
import { asArray, asNumber, asRecord, asText, parseJsonLine, prettyJson } from "./json";

describe("asRecord", () => {
  it("keeps a plain object", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("rejects an array", () => {
    expect(asRecord([1, 2])).toBeNull();
  });

  it("rejects null", () => {
    expect(asRecord(null)).toBeNull();
  });

  it("rejects a primitive", () => {
    expect(asRecord("text")).toBeNull();
    expect(asRecord(7)).toBeNull();
  });
});

describe("asText", () => {
  it("keeps a string", () => {
    expect(asText("hello")).toBe("hello");
  });

  it("keeps an empty string as an empty string", () => {
    expect(asText("")).toBe("");
  });

  it("defaults anything else to empty", () => {
    expect(asText(42)).toBe("");
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
    expect(asText({})).toBe("");
  });
});

describe("asNumber", () => {
  it("keeps a finite number", () => {
    expect(asNumber(3.5)).toBe(3.5);
    expect(asNumber(0)).toBe(0);
  });

  it("rejects infinity and NaN", () => {
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(asNumber(Number.NaN)).toBeNull();
  });

  it("rejects a numeric string", () => {
    expect(asNumber("3")).toBeNull();
  });
});

describe("asArray", () => {
  it("keeps an array", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
  });

  it("defaults anything else to an empty array", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray("text")).toEqual([]);
    expect(asArray({ length: 2 })).toEqual([]);
  });
});

describe("parseJsonLine", () => {
  it("decodes an object line", () => {
    expect(parseJsonLine('{"type":"result"}')).toEqual({ type: "result" });
  });

  it("rejects malformed JSON", () => {
    expect(parseJsonLine("{not json")).toBeNull();
  });

  it("rejects a line that decodes to something other than an object", () => {
    expect(parseJsonLine("[1,2]")).toBeNull();
    expect(parseJsonLine('"text"')).toBeNull();
    expect(parseJsonLine("null")).toBeNull();
  });

  it("rejects an empty line", () => {
    expect(parseJsonLine("")).toBeNull();
  });
});

describe("prettyJson", () => {
  it("indents an object", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("falls back to a string for a value JSON cannot represent", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(prettyJson(circular)).toBe("[object Object]");
  });

  it("stringifies undefined rather than throwing", () => {
    expect(prettyJson(undefined)).toBe("undefined");
  });
});
