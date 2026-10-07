import { describe, expect, it } from "vitest";
import { oneLine } from "./oneLine";

describe("oneLine", () => {
  it("keeps a short line as it is", () => {
    expect(oneLine("src/App.tsx")).toBe("src/App.tsx");
  });

  it("keeps only the first line of a multi-line command", () => {
    expect(oneLine("git status\nrm -rf /")).toBe("git status");
  });

  it("trims the line it keeps", () => {
    expect(oneLine("  ls -la  ")).toBe("ls -la");
  });

  it("shortens a line that is too long, and says so with an ellipsis", () => {
    const result = oneLine("x".repeat(200));
    expect(result).toHaveLength(80);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves a line exactly at the limit alone", () => {
    const exact = "x".repeat(80);
    expect(oneLine(exact)).toBe(exact);
  });

  it("shortens a line one character past the limit", () => {
    const result = oneLine("x".repeat(81));
    expect(result).toBe(`${"x".repeat(79)}…`);
  });

  it("honours a limit it is given", () => {
    expect(oneLine("abcdef", 4)).toBe("abc…");
  });

  it("returns empty for empty or whitespace-only text", () => {
    expect(oneLine("")).toBe("");
    expect(oneLine("   \n\n  ")).toBe("");
  });

  it("measures the limit in characters, not bytes", () => {
    expect(oneLine("é".repeat(10), 10)).toBe("é".repeat(10));
  });
});
